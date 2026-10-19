// Lets other calendar apps (Apple Calendar on a Mac or iPhone, Android with DAVx⁵) sync with the
// planner's calendars. Requests under /dav/ are passed to the calendar server, which checks its own
// user name and password; /.well-known/caldav points apps that look for it to the right place.

export const DAV_PREFIX = '/dav';

/** True for requests meant for the calendar server rather than the planner's own pages. */
export const isDavPath = (path: string) => path === DAV_PREFIX || path.startsWith(`${DAV_PREFIX}/`) || path.startsWith('/.well-known/caldav');

// Headers calendar apps send that the server needs; everything else (cookies and so on) stays here.
const PASSED_ON = ['authorization', 'content-type', 'depth', 'destination', 'if-match', 'if-none-match', 'overwrite', 'prefer', 'brief', 'user-agent'];
// Node's fetch has already undone any compression and works out lengths itself.
const DROPPED_FROM_REPLY = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'];

/**
 * The calendar server's address for a /dav/… path, or undefined if the path could lead anywhere else.
 * Joined as text on purpose: resolving "//other-host/…" as a URL would switch to that host.
 */
export function onServer(server: URL, path: string, search: string): URL | undefined {
	const rest = path.slice(DAV_PREFIX.length) || '/';
	if (!rest.startsWith('/') || rest.includes('//') || rest.includes('\\')) return undefined;
	const target = new URL(server.origin + server.pathname.replace(/\/$/, '') + rest + search);
	return target.origin === server.origin ? target : undefined;
}

export async function proxyToCalendarServer(request: Request, url: URL, serverUrl: string): Promise<Response> {
	if (url.pathname.startsWith('/.well-known/caldav')) {
		return new Response(null, { status: 301, headers: { Location: `${DAV_PREFIX}/` } });
	}
	const server = new URL(serverUrl);
	const target = onServer(server, url.pathname, url.search);
	if (!target) return new Response('Bad calendar address', { status: 400 });

	const headers = new Headers({ 'X-Script-Name': DAV_PREFIX });
	for (const name of PASSED_ON) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	// A move names its destination by full address; the server only accepts its own.
	const destination = request.headers.get('destination');
	if (destination) {
		const moved = new URL(destination, url);
		// Radicale expects the destination to keep the /dav prefix, so only the host part changes.
		const there = isDavPath(moved.pathname) && onServer(server, `${DAV_PREFIX}${moved.pathname}`, moved.search);
		if (!there) return new Response('Bad destination', { status: 400 });
		headers.set('destination', there.href);
	}

	const hasBody = !['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(request.method);
	const reply = await fetch(target, {
		method: request.method,
		headers,
		body: hasBody ? await request.arrayBuffer() : undefined,
		redirect: 'manual'
	});
	const replyHeaders = new Headers(reply.headers);
	for (const name of DROPPED_FROM_REPLY) replyHeaders.delete(name);
	return new Response(reply.body, { status: reply.status, statusText: reply.statusText, headers: replyHeaders });
}
