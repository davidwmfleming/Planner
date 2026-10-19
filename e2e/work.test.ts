import { expect, test } from '@playwright/test';
import { iso } from './dates';

test('work meetings sit among the day’s events, shaded and read-only', async ({ page }) => {
	await page.goto('/');
	const today = iso(new Date());
	const events = page.locator(`section.day[data-date="${today}"] .col`).nth(0);

	const econ = events.locator('li.work', { hasText: 'Economic Modelling' });
	await expect(econ).toBeVisible();
	await expect(econ.getByText('9:00 am')).toBeVisible();
	await expect(econ.getByText('Work')).toBeVisible();
	await expect(econ).toHaveCSS('background-color', 'rgb(253, 228, 228)');
	await expect(econ.getByRole('button')).toHaveCount(0);

	// In time order with the planner's own events: the 8:45 appointment comes first.
	const titles = await events.locator('li:not(.blank)').allInnerTexts();
	const at = (text: string) => titles.findIndex((t) => t.includes(text));
	expect(at('ADHD follow-up')).toBeLessThan(at('Economic Modelling'));
	expect(at('Economic Modelling')).toBeLessThan(at('Team stand-up'));

	// Cancelled meetings are left out.
	await expect(page.getByText('Budget review (cancelled)')).toHaveCount(0);
});
