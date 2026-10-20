// Deleting a calendar from the settings page, with a pretend calendar server, for the failures a shared test server can't stage.
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

describe('asking to delete a calendar', () => {
	it('says how many items it holds, with the version that was counted', async () => {
		fake = fakeStore([me, family, work, tasks], { [family.url]: [doc(family, 'a'), doc(family, 'b')] });
		expect(await act('check', { path: '/david/family/' })).toEqual({ action: 'check', path: '/david/family/', count: 2, version: '"v1"' });
	});

	it('refuses the Tasks list, a task-only list and the last event calendar', async () => {
		fake = fakeStore([me, tasks, cal('chores', 'Chores', ['task'])]);
		expect(await act('check', { path: '/david/tasks/' })).toEqual(refusal(400, { message: "Tasks holds every task and the settings, so it can't be deleted" }));
		expect(await act('check', { path: '/david/chores/' })).toEqual(refusal(400, { message: "Chores holds tasks, so it can't be deleted here" }));
		expect(await act('check', { path: '/david/me/' })).toEqual(
			refusal(400, { message: "Me is the only event calendar, and new events need somewhere to go. Add another calendar before deleting this one." })
		);
		expect(await act('delete', { path: '/david/me/', mode: 'delete', version: '"v1"' })).toMatchObject({ status: 400 });
		expect(fake.deleted).toEqual([]);
	});

	it('says to reload when the calendar was deleted elsewhere, and says when the server is not answering', async () => {
		fake = fakeStore([me, family, tasks]);
		expect(await act('check', { path: '/david/gone/' })).toEqual(refusal(404, { message: "That calendar isn't there any more; reload the page" }));
		fake.readError = new RefusedError('gone', 404);
		expect(await act('check', { path: '/david/family/' })).toEqual(refusal(404, { message: "That calendar isn't there any more; reload the page" }));
		fake.readError = new NoAnswerError('late');
		expect(await act('check', { path: '/david/family/' })).toEqual(refusal(502, { message: "The calendar server didn't say what's in Family. Try again in a moment." }));
		connectError = new Error('down');
		expect(await act('check', { path: '/david/family/' })).toMatchObject({ status: 503 });
	});
});

describe('deleting a calendar with its items', () => {
	it('deletes exactly what was counted', async () => {
		fake = fakeStore([me, family, work, tasks], { [family.url]: [doc(family, 'a')] });
		expect(await act('delete', { path: '/david/family/', mode: 'delete', version: '"v1"' })).toEqual({ action: 'delete', deleted: 'Family', count: 1 });
		expect(fake.deleted).toEqual([family.url]);
		expect(fake.written).toEqual([]); // neither Work nor new events pointed at it
	});

	it('deletes nothing when the calendar changed since its items were counted (on a phone, say)', async () => {
		fake = fakeStore([me, family, tasks], { [family.url]: [doc(family, 'a'), doc(family, 'b')] });
		fake.versions[family.url] = '"v2"';
		expect(await act('delete', { path: '/david/family/', mode: 'delete', version: '"v1"' })).toEqual(
			refusal(409, { action: 'delete', path: '/david/family/', count: 2, version: '"v2"', message: 'Family changed since you looked, so nothing was deleted. It now holds 2 items.' })
		);
		expect(fake.deleted).toEqual([]);
		expect(fake.written).toEqual([]);
	});

	it('sets Work to none and new events to the first calendar left before deleting the calendar they point at', async () => {
		fake = fakeStore([me, family, work, tasks], {}, { workCalendar: '/david/family/', defaultEventCalendar: '/david/family/' });
		expect(await act('delete', { path: '/david/family/', mode: 'delete', version: '"v1"' })).toMatchObject({ action: 'delete', deleted: 'Family' });
		expect(fake.written).toEqual([{ categories: [], workCalendar: null, defaultEventCalendar: null }]);
	});

	it('deletes nothing if the Work and new-event choices could not be changed', async () => {
		fake = fakeStore([me, family, work, tasks], {}, { workCalendar: '/david/family/' });
		fake.writeError = new RefusedError('no', 403);
		expect(await act('delete', { path: '/david/family/', mode: 'delete', version: '"v1"' })).toEqual(
			refusal(502, { message: "The calendar server didn't change the Work and new-event choices, so nothing was deleted. Try again in a moment." })
		);
		expect(fake.deleted).toEqual([]);
	});

	it('puts the Work choice back when the server surely refused the delete', async () => {
		fake = fakeStore([me, family, work, tasks], {}, { workCalendar: '/david/family/' });
		fake.deleteError = new RefusedError('changed', 412);
		expect(await act('delete', { path: '/david/family/', mode: 'delete', version: '"v1"' })).toEqual(
			refusal(409, { message: 'Family changed just now, on another device perhaps, so it wasn\'t deleted. Reload the page and try again.' })
		);
		expect(fake.settings.workCalendar).toBe('/david/family/');
	});

	it('does not say a calendar is gone when the server never answered the delete', async () => {
		fake = fakeStore([me, family, tasks]);
		fake.deleteError = new NoAnswerError('late');
		expect(await act('delete', { path: '/david/family/', mode: 'delete', version: '"v1"' })).toEqual(
			refusal(502, { message: "The calendar server didn't answer in time when asked to delete Family, so it may or may not be gone. Reload the page to see." })
		);
		fake.deleteError = new RefusedError('gone', 404);
		expect(await act('delete', { path: '/david/family/', mode: 'delete', version: '"v1"' })).toMatchObject({ action: 'delete', deleted: 'Family' });
	});
});

describe('moving the items, then deleting the calendar', () => {
	it('moves every item, then deletes the calendar as it is once empty', async () => {
		fake = fakeStore([me, family, tasks], { [family.url]: [doc(family, 'a'), doc(family, 'b')] });
		expect(await act('delete', { path: '/david/family/', mode: 'move', to: '/david/me/', version: '"v1"' })).toEqual({ action: 'delete', deleted: 'Family', count: 2, movedTo: 'Me' });
		expect(fake.moves).toEqual([`${family.url}a.ics → ${me.url}: moved`, `${family.url}b.ics → ${me.url}: moved`]);
		expect(fake.deleted).toEqual([family.url]);
	});

	it('refuses to move items into the calendar being deleted, into Tasks, or into one that is gone', async () => {
		fake = fakeStore([me, family, tasks], { [family.url]: [doc(family, 'a')] });
		for (const to of ['/david/family/', '/david/tasks/', '/david/gone/', '']) {
			expect(await act('delete', { path: '/david/family/', mode: 'move', to, version: '"v1"' })).toMatchObject({ status: expect.any(Number) });
		}
		expect(fake.moves).toEqual([]);
		expect(fake.deleted).toEqual([]);
	});

	it('will not move tasks into a calendar that only takes events', async () => {
		const both = cal('both', 'Both', ['event', 'task']);
		fake = fakeStore([me, both, tasks], { [both.url]: [doc(both, 'a'), doc(both, 't', task('t'))] });
		expect(await act('delete', { path: '/david/both/', mode: 'move', to: '/david/me/', version: '"v1"' })).toEqual(
			refusal(400, { message: 'Both holds tasks, and Me only takes events. Choose another calendar, or delete them too.' })
		);
		expect(fake.moves).toEqual([]);
	});

	it('stops at the first item the server did not answer about, says how far it got, and keeps the calendar', async () => {
		fake = fakeStore([me, family, tasks], { [family.url]: ['a', 'b', 'c'].map((u) => doc(family, u)) });
		fake.outcomes = ['moved', 'unsure'];
		expect(await act('delete', { path: '/david/family/', mode: 'move', to: '/david/me/', version: '"v1"' })).toEqual(
			refusal(502, {
				message:
					'Moved 1 of 3 items to Me, so Family is still there with the rest. The calendar server stopped answering, so "b" may now be in both calendars. Wait a minute, then reload the page and delete Family again to finish.'
			})
		);
		expect(fake.moves).toHaveLength(2);
		expect(fake.deleted).toEqual([]);
	});

	it('keeps the calendar, and names the items that stayed or may be in both', async () => {
		const titles = ['Swim', 'Run', 'Yoga', 'Piano', 'Chess', 'Bake', 'Walk'];
		fake = fakeStore([me, family, tasks], { [family.url]: titles.map((u) => doc(family, u)) });
		fake.outcomes = ['kept', 'both', 'clash', 'clash', 'clash', 'clash', 'moved'];
		expect(await act('delete', { path: '/david/family/', mode: 'move', to: '/david/me/', version: '"v1"' })).toEqual(
			refusal(502, {
				message:
					'Moved 1 of 7 items to Me, so Family is still there with the rest. "Swim" stayed in Family, because the calendar server wouldn\'t put it in Me. ' +
					'"Yoga", "Piano" and 2 more stayed in Family, because Me already holds different items with the same file names. ' +
					'"Run" may now be in two calendars, and the copies may differ, because it was changed, moved or deleted on another device meanwhile; delete the copy you don\'t want. Reload the page to see.'
			})
		);
		expect(fake.deleted).toEqual([]);
	});

	it('keeps the calendar if an item arrives while the others are moved', async () => {
		fake = fakeStore([me, family, tasks], { [family.url]: [doc(family, 'a')] });
		const move = fake.moveDocument.bind(fake);
		fake.moveDocument = async (d, to) => {
			const outcome = await move(d, to);
			fake.held[family.url].push(doc(family, 'late'));
			return outcome;
		};
		expect(await act('delete', { path: '/david/family/', mode: 'move', to: '/david/me/', version: '"v1"' })).toEqual(
			refusal(409, { message: 'Moved 1 item to Me, but 1 more arrived in Family meanwhile, so it is still there. Reload the page and delete it again to move those too.' })
		);
		expect(fake.deleted).toEqual([]);
	});
});
