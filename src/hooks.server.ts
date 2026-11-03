import type { Handle, HandleServerError } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { allowedUser, fromShareMachine } from '$lib/server/access';
import { isDavPath, proxyToCalendarServer } from '$lib/server/dav-proxy';
import { fromInternet, secretIn } from '$lib/server/feeds';
import { scheduleNightlyRollover } from '$lib/server/rollover';

if (!building) scheduleNightlyRollover();

const refuse = (status: number, text: string) =>
	new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** What someone refused sees, and the log says once per login, so a lockout can be put right (by adding the login
 * to ALLOWED_USERS in .env). Only the login, which is theirs to see; nothing else about the request is kept. */
const refusedLogins = new Set<string>();
function notShared(headers: Headers): string {
	const login = headers.get('tailscale-user-login')?.trim().slice(0, 200);
	const who = login ? `the Tailscale login ${login}` : 'a device with no Tailscale login (a tagged device, or the server itself)';
	if (refusedLogins.size < 50 && !refusedLogins.has(who)) {
		refusedLogins.add(who);
		console.warn(`Planner: refused ${who}, which isn't on ALLOWED_USERS.`);
	}
	return `This planner is not shared with you. You're signed in to Tailscale as ${login ?? 'nobody (a tagged device)'}; ` +
		'its owner can add that login to ALLOWED_USERS on the server.';
}

export const handle: Handle = async ({ event, resolve }) => {
	const { headers } = event.request;
	// From the internet (Tailscale Funnel), only a shared calendar link may be reached, and only to read it: never the
	// planner's pages, its settings or the calendar server, even if Funnel were set up to publish more than /feed.
	// A request made by the planner-share container itself counts the same, whatever headers it sends.
	// (The app's own static files, such as its icons and code, are served before this runs; none holds personal data.)
	const internet = fromInternet(headers) || (!!env.FEED_ORIGIN && (await fromShareMachine(event.getClientAddress())));
	if (internet && !(['GET', 'HEAD'].includes(event.request.method) && secretIn(event.url.pathname))) return refuse(404, 'Not found');
	// Calendar apps syncing over CalDAV (a family member's phone, say); the calendar server checks its own password.
	if (!internet && isDavPath(event.url.pathname)) {
		return proxyToCalendarServer(event.request, event.url, env.CALDAV_URL ?? 'http://127.0.0.1:5232/');
	}
	// The planner itself, over the tailnet: only the people on ALLOWED_USERS. Someone the server is shared with, or a
	// tagged machine (which has no login), is not.
	if (!internet && !allowedUser(headers, env.ALLOWED_USERS)) return refuse(403, notShared(headers));
	const response = await resolve(event);
	// No other site may show the planner inside its own page and trick a tap on Share or Delete.
	try {
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
	} catch {
		// A response whose headers can't be changed (none of the planner's own); it is left as it is.
	}
	return response;
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
