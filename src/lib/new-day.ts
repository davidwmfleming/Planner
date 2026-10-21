// A page left open overnight (the tablet asleep with the planner open) moves on to the new day by itself.
import { pageStart, toISODate } from './dates';

/** Milliseconds from `now` until just after the next local midnight. The bit after leaves room for a server clock a little behind. */
export function untilMidnight(now: Date, after = 5000): number {
	const next = new Date(now);
	next.setHours(24, 0, 0, 0);
	return next.getTime() - now.getTime() + after;
}

/** Whether this device's clock says a day after the page's today has begun, so it is worth asking the server.
 * The server's answer decides; a device clock that is behind never makes the page go back. */
export const dayBegun = (now: Date, today: string) => toISODate(now) > today;

/** Asking again when the server's today hasn't moved on yet (its clock behind) or it couldn't be reached:
 * a few times a minute apart, then every ten minutes, so the page still catches up the same morning. After three
 * hours of that (this device's clock fast, or set to a zone ahead of the server's) it waits for the next midnight here. */
export const QUICK_TRIES = 5;
export const QUICK_WAIT = 60_000;
export const SLOW_WAIT = 600_000;
export const GIVE_UP_AFTER = 3 * 3600_000;
export function retryAfter(tries: number, waitedFor: number, now: Date): number {
	if (tries <= QUICK_TRIES) return QUICK_WAIT;
	return waitedFor < GIVE_UP_AFTER ? SLOW_WAIT : untilMidnight(now);
}

/** Whether a wake (or new data) may ask the server again: freely during the quick tries, then at most once per slow wait. */
export const mayAsk = (tries: number, sinceAsked: number) => tries < QUICK_TRIES || sinceAsked >= SLOW_WAIT;

interface Shown {
	today: string;
	todayPage: string;
	/** The page on screen. */
	start: string;
}

/** The page to turn to now that the server's today has moved on, or undefined to stay. Only a page that was showing
 * today, and still shows the same page (refreshed, not turned), moves on; a page flipped to on purpose stays put. */
export function pageForNewDay(before: Shown, after: Shown): string | undefined {
	if (after.today === before.today || after.start !== before.start || before.start !== before.todayPage) return undefined;
	return after.start === after.todayPage ? undefined : after.todayPage;
}

/** Whether the page shown has just turned from the old today's page to the new today's (by moving, or by a refresh of
 * an address with no page in it), so it should start at the top, as the planner does when opened. */
export const turnedToNewDay = (before: Shown, after: Shown) =>
	after.today !== before.today && after.start !== before.start && before.start === before.todayPage && after.start === after.todayPage;

/** The page to read when this device's clock says a new day has begun: for a page showing today, the page holding this
 * device's today (most likely the server's new today's page, so one read is enough); otherwise the page on screen. */
export const pageToRead = (shown: Shown, now: Date) => (shown.start === shown.todayPage ? pageStart(toISODate(now)) : shown.start);

/** An address for reading a page's data afresh. SvelteKit keeps the last page read ahead and reuses it for the same
 * address, and doesn't read the page on screen again at its own address, so each read gets an address of its own. */
export const freshAddress = (start: string, n: number) => `?page=${start}&fresh=${n}`;

/** The address to show once the page has moved on: none in it (the planner's own address) if it had none and now shows
 * today's page, as when opened; otherwise the page's. */
export const shownAddress = (hadPage: boolean, after: Shown) => (!hadPage && after.start === after.todayPage ? '' : `?page=${after.start}`);
