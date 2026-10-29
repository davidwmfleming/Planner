// A shared calendar link with a pretend calendar server: what a computer on the internet gets back.
import { describe, expect, it, vi } from 'vitest';

const SECRET = 'S'.repeat(43);
const ME = { url: 'http://cal/david/me/', name: 'Me', accepts: ['event'] };
const TASKS = { url: 'http://cal/david/tasks/', name: 'Tasks', accepts: ['task'] };
let feeds: Record<string, string> = {};
let file: string | undefined = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
let fails: 'feeds' | 'file' | undefined;

vi.mock('$lib/server/store', () => ({
	getStore: async () => ({
		calendars: () => [ME, TASKS],
		calendarFile: async () => {
			if (fails === 'file') throw new Error('connect ECONNREFUSED');
			return file;
		}
	}),
	getFeeds: async () => {
		if (fails === 'feeds') throw new Error('connect ECONNREFUSED');
		return feeds;
	}
}));

const { GET } = await import('./+server');
const run = (name: string) => (GET as unknown as (e: { params: { file: string } }) => Promise<Response>)({ params: { file: name } });

describe('GET /feed/<secret>.ics', () => {
	it('hands out the shared calendar, read-only, without being indexed', async () => {
		feeds = { '/david/me/': SECRET };
		fails = undefined;
		const response = await run(`${SECRET}.ics`);
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
		expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
		expect(await response.text()).toContain('BEGIN:VCALENDAR');
	});

	it('answers a wrong, cancelled or badly written link with the same plain 404', async () => {
		feeds = { '/david/me/': SECRET };
		fails = undefined;
		for (const name of [`${'x'.repeat(43)}.ics`, SECRET, `${SECRET}.ICS`, 'settings']) {
			const response = await run(name);
			expect(response.status).toBe(404);
			expect(await response.text()).toBe('Not found');
		}
		feeds = {};
		expect((await run(`${SECRET}.ics`)).status).toBe(404);
	});

	it('never hands out a task list, or a calendar deleted since it was shared', async () => {
		feeds = { '/david/tasks/': SECRET };
		expect((await run(`${SECRET}.ics`)).status).toBe(404);
		feeds = { '/david/gone/': SECRET };
		expect((await run(`${SECRET}.ics`)).status).toBe(404);
		feeds = { '/david/me/': SECRET };
		file = undefined;
		expect((await run(`${SECRET}.ics`)).status).toBe(404);
		file = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
	});

	it('says only "try again later" when the calendar server is down', async () => {
		feeds = { '/david/me/': SECRET };
		const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
		for (const failure of ['feeds', 'file'] as const) {
			fails = failure;
			const response = await run(`${SECRET}.ics`);
			expect(response.status).toBe(503);
			expect(await response.text()).toBe('Try again later');
		}
		fails = undefined;
		quiet.mockRestore();
	});
});
