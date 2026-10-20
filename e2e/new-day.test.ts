// A page left open overnight (the tablet asleep with the planner open) moves on to the new day by itself.
// The browser's clock is faked; the server's today is set with a cookie the test planner accepts (PLANNER_TEST_CLOCK=1).
// The days are far ahead, so nothing here meets other tests' entries, and rollover (which goes by the real clock) leaves them be.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { unique } from './unique';

const MON = '2031-01-13';
const WED = '2031-01-15';
const THU = '2031-01-16';
const LAST_THU = '2031-01-09';
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

		await serverDay(page, THU);
		await page.clock.runFor('01:10');
		await expect(todayTag(page, THU)).toBeVisible();
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

	await serverDay(page, THU);
	await page.clock.runFor('01:10');
	await expect(todayLink).toHaveAttribute('href', `?page=${THU}`);
	await expect(page).toHaveURL(new RegExp(`\\?page=${LAST_THU}$`));
	await expect(page.locator(`section.day[data-date="${LAST_THU}"]`)).toBeVisible();
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

	await line.press('Enter');
	await expect(page.locator(`section.day[data-date="${WED}"]`).getByText(title)).toBeVisible();
	await page.clock.runFor('00:15');
	await expect(todayTag(page, THU)).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`\\?page=${THU}$`));

	await page.goto(`/?page=${MON}`);
	await expect(page.locator(`section.day[data-date="${WED}"]`).getByText(title)).toBeVisible();
});
