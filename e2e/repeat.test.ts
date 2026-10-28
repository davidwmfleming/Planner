import { expect, test } from './fixtures';
import { futureWeek, iso } from './dates';
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

test('a monthly item can repeat every few months, on the same weekday of the month', async ({ page }, info) => {
	const name = unique('Book club', info);
	await page.goto(`/?page=${mon}`);
	await page.locator(`#add-event-${tue}`).fill(`7pm ${name}`);
	await page.locator(`#add-event-${tue}`).press('Enter');

	const sheet = page.getByRole('dialog', { name: 'Details' });
	await page.getByRole('button', { name: `Details for ${name}` }).click();
	await sheet.locator('#f-repeat').selectOption({ label: 'Monthly' });
	const nth = Math.ceil(Number(tue.slice(8)) / 7);
	const ways = await sheet.locator('#f-way option').allTextContents();
	expect(ways[0]).toMatch(/^The \d+(st|nd|rd|th)$/);
	await sheet.locator('#f-every').fill('2');
	// The 1st to 4th Tuesday, or (a 5th) the last one.
	await sheet.locator('#f-way').selectOption({ index: 1 });
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();

	// Two months on, on the same Tuesday of that month.
	const [y, m] = tue.split('-').map(Number);
	const target = new Date(y, m + 1, 1);
	const firstTue = 1 + ((2 - target.getDay() + 7) % 7);
	const last = new Date(y, m + 2, 0).getDate();
	const day = nth <= 4 ? firstTue + (nth - 1) * 7 : firstTue + 7 * Math.floor((last - firstTue) / 7);
	const showing = iso(new Date(y, m + 1, day));
	const monday = iso(new Date(y, m + 1, day - 1));
	await page.goto(`/?page=${monday}`);
	const later = page.locator(`section.day[data-date="${showing}"] li`, { hasText: name });
	await expect(later.getByTitle('Repeats')).toBeVisible();
	// Not the month in between.
	const between = new Date(y, m, Number(tue.slice(8)));
	await page.goto(`/?page=${iso(new Date(between.getFullYear(), between.getMonth(), between.getDate() - ((between.getDay() + 6) % 7)))}`);
	await expect(page.locator('li', { hasText: name })).toHaveCount(0);

	// The sheet shows the choice again, and the ways follow the date as it changes.
	await page.goto(`/?page=${monday}`);
	await later.getByRole('button', { name: `Details for ${name}` }).click();
	await expect(sheet.locator('#f-repeat')).toHaveValue('monthly');
	await expect(sheet.locator('#f-every')).toHaveValue('2');
	await expect(sheet.locator('#f-way')).toHaveValue(ways[1].includes('last') ? 'last' : 'weekday');
	await sheet.locator('#f-date').fill(`${tue.slice(0, 8)}01`);
	await expect(sheet.locator('#f-way option').first()).toHaveText('The 1st');
	await sheet.getByRole('button', { name: 'Delete all' }).click();
	await expect(later).toHaveCount(0);
});
