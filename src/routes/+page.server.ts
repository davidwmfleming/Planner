import { error, fail } from '@sveltejs/kit';
import { addDays, comingSaturday, flipPage, pageDays, pageStart, toISODate } from '$lib/dates';
import { applyEdit, daysBetween } from '$lib/edit';
import { shortTitle } from '$lib/format';
import type { Item } from '$lib/item';
import { buildDays } from '$lib/page';
import { parseLine } from '$lib/parse';
import { rollover } from '$lib/server/rollover';
import { pageToday, TEST_TODAY_COOKIE, testClockOn } from '$lib/server/clock';
import { env } from '$env/dynamic/private';
import { occurrenceOn, occurrencesBetween } from '$lib/server/ical';
import { logged, RefusedError, unanswered, type StoredItem } from '$lib/server/calendar-store';
import { byName, calendarAtPath, calendarName, calendarTags, checkCalendarName, menuLabels } from '$lib/settings';
import { defaultCalendarUrl, getSettings, getStore, tasksUrl } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIST_ORDER = ['month', 'waiting', 'someday', ''];
const NEW_CALENDAR = '+new';
/** What the calendar server says when asked for something that isn't there (any more). */
const GONE = [404, 410];
/** The calendar server answered and said no (4xx), so the change surely wasn't made. A 5xx is not that sure: a proxy
 * that gave up waiting (502, 503, 504) or a server that failed partway may still see the change carried out. */
const refused = (e: unknown): e is RefusedError => e instanceof RefusedError && e.status < 500;
const NOT_ANSWERING = "The calendar server isn't answering. Check that it is running, then reload.";

/** Calendars are passed to the page by path, which stays the same through a rename and tells two of one name apart. */
const pathOf = (url: string) => new URL(url).pathname;

/** An item as the server's log names it: by where it is kept, never by its title (house rule 4: logs are kept). */
const forLog = (item: StoredItem) => `item ${logged(item.url)}`;

/** What a change does, said two ways: with the item's title for the page, by its address for the log. */
const doing = (verb: string, item: StoredItem) => ({ say: `${verb} "${shortTitle(item.title)}"`, log: `${verb} ${forLog(item)}` });

/** Where a new item goes, or undefined if no calendar takes that kind (every event calendar deleted, say). */
function newItemsGoIn(store: Awaited<ReturnType<typeof getStore>>, kind: 'event' | 'task', settings: Awaited<ReturnType<typeof getSettings>>) {
	try {
		return defaultCalendarUrl(store, kind, settings);
	} catch {
		return undefined;
	}
}

/** Only plain item data goes to the browser, not where it lives on the server. */
const plain = ({ calendarUrl, url, etag, ics, ...item }: Item & { calendarUrl?: string; url?: string; etag?: string; ics?: string }): Item => item;

export const load: PageServerLoad = async ({ url, cookies }) => {
	const now = new Date();
	const today = pageToday(now, env, testClockOn(env) ? cookies.get(TEST_TODAY_COOKIE) : undefined);
	const asked = url.searchParams.get('page');
	// Read only so that a new number here makes the browser read the page again: the new-day check reads the page on
	// screen at an address of its own, which would otherwise be answered with what it already has (see freshAddress).
	url.searchParams.get('fresh');
	const start = pageStart(asked && ISO.test(asked) ? asked : today);
	const dates = pageDays(start);

	let read, store, settings;
	try {
		await rollover(toISODate(now));
		store = await getStore();
		read = await store.readItems();
		settings = await getSettings(store);
	} catch (e) {
		// The details go to the server's log; the page gets a plain message.
		console.error('Planner: could not read the calendars or settings', e);
		error(503, NOT_ANSWERING);
	}

	const { items } = read;
	// Documents that couldn't be read (written badly by another app, say) are left out, so the rest still shows.
	const unreadable = new Set(read.unreadable);
	// A repeating item shows on each day of the page it falls on; one whose repeats can't be worked out is left out too.
	const shown = items.flatMap((i) => {
		let showings: Item[];
		try {
			showings = i.recurrence ? occurrencesBetween(i.ics, dates[0], dates[dates.length - 1]) : [i];
		} catch {
			unreadable.add(i.url);
			return [];
		}
		return showings.map((one) => ({ ...one, calendar: pathOf(i.calendarUrl) }));
	});
	if (unreadable.size) {
		// Where each one is, so it can be found and fixed; never its title or details (house rule 4).
		console.warn(`Planner: left out ${unreadable.size} item(s) that couldn't be read:`, [...unreadable].map(pathOf).join(', '));
	}

	const calendars = store.calendars();
	const workCalendar = calendarAtPath(calendars, settings.workCalendar) ? settings.workCalendar : null;
	const eventCalendars = calendars.filter((c) => c.accepts.includes('event')).sort(byName);
	const newEvents = newItemsGoIn(store, 'event', settings);

	return {
		today,
		eventCalendars: menuLabels(eventCalendars.map((c) => ({ path: pathOf(c.url), name: c.name }))),
		defaultEventCalendar: newEvents && pathOf(newEvents),
		workCalendar,
		// Every calendar's name, as messages name them: what an item's calendar tag says in full.
		calendarLabels: calendarLabels(calendars),
		// The few letters each item's calendar tag shows.
		calendarTags: calendarTags(named(calendars), workCalendar),
		// Tasks in the main list need no tag; those in a list made on a phone, say, get one.
		tasksCalendar: tasksPath(store),
		start,
		previous: flipPage(start, -1),
		next: flipPage(start, 1),
		todayPage: pageStart(today),
		saturday: comingSaturday(today),
		unscheduled: items
			.filter((i) => i.kind === 'task' && !i.date && i.state === 'open')
			.sort((a, b) => LIST_ORDER.indexOf(a.label ?? '') - LIST_ORDER.indexOf(b.label ?? ''))
			.map((i) => plain({ ...i, calendar: pathOf(i.calendarUrl) })),
		days: buildDays(dates, shown).map((d) => ({
			...d,
			events: d.events.map(plain),
			tasks: d.tasks.map(plain)
		})),
		// How many items are left out because they couldn't be read; the page says so.
		unreadable: unreadable.size
	};
};

export const actions: Actions = {
	/** A line written on a day: left column makes an event, right column a task. */
	add: async ({ request }) => {
		const form = await request.formData();
		const kind = form.get('kind');
		const date = String(form.get('date') ?? '');
		const text = String(form.get('text') ?? '');
		if (kind !== 'event' && kind !== 'task') return fail(400, { message: 'Choose the events or tasks column' });
		if (date ? !ISO.test(date) : kind === 'event') return fail(400, { message: 'That day is not a valid date' });
		const { title, time } = parseLine(text);
		if (!title) return fail(400, { message: 'Write something on the line first' });

		let store, settings;
		try {
			store = await getStore();
			// A fresh list, so a calendar deleted on another device since the page loaded isn't used.
			await store.refreshCalendars();
			settings = await getSettings(store);
		} catch (e) {
			console.error('Planner: could not reach the calendar server to add a line', e);
			return fail(503, { message: NOT_ANSWERING });
		}
		const calendar = newItemsGoIn(store, kind, settings);
		if (!calendar) return fail(409, { message: kind === 'event' ? 'There is no calendar for events yet. Add one in Settings.' : 'There is no Tasks list on the calendar server; reload the page.' });
		try {
			await store.create(calendar, {
				uid: crypto.randomUUID(),
				kind,
				title,
				state: 'open',
				...(date ? { date, time } : {})
			});
		} catch (e) {
			console.error(`Planner: could not save a new ${kind} in ${logged(calendar)}`, e);
			// No answer is not a no: the line may be saved, and writing it again could make two.
			if (unanswered(e)) return fail(502, { message: `The calendar server didn't answer in time when asked to save "${shortTitle(title)}", so it may or may not be saved. Reload the page to see.` });
			return fail(502, { message: `The calendar server didn't save "${shortTitle(title)}". Try again in a moment.` });
		}
		return { added: title };
	},

	/** Tick (done) or strike through (dropped); doing it again puts the item back to open, unless asked only to set it (pen marks). */
	mark: async ({ request }) => {
		const form = await request.formData();
		const state = form.get('state');
		if (state !== 'done' && state !== 'dropped') return fail(400, { message: 'Unknown mark' });
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		const set = form.get('set') === 'yes';
		const toggle = (current: Item): Partial<Item> => ({ state: current.state === state && !set ? 'open' : state });
		const day = String(form.get('occurrence') ?? '');
		const shown = shownOn(item, day);
		return change(
			doing('save the mark on', item),
			() => (item.recurrence && ISO.test(day) ? store.updateOccurrence(item, day, toggle) : store.update(item, toggle(item))),
			shown && { item, day, wanted: toggle(shown) }
		);
	},

	/** Move a task to another day (the arrow moves it to the next day). */
	move: async ({ request }) => {
		const form = await request.formData();
		const to = String(form.get('to') ?? '');
		if (!ISO.test(to)) return fail(400, { message: 'That day is not a valid date' });
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		const moveTo = (current: Item) => current.kind === 'event' && current.endDate
			? { date: to, endDate: addDays(to, daysBetween(current.date!, current.endDate)) }
			: { date: to };
		const day = String(form.get('occurrence') ?? '');
		const shown = shownOn(item, day);
		return change(
			doing('move', item),
			() => (item.recurrence && ISO.test(day) ? store.updateOccurrence(item, day, moveTo) : store.update(item, moveTo(item))),
			shown && { item, day, wanted: moveTo(shown) }
		);
	},

	/** Takes a task off its day and puts it back on the Future tasks list. */
	unschedule: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(form);
		if (!('item' in found)) return found;
		const { store, item } = found;
		if (item.kind !== 'task' || item.recurrence) return fail(400, { message: 'Only a one-off task can go back to Future tasks' });
		const { date, time, carriedFrom, ...rest } = item;
		return change(doing('move', item), () => store.replace(item, rest));
	},

	/** The details sheet: edit any field, switch between event and task. */
	save: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(form, true);
		if (!('item' in found)) return found;
		const { store, item } = found;
		const field = (name: string) => String(form.get(name) ?? '');
		const result = applyEdit(item, {
			title: field('title'), kind: field('kind'), date: field('date'), time: field('time'),
			endTime: field('endTime'), location: field('location'), label: field('label'), notes: field('notes'),
			repeat: field('repeat')
		});
		if ('error' in result) return fail(400, { message: result.error });
		// Events can be filed in any calendar that takes events (Me, Family, Work…), or in a new one made here.
		// The same name rules as the settings page; a calendar that already exists is picked from the list.
		const newName = result.item.kind === 'event' && field('calendar') === NEW_CALENDAR ? checkCalendarName(field('newCalendar'), store.calendars()) : undefined;
		if (newName && 'error' in newName) return fail(400, { message: newName.error });
		let moved;
		const saved = await change(doing('save', item), async () => {
			const wanted = newName
				? await store.ensureCalendar(newName.name, ['event'])
				: result.item.kind === 'event'
					? calendarAtPath(store.calendars().filter((c) => c.accepts.includes('event')), field('calendar'))
					: undefined;
			const target = wanted?.url ?? (result.item.kind === item.kind ? item.calendarUrl : defaultCalendarUrl(store, result.item.kind, await getSettings(store)));
			if (result.item.kind === item.kind && target === item.calendarUrl) {
				// Fields left blank are removed, so save the whole item rather than a merge.
				await store.replace(item, result.item);
			} else {
				// A different calendar, or events and tasks (different kinds of entry): write the new one, then remove the old.
				const copy = await store.create(target, result.item, result.item.kind === item.kind ? item.ics : undefined);
				moved = await removeOrUndo(store, item, copy, otherChanges(item, result.item));
			}
		});
		return saved ?? moved;
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const found = await findItem(form, true);
		// The copy tapped is gone already: that is what was asked for.
		if (!('item' in found)) return found.status === 404 ? undefined : found;
		const { store, item } = found;
		// Already gone (deleted on a phone, or an earlier delete that got no answer landed after all) is done, not a failure.
		return change(doing('delete', item), () =>
			store.remove(item).catch((e) => {
				if (!(e instanceof RefusedError && GONE.includes(e.status))) throw e;
			})
		);
	},

	/** Removes one day of a repeating item and keeps the rest of the series. */
	deleteOne: async ({ request }) => {
		const form = await request.formData();
		const day = String(form.get('occurrence') ?? '');
		if (!ISO.test(day)) return fail(400, { message: 'Which day should be removed?' });
		const found = await findItem(form, true);
		if (!('item' in found)) return found.status === 404 ? undefined : found;
		const { store, item } = found;
		if (!item.recurrence) return fail(400, { message: 'This item does not repeat' });
		return change(doing('delete that day of', item), () => store.removeOccurrence(item, day));
	}
};

/** The item a form is about, or a plain message for the page if it is gone or the calendar server isn't answering.
 * One UID can be in two calendars (a move between calendars that stopped halfway); the form says which copy.
 * A tick may fall back to another copy, but anything that can remove a copy (a delete, or a save that moves it)
 * asks for `exact`: then only the copy tapped will do, so the other one, perhaps now the only one, is never touched. */
async function findItem(form: FormData, exact = false) {
	const uid = String(form.get('uid') ?? '');
	// Not "calendar": the details sheet uses that for the calendar to file it in.
	const keptIn = String(form.get('keptIn') ?? '');
	let store, item;
	try {
		store = await getStore();
		const copies = (await store.listItems()).filter((i) => i.uid === uid);
		item = copies.find((i) => pathOf(i.calendarUrl) === keptIn) ?? (!exact ? copies[0] : !keptIn && copies.length === 1 ? copies[0] : undefined);
	} catch (e) {
		console.error('Planner: could not reach the calendar server to change an item', e);
		return fail(503, { message: NOT_ANSWERING });
	}
	return item ? { store, item } : fail(404, { message: 'That item is no longer on the calendar; reload the page' });
}

/** What a tap asked for: these fields on this item (on one day of it, if it repeats). */
interface Wanted {
	item: StoredItem;
	day: string;
	wanted: Partial<Item>;
}

/** An item as the page shows it: for a repeating one, that day's showing. */
function shownOn(item: StoredItem, day: string): Item | undefined {
	if (!item.recurrence || !ISO.test(day)) return item;
	try {
		return occurrenceOn(item.ics, day);
	} catch {
		return undefined;
	}
}

/** Makes a change on the calendar server. If it fails, the details go to the server's log and the page gets a plain
 * message rather than an error screen. The item may have been changed on a phone meanwhile, hence the reload.
 * A change that got no answer in time may still be made, so the message says it may or may not be done.
 * A change refused because the item already looks as asked (a double tap: the first tap saved it) is not a failure. */
async function change({ say: what, log }: ReturnType<typeof doing>, work: () => Promise<unknown>, asked?: Wanted) {
	try {
		await work();
	} catch (e) {
		if (asked && (await alreadyDone(asked))) return;
		console.error(`Planner: could not ${log}`, e);
		// A late answer is not a refusal: the server may still carry the change out.
		if (unanswered(e)) return fail(502, { message: `The calendar server didn't answer in time when asked to ${what}, so it may or may not be done. Reload the page to see.` });
		return fail(502, { message: `The calendar server didn't ${what}. Reload the page and try again.` });
	}
}

/** Whether the item, read again now, already has what was asked for. */
async function alreadyDone({ item, day, wanted }: Wanted) {
	try {
		const store = await getStore();
		const now = (await store.listItems()).find((i) => i.uid === item.uid && i.calendarUrl === item.calendarUrl);
		const shown = now && shownOn(now, day);
		return !!shown && Object.entries(wanted).every(([field, value]) => shown[field as keyof Item] === value);
	} catch {
		return false;
	}
}

/** The second half of moving an item to another calendar: remove the old copy, and say what happened.
 * Only a delete the calendar server answered with a refusal (4xx) surely wasn't done; then the new copy is taken back out,
 * so the item isn't left in two calendars. A delete that got no answer may still be done later (the server can queue
 * it), so then the new copy always stays: taking it out could leave the item in no calendar at all. Reading the
 * calendars again only tells whether the move is surely done or says it may be in two. A server error (5xx) counts as no answer.
 * An old copy already gone (404) was removed by someone else: by another move of the same item, perhaps, whose copy
 * is now somewhere else. So once the old copy is gone, any other copy left is reported too. */
async function removeOrUndo(store: Awaited<ReturnType<typeof getStore>>, old: StoredItem, copy: StoredItem, edited = false) {
	// The "copy" took the old one's place (same address): there is nothing to remove, and removing would lose it.
	if (copy.url === old.url) return;
	const title = shortTitle(old.title);
	let answered = true;
	try {
		await store.remove(old);
	} catch (e) {
		console.error(`Planner: could not remove the old copy, ${forLog(old)}, after copying it to ${logged(copy.calendarUrl)}`, e);
		if (refused(e) && !GONE.includes(e.status)) return takeBack(store, old, copy, edited);
		answered = refused(e);
	}
	const left = await elsewhere(store, old, copy);
	if (left === 0 || (answered && left === undefined)) return;
	return fail(502, {
		message: answered
			? `"${title}" may now be in two calendars, because it seems to have been moved on another device at the same time. Reload the page and delete the one you don't want.`
			: `"${title}" may now be in two calendars, because the calendar server didn't confirm it removed the old one. ${waitThenDelete(store, old)}`
	});
}

/** Path of the main Tasks list, or null if it is missing (then every task shows its list). */
const tasksPath = (store: Awaited<ReturnType<typeof getStore>>) => {
	const url = tasksUrl(store);
	return url ? pathOf(url) : null;
};

/** Each calendar's path and its name, trimmed. A calendar with no name (the store then gives its address) or a blank
 * one has the name "" here, which tags and labels show as Cal and Unnamed calendar. */
const named = (calendars: { url: string; name: string }[]) =>
	calendars.map((c) => {
		const path = pathOf(c.url);
		// Radicale fills in a missing name with the calendar's path without its slashes ("david/blank").
		const unnamed = c.name === c.url || c.name === path.replace(/^\/|\/$/g, '');
		return { path, name: unnamed ? '' : c.name.trim() };
	});

/** Each calendar's name by path, told apart as the menus do when two share a name. */
const calendarLabels = (calendars: { url: string; name: string }[]) =>
	Object.fromEntries(menuLabels(named(calendars).map((c) => ({ ...c, name: calendarName(c.name) }))).map((c) => [c.path, c.label]));

/** After a delete that got no answer: it may still land, so deleting the other copy straight away could leave none.
 * Say to wait, and which copy to delete: the one whose delete is pending, named as the menus name its calendar. */
function waitThenDelete(store: Awaited<ReturnType<typeof getStore>>, pending: StoredItem) {
	const where = calendarLabels(store.calendars())[pathOf(pending.calendarUrl)] ?? 'the calendar it came from';
	return `Wait a minute before reloading the page; then, if it's still in two, delete the one in ${where}.`;
}

/** The calendar server refused to remove the old copy, so it is surely still there: take the new one back out.
 * The new copy carried the sheet's other changes too, so those go with it; the message says so if there were any. */
async function takeBack(store: Awaited<ReturnType<typeof getStore>>, old: StoredItem, copy: StoredItem, edited: boolean) {
	const title = shortTitle(old.title);
	const alsoLost = edited ? ", and your other changes weren't saved either" : '';
	const stayed = fail(502, { message: `The calendar server didn't move "${title}" to another calendar, so it stays where it was${alsoLost}. Reload the page and try again.` });
	try {
		await store.remove(copy);
		return stayed;
	} catch (e) {
		// The new copy is gone already, so only the old one is left: the same as taking it back.
		if (e instanceof RefusedError && GONE.includes(e.status)) return stayed;
		console.error(`Planner: could not take back the new copy, ${forLog(copy)}, of ${forLog(old)}`, e);
		// No answer: the new copy's delete may still land, so the old one must not be deleted straight away.
		if (!refused(e)) return fail(502, { message: `The calendar server didn't move "${title}" to another calendar, and didn't confirm it took the new copy back out. ${waitThenDelete(store, copy)}` });
		return fail(502, { message: `"${title}" is now in two calendars, because the calendar server wouldn't remove the old one. Reload the page and delete the one you don't want.` });
	}
}

/** The fields the details sheet edits, besides the calendar and kind. */
const SHEET_FIELDS = ['title', 'date', 'time', 'endTime', 'location', 'notes', 'label', 'recurrence'] as const;

/** Whether the sheet changed anything besides where the item is kept. */
const otherChanges = (before: Item, after: Item) => SHEET_FIELDS.some((field) => (before[field] ?? '') !== (after[field] ?? ''));

/** How many copies of the item are now kept anywhere but the new copy's address, or undefined if that can't be read. */
async function elsewhere(store: Awaited<ReturnType<typeof getStore>>, old: StoredItem, copy: StoredItem) {
	try {
		return (await store.listItems()).filter((i) => i.uid === old.uid && i.url !== copy.url).length;
	} catch (e) {
		console.error(`Planner: could not check where the item with UID ${old.uid} is kept now`, e);
		return undefined;
	}
}
