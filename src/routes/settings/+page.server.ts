import { error, fail, type ActionFailure } from '@sveltejs/kit';
import { shortTitle } from '$lib/format';
import { byName, calendarAtPath, checkCalendarName, menuLabels, type Settings } from '$lib/settings';
import { RefusedError, unanswered, type Calendar, type CalendarStore, type MoveOutcome, type StoredDocument } from '$lib/server/calendar-store';
import { icsToItems } from '$lib/server/ical';
import { defaultCalendarUrl, getSettings, getStore, tasksUrl } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const pathOf = (url: string) => new URL(url).pathname;

/** The calendar server, or a plain message for the page; the details go to the server's log. */
async function connect() {
	try {
		return await getStore();
	} catch (e) {
		console.error('Settings: the calendar server is not answering', e);
		return undefined;
	}
}

const NOT_ANSWERING = "The calendar server isn't answering. Check that it is running, then try again.";
const CALENDAR_GONE = "That calendar isn't there any more; reload the page";
/** What the calendar server says about a calendar that isn't there (any more): deleted on a phone, say. */
const GONE = [404, 410];

export const load: PageServerLoad = async () => {
	let store, settings;
	try {
		store = await getStore();
		await store.refreshCalendars(); // show calendars added or deleted on a phone since the planner started
		settings = await getSettings(store);
	} catch (e) {
		console.error('Settings: could not read the calendars or settings', e);
		error(503, NOT_ANSWERING);
	}

	const calendars = store.calendars().sort(byName);
	const events = calendars.filter((c) => c.accepts.includes('event'));
	const work = calendarAtPath(events, settings.workCalendar);
	const urlFor = (kind: 'event' | 'task') => {
		try {
			return defaultCalendarUrl(store, kind, settings);
		} catch {
			return undefined; // no calendar of that kind yet
		}
	};
	const [newEvents, newTasks] = [urlFor('event'), urlFor('task')];

	return {
		eventCalendars: menuLabels(events.map((c) => ({ path: pathOf(c.url), name: c.name, work: c.url === work?.url, newEvents: c.url === newEvents }))),
		// Lists that take only tasks; a calendar of notes only (VJOURNAL) is neither, so it isn't shown.
		taskLists: calendars.filter((c) => c.accepts.includes('task') && !c.accepts.includes('event')).map((c) => ({ path: pathOf(c.url), name: c.name, newTasks: c.url === newTasks })),
		workPath: work && pathOf(work.url),
		defaultEventPath: newEvents && pathOf(newEvents),
		categories: settings.categories
	};
};

export const actions: Actions = {
	/** A new event calendar, with a name no other calendar or list has. */
	add: async ({ request }) => {
		const asked = String((await request.formData()).get('name') ?? '');
		const store = await connect();
		if (!store) return fail(503, { action: 'add', name: asked, message: NOT_ANSWERING });
		const checked = checkCalendarName(asked, store.calendars());
		if ('error' in checked) return fail(400, { action: 'add', name: asked, message: checked.error });
		try {
			await store.ensureCalendar(checked.name, ['event']);
		} catch (e) {
			console.error(`Settings: could not create the calendar "${checked.name}"`, e);
			return fail(502, { action: 'add', name: asked, message: `The calendar server didn't make "${checked.name}". Try again in a moment.` });
		}
		return { action: 'add', added: checked.name };
	},

	/** A new name for an event calendar. It keeps its address, so phones, Work and the default still find it. */
	rename: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const asked = String(form.get('name') ?? '');
		const store = await connect();
		if (!store) return fail(503, { action: 'rename', path, name: asked, message: NOT_ANSWERING });
		const calendar = calendarAtPath(store.calendars(), path);
		if (!calendar) return fail(404, { action: 'rename', path, name: asked, message: CALENDAR_GONE });
		if (!calendar.accepts.includes('event') || calendar.url === tasksUrl(store)) return fail(400, { action: 'rename', path, name: asked, message: `${calendar.name} holds every task, so it can't be renamed` });
		const checked = checkCalendarName(asked, store.calendars(), calendar.url);
		if ('error' in checked) return fail(400, { action: 'rename', path, name: asked, message: checked.error });
		if (checked.name === calendar.name) return { action: 'rename', renamed: checked.name };
		try {
			await store.renameCalendarAt(calendar.url, checked.name);
		} catch (e) {
			console.error(`Settings: could not rename "${calendar.name}" to "${checked.name}"`, e);
			// Deleted on another device since this page was drawn: trying again can never work.
			if (e instanceof RefusedError && GONE.includes(e.status)) return fail(404, { action: 'rename', path, name: asked, message: CALENDAR_GONE });
			return fail(502, { action: 'rename', path, name: asked, message: `The calendar server didn't rename "${calendar.name}". Try again in a moment.` });
		}
		return { action: 'rename', renamed: checked.name };
	},

	/** Which calendar is shaded as work (or none), and which one new events go in. Both stored by path. */
	choose: async ({ request }) => {
		const form = await request.formData();
		const store = await connect();
		if (!store) return fail(503, { action: 'choose', message: NOT_ANSWERING });
		try {
			// A fresh list, so a calendar deleted on another device since this page was drawn isn't chosen.
			await store.refreshCalendars();
		} catch (e) {
			console.error('Settings: could not read the calendars to check the choices', e);
			return fail(503, { action: 'choose', message: NOT_ANSWERING });
		}
		const events = store.calendars().filter((c) => c.accepts.includes('event'));
		const work = String(form.get('work') ?? '');
		const newEvents = String(form.get('newEvents') ?? '');
		const gone = (path: string) => !calendarAtPath(events, path);
		if ((work && gone(work)) || gone(newEvents)) return fail(404, { action: 'choose', message: "One of those calendars isn't there any more; reload the page" });
		const tasks = tasksUrl(store);
		if (!tasks) return fail(503, { action: 'choose', message: 'There is no Tasks list to keep the settings on; reload the page' });
		try {
			const settings = await getSettings(store);
			await store.writeSettings(tasks, { ...settings, workCalendar: work || null, defaultEventCalendar: newEvents });
		} catch (e) {
			console.error('Settings: could not save the Work and new-event choices', e);
			return fail(502, { action: 'choose', message: "The calendar server didn't save the choices. Try again in a moment." });
		}
		return { action: 'choose', saved: true };
	},

	/** Before deleting a calendar: how many items it holds, and its version, so the delete takes exactly what was counted. */
	check: async ({ request }) => {
		const path = String((await request.formData()).get('path') ?? '');
		const found = await deletable(path);
		if ('refusal' in found) return found.refusal;
		const { store, calendar } = found;
		const held = await contents(store, calendar);
		if ('refusal' in held) return held.refusal;
		return { action: 'check', path, count: held.documents.length, version: held.version };
	},

	/** Deletes an event calendar, after moving its items to another calendar or with them (`mode` move or delete).
	 * Moving copies each item, then removes the old copy; the calendar itself goes only once it is empty, so a move
	 * that stops halfway loses nothing and finishes when run again. Just before it goes, Work and new events stop pointing at it. */
	delete: async ({ request }) => {
		const form = await request.formData();
		const path = String(form.get('path') ?? '');
		const mode = String(form.get('mode') ?? '');
		const found = await deletable(path);
		if ('refusal' in found) return found.refusal;
		const { store, calendar } = found;
		const name = shortTitle(calendar.name);
		if (mode !== 'move' && mode !== 'delete') return refuse(400, 'Choose whether to move the items or delete them too');
		const held = await contents(store, calendar);
		if ('refusal' in held) return held.refusal;
		// Something changed (on a phone, say) since David saw the count: he agreed to what he saw, not this.
		const version = String(form.get('version') ?? '');
		if (!version || version !== held.version) {
			const what = mode === 'move' ? 'moved or deleted' : 'deleted';
			return fail(409, { action: 'delete', path, count: held.documents.length, version: held.version, message: `${name} changed since you looked, so nothing was ${what}. It now holds ${items(held.documents.length)}.` });
		}
		if (mode === 'delete') return recounted(store, calendar, await finish(store, calendar, version, { action: 'delete' as const, deleted: calendar.name, count: held.documents.length }));

		const to = calendarAtPath(eventCalendars(store), String(form.get('to') ?? ''));
		if (!to) return refuse(400, 'Choose a calendar to move the items to; if it was deleted elsewhere, reload the page');
		if (to.url === calendar.url) return refuse(400, `Choose a calendar other than ${name} to move the items to`);
		const toName = shortTitle(to.name);
		const needs = new Set(held.documents.flatMap((d) => icsToItems(d.ics).map((i) => i.kind)));
		if (needs.has('task') && !to.accepts.includes('task')) {
			return refuse(400, `${name} holds tasks, and ${toName} only takes events. Choose another calendar, or delete them too.`);
		}

		const tally: Record<MoveOutcome, string[]> = { moved: [], kept: [], both: [], clash: [], unsure: [] };
		for (const doc of held.documents) {
			const outcome = await store.moveDocument(doc, to.url);
			tally[outcome].push(icsToItems(doc.ics)[0]?.title ?? 'An item');
			// The server has stopped answering: don't press on, and don't guess what it did.
			if (outcome === 'unsure') break;
		}
		const total = held.documents.length;
		if (tally.moved.length < total) {
			// Counts only: the titles are event names, other people's too in a shared calendar, and logs are kept.
			const counts = Object.fromEntries(Object.entries(tally).map(([outcome, titles]) => [outcome, titles.length]));
			console.error(`Settings: moving the items of "${calendar.name}" to "${to.name}" stopped`, counts);
			// Gone by now: another run of this delete (a second tab, or a tap after a refresh) finished it.
			if (await isGone(store, calendar)) return refuse(502, unfinished(name, toName, total, tally, true));
			return recounted(store, calendar, refuse(502, unfinished(name, toName, total, tally)));
		}
		// Read again, so the delete can't take an item that arrived (on a phone) while the others were moved.
		const left = await contents(store, calendar);
		const done = { action: 'delete' as const, deleted: calendar.name, count: total, movedTo: to.name };
		// Already gone: another run of this delete moved the same items and deleted it. Everything is where it should be.
		if ('refusal' in left) return left.refusal.status === 404 ? done : left.refusal;
		if (left.documents.length > 0) {
			return recounted(store, calendar, refuse(409, `Moved ${items(total)} to ${toName}, but ${left.documents.length} more arrived in ${name} meanwhile, so it is still there. Reload the page and delete it again to move those too.`));
		}
		return recounted(store, calendar, await finish(store, calendar, left.version, done));
	}
};

const nulls = (fields: object) => Object.fromEntries(Object.keys(fields).map((k) => [k, null]));

/** Puts back the choices a delete cleared, read fresh first, so settings saved elsewhere meanwhile (categories, the
 * other choice) are kept. A choice is put back only if it is still cleared: one made again meanwhile wins. */
async function putBack(store: CalendarStore, tasks: string, cleared: Partial<Pick<Settings, 'workCalendar' | 'defaultEventCalendar'>>) {
	if (!Object.keys(cleared).length) return;
	const now = await getSettings(store);
	const restore = Object.fromEntries(Object.entries(cleared).filter(([field]) => now[field as keyof typeof cleared] === null));
	if (Object.keys(restore).length) await store.writeSettings(tasks, { ...now, ...restore });
}

/** Why a calendar can't be deleted (or not yet), as shown next to it. */
type Refusal = ActionFailure<{ action: 'delete'; message: string }>;
const refuse = (status: number, message: string): Refusal => fail(status, { action: 'delete' as const, message });
/** A calendar deleted, with how many items went with it or were moved first. */
type Deleted = { action: 'delete'; deleted: string; count: number; movedTo?: string };

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;
const eventCalendars = (store: CalendarStore) => store.calendars().filter((c) => c.accepts.includes('event') && c.url !== tasksUrl(store));

/** The event calendar at this path, read fresh, if it may be deleted; otherwise the refusal to show. */
async function deletable(path: string): Promise<{ store: CalendarStore; calendar: Calendar } | { refusal: Refusal }> {
	const store = await connect();
	if (!store) return { refusal: refuse(503, NOT_ANSWERING) };
	try {
		// A fresh list, so the last-calendar check counts calendars added or deleted on another device.
		await store.refreshCalendars();
	} catch (e) {
		console.error('Settings: could not read the calendars before a delete', e);
		return { refusal: refuse(503, NOT_ANSWERING) };
	}
	const calendar = calendarAtPath(store.calendars(), path);
	if (!calendar) return { refusal: refuse(404, CALENDAR_GONE) };
	const name = shortTitle(calendar.name);
	if (calendar.url === tasksUrl(store)) return { refusal: refuse(400, `${name} holds every task and the settings, so it can't be deleted`) };
	if (!calendar.accepts.includes('event')) return { refusal: refuse(400, `${name} holds tasks, so it can't be deleted here`) };
	if (eventCalendars(store).length < 2) {
		return { refusal: refuse(400, `${name} is the only event calendar, and new events need somewhere to go. Add another calendar before deleting this one.`) };
	}
	return { store, calendar };
}

/** A refusal given after items may have moved or changed, with what the calendar holds now and its version, so
 * the confirm names exactly what a second tap would do. Unchanged if that can't be read (the calendar is gone, say). */
async function recounted(store: CalendarStore, calendar: Calendar, result: Deleted | Refusal) {
	if (!('status' in result)) return result;
	try {
		const now = await store.documents(calendar.url);
		return fail(result.status, { ...result.data, path: pathOf(calendar.url), count: now.documents.length, version: now.version });
	} catch {
		return result;
	}
}

/** Whether the calendar server says the calendar isn't there any more. Anything else (no answer, say) is a no. */
async function isGone(store: CalendarStore, calendar: Calendar): Promise<boolean> {
	try {
		await store.documents(calendar.url);
		return false;
	} catch (e) {
		return e instanceof RefusedError && GONE.includes(e.status);
	}
}

/** What a calendar holds now, and its version; or the refusal to show if that can't be read. */
async function contents(store: CalendarStore, calendar: Calendar): Promise<{ version: string | undefined; documents: StoredDocument[] } | { refusal: Refusal }> {
	try {
		return await store.documents(calendar.url);
	} catch (e) {
		console.error(`Settings: could not read what "${calendar.name}" holds`, e);
		if (e instanceof RefusedError && GONE.includes(e.status)) return { refusal: refuse(404, CALENDAR_GONE) };
		return { refusal: refuse(502, `The calendar server didn't say what's in ${shortTitle(calendar.name)}. Try again in a moment.`) };
	}
}

/** Items named in a message: "Swim", "Swim" and "Run", or "Swim", "Run" and 3 more. */
function named(titles: string[]): string {
	const quoted = titles.map((t) => `"${shortTitle(t)}"`);
	if (quoted.length <= 3) return quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
	return `${quoted.slice(0, 2).join(', ')} and ${quoted.length - 2} more`;
}

/** Why a move stopped before every item was moved, naming the items. Nothing is deleted then: the calendar stays with what is left. */
function unfinished(name: string, toName: string, total: number, tally: Record<MoveOutcome, string[]>, gone = false): string {
	const one = (list: string[], single: string, plural: string) => (list.length === 1 ? single : plural);
	const parts = [
		gone
			? `Moved ${tally.moved.length} of ${items(total)} to ${toName}, and ${name} is already gone, deleted in another tab or on another device.`
			: `Moved ${tally.moved.length} of ${items(total)} to ${toName}, so ${name} is still there with the rest.`
	];
	const { kept, clash, both, unsure } = tally;
	if (kept.length) parts.push(`${named(kept)} stayed in ${name}, because the calendar server wouldn't put ${one(kept, 'it', 'them')} in ${toName}.`);
	if (clash.length) parts.push(`${named(clash)} stayed in ${name}, because ${toName} already holds ${one(clash, 'a different item with the same file name', 'different items with the same file names')}.`);
	if (both.length) parts.push(`${named(both)} may now be in two calendars, and the copies may differ, because ${one(both, 'it was', 'they were')} changed, moved or deleted on another device meanwhile; delete the copy you don't want.`);
	// Running it again finishes the job: a copy already in place and the same only needs the old one removed.
	if (unsure.length) parts.push(`The calendar server stopped answering, so ${named(unsure)} may now be in both calendars. Wait a minute, then reload the page and delete ${name} again to finish.`);
	else parts.push('Reload the page to see.');
	return parts.join(' ');
}

/** Points Work and new events away from the calendar, then deletes it, only at the version given. */
async function finish(store: CalendarStore, calendar: Calendar, version: string | undefined, done: Deleted): Promise<Deleted | Refusal> {
	const name = shortTitle(calendar.name);
	// Once the items have moved, "nothing was deleted" would be untrue: say what was done.
	const notDeleted = (why: string) =>
		done.movedTo
			? refuse(502, `Moved ${items(done.count)} to ${shortTitle(done.movedTo)}, but ${why}, so ${name} is still there, empty. Try deleting it again in a moment.`)
			: refuse(502, `${why[0].toUpperCase()}${why.slice(1)}, so nothing was deleted. Try again in a moment.`);
	if (!version) return notDeleted(`the calendar server didn't say which version of ${name} it holds`);
	const tasks = tasksUrl(store);
	const path = pathOf(calendar.url);
	/** The choices this delete cleared, as they were, to put back if the calendar surely isn't deleted. */
	const cleared: Partial<Pick<Settings, 'workCalendar' | 'defaultEventCalendar'>> = {};
	try {
		const settings = await getSettings(store);
		if (settings.workCalendar === path) cleared.workCalendar = path;
		if (settings.defaultEventCalendar === path) cleared.defaultEventCalendar = path;
		if (Object.keys(cleared).length) {
			if (!tasks) throw new Error('There is no Tasks list to keep the settings on');
			// None for Work; new events go to the first calendar left by name, as when the chosen one is missing.
			await store.writeSettings(tasks, { ...settings, ...nulls(cleared) });
		}
	} catch (e) {
		console.error(`Settings: could not change the choices before deleting "${calendar.name}"`, e);
		return notDeleted("the calendar server didn't change the Work and new-event choices");
	}
	try {
		await store.deleteCalendar(calendar.url, version);
	} catch (e) {
		if (e instanceof RefusedError && GONE.includes(e.status)) return done; // deleted elsewhere meanwhile
		console.error(`Settings: could not delete "${calendar.name}"`, e);
		// A late answer, or a server error, is not a refusal: the server may still delete it, or have done so.
		if (unanswered(e)) return refuse(502, `The calendar server didn't answer in time when asked to delete ${name}, so it may or may not be gone. Reload the page to see.`);
		if (e instanceof RefusedError && e.status >= 500) return refuse(502, `The calendar server had a problem deleting ${name}, so it may or may not be gone. Reload the page to see.`);
		// Surely not deleted: put the choices back.
		if (tasks) await putBack(store, tasks, cleared).catch((e) => console.error('Settings: could not put the choices back', e));
		if (e instanceof RefusedError && e.status === 412) return refuse(409, `${name} changed just now, on another device perhaps, so it wasn't deleted. Reload the page and try again.`);
		return refuse(502, `The calendar server didn't delete ${name}. Try again in a moment.`);
	}
	return done;
}
