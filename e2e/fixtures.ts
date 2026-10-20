import { test as base, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

/** What went wrong in the browser, so a page that never starts says why in the test output. */
const troubles = new WeakMap<Page, string[]>();

/** Waits until the planner has started in the browser; before that, taps and strokes do nothing on a slow machine. */
async function started(page: Page) {
	try {
		await page.locator('html[data-started]').waitFor({ state: 'attached', timeout: 15_000 });
	} catch (e) {
		throw new Error(`The planner did not start in the browser. What the browser reported:\n${(troubles.get(page) ?? ['nothing']).join('\n')}`, { cause: e });
	}
}

/** The usual Playwright test, but opening or reloading a page waits for the planner to start. */
export const test = base.extend({
	page: async ({ page }, use) => {
		const seen: string[] = [];
		troubles.set(page, seen);
		page.on('pageerror', (e) => seen.push(`error: ${e.stack ?? e.message}`));
		page.on('console', (m) => m.type() === 'error' && seen.push(`console: ${m.text()}`));
		page.on('requestfailed', (r) => seen.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
		page.on('response', (r) => r.status() >= 400 && seen.push(`${r.status()}: ${r.url()}`));
		const { goto, reload } = page;
		page.goto = async (...args) => {
			const response = await goto.apply(page, args);
			await started(page);
			return response;
		};
		page.reload = async (...args) => {
			const response = await reload.apply(page, args);
			await started(page);
			return response;
		};
		await use(page);
	}
});
