// The planner page's server side with a pretend calendar server, for the cases a shared test server can't stage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoAnswerError, RefusedError, type Calendar, type StoredItem } from '$lib/server/calendar-store';

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

function fakeStore(listed: Calendar[], settings = { categories: [] as string[], workCalendar: null as string | null, defaultEventCalendar: null as string | null }) {
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
		async replace(..._args: unknown[]) {},
		async update(..._args: unknown[]) {},
		async updateOccurrence() {},
		async remove(..._args: unknown[]) {},
		async removeOccurrence(..._args: unknown[]) {},
		addressFor: (name: string) => `${HOME}${name.toLowerCase()}/`,
		async readSettings() {
			return settings;
		},
		async create(url: string): Promise<StoredItem | void> {
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
			throw new RefusedError('Saving failed (500)', 500);
		};
		expect(await add({ kind: 'event', date: '2026-10-21', text: 'Dentist' })).toMatchObject({
			status: 502,
			data: { message: 'The calendar server didn\'t save "Dentist". Try again in a moment.' }
		});
	});
});

describe('adding a line when the calendar server does not answer in time', () => {
	it('says it may or may not be saved, rather than that it was not', async () => {
		fake = fakeStore([cal('me', 'Me'), cal('tasks', 'Tasks', ['task'])]);
		fake.create = async () => {
			throw new NoAnswerError('The calendar server did not answer in time (saving "Dentist")');
		};
		expect(await add({ kind: 'event', date: '2026-10-21', text: 'Dentist' })).toMatchObject({
			status: 502,
			data: { message: 'The calendar server didn\'t answer in time when asked to save "Dentist", so it may or may not be saved. Reload the page to see.' }
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
		throw new RefusedError('Saving "Dentist" failed (500) at http://10.1.2.3/ (secret detail)', 500);
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

	it.each(cases)('%s says it may or may not be done when the calendar server did not answer in time', async (action, fields, message) => {
		// A late answer is not a refusal: the server may still carry the change out.
		fake.replace = fake.update = fake.updateOccurrence = fake.remove = fake.removeOccurrence = fake.create = fake.ensureCalendar = async () => {
			throw new NoAnswerError('The calendar server did not answer in time (saving "Dentist")');
		};
		const asked = message.match(/didn't (.*)\. Reload/)![1];
		expect(await act(action, fields)).toMatchObject({
			status: 502,
			data: { message: `The calendar server didn't answer in time when asked to ${asked}, so it may or may not be done. Reload the page to see.` }
		});
	});

	it('treats a dropped connection like no answer', async () => {
		fake.remove = async () => {
			throw new TypeError('fetch failed');
		};
		expect(await act('delete', { uid: 'dentist' })).toMatchObject({ status: 502, data: { message: expect.stringContaining('may or may not be done') } });
	});

	it('quotes only the start of a long title, so the message fits on a phone', async () => {
		fake.items = [{ ...dentist(me), title: 'Pick up the dry cleaning and then the groceries for the weekend party' }];
		expect(await act('delete', { uid: 'dentist' })).toMatchObject({
			status: 502,
			data: { message: 'The calendar server didn\'t delete "Pick up the dry cleaning and then the g…". Reload the page and try again.' }
		});
	});
});

describe('deleting an item that is already gone from the calendar server', () => {
	const me = cal('me', 'Me');
	beforeEach(() => {
		fake = fakeStore([me, cal('tasks', 'Tasks', ['task'])]);
		fake.items = [dentist(me)];
	});

	it.each([404, 410])('counts a %i as deleted, not as a failure to try again', async (status) => {
		// Deleted on a phone meanwhile, or an earlier delete that got no answer landed after all.
		fake.remove = async () => {
			throw new RefusedError(`Deleting "Dentist" failed (${status})`, status);
		};
		expect(await act('delete', { uid: 'dentist' })).toBeUndefined();
	});
});

describe('calendar tags on the page', () => {
	beforeEach(() => {
		fake = fakeStore([cal('me', 'Me'), cal('family', 'Family'), cal('workouts', 'Workouts'), cal('work', 'Work'), cal('tasks', 'Tasks', ['task']), cal('shopping', 'Shopping', ['task'])]);
	});

	it('gives each calendar its short tag, told apart from the others', async () => {
		const data = await run('http://localhost/?page=2026-10-21');
		expect(data.calendarTags).toEqual({
			'/david/me/': 'Me',
			'/david/family/': 'Fami',
			'/david/workouts/': 'Worko',
			'/david/work/': 'Work',
			'/david/tasks/': 'Task',
			'/david/shopping/': 'Shop'
		});
	});

	it('tags the work calendar Work whatever it is called, and keeps Workouts apart from it', async () => {
		fake = fakeStore([cal('job', 'Job'), cal('workouts', 'Workouts'), cal('tasks', 'Tasks', ['task'])], { categories: [], workCalendar: '/david/job/', defaultEventCalendar: null });
		const data = await run('http://localhost/?page=2026-10-21');
		expect(data.calendarTags).toEqual({ '/david/job/': 'Work', '/david/workouts/': 'Worko', '/david/tasks/': 'Task' });
	});

	it('names a calendar with a blank name, or none (Radicale stands in its path), Unnamed calendar, tagged Cal; other names lose spaces at the ends', async () => {
		fake = fakeStore([{ url: `${HOME}blank/`, name: '  ', accepts: ['event'] }, { url: `${HOME}none/`, name: `${HOME}none/`, accepts: ['event'] }, { url: `${HOME}path/`, name: 'david/path', accepts: ['event'] }, cal('gym', '  Gym  ')]);
		const data = await run('http://localhost/?page=2026-10-21');
		expect(data.calendarTags).toEqual({ '/david/blank/': 'Cal 1', '/david/none/': 'Cal 2', '/david/path/': 'Cal 3', '/david/gym/': 'Gym' });
		expect(data.calendarLabels).toMatchObject({ '/david/gym/': 'Gym' });
		expect((data.calendarLabels as Record<string, string>)['/david/blank/']).toMatch(/^Unnamed calendar/);
	});

	it('says which collection is the main Tasks list, whose items need no tag', async () => {
		expect((await run('http://localhost/?page=2026-10-21')).tasksCalendar).toBe('/david/tasks/');
	});
});

describe('an item stored in two calendars under one UID (a move whose delete failed)', () => {
	const me = cal('me', 'Me');
	const family = cal('family', 'Family');
	beforeEach(() => {
		fake = fakeStore([me, family, cal('tasks', 'Tasks', ['task'])]);
		fake.items = [dentist(me), dentist(family)];
	});

	it('shows both copies, each with its own calendar, so the page can tell them apart', async () => {
		const data = (await run('http://localhost/?page=2026-10-21')) as { days: { events: { uid: string; calendar: string }[] }[] };
		expect(data.days.flatMap((d) => d.events).map((e) => `${e.uid} ${e.calendar}`)).toEqual(['dentist /david/me/', 'dentist /david/family/']);
	});

	it('names every calendar as the menus do, so the page can say which calendar each copy is in', async () => {
		const data = await run('http://localhost/?page=2026-10-21');
		expect(data.calendarLabels).toEqual({ '/david/me/': 'Me', '/david/family/': 'Family', '/david/tasks/': 'Tasks' });
	});

	it('changes the copy in the calendar the tap came from', async () => {
		const changed: string[] = [];
		fake.update = async (stored: StoredItem) => void changed.push(stored.calendarUrl);
		await act('mark', { uid: 'dentist', keptIn: '/david/family/', state: 'done' });
		await act('mark', { uid: 'dentist', keptIn: '/david/me/', state: 'done' });
		expect(changed).toEqual([family.url, me.url]);
	});
});

describe('future tasks', () => {
	it('say which calendar each is kept in, like the items on the days', async () => {
		const tasks = cal('tasks', 'Tasks', ['task']);
		fake = fakeStore([cal('me', 'Me'), tasks]);
		fake.items = [{ ...dentist(tasks), kind: 'task', date: undefined }];
		const data = (await run()) as { unscheduled: { calendar: string }[] };
		expect(data.unscheduled.map((t) => t.calendar)).toEqual(['/david/tasks/']);
	});

	it("go in the order of the categories in the settings, each showing only its category of David's", async () => {
		const tasks = cal('tasks', 'Tasks', ['task']);
		fake = fakeStore([tasks], { categories: ['Errands', 'Waiting'], workCalendar: null, defaultEventCalendar: null });
		const task = (uid: string, categories?: string[]): StoredItem => ({ ...dentist(tasks), uid, title: uid, kind: 'task', date: undefined, categories });
		fake.items = [task('none'), task('phone', ['Home']), task('wait', ['Home', 'WAITING']), task('errand', ['errands']), task('old', ['Someday'])];
		const data = (await run()) as { categories: string[]; unscheduled: Record<string, unknown>[] };
		expect(data.categories).toEqual(['Errands', 'Waiting']);
		expect(data.unscheduled.map((t) => [t.uid, t.label])).toEqual([['errand', 'Errands'], ['wait', 'Waiting'], ['none', undefined], ['phone', undefined], ['old', undefined]]);
		// Values from other apps stay on the server; the page never gets them.
		expect(data.unscheduled.some((t) => 'categories' in t)).toBe(false);
	});
});

describe('a task with a huge number of categories (from another app)', () => {
	it('does not slow the page down: each task is looked at once, and only its first 100 values', async () => {
		const tasks = cal('tasks', 'Tasks', ['task']);
		fake = fakeStore([tasks], { categories: ['This month', 'Waiting', 'Someday'], workCalendar: null, defaultEventCalendar: null });
		const values = [...Array.from({ length: 200_000 }, (_, i) => `Tag ${i}`), 'Waiting'];
		const task = (uid: string, categories?: string[]): StoredItem => ({ ...dentist(tasks), uid, title: uid, kind: 'task', date: undefined, categories });
		fake.items = [...Array.from({ length: 100 }, (_, i) => task(`many-${i}`, values)), task('plain', ['Someday'])];
		const started = performance.now();
		const data = (await run()) as { unscheduled: Record<string, unknown>[] };
		expect(performance.now() - started).toBeLessThan(250);
		expect(data.unscheduled[0]).toMatchObject({ uid: 'plain', label: 'Someday' });
		// 'Waiting' is too far down the list to count.
		expect(data.unscheduled[1]).not.toHaveProperty('label');
	});
});

describe('lists are for tasks', () => {
	it('gives an event no list, even one whose category from another app is a list name', async () => {
		const me = cal('me', 'Me');
		fake = fakeStore([me, cal('tasks', 'Tasks', ['task'])], { categories: ['Waiting'], workCalendar: null, defaultEventCalendar: null });
		fake.items = [{ ...dentist(me), categories: ['Waiting', 'Business'] }];
		const data = (await run('http://localhost/?page=2026-10-21')) as { days: { events: Record<string, unknown>[] }[] };
		const shown = data.days.flatMap((d) => d.events);
		expect(shown).toHaveLength(1);
		expect(shown[0]).not.toHaveProperty('label');
	});
});

describe('choosing a category in the details sheet', () => {
	it("saves the category's name and keeps the values other apps added", async () => {
		const tasks = cal('tasks', 'Tasks', ['task']);
		fake = fakeStore([tasks], { categories: ['This month', 'Waiting'], workCalendar: null, defaultEventCalendar: null });
		fake.items = [{ ...dentist(tasks), kind: 'task', date: undefined, categories: ['Home', 'This month'] }];
		const replaced: unknown[] = [];
		fake.replace = async (...args: unknown[]) => void replaced.push(args[1]);
		const sheet = { ...inNewCalendar(''), kind: 'task', date: '', calendar: '', keptIn: '/david/tasks/' };
		expect(await act('save', { ...sheet, label: 'waiting' })).toBeUndefined();
		expect(replaced).toEqual([expect.objectContaining({ categories: ['Waiting', 'Home'] })]);
		expect(await act('save', { ...sheet, label: 'Someday' })).toMatchObject({ status: 400, data: { message: 'Unknown list' } });
	});
});

describe('moving an item to another calendar from the details sheet', () => {
	const me = cal('me', 'Me');
	const family = cal('family', 'Family');
	const removed: string[] = [];
	beforeEach(() => {
		removed.length = 0;
		fake = fakeStore([me, family, cal('tasks', 'Tasks', ['task'])]);
		fake.items = [dentist(me)];
		fake.create = async (url: string) => ({ ...dentist(cal('x', 'X')), calendarUrl: url, url: `${url}dentist.ics` });
	});
	const toFamily = { ...inNewCalendar(''), calendar: '/david/family/' };

	it('takes the new copy back out when the old one cannot be deleted, so there is still only one', async () => {
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) throw new RefusedError('Deleting "Dentist" failed (403)', 403);
			removed.push(stored.url);
		};
		expect(await act('save', toFamily)).toMatchObject({
			status: 502,
			data: { message: 'The calendar server didn\'t move "Dentist" to another calendar, so it stays where it was. Reload the page and try again.' }
		});
		expect(removed).toEqual([`${family.url}dentist.ics`]);
	});

	it('says the other changes made in the sheet were not saved either when the move is taken back', async () => {
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) throw new RefusedError('Deleting "Dentist" failed (403)', 403);
			removed.push(stored.url);
		};
		expect(await act('save', { ...toFamily, notes: 'Bring the form' })).toMatchObject({
			status: 502,
			data: { message: 'The calendar server didn\'t move "Dentist" to another calendar, so it stays where it was, and your other changes weren\'t saved either. Reload the page and try again.' }
		});
	});

	it('keeps the new copy when the old one was in fact deleted but the answer was lost (a timeout)', async () => {
		// The delete reached the calendar server and was done; only its answer never came back.
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) {
				fake.items = fake.items.filter((i) => i.calendarUrl !== me.url);
				throw new Error('The calendar server did not answer in time (deleting "Dentist")');
			}
			removed.push(stored.url);
		};
		// The move is done, so there is nothing to report.
		expect(await act('save', toFamily)).toBeUndefined();
		// Taking the new copy back out now would leave "Dentist" in no calendar at all.
		expect(removed).toEqual([]);
	});

	it('keeps the new copy when the old one\'s delete timed out, even if the old one is still there when read again', async () => {
		// The delete is still waiting on the calendar server (another request holds its storage lock), so a read
		// straight after the time limit still finds the old copy, and the delete is done a few seconds later.
		// Taking the new copy out on a timeout would then leave "Dentist" in no calendar at all.
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) {
				setTimeout(() => (fake.items = fake.items.filter((i) => i.calendarUrl !== me.url)), 50);
				throw new Error('The calendar server did not answer in time (deleting "Dentist")');
			}
			removed.push(stored.url);
		};
		const result = await act('save', toFamily);
		await new Promise((r) => setTimeout(r, 100));
		expect(removed).toEqual([]);
		expect(result).toMatchObject({ status: 502, data: { message: expect.stringContaining('may now be in two calendars') } });
	});

	it.each([500, 502, 503, 504])('keeps the new copy when the old one\'s delete gets a %i, which may not be the last word', async (status) => {
		// A server error or a proxy giving up is not a refusal: the calendar server may still carry the delete out,
		// and taking the new copy out then would leave "Dentist" in no calendar at all.
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) throw new RefusedError(`Deleting "Dentist" failed (${status})`, status);
			removed.push(stored.url);
		};
		expect(await act('save', toFamily)).toMatchObject({ status: 502, data: { message: expect.stringContaining("didn't confirm it removed the old one") } });
		expect(removed).toEqual([]);
	});

	it('keeps the new copy when the connection drops during the old one\'s delete', async () => {
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) throw new TypeError('fetch failed');
			removed.push(stored.url);
		};
		expect(await act('save', toFamily)).toMatchObject({ status: 502, data: { message: expect.stringContaining('may now be in two calendars') } });
		expect(removed).toEqual([]);
	});

	it('removes nothing when the new copy was saved at the old one\'s address', async () => {
		const deleted: string[] = [];
		fake.create = async () => dentist(me);
		fake.remove = async (stored: StoredItem) => void deleted.push(stored.url);
		expect(await act('save', toFamily)).toBeUndefined();
		expect(deleted).toEqual([]);
	});

	it('keeps the new copy when it cannot tell whether the old one is still there', async () => {
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) throw new Error('The calendar server did not answer in time (deleting "Dentist")');
			removed.push(stored.url);
		};
		let reads = 0;
		const before = fake.items;
		// The first read finds the item; the check after the failed delete gets no answer.
		fake.listItems = async () => {
			if (reads++ === 0) return before;
			throw new Error('The calendar server did not answer in time (reading Me)');
		};
		expect(await act('save', toFamily)).toMatchObject({
			status: 502,
			data: { message: WAIT_THEN_DELETE_OLD }
		});
		expect(removed).toEqual([]);
	});

	// The old copy's delete may still be waiting on the calendar server. Reloading at once and deleting the new copy
	// would leave nothing once that delete lands, so the message says to wait, and to delete the one in the old calendar.
	const WAIT_THEN_DELETE_OLD =
		'"Dentist" may now be in two calendars, because the calendar server didn\'t confirm it removed the old one. Wait a minute before reloading the page; then, if it\'s still in two, delete the one in Me.';

	it('says to wait, then delete the copy in the old calendar, when the old one\'s delete timed out', async () => {
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) throw new NoAnswerError('The calendar server did not answer in time (deleting "Dentist")');
			removed.push(stored.url);
		};
		expect(await act('save', toFamily)).toMatchObject({ status: 502, data: { message: WAIT_THEN_DELETE_OLD } });
	});

	it('names the old calendar as the menus do when two calendars share its name', async () => {
		const otherMe = cal('me-2', 'Me');
		fake = fakeStore([me, otherMe, family, cal('tasks', 'Tasks', ['task'])]);
		fake.items = [dentist(me)];
		fake.create = async (url: string) => ({ ...dentist(cal('x', 'X')), calendarUrl: url, url: `${url}dentist.ics` });
		fake.remove = async () => {
			throw new NoAnswerError('The calendar server did not answer in time (deleting "Dentist")');
		};
		expect(await act('save', toFamily)).toMatchObject({ status: 502, data: { message: expect.stringContaining('delete the one in Me (me).') } });
	});

	it.each([404, 410])('says it stayed where it was when the new copy is already gone (%i) as it is taken back', async (status) => {
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) throw new RefusedError('Deleting "Dentist" failed (403)', 403);
			throw new RefusedError(`Deleting "Dentist" failed (${status})`, status);
		};
		expect(await act('save', toFamily)).toMatchObject({
			status: 502,
			data: { message: 'The calendar server didn\'t move "Dentist" to another calendar, so it stays where it was. Reload the page and try again.' }
		});
	});

	it('says to wait, then delete the new copy, when taking it back out timed out', async () => {
		// The old copy surely stays (its delete was refused); the new copy's delete may still land.
		fake.remove = async (stored: StoredItem) => {
			if (stored.calendarUrl === me.url) throw new RefusedError('Deleting "Dentist" failed (403)', 403);
			throw new NoAnswerError('The calendar server did not answer in time (deleting "Dentist")');
		};
		expect(await act('save', toFamily)).toMatchObject({
			status: 502,
			data: {
				message:
					'The calendar server didn\'t move "Dentist" to another calendar, and didn\'t confirm it took the new copy back out. Wait a minute before reloading the page; then, if it\'s still in two, delete the one in Family.'
			}
		});
	});

	describe('while someone else moves it at the same time', () => {
		const work = cal('work', 'Work');
		const twice = '"Dentist" may now be in two calendars, because it seems to have been moved on another device at the same time. Reload the page and delete the one you don\'t want.';

		it('says it may be in two calendars when the old copy was already removed by the other move', async () => {
			// The other move saved its copy in Work and removed the old one before this delete arrived.
			fake.remove = async (stored: StoredItem) => {
				if (stored.calendarUrl === me.url) {
					fake.items = [dentist(work), dentist(family)];
					throw new RefusedError('Deleting "Dentist" failed (404)', 404);
				}
				removed.push(stored.url);
			};
			expect(await act('save', toFamily)).toMatchObject({ status: 502, data: { message: twice } });
			expect(removed).toEqual([]);
		});

		it('says it may be in two calendars when the other move\'s copy is there after this one removed the old copy', async () => {
			fake.remove = async (stored: StoredItem) => {
				if (stored.calendarUrl === me.url) fake.items = [dentist(work), dentist(family)];
				else removed.push(stored.url);
			};
			expect(await act('save', toFamily)).toMatchObject({ status: 502, data: { message: twice } });
			expect(removed).toEqual([]);
		});

		it('counts the move as done when the old copy is gone and no other copy is left', async () => {
			// Deleted on a phone in the meantime, say: the new copy is the only one, so it must stay.
			fake.remove = async (stored: StoredItem) => {
				if (stored.calendarUrl === me.url) {
					fake.items = [dentist(family)];
					throw new RefusedError('Deleting "Dentist" failed (404)', 404);
				}
				removed.push(stored.url);
			};
			expect(await act('save', toFamily)).toBeUndefined();
			expect(removed).toEqual([]);
		});
	});

	it('says plainly when the item is left in both calendars', async () => {
		fake.remove = async () => {
			throw new RefusedError('Deleting "Dentist" failed (403)', 403);
		};
		expect(await act('save', toFamily)).toMatchObject({
			status: 502,
			data: { message: '"Dentist" is now in two calendars, because the calendar server wouldn\'t remove the old one. Reload the page and delete the one you don\'t want.' }
		});
	});
});

describe('a second tap that arrives while the first is saving', () => {
	const me = cal('me', 'Me');
	beforeEach(() => {
		fake = fakeStore([me, cal('tasks', 'Tasks', ['task'])]);
	});
	const refused = async () => {
		throw new Error('Saving "Dentist" failed (412); reload and try again');
	};

	it('is not a failure when the first tap already made the change it asked for', async () => {
		const before = dentist(me);
		let reads = 0;
		// The second tap read the item before the first one's save landed, so its own save is refused.
		fake.listItems = async () => (reads++ === 0 ? [before] : [{ ...before, state: 'done' as const, etag: 'new' }]);
		fake.update = refused;
		expect(await act('mark', { uid: 'dentist', state: 'done' })).toBeUndefined();
	});

	it('is not a failure for a move that already happened', async () => {
		const before = { ...dentist(me), kind: 'task' as const };
		let reads = 0;
		fake.listItems = async () => (reads++ === 0 ? [before] : [{ ...before, date: '2026-10-22' }]);
		fake.update = refused;
		expect(await act('move', { uid: 'dentist', to: '2026-10-22' })).toBeUndefined();
	});

	it('is still a failure when the item ended up some other way', async () => {
		const before = dentist(me);
		let reads = 0;
		fake.listItems = async () => (reads++ === 0 ? [before] : [{ ...before, state: 'dropped' as const }]);
		fake.update = refused;
		expect(await act('mark', { uid: 'dentist', state: 'done' })).toMatchObject({ status: 502 });
	});
});
// After a move whose delete got no answer, the page shows two copies and says to delete the one in the old calendar.
// If that old copy goes meanwhile (its late delete lands, or a phone deletes it), the tap on its Delete must not
// fall through to the other copy, which is now the only one.
describe('deleting a copy that went away after the page was drawn', () => {
	const me = cal('me', 'Me');
	const family = cal('family', 'Family');
	beforeEach(() => {
		fake = fakeStore([me, family, cal('tasks', 'Tasks', ['task'])]);
		fake.items = [dentist(family)]; // the copy in Me is already gone
	});

	it('leaves the copy in another calendar alone', async () => {
		const removed: string[] = [];
		fake.remove = async (stored: StoredItem) => void removed.push(stored.calendarUrl);
		await act('delete', { uid: 'dentist', keptIn: '/david/me/' });
		expect(removed).toEqual([]);
	});

	it('counts the delete as done, since the copy tapped is gone', async () => {
		expect(await act('delete', { uid: 'dentist', keptIn: '/david/me/' })).toBeUndefined();
	});

	it('leaves the other copy alone for "Delete this day" too', async () => {
		fake.items = [{ ...dentist(family), recurrence: 'FREQ=WEEKLY' }];
		const changed: string[] = [];
		fake.removeOccurrence = async (stored: StoredItem) => void changed.push(stored.calendarUrl);
		expect(await act('deleteOne', { uid: 'dentist', keptIn: '/david/me/', occurrence: '2026-10-21' })).toBeUndefined();
		expect(changed).toEqual([]);
	});

	it('does not save the sheet onto the other copy, which a move would then remove', async () => {
		const touched: string[] = [];
		fake.replace = fake.remove = async (stored: StoredItem) => void touched.push(stored.calendarUrl);
		fake.create = async (url: string) => void touched.push(url);
		expect(await act('save', { ...inNewCalendar(''), keptIn: '/david/me/', calendar: '/david/me/' })).toMatchObject({
			status: 404,
			data: { message: 'That item is no longer on the calendar; reload the page' }
		});
		expect(touched).toEqual([]);
	});

	it('still deletes the only copy when the page did not say which calendar it is in', async () => {
		const removed: string[] = [];
		fake.remove = async (stored: StoredItem) => void removed.push(stored.calendarUrl);
		await act('delete', { uid: 'dentist' });
		expect(removed).toEqual([family.url]);
	});
});
