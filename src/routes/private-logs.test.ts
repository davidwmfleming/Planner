// House rule 4: the server's log is kept, so it must never hold an item's title or details, or a calendar's name.
// Each failure the planner logs is staged here against the real calendar store, with a pretend calendar server
// underneath, and everything written to the log is checked for the personal words.
import { format } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarStore, logged, type StoredItem } from '$lib/server/calendar-store';
import { itemToICS } from '$lib/server/ical';
import type { Item } from '$lib/item';
import type { Settings } from '$lib/settings';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/rollover', () => ({ rollover: async () => 0 }));

const HOME = 'http://127.0.0.1:5232/david/';
const FAMILY = `${HOME}secret-family-stuff/`;
const ME = `${HOME}private-me/`;
const TASKS = `${HOME}tasks/`;
// The words that must never reach the log.
const TITLE = 'Biopsy results with Dr Okafor';
const LOCATION = 'Oncology wing';
const NOTES = 'Bring Sam';
const CALENDAR = 'Secret Family Stuff';
const OTHER_CALENDAR = 'Private Me';
const NEW_CALENDAR = 'Divorce lawyer';
// A calendar's address is made from its name, so the address forms must stay out too.
const PERSONAL = [TITLE, LOCATION, NOTES, CALENDAR, OTHER_CALENDAR, NEW_CALENDAR, 'secret-family-stuff', 'private-me', 'divorce-lawyer'];

const item: Item = { uid: 'uid-1', kind: 'event', title: TITLE, state: 'open', date: '2026-10-21', location: LOCATION, notes: NOTES };
const stored = (calendarUrl: string): StoredItem => ({ ...item, calendarUrl, url: `${calendarUrl}uid-1.ics`, etag: '"e1"', ics: itemToICS(item) });

/** How the pretend calendar server answers: a status, or no answer at all (the store gives up after its time limit). */
type Answer = number | 'silence';
const answer = (a: Answer): Promise<Response> => (a === 'silence' ? new Promise(() => {}) : Promise.resolve(new Response(null, { status: a })));

let server: { create: Answer; update: Answer; remove: Answer; fetch: Answer; propfind: Answer; query: Answer | 'items'; settings: Settings };
let store: CalendarStore;

function makeStore() {
	const s = new CalendarStore({ serverUrl: HOME, username: 'david', password: 'dev', timeoutMs: 30 });
	const internals = s as unknown as { davCalendars: unknown[]; client: unknown };
	internals.davCalendars = [
		{ url: FAMILY, displayName: CALENDAR, components: ['VEVENT'] },
		{ url: ME, displayName: OTHER_CALENDAR, components: ['VEVENT'] },
		{ url: TASKS, displayName: 'Tasks', components: ['VTODO'] }
	];
	internals.client = {
		account: { homeUrl: HOME },
		createCalendarObject: () => answer(server.create),
		updateCalendarObject: () => answer(server.update),
		deleteCalendarObject: () => answer(server.remove),
		makeCalendar: () => answer(500),
		propfind: async () => (server.propfind === 'silence' ? new Promise(() => {}) : [{ ok: server.propfind < 300, status: server.propfind, props: { getetag: '"v1"' } }]),
		calendarQuery: async ({ url }: { url: string }) => {
			if (server.query === 'silence') return new Promise(() => {});
			if (server.query !== 'items') return [];
			return url === FAMILY ? [{ href: `${FAMILY}uid-1.ics`, props: { getetag: '"e1"', calendarData: itemToICS(item) } }] : [];
		}
	};
	// The calendar list stays as it is; reading it is not what these tests are about.
	s.refreshCalendars = async () => {};
	s.readSettings = async () => server.settings;
	return s;
}

vi.mock('$lib/server/store', async (original) => ({
	...(await original<typeof import('$lib/server/store')>()),
	getStore: async () => store
}));

const planner = await import('./+page.server');
const settingsPage = await import('./settings/+page.server');
const exporter = await import('./export/+server');

const post = (actions: Record<string, unknown>, action: string, fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return (actions[action] as (e: unknown) => Promise<unknown>)({ request: new Request(`http://localhost/?/${action}`, { method: 'POST', body }) });
};

/** Everything written to the log, as Node would print it (errors with their causes and stacks). */
let log: string[];
beforeEach(() => {
	log = [];
	server = { create: 201, update: 204, remove: 204, fetch: 500, propfind: 207, query: 'items', settings: { categories: [], workCalendar: null, defaultEventCalendar: '/david/secret-family-stuff/' } };
	store = makeStore();
	for (const level of ['error', 'warn', 'log', 'info'] as const) {
		vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void log.push(format(...args)));
	}
	vi.spyOn(globalThis, 'fetch').mockImplementation((_, init) =>
		server.fetch === 'silence'
			? new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
			: answer(server.fetch)
	);
});
afterEach(() => vi.restoreAllMocks());

/** Something was logged (so the failure was staged), and none of it is personal. */
function expectPrivateLog() {
	const written = log.join('\n');
	expect(written).not.toBe('');
	for (const word of PERSONAL) expect(written).not.toContain(word);
	return written;
}

describe('the planner page logs failures without titles or calendar names', () => {
	for (const failure of [500, 'silence'] as const) {
		it(`adding a line (${failure === 'silence' ? 'no answer' : 'refused'})`, async () => {
			server.create = failure;
			await post(planner.actions, 'add', { kind: 'event', date: '2026-10-21', text: TITLE });
			expect(expectPrivateLog()).toContain(`${logged(FAMILY)}`);
		});

		it(`ticking an item (${failure === 'silence' ? 'no answer' : 'refused'})`, async () => {
			server.update = failure;
			await post(planner.actions, 'mark', { uid: 'uid-1', keptIn: '/david/secret-family-stuff/', state: 'done' });
			expect(expectPrivateLog()).toContain(`${logged(FAMILY)}uid-1.ics`);
		});

		it(`deleting an item (${failure === 'silence' ? 'no answer' : 'refused'})`, async () => {
			server.remove = failure;
			await post(planner.actions, 'delete', { uid: 'uid-1', keptIn: '/david/secret-family-stuff/' });
			expect(expectPrivateLog()).toContain(`${logged(FAMILY)}uid-1.ics`);
		});
	}

	const moveToMe = { uid: 'uid-1', keptIn: '/david/secret-family-stuff/', title: TITLE, kind: 'event', date: '2026-10-21', time: '', endTime: '', location: LOCATION, label: '', notes: NOTES, repeat: '', calendar: '/david/private-me/' };

	it('moving an item whose old copy, and then its new one, the server will not remove', async () => {
		server.remove = 403;
		await post(planner.actions, 'save', moveToMe);
		const written = expectPrivateLog();
		expect(written).toContain(`could not remove the old copy`);
		expect(written).toContain(`could not take back the new copy`);
	});

	it('moving an item when the server stops answering before saying where it is', async () => {
		// The item is found; after that, reading the calendars gets no answer.
		let reads = 0;
		const read = store.listItems.bind(store);
		store.listItems = () => {
			if (++reads > 1) server.query = 'silence';
			return read();
		};
		server.remove = 'silence';
		await post(planner.actions, 'save', moveToMe);
		expect(expectPrivateLog()).toContain(`could not check where the item with UID uid-1 is kept now`);
	});
});

describe('the settings page logs failures without calendar or item names', () => {
	it('adding a calendar the server will not make', async () => {
		await post(settingsPage.actions, 'add', { name: NEW_CALENDAR });
		expectPrivateLog();
	});

	it('renaming a calendar the server will not rename', async () => {
		await post(settingsPage.actions, 'rename', { path: '/david/secret-family-stuff/', name: NEW_CALENDAR });
		expect(expectPrivateLog()).toContain(`${logged(FAMILY)}`);
	});

	it('deleting a calendar whose contents cannot be read', async () => {
		server.propfind = 500;
		await post(settingsPage.actions, 'check', { path: '/david/secret-family-stuff/' });
		expect(expectPrivateLog()).toContain(`${logged(FAMILY)}`);
	});

	it('deleting a calendar after its items would not all move', async () => {
		// The copy to the other calendar is refused, so the item stays where it was.
		await post(settingsPage.actions, 'delete', { path: '/david/secret-family-stuff/', mode: 'move', to: '/david/private-me/', version: '"v1"' });
		const written = expectPrivateLog();
		expect(written).toContain(`${logged(FAMILY)} to ${logged(ME)} stopped`);
	});

	it('deleting a calendar the server will not delete', async () => {
		server.query = 204;
		server.settings = { ...server.settings, defaultEventCalendar: '/david/private-me/' };
		await post(settingsPage.actions, 'delete', { path: '/david/secret-family-stuff/', mode: 'delete', version: '"v1"' });
		expect(expectPrivateLog()).toContain(`could not delete ${logged(FAMILY)}`);
	});

	it('deleting the Work calendar when the choices cannot be changed first', async () => {
		server.settings = { ...server.settings, workCalendar: '/david/secret-family-stuff/' };
		await post(settingsPage.actions, 'delete', { path: '/david/secret-family-stuff/', mode: 'delete', version: '"v1"' });
		expect(expectPrivateLog()).toContain(`before deleting ${logged(FAMILY)}`);
	});
});

describe('the export logs failures without calendar names', () => {
	for (const failure of [500, 'silence'] as const) {
		it(`a calendar the server will not hand out (${failure === 'silence' ? 'no answer' : 'refused'})`, async () => {
			server.fetch = failure;
			await expect((exporter.GET as unknown as () => Promise<Response>)()).rejects.toMatchObject({ status: 502 });
			expectPrivateLog();
		});
	}
});

it('a logged address keeps the item file but hides the calendar name', () => {
	expect(logged(`${FAMILY}uid-1.ics`)).toMatch(/^\/david\/[0-9a-f]{8}\/uid-1\.ics$/);
	expect(logged(FAMILY)).toBe(logged('/david/secret-family-stuff/'));
	expect(logged(FAMILY)).not.toBe(logged(ME));
});
