import { expect, test } from './fixtures';
import { unique } from './unique';

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

test('a calendar can be added from the settings page, and bad names are explained on the page', async ({ page }, info) => {
	const name = unique('Piano', info);
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	const field = calendars.getByLabel('New calendar');
	const add = calendars.getByRole('button', { name: 'Add calendar' });

	await add.click();
	await expect(calendars.getByRole('alert')).toHaveText('Give the calendar a name');
	await field.fill('family');
	await add.click();
	await expect(calendars.getByRole('alert')).toHaveText('There is already a calendar called "Family"');
	await field.fill('x'.repeat(41));
	await add.click();
	await expect(calendars.getByRole('alert')).toHaveText('Keep the name to 40 letters or fewer');

	await field.fill(name);
	await add.click();
	await expect(calendars.getByRole('listitem').filter({ hasText: name })).toBeVisible();
	await expect(calendars.getByRole('alert')).toHaveCount(0);
	await expect(field).toHaveValue('');

	await page.reload();
	await expect(calendars.getByRole('listitem').filter({ hasText: name })).toBeVisible();
});

test('a calendar can be renamed on the settings page; the Tasks list cannot', async ({ page }, info) => {
	const before = unique('Swim', info);
	const after = unique('Swimming', info);
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByLabel('New calendar').fill(before);
	await calendars.getByRole('button', { name: 'Add calendar' }).click();
	const row = calendars.getByRole('listitem').filter({ hasText: before });
	await expect(row).toBeVisible();

	// Cancel leaves it as it was.
	await row.getByRole('button', { name: `Rename ${before}` }).click();
	const field = calendars.getByLabel(`New name for ${before}`);
	await expect(field).toHaveValue(before);
	await field.fill('Something else');
	await calendars.getByRole('button', { name: 'Cancel' }).click();
	await expect(calendars.getByText(before, { exact: true })).toBeVisible();

	await calendars.getByRole('button', { name: `Rename ${before}` }).click();
	await field.fill('ME');
	await calendars.getByRole('button', { name: 'Save name' }).click();
	await expect(calendars.getByRole('alert')).toHaveText('There is already a calendar called "Me"');
	await expect(field).toBeVisible();

	await field.fill(after);
	await calendars.getByRole('button', { name: 'Save name' }).click();
	await expect(calendars.getByText(after, { exact: true })).toBeVisible();
	await expect(calendars.getByText(before, { exact: true })).toHaveCount(0);
	await expect(calendars.getByRole('alert')).toHaveCount(0);

	await page.reload();
	await expect(calendars.getByText(after, { exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Task list' }).getByRole('button')).toHaveCount(0);
});

test('the add and rename controls are easy to hit on a phone', async ({ page }) => {
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	for (const control of [calendars.getByLabel('New calendar'), calendars.getByRole('button', { name: 'Add calendar' }), calendars.getByRole('button', { name: 'Rename Me' })]) {
		const box = (await control.boundingBox())!;
		expect(box.height).toBeGreaterThanOrEqual(44);
		expect(box.width).toBeGreaterThanOrEqual(44);
	}
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});
