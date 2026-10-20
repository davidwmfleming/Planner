import { error, fail } from '@sveltejs/kit';
import { calendarAtPath, checkCalendarName } from '$lib/settings';
import { defaultCalendarUrl, getSettings, getStore, tasksUrl } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const pathOf = (url: string) => new URL(url).pathname;

/** The calendar server, or a plain message for the page; the details go to the server's log. */
async function connect() {
	try {
		return await getStore();
	} catch (e) {
		console.error('Settings: the calendar server is not answering', e);
		return undefined;
	}
}

const NOT_ANSWERING = "The calendar server isn't answering. Check that it is running, then try again.";

export const load: PageServerLoad = async () => {
	let store, settings;
	try {
		store = await getStore();
		settings = await getSettings(store);
	} catch (e) {
		console.error('Settings: could not read the calendars or settings', e);
		error(503, NOT_ANSWERING);
	}

	const calendars = store.calendars();
	const events = calendars.filter((c) => c.accepts.includes('event'));
	const work = calendarAtPath(events, settings.workCalendar);
	const urlFor = (kind: 'event' | 'task') => {
		try {
			return defaultCalendarUrl(store, kind, settings);
		} catch {
			return undefined; // no calendar of that kind yet
		}
	};
	const [newEvents, newTasks] = [urlFor('event'), urlFor('task')];

	return {
		eventCalendars: events.map((c) => ({ path: pathOf(c.url), name: c.name, work: c.url === work?.url, newEvents: c.url === newEvents })),
		taskLists: calendars.filter((c) => !c.accepts.includes('event')).map((c) => ({ path: pathOf(c.url), name: c.name, newTasks: c.url === newTasks })),
		workCalendar: work?.name,
		defaultEventCalendar: events.find((c) => c.url === newEvents)?.name,
		categories: settings.categories
	};
};

export const actions: Actions = {
	/** A new event calendar, with a name no other calendar or list has. */
	add: async ({ request }) => {
		const asked = String((await request.formData()).get('name') ?? '');
		const store = await connect();
		if (!store) return fail(503, { action: 'add', name: asked, message: NOT_ANSWERING });
		const checked = checkCalendarName(asked, store.calendars());
		if ('error' in checked) return fail(400, { action: 'add', name: asked, message: checked.error });
		try {
			await store.ensureCalendar(checked.name, ['event']);
		} catch (e) {
			console.error(`Settings: could not create the calendar "${checked.name}"`, e);
			return fail(502, { action: 'add', name: asked, message: `The calendar server didn't make "${checked.name}". Try again in a moment.` });
		}
		return { action: 'add', added: checked.name };
	},

	/** A new name for an event calendar. It keeps its address, so phones, Work and the default still find it. */
	rename: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const asked = String(form.get('name') ?? '');
		const store = await connect();
		if (!store) return fail(503, { action: 'rename', path, name: asked, message: NOT_ANSWERING });
		const calendar = calendarAtPath(store.calendars(), path);
		if (!calendar) return fail(404, { action: 'rename', path, name: asked, message: "That calendar isn't there any more; reload the page" });
		if (!calendar.accepts.includes('event') || calendar.url === tasksUrl(store)) return fail(400, { action: 'rename', path, name: asked, message: `${calendar.name} holds every task, so it can't be renamed` });
		const checked = checkCalendarName(asked, store.calendars(), calendar.url);
		if ('error' in checked) return fail(400, { action: 'rename', path, name: asked, message: checked.error });
		if (checked.name === calendar.name) return { action: 'rename', renamed: checked.name };
		try {
			await store.renameCalendarAt(calendar.url, checked.name);
		} catch (e) {
			console.error(`Settings: could not rename "${calendar.name}" to "${checked.name}"`, e);
			return fail(502, { action: 'rename', path, name: asked, message: `The calendar server didn't rename "${calendar.name}". Try again in a moment.` });
		}
		return { action: 'rename', renamed: checked.name };
	}
};
