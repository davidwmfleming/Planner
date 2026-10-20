// A page left open overnight (the tablet asleep with the planner open) moves on to the new day by itself.
// The browser's clock is faked; the server's today is set with a cookie the test planner accepts (PLANNER_TEST_CLOCK=1).
// The days are far ahead, so nothing here meets other tests' entries, and rollover (which goes by the real clock) leaves them be.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { iso } from './dates';
import { unique } from './unique';

const MON = '2031-01-13';
const WED = '2031-01-15';
const THU = '2031-01-16';
const LAST_THU = '2031-01-09';
const addDays = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
const at = (hours: number, minutes: number, day = 15) => new Date(2031, 0, day, hours, minutes);

async function serverDay(page: Page, day: string) {
	await page.context().addCookies([{ name: 'planner-test-today', value: day, url: test.info().project.use.baseURL! }]);
}
const todayTag = (page: Page, day: string) => page.locator(`section.day[data-date="${day}"] .today-tag`);

for (const address of ['/', `/?page=${MON}`]) {
	test(`a page left open on Wednesday turns to the Thu–Sun page after midnight (${address})`, async ({ page }) => {
		await serverDay(page, WED);
		await page.clock.install({ time: at(23, 59) });
		await page.goto(address);
		await expect(todayTag(page, WED)).toBeVisible();
		// Scrolled down to Wednesday, as a phone would be.
		await todayTag(page, WED).evaluate((tag) => tag.closest('section')!.scrollIntoView());
		expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);

		await serverDay(page, THU);
		await page.clock.runFor('01:10');
		await expect(todayTag(page, THU)).toBeVisible();
		// The new page starts at the top, as when the planner is opened.
		await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
		await expect(page.locator(`section.day[data-date="${WED}"]`)).toHaveCount(0);
		if (address !== '/') await expect(page).toHaveURL(new RegExp(`\\?page=${THU}$`));
	});
}

test('a page woken the next morning turns to the new day', async ({ page }) => {
	await serverDay(page, WED);
	await page.clock.install({ time: at(21, 0) });
	await page.goto('/');
	await expect(todayTag(page, WED)).toBeVisible();

	// Asleep overnight: the clock jumps on, but the midnight timer hasn't run.
	await serverDay(page, THU);
	await page.clock.setSystemTime(at(7, 0, 16));
	await expect(todayTag(page, WED)).toBeVisible();
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(todayTag(page, THU)).toBeVisible();
});

test('a page flipped to on purpose stays put after midnight, but is refreshed', async ({ page }) => {
	await serverDay(page, WED);
	await page.clock.install({ time: at(23, 59) });
	await page.goto(`/?page=${LAST_THU}`);
	const todayLink = page.getByRole('link', { name: 'Today', exact: true });
	await expect(todayLink).toHaveAttribute('href', `?page=${MON}`);
	await page.locator(`section.day[data-date="${addDays(LAST_THU, 2)}"]`).evaluate((day) => day.scrollIntoView());
	const scrolled = await page.evaluate(() => scrollY);
	expect(scrolled).toBeGreaterThan(0);

	await serverDay(page, THU);
	await page.clock.runFor('01:10');
	await expect(todayLink).toHaveAttribute('href', `?page=${THU}`);
	await expect(page).toHaveURL(new RegExp(`\\?page=${LAST_THU}$`));
	await expect(page.locator(`section.day[data-date="${LAST_THU}"]`)).toBeAttached();
	expect(await page.evaluate(() => scrollY)).toBe(scrolled);
});

test('a line half written at midnight is not lost: the page waits until it is saved', async ({ page }, info) => {
	const title = unique('Late night list', info);
	await serverDay(page, WED);
	await page.clock.install({ time: at(23, 59) });
	// Opened at today's page by its address, so saving the line redraws the same page and the move is left to the planner.
	await page.goto(`/?page=${MON}`);
	const line = page.locator(`#add-task-${WED}`);
	await line.fill(title);

	await serverDay(page, THU);
	await page.clock.runFor('01:10');
	await expect(line).toHaveValue(title);
	await expect(todayTag(page, WED)).toBeVisible();
	const note = page.getByRole('status');
	await expect(note).toHaveText("It's now Thursday. The page turns once this line is saved or cleared.");

	await line.press('Enter');
	await expect(page.locator(`section.day[data-date="${WED}"]`).getByText(title)).toBeVisible();
	await page.clock.runFor('00:15');
	await expect(todayTag(page, THU)).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`\\?page=${THU}$`));
	await expect(note).toHaveCount(0);

	await page.goto(`/?page=${MON}`);
	await expect(page.locator(`section.day[data-date="${WED}"]`).getByText(title)).toBeVisible();
});

test('woken before the network is back: the planner stays on screen, then moves on once it is', async ({ page, context }) => {
	await serverDay(page, WED);
	await page.clock.install({ time: at(21, 0) });
	await page.goto('/');
	await serverDay(page, THU);
	await page.clock.setSystemTime(at(7, 0, 16));
	await context.setOffline(true);
	const tried = page.waitForEvent('requestfailed', (r) => r.url().includes('__data.json'));
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await tried;
	await expect(todayTag(page, WED)).toBeVisible();

	await context.setOffline(false);
	await page.clock.runFor('01:05');
	await expect(todayTag(page, THU)).toBeVisible();
});

test('calendar server down at midnight: the planner stays on screen, then moves on once it answers', async ({ page }) => {
	await serverDay(page, WED);
	await page.clock.install({ time: at(23, 59) });
	await page.goto(`/?page=${MON}`);
	// What the planner's server sends when the calendar server is down as the page is read.
	const message = "The calendar server isn't answering. Check that it is running, then reload.";
	const down = { type: 'data', nodes: [{ type: 'skip' }, { type: 'error', error: { message }, status: 503 }] };
	let asked = 0;
	await page.route('**/__data.json**', (r) => (asked++, r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(down) })));
	await serverDay(page, THU);
	await page.clock.runFor('01:10');
	await expect.poll(() => asked).toBeGreaterThan(0);
	await expect(todayTag(page, WED)).toBeVisible();
	await expect(page.getByText(message)).toHaveCount(0);

	await page.unroute('**/__data.json**');
	await page.clock.runFor('01:05');
	await expect(todayTag(page, THU)).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`\\?page=${THU}$`));
});

/** Runs the page's clock on a step at a time until `done`, so a check waiting on the network can set its next timer. */
async function runUntil(page: Page, step: number, done: () => boolean | Promise<boolean>) {
	await expect.poll(async () => (await done()) || (await page.clock.runFor(step), false), { intervals: [50], timeout: 30_000 }).toBe(true);
}

test('a server clock well behind: the page keeps asking every ten minutes, and wakes meanwhile ask no more often', async ({ page }) => {
	// Over half an hour of the page's time, a step at a time: slower than the others on a busy machine.
	test.setTimeout(90_000);
	await serverDay(page, WED);
	await page.clock.install({ time: at(23, 59) });
	await page.goto('/');
	// The planner's own checks (a refresh that follows one asks with x-sveltekit-invalidated), and when each was.
	const asked: number[] = [];
	page.on('request', async (r) => {
		if (r.url().includes('__data.json') && !r.url().includes('x-sveltekit-invalidated')) asked.push(await page.evaluate(() => Date.now()));
	});
	// Past midnight here, but the server still says Wednesday: it asks, then five more times a minute apart
	// (a little more here, as the clock runs on in steps while a check waits on the network; well short of ten minutes).
	await runUntil(page, 5000, () => asked.length === 6);
	await expect(todayTag(page, WED)).toBeVisible();
	const gaps = asked.slice(1).map((t, i) => t - asked[i]);
	expect(gaps.every((g) => g >= 60_000 && g < 600_000)).toBe(true);

	// Then only every ten minutes: waking the screen meanwhile asks nothing.
	for (let i = 0; i < 3; i++) await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await runUntil(page, 10_000, async () => (await page.evaluate(() => Date.now())) - asked[5] > 5 * 60_000);
	expect(asked).toHaveLength(6);

	// The server reaches Thursday; the next ten-minute try finds it.
	await serverDay(page, THU);
	await runUntil(page, 10_000, () => todayTag(page, THU).isVisible());
	expect(asked).toHaveLength(7);
	expect(asked[6] - asked[5]).toBeGreaterThanOrEqual(600_000);
});
