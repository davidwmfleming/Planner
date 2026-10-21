import { expect, test } from './fixtures';
import { putEntry } from './calendar-server';
import { unique } from './unique';

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
