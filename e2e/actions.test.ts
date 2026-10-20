import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';

const { mon, tue } = futureWeek();

test('tick, drop and move a task with one tap each', async ({ page }, info) => {
	const name = unique('Water plants', info);
	await page.goto(`/?page=${mon}`);
	const monday = page.locator(`section.day[data-date="${mon}"]`);
	const tuesday = page.locator(`section.day[data-date="${tue}"]`);
	const line = page.locator(`#add-task-${mon}`);
	await line.fill(name);
	await line.press('Enter');
	const row = monday.locator('li', { hasText: name });
	await expect(row).toBeVisible();

	await row.getByRole('button', { name: `Tick ${name}` }).click();
	await expect(row).toHaveClass(/done/);
	await row.getByRole('button', { name: `Untick ${name}` }).click();
	await expect(row).toHaveClass(/open/);

	await row.getByRole('button', { name: `Drop ${name}` }).click();
	await expect(row).toHaveClass(/dropped/);
	await row.getByRole('button', { name: `Restore ${name}` }).click();
	await expect(row).toHaveClass(/open/);

	await row.getByRole('button', { name: `Move ${name} to the next day` }).click();
	await expect(monday.getByText(name)).toHaveCount(0);
	await expect(tuesday.getByText(name)).toBeVisible();
});

test('an event can be ticked or dropped but not moved with the arrow', async ({ page }, info) => {
	const name = unique('Haircut', info);
	await page.goto(`/?page=${mon}`);
	const line = page.locator(`#add-event-${mon}`);
	await line.fill(`10am ${name}`);
	await line.press('Enter');
	const row = page.locator(`section.day[data-date="${mon}"] li`, { hasText: name });
	await expect(row.getByRole('button', { name: `Tick ${name}` })).toBeVisible();
	await expect(row.getByRole('button', { name: `Drop ${name}` })).toBeVisible();
	await expect(row.getByRole('button', { name: /Move/ })).toHaveCount(0);
});
