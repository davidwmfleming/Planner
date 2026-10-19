import { expect, test } from '@playwright/test';
import { unique } from './unique';

test('the details sheet edits an item and can turn an event into a task', async ({ page }, info) => {
	const name = unique('Vet', info);
	await page.goto('/?page=2026-10-19');
	const tuesday = page.locator('section.day[data-date="2026-10-20"]');
	await page.locator('#add-event-2026-10-20').fill(`2pm ${name}`);
	await page.locator('#add-event-2026-10-20').press('Enter');

	await tuesday.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await expect(sheet).toBeVisible();
	await expect(sheet.locator('#f-time')).toHaveValue('14:00');
	await sheet.locator('#f-title').fill(`${name} checkup`);
	await sheet.locator('#f-location').fill('Clinic');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();
	await expect(tuesday.getByText(`${name} checkup`)).toBeVisible();

	// Switch it to a task: it moves to the right-hand column.
	await tuesday.getByRole('button', { name: `Details for ${name} checkup` }).click();
	await sheet.getByLabel('Task').check();
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();
	await expect(tuesday.locator('.col').nth(1).getByText(`${name} checkup`)).toBeVisible();
	await expect(tuesday.locator('.col').nth(0).getByText(`${name} checkup`)).toHaveCount(0);

	// Delete it.
	await tuesday.getByRole('button', { name: `Details for ${name} checkup` }).click();
	await sheet.getByRole('button', { name: 'Delete' }).click();
	await expect(tuesday.getByText(`${name} checkup`)).toHaveCount(0);
});

test('an event without a date is refused with a clear message', async ({ page }, info) => {
	const name = unique('Concert', info);
	await page.goto('/?page=2026-10-19');
	await page.locator('#add-event-2026-10-21').fill(`7pm ${name}`);
	await page.locator('#add-event-2026-10-21').press('Enter');
	await page.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await sheet.locator('#f-date').fill('');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByRole('alert')).toContainText('An event needs a date');
	await expect(sheet).toBeVisible();
});
