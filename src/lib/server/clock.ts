import { toISODate } from '$lib/dates';

/** The cookie the browser tests use to say which day it is on the server. */
export const TEST_TODAY_COOKIE = 'planner-test-today';

/** Today, by the server's clock. The browser tests can say another day with a cookie, so they can show a page
 * moving on past midnight, but only on a planner started for them (PLANNER_TEST_CLOCK=1, which compose.yaml never sets).
 * It changes what the page shows as today, never which day rollover carries tasks to. */
export function pageToday(now: Date, env: Record<string, string | undefined>, cookie: string | undefined): string {
	return env.PLANNER_TEST_CLOCK === '1' && cookie && /^\d{4}-\d{2}-\d{2}$/.test(cookie) ? cookie : toISODate(now);
}
