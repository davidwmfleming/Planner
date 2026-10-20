// QA's findings on two runs of the same move (from the review of 58b1069), kept as tests: the other run's delete
// has already refreshed the shared calendar list, so reading the calendar fails with "No calendar at …", not a 404.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoAnswerError, RefusedError, type Calendar, type MoveOutcome, type StoredDocument } from '$lib/server/calendar-store';
import type { Settings } from '$lib/settings';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

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

const cal = (slug: string, name: string, accepts: Calendar['accepts'] = ['event']): Calendar => ({ url: `${HOME}${slug}/`, name, accepts });
const event = (uid: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261019T120000Z\r\nDTSTART;VALUE=DATE:20261020\r\nSUMMARY:${uid}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const task = (uid: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261019T120000Z\r\nSUMMARY:${uid}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;
const doc = (calendar: Calendar, uid: string, ics = event(uid)): StoredDocument => ({ calendarUrl: calendar.url, url: `${calendar.url}${uid}.ics`, etag: `"${uid}"`, ics });

const me = cal('me', 'Me');
const family = cal('family', 'Family');
const work = cal('work', 'Work');
const tasks = cal('tasks', 'Tasks', ['task']);

function fakeStore(calendars: Calendar[], held: Record<string, StoredDocument[]> = {}, stored: Partial<Settings> = {}) {
	return {
		listed: calendars,
		held,
		/** Each calendar's version, which changes whenever what it holds changes. */
		versions: Object.fromEntries(calendars.map((c) => [c.url, '"v1"'])) as Record<string, string>,
		settings: { categories: [], workCalendar: '/david/work/', defaultEventCalendar: '/david/me/', ...stored } as Settings,
		written: [] as Settings[],
		writeError: undefined as Error | undefined,
		/** What each move ends as, in turn; 'moved' once they run out. */
		outcomes: [] as MoveOutcome[],
		moves: [] as string[],
		deleted: [] as string[],
		deleteError: undefined as Error | undefined,
		readError: undefined as Error | undefined,
		calendars() {
			return this.listed;
		},
		async refreshCalendars() {},
		addressFor: (name: string) => `${HOME}${name.toLowerCase()}/`,
		async readSettings() {
			return this.settings;
		},
		async writeSettings(url: string, settings: Settings) {
			if (this.writeError) throw this.writeError;
			expect(url).toBe(tasks.url);
			this.written.push(settings);
			this.settings = settings;
		},
		async documents(url: string) {
			if (this.readError) throw this.readError;
			return { version: this.versions[url], documents: [...(this.held[url] ?? [])] };
		},
		async moveDocument(d: StoredDocument, to: string): Promise<MoveOutcome> {
			const outcome = this.outcomes.shift() ?? 'moved';
			this.moves.push(`${d.url} → ${to}: ${outcome}`);
			if (outcome === 'moved') {
				this.held[d.calendarUrl] = this.held[d.calendarUrl].filter((x) => x !== d);
				this.versions[d.calendarUrl] = '"v2"';
			}
			return outcome;
		},
		async deleteCalendar(url: string, version: string) {
			if (this.deleteError) throw this.deleteError;
			if (version !== this.versions[url]) throw new RefusedError('changed', 412);
			this.deleted.push(url);
			this.listed = this.listed.filter((c) => c.url !== url);
		}
	};
}

const { actions } = await import('./+page.server');
const act = (action: keyof typeof actions, fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return (actions[action] as (e: unknown) => Promise<unknown>)({ request: new Request(`http://localhost/settings?/${action}`, { method: 'POST', body }) });
};
const refusal = (status: number, data: Record<string, unknown>) => ({ status, data: expect.objectContaining(data) });

let logged: typeof console.error;
beforeEach(() => {
	connectError = undefined;
	logged = console.error;
	console.error = () => {};
});
afterEach(() => {
	console.error = logged;
});

/** Like the real store: a calendar dropped from the shared list (another request deleted it and refreshed) can't be read. */
function sharedListStore(...args: Parameters<typeof fakeStore>) {
	const f = fakeStore(...args);
	const read = f.documents.bind(f);
	f.documents = async (url: string) => {
		if (!f.listed.some((c) => c.url === url)) throw new Error(`No calendar at ${url}`);
		return read(url);
	};
	return f;
}

describe('two runs of the same move (QA proposals)', () => {
	it('calls it done when the other run moved the same items and deleted the calendar meanwhile', async () => {
		fake = sharedListStore([me, family, tasks], { [family.url]: [doc(family, 'a'), doc(family, 'b')] });
		const move = fake.moveDocument.bind(fake);
		fake.moveDocument = async (d, to) => {
			const outcome = await move(d, to);
			// the other tab finished first: deleted Family, and the store's list was refreshed without it
			if (!fake.held[family.url].length) fake.listed = fake.listed.filter((c) => c.url !== family.url);
			return outcome;
		};
		expect(await act('delete', { path: '/david/family/', mode: 'move', to: '/david/me/', version: '"v1"' })).toEqual({ action: 'delete', deleted: 'Family', count: 2, movedTo: 'Me' });
	});

	it('says the calendar is already gone, not "still there with the rest", when it went while this move stopped part way', async () => {
		fake = sharedListStore([me, family, tasks], { [family.url]: [doc(family, 'a'), doc(family, 'b')] });
		fake.outcomes = ['moved', 'both'];
		const move = fake.moveDocument.bind(fake);
		fake.moveDocument = async (d, to) => {
			const outcome = await move(d, to);
			fake.listed = fake.listed.filter((c) => c.url !== family.url);
			return outcome;
		};
		const result = await act('delete', { path: '/david/family/', mode: 'move', to: '/david/me/', version: '"v1"' });
		expect(result).toEqual(refusal(502, { message: expect.stringContaining('Family is already gone') }));
	});
	it('calls it done when the other run deleted the calendar just before this run asked to delete it', async () => {
		fake = sharedListStore([me, family, tasks], { [family.url]: [doc(family, 'a'), doc(family, 'b')] });
		fake.deleteCalendar = async (url: string) => {
			// the other tab got there first: deleted Family and refreshed the shared list, so the real store says "No calendar at"
			fake.listed = fake.listed.filter((c) => c.url !== url);
			throw new Error(`No calendar at ${url}`);
		};
		expect(await act('delete', { path: '/david/family/', mode: 'move', to: '/david/me/', version: '"v1"' })).toEqual({ action: 'delete', deleted: 'Family', count: 2, movedTo: 'Me' });
	});
});
