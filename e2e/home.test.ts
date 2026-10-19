import { expect, test } from '@playwright/test';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('opens on the page holding today, showing its events and tasks', async ({ page }) => {
	await page.goto('/');
	const today = page.locator(`section.day[data-date="${iso(new Date())}"]`);
	await expect(today.getByText('Today', { exact: true })).toBeVisible();
	await expect(today.getByText('Terry Fox')).toBeVisible();
	await expect(today.getByText('8:00 am')).toBeVisible();
	await expect(today.getByText('Green cart')).toBeVisible();
	// Yesterday's unfinished sample task is not on today's line yet: rollover arrives in step 9.
	await expect(today.locator('li.dropped').getByText('Ruck', { exact: true })).toBeVisible();
});

test('a page is Mon–Wed or Thu–Sun, and the arrows flip between them', async ({ page }) => {
	await page.goto('/?page=2026-10-19');
	await expect(page.locator('section.day')).toHaveCount(3);
	await page.getByRole('link', { name: 'Next page' }).click();
	await expect(page).toHaveURL(/page=2026-10-22/);
	await expect(page.locator('section.day')).toHaveCount(4);
	await expect(page.locator('section.day.weekend')).toHaveCount(2);
	await page.getByRole('link', { name: 'Previous page' }).click();
	await expect(page).toHaveURL(/page=2026-10-19/);
});

test('the page never scrolls sideways', async ({ page }) => {
	await page.goto('/');
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});
