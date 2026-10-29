// A shared calendar link with a pretend calendar server: what a computer on the internet gets back.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'S'.repeat(43);
const ME = { url: 'http://cal/david/me/', name: 'Me', accepts: ['event'] };
const TASKS = { url: 'http://cal/david/tasks/', name: 'Tasks', accepts: ['task'] };
let feeds: Record<string, string> = {};
let file: string | undefined = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
let fails: 'feeds' | 'file' | undefined;
let fetched = 0;
const env: Record<string, string | undefined> = { FEED_ORIGIN: 'https://homebase.example.ts.net:8443', TZ: 'America/Halifax' };
vi.mock('$env/dynamic/private', () => ({ env }));

vi.mock('$lib/server/store', () => ({
	getStore: async () => ({
		calendars: () => [ME, TASKS],
		calendarFile: async () => {
			fetched++;
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

// Each test starts two minutes after the last, past the planner's minute of keeping a calendar and its rest after a failure.
vi.useFakeTimers({ toFake: ['Date'] });
beforeEach(() => vi.setSystemTime(Date.now() + 120_000));

describe('GET /feed/<secret>.ics', () => {
	it('hands out the shared calendar, read-only, without being indexed', async () => {
		feeds = { '/david/me/': SECRET };
		fails = undefined;
		const response = await run(`${SECRET}.ics`);
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
		expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
		expect(await response.text()).toBe('BEGIN:VCALENDAR\r\nX-WR-TIMEZONE:America/Halifax\r\nEND:VCALENDAR\r\n');
	});

	it('works only while sharing is on (the server has a public address)', async () => {
		feeds = { '/david/me/': SECRET };
		env.FEED_ORIGIN = undefined;
		expect((await run(`${SECRET}.ics`)).status).toBe(404);
		env.FEED_ORIGIN = 'https://homebase.example.ts.net:8443';
		expect((await run(`${SECRET}.ics`)).status).toBe(200);
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

	it('leaves out tasks a calendar made elsewhere may hold, reminders and all', async () => {
		feeds = { '/david/me/': SECRET };
		file = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Dinner\r\nEND:VEVENT\r\nBEGIN:VTODO\r\nSUMMARY:Secret task\r\nBEGIN:VALARM\r\nEND:VALARM\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
		const text = await (await run(`${SECRET}.ics`)).text();
		expect(text).toBe('BEGIN:VCALENDAR\r\nX-WR-TIMEZONE:America/Halifax\r\nBEGIN:VEVENT\r\nSUMMARY:Dinner\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
		file = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
	});

	it('asks the calendar server for a shared calendar at most once a minute', async () => {
		feeds = { '/david/me/': SECRET };
		fetched = 0;
		for (let i = 0; i < 5; i++) expect((await run(`${SECRET}.ics`)).status).toBe(200);
		expect(fetched).toBe(1);
		vi.setSystemTime(Date.now() + 61_000);
		await run(`${SECRET}.ics`);
		expect(fetched).toBe(2);
	});

	it('says only "try again later" when the calendar server is down, logging it once and resting before asking again', async () => {
		feeds = { '/david/me/': SECRET };
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		for (const failure of ['feeds', 'file'] as const) {
			vi.setSystemTime(Date.now() + 120_000);
			fails = failure;
			fetched = 0;
			for (let i = 0; i < 3; i++) {
				const response = await run(`${SECRET}.ics`);
				expect(response.status).toBe(503);
				expect(await response.text()).toBe('Try again later');
			}
			expect(fetched).toBe(failure === 'file' ? 1 : 0);
		}
		expect(log).toHaveBeenCalledTimes(2);
		fails = undefined;
		// Back after the rest.
		vi.setSystemTime(Date.now() + 11_000);
		expect((await run(`${SECRET}.ics`)).status).toBe(200);
		log.mockRestore();
	});
});
