import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './fixtures';
import { iso } from './dates';

const button = 'Download everything (.ics)';

test('"Download everything" on the settings page saves a dated zip with one .ics per calendar', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByText('Apple Calendar and Google Calendar skip the tasks')).toBeVisible();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
	expect(download.suggestedFilename()).toBe(`planner-export-${iso(new Date())}.zip`);

	const files = unzipSync(readFileSync(await download.path()));
	expect(Object.keys(files)).toEqual(expect.arrayContaining(['Me.ics', 'Family.ics', 'Workouts.ics', 'Morgan Meals.ics', 'Work.ics', 'Tasks.ics']));
	for (const ics of Object.values(files)) expect(strFromU8(ics)).toMatch(/^BEGIN:VCALENDAR\r?\n[\s\S]*END:VCALENDAR\s*$/);
	expect(strFromU8(files['Me.ics'])).toContain('SUMMARY:Terry Fox');
	expect(strFromU8(files['Work.ics'])).toContain('SUMMARY:Economic Modelling');
	expect(strFromU8(files['Tasks.ics'])).toContain('SUMMARY:Green cart');
	await expect(page).toHaveURL(/\/settings$/); // still on the settings page
	await expect(page.getByRole('button', { name: button })).toBeEnabled();
});

test('the planner page no longer has the export button; it lives on the settings page', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText(button)).toHaveCount(0);
});

test('when the calendar server will not hand out a calendar, the page says so and stays put', async ({ page }) => {
	await page.goto('/settings');
	await page.route('**/export', (route) =>
		route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'The calendar server did not hand out "Family", so nothing was downloaded. Try again in a moment.' }) })
	);
	let downloaded = false;
	page.on('download', () => (downloaded = true));
	await page.getByRole('button', { name: button }).click();
	await expect(page.getByRole('alert')).toHaveText(/did not hand out "Family"/);
	await expect(page).toHaveURL(/\/settings$/);
	expect(downloaded).toBe(false);
	await expect(page.getByRole('button', { name: button })).toBeEnabled(); // can try again
});

test('when the planner cannot be reached at all, the page says so', async ({ page }) => {
	await page.goto('/settings');
	await page.route('**/export', (route) => route.abort('internetdisconnected'));
	await page.getByRole('button', { name: button }).click();
	await expect(page.getByRole('alert')).toHaveText(/could not reach the planner/i);
});

test('a second tap while the export is being made does not start another', async ({ page }) => {
	await page.goto('/settings');
	let requests = 0;
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/export', async (route) => {
		requests++;
		await held;
		await route.continue();
	});
	await page.getByRole('button', { name: button }).click();
	await expect(page.getByRole('button', { name: /Download everything|Making the export/ })).toBeDisabled();
	await page.getByRole('button', { name: /Download everything|Making the export/ }).click({ force: true });
	const download = page.waitForEvent('download');
	release();
	await download;
	expect(requests).toBe(1);
	await expect(page.getByRole('button', { name: button })).toBeEnabled();
});

/** Makes the page believe it is the app installed on a phone's home screen, with a share sheet. */
async function installedWithShareSheet(page: import('@playwright/test').Page, share: 'works' | 'refused') {
	await page.addInitScript((share) => {
		const original = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => (query.includes('display-mode: standalone') ? ({ ...original(query), matches: true, media: query } as MediaQueryList) : original(query));
		const shared: { name: string; type: string; size: number }[] = [];
		Object.assign(window, { shared });
		Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data?: ShareData) => Boolean(data?.files?.length) });
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: async (data: ShareData) => {
				// iPhone refuses a share sheet asked for too long after the tap (the export took a while).
				if (share === 'refused' && shared.length === 0 && !(window as unknown as { tapped?: boolean }).tapped) throw new DOMException('Too late', 'NotAllowedError');
				for (const file of data.files ?? []) shared.push({ name: file.name, type: file.type, size: file.size });
			}
		});
	}, share);
}

test('in the installed app, the zip goes to the share sheet instead of a download', async ({ page }) => {
	await installedWithShareSheet(page, 'works');
	await page.goto('/settings');
	let downloaded = false;
	page.on('download', () => (downloaded = true));
	await page.getByRole('button', { name: button }).click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { shared: { name: string }[] }).shared)).toEqual([expect.objectContaining({ name: `planner-export-${iso(new Date())}.zip`, type: 'application/zip' })]);
	expect(downloaded).toBe(false);
});

test('in the installed app, if the share sheet is refused after a slow export, one more tap opens it', async ({ page }) => {
	await installedWithShareSheet(page, 'refused');
	await page.goto('/settings');
	await page.getByRole('button', { name: button }).click();
	const again = page.getByRole('button', { name: /Save or share the zip/ });
	await expect(again).toBeVisible();
	await page.evaluate(() => Object.assign(window, { tapped: true }));
	await again.click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { shared: { name: string }[] }).shared.map((f) => f.name))).toEqual([`planner-export-${iso(new Date())}.zip`]);
	await expect(again).toHaveCount(0);
});
