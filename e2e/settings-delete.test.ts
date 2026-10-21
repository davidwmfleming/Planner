import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { futureWeek, iso } from './dates';
import { unique } from './unique';
import { deleteCalendar, hasEntry, makeCalendar, putEntry } from './calendar-server';

const { mon, wed } = futureWeek();
const thu = iso(new Date(new Date(`${mon}T12:00`).getTime() + 3 * 86_400_000));
const day = wed.replace(/-/g, '');

/** An event as a phone would save it; the repeating one carries a one-off change, which a move must keep. */
const event = (uid: string, title: string, repeat = false) =>
	[
		'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
		'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261019T120000Z', `DTSTART:${day}T090000`, `SUMMARY:${title}`, ...(repeat ? ['RRULE:FREQ=DAILY;COUNT=3'] : []), 'END:VEVENT',
		...(repeat ? ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261019T120000Z', `RECURRENCE-ID:${day}T090000`, `DTSTART:${day}T110000`, `SUMMARY:${title}`, 'END:VEVENT'] : []),
		'END:VCALENDAR', ''
	].join('\r\n');

/** A calendar of our own, made as another device would, holding these entries. */
async function calendarWith(request: APIRequestContext, info: TestInfo, label: string, entries: string[] = []) {
	const name = unique(label, info);
	const slug = `${label.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
	const path = await makeCalendar(request, slug, name);
	for (const [i, title] of entries.entries()) await putEntry(request, path, `${slug}-${i}.ics`, event(`${slug}-${i}`, title, i === 0));
	return { name, slug, path };
}

const calendarsOn = (page: Page) => page.getByRole('region', { name: 'Event calendars' });

test('a calendar can be deleted after moving its items to another calendar, one-off changes and all', async ({ page, request }, info) => {
	const piano = unique('Piano', info);
	const from = await calendarWith(request, info, 'Lessons', [piano, 'Swim']);
	const to = await calendarWith(request, info, 'Kids');
	try {
		await page.goto('/settings');
		const calendars = calendarsOn(page);
		await calendars.getByRole('button', { name: `Delete ${from.name}` }).click();
		const confirm = calendars.getByRole('group', { name: `Delete ${from.name}` });
		await expect(confirm).toContainText(`${from.name} holds 2 items.`);
		await expect(confirm).toContainText('disappears from every phone and computer that syncs it');
		// Nothing is chosen for David, so a hasty tap can't delete anything.
		await expect(confirm.getByRole('radio', { checked: true })).toHaveCount(0);
		await expect(confirm.getByRole('button', { name: /delete/i })).toHaveCount(0);

		await confirm.getByLabel('Calendar to move them to').selectOption({ label: to.name });
		await expect(confirm.getByRole('radio', { name: 'Move them to' })).toBeChecked();
		await confirm.getByRole('button', { name: `Move 2 items to ${to.name} and delete ${from.name}` }).click();

		await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toHaveText(`Deleted ${from.name}. Its 2 items are now in ${to.name}.`);
		await expect(calendars.getByRole('list').getByText(from.name, { exact: true })).toHaveCount(0);
		expect(await hasEntry(request, to.path, `${from.slug}-0.ics`)).toBe(true);
		expect(await hasEntry(request, to.path, `${from.slug}-1.ics`)).toBe(true);

		// On the planner, the repeat keeps its one-off change (11:00 on the first day, 9:00 after).
		await page.goto(`/?page=${wed}`);
		const shown = (date: string) => page.locator(`section.day[data-date="${date}"] li[data-calendar="${to.path}"]`, { hasText: piano });
		await expect(shown(wed)).toContainText('11:00');
		await page.goto(`/?page=${thu}`);
		await expect(shown(thu)).toContainText('9:00');
	} finally {
		await deleteCalendar(request, from.path);
		await deleteCalendar(request, to.path);
	}
});

test('a calendar can be deleted with its items, and Cancel leaves it alone', async ({ page, request }, info) => {
	const doomed = await calendarWith(request, info, 'Old', ['Gone soon']);
	try {
		await page.goto('/settings');
		const calendars = calendarsOn(page);
		const del = calendars.getByRole('button', { name: `Delete ${doomed.name}` });
		await del.click();
		const confirm = calendars.getByRole('group', { name: `Delete ${doomed.name}` });
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(confirm).toHaveCount(0);
		await expect(del).toBeFocused();

		// Escape closes it too, back on the Delete button.
		await del.click();
		await confirm.getByRole('radio', { name: 'Delete them too' }).press('Escape');
		await expect(confirm).toHaveCount(0);
		await expect(del).toBeFocused();

		await del.click();
		await confirm.getByRole('radio', { name: 'Delete them too' }).check();
		await confirm.getByRole('button', { name: `Delete ${doomed.name} and its 1 item` }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toHaveText(`Deleted ${doomed.name} and its 1 item.`);
		await expect(calendars.getByRole('list').getByText(doomed.name, { exact: true })).toHaveCount(0);
		await page.reload();
		await expect(calendars.getByRole('list').getByText(doomed.name, { exact: true })).toHaveCount(0);
	} finally {
		await deleteCalendar(request, doomed.path);
	}
});

test('an empty calendar is deleted with one confirm, and a double tap sends it once', async ({ page, request }, info) => {
	const empty = await calendarWith(request, info, 'Empty');
	let sent = 0;
	page.on('request', (r) => r.method() === 'POST' && r.url().includes('/delete') && sent++);
	await page.goto('/settings');
	const calendars = calendarsOn(page);
	await calendars.getByRole('button', { name: `Delete ${empty.name}` }).click();
	const confirm = calendars.getByRole('group', { name: `Delete ${empty.name}` });
	await expect(confirm).toContainText(`${empty.name} is empty.`);
	await expect(confirm.getByRole('radio')).toHaveCount(0);
	await confirm.getByRole('button', { name: `Delete ${empty.name}`, exact: true }).dblclick();
	await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toHaveText(`Deleted ${empty.name}.`);
	await expect(calendars.getByRole('list').getByText(empty.name, { exact: true })).toHaveCount(0);
	expect(sent).toBe(1);
});

test('nothing is deleted if an item arrived on another device after the count was shown', async ({ page, request }, info) => {
	const busy = await calendarWith(request, info, 'Busy', ['First']);
	try {
		await page.goto('/settings');
		const calendars = calendarsOn(page);
		await calendars.getByRole('button', { name: `Delete ${busy.name}` }).click();
		const confirm = calendars.getByRole('group', { name: `Delete ${busy.name}` });
		await expect(confirm).toContainText('holds 1 item.');
		await putEntry(request, busy.path, 'late.ics', event(`late-${busy.slug}`, 'Added on the phone'));

		await confirm.getByRole('radio', { name: 'Delete them too' }).check();
		await confirm.getByRole('button', { name: `Delete ${busy.name} and its 1 item` }).click();
		await expect(confirm.getByRole('alert')).toHaveText(`${busy.name} changed since you looked, so nothing was deleted. It now holds 2 items.`);
		expect(await hasEntry(request, busy.path, 'late.ics')).toBe(true);
		// The count shown is now the true one, and deleting goes ahead only with it.
		await expect(confirm).toContainText('holds 2 items.');
		await confirm.getByRole('button', { name: `Delete ${busy.name} and its 2 items` }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toHaveText(`Deleted ${busy.name} and its 2 items.`);
	} finally {
		await deleteCalendar(request, busy.path);
	}
});

test('a calendar deleted on another device meanwhile says to reload, with a Reload button', async ({ page, request }, info) => {
	const twice = await calendarWith(request, info, 'Twice');
	await page.goto('/settings');
	const calendars = calendarsOn(page);
	await calendars.getByRole('button', { name: `Delete ${twice.name}` }).click();
	const confirm = calendars.getByRole('group', { name: `Delete ${twice.name}` });
	await expect(confirm).toContainText('is empty.');
	await deleteCalendar(request, twice.path);
	await confirm.getByRole('button', { name: `Delete ${twice.name}`, exact: true }).click();
	await expect(confirm.getByRole('alert')).toContainText("isn't there any more; reload the page");
	await confirm.getByRole('button', { name: 'Reload' }).click();
	await expect(calendars.getByRole('list').getByText(twice.name, { exact: true })).toHaveCount(0);
});

test('the Tasks list has no Delete button', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByRole('region', { name: 'Task list' }).getByRole('button')).toHaveCount(0);
	await expect(calendarsOn(page).getByRole('button', { name: /^Delete Tasks/ })).toHaveCount(0);
});

test('the delete confirm fits a narrow phone and its controls are easy to hit', async ({ page, request }, info) => {
	const long = await calendarWith(request, info, 'Grandparents', ['Visit']);
	try {
		for (const width of [320, 390]) {
			await page.setViewportSize({ width, height: 700 });
			await page.goto('/settings');
			const calendars = calendarsOn(page);
			await calendars.getByRole('button', { name: `Delete ${long.name}` }).click();
			const confirm = calendars.getByRole('group', { name: `Delete ${long.name}` });
			await confirm.getByLabel('Calendar to move them to').selectOption({ label: 'Me' });
			const controls = [
				confirm.getByRole('radio', { name: 'Move them to' }),
				confirm.getByRole('radio', { name: 'Delete them too' }),
				confirm.getByLabel('Calendar to move them to'),
				confirm.getByRole('button', { name: `Move 1 item to Me and delete ${long.name}` }),
				confirm.getByRole('button', { name: 'Cancel' })
			];
			for (const control of controls) {
				await expect(control).toBeVisible();
				// A radio is hit through its whole label line, which is the tap target.
				const box = (await control.locator('xpath=ancestor-or-self::label[1] | self::select | self::button').first().boundingBox())!;
				expect(box.height, `at ${width}px`).toBeGreaterThanOrEqual(44);
			}
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
			expect(overflow, `at ${width}px`).toBe(0);
		}
	} finally {
		await deleteCalendar(request, long.path);
	}
});
