// A shared calendar link: the calendar as one .ics file, read-only, for a computer that isn't on David's Tailscale.
// Reached from the internet through Tailscale Funnel (see "Shared calendar links" in docs/design.md).
import { calendarAtPath } from '$lib/settings';
import { calendarFor, secretIn } from '$lib/server/feeds';
import { getFeeds, getStore } from '$lib/server/store';
import type { RequestHandler } from './$types';

// The same plain answer for a wrong, cancelled or badly written link, so none of them says which it was.
const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const unavailable = () => new Response('Try again later', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300' } });

export const GET: RequestHandler = async ({ params }) => {
	const secret = secretIn(`/feed/${params.file}`);
	if (!secret) return notFound();
	let store, feeds;
	try {
		store = await getStore();
		feeds = await getFeeds(store);
	} catch (e) {
		console.error('Shared link: could not read the shared links', e);
		return unavailable();
	}
	const path = calendarFor(feeds, secret);
	const calendar = path ? calendarAtPath(store.calendars().filter((c) => c.accepts.includes('event')), path) : undefined;
	if (!calendar) return notFound();
	let ics;
	try {
		ics = await store.calendarFile(calendar.url);
	} catch (e) {
		console.error('Shared link: the calendar server did not hand out a shared calendar', e);
		return unavailable();
	}
	// Deleted on a phone since it was shared.
	if (ics === undefined) return notFound();
	return new Response(ics, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Cache-Control': 'private, max-age=300',
			'X-Robots-Tag': 'noindex',
			'Referrer-Policy': 'no-referrer',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
