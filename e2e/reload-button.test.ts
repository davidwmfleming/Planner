// After QA's save-safety re-test.
// The installed app has no browser controls, so a message that asks for a reload must come with a Reload button,
// including the "Wait a minute before reloading the page" one a move gets when its delete wasn't confirmed.
import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';

const { mon, tue } = futureWeek();
const failure = (message: string) => ({
	status: 200,
	contentType: 'application/json',
	body: JSON.stringify({ type: 'failure', status: 502, data: JSON.stringify([{ message: 1 }, message]) })
});

for (const message of [
	'"Dentist" may now be in two calendars, because the calendar server didn\'t confirm it removed the old one. Wait a minute before reloading the page; then, if it\'s still in two, delete the one in Me.',
	'The calendar server didn\'t move "Dentist" to another calendar, and didn\'t confirm it took the new copy back out. Wait a minute before reloading the page; then, if it\'s still in two, delete the one in Family.'
]) {
	test(`a message that says to wait before reloading has a Reload button: ${message.slice(0, 40)}`, async ({ page }, info) => {
		const name = unique('Wait reload', info);
		await page.goto(`/?page=${mon}`);
		await page.locator(`#add-event-${tue}`).fill(`9am ${name}`);
		await page.locator(`#add-event-${tue}`).press('Enter');
		await page.getByRole('button', { name: `Details for ${name}` }).click();
		const sheet = page.getByRole('dialog', { name: 'Details' });
		await page.route('**/*&/save', (r) => r.fulfill(failure(message)));
		await sheet.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(sheet.getByRole('alert')).toContainText('Wait a minute');
		await expect(sheet.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
	});
}

test('a settings message that asks for a reload has a Reload button', async ({ page }) => {
	await page.goto('/settings');
	const message = "That calendar isn't there any more; reload the page";
	// Nothing is really renamed: the answer is staged, as if the calendar was deleted on another device.
	await page.route((url) => url.search === '?/rename', (r) =>
		r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'failure', status: 404, data: JSON.stringify([{ action: 1, message: 2 }, 'rename', message]) }) })
	);
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByRole('button', { name: 'Rename Me' }).click();
	await page.locator('#rename-field').fill('Me again');
	await calendars.getByRole('button', { name: 'Save name' }).click();
	await expect(calendars.getByRole('alert')).toContainText('reload the page');
	await expect(calendars.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
});
