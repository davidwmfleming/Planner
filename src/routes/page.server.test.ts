// The planner page's server side with a pretend calendar server, for the cases a shared test server can't stage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Calendar } from '$lib/server/calendar-store';

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
		async listItems() {
			return [];
		},
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
const add = (fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return (actions.add as (e: unknown) => Promise<unknown>)({ request: new Request('http://localhost/?/add', { method: 'POST', body }) });
};

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
			{ path: '/david/b/', name: 'Family' },
			{ path: '/david/a/', name: 'Family' },
			{ path: '/david/work/', name: 'Work' }
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
