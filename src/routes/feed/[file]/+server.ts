// A shared calendar link: the calendar as one .ics file, read-only, for a computer that isn't on David's Tailscale.
// Reached from the internet through Tailscale Funnel (see "Shared calendar links" in docs/design.md).
import { env } from '$env/dynamic/private';
import { calendarAtPath } from '$lib/settings';
import { calendarFor, secretIn } from '$lib/server/feeds';
import { getFeeds, getStore } from '$lib/server/store';
import type { RequestHandler } from './$types';

// The same plain answer for a wrong, cancelled or badly written link, so none of them says which it was.
const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const unavailable = () => new Response('Try again later', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300' } });

/** After the calendar server fails, requests wait this long before it is asked again, so traffic from the internet
 * can't keep poking it or fill the log; the failure is logged once, not once per request. */
const RESTING_MS = 10_000;
let restingUntil = 0;
function failed(what: string, e: unknown) {
	if (Date.now() >= restingUntil) console.error(`Shared link: ${what}`, e);
	restingUntil = Date.now() + RESTING_MS;
}

/** Each shared calendar's file, kept a minute, so a link that leaked can't make the calendar server do much work. */
const KEPT_MS = 60_000;
const kept = new Map<string, { at: number; ics: string | undefined }>();

/** Only events (and their time zones) are handed out: a calendar made elsewhere may hold tasks too. A task's
 * reminders (VALARM) end before it does, so each task is cut from its BEGIN line to its own END line. */
const eventsOnly = (ics: string) => ics.replace(/^BEGIN:VTODO\r?\n[\s\S]*?^END:VTODO\r?\n?/gim, '');

/** The planner writes times without a time zone (floating, in David's time); this tells Google and Outlook which
 * zone those are in, so they show at the right hour. Times with their own zone are unaffected. */
function inHouseZone(ics: string): string {
	const zone = env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (!zone || !/^[A-Za-z_+\-/0-9]+$/.test(zone) || /^X-WR-TIMEZONE[:;]/im.test(ics)) return ics;
	return ics.replace(/^BEGIN:VCALENDAR\r?\n/i, (begin) => `${begin}X-WR-TIMEZONE:${zone}\r\n`);
}

export const GET: RequestHandler = async ({ params }) => {
	const secret = secretIn(`/feed/${params.file}`);
	// Sharing turned off on this server (no public address): links made earlier don't work either.
	if (!secret || !env.FEED_ORIGIN) return notFound();
	if (Date.now() < restingUntil) return unavailable();
	let store, feeds;
	try {
		store = await getStore();
		feeds = await getFeeds(store);
	} catch (e) {
		failed('could not read the shared links', e);
		return unavailable();
	}
	const path = calendarFor(feeds, secret);
	const calendar = path ? calendarAtPath(store.calendars().filter((c) => c.accepts.includes('event')), path) : undefined;
	if (!calendar) return notFound();
	let ics = kept.get(calendar.url);
	if (!ics || Date.now() - ics.at > KEPT_MS) {
		try {
			const file = await store.calendarFile(calendar.url);
			ics = { at: Date.now(), ics: file === undefined ? undefined : inHouseZone(eventsOnly(file)) };
		} catch (e) {
			failed('the calendar server did not hand out a shared calendar', e);
			return unavailable();
		}
		kept.set(calendar.url, ics);
	}
	// Deleted on a phone since it was shared.
	if (ics.ics === undefined) return notFound();
	return new Response(ics.ics, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Cache-Control': 'private, max-age=300',
			'X-Robots-Tag': 'noindex',
			'Referrer-Policy': 'no-referrer',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
