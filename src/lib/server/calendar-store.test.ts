// Runs against a real Radicale server started in a temporary folder. Skipped if Radicale isn't installed.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalendarStore, NoAnswerError, RefusedError } from './calendar-store';
import { occurrencesBetween } from './ical';

const hasRadicale = spawnSync('python3', ['-m', 'radicale', '--version']).status === 0;
const PORT = 5299;

/** A store whose calendar server is played by the test: each DAV call it makes goes to `client`. */
function storeWith(client: Record<string, unknown>, timeoutMs?: number, homeUrl = 'http://127.0.0.1:5232/david/') {
	const store = new CalendarStore({ serverUrl: 'http://127.0.0.1:5232/', username: 'david', password: 'dev', timeoutMs });
	(store as unknown as { client: unknown }).client = { account: { homeUrl }, ...client };
	return store;
}
const listing = (href: string, name: string, comps = ['VEVENT']) => ({
	ok: true,
	href,
	props: { displayname: name, resourcetype: { calendar: {} }, supportedCalendarComponentSet: { comp: comps.map((c) => ({ _attributes: { name: c } })) } }
});

describe('CalendarStore without a server', () => {
	it('lists only calendars inside the home folder on the same server', async () => {
		const store = storeWith({
			propfind: async () => [
				listing('/david/', 'Home itself'),
				listing('/david/me/', 'Me'),
				listing('http://evil.example/david/x/', 'Elsewhere'),
				listing('http://127.0.0.1:9999/david/y/', 'Other port'),
				listing('/someone-else/z/', 'Not mine'),
				listing('/david/../admin/', 'Climbing out'),
				listing('/david-two/w/', 'Lookalike')
			]
		});
		await store.refreshCalendars();
		expect(store.calendars().map((c) => c.name)).toEqual(['Me']);
	});

	it('keeps to the home folder when the server gives it without a closing slash', async () => {
		const store = storeWith({ propfind: async () => [listing('/david/me/', 'Me'), listing('/david-two/w/', 'Lookalike'), listing('/davidx/', 'Lookalike too')] }, undefined, 'http://127.0.0.1:5232/david');
		await store.refreshCalendars();
		expect(store.calendars().map((c) => c.name)).toEqual(['Me']);
		expect(store.addressFor('Tasks')).toBe('http://127.0.0.1:5232/david/tasks/');
	});

	it('skips items whose address is outside their calendar', async () => {
		const ics = (uid: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261019T120000Z\r\nDTSTART;VALUE=DATE:20261020\r\nSUMMARY:${uid}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
		const store = storeWith({
			propfind: async () => [listing('/david/me/', 'Me')],
			calendarQuery: async () => [
				{ href: '/david/me/a.ics', props: { calendarData: ics('Mine') } },
				{ href: 'http://evil.example/david/me/b.ics', props: { calendarData: ics('Foreign') } },
				{ href: '/david/work/c.ics', props: { calendarData: ics('Next door') } }
			]
		});
		expect((await store.listItems()).map((i) => i.title)).toEqual(['Mine']);
	});

	it('treats a journal-only calendar as neither events nor tasks', async () => {
		const store = storeWith({ propfind: async () => [listing('/david/notes/', 'Notes', ['VJOURNAL']), listing('/david/any/', 'Any', [])] });
		await store.refreshCalendars();
		expect(store.calendars().map((c) => [c.name, c.accepts])).toEqual([
			['Notes', []],
			['Any', ['event', 'task']]
		]);
	});

	it('gives the address a calendar gets from its name', () => {
		expect(storeWith({}).addressFor('Tasks')).toBe('http://127.0.0.1:5232/david/tasks/');
	});

	it('turns a calendar server that never answers into an error', async () => {
		const store = storeWith({ propfind: () => new Promise(() => {}), login: () => new Promise(() => {}) }, 50);
		await expect(store.refreshCalendars()).rejects.toThrow(/did not answer/);
		await expect(store.connect()).rejects.toThrow(/did not answer/);
	});

	it('tells a delete the server refused apart from one it never answered, which it may still carry out', async () => {
		const item = { uid: 'x', kind: 'event' as const, title: 'X', state: 'open' as const, calendarUrl: 'http://127.0.0.1:5232/david/me/', url: 'http://127.0.0.1:5232/david/me/x.ics', ics: '' };
		const refusing = storeWith({ deleteCalendarObject: async () => new Response(null, { status: 412 }) });
		await expect(refusing.remove(item)).rejects.toMatchObject({ status: 412 });
		await expect(refusing.remove(item)).rejects.toBeInstanceOf(RefusedError);
		const silent = storeWith({ deleteCalendarObject: () => new Promise(() => {}) }, 50);
		const late = await silent.remove(item).catch((e) => e);
		expect(late).not.toBeInstanceOf(RefusedError);
		expect(late).toBeInstanceOf(NoAnswerError);
		expect(late.message).toMatch(/did not answer/);
	});

	/** A calendar called Slow whose address is a small local server answering with `respond`. */
	async function calendarServedBy(respond: RequestListener, timeoutMs?: number) {
		const server = createServer(respond);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/david/slow/`;
		const store = storeWith({}, timeoutMs);
		(store as unknown as { davCalendars: unknown }).davCalendars = [{ url, displayName: 'Slow' }];
		return {
			store,
			url,
			close: () => {
				server.closeAllConnections();
				return new Promise((resolve) => server.close(resolve));
			}
		};
	}

	it('gives up on a calendar file the server never finishes sending, naming the calendar', async () => {
		const { store, url, close } = await calendarServedBy((_, res) => res.writeHead(200, { 'Content-Type': 'text/calendar' }).write('BEGIN:VCALENDAR\r\n'), 100);
		try {
			await expect(store.calendarFile(url)).rejects.toThrow(/"Slow".*in time|in time.*"Slow"/);
		} finally {
			await close();
		}
	});

	it('reports a calendar deleted since the list was read as gone, rather than failing', async () => {
		const { store, url, close } = await calendarServedBy((_, res) => res.writeHead(404).end());
		try {
			expect(await store.calendarFile(url)).toBeUndefined();
		} finally {
			await close();
		}
	});
});

describe.skipIf(!hasRadicale)('CalendarStore against Radicale', () => {
	let server: ChildProcess;
	let dir: string;
	let store: CalendarStore;

	// Starts (or restarts) Radicale on the same folder, then connects a fresh store to it.
	async function start() {
		server = spawn('bash', ['scripts/dev-calendar.sh'], {
			env: { ...process.env, DEV_CALENDAR_DIR: dir, DEV_CALENDAR_PORT: String(PORT) },
			stdio: 'ignore'
		});
		for (let i = 0; i < 50; i++) {
			try {
				await fetch(`http://127.0.0.1:${PORT}/`);
				break;
			} catch {
				await new Promise((r) => setTimeout(r, 100));
			}
		}
		store = new CalendarStore({ serverUrl: `http://127.0.0.1:${PORT}/`, username: 'david', password: 'dev' });
		await store.connect();
	}

	async function stop() {
		const exited = new Promise((r) => server.once('exit', r));
		server.kill();
		await exited;
	}

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'planner-caldav-'));
		await start();
	}, 15000);

	afterAll(() => {
		server?.kill();
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('creates calendars that accept events or tasks', async () => {
		const personal = await store.ensureCalendar('Personal', ['event']);
		const tasks = await store.ensureCalendar('Tasks', ['task']);
		expect(personal.accepts).toEqual(['event']);
		expect(tasks.accepts).toEqual(['task']);
		expect((await store.ensureCalendar('Personal', ['event'])).url).toBe(personal.url);
	});

	it('renames a calendar and keeps what is in it', async () => {
		const old = await store.ensureCalendar('Old name', ['event']);
		await store.create(old.url, { uid: 'rn-1', kind: 'event', title: 'Swim', date: '2026-10-22', state: 'open' });
		await store.renameCalendar('Old name', 'Workouts & runs');
		const renamed = store.calendars().find((c) => c.url === old.url);
		expect(renamed?.name).toBe('Workouts & runs');
		expect(store.calendars().some((c) => c.name === 'Old name')).toBe(false);
		expect((await store.listItems()).find((i) => i.uid === 'rn-1')?.calendarUrl).toBe(old.url);
		await store.renameCalendar('Not there', 'Anything'); // quietly does nothing
	});

	it('makes a calendar whose name a renamed calendar once had, or that has no plain letters', async () => {
		const first = await store.ensureCalendar('Piano', ['event']);
		await store.renameCalendarAt(first.url, 'Music');
		const again = await store.ensureCalendar('Piano', ['event']);
		expect(again.url).not.toBe(first.url);
		expect(store.calendars().find((c) => c.url === first.url)?.name).toBe('Music');

		const greek = await store.ensureCalendar('Μουσική', ['event']);
		const japanese = await store.ensureCalendar('音楽', ['event']);
		expect(new Set([greek.url, japanese.url]).size).toBe(2);
		expect(greek.accepts).toEqual(['event']);
	});

	it('saves, reads back, updates and deletes events and tasks', async () => {
		const personal = await store.ensureCalendar('Personal', ['event']);
		const tasks = await store.ensureCalendar('Tasks', ['task']);
		await store.create(personal.url, { uid: 'ev-1', kind: 'event', title: 'Dentist', date: '2026-10-21', time: '09:00', state: 'open' });
		const task = await store.create(tasks.url, { uid: 'tk-1', kind: 'task', title: 'Pick up meds', date: '2026-10-20', state: 'open' });

		let items = await store.listItems();
		expect(items.find((i) => i.uid === 'ev-1')).toMatchObject({ title: 'Dentist', time: '09:00', calendarUrl: personal.url });
		expect(items.find((i) => i.uid === 'tk-1')).toMatchObject({ title: 'Pick up meds', date: '2026-10-20' });

		const read = items.find((i) => i.uid === 'tk-1')!;
		await store.update(read, { state: 'done' });
		items = await store.listItems();
		expect(items.find((i) => i.uid === 'tk-1')!.state).toBe('done');

		await store.remove(items.find((i) => i.uid === 'tk-1')!);
		expect((await store.listItems()).some((i) => i.uid === 'tk-1')).toBe(false);
		expect(task.url).toContain('tk-1.ics');
	});

	it('refuses to overwrite an item someone else changed in the meantime', async () => {
		const tasks = await store.ensureCalendar('Tasks', ['task']);
		await store.create(tasks.url, { uid: 'tk-2', kind: 'task', title: 'Sheets', state: 'open' });
		const stale = (await store.listItems()).find((i) => i.uid === 'tk-2')!;
		await store.update(stale, { title: 'Wash sheets' });
		await expect(store.update(stale, { title: 'Change sheets' })).rejects.toThrow(/reload/);
	});

	it('changes one day of a repeating event and keeps that change when the series is renamed', async () => {
		const personal = await store.ensureCalendar('Personal', ['event']);
		await store.create(personal.url, { uid: 'rp-1', kind: 'event', title: 'Lift', date: '2026-10-05', time: '06:30', state: 'open', recurrence: 'FREQ=WEEKLY' });
		const find = async () => (await store.listItems()).find((i) => i.uid === 'rp-1')!;

		await store.updateOccurrence(await find(), '2026-10-19', () => ({ state: 'done' }));
		await store.update(await find(), { title: 'Gym' });
		const shown = occurrencesBetween((await find()).ics, '2026-10-12', '2026-10-19');
		expect(shown.map((i) => [i.date, i.title, i.state])).toEqual([
			['2026-10-12', 'Gym', 'open'],
			['2026-10-19', 'Gym', 'done']
		]);
	});

	it('keeps the planner settings on the Tasks collection, even after the server restarts', async () => {
		const tasks = await store.ensureCalendar('Tasks', ['task']);
		const family = await store.ensureCalendar('Family', ['event']);
		const settings = { categories: ['This month', 'Waiting', 'Kids & school <3'], workCalendar: null, defaultEventCalendar: new URL(family.url).pathname };
		await store.writeSettings(tasks.url, settings);
		expect(await store.readSettings(tasks.url)).toEqual(settings);

		await stop();
		await start();
		expect(await store.readSettings(tasks.url)).toEqual(settings);
		// Renaming the collection rewrites its properties; the settings must survive that too.
		await store.renameCalendar('Family', 'Family & friends');
		expect(await store.readSettings(tasks.url)).toEqual(settings);
	}, 15000);

	it('uses the default settings when none are stored', async () => {
		const blank = await store.ensureCalendar('Blank tasks', ['task']);
		const me = await store.ensureCalendar('Me', ['event']);
		const work = await store.ensureCalendar('Work', ['event']);
		expect(await store.storedSettings(blank.url)).toBeUndefined();
		expect(await store.readSettings(blank.url)).toEqual({
			categories: ['This month', 'Waiting', 'Someday'],
			workCalendar: new URL(work.url).pathname,
			defaultEventCalendar: new URL(me.url).pathname
		});
	});

	it('tells a missing collection apart from one with no settings stored', async () => {
		const blank = await store.ensureCalendar('Empty list', ['task']);
		expect(await store.settingsAt(blank.url)).toEqual({ found: true, stored: undefined });
		expect(await store.settingsAt(store.addressFor('Never made'))).toEqual({ found: false, stored: undefined });
	});

	it('makes a calendar at a chosen address, even when another one has its name', async () => {
		const phone = await store.ensureCalendar('Reminders', ['task']);
		const made = await store.ensureCalendar('Reminders', ['task'], store.addressFor('Reminders kept'));
		expect(made.url).toBe(store.addressFor('Reminders kept'));
		expect(made.url).not.toBe(phone.url);
	});

	it('uses the defaults if the Tasks collection is gone, and says so when settings cannot be saved', async () => {
		const gone = new URL('david/no-such-list/', `http://127.0.0.1:${PORT}/`).href;
		expect(await store.storedSettings(gone)).toBeUndefined();
		expect((await store.readSettings(gone)).categories).toEqual(['This month', 'Waiting', 'Someday']);
		await expect(store.writeSettings(gone, { categories: [], workCalendar: null, defaultEventCalendar: null })).rejects.toThrow(/refused to save the settings/);
	});
});
