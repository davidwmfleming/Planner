import { expect, test } from './fixtures';
import { deleteCalendar, makeCalendar, putEntry } from './calendar-server';
import { futureWeek } from './dates';
import { unique } from './unique';

const { mon, tue } = futureWeek();

/** The calendar server itself, not the planner's calendar-app address: what a phone app's sync writes is stored as sent. */
const RADICALE = 'http://127.0.0.1:5233';
const auth = { Authorization: `Basic ${Buffer.from('david:dev').toString('base64')}` };

const event = (uid: string, title: string, extra = '') =>
	`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Some phone app//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261019T120000Z\r\nDTSTART;VALUE=DATE:${tue.replaceAll('-', '')}\r\nSUMMARY:${title}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;

test('one item another app saved badly is left out with a note; the rest of the planner still shows', async ({ page, request }, info) => {
	const slug = `unreadable-${info.project.name}-${Math.random().toString(36).slice(2, 8)}`;
	const path = await makeCalendar(request, slug, unique('From a phone', info));
	try {
		const fine = unique('Swim', info);
		const broken = unique('Badly saved', info);
		await putEntry(request, path, 'fine.ics', event(`${slug}-fine`, fine));
		// The app's own property claims to be a repeat rule but isn't one: Radicale keeps it, and the planner can't read it.
		const bad = await request.fetch(`${RADICALE}${path}bad.ics`, {
			method: 'PUT',
			headers: { ...auth, 'Content-Type': 'text/calendar' },
			data: event(`${slug}-bad`, broken, 'X-SOME-APP-SNOOZE;VALUE=RECUR:FREQ=NEVER\r\n')
		});
		expect(bad.ok(), 'the calendar server keeps what the phone app sent').toBe(true);

		await page.goto(`/?page=${mon}`);
		// Not the calendar server's error page: the page is drawn, with everything that can be read.
		await expect(page.getByText("The calendar server isn't answering")).toHaveCount(0);
		await expect(page.locator(`section.day[data-date="${tue}"] li`, { hasText: fine })).toBeVisible();
		await expect(page.getByText(broken)).toHaveCount(0);
		// Other tests may have one of their own in at the same moment, so the count isn't checked, only the wording.
		const note = page.locator('p.notice', { hasText: "couldn't be read" });
		await expect(note).toHaveText(/^(1 item couldn't be read and isn't shown|\d+ items couldn't be read and aren't shown)\.$/);
		await expect(note).toBeInViewport();
		// The day's lines still work: a line written now is saved.
		const added = unique('Dentist', info);
		await page.locator(`#add-event-${tue}`).fill(added);
		await page.locator(`#add-event-${tue}`).press('Enter');
		await expect(page.locator(`section.day[data-date="${tue}"] li`, { hasText: added })).toBeVisible();
	} finally {
		await deleteCalendar(request, path);
	}
});
