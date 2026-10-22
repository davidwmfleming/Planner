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

test('only today has the thick black bar down its left edge', async ({ page }) => {
	await page.goto('/');
	const edges = await page.locator('section.day').evaluateAll((days) =>
		days.map((d) => {
			const bar = getComputedStyle(d, '::before');
			const box = d.getBoundingClientRect();
			return { date: (d as HTMLElement).dataset.date, shown: bar.content !== 'none' && bar.display !== 'none', width: bar.width, colour: bar.backgroundColor, height: parseFloat(bar.height) / box.height };
		})
	);
	const today = iso(new Date());
	expect(edges.filter((e) => e.shown).map((e) => e.date)).toEqual([today]);
	const bar = edges.find((e) => e.date === today)!;
	// The page's ink, near-black.
	expect(bar).toMatchObject({ width: '8px', colour: 'rgb(21, 23, 28)' });
	// The whole height of the day, over the grey tasks side too (on a phone the tasks sit under the events).
	expect(bar.height).toBeCloseTo(1, 1);
});

test('the date sits beside the day on a tablet and above it on a phone, with nothing sideways', async ({ page }) => {
	await page.goto('/?page=2026-10-19');
	const day = page.locator('section.day').first();
	const head = (await day.locator('.day-head').boundingBox())!;
	const events = (await day.locator('.col').nth(0).boundingBox())!;
	const tasks = (await day.locator('.col').nth(1).boundingBox())!;
	if (page.viewportSize()!.width >= 700) {
		expect(head.x + head.width).toBeLessThanOrEqual(events.x + 1);
		expect(events.x + events.width).toBeLessThanOrEqual(tasks.x + 1);
	} else {
		expect(head.y + head.height).toBeLessThanOrEqual(events.y + 1);
		expect(events.y + events.height).toBeLessThanOrEqual(tasks.y + 1);
		// The grey tasks side runs the full width of the screen.
		expect(tasks.x).toBeLessThanOrEqual(0);
		expect(tasks.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
	}
	for (const start of ['2026-10-19', '2026-10-22']) {
		await page.goto(`/?page=${start}`);
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, start).toBeLessThanOrEqual(0);
	}
});
