import { expect, test } from './fixtures';
import { unique } from './unique';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('"Future tasks" is hidden until asked for, and Today or Sat puts an item on a day', async ({ page }, info) => {
	const name = unique('Sharpen knives', info);
	await page.goto('/');
	const toggle = page.getByRole('button', { name: /Show future tasks/ });
	await expect(toggle).toBeVisible();
	await expect(page.getByText('Defrost freezer before winter')).toHaveCount(0);
	await toggle.click();
	await expect(page.getByText('Defrost freezer before winter')).toBeVisible();

	// Add one straight to the list, then put it on Saturday.
	await page.locator('#add-task-unscheduled').fill(name);
	await page.locator('#add-task-unscheduled').press('Enter');
	await page.getByRole('button', { name: `Put ${name} on Saturday` }).click();
	await expect(page.getByRole('button', { name: `Put ${name} on Saturday` })).toHaveCount(0);

	const today = new Date();
	const saturday = new Date(today);
	saturday.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7));
	await page.goto(`/?page=${iso(saturday)}`);
	await expect(page.locator(`section.day[data-date="${iso(saturday)}"]`).getByText(name)).toBeVisible();

	// The list stays open on this device after a reload.
	await expect(page.getByRole('button', { name: /Hide future tasks/ })).toBeVisible();
});
