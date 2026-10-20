// One shared connection to the calendar server, configured from the environment.
import { env } from '$env/dynamic/private';
import type { ItemKind } from '$lib/item';
import { calendarAtPath, parseSettings, type Settings } from '$lib/settings';
import { CalendarStore } from './calendar-store';
import { prepareStore, tasksCalendarUrl } from './startup';

let store: Promise<CalendarStore> | undefined;

export function getStore(): Promise<CalendarStore> {
	if (!store) {
		const s = new CalendarStore({
			serverUrl: env.CALDAV_URL ?? 'http://127.0.0.1:5232/',
			username: env.CALDAV_USER ?? 'david',
			password: env.CALDAV_PASSWORD ?? 'dev'
		});
		store = s.connect().then(async () => {
			await prepareStore(s, { startingCalendars: eventCalendarNames(), ...seed(), tasksCalendar: tasksCalendarName() });
			return s;
		});
		store.catch(() => (store = undefined)); // retry on the next request if the server was down
	}
	return store;
}

/** Event calendars a planner starts with on a first run. More can be added from the details sheet. */
export const eventCalendarNames = () =>
	(env.EVENT_CALENDARS ?? 'Me,Family,Workouts,Morgan Meals').split(',').map((n) => n.trim()).filter(Boolean);

const tasksCalendarName = () => env.TASKS_CALENDAR ?? 'Tasks';

/** WORK_CALENDAR and EVENTS_CALENDAR only fill in the settings the first time; after that the settings decide. */
const seed = () => ({ workCalendar: env.WORK_CALENDAR ?? 'Work', eventsCalendar: env.EVENTS_CALENDAR ?? 'Me' });

/** David's settings, kept on the Tasks collection. */
export async function getSettings(store: CalendarStore): Promise<Settings> {
	const { workCalendar, eventsCalendar } = seed();
	const tasks = tasksCalendarUrl(store, tasksCalendarName());
	const names = { workCalendar, defaultEventCalendar: eventsCalendar };
	return tasks ? store.readSettings(tasks, names) : parseSettings(undefined, store.calendars(), names);
}

/** Where new items go: events to the calendar chosen in the settings, tasks to Tasks; else the first that accepts the kind. */
export function defaultCalendarUrl(store: CalendarStore, kind: ItemKind, settings: Settings): string {
	const events = store.calendars().filter((c) => c.accepts.includes('event'));
	const url = kind === 'event' ? (calendarAtPath(events, settings.defaultEventCalendar) ?? events[0])?.url : tasksCalendarUrl(store, tasksCalendarName());
	if (!url) throw new Error(`No calendar on the server accepts ${kind}s yet`);
	return url;
}
