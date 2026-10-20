import { error, fail } from '@sveltejs/kit';
import { addDays, comingSaturday, flipPage, pageDays, pageStart, toISODate } from '$lib/dates';
import { applyEdit, daysBetween } from '$lib/edit';
import type { Item } from '$lib/item';
import { buildDays } from '$lib/page';
import { parseLine } from '$lib/parse';
import { rollover } from '$lib/server/rollover';
import { occurrenceOn, occurrencesBetween } from '$lib/server/ical';
import type { StoredItem } from '$lib/server/calendar-store';
import { byName, calendarAtPath, checkCalendarName, menuLabels } from '$lib/settings';
import { defaultCalendarUrl, getSettings, getStore } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIST_ORDER = ['month', 'waiting', 'someday', ''];
const NEW_CALENDAR = '+new';
const NOT_ANSWERING = "The calendar server isn't answering. Check that it is running, then reload.";

/** Calendars are passed to the page by path, which stays the same through a rename and tells two of one name apart. */
const pathOf = (url: string) => new URL(url).pathname;

/** Where a new item goes, or undefined if no calendar takes that kind (every event calendar deleted, say). */
function newItemsGoIn(store: Awaited<ReturnType<typeof getStore>>, kind: 'event' | 'task', settings: Awaited<ReturnType<typeof getSettings>>) {
	try {
		return defaultCalendarUrl(store, kind, settings);
	} catch {
		return undefined;
	}
}

/** Only plain item data goes to the browser, not where it lives on the server. */
const plain = ({ calendarUrl, url, etag, ics, ...item }: Item & { calendarUrl?: string; url?: string; etag?: string; ics?: string }): Item => item;

export const load: PageServerLoad = async ({ url }) => {
	const today = toISODate(new Date());
	const asked = url.searchParams.get('page');
	const start = pageStart(asked && ISO.test(asked) ? asked : today);
	const dates = pageDays(start);

	let items, store, settings;
	try {
		await rollover(today);
		store = await getStore();
		items = await store.listItems();
		settings = await getSettings(store);
	} catch (e) {
		// The details go to the server's log; the page gets a plain message.
		console.error('Planner: could not read the calendars or settings', e);
		error(503, NOT_ANSWERING);
	}

	const calendars = store.calendars();
	const eventCalendars = calendars.filter((c) => c.accepts.includes('event')).sort(byName);
	const newEvents = newItemsGoIn(store, 'event', settings);

	return {
		today,
		eventCalendars: menuLabels(eventCalendars.map((c) => ({ path: pathOf(c.url), name: c.name }))),
		defaultEventCalendar: newEvents && pathOf(newEvents),
		workCalendar: calendarAtPath(calendars, settings.workCalendar) && settings.workCalendar,
		start,
		previous: flipPage(start, -1),
		next: flipPage(start, 1),
		todayPage: pageStart(today),
		saturday: comingSaturday(today),
		unscheduled: items
			.filter((i) => i.kind === 'task' && !i.date && i.state === 'open')
			.sort((a, b) => LIST_ORDER.indexOf(a.label ?? '') - LIST_ORDER.indexOf(b.label ?? ''))
			.map((i) => plain({ ...i, calendar: pathOf(i.calendarUrl) })),
		// A repeating item shows on each day of the page it falls on.
		days: buildDays(
			dates,
			items.flatMap((i) =>
				(i.recurrence ? occurrencesBetween(i.ics, dates[0], dates[dates.length - 1]) : [i]).map((shown) => ({ ...shown, calendar: pathOf(i.calendarUrl) }))
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

		let store, settings;
		try {
			store = await getStore();
			// A fresh list, so a calendar deleted on another device since the page loaded isn't used.
			await store.refreshCalendars();
			settings = await getSettings(store);
		} catch (e) {
			console.error('Planner: could not reach the calendar server to add a line', e);
			return fail(503, { message: NOT_ANSWERING });
		}
		const calendar = newItemsGoIn(store, kind, settings);
		if (!calendar) return fail(409, { message: kind === 'event' ? 'There is no calendar for events yet. Add one in Settings.' : 'There is no Tasks list on the calendar server; reload the page.' });
		try {
			await store.create(calendar, {
				uid: crypto.randomUUID(),
				kind,
				title,
				state: 'open',
				...(date ? { date, time } : {})
			});
		} catch (e) {
			console.error(`Planner: could not save "${title}"`, e);
			return fail(502, { message: `The calendar server didn't save "${title}". Try again in a moment.` });
		}
		return { added: title };
	},

	/** Tick (done) or strike through (dropped); doing it again puts the item back to open, unless asked only to set it (pen marks). */
	mark: async ({ request }) => {
		const form = await request.formData();
		const state = form.get('state');
		if (state !== 'done' && state !== 'dropped') return fail(400, { message: 'Unknown mark' });
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		const set = form.get('set') === 'yes';
		const toggle = (current: Item): Partial<Item> => ({ state: current.state === state && !set ? 'open' : state });
		const day = String(form.get('occurrence') ?? '');
		const shown = shownOn(item, day);
		return change(
			`save the mark on "${item.title}"`,
			() => (item.recurrence && ISO.test(day) ? store.updateOccurrence(item, day, toggle) : store.update(item, toggle(item))),
			shown && { item, day, wanted: toggle(shown) }
		);
	},

	/** Move a task to another day (the arrow moves it to the next day). */
	move: async ({ request }) => {
		const form = await request.formData();
		const to = String(form.get('to') ?? '');
		if (!ISO.test(to)) return fail(400, { message: 'That day is not a valid date' });
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		const moveTo = (current: Item) => current.kind === 'event' && current.endDate
			? { date: to, endDate: addDays(to, daysBetween(current.date!, current.endDate)) }
			: { date: to };
		const day = String(form.get('occurrence') ?? '');
		const shown = shownOn(item, day);
		return change(
			`move "${item.title}"`,
			() => (item.recurrence && ISO.test(day) ? store.updateOccurrence(item, day, moveTo) : store.update(item, moveTo(item))),
			shown && { item, day, wanted: moveTo(shown) }
		);
	},

	/** Takes a task off its day and puts it back on the Future tasks list. */
	unschedule: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		if (item.kind !== 'task' || item.recurrence) return fail(400, { message: 'Only a one-off task can go back to Future tasks' });
		const { date, time, carriedFrom, ...rest } = item;
		return change(`move "${item.title}"`, () => store.replace(item, rest));
	},

	/** The details sheet: edit any field, switch between event and task. */
	save: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		const field = (name: string) => String(form.get(name) ?? '');
		const result = applyEdit(item, {
			title: field('title'), kind: field('kind'), date: field('date'), time: field('time'),
			endTime: field('endTime'), location: field('location'), label: field('label'), notes: field('notes'),
			repeat: field('repeat')
		});
		if ('error' in result) return fail(400, { message: result.error });
		// Events can be filed in any calendar that takes events (Me, Family, Work…), or in a new one made here.
		// The same name rules as the settings page; a calendar that already exists is picked from the list.
		const newName = result.item.kind === 'event' && field('calendar') === NEW_CALENDAR ? checkCalendarName(field('newCalendar'), store.calendars()) : undefined;
		if (newName && 'error' in newName) return fail(400, { message: newName.error });
		let moved;
		const saved = await change(`save "${item.title}"`, async () => {
			const wanted = newName
				? await store.ensureCalendar(newName.name, ['event'])
				: result.item.kind === 'event'
					? calendarAtPath(store.calendars().filter((c) => c.accepts.includes('event')), field('calendar'))
					: undefined;
			const target = wanted?.url ?? (result.item.kind === item.kind ? item.calendarUrl : defaultCalendarUrl(store, result.item.kind, await getSettings(store)));
			if (result.item.kind === item.kind && target === item.calendarUrl) {
				// Fields left blank are removed, so save the whole item rather than a merge.
				await store.replace(item, result.item);
			} else {
				// A different calendar, or events and tasks (different kinds of entry): write the new one, then remove the old.
				const copy = await store.create(target, result.item, result.item.kind === item.kind ? item.ics : undefined);
				moved = await removeOrUndo(store, item, copy);
			}
		});
		return saved ?? moved;
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		return change(`delete "${item.title}"`, () => store.remove(item));
	},

	/** Removes one day of a repeating item and keeps the rest of the series. */
	deleteOne: async ({ request }) => {
		const form = await request.formData();
		const day = String(form.get('occurrence') ?? '');
		if (!ISO.test(day)) return fail(400, { message: 'Which day should be removed?' });
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		if (!item.recurrence) return fail(400, { message: 'This item does not repeat' });
		return change(`delete that day of "${item.title}"`, () => store.removeOccurrence(item, day));
	}
};

/** The item a form is about, or a plain message for the page if it is gone or the calendar server isn't answering.
 * One UID can be in two calendars (a move between calendars that stopped halfway); the form says which copy. */
async function findItem(form: FormData) {
	const uid = String(form.get('uid') ?? '');
	// Not "calendar": the details sheet uses that for the calendar to file it in.
	const keptIn = String(form.get('keptIn') ?? '');
	let store, item;
	try {
		store = await getStore();
		const copies = (await store.listItems()).filter((i) => i.uid === uid);
		item = copies.find((i) => pathOf(i.calendarUrl) === keptIn) ?? copies[0];
	} catch (e) {
		console.error('Planner: could not reach the calendar server to change an item', e);
		return fail(503, { message: NOT_ANSWERING });
	}
	return item ? { store, item } : fail(404, { message: 'That item is no longer on the calendar; reload the page' });
}

/** What a tap asked for: these fields on this item (on one day of it, if it repeats). */
interface Wanted {
	item: StoredItem;
	day: string;
	wanted: Partial<Item>;
}

/** An item as the page shows it: for a repeating one, that day's showing. */
function shownOn(item: StoredItem, day: string): Item | undefined {
	if (!item.recurrence || !ISO.test(day)) return item;
	try {
		return occurrenceOn(item.ics, day);
	} catch {
		return undefined;
	}
}

/** Makes a change on the calendar server. If it fails, the details go to the server's log and the page gets a plain
 * message rather than an error screen. The item may have been changed on a phone meanwhile, hence the reload.
 * A change refused because the item already looks as asked (a double tap: the first tap saved it) is not a failure. */
async function change(what: string, work: () => Promise<unknown>, asked?: Wanted) {
	try {
		await work();
	} catch (e) {
		if (asked && (await alreadyDone(asked))) return;
		console.error(`Planner: could not ${what}`, e);
		return fail(502, { message: `The calendar server didn't ${what}. Reload the page and try again.` });
	}
}

/** Whether the item, read again now, already has what was asked for. */
async function alreadyDone({ item, day, wanted }: Wanted) {
	try {
		const store = await getStore();
		const now = (await store.listItems()).find((i) => i.uid === item.uid && i.calendarUrl === item.calendarUrl);
		const shown = now && shownOn(now, day);
		return !!shown && Object.entries(wanted).every(([field, value]) => shown[field as keyof Item] === value);
	} catch {
		return false;
	}
}

/** The second half of moving an item to another calendar: remove the old copy. If the calendar server won't,
 * take the new copy back out, so the item isn't left in two calendars, and say what happened either way. */
async function removeOrUndo(store: Awaited<ReturnType<typeof getStore>>, old: StoredItem, copy: StoredItem) {
	try {
		await store.remove(old);
		return;
	} catch (e) {
		console.error(`Planner: could not remove the old copy of "${old.title}" after copying it`, e);
	}
	try {
		await store.remove(copy);
		return fail(502, { message: `The calendar server didn't move "${old.title}" to another calendar, so it stays where it was. Reload the page and try again.` });
	} catch (e) {
		console.error(`Planner: could not take back the new copy of "${old.title}"`, e);
		return fail(502, { message: `"${old.title}" is now in two calendars, because the calendar server wouldn't remove the old one. Reload the page and delete the one you don't want.` });
	}
}
