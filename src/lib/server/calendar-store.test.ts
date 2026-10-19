// Runs against a real Radicale server started in a temporary folder. Skipped if Radicale isn't installed.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalendarStore } from './calendar-store';
import { occurrencesBetween } from './ical';

const hasRadicale = spawnSync('python3', ['-m', 'radicale', '--version']).status === 0;
const PORT = 5299;

describe.skipIf(!hasRadicale)('CalendarStore against Radicale', () => {
	let server: ChildProcess;
	let dir: string;
	let store: CalendarStore;

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'planner-caldav-'));
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

	it('creates calendars that accept events or tasks', async () => {
		const personal = await store.ensureCalendar('Personal', ['event']);
		const tasks = await store.ensureCalendar('Tasks', ['task']);
		expect(personal.accepts).toEqual(['event']);
		expect(tasks.accepts).toEqual(['task']);
		expect((await store.ensureCalendar('Personal', ['event'])).url).toBe(personal.url);
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
});
