import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';

const { mon, tue, wed } = futureWeek();

test('the details sheet edits an item and can turn an event into a task', async ({ page }, info) => {
	const name = unique('Vet', info);
	await page.goto(`/?page=${mon}`);
	const tuesday = page.locator(`section.day[data-date="${tue}"]`);
	await page.locator(`#add-event-${tue}`).fill(`2pm ${name}`);
	await page.locator(`#add-event-${tue}`).press('Enter');

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
	await page.goto(`/?page=${mon}`);
	await page.locator(`#add-event-${wed}`).fill(`7pm ${name}`);
	await page.locator(`#add-event-${wed}`).press('Enter');
	await page.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await sheet.locator('#f-date').fill('');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByRole('alert')).toContainText('An event needs a date');
	await expect(sheet).toBeVisible();
});

test('a double tap on Save in the details sheet sends the change once', async ({ page }, info) => {
	const name = unique('Double save', info);
	await page.goto(`/?page=${mon}`);
	await page.locator(`#add-event-${tue}`).fill(`9am ${name}`);
	await page.locator(`#add-event-${tue}`).press('Enter');
	await page.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await sheet.locator('#f-location').fill('Clinic');
	let sent = 0;
	// A slow connection: the second tap lands while the first is still saving.
	await page.route('**/*&/save', async (r) => {
		sent++;
		await new Promise((done) => setTimeout(done, 600));
		await r.continue();
	});
	const save = sheet.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	await save.click({ force: true }).catch(() => {});
	await expect(sheet).toBeHidden();
	await page.waitForTimeout(800);
	expect(sent).toBe(1);
});
