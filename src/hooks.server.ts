import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { scheduleNightlyRollover } from '$lib/server/rollover';
import { passesTestGate } from '$lib/server/test-gate';

if (!building) scheduleNightlyRollover();

export const handle: Handle = async ({ event, resolve }) => {
	const password = env.TEST_PASSWORD;
	if (password && !passesTestGate(event.request.headers.get('authorization'), password)) {
		return new Response('Password needed', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Planner test", charset="UTF-8"' } });
	}
	return resolve(event);
};
