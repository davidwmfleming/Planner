import { test as base, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

/** Waits until the planner has started in the browser; before that, taps and strokes do nothing on a slow machine. */
const started = (page: Page) => page.locator('html[data-started]').waitFor({ state: 'attached' });

/** The usual Playwright test, but opening or reloading a page waits for the planner to start. */
export const test = base.extend({
	page: async ({ page }, use) => {
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
