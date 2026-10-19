import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { isDavPath, proxyToCalendarServer } from '$lib/server/dav-proxy';
import { scheduleNightlyRollover } from '$lib/server/rollover';
import { passesTestGate } from '$lib/server/test-gate';

if (!building) scheduleNightlyRollover();

export const handle: Handle = async ({ event, resolve }) => {
	// Calendar apps syncing over CalDAV. The calendar server checks its own password, so the test gate below doesn't apply.
	if (isDavPath(event.url.pathname)) {
		return proxyToCalendarServer(event.request, event.url, env.CALDAV_URL ?? 'http://127.0.0.1:5232/');
	}
	const password = env.TEST_PASSWORD;
	if (password && !passesTestGate(event.request.headers.get('authorization'), password)) {
		return new Response('Password needed', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Planner test", charset="UTF-8"' } });
	}
	return resolve(event);
};
