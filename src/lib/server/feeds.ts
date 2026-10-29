// Shared calendar links: a secret address per calendar that hands out the calendar, read-only, to a computer that
// isn't on David's Tailscale. See "Shared calendar links" in docs/design.md.
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Calendar path → secret. */
export type Feeds = Record<string, string>;

const SECRET = /^[A-Za-z0-9_-]{43}$/;
/** The only address a request that came through Tailscale Funnel may reach. */
const FEED_PATH = /^\/feed\/([A-Za-z0-9_-]{43})\.ics$/;
/** Most links kept from the stored value; any calendar app can change it, so it isn't trusted to be small. */
const MOST_FEEDS = 200;

export const newSecret = () => randomBytes(32).toString('base64url');

/** Reads the stored value. Anything damaged is left out, so a bad value never stops the planner. */
export function parseFeeds(raw: string | undefined): Feeds {
	let stored: unknown;
	try {
		stored = raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
	const feeds: Feeds = {};
	for (const [path, secret] of Object.entries(stored).slice(0, MOST_FEEDS)) {
		if (path.startsWith('/') && typeof secret === 'string' && SECRET.test(secret)) feeds[path] = secret;
	}
	return feeds;
}

/** The secret in a feed address, if the address is exactly /feed/<secret>.ics. */
export const secretIn = (pathname: string) => FEED_PATH.exec(pathname)?.[1];

/** The calendar a secret opens. Every stored secret is compared, in constant time, so the answer's timing doesn't
 * say how much of a guess was right. */
export function calendarFor(feeds: Feeds, secret: string): string | undefined {
	const asked = Buffer.from(secret);
	let found: string | undefined;
	for (const [path, stored] of Object.entries(feeds)) {
		const known = Buffer.from(stored);
		if (known.length === asked.length && timingSafeEqual(known, asked)) found = path;
	}
	return found;
}

/** Whether a request came in through Tailscale Funnel, from the internet; it may reach only a feed address. */
export const fromInternet = (headers: Headers) => headers.has('tailscale-funnel-request');

/** A feed's public address, or undefined when the server has no public address set (FEED_ORIGIN). */
export function feedUrl(origin: string | undefined, secret: string): string | undefined {
	if (!origin) return undefined;
	try {
		return new URL(`/feed/${secret}.ics`, origin).href;
	} catch {
		return undefined;
	}
}
