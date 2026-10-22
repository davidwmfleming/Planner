// Renaming a category on the tasks in a real Radicale server, started in a temporary folder. Skipped if Radicale isn't installed.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Item } from '$lib/item';
import { CalendarStore, NoAnswerError, type Calendar, type StoredDocument } from './calendar-store';
import { deleteCategory, recategorise, renameCategory, tasksWith, type SettingsPlace } from './categories';
import { icsToItems, occurrenceOn } from './ical';

const hasRadicale = spawnSync('python3', ['-m', 'radicale', '--version']).status === 0;
const PORT = 5294;
const auth = { Authorization: `Basic ${Buffer.from('david:dev').toString('base64')}` };

describe('a task the calendar server gave no version (ETag) for', () => {
	it('is not saved, and counts as refused, so the category stays on the list', async () => {
		const todo = (uid: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261019T120000Z\r\nSUMMARY:x\r\nCATEGORIES:Waiting\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;
		const tasks = 'http://127.0.0.1:5232/david/tasks/';
		const store = new CalendarStore({ serverUrl: 'http://127.0.0.1:5232/', username: 'david', password: 'dev' });
		const sent: string[] = [];
		Object.assign(store, {
			refreshCalendars: async () => {},
			calendars: () => [{ url: tasks, name: 'Tasks', accepts: ['task'] }],
			documents: async () => ({ version: '"v1"', documents: [{ calendarUrl: tasks, url: `${tasks}a.ics`, ics: todo('a') }, { calendarUrl: tasks, url: `${tasks}b.ics`, etag: '"b1"', ics: todo('b') }] }),
			put: async (doc: { url: string }) => void sent.push(doc.url)
		});
		expect(await recategorise(store, 'Waiting', 'Later')).toEqual({ changed: 1, refused: 1, unsure: false });
		expect(sent).toEqual([`${tasks}b.ics`]);
	});
});

describe.skipIf(!hasRadicale)('renaming and deleting a category against Radicale', () => {
	let server: ChildProcess;
	let dir: string;
	let store: CalendarStore;
	let tasks: Calendar, phoneList: Calendar, family: Calendar;
	let place: SettingsPlace;
	let n = 0;

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'planner-categories-'));
		server = spawn('bash', ['scripts/dev-calendar.sh'], { env: { ...process.env, DEV_CALENDAR_DIR: dir, DEV_CALENDAR_PORT: String(PORT) }, stdio: 'ignore' });
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
		tasks = await store.ensureCalendar('Tasks', ['task']);
		phoneList = await store.ensureCalendar('Groceries', ['task']);
		family = await store.ensureCalendar('Family', ['event', 'task']);
		place = { read: () => store.readSettings(tasks.url), write: (s) => store.writeSettings(tasks.url, s) };
	}, 15000);

	afterAll(() => {
		server?.kill();
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	beforeEach(async () => {
		// Each test starts with no tasks, so counts are only its own.
		for (const calendar of [tasks, phoneList, family]) {
			for (const doc of (await store.documents(calendar.url)).documents) await fetch(doc.url, { method: 'DELETE', headers: auth });
		}
		await place.write({ categories: ['This month', 'Waiting', 'Someday'], workCalendar: null, defaultEventCalendar: null });
	});

	/** Saves a document as a phone would, with these lines inside one VTODO (or VEVENT); {uid} stands for its UID. */
	async function put(calendar: Calendar, lines: string[], kind = 'VTODO') {
		const uid = `c${++n}-${Math.random().toString(36).slice(2, 8)}`;
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phone//EN', `BEGIN:${kind}`, `UID:${uid}`, 'DTSTAMP:20261019T000000Z', ...lines, `END:${kind}`, 'END:VCALENDAR', '']
			.join('\r\n')
			.replaceAll('{uid}', uid);
		const res = await fetch(new URL(`${uid}.ics`, calendar.url), { method: 'PUT', headers: { ...auth, 'Content-Type': 'text/calendar' }, body: ics });
		expect(res.ok).toBe(true);
		return uid;
	}
	const stored = async (calendar: Calendar, uid: string) => (await (await fetch(new URL(`${uid}.ics`, calendar.url), { headers: auth })).text()).replace(/\r\n[ \t]/g, '');
	const categoriesOf = async (calendar: Calendar, uid: string) => (icsToItems(await stored(calendar, uid))[0] as Item).categories;

	it('gives every task the new name, in every list, whole repeating series included, then takes the old name off the list', async () => {
		const plain = await put(tasks, ['SUMMARY:a', 'CATEGORIES:waiting,Home']);
		const onPhone = await put(phoneList, ['SUMMARY:b', 'CATEGORIES:WAITING']);
		const inFamily = await put(family, ['SUMMARY:c', 'CATEGORIES:Waiting']);
		const other = await put(tasks, ['SUMMARY:d', 'CATEGORIES:Someday']);
		const event = await put(family, ['SUMMARY:e', 'DTSTART:20261021T100000', 'CATEGORIES:Waiting'], 'VEVENT');
		const series = await put(tasks, ['SUMMARY:f', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=DAILY;COUNT=3', 'CATEGORIES:Waiting',
			'END:VTODO', 'BEGIN:VTODO', 'UID:{uid}', 'DTSTAMP:20261019T000000Z', 'SUMMARY:f', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261020', 'STATUS:COMPLETED', 'CATEGORIES:Waiting']);

		expect(await renameCategory(store, place, 'Waiting', 'Waiting for')).toEqual({ changed: 4, refused: 0, unsure: false });
		expect(await place.read()).toEqual({ categories: ['This month', 'Waiting for', 'Someday'], workCalendar: null, defaultEventCalendar: null });
		expect(await categoriesOf(tasks, plain)).toEqual(['Waiting for', 'Home']);
		expect(await categoriesOf(phoneList, onPhone)).toEqual(['Waiting for']);
		expect(await categoriesOf(family, inFamily)).toEqual(['Waiting for']);
		expect(await categoriesOf(tasks, other)).toEqual(['Someday']);
		// Lists are for tasks: an event's categories are its own.
		expect(await stored(family, event)).toContain('CATEGORIES:Waiting\r\n');
		expect(await stored(tasks, series)).not.toMatch(/CATEGORIES:Waiting\r/);
		expect(occurrenceOn(await stored(tasks, series), '2026-10-20')).toMatchObject({ state: 'done' });
	});

	it('changes only the spelling when the case changes', async () => {
		const uid = await put(tasks, ['SUMMARY:a', 'CATEGORIES:Someday']);
		expect(await renameCategory(store, place, 'Someday', 'SOMEDAY')).toMatchObject({ changed: 1 });
		expect((await place.read()).categories).toEqual(['This month', 'Waiting', 'SOMEDAY']);
		expect(await stored(tasks, uid)).toContain('CATEGORIES:SOMEDAY\r');
	});

	it('keeps both names on the list when it stops halfway, and finishes when run again', async () => {
		const uids = [await put(tasks, ['SUMMARY:a', 'CATEGORIES:This month']), await put(tasks, ['SUMMARY:b', 'CATEGORIES:This month']), await put(phoneList, ['SUMMARY:c', 'CATEGORIES:month'])];
		const save = store.saveDocument.bind(store);
		let saves = 0;
		store.saveDocument = async (doc: StoredDocument, ics: string) => {
			if (++saves === 2) throw new NoAnswerError('The calendar server did not answer in time');
			return save(doc, ics);
		};
		try {
			expect(await renameCategory(store, place, 'This month', 'Soon')).toEqual({ changed: 1, refused: 0, unsure: true });
		} finally {
			store.saveDocument = save;
		}
		const half = await place.read();
		expect(half.categories).toEqual(['This month', 'Soon', 'Waiting', 'Someday']);
		expect(half.renaming).toEqual({ from: 'This month', to: 'Soon' });
		const now = await Promise.all([categoriesOf(tasks, uids[0]), categoriesOf(tasks, uids[1]), categoriesOf(phoneList, uids[2])]);
		// Every task carries a name on the list: the new one, or the old one still.
		expect(now.flat().every((c) => half.categories.includes(c!))).toBe(true);

		expect(await renameCategory(store, place, 'This month', 'Soon')).toMatchObject({ refused: 0, unsure: false });
		expect(await place.read()).toEqual({ categories: ['Soon', 'Waiting', 'Someday'], workCalendar: null, defaultEventCalendar: null });
		expect([await categoriesOf(tasks, uids[0]), await categoriesOf(tasks, uids[1]), await categoriesOf(phoneList, uids[2])]).toEqual([['Soon'], ['Soon'], ['Soon']]);
	});

	it("doesn't overwrite a task changed on a phone while the rename is under way, and finishes when run again", async () => {
		const uid = await put(tasks, ['SUMMARY:Before', 'CATEGORIES:Someday']);
		const save = store.saveDocument.bind(store);
		store.saveDocument = async (doc: StoredDocument, ics: string) => {
			// The phone saves a new title just before the planner saves the new category.
			await fetch(doc.url, { method: 'PUT', headers: { ...auth, 'Content-Type': 'text/calendar' }, body: doc.ics.replace('SUMMARY:Before', 'SUMMARY:After') });
			return save(doc, ics);
		};
		try {
			expect(await renameCategory(store, place, 'Someday', 'Later')).toEqual({ changed: 0, refused: 1, unsure: false });
		} finally {
			store.saveDocument = save;
		}
		expect(await stored(tasks, uid)).toContain('SUMMARY:After');
		expect((await place.read()).categories).toEqual(['This month', 'Waiting', 'Someday', 'Later']);
		await renameCategory(store, place, 'Someday', 'Later');
		expect((await place.read()).categories).toEqual(['This month', 'Waiting', 'Later']);
		expect(await stored(tasks, uid)).toContain('SUMMARY:After');
		expect(await categoriesOf(tasks, uid)).toEqual(['Later']);
	});

	it('deletes one by moving its tasks to another category, never deleting a task', async () => {
		const plain = await put(tasks, ['SUMMARY:a', 'CATEGORIES:waiting,Home']);
		const both = await put(phoneList, ['SUMMARY:b', 'CATEGORIES:Waiting', 'CATEGORIES:Someday']);
		const series = await put(tasks, ['SUMMARY:c', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=DAILY;COUNT=3', 'CATEGORIES:Waiting',
			'END:VTODO', 'BEGIN:VTODO', 'UID:{uid}', 'DTSTAMP:20261019T000000Z', 'SUMMARY:c', 'RECURRENCE-ID;VALUE=DATE:20261020', 'DTSTART;VALUE=DATE:20261020', 'CATEGORIES:WAITING']);
		expect((await tasksWith(store, 'Waiting')).length).toBe(3);

		expect(await deleteCategory(store, place, 'Waiting', 'Someday')).toEqual({ changed: 3, refused: 0, unsure: false });
		expect((await place.read()).categories).toEqual(['This month', 'Someday']);
		expect(await categoriesOf(tasks, plain)).toEqual(['Someday', 'Home']);
		expect(await categoriesOf(phoneList, both)).toEqual(['Someday']);
		expect(occurrenceOn(await stored(tasks, series), '2026-10-20')?.categories).toEqual(['Someday']);
		expect((await tasksWith(store, 'Waiting')).length).toBe(0);
	});

	it('deletes one with "No list": its tasks stay, with no category of the planner\'s', async () => {
		const uid = await put(tasks, ['SUMMARY:a', 'DTSTART;VALUE=DATE:20261021', 'CATEGORIES:Home,This month']);
		expect(await deleteCategory(store, place, 'This month', undefined)).toMatchObject({ changed: 1 });
		expect((await place.read()).categories).toEqual(['Waiting', 'Someday']);
		expect(icsToItems(await stored(tasks, uid))[0]).toMatchObject({ title: 'a', date: '2026-10-21', categories: ['Home'] });
	});

	it('keeps the category on the list when it stops partway, and finishes when deleted again', async () => {
		const uids = [await put(tasks, ['SUMMARY:a', 'CATEGORIES:Someday']), await put(tasks, ['SUMMARY:b', 'CATEGORIES:Someday'])];
		const save = store.saveDocument.bind(store);
		let saves = 0;
		store.saveDocument = async (doc: StoredDocument, ics: string) => {
			if (++saves === 2) throw new NoAnswerError('The calendar server did not answer in time');
			return save(doc, ics);
		};
		try {
			expect(await deleteCategory(store, place, 'Someday', 'Waiting')).toEqual({ changed: 1, refused: 0, unsure: true });
		} finally {
			store.saveDocument = save;
		}
		expect((await place.read()).categories).toEqual(['This month', 'Waiting', 'Someday']);
		expect(await deleteCategory(store, place, 'Someday', 'Waiting')).toMatchObject({ unsure: false, refused: 0 });
		expect((await place.read()).categories).toEqual(['This month', 'Waiting']);
		expect([await categoriesOf(tasks, uids[0]), await categoriesOf(tasks, uids[1])]).toEqual([['Waiting'], ['Waiting']]);
	});
});
