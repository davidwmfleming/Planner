import { expect, test } from '@playwright/test';

test('home page shows the planner title', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Planner' })).toBeVisible();
});
