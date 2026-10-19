import { error, fail } from '@sveltejs/kit';
import { addDays, flipPage, pageDays, pageStart, toISODate } from '$lib/dates';
import { buildDays } from '$lib/page';
import { parseLine } from '$lib/parse';
import { defaultCalendarUrl, getStore } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const load: PageServerLoad = async ({ url }) => {
	const today = toISODate(new Date());
	const asked = url.searchParams.get('page');
	const start = pageStart(asked && ISO.test(asked) ? asked : today);
	const dates = pageDays(start);

	let items;
	try {
		items = await (await getStore()).listItems();
	} catch (e) {
		error(503, `The calendar server isn't answering. Check that it is running, then reload. (${(e as Error).message})`);
	}

	return {
		today,
		start,
		previous: flipPage(start, -1),
		next: flipPage(start, 1),
		todayPage: pageStart(today),
		// Only plain data goes to the browser: drop server locations.
		days: buildDays(dates, items).map((d) => ({
			...d,
			events: d.events.map(({ calendarUrl, url, etag, ...i }) => i),
			tasks: d.tasks.map(({ calendarUrl, url, etag, ...i }) => i)
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
		if (!ISO.test(date)) return fail(400, { message: 'That day is not a valid date' });
		const { title, time } = parseLine(text);
		if (!title) return fail(400, { message: 'Write something on the line first' });

		const store = await getStore();
		await store.create(defaultCalendarUrl(store, kind), { uid: crypto.randomUUID(), kind, title, date, time, state: 'open' });
		return { added: title };
	},

	/** Tick (done) or strike through (dropped); doing it again puts the item back to open. */
	mark: async ({ request }) => {
		const form = await request.formData();
		const state = form.get('state');
		if (state !== 'done' && state !== 'dropped') return fail(400, { message: 'Unknown mark' });
		const found = await findItem(String(form.get('uid') ?? ''));
		if (!found) return fail(404, { message: 'That item is no longer on the calendar; reload the page' });
		const { store, item } = found;
		await store.update(item, { state: item.state === state ? 'open' : state });
	},

	/** Move a task to another day (the arrow moves it to the next day). */
	move: async ({ request }) => {
		const form = await request.formData();
		const to = String(form.get('to') ?? '');
		if (!ISO.test(to)) return fail(400, { message: 'That day is not a valid date' });
		const found = await findItem(String(form.get('uid') ?? ''));
		if (!found) return fail(404, { message: 'That item is no longer on the calendar; reload the page' });
		const { store, item } = found;
		const changes = item.kind === 'event' && item.endDate
			? { date: to, endDate: addDays(to, daysBetween(item.date!, item.endDate)) }
			: { date: to };
		await store.update(item, changes);
	}
};

async function findItem(uid: string) {
	const store = await getStore();
	const item = (await store.listItems()).find((i) => i.uid === uid);
	return item ? { store, item } : undefined;
}

const daysBetween = (from: string, to: string) =>
	Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000);

