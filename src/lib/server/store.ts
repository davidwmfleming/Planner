// One shared connection to the calendar server, configured from the environment.
import { env } from '$env/dynamic/private';
import { CalendarStore } from './calendar-store';

let store: Promise<CalendarStore> | undefined;

export function getStore(): Promise<CalendarStore> {
	if (!store) {
		const s = new CalendarStore({
			serverUrl: env.CALDAV_URL ?? 'http://127.0.0.1:5232/',
			username: env.CALDAV_USER ?? 'david',
			password: env.CALDAV_PASSWORD ?? 'dev'
		});
		store = s.connect().then(() => s);
		store.catch(() => (store = undefined)); // retry on the next request if the server was down
	}
	return store;
}
