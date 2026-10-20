import { expect, test } from './fixtures';

test('can be installed as an app, with its own name and icons', async ({ page, request }) => {
	await page.goto('/');
	const href = await page.locator('link[rel="manifest"]').getAttribute('href');
	const manifest = await (await request.get(href!)).json();
	expect(manifest).toMatchObject({ name: 'Planner', display: 'standalone', start_url: '/' });
	for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
	expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
	expect((await request.get('/apple-touch-icon.png')).ok()).toBe(true);
});

test('every button on a line is big enough to hit with a finger or pen', async ({ page }) => {
	await page.goto('/');
	const sizes = await page.locator('main .lines li button').evaluateAll((buttons) =>
		buttons.map((b) => {
			const r = b.getBoundingClientRect();
			return { label: b.getAttribute('aria-label') ?? b.textContent, width: r.width, height: r.height };
		})
	);
	expect(sizes.length).toBeGreaterThan(0);
	const small = sizes.filter((s) => s.width < 36 || s.height < 40);
	expect(small).toEqual([]);
});

test('nothing on the page moves or fades', async ({ page }) => {
	await page.goto('/');
	const moving = await page.evaluate(() =>
		[...document.querySelectorAll('*')].filter((el) => {
			const css = getComputedStyle(el);
			return parseFloat(css.transitionDuration) > 0 || css.animationName !== 'none';
		}).length
	);
	expect(moving).toBe(0);
});
