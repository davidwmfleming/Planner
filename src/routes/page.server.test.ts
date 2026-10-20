// The planner page's server side with a pretend calendar server, for the cases a shared test server can't stage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Calendar, StoredItem } from '$lib/server/calendar-store';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/rollover', () => ({ rollover: async () => 0 }));

const HOME = 'http://127.0.0.1:5232/david/';
let fake: ReturnType<typeof fakeStore>;
let connectError: Error | undefined;
vi.mock('$lib/server/store', async (original) => ({
	...(await original<typeof import('$lib/server/store')>()),
	getStore: async () => {
		if (connectError) throw connectError;
		return fake;
	}
}));

function fakeStore(listed: Calendar[], settings = { categories: [], workCalendar: null as string | null, defaultEventCalendar: null as string | null }) {
	return {
		listed,
		/** What the server holds now; a refresh makes the planner see it. */
		onServer: listed,
		created: [] as string[],
		calendars() {
			return this.listed;
		},
		async refreshCalendars() {
			this.listed = this.onServer;
		},
		/** Items on the server, as the store hands them out. */
		items: [] as StoredItem[],
		/** Names of calendars made by the planner. */
		made: [] as string[],
		async listItems() {
			return this.items;
		},
		async ensureCalendar(name: string, accepts: Calendar['accepts']) {
			const made = { url: `${HOME}${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`, name, accepts };
			this.made.push(name);
			this.listed = this.onServer = [...this.onServer, made];
			return made;
		},
		async replace() {},
		async update() {},
		async updateOccurrence() {},
		async remove() {},
		async removeOccurrence() {},
		addressFor: (name: string) => `${HOME}${name.toLowerCase()}/`,
		async readSettings() {
			return settings;
		},
		async create(url: string) {
			if (!this.listed.some((c) => c.url === url)) throw new Error('No calendar there');
			if (!this.onServer.some((c) => c.url === url)) throw new Error('Saving failed (409)');
			this.created.push(url);
		}
	};
}

const cal = (slug: string, name: string, accepts: Calendar['accepts'] = ['event']): Calendar => ({ url: `${HOME}${slug}/`, name, accepts });
const { load, actions } = await import('./+page.server');
const run = (url = 'http://localhost/') => (load as (e: unknown) => Promise<Record<string, unknown>>)({ url: new URL(url) });
const act = (action: keyof typeof actions, fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return (actions[action] as (e: unknown) => Promise<unknown>)({ request: new Request(`http://localhost/?/${action}`, { method: 'POST', body }) });
};
const add = (fields: Record<string, string>) => act('add', fields);
const dentist = (calendar: Calendar): StoredItem => ({
	uid: 'dentist',
	kind: 'event',
	title: 'Dentist',
	state: 'open',
	date: '2026-10-21',
	calendarUrl: calendar.url,
	url: `${calendar.url}dentist.ics`,
	ics: ''
});
/** The details sheet's fields for the dentist, filed in a new calendar with this name. */
const inNewCalendar = (newCalendar: string) => ({
	uid: 'dentist', title: 'Dentist', kind: 'event', date: '2026-10-21', time: '', endTime: '', location: '', label: '', notes: '',
	repeat: '', calendar: '+new', newCalendar
});

let logged: typeof console.error;
beforeEach(() => {
	connectError = undefined;
	logged = console.error;
	console.error = () => {};
});
afterEach(() => {
	console.error = logged;
});

describe('the planner page', () => {
	it('shows the page, not an error, when there are no event calendars', async () => {
		fake = fakeStore([cal('tasks', 'Tasks', ['task'])]);
		const data = await run();
		expect(data.eventCalendars).toEqual([]);
		expect(data.defaultEventCalendar).toBeUndefined();
	});

	it("keeps the calendar server's own error text off the page", async () => {
		connectError = new Error('connect ECONNREFUSED 10.1.2.3:5232 (secret detail)');
		await expect(run()).rejects.toMatchObject({ status: 503, body: { message: "The calendar server isn't answering. Check that it is running, then reload." } });
	});

	it('passes calendars by address and lists them by name, so two with one name stay apart', async () => {
		fake = fakeStore([cal('work', 'Work'), cal('b', 'Family'), cal('a', 'Family'), cal('tasks', 'Tasks', ['task'])], {
			categories: [],
			workCalendar: '/david/work/',
			defaultEventCalendar: '/david/a/'
		});
		const data = await run();
		expect(data.eventCalendars).toEqual([
			{ path: '/david/b/', name: 'Family', label: 'Family (b)' },
			{ path: '/david/a/', name: 'Family', label: 'Family (a)' },
			{ path: '/david/work/', name: 'Work', label: 'Work' }
		]);
		expect(data.workCalendar).toBe('/david/work/');
		expect(data.defaultEventCalendar).toBe('/david/a/');
	});
});

describe('adding a line', () => {
	it('puts a new event in the first remaining calendar when the chosen one was deleted on another device', async () => {
		fake = fakeStore([cal('family', 'Family'), cal('me', 'Me'), cal('tasks', 'Tasks', ['task'])], { categories: [], workCalendar: null, defaultEventCalendar: '/david/me/' });
		fake.onServer = fake.listed.filter((c) => c.name !== 'Me');
		expect(await add({ kind: 'event', date: '2026-10-21', text: 'Dentist' })).toEqual({ added: 'Dentist' });
		expect(fake.created).toEqual([`${HOME}family/`]);
	});

	it('falls back to the first event calendar by name, as the menus list them, not in server order', async () => {
		fake = fakeStore([cal('zoo', 'Zoo trips'), cal('tasks', 'Tasks', ['task']), cal('family', 'family'), cal('me', 'Me')], { categories: [], workCalendar: null, defaultEventCalendar: '/david/gone/' });
		expect((await run()).defaultEventCalendar).toBe('/david/family/');
		expect(await add({ kind: 'event', date: '2026-10-21', text: 'Dentist' })).toEqual({ added: 'Dentist' });
		expect(fake.created).toEqual([`${HOME}family/`]);
	});

	it('says plainly that there is no calendar for events, rather than failing', async () => {
		fake = fakeStore([cal('tasks', 'Tasks', ['task'])]);
		expect(await add({ kind: 'event', date: '2026-10-21', text: 'Dentist' })).toMatchObject({
			status: 409,
			data: { message: 'There is no calendar for events yet. Add one in Settings.' }
		});
	});

	it('says the calendar server did not save it when saving fails', async () => {
		fake = fakeStore([cal('me', 'Me'), cal('tasks', 'Tasks', ['task'])]);
		fake.create = async () => {
			throw new Error('Saving failed (500)');
		};
		expect(await add({ kind: 'event', date: '2026-10-21', text: 'Dentist' })).toMatchObject({
			status: 502,
			data: { message: 'The calendar server didn\'t save "Dentist". Try again in a moment.' }
		});
	});
});

describe('the details sheet', () => {
	const me = cal('me', 'Me');
	beforeEach(() => {
		fake = fakeStore([me, cal('tasks', 'Tasks', ['task'])]);
		fake.items = [dentist(me)];
	});

	it('refuses a new calendar whose name is only invisible characters', async () => {
		expect(await act('save', inNewCalendar('\u200b\u200b'))).toMatchObject({ status: 400, data: { message: 'Give the calendar a name' } });
		expect(fake.made).toEqual([]);
	});

	it('drops control characters from a new calendar name rather than failing', async () => {
		await act('save', inNewCalendar('Bell\u0007 ringing'));
		expect(fake.made).toEqual(['Bell ringing']);
	});

	it('follows the same rules as the settings page for a name already used or too long', async () => {
		expect(await act('save', inNewCalendar('tasks'))).toMatchObject({ status: 400, data: { message: 'There is already a calendar called "Tasks"' } });
		expect(await act('save', inNewCalendar('a'.repeat(41)))).toMatchObject({ status: 400, data: { message: 'Keep the name to 40 letters or fewer' } });
		expect(fake.made).toEqual([]);
	});
});

describe('when the calendar server fails during a change', () => {
	const me = cal('me', 'Me');
	const broken = async () => {
		throw new Error('Saving "Dentist" failed (500) at http://10.1.2.3/ (secret detail)');
	};
	const water = (): StoredItem => ({ ...dentist(me), uid: 'water', kind: 'task', title: 'Water plants', calendarUrl: `${HOME}tasks/`, url: `${HOME}tasks/water.ics` });
	const weekly = (): StoredItem => ({ ...dentist(me), uid: 'yoga', title: 'Yoga', recurrence: 'FREQ=WEEKLY' });
	beforeEach(() => {
		fake = fakeStore([me, cal('tasks', 'Tasks', ['task'])]);
		fake.items = [dentist(me), water(), weekly()];
		fake.replace = fake.update = fake.updateOccurrence = fake.remove = fake.removeOccurrence = fake.create = broken;
		fake.ensureCalendar = broken;
	});

	const cases: [keyof typeof actions, Record<string, string>, string][] = [
		['mark', { uid: 'dentist', state: 'done' }, 'The calendar server didn\'t save the mark on "Dentist". Reload the page and try again.'],
		['mark', { uid: 'yoga', state: 'dropped', occurrence: '2026-10-21' }, 'The calendar server didn\'t save the mark on "Yoga". Reload the page and try again.'],
		['move', { uid: 'water', to: '2026-10-22' }, 'The calendar server didn\'t move "Water plants". Reload the page and try again.'],
		['unschedule', { uid: 'water' }, 'The calendar server didn\'t move "Water plants". Reload the page and try again.'],
		['save', { ...inNewCalendar(''), calendar: '/david/me/' }, 'The calendar server didn\'t save "Dentist". Reload the page and try again.'],
		['save', inNewCalendar('Lessons'), 'The calendar server didn\'t save "Dentist". Reload the page and try again.'],
		['delete', { uid: 'dentist' }, 'The calendar server didn\'t delete "Dentist". Reload the page and try again.'],
		['deleteOne', { uid: 'yoga', occurrence: '2026-10-21' }, 'The calendar server didn\'t delete that day of "Yoga". Reload the page and try again.']
	];

	it.each(cases)('%s says so plainly, keeping the server\'s own error in the log', async (action, fields, message) => {
		const log: unknown[] = [];
		console.error = (...args) => log.push(...args);
		expect(await act(action, fields)).toMatchObject({ status: 502, data: { message } });
		expect(log.some((e) => e instanceof Error && e.message.includes('secret detail'))).toBe(true);
	});

	it.each(cases)('%s says the server is not answering when it cannot be reached', async (action, fields) => {
		connectError = new Error('connect ECONNREFUSED 10.1.2.3:5232');
		expect(await act(action, fields)).toMatchObject({ status: 503, data: { message: "The calendar server isn't answering. Check that it is running, then reload." } });
	});
});
