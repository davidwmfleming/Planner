// File names for the export, then a real export from a Radicale server started in a temporary folder (skipped without Radicale).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import ICAL from 'ical.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalendarStore } from './calendar-store';
import { exportFileNames, exportZip, exportZipName, safeFileName } from './export';

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
		expect(Array.from(safeFileName('🎹'.repeat(100)))).toHaveLength(60);
	});

	it('gives each calendar its own file, even when names clash', () => {
		expect(exportFileNames(['Me', 'me', 'Family', 'Me?', 'Tasks'])).toEqual(['Me.ics', 'me (2).ics', 'Family.ics', 'Me (3).ics', 'Tasks.ics']);
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
		await store.create(tasks.url, { uid: 'ex-5', kind: 'task', title: 'Fix piano keys', state: 'open', label: 'someday' });

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
});
