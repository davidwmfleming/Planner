// When the calendar server fails a change, the planner says so on the page and stays usable, rather than
// replacing itself with an error screen (which, in the installed app, has no way back).
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';

const { nextTue: day } = futureWeek();

/** What the planner's server sends back when the calendar server refused a change. */
const refused = (message: string) => ({
	status: 200,
	contentType: 'application/json',
	body: JSON.stringify({ type: 'failure', status: 502, data: JSON.stringify([{ message: 1 }, message]) })
});
/** What it sends when something unexpected went wrong. */
const crashed = { status: 500, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { message: 'Internal Error' } }) };

async function addTask(page: Page, name: string) {
	await page.goto(`/?page=${day}`);
	await page.locator(`#add-task-${day}`).fill(name);
	await page.locator(`#add-task-${day}`).press('Enter');
	const row = page.locator(`section.day[data-date="${day}"] li`, { hasText: name });
	await expect(row).toBeVisible();
	return row;
}

const errorScreen = (page: Page) => page.getByRole('heading', { name: /500|Internal Error/ });

test('a tick, drop, move or send-back the calendar server refuses is explained on the page', async ({ page }, info) => {
	const name = unique('Refused', info);
	const row = await addTask(page, name);
	const taps = [
		['mark', `Tick ${name}`],
		['mark', `Drop ${name}`],
		['move', `Move ${name} to the next day`],
		['unschedule', `Put ${name} back on Future tasks`]
	];
	for (const [action, button] of taps) {
		const message = `The calendar server didn't ${action} "${name}". Reload the page and try again.`;
		await page.route(`**/*&/${action}`, (route) => route.fulfill(refused(message)));
		await row.getByRole('button', { name: button }).click();
		await expect(page.getByRole('alert')).toHaveText(message);
		await expect(row).toHaveClass(/open/);
		await expect(errorScreen(page)).toHaveCount(0);
		await page.unroute(`**/*&/${action}`);
	}

	// Once it works again, the message goes away.
	await row.getByRole('button', { name: `Tick ${name}` }).click();
	await expect(row).toHaveClass(/done/);
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an unexpected failure on a tap keeps the page, with a plain message', async ({ page }, info) => {
	const name = unique('Crashed', info);
	const row = await addTask(page, name);
	await page.route('**/*&/mark', (route) => route.fulfill(crashed));
	await row.getByRole('button', { name: `Tick ${name}` }).click();
	await expect(page.getByRole('alert')).toHaveText('That did not work; try again');
	await expect(errorScreen(page)).toHaveCount(0);
	await expect(row).toBeVisible();
});

test('the details sheet stays open and explains when saving or deleting fails', async ({ page }, info) => {
	const name = unique('Sheet trouble', info);
	const row = await addTask(page, name);
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await row.getByRole('button', { name: `Details for ${name}` }).click();

	await page.route('**/*&/save', (route) => route.fulfill(refused(`The calendar server didn't save "${name}". Reload the page and try again.`)));
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByRole('alert')).toHaveText(`The calendar server didn't save "${name}". Reload the page and try again.`);
	await expect(sheet).toBeVisible();

	await page.route('**/*&/delete', (route) => route.fulfill(crashed));
	await sheet.getByRole('button', { name: 'Delete' }).click();
	await expect(sheet.getByRole('alert')).toHaveText('That did not work; try again');
	await expect(sheet).toBeVisible();
	await expect(errorScreen(page)).toHaveCount(0);
});
