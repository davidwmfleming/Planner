import { toISODate } from '$lib/dates';

/** The cookie the browser tests use to say which day it is on the server. */
export const TEST_TODAY_COOKIE = 'planner-test-today';

let warned = false;

/** Whether this planner was started for the browser tests (PLANNER_TEST_CLOCK=1, which compose.yaml never sets).
 * Never on a production build's server (NODE_ENV=production, as the Dockerfile sets): there it is ignored, said once in the log. */
export function testClockOn(env: Record<string, string | undefined>, log: (message: string) => void = console.warn): boolean {
	if (env.PLANNER_TEST_CLOCK !== '1') return false;
	if (env.NODE_ENV !== 'production') return true;
	if (!warned) log('Planner: PLANNER_TEST_CLOCK is for the browser tests only, so it is ignored here (NODE_ENV=production).');
	warned = true;
	return false;
}

/** Today, by the server's clock. The browser tests can say another day with a cookie, so they can show a page
 * moving on past midnight, but only on a planner started for them (see testClockOn).
 * It changes what the page shows as today, never which day rollover carries tasks to. */
export function pageToday(now: Date, env: Record<string, string | undefined>, cookie: string | undefined): string {
	return testClockOn(env) && cookie && /^\d{4}-\d{2}-\d{2}$/.test(cookie) ? cookie : toISODate(now);
}
