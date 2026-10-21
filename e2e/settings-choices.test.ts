// These change which calendar is Work and where new events go, which every page shows,
// so playwright.config.ts runs this file on its own, after all the other tests.
import { expect, test } from './fixtures';
import { futureWeek, iso } from './dates';
import { unique } from './unique';
import { deleteCalendar, makeCalendar } from './calendar-server';
import type { Page } from '@playwright/test';

const { wed: day } = futureWeek();

async function choose(page: Page, choices: { work?: string; newEvents?: string }) {
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	if (choices.work) await calendars.getByLabel('Show as work (light red)').selectOption({ label: choices.work });
	if (choices.newEvents) await calendars.getByLabel('New events go in').selectOption({ label: choices.newEvents });
	await calendars.getByRole('button', { name: 'Save choices' }).click();
	await expect(calendars.getByRole('status')).toHaveText('Saved');
	await expect(calendars.getByRole('button', { name: 'Save choices' })).toBeFocused();
}

/** Picks calendars by path, for when two have the same name. */
async function chooseByPath(page: Page, choices: { work: string; newEvents: string }) {
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByLabel('Show as work (light red)').selectOption(choices.work);
	await calendars.getByLabel('New events go in').selectOption(choices.newEvents);
	await calendars.getByRole('button', { name: 'Save choices' }).click();
	await expect(calendars.getByRole('status')).toHaveText('Saved');
}

async function addCalendar(page: Page, name: string) {
	await page.goto('/settings');
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByLabel('New calendar').fill(name);
	await calendars.getByRole('button', { name: 'Add calendar' }).click();
	await expect(calendars.getByRole('list').getByText(name, { exact: true })).toBeVisible();
}

// Whatever happens, the next tests start with the usual choices.
test.afterEach(async ({ page }) => {
	await choose(page, { work: 'Work', newEvents: 'Me' });
});

test('the Work shading follows the calendar chosen on the settings page, through a rename', async ({ page }, info) => {
	const office = unique('Office', info);
	const renamed = unique('Day job', info);
	const meeting = unique('Board meeting', info);
	await addCalendar(page, office);
	await choose(page, { work: office });
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await expect(calendars.locator('li.work')).toHaveCount(1);
	await expect(calendars.locator('li.work')).toContainText(office);
	await expect(calendars.getByLabel('Show as work (light red)').locator('option:checked')).toHaveText(office);

	// An event filed in it is shaded; the old Work calendar's meetings are not.
	await page.goto(`/?page=${day}`);
	await page.locator(`#add-event-${day}`).fill(`10am ${meeting}`);
	await page.locator(`#add-event-${day}`).press('Enter');
	const row = page.locator(`section.day[data-date="${day}"] li`, { hasText: meeting });
	await row.getByRole('button', { name: `Details for ${meeting}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await sheet.locator('#f-calendar').selectOption(office);
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(row).toHaveClass(/work/);
	await expect(row).toHaveCSS('background-color', 'rgb(253, 228, 228)');
	await page.goto('/');
	await expect(page.locator('li', { hasText: 'Economic Modelling' })).not.toHaveClass(/work/);

	// Renamed, it is still the Work calendar.
	await page.goto('/settings');
	await calendars.getByRole('button', { name: `Rename ${office}` }).click();
	await calendars.getByLabel(`New name for ${office}`).fill(renamed);
	await calendars.getByRole('button', { name: 'Save name' }).click();
	await expect(calendars.locator('li.work')).toContainText(renamed);
	await expect(calendars.getByLabel('Show as work (light red)').locator('option:checked')).toHaveText(renamed);
	await page.goto(`/?page=${day}`);
	await expect(row).toHaveClass(/work/);
});

/** Each calendar's tag text on the page shown, so two calendars showing the same tag can be caught. */
async function tagsByCalendar(page: Page) {
	const rows = await page.locator('li[data-calendar]:has(.cal-tag)').evaluateAll((lis) =>
		lis.map((li) => [li.getAttribute('data-calendar'), li.querySelector('.cal-tag [aria-hidden]')?.textContent] as const)
	);
	return new Map(rows);
}

test('the work calendar is tagged Work whatever its name, and no other calendar is', async ({ page }, info) => {
	const job = unique('Job', info);
	const gym = unique('Gym session', info);
	const standup = unique('Standup', info);
	await addCalendar(page, job);
	await choose(page, { work: job });
	await page.goto(`/?page=${day}`);
	const sheet = page.getByRole('dialog', { name: 'Details' });
	for (const [line, title, calendar] of [[`7am ${gym}`, gym, 'Workouts'], [`9am ${standup}`, standup, job]]) {
		await page.locator(`#add-event-${day}`).fill(line);
		await page.locator(`#add-event-${day}`).press('Enter');
		await page.locator(`section.day[data-date="${day}"] li`, { hasText: title }).getByRole('button', { name: `Details for ${title}` }).click();
		await sheet.locator('#f-calendar').selectOption({ label: calendar });
		await sheet.getByRole('button', { name: 'Save' }).click();
		await expect(sheet).toBeHidden();
	}
	const tag = (title: string) => page.locator(`section.day[data-date="${day}"] li`, { hasText: title }).locator('.cal-tag');
	await expect(tag(standup).locator('[aria-hidden]')).toHaveText('Work');
	await expect(tag(standup)).toHaveClass(/work-tag/);
	await expect(tag(standup)).toHaveAttribute('title', `In ${job}`);
	await expect(tag(gym).locator('[aria-hidden]')).toHaveText('Worko');
	await expect(tag(gym)).not.toHaveClass(/work-tag/);
	const onDay = await tagsByCalendar(page);
	expect(new Set(onDay.values()).size, 'one tag text per calendar').toBe(onDay.size);

	// The calendar still called Work is no longer the work calendar, so its tag must say something else.
	await page.goto('/');
	const econ = page.locator(`section.day[data-date="${iso(new Date())}"] li`, { hasText: 'Economic Modelling' }).locator('.cal-tag');
	await expect(econ.locator('[aria-hidden]')).toHaveText('Work 2');
	await expect(econ).not.toHaveClass(/work-tag/);
	const today = await tagsByCalendar(page);
	expect(new Set(today.values()).size, 'one tag text per calendar').toBe(today.size);
});

test('no calendar can be shaded as work', async ({ page }) => {
	await choose(page, { work: 'None' });
	await expect(page.getByRole('region', { name: 'Event calendars' }).locator('li.work')).toHaveCount(0);
	await page.goto('/');
	await expect(page.locator(`section.day[data-date="${iso(new Date())}"] li`, { hasText: 'Economic Modelling' })).not.toHaveClass(/work/);
});

test('new events go in the calendar chosen on the settings page', async ({ page }, info) => {
	const name = unique('Swim lesson', info);
	await choose(page, { newEvents: 'Family' });
	await expect(page.getByRole('region', { name: 'Event calendars' }).getByRole('listitem').filter({ hasText: 'New events' })).toContainText('Family');

	await page.goto(`/?page=${day}`);
	await page.locator(`#add-event-${day}`).fill(`5pm ${name}`);
	await page.locator(`#add-event-${day}`).press('Enter');
	const row = page.locator(`section.day[data-date="${day}"] li`, { hasText: name });
	await row.getByRole('button', { name: `Details for ${name}` }).click();
	await expect(page.getByRole('dialog', { name: 'Details' }).locator('#f-calendar option:checked')).toHaveText('Family');
});

test('a line still saves when the new-events calendar was deleted on another device', async ({ page, request }, info) => {
	const name = unique('Gone', info);
	const event = unique('Vet', info);
	await addCalendar(page, name);
	await choose(page, { newEvents: name });
	await page.goto(`/?page=${day}`);
	await deleteCalendar(request, `/david/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}/`);

	await page.locator(`#add-event-${day}`).fill(`3pm ${event}`);
	await page.locator(`#add-event-${day}`).press('Enter');
	await expect(page.locator(`section.day[data-date="${day}"] li`, { hasText: event })).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('two calendars with the same name from another device are kept apart', async ({ page, request }, info) => {
	const name = unique('Twin', info);
	// Short, so the menus show the whole address ending (a long one shows only its last 12 letters).
	const stamp = Math.random().toString(36).slice(2, 6);
	const [first, second] = [await makeCalendar(request, `twin-a-${stamp}`, name), await makeCalendar(request, `twin-b-${stamp}`, name)];
	const event = unique('Twin meeting', info);
	try {
		await chooseByPath(page, { work: first, newEvents: second });
		await page.goto(`/?page=${day}`);
		await page.locator(`#add-event-${day}`).fill(`9am ${event}`);
		await page.locator(`#add-event-${day}`).press('Enter');
		const row = page.locator(`section.day[data-date="${day}"] li`, { hasText: event });
		await expect(row).toBeVisible();
		await expect(row).not.toHaveClass(/work/); // it is in the other calendar of that name

		// The details sheet opens and offers both.
		await row.getByRole('button', { name: `Details for ${event}` }).click();
		const sheet = page.getByRole('dialog', { name: 'Details' });
		await expect(sheet).toBeVisible();
		await expect(sheet.locator('#f-calendar option', { hasText: name })).toHaveCount(2);
		await expect(sheet.locator('#f-calendar')).toHaveValue(second);
		// Each says which one it is, by the end of its address.
		expect(await sheet.locator('#f-calendar option', { hasText: name }).allInnerTexts()).toEqual(
			expect.arrayContaining([`${name} (twin-a-${stamp})`, `${name} (twin-b-${stamp})`])
		);
		await sheet.getByRole('button', { name: 'Cancel' }).click();

		const settings = page.getByRole('region', { name: 'Event calendars' });
		await page.goto('/settings');
		for (const menu of ['Show as work (light red)', 'New events go in']) {
			const twins = await settings.getByLabel(menu).locator('option', { hasText: name }).allInnerTexts();
			expect(twins.sort()).toEqual([`${name} (twin-a-${stamp})`, `${name} (twin-b-${stamp})`]);
		}
		expect(await settings.getByLabel('New events go in').locator('option').allInnerTexts()).toContain('Work');

		await chooseByPath(page, { work: second, newEvents: second });
		await page.goto(`/?page=${day}`);
		await expect(row).toHaveClass(/work/);
	} finally {
		await deleteCalendar(request, first);
		await deleteCalendar(request, second);
	}
});

test('choosing a calendar deleted on another device since Settings opened says to reload, not Saved', async ({ page, request }, info) => {
	const name = unique('Gone choice', info);
	const path = await makeCalendar(request, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name);
	try {
		await page.goto('/settings');
		const calendars = page.getByRole('region', { name: 'Event calendars' });
		await calendars.getByLabel('New events go in').selectOption({ label: name });
	} finally {
		await deleteCalendar(request, path);
	}
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByRole('button', { name: 'Save choices' }).click();
	await expect(calendars.getByRole('alert')).toContainText('reload the page');
	await expect(calendars.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
	await expect(calendars.getByRole('status').filter({ hasText: 'Saved' })).toHaveCount(0);
});

test('deleting the Work and new-events calendar sets Work to none and new events to the first calendar left', async ({ page }, info) => {
	const name = unique('Aaa office', info); // first by name, so the fallback is plainly not "the one after it"
	await addCalendar(page, name);
	await choose(page, { work: name, newEvents: name });
	const calendars = page.getByRole('region', { name: 'Event calendars' });
	await calendars.getByRole('button', { name: `Delete ${name}` }).click();
	const confirm = calendars.getByRole('group', { name: `Delete ${name}` });
	await expect(confirm).toContainText('Work shading goes to None');
	await expect(confirm).toContainText('New events will go in');
	await confirm.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toHaveText(`Deleted ${name}.`);

	await page.reload();
	await expect(calendars.locator('li.work')).toHaveCount(0);
	await expect(calendars.getByLabel('Show as work (light red)').locator('option:checked')).toHaveText('None');
	const first = (await calendars.getByLabel('New events go in').locator('option').allInnerTexts())[0];
	await expect(calendars.getByLabel('New events go in').locator('option:checked')).toHaveText(first);
});

test('at 320 wide, a calendar tagged "New events" keeps its words whole', async ({ page }) => {
	await choose(page, { newEvents: 'Morgan Meals' });
	await page.setViewportSize({ width: 320, height: 700 });
	const row = page.getByRole('region', { name: 'Event calendars' }).getByRole('listitem').filter({ hasText: 'New events' });
	await expect(row).toContainText('Morgan Meals');
	// Each word of the name fits on its line: the name is at least as wide as its longest word.
	const [shown, longestWord] = await row.locator('.name').evaluate((el) => {
		const probe = Object.assign(document.createElement('span'), { textContent: 'Morgan' });
		el.append(probe);
		const word = probe.getBoundingClientRect().width;
		probe.remove();
		return [el.getBoundingClientRect().width, word];
	});
	expect(shown).toBeGreaterThanOrEqual(longestWord);
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBe(0);
});
