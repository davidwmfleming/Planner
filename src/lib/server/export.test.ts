// File names for the export, then a real export from a Radicale server started in a temporary folder (skipped without Radicale).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import ICAL from 'ical.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CalendarStore, type Calendar } from './calendar-store';
import { exportFileNames, exportZip, exportZipName, safeFileName } from './export';

const cal = (slug: string, name: string): Calendar => ({ url: `http://127.0.0.1:5232/david/${slug}/`, name, accepts: ['event'] });

describe('export file names', () => {
	it('names the zip after the day it was made', () => {
		expect(exportZipName('2026-10-20')).toBe('planner-export-2026-10-20.zip');
	});

	it('keeps ordinary calendar names as they are', () => {
		expect(safeFileName('Me')).toBe('Me');
		expect(safeFileName('Morgan Meals')).toBe('Morgan Meals');
		expect(safeFileName('Workouts & runs')).toBe('Workouts & runs');
		expect(safeFileName('Café ☕')).toBe('Café ☕');
	});

	it('makes odd names safe to unzip on any computer', () => {
		const name = safeFileName('../Kids: "fun" / <stuff>?\\*|\u0000');
		expect(name).toBe('Kids fun stuff');
		expect(safeFileName('  ..hidden..  ')).toBe('hidden');
		expect(safeFileName('/// ')).toBe('Calendar');
		expect(safeFileName('')).toBe('Calendar');
		expect(safeFileName('CON')).toBe('_CON'); // Windows won't make a file called CON
		expect(safeFileName('lpt1')).toBe('_lpt1');
		// Windows refuses NUL.txt.ics and Con.backup.ics too: the part before the first dot is what counts.
		expect(safeFileName('nul.txt')).toBe('_nul.txt');
		expect(safeFileName('Con.backup')).toBe('_Con.backup');
		expect(safeFileName('Console')).toBe('Console');
		expect(safeFileName('Com1 games')).toBe('Com1 games');
		expect(Array.from(safeFileName('🎹'.repeat(100)))).toHaveLength(60);
	});

	it('gives each calendar its own file, even when names clash, in order of name then address', () => {
		const named = exportFileNames([cal('me-2', 'me'), cal('me', 'Me'), cal('family', 'Family'), cal('me-3', 'Me?'), cal('tasks', 'Tasks')]);
		expect(named.map(({ calendar, file }) => [calendar.name, file])).toEqual([
			['Family', 'Family.ics'],
			['Me', 'Me.ics'],
			['Me?', 'Me (2).ics'],
			['Tasks', 'Tasks.ics'],
			['me', 'me (3).ics']
		]);
	});

	it('names clashing calendars the same way whatever order the server lists them in', () => {
		const calendars = [cal('b', 'Kids'), cal('a', 'Kids'), cal('c', 'Kids?')];
		const files = (list: Calendar[]) => Object.fromEntries(exportFileNames(list).map(({ calendar, file }) => [calendar.url, file]));
		expect(files(calendars)).toEqual(files([...calendars].reverse()));
		expect(files(calendars)[cal('a', 'Kids').url]).toBe('Kids.ics');
	});
});

describe('export with a pretend calendar server', () => {
	/** A store holding these calendars; `files` gives each one's .ics, undefined for gone, or an error. */
	function fakeStore(listed: Calendar[], files: Record<string, string | undefined | Error>) {
		let known: Calendar[] = []; // what the planner has read of the list so far
		return {
			async refreshCalendars() {
				known = listed;
			},
			calendars: () => known,
			async calendarFile(url: string) {
				const file = files[url];
				if (file instanceof Error) throw file;
				return file;
			}
		} as unknown as CalendarStore;
	}
	const ics = (summary: string) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

	it('reads the calendar list afresh, so calendars added since start-up are included', async () => {
		const zip = unzipSync(await exportZip(fakeStore([cal('me', 'Me'), cal('school', 'School')], { [cal('me', 'Me').url]: ics('a'), [cal('school', 'School').url]: ics('PD day') })));
		expect(Object.keys(zip).sort()).toEqual(['Me.ics', 'School.ics']);
		expect(strFromU8(zip['School.ics'])).toContain('SUMMARY:PD day');
	});

	it('leaves out a calendar deleted between reading the list and fetching it', async () => {
		const zip = unzipSync(await exportZip(fakeStore([cal('me', 'Me'), cal('old', 'Old')], { [cal('me', 'Me').url]: ics('a'), [cal('old', 'Old').url]: undefined })));
		expect(Object.keys(zip)).toEqual(['Me.ics']);
	});

	it('names the calendar that could not be exported', async () => {
		const store = fakeStore([cal('me', 'Me'), cal('family', 'Family')], {
			[cal('me', 'Me').url]: ics('a'),
			[cal('family', 'Family').url]: new Error('The calendar server did not answer in time (reading "Family")')
		});
		await expect(exportZip(store)).rejects.toThrow(/"Family"/);
	});
});

const hasRadicale = spawnSync('python3', ['-m', 'radicale', '--version']).status === 0;
const PORT = 5297;

describe.skipIf(!hasRadicale)('export against Radicale', () => {
	let server: ChildProcess;
	let dir: string;
	let store: CalendarStore;

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'planner-export-'));
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
	}, 15000);

	afterAll(() => {
		server?.kill();
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('zips one valid .ics per calendar holding every item', async () => {
		const me = await store.ensureCalendar('Me', ['event']);
		const odd = await store.ensureCalendar('Kids: "fun" / stuff?', ['event']);
		const tasks = await store.ensureCalendar('Tasks', ['task']);
		await store.ensureCalendar('Empty', ['event']);
		await store.create(me.url, { uid: 'ex-1', kind: 'event', title: 'Dentist', date: '2026-10-21', time: '09:00', state: 'open' });
		await store.create(me.url, { uid: 'ex-2', kind: 'event', title: 'Swim', date: '2026-10-22', state: 'open', recurrence: 'FREQ=WEEKLY' });
		await store.create(odd.url, { uid: 'ex-3', kind: 'event', title: 'Soccer, then pizza', date: '2026-10-23', state: 'open' });
		await store.create(tasks.url, { uid: 'ex-4', kind: 'task', title: 'Pick up meds', date: '2026-10-20', state: 'open' });
		await store.create(tasks.url, { uid: 'ex-5', kind: 'task', title: 'Fix piano keys', state: 'open', categories: ['Someday'] });

		const files = unzipSync(await exportZip(store));
		expect(Object.keys(files).sort()).toEqual(['Empty.ics', 'Kids fun stuff.ics', 'Me.ics', 'Tasks.ics']);

		const uids = (file: string) => {
			const calendar = new ICAL.Component(ICAL.parse(strFromU8(files[file])));
			expect(calendar.name).toBe('vcalendar');
			return calendar.getAllSubcomponents().filter((c) => c.name !== 'vtimezone').map((c) => `${c.name} ${c.getFirstPropertyValue('uid')}`).sort();
		};
		expect(uids('Me.ics')).toEqual(['vevent ex-1', 'vevent ex-2']);
		expect(uids('Kids fun stuff.ics')).toEqual(['vevent ex-3']);
		expect(uids('Tasks.ics')).toEqual(['vtodo ex-4', 'vtodo ex-5']);
		expect(uids('Empty.ics')).toEqual([]);
		expect(strFromU8(files['Me.ics'])).toContain('RRULE:FREQ=WEEKLY');
	});

	// Calendars added or removed from a phone (iPhone Calendar, DAVx5) after the planner connected.
	const base = () => `http://127.0.0.1:${PORT}`;
	const AUTH = `Basic ${Buffer.from('david:dev').toString('base64')}`;
	const mkcalendar = (slug: string, name: string) =>
		fetch(`${base()}/david/${slug}/`, {
			method: 'MKCALENDAR',
			headers: { Authorization: AUTH, 'Content-Type': 'application/xml' },
			body: `<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>${name}</D:displayname></D:prop></D:set></C:mkcalendar>`
		});

	it('includes a calendar made on a phone after the planner started', async () => {
		await mkcalendar('school', 'School');
		await fetch(`${base()}/david/school/pd-day.ics`, {
			method: 'PUT',
			headers: { Authorization: AUTH, 'Content-Type': 'text/calendar' },
			body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QA//EN\r\nBEGIN:VEVENT\r\nUID:pd-day\r\nDTSTAMP:20261001T120000Z\r\nDTSTART;VALUE=DATE:20261106\r\nSUMMARY:PD day\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
		});
		const files = unzipSync(await exportZip(store));
		expect(Object.keys(files)).toContain('School.ics');
		expect(strFromU8(files['School.ics'])).toContain('SUMMARY:PD day');
	});

	it('still exports when a calendar was deleted on a phone after the planner started', async () => {
		await mkcalendar('old', 'Old');
		await store.ensureCalendar('Old', ['event']); // the planner now knows about it
		await fetch(`${base()}/david/old/`, { method: 'DELETE', headers: { Authorization: AUTH } });
		const files = unzipSync(await exportZip(store));
		expect(Object.keys(files)).toContain('Me.ics');
		expect(Object.keys(files)).not.toContain('Old.ics');
	});

	it('still exports when a calendar is deleted between reading the list and fetching it', async () => {
		await mkcalendar('brief', 'Brief');
		const refresh = store.refreshCalendars.bind(store);
		const spy = vi.spyOn(store, 'refreshCalendars').mockImplementation(async () => {
			await refresh();
			await fetch(`${base()}/david/brief/`, { method: 'DELETE', headers: { Authorization: AUTH } });
		});
		try {
			const files = unzipSync(await exportZip(store));
			expect(Object.keys(files)).toContain('Me.ics');
			expect(Object.keys(files)).not.toContain('Brief.ics');
		} finally {
			spy.mockRestore();
		}
	});
});
