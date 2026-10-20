import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';

const { wed } = futureWeek();

test('the starting calendars are offered, and a new one can be made from the details sheet', async ({ page }, info) => {
	const name = unique('Piano lesson', info);
	const calendar = unique('Lessons', info).slice(0, 40);
	await page.goto(`/?page=${wed}`);
	await page.locator(`#add-event-${wed}`).fill(`4pm ${name}`);
	await page.locator(`#add-event-${wed}`).press('Enter');
	const row = page.locator(`section.day[data-date="${wed}"] li`, { hasText: name });
	await expect(row).toBeVisible();

	const sheet = page.getByRole('dialog', { name: 'Details' });
	await row.getByRole('button', { name: `Details for ${name}` }).click();
	const choices = await sheet.locator('#f-calendar option').allInnerTexts();
	expect(choices).toEqual(expect.arrayContaining(['Me', 'Family', 'Workouts', 'Morgan Meals', 'Work', 'New calendar…']));
	await expect(sheet.locator('#f-new-calendar')).toHaveCount(0);

	await sheet.locator('#f-calendar').selectOption('+new');
	await sheet.locator('#f-new-calendar').fill(calendar);
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();

	await row.getByRole('button', { name: `Details for ${name}` }).click();
	await expect(sheet.locator('#f-calendar option:checked')).toHaveText(calendar);
});
