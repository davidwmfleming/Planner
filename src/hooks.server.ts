import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { isDavPath, proxyToCalendarServer } from '$lib/server/dav-proxy';
import { scheduleNightlyRollover } from '$lib/server/rollover';

if (!building) scheduleNightlyRollover();

export const handle: Handle = async ({ event, resolve }) => {
	// Calendar apps syncing over CalDAV; the calendar server checks its own password.
	if (isDavPath(event.url.pathname)) {
		return proxyToCalendarServer(event.request, event.url, env.CALDAV_URL ?? 'http://127.0.0.1:5232/');
	}
	return resolve(event);
};
