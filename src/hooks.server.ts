import type { Handle, HandleServerError } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { isDavPath, proxyToCalendarServer } from '$lib/server/dav-proxy';
import { fromInternet, secretIn } from '$lib/server/feeds';
import { scheduleNightlyRollover } from '$lib/server/rollover';

if (!building) scheduleNightlyRollover();

export const handle: Handle = async ({ event, resolve }) => {
	// From the internet (Tailscale Funnel), only a shared calendar link may be reached, and only to read it: never the
	// planner's pages, its settings or the calendar server, even if Funnel were set up to publish more than /feed.
	// (The app's own static files, such as its icons and code, are served before this runs; none holds personal data.)
	if (fromInternet(event.request.headers) && !(['GET', 'HEAD'].includes(event.request.method) && secretIn(event.url.pathname))) {
		return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
	}
	// Calendar apps syncing over CalDAV; the calendar server checks its own password.
	if (isDavPath(event.url.pathname)) {
		return proxyToCalendarServer(event.request, event.url, env.CALDAV_URL ?? 'http://127.0.0.1:5232/');
	}
	return resolve(event);
};

/** What the log says about an error nobody expected: its kind and where it happened, never its message, which can
 * quote an item's text (a parser quoting the line it choked on, say). House rule 4. */
export function describeForLog(error: unknown): string {
	if (!(error instanceof Error)) return `a thrown ${typeof error}`;
	// The stack starts with the message, which may run over several lines; only the "at ..." lines are kept.
	const frames = (error.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
	return [error.name, ...frames].join('\n');
}

export const handleError: HandleServerError = ({ error, status }) => {
	// A missing page or a bad request (wrong address, wrong form) is not a fault worth logging.
	if (status < 500) return;
	console.error('Planner: something unexpected went wrong:', describeForLog(error));
	// The page gets SvelteKit's plain message (nothing is returned), never the error's own.
};
