import { error } from '@sveltejs/kit';
import { calendarAtPath } from '$lib/settings';
import { defaultCalendarUrl, getSettings, getStore } from '$lib/server/store';
import type { PageServerLoad } from './$types';

/** What the settings are now. Changing them comes in later steps. */
export const load: PageServerLoad = async () => {
	let store, settings;
	try {
		store = await getStore();
		settings = await getSettings(store);
	} catch (e) {
		error(503, `The calendar server isn't answering. Check that it is running, then reload. (${(e as Error).message})`);
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
		eventCalendars: events.map((c) => ({ name: c.name, work: c.url === work?.url, newEvents: c.url === newEvents })),
		taskLists: calendars.filter((c) => !c.accepts.includes('event')).map((c) => ({ name: c.name, newTasks: c.url === newTasks })),
		workCalendar: work?.name,
		defaultEventCalendar: events.find((c) => c.url === newEvents)?.name,
		categories: settings.categories
	};
};
