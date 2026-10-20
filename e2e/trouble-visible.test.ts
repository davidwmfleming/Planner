// Proposed by QA (PR #31): a refusal must be seen where the person is looking, and an item stored
// twice (a move between calendars whose delete failed) must not break the page.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';
import { deleteCalendar, makeCalendar, putEntry } from './calendar-server';

const { nextTue: day, tue } = futureWeek();
const refused = (message: string) => ({
	status: 200,
	contentType: 'application/json',
	body: JSON.stringify({ type: 'failure', status: 502, data: JSON.stringify([{ message: 1 }, message]) })
});
const inViewport = (page: Page, sel: ReturnType<Page['getByRole']>) =>
	sel.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });

test('a refused tap is explained where the person can see it, even scrolled down', async ({ page }, info) => {
	const name = unique('Seen', info);
	await page.goto(`/?page=${day}`);
	// The last day on the page, so a phone has to scroll to reach it.
	const line = page.locator('input.entry[id^="add-task-"]').last();
	await line.fill(name);
	await line.press('Enter');
	const row = page.locator('li[data-uid]', { hasText: name });
	// Scrolled down, as a phone usually is by the time it reaches a later day.
	await page.locator('section.day').last().evaluate((el) => el.scrollIntoView({ block: 'end' }));
	await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	test.skip((await page.evaluate(() => scrollY)) < 100, 'this screen shows the whole page without scrolling');
	await page.route('**/*&/mark', (r) => r.fulfill(refused('No')));
	await row.getByRole('button', { name: `Tick ${name}` }).click();
	const alert = page.getByRole('alert');
	await expect(alert).toHaveText('No');
	expect(await inViewport(page, alert)).toBe(true);
});

test('a refused save is explained inside the visible part of the details sheet', async ({ page }, info) => {
	const name = unique('Sheet seen', info);
	await page.goto(`/?page=${tue}`);
	await page.locator(`#add-event-${tue}`).fill(`2pm ${name}`);
	await page.locator(`#add-event-${tue}`).press('Enter');
	await page.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await sheet.locator('#f-calendar').selectOption('+new');
	await sheet.locator('input[name=newCalendar]').fill('Me');
	await sheet.getByRole('button', { name: 'Save' }).click();
	const alert = sheet.getByRole('alert');
	await expect(alert).toContainText('already a calendar');
	expect(await inViewport(page, alert)).toBe(true);
});

test('an event stored in two calendars under one UID still shows, and the page still works', async ({ page, request }, info) => {
	// What a move between calendars leaves behind when the new copy was saved but the old one couldn't be deleted.
	const name = unique('Twice', info);
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	const uid = `twice-${slug}`;
	const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260101T000000Z',
		`DTSTART;VALUE=DATE:${day.replaceAll('-', '')}`, `SUMMARY:${name}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
	const calendars = [await makeCalendar(request, `${slug}-a`, `${name} A`), await makeCalendar(request, `${slug}-b`, `${name} B`)];
	try {
		for (const path of calendars) await putEntry(request, path, `${uid}.ics`, ics);
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto(`/?page=${day}`);
		const copies = page.locator('li[data-uid]', { hasText: name });
		await expect(copies).toHaveCount(2);
		// Each copy says which calendar it is in, so "delete the one in …" can be followed.
		await expect(copies.filter({ hasText: `${name} A` })).toHaveCount(1);
		await expect(copies.filter({ hasText: `${name} B` })).toHaveCount(1);
		// Each copy can be dealt with on its own: ticking one leaves the other as it was.
		await copies.nth(1).getByRole('button', { name: `Tick ${name}` }).click();
		await expect(page.locator('li.done[data-uid]', { hasText: name })).toHaveCount(1);
		await expect(page.locator('li.open[data-uid]', { hasText: name })).toHaveCount(1);
		expect(errors).toEqual([]);
	} finally {
		for (const path of calendars) await deleteCalendar(request, path);
	}
});

async function addTask(page: Page, name: string) {
	await page.goto(`/?page=${day}`);
	await page.locator(`#add-task-${day}`).fill(name);
	await page.locator(`#add-task-${day}`).press('Enter');
	const row = page.locator(`section.day[data-date="${day}"] li[data-uid]`, { hasText: name });
	await expect(row).toBeVisible();
	return row;
}

test('a message that says to reload comes with a Reload button, since the installed app has none', async ({ page }, info) => {
	const name = unique('Reload', info);
	const row = await addTask(page, name);
	await page.route('**/*&/mark', (r) => r.fulfill(refused(`The calendar server didn't save the mark on "${name}". Reload the page and try again.`)));
	await row.getByRole('button', { name: `Tick ${name}` }).click();
	await expect(page.getByRole('alert')).toContainText('Reload the page');
	await page.unroute('**/*&/mark');
	await page.getByRole('button', { name: 'Reload', exact: true }).click();
	await page.locator('html[data-started]').waitFor({ state: 'attached' });
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.locator(`section.day[data-date="${day}"] li[data-uid]`, { hasText: name })).toBeVisible();

	// The same in the details sheet.
	await page.locator(`section.day[data-date="${day}"] li[data-uid]`, { hasText: name }).getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await page.route('**/*&/save', (r) => r.fulfill(refused(`The calendar server didn't save "${name}". Reload the page and try again.`)));
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByRole('alert')).toContainText('Reload the page');
	await expect(sheet.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
});

test('a message that does not say to reload has no Reload button', async ({ page }, info) => {
	const name = unique('No reload', info);
	const row = await addTask(page, name);
	await page.route('**/*&/mark', (r) => r.fulfill(refused('No')));
	await row.getByRole('button', { name: `Tick ${name}` }).click();
	await expect(page.getByRole('alert')).toHaveText('No');
	await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);
});

test('when a page cannot be shown, the error screen has a way to try again and a way back', async ({ page }) => {
	await page.goto(`/?page=${day}`);
	const message = "The calendar server isn't answering. Check that it is running, then reload.";
	// What the planner's server sends when the calendar server is down as the next page is read.
	const down = { type: 'data', nodes: [{ type: 'skip' }, { type: 'error', error: { message }, status: 503 }] };
	await page.route('**/__data.json**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(down) }));
	await page.getByRole('link', { name: 'Next page' }).click();
	await expect(page.getByText(message)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
	await page.unroute('**/__data.json**');
	await page.getByRole('link', { name: 'Back to the planner' }).click();
	await expect(page.getByRole('banner').getByRole('heading', { name: /Planner/ })).toBeVisible();
});

test('a tap made with no connection says to check the connection', async ({ page, context }, info) => {
	const name = unique('Offline', info);
	const row = await addTask(page, name);
	await context.setOffline(true);
	try {
		await row.getByRole('button', { name: `Tick ${name}` }).click();
		await expect(page.getByRole('alert')).toHaveText('That did not save. Check the connection and try again.');
	} finally {
		await context.setOffline(false);
	}
});

test('a double tap on the tick ticks once, with no failure shown', async ({ page }, info) => {
	const name = unique('Double', info);
	const row = await addTask(page, name);
	let sent = 0;
	// A slow connection: the second tap lands while the first is still saving.
	await page.route('**/*&/mark', async (r) => {
		sent++;
		await new Promise((done) => setTimeout(done, 600));
		await r.continue();
	});
	const tick = row.getByRole('button', { name: `Tick ${name}` });
	await tick.click();
	await tick.click();
	await expect(row).toHaveClass(/done/);
	await page.waitForTimeout(800);
	await expect(row).toHaveClass(/done/);
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(sent).toBe(1);
});

test('a failure about a long title keeps the header short, and × puts the message away', async ({ page }, info) => {
	const name = unique('Pick up the dry cleaning and then the groceries for the weekend party at Morgan\'s place', info);
	await page.goto(`/?page=${day}`);
	// The planner itself is not answering, so the line's own words are quoted back.
	await page.route('**/*&/add', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'error', status: 500, error: { message: 'x' } }) }));
	await page.locator(`#add-task-${day}`).fill(name);
	await page.locator(`#add-task-${day}`).press('Enter');
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('Couldn\'t save "Pick up the dry cleaning');
	await expect(alert).not.toContainText('Morgan');
	const header = await page.getByRole('banner').boundingBox();
	const screen = page.viewportSize()!;
	expect(header!.height).toBeLessThan(screen.height * 0.35);
	await page.getByRole('button', { name: 'Close the message' }).click();
	await expect(alert).toHaveCount(0);

	// The same in the details sheet.
	await page.unroute('**/*&/add');
	await page.locator(`#add-task-${day}`).fill(name);
	await page.locator(`#add-task-${day}`).press('Enter');
	await page.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await page.route('**/*&/save', (r) => r.fulfill(refused('The calendar server didn\'t save "Pick up the dry cleaning and then the g…". Reload the page and try again.')));
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByRole('alert')).toBeVisible();
	await sheet.getByRole('button', { name: 'Close the message' }).click();
	await expect(sheet.getByRole('alert')).toHaveCount(0);
	await expect(sheet).toBeVisible();
});

// QA (PR #31): with the buttons beside it, a long message was squeezed into a narrow column and the header
// covered 45% of a 375x667 phone and about 70% of a 320x568 one. On a phone the text gets the full width.
// The height limits leave room for fonts that set wider on GitHub's Linux machines (37% there at 375x667);
// the full-width checks below are what catch the old squeezed layout.
for (const [width, height, most] of [[375, 667, 0.42], [320, 568, 0.6]] as const) {
	test(`a long failure message leaves most of a ${width}x${height} screen free`, async ({ page }, info) => {
		test.skip(info.project.name !== 'phone', 'a phone size, set here');
		await page.setViewportSize({ width, height });
		const name = unique('Pick up the dry cleaning and then the groceries for the weekend party at Morgan\'s place', info);
		const row = await addTask(page, name);
		// The longest message a tap gets: a title cut to 40 characters, and a Reload button.
		const message = 'The calendar server didn\'t save the mark on "Pick up the dry cleaning and then the g…". Reload the page and try again.';
		await page.route('**/*&/mark', (r) => r.fulfill(refused(message)));
		await row.getByRole('button', { name: `Tick ${name}` }).click();
		const alert = page.getByRole('alert');
		await expect(alert).toBeVisible();
		const header = (await page.getByRole('banner').boundingBox())!;
		expect(header.height).toBeLessThan(height * most);
		// The text runs the box's full width, not a narrow column beside the buttons.
		const fullWidth = async (said: typeof alert) =>
			said.evaluate((el) => el.getBoundingClientRect().width / el.closest('.trouble')!.getBoundingClientRect().width);
		expect(await fullWidth(alert)).toBeGreaterThan(0.8);

		await page.unroute('**/*&/mark');
		await page.getByRole('button', { name: 'Close the message' }).click();
		await row.getByRole('button', { name: `Details for ${name}` }).click();
		const sheet = page.getByRole('dialog', { name: 'Details' });
		await page.route('**/*&/save', (r) => r.fulfill(refused(message.replace('the mark on ', ''))));
		await sheet.getByRole('button', { name: 'Save' }).click();
		const said = sheet.getByRole('alert');
		await expect(said).toBeVisible();
		expect(await fullWidth(said)).toBeGreaterThan(0.8);
		// The message and the Save bar under it together still leave room to see the sheet.
		const bar = (await sheet.locator('.actions').boundingBox())!;
		expect(bar.height).toBeLessThan(height * most);
		await expect(sheet.getByRole('button', { name: 'Save' })).toBeInViewport();
	});
}

// QA (save-safety): at 320x568 the sheet was wider than its box, so showing a message slid it sideways.
for (const [width, height] of [[320, 568], [375, 667]] as const) {
	test(`the details sheet fits a ${width}x${height} screen, long calendar names and a message included`, async ({ page, request }, info) => {
		test.skip(info.project.name !== 'phone', 'a phone size, set here');
		await page.setViewportSize({ width, height });
		const name = unique('Reg dentist appointment with a long title', info);
		const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
		const calendar = await makeCalendar(request, slug, `Holiday trip to the coast ${slug}`.slice(0, 40));
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', `UID:${slug}`, 'DTSTAMP:20260101T000000Z',
			`DTSTART;VALUE=DATE:${day.replaceAll('-', '')}`, `SUMMARY:${name}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
		try {
			await putEntry(request, calendar, `${slug}.ics`, ics);
			await page.goto(`/?page=${day}`);
			await page.getByRole('button', { name: `Details for ${name}` }).click();
			const sheet = page.getByRole('dialog', { name: 'Details' });
			const sideways = () => sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
			expect(await sideways()).toBeLessThanOrEqual(0);
			await page.route('**/*&/save', (r) => r.fulfill(refused(`"${name.slice(0, 39)}…" may now be in two calendars, because the calendar server didn't confirm it removed the old one. Wait a minute before reloading the page; then, if it's still in two, delete the one in Holiday trip to the coast.`)));
			await sheet.getByRole('button', { name: 'Save' }).click();
			await expect(sheet.getByRole('alert')).toBeVisible();
			expect(await sideways()).toBeLessThanOrEqual(0);
			expect(await sheet.evaluate((el) => el.scrollLeft)).toBe(0);
		} finally {
			await deleteCalendar(request, calendar);
		}
	});
}

test('closing a message puts focus back on what it was about, not the top of the page', async ({ page }, info) => {
	const name = unique('Focus back', info);
	const row = await addTask(page, name);
	await page.route('**/*&/mark', (r) => r.fulfill(refused('No')));
	const tickButton = row.getByRole('button', { name: `Tick ${name}` });
	await tickButton.click();
	await expect(page.getByRole('alert')).toHaveText('No');
	await page.getByRole('button', { name: 'Close the message' }).click();
	await expect(tickButton).toBeFocused();

	await row.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await page.route('**/*&/save', (r) => r.fulfill(refused('No')));
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByRole('alert')).toHaveText('No');
	await sheet.getByRole('button', { name: 'Close the message' }).click();
	await expect(sheet.getByRole('button', { name: 'Save' })).toBeFocused();
});

// The calendar tag on a doubled item must not squeeze the title into a column of single letters on a small phone
// (320 wide: iPhone SE with Display Zoom). At e90755a the title gets about 30px and the row is about 400px tall.
test('an item in two calendars keeps a readable title at 320 wide', async ({ page, request }, info) => {
	test.skip(info.project.name !== 'phone', 'a phone size, set here');
	const { wed } = futureWeek();
	await page.setViewportSize({ width: 320, height: 568 });
	const name = unique('Dentist appointment', info);
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	const uid = `qa-tag-${slug}`;
	const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260101T000000Z',
		`DTSTART:${wed.replaceAll('-', '')}T090000`, `SUMMARY:${name}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
	const calendars = [await makeCalendar(request, `${slug}-a`, 'Kids activities'), await makeCalendar(request, `${slug}-b`, 'Family')];
	try {
		for (const path of calendars) await putEntry(request, path, `${uid}.ics`, ics);
		await page.goto(`/?page=${wed}`);
		const copies = page.locator('li[data-uid]', { hasText: name });
		await expect(copies).toHaveCount(2);
		for (const copy of await copies.all()) {
			const title = (await copy.getByRole('button', { name: `Details for ${name}` }).boundingBox())!;
			const row = (await copy.boundingBox())!;
			expect(title.width, 'title column width').toBeGreaterThan(row.width * 0.35);
			expect(row.height, 'row height').toBeLessThan(140);
		}
	} finally {
		for (const path of calendars) await deleteCalendar(request, path);
	}
});
