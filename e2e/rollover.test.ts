import { expect, test } from '@playwright/test';
import { unique } from './unique';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('an unfinished task on an earlier day is carried to today, marked with where it came from', async ({ page }, info) => {
	const title = unique('Return library books', info);
	const now = new Date();
	const past = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10));
	const today = iso(now);

	await page.goto(`/?page=${past}`);
	const line = page.locator(`#add-task-${past}`);
	await line.fill(title);
	await line.press('Enter');
	// The page reloads its data after saving, and rollover runs then: the task leaves the past day.
	await expect(page.locator(`section.day[data-date="${past}"]`).getByText(title)).toHaveCount(0);

	await page.goto('/');
	const carried = page.locator(`section.day[data-date="${today}"] li`, { hasText: title });
	await expect(carried).toBeVisible();
	await expect(carried.locator('.carry')).toHaveAttribute('title', 'Carried over');
	await expect(carried.locator('.carry')).toContainText(String(Number(past.slice(8))));
});
