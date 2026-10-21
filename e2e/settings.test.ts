import { expect, test } from './fixtures';
import { unique } from './unique';
import { deleteCalendar, makeCalendar } from './calendar-server';

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
	await expect(calendars.getByLabel('Show as work (light red)').locator('option:checked')).toHaveText('Work');
	await expect(calendars.getByLabel('New events go in').locator('option:checked')).toHaveText('Me');

	const tasks = page.getByRole('region', { name: 'Task list' });
	await expect(tasks.getByRole('listitem').filter({ hasText: 'Tasks' })).toBeVisible();
	await expect(tasks).toContainText("can't be renamed or deleted");

	const categories = page.getByRole('region', { name: 'Task categories' });
	expect(await categories.getByRole('listitem').locator('.name').allInnerTexts()).toEqual(['This month', 'Waiting', 'Someday']);
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
	await expect(calendars.getByRole('list').getByText(before, { exact: true })).toBeVisible();

	await calendars.getByRole('button', { name: `Rename ${before}` }).click();
	await field.fill('ME');
	await calendars.getByRole('button', { name: 'Save name' }).click();
	await expect(calendars.getByRole('alert')).toHaveText('There is already a calendar called "Me"');
	await expect(field).toBeVisible();

	await field.fill(after);
	await calendars.getByRole('button', { name: 'Save name' }).click();
	await expect(calendars.getByRole('list').getByText(after, { exact: true })).toBeVisible();
	await expect(calendars.getByRole('list').getByText(before, { exact: true })).toHaveCount(0);
	await expect(calendars.getByRole('alert')).toHaveCount(0);

	await page.reload();
	await expect(calendars.getByRole('list').getByText(after, { exact: true })).toBeVisible();
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

test('a 40-letter calendar name does not make the settings page scroll sideways', async ({ page }, info) => {
	const name = unique('Morgan', info).padEnd(40, 'W').slice(0, 40);
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByLabel('New calendar').fill(name);
	await calendars.getByRole('button', { name: 'Add calendar' }).click();
	await expect(calendars.getByRole('list').getByText(name, { exact: true })).toBeVisible();
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 640 });
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, `at ${width}px`).toBe(0);
	}
});

test('after adding or renaming, the keyboard lands somewhere sensible and the change is announced', async ({ page }, info) => {
	const name = unique('Focus', info);
	const renamed = unique('Focused', info);
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	const announced = page.getByRole('status').filter({ hasText: /^(Added|Renamed)/ });

	// Added: ready for the next one.
	await calendars.getByLabel('New calendar').fill(name);
	await calendars.getByRole('button', { name: 'Add calendar' }).click();
	await expect(calendars.getByLabel('New calendar')).toBeFocused();
	await expect(announced).toHaveText(`Added ${name}`);

	// Cancel and Escape put the keyboard back on the Rename button.
	const rename = calendars.getByRole('button', { name: `Rename ${name}` });
	await rename.click();
	await calendars.getByRole('button', { name: 'Cancel' }).click();
	await expect(rename).toBeFocused();
	await rename.click();
	await calendars.getByLabel(`New name for ${name}`).fill('Not this');
	await calendars.getByLabel(`New name for ${name}`).press('Escape');
	await expect(calendars.getByLabel(`New name for ${name}`)).toHaveCount(0);
	await expect(rename).toBeFocused();
	await expect(calendars.getByRole('list').getByText(name, { exact: true })).toBeVisible();

	// Renamed: back on that calendar's Rename button.
	await rename.click();
	await calendars.getByLabel(`New name for ${name}`).fill(renamed);
	await calendars.getByLabel(`New name for ${name}`).press('Enter');
	await expect(calendars.getByRole('button', { name: `Rename ${renamed}` })).toBeFocused();
	await expect(announced).toHaveText(`Renamed ${name} to ${renamed}`);
});

test('calendars are listed by name, and a notes-only calendar from another app is left out', async ({ page, request }, info) => {
	const notes = unique('Journal', info);
	const path = await makeCalendar(request, `journal-${info.project.name}-${Date.now()}`, notes, ['VJOURNAL']);
	try {
		await page.goto('/settings');
		const names = await page.getByRole('region', { name: 'Event calendars' }).locator('.lines .name').allInnerTexts();
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })));
		await expect(page.getByText(notes)).toHaveCount(0);
	} finally {
		await deleteCalendar(request, path);
	}
});

test('a name of only invisible characters is refused', async ({ page }) => {
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByLabel('New calendar').fill('\u200b\u200b');
	await calendars.getByRole('button', { name: 'Add calendar' }).click();
	await expect(calendars.getByRole('alert')).toHaveText('Give the calendar a name');
});

test('two calendars with the same name are told apart in the list, Rename buttons included', async ({ page, request }, info) => {
	const name = unique('Twin', info);
	const tag = Math.random().toString(36).slice(2, 6);
	const paths = [await makeCalendar(request, `twin-${tag}-a`, name), await makeCalendar(request, `twin-${tag}-b`, name)];
	try {
		await page.goto('/settings');
		const calendars = page.getByRole('region', { name: 'Event calendars' });
		await expect(calendars.getByRole('listitem').filter({ hasText: `${name} (twin-${tag}-a)` })).toBeVisible();
		await expect(calendars.getByRole('listitem').filter({ hasText: `${name} (twin-${tag}-b)` })).toBeVisible();
		await expect(calendars.getByRole('button', { name: `Rename ${name} (twin-${tag}-a)`, exact: true })).toBeVisible();
		await calendars.getByRole('button', { name: `Rename ${name} (twin-${tag}-b)`, exact: true }).click();
		// The name field holds the plain name, which is what gets changed.
		await expect(calendars.getByRole('textbox', { name: `New name for ${name} (twin-${tag}-b)` })).toHaveValue(name);
	} finally {
		for (const path of paths) await deleteCalendar(request, path);
	}
});

// A calendar really deleted on another device while Settings is open (not a staged answer): renaming it should say
// to reload, with a Reload button. At e90755a it says "Try again in a moment", which can never work.
test('renaming a calendar deleted on another device says to reload, with a Reload button', async ({ page, request }, info) => {
	const name = unique('Gone soon', info);
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	const path = await makeCalendar(request, slug, name);
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await deleteCalendar(request, path);
	await calendars.getByRole('button', { name: `Rename ${name}` }).click();
	await page.locator('#rename-field').fill(`${name} 2`);
	await calendars.getByRole('button', { name: 'Save name' }).click();
	await expect(calendars.getByRole('alert')).toContainText(/reload/i);
	await expect(calendars.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
});
