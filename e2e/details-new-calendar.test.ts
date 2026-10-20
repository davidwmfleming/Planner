// A new calendar made from the details sheet follows the same name rules as the settings page,
// and a strange name gives a plain message rather than a bare 500 page.
import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';

const { tue } = futureWeek();

async function openSheetOnNewEvent(page: import('@playwright/test').Page, name: string) {
	await page.goto(`/?page=${tue}`);
	const day = page.locator(`section.day[data-date="${tue}"]`);
	await page.locator(`#add-event-${tue}`).fill(`2pm ${name}`);
	await page.locator(`#add-event-${tue}`).press('Enter');
	await day.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await expect(sheet).toBeVisible();
	return sheet;
}

test('a new calendar made from the details sheet cannot have an invisible name', async ({ page }, info) => {
	const sheet = await openSheetOnNewEvent(page, unique('Invisible', info));
	await sheet.locator('#f-calendar').selectOption('+new');
	await sheet.locator('input[name=newCalendar]').fill('\u200b\u200b');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('alert')).toContainText(/name/i);
	await page.goto('/settings');
	const names = await page.locator('section[aria-labelledby=h-calendars] li .name').allInnerTexts();
	expect(names.every((n) => n.replace(/[\u200b-\u200f\u2060\ufeff\s]/g, '') !== '')).toBe(true);
});

test('control characters in a new calendar name from the details sheet are removed, not a 500', async ({ page }, info) => {
	const sheet = await openSheetOnNewEvent(page, unique('Ctrl', info));
	await sheet.locator('#f-calendar').selectOption('+new');
	await sheet.locator('input[name=newCalendar]').fill(`Bell\u0007${info.project.name}`);
	const response = page.waitForResponse((r) => r.request().method() === 'POST');
	await sheet.getByRole('button', { name: 'Save' }).click();
	expect((await response).status()).toBeLessThan(500);
	await expect(page.getByRole('heading', { name: '500' })).toHaveCount(0);
});
