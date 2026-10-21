// These change the task categories, which the planner page's List menu shows,
// so playwright.config.ts runs this file on its own, after all the other tests.
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { putEntry, readSettings, writeSettings } from './calendar-server';
import { unique } from './unique';

const auth = { Authorization: `Basic ${Buffer.from('david:dev').toString('base64')}` };
const USUAL = ['This month', 'Waiting', 'Someday'];

// Whatever happens, the next tests start with the usual categories.
test.afterEach(async ({ request }) => {
	const { renaming, ...settings } = await readSettings(request);
	await writeSettings(request, { ...settings, categories: USUAL });
});

/** A task saved as a phone would, with these CATEGORIES; returns its UID. */
async function taskWith(request: APIRequestContext, title: string, categories: string) {
	const uid = `cat-${Math.random().toString(36).slice(2, 10)}`;
	await putEntry(request, '/david/tasks/', `${uid}.ics`, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phone//EN', 'BEGIN:VTODO', `UID:${uid}`,
		'DTSTAMP:20261019T000000Z', `SUMMARY:${title}`, 'STATUS:NEEDS-ACTION', `CATEGORIES:${categories}`, 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n'));
	return uid;
}
const storedCategories = async (request: APIRequestContext, uid: string) =>
	(await (await request.fetch(`/dav/david/tasks/${uid}.ics`, { headers: auth })).text()).replace(/\r\n[ \t]/g, '').match(/^CATEGORIES:.*$/gm);

const categoriesRegion = (page: Page) => page.getByRole('region', { name: 'Task categories' });
const listed = async (page: Page) => (await categoriesRegion(page).getByRole('listitem').locator('.name').allInnerTexts()).map((t) => t.trim());

async function futureTag(page: Page, title: string) {
	await page.goto('/');
	const toggle = page.getByRole('button', { name: /Show future tasks/ });
	if (await toggle.isVisible()) await toggle.click();
	return page.locator('li', { hasText: title }).locator('.tag:not(.cal-tag)');
}

test('a category added in Settings goes at the end of the list, and a rename changes the list and every task that has it', async ({ page, request }, info) => {
	const name = unique('Errands', info);
	const renamed = unique('Jobs', info);
	const title = unique('Post office', info);
	await page.goto('/settings');
	const categories = categoriesRegion(page);
	await categories.getByLabel('New category').fill(`  ${name} `);
	await categories.getByRole('button', { name: 'Add category' }).click();
	await expect.poll(() => listed(page)).toEqual([...USUAL, name]);
	await expect(categories.getByLabel('New category')).toBeFocused();
	await expect(categories.getByLabel('New category')).toHaveValue('');

	// A task filed under it on a phone, in other letters.
	const uid = await taskWith(request, title, `${name.toUpperCase()},Home`);
	await expect(await futureTag(page, title)).toHaveText(name);

	await page.goto('/settings');
	await categories.getByRole('button', { name: `Rename ${name}` }).click();
	const field = categories.getByLabel(`New name for ${name}`);
	await expect(field).toBeFocused();
	// The name field and its buttons fit a phone screen without scrolling sideways.
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await field.fill(renamed);
	await categories.getByRole('button', { name: 'Save name' }).click();
	await expect(categories.getByRole('status')).toHaveText(`Renamed ${name} to ${renamed}, on 1 task.`);
	await expect.poll(() => listed(page)).toEqual([...USUAL, renamed]);
	await expect(categories.getByRole('button', { name: `Rename ${renamed}` })).toBeFocused();
	expect(await storedCategories(request, uid)).toEqual([`CATEGORIES:${renamed},Home`]);

	await expect(await futureTag(page, title)).toHaveText(renamed);
	await page.locator('li', { hasText: title }).getByRole('button', { name: `Details for ${title}` }).click();
	expect(await page.locator('#f-label option').allInnerTexts()).toEqual(['None', ...USUAL, renamed]);
});

test('a name already on the list, or with a comma, is refused next to the field', async ({ page }, info) => {
	await page.goto('/settings');
	const categories = categoriesRegion(page);
	await categories.getByLabel('New category').fill('waiting');
	await categories.getByRole('button', { name: 'Add category' }).click();
	await expect(categories.getByRole('alert')).toHaveText('There is already a category called "Waiting"');
	await expect(categories.getByLabel('New category')).toHaveValue('waiting');

	await categories.getByRole('button', { name: 'Rename Someday' }).click();
	await categories.getByLabel('New name for Someday').fill(`${unique('One day', info)}, maybe`);
	await categories.getByRole('button', { name: 'Save name' }).click();
	await expect(categories.getByRole('alert')).toContainText("can't have a comma");
	await categories.getByLabel('New name for Someday').press('Escape');
	await expect(categories.getByRole('button', { name: 'Rename Someday' })).toBeFocused();
	expect(await listed(page)).toEqual(USUAL);
});

test('a rename that stopped halfway shows both names, and "Finish renaming" finishes it', async ({ page, request }, info) => {
	const from = unique('Errands', info);
	const to = unique('Jobs', info);
	const [done, left] = [unique('Bank', info), unique('Library', info)];
	const settings = await readSettings(request);
	await writeSettings(request, { ...settings, categories: [...USUAL, from, to], renaming: { from, to } });
	const uids = [await taskWith(request, done, to), await taskWith(request, left, from)];

	await page.goto('/settings');
	const categories = categoriesRegion(page);
	await expect(categories.getByText(`Being renamed to ${to}; some tasks still say ${from}.`)).toBeVisible();
	await expect(categories.getByRole('button', { name: `Rename ${from}` })).toHaveCount(0);
	await categories.getByRole('button', { name: `Finish renaming ${from} to ${to}` }).click();
	await expect(categories.getByRole('status')).toHaveText(`Renamed ${from} to ${to}, on 1 task.`);
	await expect.poll(() => listed(page)).toEqual([...USUAL, to]);
	await expect(categories.getByText(/Being renamed/)).toHaveCount(0);
	expect(await storedCategories(request, uids[0])).toEqual([`CATEGORIES:${to}`]);
	expect(await storedCategories(request, uids[1])).toEqual([`CATEGORIES:${to}`]);
	expect(await readSettings(request)).not.toHaveProperty('renaming');
});
