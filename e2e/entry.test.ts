import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('writing a line in a column saves an event or a task on that day, ready for the next line', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const today = iso(new Date());
	await page.goto('/');
	const day = page.locator(`section.day[data-date="${today}"]`);

	const eventLine = page.locator(`#add-event-${today}`);
	await eventLine.fill(`9am Dentist ${tag}`);
	await eventLine.press('Enter');
	const saved = day.locator('li', { hasText: `Dentist ${tag}` });
	await expect(saved).toBeVisible();
	await expect(saved.getByText('9:00 am')).toBeVisible();
	await expect(eventLine).toHaveValue('');
	await expect(eventLine).toBeFocused();

	const taskLine = page.locator(`#add-task-${today}`);
	await taskLine.fill(`Pick up dry cleaning ${tag}`);
	await taskLine.press('Enter');
	await expect(day.locator('.col').nth(1).getByText(`Pick up dry cleaning ${tag}`)).toBeVisible();

	// It is really on the calendar server: still there after a reload.
	await page.reload();
	await expect(day.getByText(`Dentist ${tag}`)).toBeVisible();
});

test('tapping away from a written line saves it, and the cursor goes where you tapped', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { mon } = futureWeek();
	await page.goto(`/?page=${mon}`);
	const day = page.locator(`section.day[data-date="${mon}"]`);
	const taskLine = page.locator(`#add-task-${mon}`);
	const eventLine = page.locator(`#add-event-${mon}`);

	await taskLine.fill(`Book flu shot ${tag}`);
	await eventLine.click();
	await expect(day.locator('li', { hasText: `Book flu shot ${tag}` })).toBeVisible();
	await expect(taskLine).toHaveValue('');
	await expect(eventLine).toBeFocused();

	// An empty line saves nothing.
	await eventLine.blur();
	await page.reload();
	await expect(day.getByText(`Book flu shot ${tag}`)).toHaveCount(1);
});

test('tapping another line while a line saves leaves the cursor there', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { tue } = futureWeek();
	await page.goto(`/?page=${tue}`);
	// A slow connection, so the tap lands while the first line is still saving.
	await page.route('**/*&/add', async (route) => {
		await new Promise((r) => setTimeout(r, 800));
		await route.continue();
	});
	const taskLine = page.locator(`#add-task-${tue}`);
	const eventLine = page.locator(`#add-event-${tue}`);
	await taskLine.fill(`Order printer ink ${tag}`);
	await taskLine.press('Enter');
	await expect(taskLine).toHaveValue('');
	await eventLine.click();
	await expect(page.locator(`section.day[data-date="${tue}"]`).getByText(`Order printer ink ${tag}`)).toBeVisible();
	await expect(eventLine).toBeFocused();
});

test('if a line cannot be saved, the words stay and the planner stays up', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { tue } = futureWeek();
	await page.goto(`/?page=${tue}`);
	await page.route('**/*&/add', (route) => route.abort());
	const taskLine = page.locator(`#add-task-${tue}`);
	await taskLine.fill(`Renew passport ${tag}`);
	await page.locator(`#add-event-${tue}`).click();
	await expect(page.getByRole('alert')).toContainText("Couldn't save");
	await expect(taskLine).toHaveValue(`Renew passport ${tag}`);
	await expect(page.locator(`section.day[data-date="${tue}"]`)).toBeVisible();
});

test('words written while a failing save is on its way are kept with the failed ones', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { tue } = futureWeek();
	await page.goto(`/?page=${tue}`);
	await page.route('**/*&/add', async (route) => {
		await new Promise((r) => setTimeout(r, 800));
		await route.abort();
	});
	const taskLine = page.locator(`#add-task-${tue}`);
	await taskLine.fill(`Fix gate ${tag}`);
	await taskLine.press('Enter');
	await expect(taskLine).toHaveValue('');
	await taskLine.fill('Paint shed');
	await expect(page.getByRole('alert')).toContainText("Couldn't save");
	await expect(taskLine).toHaveValue(`Fix gate ${tag} Paint shed`);
});

test('on a slow connection, writing more and tapping another line saves both and leaves the cursor there', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { tue } = futureWeek();
	await page.goto(`/?page=${tue}`);
	await page.route('**/*&/add', async (route) => {
		await new Promise((r) => setTimeout(r, 800));
		await route.continue();
	});
	const day = page.locator(`section.day[data-date="${tue}"]`);
	const taskLine = page.locator(`#add-task-${tue}`);
	const eventLine = page.locator(`#add-event-${tue}`);
	await taskLine.fill(`Sweep porch ${tag}`);
	await taskLine.press('Enter');
	await taskLine.fill(`Rake leaves ${tag}`);
	await eventLine.click();
	await expect(day.getByText(`Sweep porch ${tag}`)).toHaveCount(1);
	await expect(day.getByText(`Rake leaves ${tag}`)).toHaveCount(1);
	await expect(eventLine).toBeFocused();
});

test('a line that loses focus for a moment mid-writing is not saved under the pen', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { tue } = futureWeek();
	await page.goto(`/?page=${tue}`);
	const taskLine = page.locator(`#add-task-${tue}`);
	await taskLine.fill(`Half a wor ${tag}`);
	// The handwriting keyboard takes focus briefly, then gives it back.
	await taskLine.evaluate((el: HTMLInputElement) => {
		el.blur();
		setTimeout(() => el.focus(), 150);
	});
	await page.waitForTimeout(1200);
	await expect(taskLine).toHaveValue(`Half a wor ${tag}`);
	await expect(page.locator(`section.day[data-date="${tue}"] li`, { hasText: `Half a wor ${tag}` })).toHaveCount(0);
});

test('words written just before turning the page or reloading are saved', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { mon, tue } = futureWeek();
	await page.goto(`/?page=${mon}`);
	await page.locator(`#add-task-${tue}`).fill(`Turn the page ${tag}`);
	await page.getByRole('link', { name: 'Next page' }).click();
	await expect(page).not.toHaveURL(new RegExp(`page=${mon}`));
	await page.locator(`#add-task-${page.url().split('page=')[1]}`).fill(`Reload ${tag}`);
	const nextStart = page.url().split('page=')[1];
	await page.reload();
	await expect(page.locator(`section.day[data-date="${nextStart}"]`).getByText(`Reload ${tag}`)).toBeVisible();
	await page.goto(`/?page=${mon}`);
	await expect(page.locator(`section.day[data-date="${tue}"]`).getByText(`Turn the page ${tag}`)).toBeVisible();
});

test('a line the server may or may not have saved is not sent again when the cursor leaves it', async ({ page }, info) => {
	const { mon, tue } = futureWeek();
	const name = unique('Maybe saved', info);
	await page.goto(`/?page=${mon}`);
	let sent = 0;
	await page.route('**/*&/add', async (r) => {
		sent++;
		if (sent === 1) {
			const message = `The calendar server didn't answer in time when asked to save "${name}", so it may or may not be saved. Reload the page to see.`;
			return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'failure', status: 502, data: JSON.stringify([{ message: 1 }, message]) }) });
		}
		await r.continue();
	});
	await page.locator(`#add-task-${tue}`).fill(name);
	await page.locator(`#add-task-${tue}`).press('Enter');
	await expect(page.getByRole('alert')).toContainText('may or may not be saved');
	await page.getByRole('button', { name: 'Close the message' }).click();
	await page.locator('h1').click();
	await page.waitForTimeout(1000);
	// Sending it again could make two; the person should look first (Reload), then decide.
	expect(sent).toBe(1);
	// The words stay on the line, and Enter sends them again on purpose.
	await expect(page.locator(`#add-task-${tue}`)).toHaveValue(name);
	await page.locator(`#add-task-${tue}`).press('Enter');
	await expect.poll(() => sent).toBe(2);
	await expect(page.locator(`section.day[data-date="${tue}"]`).getByText(name)).toBeVisible();
});

test('a line or a note longer than the planner keeps is refused with a message, never cut short', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { tue } = futureWeek();
	await page.goto(`/?page=${tue}`);
	const taskLine = page.locator(`#add-task-${tue}`);
	const long = `Pasted ${tag} ${'x'.repeat(600)}`;
	await taskLine.fill(long);
	await taskLine.press('Enter');
	await expect(page.getByRole('alert')).toContainText('500 letters or fewer');
	await expect(taskLine).toHaveValue(long);

	await taskLine.fill(`Short ${tag}`);
	await taskLine.press('Enter');
	await page.getByRole('button', { name: `Details for Short ${tag}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await sheet.locator('#f-notes').fill('n'.repeat(10_001));
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByRole('alert')).toContainText('10,000 letters or fewer');
	await expect(sheet.locator('#f-notes')).toHaveValue('n'.repeat(10_001));
});
