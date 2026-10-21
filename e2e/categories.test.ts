import { expect, test } from './fixtures';
import { putEntry } from './calendar-server';
import { futureWeek, iso } from './dates';
import { unique } from './unique';

const { mon, tue, wed } = futureWeek();
const thu = iso(new Date(new Date(`${wed}T12:00:00`).getTime() + 86_400_000));

const auth = { Authorization: `Basic ${Buffer.from('david:dev').toString('base64')}` };

test('a task shows its category by name, the List menu offers the categories in the settings, and other apps\' categories are kept', async ({ page, request }, info) => {
	const name = unique('Green cart', info);
	const uid = `cat-${Math.random().toString(36).slice(2, 10)}`;
	// Saved by an older planner (the key "waiting") and given a category of its own on a phone ("Home").
	await putEntry(request, '/david/tasks/', `${uid}.ics`, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phone//EN', 'BEGIN:VTODO', `UID:${uid}`,
		'DTSTAMP:20261019T000000Z', `SUMMARY:${name}`, 'STATUS:NEEDS-ACTION', 'CATEGORIES:Home,waiting', 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n'));

	await page.goto('/');
	const toggle = page.getByRole('button', { name: /Show future tasks/ });
	if (await toggle.isVisible()) await toggle.click();
	const row = page.locator('li', { hasText: name });
	await expect(row.locator('.tag')).toHaveText('Waiting');
	await expect(row.getByText('Home')).toHaveCount(0);

	await row.getByRole('button', { name: `Details for ${name}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	const list = sheet.locator('#f-label');
	expect(await list.locator('option').allInnerTexts()).toEqual(['None', 'This month', 'Waiting', 'Someday']);
	await expect(list).toHaveValue('Waiting');
	await list.selectOption({ label: 'This month' });
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();
	await expect(row.locator('.tag')).toHaveText('This month');

	const stored = await (await request.fetch(`/dav/david/tasks/${uid}.ics`, { headers: auth })).text();
	expect(stored).toContain('CATEGORIES:This month,Home');
	expect(stored).not.toMatch(/waiting/i);
});

// From QA: an older repeating task (keys, not names) with one day ticked and one moved, then the series' list changed.
for (const [kind, raw] of [['an old key', 'CATEGORIES:month'], ['a name', 'CATEGORIES:This month']]) {
	test(`every day of a repeating task follows a change of its list, when it was saved with ${kind}`, async ({ page, request }, info) => {
		const title = unique('Daily bins', info);
		const uid = `cat-${Math.random().toString(36).slice(2, 10)}`;
		await putEntry(request, '/david/tasks/', `${uid}.ics`, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phone//EN', 'BEGIN:VTODO', `UID:${uid}`,
			'DTSTAMP:20261019T000000Z', `SUMMARY:${title}`, 'STATUS:NEEDS-ACTION', `DTSTART;VALUE=DATE:${mon.replaceAll('-', '')}`, 'RRULE:FREQ=DAILY;COUNT=5',
			raw, 'CATEGORIES:Home', 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n'));
		await page.goto(`/?page=${mon}`);
		const on = (d: string) => page.locator(`section.day[data-date="${d}"] li`, { hasText: title });
		await on(tue).getByRole('button', { name: `Tick ${title}` }).click();
		await expect(on(tue)).toHaveClass(/done/);
		await on(wed).getByRole('button', { name: `Move ${title} to the next day` }).click();
		await expect(on(wed)).toHaveCount(0);

		await on(mon).getByRole('button', { name: `Details for ${title}` }).click();
		const sheet = page.getByRole('dialog', { name: 'Details' });
		await sheet.locator('#f-label').selectOption({ label: 'Someday' });
		await sheet.getByRole('button', { name: 'Save' }).click();
		await expect(sheet).toBeHidden();
		const tags = page.locator('section.day li[data-uid]', { hasText: title }).locator('.tag:not(.cal-tag)');
		await page.reload();
		await expect(tags).toHaveText(['Someday', 'Someday']);
		await expect(on(tue)).toHaveClass(/done/);
		// The page from Thursday: Thursday's own showing, Wednesday's moved there, and Friday's.
		await page.goto(`/?page=${thu}`);
		await expect(tags).toHaveText(['Someday', 'Someday', 'Someday']);
	});
}

// From QA: lists are for tasks. An event from another app keeps its categories but shows no list.
test('an event whose category from another app is a list name shows no list, and keeps its categories when saved', async ({ page, request }, info) => {
	const title = unique('Board meeting', info);
	const uid = `cat-${Math.random().toString(36).slice(2, 10)}`;
	await putEntry(request, '/david/me/', `${uid}.ics`, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phone//EN', 'BEGIN:VEVENT', `UID:${uid}`,
		'DTSTAMP:20261019T000000Z', `DTSTART:${tue.replaceAll('-', '')}T100000`, `SUMMARY:${title}`, 'CATEGORIES:Waiting,Business', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'));
	await page.goto(`/?page=${mon}`);
	const row = page.locator(`section.day[data-date="${tue}"] li`, { hasText: title });
	await expect(row).toBeVisible();
	await expect(row.locator('.tag:not(.cal-tag)')).toHaveCount(0);
	await row.getByRole('button', { name: `Details for ${title}` }).click();
	const sheet = page.getByRole('dialog', { name: 'Details' });
	await expect(sheet.locator('#f-title')).toBeVisible();
	await expect(sheet.locator('#f-label')).toHaveCount(0);
	await sheet.locator('#f-location').fill('Boardroom');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(sheet).toBeHidden();
	const stored = await (await request.fetch(`/dav/david/me/${uid}.ics`, { headers: auth })).text();
	expect(stored).toContain('CATEGORIES:Waiting,Business');
	expect(stored).toContain('LOCATION:Boardroom');
});
