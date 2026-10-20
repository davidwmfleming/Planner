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
