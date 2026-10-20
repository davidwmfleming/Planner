import { describe, expect, it } from 'vitest';
import type { ItemKind } from '$lib/item';
import type { Settings } from '$lib/settings';
import type { Calendar } from './calendar-store';
import { prepareStore, type StartOptions } from './startup';

const HOME = 'http://127.0.0.1:5232/david/';

/** Just enough of a calendar server to watch what the planner does when it starts. */
class FakeStore {
	list: Calendar[] = [];
	stored = new Map<string, string>();
	made: string[] = [];

	constructor(names: [string, ItemKind[]][] = []) {
		for (const [name, accepts] of names) this.add(name, accepts);
	}
	private add(name: string, accepts: ItemKind[]) {
		const calendar = { url: `${HOME}${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`, name, accepts };
		this.list.push(calendar);
		return calendar;
	}
	calendars() {
		return this.list;
	}
	async ensureCalendar(name: string, accepts: ItemKind[]) {
		const existing = this.list.find((c) => c.name === name);
		if (existing) return existing;
		this.made.push(name);
		return this.add(name, accepts);
	}
	async renameCalendar(from: string, to: string) {
		const calendar = this.list.find((c) => c.name === from);
		if (calendar) calendar.name = to;
	}
	async storedSettings(url: string) {
		return this.stored.get(url);
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
		store.storedSettings = async () => {
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
});
