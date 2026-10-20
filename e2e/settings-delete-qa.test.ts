// QA's findings on deleting a calendar (from the review of c4efaad), kept as tests.
import type { APIRequestContext, Page, Route, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { futureWeek } from './dates';
import { unique } from './unique';
import { deleteCalendar, hasEntry, makeCalendar, putEntry } from './calendar-server';

const { wed } = futureWeek();
const day = wed.replace(/-/g, '');
const event = (uid: string, title: string) =>
	['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261019T120000Z', `DTSTART:${day}T090000`, `SUMMARY:${title}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
const todo = (uid: string, title: string) =>
	['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VTODO', `UID:${uid}`, 'DTSTAMP:20261019T120000Z', `SUMMARY:${title}`, 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');

async function calendarWith(request: APIRequestContext, info: TestInfo, label: string, components = ['VEVENT']) {
	const name = unique(label, info);
	const slug = `${label.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
	return { name, slug, path: await makeCalendar(request, slug, name, components) };
}
const calendarsOn = (page: Page) => page.getByRole('region', { name: 'Event calendars' });

/** Holds the page's delete request until `release` is called, as a slow home server would. */
async function holdDeletes(page: Page) {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route(/\/settings\?\/delete/, async (route: Route) => {
		await held;
		await route.continue();
	});
	return () => release();
}

test('while a delete is under way, Cancel is not offered, since it cannot stop it', async ({ page, request }, info) => {
	const doomed = await calendarWith(request, info, 'Slow');
	await putEntry(request, doomed.path, 'a.ics', event(`a-${doomed.slug}`, 'Kept if cancelled'));
	try {
		await page.goto('/settings');
		const calendars = calendarsOn(page);
		await calendars.getByRole('button', { name: `Delete ${doomed.name}` }).click();
		const confirm = calendars.getByRole('group', { name: `Delete ${doomed.name}` });
		await confirm.getByRole('radio', { name: 'Delete them too' }).check();
		const release = await holdDeletes(page);
		await confirm.getByRole('button', { name: `Delete ${doomed.name} and its 1 item` }).click();
		await expect(confirm.getByRole('button', { name: 'Deleting…' })).toBeVisible();
		// On c4efaad Cancel stays, closes the confirm, and the calendar and its item are deleted anyway.
		await expect(confirm.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
		release();
		await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toHaveText(`Deleted ${doomed.name} and its 1 item.`);
	} finally {
		await deleteCalendar(request, doomed.path);
	}
});

test('a refused move is reported with its own calendar when another Delete was tapped meanwhile', async ({ page, request }, info) => {
	const mixed = await calendarWith(request, info, 'Mixed', ['VEVENT', 'VTODO']);
	const eventsOnly = await calendarWith(request, info, 'EvOnly');
	await putEntry(request, mixed.path, 't.ics', todo(`t-${mixed.slug}`, 'A task'));
	try {
		await page.goto('/settings');
		const calendars = calendarsOn(page);
		await calendars.getByRole('button', { name: `Delete ${mixed.name}` }).click();
		const confirm = calendars.getByRole('group', { name: `Delete ${mixed.name}` });
		await confirm.getByLabel('Calendar to move them to').selectOption({ label: eventsOnly.name });
		const release = await holdDeletes(page);
		await confirm.getByRole('button', { name: `Move 1 item to ${eventsOnly.name} and delete ${mixed.name}` }).click();
		await calendars.getByRole('button', { name: `Delete ${eventsOnly.name}` }).click();
		release();
		await expect(page.getByRole('alert').filter({ hasText: 'only takes events' })).toBeVisible();
		// On c4efaad the refusal about Mixed is shown inside EvOnly's confirm, as if it were about EvOnly.
		// (With Cancel instead of the second Delete, it isn't shown at all.)
		await expect(calendars.getByRole('group', { name: `Delete ${eventsOnly.name}` }).getByRole('alert')).toHaveCount(0);
	} finally {
		await deleteCalendar(request, mixed.path);
		await deleteCalendar(request, eventsOnly.path);
	}
});

test('after a move that stopped part way, the confirm names what is left, not the old count', async ({ page, request }, info) => {
	const from = await calendarWith(request, info, 'Part');
	const to = await calendarWith(request, info, 'Into');
	await putEntry(request, from.path, 'a.ics', event(`a-${from.slug}`, 'Moves'));
	await putEntry(request, from.path, 'b.ics', event(`b-${from.slug}`, 'Stays'));
	// Another item already has that file name in the target, so b.ics can't go there.
	await putEntry(request, to.path, 'b.ics', event(`other-${to.slug}`, 'Someone else'));
	try {
		await page.goto('/settings');
		const calendars = calendarsOn(page);
		await calendars.getByRole('button', { name: `Delete ${from.name}` }).click();
		const confirm = calendars.getByRole('group', { name: `Delete ${from.name}` });
		await confirm.getByLabel('Calendar to move them to').selectOption({ label: to.name });
		await confirm.getByRole('button', { name: `Move 2 items to ${to.name} and delete ${from.name}` }).click();
		await expect(confirm.getByRole('alert')).toContainText('Moved 1 of 2 items');
		expect(await hasEntry(request, from.path, 'b.ics')).toBe(true);
		// The confirm button must name exactly what a second tap would do. On c4efaad it still says 2 items.
		await expect(confirm.getByRole('button', { name: /^Move 2 items/ })).toHaveCount(0);
	} finally {
		await deleteCalendar(request, from.path);
		await deleteCalendar(request, to.path);
	}
});
