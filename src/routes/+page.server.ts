import { error, fail } from '@sveltejs/kit';
import { addDays, comingSaturday, flipPage, pageDays, pageStart, toISODate } from '$lib/dates';
import { applyEdit, daysBetween } from '$lib/edit';
import type { Item } from '$lib/item';
import { buildDays } from '$lib/page';
import { parseLine } from '$lib/parse';
import { rollover } from '$lib/server/rollover';
import { occurrencesBetween } from '$lib/server/ical';
import { defaultCalendarUrl, getStore, workCalendarName } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIST_ORDER = ['month', 'waiting', 'someday', ''];
const NEW_CALENDAR = '+new';

/** Only plain item data goes to the browser, not where it lives on the server. */
const plain = ({ calendarUrl, url, etag, ics, ...item }: Item & { calendarUrl?: string; url?: string; etag?: string; ics?: string }): Item => item;

export const load: PageServerLoad = async ({ url }) => {
	const today = toISODate(new Date());
	const asked = url.searchParams.get('page');
	const start = pageStart(asked && ISO.test(asked) ? asked : today);
	const dates = pageDays(start);

	let items, store;
	try {
		await rollover(today);
		store = await getStore();
		items = await store.listItems();
	} catch (e) {
		error(503, `The calendar server isn't answering. Check that it is running, then reload. (${(e as Error).message})`);
	}

	const calendars = store.calendars();
	const calendarName = (url: string) => calendars.find((c) => c.url === url)?.name;
	const eventCalendars = calendars.filter((c) => c.accepts.includes('event')).map((c) => c.name);

	return {
		today,
		eventCalendars,
		defaultEventCalendar: calendarName(defaultCalendarUrl(store, 'event')),
		workCalendar: workCalendarName(),
		start,
		previous: flipPage(start, -1),
		next: flipPage(start, 1),
		todayPage: pageStart(today),
		saturday: comingSaturday(today),
		unscheduled: items
			.filter((i) => i.kind === 'task' && !i.date && i.state === 'open')
			.sort((a, b) => LIST_ORDER.indexOf(a.label ?? '') - LIST_ORDER.indexOf(b.label ?? ''))
			.map(plain),
		// A repeating item shows on each day of the page it falls on.
		days: buildDays(
			dates,
			items.flatMap((i) =>
				(i.recurrence ? occurrencesBetween(i.ics, dates[0], dates[dates.length - 1]) : [i]).map((shown) => ({ ...shown, calendar: calendarName(i.calendarUrl) }))
			)
		).map((d) => ({
			...d,
			events: d.events.map(plain),
			tasks: d.tasks.map(plain)
		}))
	};
};

export const actions: Actions = {
	/** A line written on a day: left column makes an event, right column a task. */
	add: async ({ request }) => {
		const form = await request.formData();
		const kind = form.get('kind');
		const date = String(form.get('date') ?? '');
		const text = String(form.get('text') ?? '');
		if (kind !== 'event' && kind !== 'task') return fail(400, { message: 'Choose the events or tasks column' });
		if (date ? !ISO.test(date) : kind === 'event') return fail(400, { message: 'That day is not a valid date' });
		const { title, time } = parseLine(text);
		if (!title) return fail(400, { message: 'Write something on the line first' });

		const store = await getStore();
		await store.create(defaultCalendarUrl(store, kind), {
			uid: crypto.randomUUID(),
			kind,
			title,
			state: 'open',
			...(date ? { date, time } : {})
		});
		return { added: title };
	},

	/** Tick (done) or strike through (dropped); doing it again puts the item back to open, unless asked only to set it (pen marks). */
	mark: async ({ request }) => {
		const form = await request.formData();
		const state = form.get('state');
		if (state !== 'done' && state !== 'dropped') return fail(400, { message: 'Unknown mark' });
		const found = await findItem(String(form.get('uid') ?? ''));
		if (!found) return fail(404, { message: 'That item is no longer on the calendar; reload the page' });
		const { store, item } = found;
		const set = form.get('set') === 'yes';
		const toggle = (current: Item): Partial<Item> => ({ state: current.state === state && !set ? 'open' : state });
		const day = String(form.get('occurrence') ?? '');
		if (item.recurrence && ISO.test(day)) await store.updateOccurrence(item, day, toggle);
		else await store.update(item, toggle(item));
	},

	/** Move a task to another day (the arrow moves it to the next day). */
	move: async ({ request }) => {
		const form = await request.formData();
		const to = String(form.get('to') ?? '');
		if (!ISO.test(to)) return fail(400, { message: 'That day is not a valid date' });
		const found = await findItem(String(form.get('uid') ?? ''));
		if (!found) return fail(404, { message: 'That item is no longer on the calendar; reload the page' });
		const { store, item } = found;
		const moveTo = (current: Item) => current.kind === 'event' && current.endDate
			? { date: to, endDate: addDays(to, daysBetween(current.date!, current.endDate)) }
			: { date: to };
		const day = String(form.get('occurrence') ?? '');
		if (item.recurrence && ISO.test(day)) await store.updateOccurrence(item, day, moveTo);
		else await store.update(item, moveTo(item));
	},

	/** Takes a task off its day and puts it back on the Future tasks list. */
	unschedule: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(String(form.get('uid') ?? ''));
		if (!found) return fail(404, { message: 'That item is no longer on the calendar; reload the page' });
		const { store, item } = found;
		if (item.kind !== 'task' || item.recurrence) return fail(400, { message: 'Only a one-off task can go back to Future tasks' });
		const { date, time, carriedFrom, ...rest } = item;
		await store.replace(item, rest);
	},

	/** The details sheet: edit any field, switch between event and task. */
	save: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(String(form.get('uid') ?? ''));
		if (!found) return fail(404, { message: 'That item is no longer on the calendar; reload the page' });
		const { store, item } = found;
		const field = (name: string) => String(form.get(name) ?? '');
		const result = applyEdit(item, {
			title: field('title'), kind: field('kind'), date: field('date'), time: field('time'),
			endTime: field('endTime'), location: field('location'), label: field('label'), notes: field('notes'),
			repeat: field('repeat')
		});
		if ('error' in result) return fail(400, { message: result.error });
		// Events can be filed in any calendar that takes events (Me, Family, Work…), or in a new one made here.
		let wanted;
		if (result.item.kind === 'event' && field('calendar') === NEW_CALENDAR) {
			const name = field('newCalendar').trim();
			if (!name || name.length > 40) return fail(400, { message: 'Give the new calendar a name (up to 40 letters)' });
			if (store.calendars().some((c) => c.name.toLowerCase() === name.toLowerCase() && !c.accepts.includes('event'))) {
				return fail(400, { message: `"${name}" is a task list; pick another name` });
			}
			wanted = store.calendars().find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? (await store.ensureCalendar(name, ['event']));
		} else if (result.item.kind === 'event') {
			wanted = store.calendars().find((c) => c.name === field('calendar') && c.accepts.includes('event'));
		}
		const target = wanted?.url ?? (result.item.kind === item.kind ? item.calendarUrl : defaultCalendarUrl(store, result.item.kind));
		if (result.item.kind === item.kind && target === item.calendarUrl) {
			// Fields left blank are removed, so save the whole item rather than a merge.
			await store.replace(item, result.item);
		} else {
			// A different calendar, or events and tasks (different kinds of entry): write the new one, then remove the old.
			await store.create(target, result.item, result.item.kind === item.kind ? item.ics : undefined);
			await store.remove(item);
		}
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(String(form.get('uid') ?? ''));
		if (!found) return fail(404, { message: 'That item is no longer on the calendar; reload the page' });
		await found.store.remove(found.item);
	},

	/** Removes one day of a repeating item and keeps the rest of the series. */
	deleteOne: async ({ request }) => {
		const form = await request.formData();
		const day = String(form.get('occurrence') ?? '');
		if (!ISO.test(day)) return fail(400, { message: 'Which day should be removed?' });
		const found = await findItem(String(form.get('uid') ?? ''));
		if (!found) return fail(404, { message: 'That item is no longer on the calendar; reload the page' });
		if (!found.item.recurrence) return fail(400, { message: 'This item does not repeat' });
		await found.store.removeOccurrence(found.item, day);
	}
};

async function findItem(uid: string) {
	const store = await getStore();
	const item = (await store.listItems()).find((i) => i.uid === uid);
	return item ? { store, item } : undefined;
}
