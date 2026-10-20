// These change which calendar is Work and where new events go, which every page shows,
// so playwright.config.ts runs this file on its own, after all the other tests.
import { expect, test } from './fixtures';
import { futureWeek, iso } from './dates';
import { unique } from './unique';
import type { Page } from '@playwright/test';

const { wed: day } = futureWeek();

async function choose(page: Page, choices: { work?: string; newEvents?: string }) {
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	if (choices.work) await calendars.getByLabel('Show as work (light red)').selectOption({ label: choices.work });
	if (choices.newEvents) await calendars.getByLabel('New events go in').selectOption({ label: choices.newEvents });
	await calendars.getByRole('button', { name: 'Save choices' }).click();
	await expect(calendars.getByRole('status')).toHaveText('Saved');
}

async function addCalendar(page: Page, name: string) {
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByLabel('New calendar').fill(name);
	await calendars.getByRole('button', { name: 'Add calendar' }).click();
	await expect(calendars.getByRole('list').getByText(name, { exact: true })).toBeVisible();
}

// Whatever happens, the next tests start with the usual choices.
test.afterEach(async ({ page }) => {
	await choose(page, { work: 'Work', newEvents: 'Me' });
});

test('the Work shading follows the calendar chosen on the settings page, through a rename', async ({ page }, info) => {
	const office = unique('Office', info);
	const renamed = unique('Day job', info);
	const meeting = unique('Board meeting', info);
	await addCalendar(page, office);
	await choose(page, { work: office });
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await expect(calendars.locator('li.work')).toHaveCount(1);
	await expect(calendars.locator('li.work')).toContainText(office);
	await expect(calendars.getByLabel('Show as work (light red)').locator('option:checked')).toHaveText(office);

	// An event filed in it is shaded; the old Work calendar's meetings are not.
	await page.goto(`/?page=${day}`);
	await page.locator(`#add-event-${day}`).fill(`10am ${meeting}`);
	await page.locator(`#add-event-${day}`).press('Enter');
	const row = page.locator(`section.day[data-date="${day}"] li`, { hasText: meeting });
	await row.getByRole('button', { name: `Details for ${meeting}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await sheet.locator('#f-calendar').selectOption(office);
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(row).toHaveClass(/work/);
	await expect(row).toHaveCSS('background-color', 'rgb(253, 228, 228)');
	await page.goto('/');
	await expect(page.locator('li', { hasText: 'Economic Modelling' })).not.toHaveClass(/work/);

	// Renamed, it is still the Work calendar.
	await page.goto('/settings');
	await calendars.getByRole('button', { name: `Rename ${office}` }).click();
	await calendars.getByLabel(`New name for ${office}`).fill(renamed);
	await calendars.getByRole('button', { name: 'Save name' }).click();
	await expect(calendars.locator('li.work')).toContainText(renamed);
	await expect(calendars.getByLabel('Show as work (light red)').locator('option:checked')).toHaveText(renamed);
	await page.goto(`/?page=${day}`);
	await expect(row).toHaveClass(/work/);
});

test('no calendar can be shaded as work', async ({ page }) => {
	await choose(page, { work: 'None' });
	await expect(page.getByRole('region', { name: 'Event calendars' }).locator('li.work')).toHaveCount(0);
	await page.goto('/');
	await expect(page.locator(`section.day[data-date="${iso(new Date())}"] li`, { hasText: 'Economic Modelling' })).not.toHaveClass(/work/);
});

test('new events go in the calendar chosen on the settings page', async ({ page }, info) => {
	const name = unique('Swim lesson', info);
	await choose(page, { newEvents: 'Family' });
	await expect(page.getByRole('region', { name: 'Event calendars' }).getByRole('listitem').filter({ hasText: 'New events' })).toContainText('Family');

	await page.goto(`/?page=${day}`);
	await page.locator(`#add-event-${day}`).fill(`5pm ${name}`);
	await page.locator(`#add-event-${day}`).press('Enter');
	const row = page.locator(`section.day[data-date="${day}"] li`, { hasText: name });
	await row.getByRole('button', { name: `Details for ${name}` }).click();
	await expect(page.getByRole('dialog', { name: 'Details' }).locator('#f-calendar')).toHaveValue('Family');
});
