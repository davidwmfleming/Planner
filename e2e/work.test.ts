import { expect, test } from './fixtures';
import { futureWeek, iso } from './dates';
import { unique } from './unique';

const { tue } = futureWeek();

test('events in the Work calendar are shaded and tagged, in time order with the rest', async ({ page }) => {
	await page.goto('/');
	const events = page.locator(`section.day[data-date="${iso(new Date())}"] .col`).nth(0);
	const econ = events.locator('li.work', { hasText: 'Economic Modelling' });
	await expect(econ.getByText('Work', { exact: true })).toBeVisible();
	await expect(econ).toHaveCSS('background-color', 'rgb(253, 228, 228)');
	const rows = await events.locator('li:not(.blank)').allInnerTexts();
	expect(rows.findIndex((r) => r.includes('ADHD follow-up'))).toBeLessThan(rows.findIndex((r) => r.includes('Economic Modelling')));
});

test('choosing Work in the details sheet files an event as work, and it can still be ticked', async ({ page }, info) => {
	const name = unique('Budget briefing', info);
	await page.goto(`/?page=${tue}`);
	await page.locator(`#add-event-${tue}`).fill(`2pm ${name}`);
	await page.locator(`#add-event-${tue}`).press('Enter');
	const row = page.locator(`section.day[data-date="${tue}"] li`, { hasText: name });
	await expect(row).not.toHaveClass(/work/);

	const sheet = page.getByRole('dialog', { name: 'Details' });
	await row.getByRole('button', { name: `Details for ${name}` }).click();
	await expect(sheet.locator('#f-calendar option:checked')).toHaveText('Me');
	await sheet.locator('#f-calendar').selectOption('Work');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();
	await expect(row).toHaveClass(/work/);
	await expect(row.getByText('2:00 pm')).toBeVisible();

	await row.getByRole('button', { name: `Tick ${name}` }).click();
	await expect(row).toHaveClass(/done/);
	await row.getByRole('button', { name: `Details for ${name}` }).click();
	await expect(sheet.locator('#f-calendar option:checked')).toHaveText('Work');
});
