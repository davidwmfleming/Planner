// Shared calendar links. Every link is kept in one stored list, so playwright.config.ts runs this file on its own.
import { expect, test } from './fixtures';
import { deleteCalendar, makeCalendar, putEntry } from './calendar-server';
import { unique } from './unique';

test('a calendar can be shared with a link, given a new link, and stopped; only the link is reachable from the internet', async ({ page, request }, info) => {
	const name = unique('Club', info).trim();
	const slug = `club-${info.project.name}-${Date.now()}`;
	const path = await makeCalendar(request, slug, name);
	try {
		await putEntry(request, path, 'meeting.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', 'UID:club-meeting', 'DTSTAMP:20261029T120000Z', 'DTSTART:20261105T190000Z', 'SUMMARY:Club meeting', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'));
		await page.goto('/settings');
		const sharing = page.getByRole('region', { name: 'Shared links' });
		await sharing.getByRole('button', { name: `Share ${name}`, exact: true }).click();
		const field = sharing.getByRole('textbox', { name: `Link for ${name}` });
		await expect(field).toHaveValue(/\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
		const first = await field.inputValue();

		const feed = await request.get(first, { headers: { 'Tailscale-Funnel-Request': '?1' } });
		expect(feed.status()).toBe(200);
		expect(feed.headers()['content-type']).toContain('text/calendar');
		expect(await feed.text()).toContain('SUMMARY:Club meeting');
		// From the internet, nothing else answers.
		for (const other of ['/settings', '/', '/dav/david/']) expect((await request.get(other, { headers: { 'Tailscale-Funnel-Request': '?1' } })).status()).toBe(404);

		await sharing.getByRole('button', { name: `Copy the link for ${name}` }).click();
		await sharing.getByRole('button', { name: `New link for ${name}` }).click();
		await expect(field).not.toHaveValue(first);
		const second = await field.inputValue();
		expect((await request.get(first)).status()).toBe(404);
		expect((await request.get(second)).status()).toBe(200);

		await sharing.getByRole('button', { name: `Stop sharing ${name}` }).click();
		await expect(field).toHaveCount(0);
		await expect(sharing.getByRole('button', { name: `Share ${name}`, exact: true })).toBeVisible();
		expect((await request.get(second)).status()).toBe(404);
		// Still off after a reload.
		await page.reload();
		await expect(page.getByRole('region', { name: 'Shared links' }).getByRole('button', { name: `Share ${name}`, exact: true })).toBeVisible();
	} finally {
		await deleteCalendar(request, path);
	}
});
