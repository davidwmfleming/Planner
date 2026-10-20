import { expect, test } from './fixtures';

test('the gear opens the settings, which list the calendars, the Tasks list and the categories', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

	const calendars = page.getByRole('region', { name: 'Event calendars' });
	for (const name of ['Me', 'Family', 'Workouts', 'Morgan Meals', 'Work']) {
		await expect(calendars.getByRole('listitem').filter({ hasText: new RegExp(`^${name}\\b`) })).toBeVisible();
	}
	const work = calendars.locator('li.work');
	await expect(work).toHaveCount(1);
	await expect(work).toContainText('Work');
	await expect(work).toHaveCSS('background-color', 'rgb(253, 228, 228)');
	await expect(calendars.getByText('Show as work (light red)').locator('..')).toContainText('Work');
	await expect(calendars.getByText('New events go in').locator('..')).toContainText('Me');

	const tasks = page.getByRole('region', { name: 'Task list' });
	await expect(tasks.getByRole('listitem').filter({ hasText: 'Tasks' })).toBeVisible();
	await expect(tasks).toContainText("can't be renamed or deleted");

	const categories = page.getByRole('region', { name: 'Task categories' });
	expect(await categories.getByRole('listitem').allInnerTexts()).toEqual(['This month', 'Waiting', 'Someday']);
});

test('the settings page leads back to the planner, which matters in the installed app with no browser buttons', async ({ page }) => {
	await page.goto('/settings');
	await page.getByRole('link', { name: 'Back to the planner' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('section.day').first()).toBeVisible();
});

test('the settings page fits the screen and its links are easy to hit', async ({ page }) => {
	await page.goto('/settings');
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	for (const link of await page.locator('header a').all()) {
		const box = (await link.boundingBox())!;
		expect(box.height).toBeGreaterThanOrEqual(44);
		expect(box.width).toBeGreaterThanOrEqual(44);
	}
	await page.goto('/');
	const gear = (await page.getByRole('link', { name: 'Settings' }).boundingBox())!;
	expect(gear.height).toBeGreaterThanOrEqual(44);
	expect(gear.width).toBeGreaterThanOrEqual(44);
});
