import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';

const { wed } = futureWeek();

test('one tap sends a task from its day back to Future tasks', async ({ page }, info) => {
	const name = unique('Sort the garage', info);
	await page.goto(`/?page=${wed}`);
	await page.locator(`#add-task-${wed}`).fill(name);
	await page.locator(`#add-task-${wed}`).press('Enter');
	const row = page.locator(`section.day[data-date="${wed}"] li`, { hasText: name });
	await row.getByRole('button', { name: `Put ${name} back on Future tasks` }).click();
	await expect(row).toHaveCount(0);

	const list = page.getByRole('region', { name: 'Future tasks' });
	if ((await list.getByRole('button', { name: /Show future tasks/ }).count()) > 0) {
		await list.getByRole('button', { name: /Show future tasks/ }).click();
	}
	await expect(list.getByRole('button', { name: `Details for ${name}` })).toBeVisible();
});
