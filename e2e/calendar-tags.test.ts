import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { futureWeek, iso } from './dates';
import { unique } from './unique';
import { deleteCalendar, makeCalendar, putEntry } from './calendar-server';

// Every row says which calendar it is in, in a few letters, except tasks in the main Tasks list.
const SHOTS = process.env.TAG_SHOTS;

/** The calendar tag on a row: what it shows, and its full name for a screen reader and a long press. */
const calendarTag = (row: Locator) => row.locator('.cal-tag');

async function expectTag(row: Locator, shown: string, calendar: string) {
	await expect(calendarTag(row)).toHaveCount(1);
	await expect(calendarTag(row).locator('[aria-hidden="true"]')).toHaveText(shown);
	await expect(calendarTag(row)).toHaveAttribute('title', `In ${calendar}`);
	await expect(row.getByText(`in ${calendar}`)).toBeAttached();
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const entry = (component: 'VEVENT' | 'VTODO', uid: string, day: string, title: string, time = '090000') =>
	['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', `BEGIN:${component}`, `UID:${uid}`, 'DTSTAMP:20260101T000000Z',
		`DTSTART:${day.replaceAll('-', '')}T${time}`, `SUMMARY:${title}`, `END:${component}`, 'END:VCALENDAR', ''].join('\r\n');

test('events show their calendar in a few letters; Work events say Work once; main-list tasks have no tag', async ({ page }) => {
	await page.goto('/');
	const today = page.locator(`section.day[data-date="${iso(new Date())}"]`);
	await expectTag(today.locator('li', { hasText: 'ADHD follow-up' }), 'Me', 'Me');
	const econ = today.locator('li.work', { hasText: 'Economic Modelling' });
	await expect(econ.locator('.tag')).toHaveCount(1);
	await expectTag(econ, 'Work', 'Work');
	await expect(econ.locator('.work-tag')).toBeVisible();
	await expect(today.locator('li', { hasText: 'Green cart' }).locator('.tag')).toHaveCount(0);
});

/** Sets up a calendar with one entry on Wednesday of a future week, opens that page, and returns the row. */
async function withEntry(page: Page, request: APIRequestContext, info: TestInfo, calendarName: string, title: string, component: 'VEVENT' | 'VTODO' = 'VEVENT') {
	const { wed } = futureWeek();
	const name = unique(title, info);
	const slug = slugOf(`${name}-${calendarName}`).slice(0, 60);
	const path = await makeCalendar(request, slug, calendarName, [component]);
	await putEntry(request, path, `${slug}.ics`, entry(component, `qa-${slug}`, wed, name));
	await page.goto(`/?page=${wed}`);
	return { row: page.locator(`section.day[data-date="${wed}"] li[data-uid]`, { hasText: name }), name, path };
}

// Calendar names are shared by every test running at once, so each test makes its own, on the phone only:
// two calendars with the same name would get the end of their address in the tag.
test('a task in a list other than Tasks shows that list', async ({ page, request }, info) => {
	test.skip(info.project.name !== 'phone', 'makes a calendar');
	const { row, path } = await withEntry(page, request, info, 'Shopping', 'Buy bin bags', 'VTODO');
	try {
		await expectTag(row, 'Shop', 'Shopping');
	} finally {
		await deleteCalendar(request, path);
	}
});

test('a calendar named with emoji and accents is cut after 4 letters, not in the middle of one', async ({ page, request }, info) => {
	test.skip(info.project.name !== 'phone', 'makes a calendar');
	const { row, path } = await withEntry(page, request, info, '🎉 Fêtes de famille', 'Birthday tea');
	try {
		await expectTag(row, '🎉 Fê', '🎉 Fêtes de famille');
	} finally {
		await deleteCalendar(request, path);
	}
});

// David's request: the tag must not take too much room. At 320 wide (iPhone SE with Display Zoom) and 390 (most
// iPhones) the title keeps most of the row, and a short row stays one line tall.
for (const [width, calendar, tag] of [[320, 'Swim club', 'Swim'], [390, 'Choir practice', 'Choi']] as const) {
	test(`the calendar tag leaves the title most of the row at ${width} wide`, async ({ page, request }, info) => {
		test.skip(info.project.name !== 'phone', 'phone sizes, set here');
		await page.setViewportSize({ width, height: 700 });
		const { row, name, path } = await withEntry(page, request, info, calendar, 'Lesson then pick up from the pool');
		try {
			await expectTag(row, tag, calendar);
			const title = (await row.getByRole('button', { name: `Details for ${name}` }).boundingBox())!;
			const box = (await row.boundingBox())!;
			expect(title.width, 'title width').toBeGreaterThan(100);
			expect(title.width, 'title share of the row').toBeGreaterThan(box.width * 0.4);
			if (SHOTS) await page.screenshot({ path: `${SHOTS}/calendar-tags-${width}.png` });
		} finally {
			await deleteCalendar(request, path);
		}
	});

	test(`a Work event keeps one tag and a readable title at ${width} wide`, async ({ page }, info) => {
		test.skip(info.project.name !== 'phone', 'phone sizes, set here');
		await page.setViewportSize({ width, height: 700 });
		await page.goto('/');
		const econ = page.locator(`section.day[data-date="${iso(new Date())}"] li.work`, { hasText: 'Economic Modelling' });
		await expect(econ.locator('.tag')).toHaveCount(1);
		const title = (await econ.getByRole('button', { name: 'Details for Economic Modelling' }).boundingBox())!;
		expect(title.width, 'title width').toBeGreaterThan(100);
		if (SHOTS) {
			await econ.scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${SHOTS}/calendar-tags-today-${width}.png` });
		}
	});
}
