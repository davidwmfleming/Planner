// A page left open overnight (the tablet asleep with the planner open) moves on to the new day by itself.
import { toISODate } from './dates';

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
 * a few times a minute apart, then every ten minutes, so the page still catches up the same morning. */
export const QUICK_TRIES = 5;
export const QUICK_WAIT = 60_000;
export const SLOW_WAIT = 600_000;
export const retryAfter = (tries: number) => (tries <= QUICK_TRIES ? QUICK_WAIT : SLOW_WAIT);

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

/** Where SvelteKit reads a page's data from: the page's own path and query, asked for as data. */
export const dataAddress = (pathname: string, search: string) => `${pathname.replace(/\/$/, '')}/__data.json${search}`;

/** Whether a page's data came back whole. A load that failed (the calendar server down) still answers 200, with an error in it. */
export function dataAnswered(status: number, body: string): boolean {
	if (status !== 200) return false;
	try {
		const answer = JSON.parse(body.split('\n')[0]);
		return answer?.type === 'data' && Array.isArray(answer.nodes) && !answer.nodes.some((n: { type?: string } | null) => n?.type === 'error');
	} catch {
		return false;
	}
}
