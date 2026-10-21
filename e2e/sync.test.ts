import { expect, test } from './fixtures';
import { DAVClient } from 'tsdav';
import { futureWeek } from './dates';
import { unique } from './unique';

const { tue } = futureWeek();

// What Apple Calendar or DAVx⁵ does: find the calendars from the planner's own address, then read and write events.
async function calendarApp(baseURL: string, password = 'dev') {
	const client = new DAVClient({
		serverUrl: `${baseURL}/`,
		credentials: { username: 'david', password },
		authMethod: 'Basic',
		defaultAccountType: 'caldav'
	});
	await client.login();
	return client;
}

/** The calendar list, as a calendar app reads it. Radicale answers 500 to a listing when a calendar is deleted while
 * it lists (other tests running alongside delete theirs), so a server error is retried once, as a calendar app would. */
async function listCalendars(client: DAVClient) {
	try {
		return await client.fetchCalendars();
	} catch (e) {
		if (!/failed: 5\d\d\b/.test(e instanceof Error ? e.message : '')) throw e;
		return client.fetchCalendars();
	}
}

test('another calendar app finds the calendars, and events flow both ways', async ({ page, baseURL }, info) => {
	const client = await calendarApp(baseURL!);
	const calendars = await listCalendars(client);
	const work = calendars.find((c) => c.displayName === 'Work');
	expect(work, 'the Work calendar is offered to other apps').toBeTruthy();
	expect(new URL(work!.url).pathname).toMatch(/^\/dav\//);

	// Added in the other app, seen in the planner.
	const fromApp = unique('Dentist from phone', info);
	const uid = crypto.randomUUID();
	const day = tue.replaceAll('-', '');
	const made = await client.createCalendarObject({
		calendar: work!,
		filename: `${uid}.ics`,
		iCalString: ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261019T120000Z',
			`DTSTART:${day}T150000`, `DTEND:${day}T160000`, `SUMMARY:${fromApp}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')
	});
	expect(made.ok).toBe(true);
	await page.goto(`/?page=${tue}`);
	await expect(page.locator(`section.day[data-date="${tue}"] li.work`, { hasText: fromApp })).toContainText('3:00 pm');

	// Added in the planner, seen in the other app.
	const fromPlanner = unique('Haircut from planner', info);
	await page.locator(`#add-event-${tue}`).fill(`5pm ${fromPlanner}`);
	await page.locator(`#add-event-${tue}`).press('Enter');
	const line = page.locator(`section.day[data-date="${tue}"] li`, { hasText: fromPlanner });
	await expect(line).toBeVisible();
	// Only the calendar it was saved in is read: other tests running alongside add and delete calendars of their own,
	// so one listed a moment ago may be gone by the time it is read.
	const savedIn = await line.getAttribute('data-calendar');
	const calendar = calendars.find((c) => new URL(c.url).pathname === `/dav${savedIn}`);
	expect(calendar, `the planner's calendar ${savedIn} is offered to other apps`).toBeTruthy();
	const objects = await client.fetchCalendarObjects({ calendar: calendar! });
	expect(objects.some((o) => String(o.data).includes(fromPlanner))).toBe(true);
});

test('calendar apps need the calendar password, and the usual address leads them in', async ({ request, baseURL }) => {
	await expect(calendarApp(baseURL!, 'wrong')).rejects.toThrow();
	const found = await request.get('/.well-known/caldav', { maxRedirects: 0 });
	expect(found.status()).toBe(301);
	expect(found.headers()['location']).toBe('/dav/');
});

test('the calendar-app address cannot be used to reach other sites', async ({ request }) => {
	const auth = { Authorization: `Basic ${Buffer.from('david:dev').toString('base64')}` };
	expect((await request.get('/dav//example.com/', { headers: auth })).status()).toBe(400);
	const move = await request.fetch('/dav/david/x.ics', { method: 'MOVE', headers: { ...auth, Destination: 'http://localhost:4173/dav//example.com/x.ics' } });
	expect(move.status()).toBe(400);
});
