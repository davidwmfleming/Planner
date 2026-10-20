// The planner page's server side with a pretend calendar server, for the cases a shared test server can't stage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefusedError, type Calendar, type StoredItem } from '$lib/server/calendar-store';

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
		async update(..._args: unknown[]) {},
		async updateOccurrence() {},
		async remove(..._args: unknown[]) {},
		async removeOccurrence() {},
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

	it('quotes only the start of a long title, so the message fits on a phone', async () => {
		fake.items = [{ ...dentist(me), title: 'Pick up the dry cleaning and then the groceries for the weekend party' }];
		expect(await act('delete', { uid: 'dentist' })).toMatchObject({
			status: 502,
			data: { message: 'The calendar server didn\'t delete "Pick up the dry cleaning and then the g…". Reload the page and try again.' }
		});
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
			data: { message: '"Dentist" may now be in two calendars, because the calendar server didn\'t confirm it removed the old one. Reload the page and delete the one you don\'t want.' }
		});
		expect(removed).toEqual([]);
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
