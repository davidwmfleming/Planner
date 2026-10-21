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

	it('skips items whose address is not a plain file in their calendar (a query, a fragment, a sub-folder, the calendar itself)', async () => {
		const ics = (uid: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261019T120000Z\r\nDTSTART;VALUE=DATE:20261020\r\nSUMMARY:${uid}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
		const store = storeWith({
			propfind: async () => [listing('/david/me/', 'Me')],
			calendarQuery: async () => [
				{ href: '/david/me/a.ics', props: { calendarData: ics('Plain') } },
				{ href: '/david/me/b.ics?x=1', props: { calendarData: ics('Query') } },
				{ href: '/david/me/c.ics#top', props: { calendarData: ics('Fragment') } },
				{ href: '/david/me/sub/d.ics', props: { calendarData: ics('Sub-folder') } },
				{ href: '/david/me/', props: { calendarData: ics('Itself') } }
			]
		});
		expect((await store.listItems()).map((i) => i.title)).toEqual(['Plain']);
	});

	it('leaves out a document it cannot read, says where it is, and still lists the rest', async () => {
		const ics = (uid: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261019T120000Z\r\nDTSTART;VALUE=DATE:20261020\r\nSUMMARY:${uid}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
		// Radicale accepts and keeps both as sent: an app's own property whose value isn't of the type it claims.
		const noValue = ics('Bad repeat').replace('END:VEVENT', 'X-APP-SNOOZE;VALUE=RECUR:FREQ=NEVER\r\nEND:VEVENT');
		const notATime = ics('Bad period').replace('END:VEVENT', 'X-APP-AWAY;VALUE=PERIOD:soon\r\nEND:VEVENT');
		const store = storeWith({
			propfind: async () => [listing('/david/me/', 'Me'), listing('/david/work/', 'Work')],
			calendarQuery: async ({ url }: { url: string }) =>
				url.endsWith('/me/')
					? [
							{ href: '/david/me/a.ics', props: { calendarData: ics('Before') } },
							{ href: '/david/me/bad.ics', props: { calendarData: noValue } },
							{ href: '/david/me/c.ics', props: { calendarData: ics('After') } }
						]
					: [{ href: '/david/work/bad.ics', props: { calendarData: notATime } }, { href: '/david/work/d.ics', props: { calendarData: ics('Work') } }]
		});
		const { items, unreadable } = await store.readItems();
		expect(items.map((i) => i.title)).toEqual(['Before', 'After', 'Work']);
		expect(unreadable).toEqual(['http://127.0.0.1:5232/david/me/bad.ics', 'http://127.0.0.1:5232/david/work/bad.ics']);
		expect((await store.listItems()).map((i) => i.title)).toEqual(['Before', 'After', 'Work']);
	});

	it('never moves a document whose file name carries a query or a fragment', async () => {
		const asked: string[] = [];
		const store = storeWith({}, 100);
		(store as unknown as { davCalendars: unknown }).davCalendars = [{ url: 'http://127.0.0.1:1/david/from/' }, { url: 'http://127.0.0.1:1/david/to/' }];
		(store as unknown as { send: unknown }).send = async (method: string, url: string) => {
			asked.push(`${method} ${url}`);
			return new Response(null, { status: 201 });
		};
		for (const name of ['a.ics?x=1', 'a.ics#top', '?', '#']) {
			const doc = { calendarUrl: 'http://127.0.0.1:1/david/from/', url: `http://127.0.0.1:1/david/from/${name}`, etag: '"1"', ics: '' };
			expect(await store.moveDocument(doc, 'http://127.0.0.1:1/david/to/')).toBe('kept');
		}
		expect(asked).toEqual([]);
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

	it('gives up on a calendar file the server never finishes sending, naming the calendar by a fingerprint of its address', async () => {
		const { store, url, close } = await calendarServedBy((_, res) => res.writeHead(200, { 'Content-Type': 'text/calendar' }).write('BEGIN:VCALENDAR\r\n'), 100);
		try {
			// A fingerprint, not the name or the address made from it: the message goes to the server's log.
			const late = await store.calendarFile(url).catch((e: Error) => e);
			expect(String(late)).toMatch(/in time.*\/david\/[0-9a-f]{8}\//);
			expect(String(late)).not.toMatch(/slow/i);
		} finally {
			await close();
		}
	});

	/** Calendars From and To on a small local server. `answer` picks each reply's status by method, or 'hang' for none;
	 * every request is recorded as "METHOD /path". */
	async function fromAndTo(answer: (method: string, path: string) => number | 'hang', timeoutMs = 100) {
		const asked: string[] = [];
		const server = createServer((req, res) => {
			asked.push(`${req.method} ${req.url}`);
			const status = answer(req.method!, req.url!);
			if (status === 'hang') return;
			res.writeHead(status).end(req.method === 'GET' ? 'something else' : '');
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/david/`;
		const store = storeWith({}, timeoutMs, base);
		(store as unknown as { davCalendars: unknown }).davCalendars = [
			{ url: `${base}from/`, displayName: 'From' },
			{ url: `${base}to/`, displayName: 'To' }
		];
		const doc = { calendarUrl: `${base}from/`, url: `${base}from/a.ics`, etag: '"1"', ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' };
		return {
			store,
			doc,
			to: `${base}to/`,
			asked,
			close: () => {
				server.closeAllConnections();
				return new Promise((resolve) => server.close(resolve));
			}
		};
	}

	it.each([
		['the copy is refused', (m: string) => (m === 'PUT' ? 403 : 200), 'kept', ['PUT /david/to/a.ics']],
		['the copy gets no answer', (m: string) => (m === 'PUT' ? 'hang' : 200), 'unsure', ['PUT /david/to/a.ics']],
		['the copy fails on the server', (m: string) => (m === 'PUT' ? 500 : 200), 'unsure', ['PUT /david/to/a.ics']],
		['a different item has that name already', (m: string) => (m === 'PUT' ? 412 : 200), 'clash', ['PUT /david/to/a.ics', 'GET /david/to/a.ics']],
		['what has that name there can\'t be read', (m: string) => (m === 'PUT' ? 412 : m === 'GET' ? 500 : 200), 'kept', ['PUT /david/to/a.ics', 'GET /david/to/a.ics']],
		['the old copy changed since it was read', (m: string) => (m === 'PUT' ? 201 : 412), 'both', ['PUT /david/to/a.ics', 'DELETE /david/from/a.ics']],
		['removing the old copy gets no answer', (m: string) => (m === 'PUT' ? 201 : 'hang'), 'unsure', ['PUT /david/to/a.ics', 'DELETE /david/from/a.ics']],
		// Deleted on a phone (the copy brings it back) or moved elsewhere by another device (now in two): never "moved".
		['the old copy was already gone', (m: string) => (m === 'PUT' ? 201 : 404), 'both', ['PUT /david/to/a.ics', 'DELETE /david/from/a.ics']],
		['all goes well', (m: string) => (m === 'PUT' ? 201 : 204), 'moved', ['PUT /david/to/a.ics', 'DELETE /david/from/a.ics']]
	] as const)('moving a document when %s: never deletes the old copy unless the new one is surely there', async (_, answer, outcome, asked) => {
		const s = await fromAndTo(answer);
		try {
			expect(await s.store.moveDocument(s.doc, s.to)).toBe(outcome);
			expect(s.asked).toEqual(asked);
		} finally {
			await s.close();
		}
	});

	it('deletes a calendar only as it was read, and tells a refusal from no answer', async () => {
		let status: number | 'hang' = 412;
		const s = await fromAndTo(() => status);
		try {
			const from = s.doc.calendarUrl;
			await expect(s.store.deleteCalendar(from, '"v1"')).rejects.toMatchObject({ status: 412 });
			await expect(s.store.deleteCalendar(from, '"v1"')).rejects.toBeInstanceOf(RefusedError);
			status = 'hang';
			await expect(s.store.deleteCalendar(from, '"v1"')).rejects.toBeInstanceOf(NoAnswerError);
			await expect(s.store.deleteCalendar(`${from}../`, '"v1"')).rejects.toThrow(/No calendar/);
			expect(s.asked).toEqual(['DELETE /david/from/', 'DELETE /david/from/', 'DELETE /david/from/']);
		} finally {
			await s.close();
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

	it('moves a document unchanged to another calendar, one-off changes and all, then removes the old one', async () => {
		const from = await store.ensureCalendar('Move from', ['event']);
		const to = await store.ensureCalendar('Move to', ['event']);
		await store.create(from.url, { uid: 'mv-1', kind: 'event', title: 'Piano', date: '2026-10-05', time: '16:00', state: 'open', recurrence: 'FREQ=WEEKLY' });
		await store.updateOccurrence((await store.listItems()).find((i) => i.uid === 'mv-1')!, '2026-10-12', () => ({ time: '17:00' }));
		const { documents } = await store.documents(from.url);
		expect(documents).toHaveLength(1);

		expect(await store.moveDocument(documents[0], to.url)).toBe('moved');
		expect((await store.documents(from.url)).documents).toEqual([]);
		const [moved] = (await store.documents(to.url)).documents;
		expect(moved.url).toBe(`${to.url}mv-1.ics`);
		expect(moved.ics).toBe(documents[0].ics);
		const shown = occurrencesBetween(moved.ics, '2026-10-05', '2026-10-12');
		expect(shown.map((i) => [i.date, i.time])).toEqual([
			['2026-10-05', '16:00'],
			['2026-10-12', '17:00']
		]);
	});

	it('finishes a move whose old copy was left behind, but never removes it for a different version or item', async () => {
		const from = await store.ensureCalendar('Half from', ['event']);
		const to = await store.ensureCalendar('Half to', ['event']);
		await store.create(from.url, { uid: 'hf-1', kind: 'event', title: 'Swim', date: '2026-10-21', state: 'open' });
		await store.create(from.url, { uid: 'hf-2', kind: 'event', title: 'Run', date: '2026-10-22', state: 'open' });
		await store.create(to.url, { uid: 'hf-2', kind: 'event', title: 'Run, but changed', date: '2026-10-22', state: 'open' });
		const [swim, run] = (await store.documents(from.url)).documents.sort((a, b) => a.url.localeCompare(b.url));
		// The first run copied Swim, then lost the answer to removing the old copy.
		const auth = { Authorization: `Basic ${Buffer.from('david:dev').toString('base64')}` };
		expect((await fetch(`${to.url}hf-1.ics`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'text/calendar' }, body: swim.ics })).ok).toBe(true);

		expect(await store.moveDocument(swim, to.url)).toBe('moved');
		// The same event (same UID) is already there with other details: it is in both, and the old copy stays.
		expect(await store.moveDocument(run, to.url)).toBe('both');
		// A different event (another UID) under the same file name: a clash, and the old copy stays too.
		await store.create(from.url, { uid: 'hf-3', kind: 'event', title: 'Yoga', date: '2026-10-23', state: 'open' });
		const yoga = (await store.documents(from.url)).documents.find((d) => d.url.endsWith('hf-3.ics'))!;
		const other = yoga.ics.replace('UID:hf-3', 'UID:someone-else').replace('SUMMARY:Yoga', 'SUMMARY:Not yoga');
		expect((await fetch(`${to.url}hf-3.ics`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'text/calendar' }, body: other })).ok).toBe(true);
		expect(await store.moveDocument(yoga, to.url)).toBe('clash');
		expect((await store.documents(from.url)).documents.map((d) => d.url).sort()).toEqual([run.url, yoga.url]);
		expect((await store.listItems()).filter((i) => i.uid === 'hf-2').map((i) => i.title).sort()).toEqual(['Run', 'Run, but changed']);
	});

	it('deletes a calendar only if nothing in it changed since it was read', async () => {
		const doomed = await store.ensureCalendar('Doomed', ['event']);
		await store.create(doomed.url, { uid: 'dm-1', kind: 'event', title: 'Old', date: '2026-10-21', state: 'open' });
		const seen = await store.documents(doomed.url);
		expect(seen.documents).toHaveLength(1);
		expect(seen.version).toBeTruthy();
		// A phone adds an event after the page counted the items.
		await store.create(doomed.url, { uid: 'dm-2', kind: 'event', title: 'New on the phone', date: '2026-10-22', state: 'open' });
		await expect(store.deleteCalendar(doomed.url, seen.version!)).rejects.toMatchObject({ status: 412 });
		expect(store.calendars().some((c) => c.url === doomed.url)).toBe(true);

		const now = await store.documents(doomed.url);
		expect(now.documents).toHaveLength(2);
		await store.deleteCalendar(doomed.url, now.version!);
		expect(store.calendars().some((c) => c.url === doomed.url)).toBe(false);
		await store.refreshCalendars();
		expect(store.calendars().some((c) => c.url === doomed.url)).toBe(false);
		expect((await store.listItems()).some((i) => i.uid.startsWith('dm-'))).toBe(false);
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
