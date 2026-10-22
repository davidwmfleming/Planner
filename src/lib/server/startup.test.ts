import { describe, expect, it } from 'vitest';
import type { ItemKind } from '$lib/item';
import type { Settings } from '$lib/settings';
import type { Calendar } from './calendar-store';
import { addDueDates, prepareStore, tasksCalendarUrl, type StartOptions } from './startup';

const HOME = 'http://127.0.0.1:5232/david/';

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Just enough of a calendar server to watch what the planner does when it starts. */
class FakeStore {
	/** What a listing of the calendars returns; a hiccup can make it come back empty. */
	list: Calendar[] = [];
	/** What the server really holds, listed or not. */
	onServer = new Set<string>();
	stored = new Map<string, string>();
	made: string[] = [];

	constructor(names: [string, ItemKind[]][] = []) {
		for (const [name, accepts] of names) this.add(name, accepts);
	}
	add(name: string, accepts: ItemKind[], url = this.addressFor(name)) {
		const calendar = { url, name, accepts };
		this.list.push(calendar);
		this.onServer.add(url);
		return calendar;
	}
	addressFor(name: string) {
		return `${HOME}${slug(name)}/`;
	}
	calendars() {
		return this.list;
	}
	async ensureCalendar(name: string, accepts: ItemKind[], url?: string) {
		const existing = this.list.find((c) => (url ? c.url === url : c.name === name));
		if (existing) return existing;
		if (this.onServer.has(url ?? this.addressFor(name))) throw new Error('MKCALENDAR refused: already there');
		this.made.push(name);
		return this.add(name, accepts, url);
	}
	async renameCalendar(from: string, to: string) {
		const calendar = this.list.find((c) => c.name === from);
		if (calendar) calendar.name = to;
	}
	async settingsAt(url: string) {
		return { found: this.onServer.has(url), stored: this.stored.get(url) };
	}
	async writeSettings(url: string, settings: Settings) {
		this.stored.set(url, JSON.stringify(settings));
	}
	settingsOn(name: string): Settings | undefined {
		const raw = this.stored.get(this.list.find((c) => c.name === name)!.url);
		return raw ? JSON.parse(raw) : undefined;
	}
}

const options: StartOptions = {
	startingCalendars: ['Me', 'Family', 'Workouts', 'Morgan Meals'],
	workCalendar: 'Work',
	eventsCalendar: 'Me',
	tasksCalendar: 'Tasks'
};

describe('starting the planner', () => {
	it('makes the starting calendars and the Tasks list on a first run', async () => {
		const store = new FakeStore();
		await prepareStore(store, options);
		expect(store.made).toEqual(['Me', 'Family', 'Workouts', 'Morgan Meals', 'Work', 'Tasks']);
		expect(store.list.find((c) => c.name === 'Tasks')?.accepts).toEqual(['task']);
	});

	it('does not bring back a calendar David deleted', async () => {
		const store = new FakeStore([['Me', ['event']], ['Workouts', ['event']], ['Tasks', ['task']]]);
		await prepareStore(store, options);
		expect(store.made).toEqual([]);
	});

	it('makes the Tasks list if it is missing, since every task and the settings live there', async () => {
		const store = new FakeStore([['Me', ['event']]]);
		await prepareStore(store, options);
		expect(store.made).toEqual(['Tasks']);
	});

	it('still renames the old Personal calendar to Me', async () => {
		const store = new FakeStore([['Personal', ['event']], ['Tasks', ['task']]]);
		await prepareStore(store, options);
		expect(store.list.map((c) => c.name)).toEqual(['Me', 'Tasks']);
		expect(store.made).toEqual([]);
	});

	it('fills in the Work and default choices once, from the names in .env', async () => {
		const store = new FakeStore([['Me', ['event']], ['Office', ['event']], ['Family', ['event']], ['Tasks', ['task']]]);
		await prepareStore(store, { ...options, workCalendar: 'Office', eventsCalendar: 'Family' });
		expect(store.settingsOn('Tasks')).toEqual({
			categories: ['This month', 'Waiting', 'Someday'],
			workCalendar: `${new URL(HOME).pathname}office/`,
			defaultEventCalendar: `${new URL(HOME).pathname}family/`
		});
	});

	it('never overwrites settings already stored', async () => {
		const store = new FakeStore([['Me', ['event']], ['Work', ['event']], ['Tasks', ['task']]]);
		const mine = { categories: ['Errands'], workCalendar: null, defaultEventCalendar: '/david/work/' };
		await store.writeSettings(store.list[2].url, mine);
		await prepareStore(store, options);
		expect(store.settingsOn('Tasks')).toEqual(mine);
	});

	it('does not treat stored settings as a first run, even with no event calendars listed', async () => {
		const store = new FakeStore([['Tasks', ['task']]]);
		await store.writeSettings(store.list[0].url, { categories: ['Errands'], workCalendar: null, defaultEventCalendar: null });
		await prepareStore(store, options);
		expect(store.made).toEqual([]);
	});

	it('neither writes settings nor makes calendars when reading the settings fails', async () => {
		const store = new FakeStore([['Tasks', ['task']]]);
		store.settingsAt = async () => {
			throw new Error('500');
		};
		let wrote = false;
		store.writeSettings = async () => {
			wrote = true;
		};
		const logged = console.error;
		console.error = () => {};
		try {
			await prepareStore(store, options);
		} finally {
			console.error = logged;
		}
		expect(wrote).toBe(false);
		expect(store.made).toEqual([]);
	});

	it('keeps starting when the calendar server refuses a step', async () => {
		const store = new FakeStore();
		store.writeSettings = async () => {
			throw new Error('refused');
		};
		const logged = console.error;
		console.error = () => {};
		try {
			await expect(prepareStore(store, options)).resolves.toBeUndefined();
		} finally {
			console.error = logged;
		}
	});

	it('does not rename a calendar David called "Personal" back to "Me" once settings are stored', async () => {
		const store = new FakeStore([['Tasks', ['task']]]);
		store.add('Personal', ['event'], `${HOME}me/`); // Me, renamed to Personal on the settings page
		await store.writeSettings(store.addressFor('Tasks'), { categories: ['Waiting'], workCalendar: null, defaultEventCalendar: '/david/me/' });
		await prepareStore(store, options);
		expect(store.list.map((c) => c.name)).toContain('Personal');
	});

	it('does not recreate deleted starting calendars when the listing comes back empty', async () => {
		const store = new FakeStore([['Tasks', ['task']]]);
		await store.writeSettings(store.addressFor('Tasks'), { categories: ['Waiting'], workCalendar: null, defaultEventCalendar: null });
		store.list = []; // a successful listing with nothing in it; Tasks and its settings are still on the server
		await prepareStore(store, options);
		expect(store.made).toEqual([]);
	});

	it('makes nothing when Tasks is there but not listed, even before settings are stored', async () => {
		const store = new FakeStore([['Tasks', ['task']]]);
		store.list = [];
		await prepareStore(store, options);
		expect(store.made).toEqual([]);
		expect(store.stored.size).toBe(0); // the choices are filled in on a start that can see the calendars
	});

	it('keeps using the Tasks list by its address when it is renamed on a phone and another task list exists', async () => {
		const store = new FakeStore([['Phone Reminders', ['task']]]);
		const tasks = store.add('Chores', ['task'], store.addressFor('Tasks')); // Tasks renamed in the iPhone Reminders app
		await store.writeSettings(tasks.url, { categories: ['Waiting'], workCalendar: null, defaultEventCalendar: null });
		await prepareStore(store, options);
		expect(tasksCalendarUrl(store, 'Tasks')).toBe(tasks.url);
		expect([...store.stored.keys()]).toEqual([tasks.url]);
	});

	it('makes Tasks at its own address, not reusing a phone list that happens to be called Tasks', async () => {
		const store = new FakeStore([['Me', ['event']]]);
		store.add('Tasks', ['task'], `${HOME}0f3c9a-phone/`);
		await prepareStore(store, options);
		expect(tasksCalendarUrl(store, 'Tasks')).toBe(`${HOME}tasks/`);
		expect([...store.stored.keys()]).toEqual([`${HOME}tasks/`]);
	});
});

describe('giving older tasks a due date at start', () => {
	const task = (uid: string, ...lines: string[]) =>
		['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', `UID:${uid}`, 'DTSTAMP:20261019T000000Z', ...lines, 'END:VTODO', 'END:VCALENDAR'].join('\r\n');

	it('saves only the tasks that need it, only as read, and carries on past one it cannot save', async () => {
		const tasks = { url: `${HOME}tasks/`, name: 'Tasks', accepts: ['task'] as ItemKind[] };
		const work = { url: `${HOME}work/`, name: 'Work', accepts: ['event'] as ItemKind[] };
		const docs = [
			{ calendarUrl: tasks.url, url: `${tasks.url}a.ics`, etag: '"1"', ics: task('a', 'DTSTART;VALUE=DATE:20261019') },
			{ calendarUrl: tasks.url, url: `${tasks.url}b.ics`, etag: '"2"', ics: task('b', 'DTSTART;VALUE=DATE:20261020') },
			{ calendarUrl: tasks.url, url: `${tasks.url}c.ics`, etag: '"3"', ics: task('c') },
			{ calendarUrl: tasks.url, url: `${tasks.url}d.ics`, etag: '"4"', ics: 'not a calendar' }
		];
		const saved: { url: string; etag?: string; ics: string }[] = [];
		const store = {
			calendars: () => [tasks, work],
			documents: async (url: string) => {
				expect(url).toBe(tasks.url);
				return { version: '"v"', documents: docs };
			},
			saveDocument: async (doc: { url: string; etag?: string }, ics: string) => {
				if (doc.url.endsWith('b.ics')) throw new Error('412: changed on a phone');
				saved.push({ url: doc.url, etag: doc.etag, ics });
			}
		};
		expect(await addDueDates(store)).toBe(1);
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({ url: `${tasks.url}a.ics`, etag: '"1"' });
		expect(saved[0].ics).toContain('DUE;VALUE=DATE:20261019');
	});
});
