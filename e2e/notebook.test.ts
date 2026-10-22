import { expect, test } from './fixtures';
import { iso } from './dates';

// The "Notebook" look: a serif month and day numbers, ruled lines, the tasks side in light grey,
// and a thick black bar down the left edge of today.

test('the fonts come from the planner itself, so the page looks the same with no internet', async ({ page, baseURL }) => {
	const elsewhere: string[] = [];
	page.on('request', (r) => {
		if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:')) elsewhere.push(r.url());
	});
	await page.goto('/');
	await page.evaluate(() => document.fonts.ready);
	// A font named in the page's CSS but not loaded from the planner would quietly fall back, so look for loaded faces.
	const loaded = await page.evaluate(async () => {
		await Promise.all(['400 19px "Atkinson Hyperlegible"', '700 19px "Atkinson Hyperlegible"', '600 52px "Source Serif 4"'].map((f) => document.fonts.load(f)));
		return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replaceAll('"', '')} ${f.weight}`);
	});
	expect(loaded).toEqual(expect.arrayContaining(['Atkinson Hyperlegible 400', 'Atkinson Hyperlegible 700', 'Source Serif 4 600']));
	expect(elsewhere).toEqual([]);
});

test('the header shows the month and which week and days the page holds', async ({ page }) => {
	await page.goto('/?page=2026-10-19');
	const header = page.getByRole('banner');
	await expect(header.getByRole('heading', { level: 1 })).toHaveText(/October 2026/);
	await expect(header.getByText('Week 43 · Monday to Wednesday')).toBeVisible();
	await page.goto('/?page=2026-10-22');
	await expect(header.getByText('Week 43 · Thursday to Sunday')).toBeVisible();
});
