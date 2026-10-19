// One shared connection to the calendar server, configured from the environment.
import { env } from '$env/dynamic/private';
import type { ItemKind } from '$lib/item';
import { CalendarStore } from './calendar-store';

let store: Promise<CalendarStore> | undefined;

export function getStore(): Promise<CalendarStore> {
	if (!store) {
		const s = new CalendarStore({
			serverUrl: env.CALDAV_URL ?? 'http://127.0.0.1:5232/',
			username: env.CALDAV_USER ?? 'david',
			password: env.CALDAV_PASSWORD ?? 'dev'
		});
		store = s.connect().then(async () => {
			// The Work calendar is where work meetings are entered by hand; make sure it exists.
			await s.ensureCalendar(workCalendarName(), ['event']).catch((e) => console.error('Could not create the Work calendar', e));
			return s;
		});
		store.catch(() => (store = undefined)); // retry on the next request if the server was down
	}
	return store;
}

/** The calendar whose events are shown as work meetings (light red, tagged Work). */
export const workCalendarName = () => env.WORK_CALENDAR ?? 'Work';

/** Where new items go: the calendar named in the environment, else the first one that accepts the kind. */
export function defaultCalendarUrl(store: CalendarStore, kind: ItemKind): string {
	const wanted = kind === 'event' ? (env.EVENTS_CALENDAR ?? 'Personal') : (env.TASKS_CALENDAR ?? 'Tasks');
	const options = store.calendars().filter((c) => c.accepts.includes(kind));
	const chosen = options.find((c) => c.name === wanted) ?? options[0];
	if (!chosen) throw new Error(`No calendar on the server accepts ${kind}s yet`);
	return chosen.url;
}
