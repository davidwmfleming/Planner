// One shared connection to the calendar server, configured from the environment.
import { env } from '$env/dynamic/private';
import type { ItemKind } from '$lib/item';
import { byName, calendarAtPath, type Settings } from '$lib/settings';
import { CalendarStore, useLogKey } from './calendar-store';
import { prepareStore, tasksCalendarUrl } from './startup';

let store: Promise<CalendarStore> | undefined;

export function getStore(): Promise<CalendarStore> {
	if (!store) {
		const s = new CalendarStore({
			serverUrl: env.CALDAV_URL ?? 'http://127.0.0.1:5232/',
			username: env.CALDAV_USER ?? 'david',
			password: env.CALDAV_PASSWORD ?? 'dev'
		});
		const started = s.connect().then(async () => {
			await prepareStore(s, { startingCalendars: eventCalendarNames(), ...seed(), tasksCalendar: tasksCalendarName() });
			await useInstallLogKey(s);
			return s;
		});
		// Retry on the next request if the server was down or didn't answer in time.
		started.catch(() => {
			if (store === started) store = undefined;
		});
		store = started;
	}
	return store;
}

/** Fingerprints in the log are made with this install's own key from now on. If it can't be read or made, the
 * planner still starts, with a key for this run only: fingerprints then change at the next start. */
async function useInstallLogKey(s: CalendarStore) {
	try {
		useLogKey(await s.logKey(s.addressFor(tasksCalendarName())));
	} catch (e) {
		console.error('Could not read or make the key for fingerprints in the log; using one for this run only', e);
	}
}

/** Event calendars a planner starts with on a first run. More can be added from the details sheet. */
export const eventCalendarNames = () =>
	(env.EVENT_CALENDARS ?? 'Me,Family,Workouts,Morgan Meals').split(',').map((n) => n.trim()).filter(Boolean);

const tasksCalendarName = () => env.TASKS_CALENDAR ?? 'Tasks';

/** WORK_CALENDAR and EVENTS_CALENDAR only fill in the settings the first time; after that the settings decide. */
const seed = () => ({ workCalendar: env.WORK_CALENDAR ?? 'Work', eventsCalendar: env.EVENTS_CALENDAR ?? 'Me' });

/** The collection every task lives in; it holds the settings, so it is never renamed or deleted. */
export const tasksUrl = (store: CalendarStore) => tasksCalendarUrl(store, tasksCalendarName());

/** David's settings, kept on the Tasks collection. */
export async function getSettings(store: CalendarStore): Promise<Settings> {
	const { workCalendar, eventsCalendar } = seed();
	// Read straight from the Tasks address, so a calendar listing that comes back short can't hide them.
	return store.readSettings(store.addressFor(tasksCalendarName()), { workCalendar, defaultEventCalendar: eventsCalendar });
}

/** Where new items go: events to the calendar chosen in the settings, tasks to Tasks. If the chosen calendar is gone,
 * events go to the first event calendar by name, the one at the top of the menus. */
export function defaultCalendarUrl(store: CalendarStore, kind: ItemKind, settings: Settings): string {
	const events = store.calendars().filter((c) => c.accepts.includes('event')).sort(byName);
	const url = kind === 'event' ? (calendarAtPath(events, settings.defaultEventCalendar) ?? events[0])?.url : tasksCalendarUrl(store, tasksCalendarName());
	if (!url) throw new Error(`No calendar on the server accepts ${kind}s yet`);
	return url;
}
