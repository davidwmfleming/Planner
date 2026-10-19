import { expect, test } from '@playwright/test';
import { futureWeek } from './dates';
import { unique } from './unique';

const { mon, tue, nextMon, nextTue } = futureWeek();

test('an item set to repeat weekly shows every week; one day can be ticked or removed on its own', async ({ page }, info) => {
	const name = unique('Piano lesson', info);
	await page.goto(`/?page=${mon}`);
	await page.locator(`#add-event-${tue}`).fill(`4pm ${name}`);
	await page.locator(`#add-event-${tue}`).press('Enter');

	const sheet = page.getByRole('dialog', { name: 'Details' });
	await page.getByRole('button', { name: `Details for ${name}` }).click();
	await sheet.locator('#f-repeat').selectOption({ label: 'Every week' });
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();
	const thisWeek = page.locator(`section.day[data-date="${tue}"] li`, { hasText: name });
	await expect(thisWeek.getByTitle('Repeats')).toBeVisible();

	await page.goto(`/?page=${nextMon}`);
	const nextWeek = page.locator(`section.day[data-date="${nextTue}"] li`, { hasText: name });
	await expect(nextWeek.getByText('4:00 pm')).toBeVisible();

	// Ticking next week's lesson leaves this week's open.
	await nextWeek.getByRole('button', { name: `Tick ${name}` }).click();
	await expect(nextWeek).toHaveClass(/done/);
	await page.goto(`/?page=${mon}`);
	await expect(thisWeek).toHaveClass(/open/);

	// The sheet shows when the series starts, and can remove just this week.
	await thisWeek.getByRole('button', { name: `Details for ${name}` }).click();
	await expect(sheet.locator('#f-date')).toHaveValue(tue);
	await sheet.getByRole('button', { name: 'Delete this day' }).click();
	await expect(thisWeek).toHaveCount(0);
	await page.goto(`/?page=${nextMon}`);
	await expect(nextWeek).toBeVisible();

	// Delete all removes the whole series.
	await nextWeek.getByRole('button', { name: `Details for ${name}` }).click();
	await sheet.getByRole('button', { name: 'Delete all' }).click();
	await expect(nextWeek).toHaveCount(0);
});
