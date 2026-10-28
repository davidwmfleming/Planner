// Applies the details sheet's fields to an item. Pure, so the rules can be tested without a server.
import { addDays } from './dates';
import type { Item } from './item';
import { MOST_MONTHS, monthlyRule, REPEATS } from './repeat';

export interface EditFields {
	title: string;
	kind: string;
	date: string;
	time: string;
	endTime: string;
	location: string;
	label: string;
	notes: string;
	/** A REPEATS value, or "custom" to keep a rule made elsewhere. */
	repeat: string;
	/** For a monthly repeat: how many months apart (blank is every month), and which day it falls on (see monthlyWays). */
	every?: string;
	monthlyWay?: string;
}

/** Longest title, place and notes the planner writes. A page holds many items, so one huge one would slow every load.
 * Longer ones made in another app are kept as they are while unchanged here. */
export const LIMITS = { title: 500, location: 500, notes: 10_000 };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** A date in the YYYY-MM-DD form that is a real day: not 31 February. */
const realDate = (d: string) => {
	if (!ISO.test(d)) return false;
	const [y, m, day] = d.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, day));
	return t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Category names are matched without regard to case (or spaces at the ends). */
const key = (name: string) => name.trim().toLowerCase();
const sameName = (a: string, b: string) => key(a) === key(b);

/** Values of a task looked at for its category. Another app could store any number; David's comes first when the planner saves it. */
const LOOKED_AT = 100;

/** Finds a task's category: the first of its CATEGORIES values (among the first 100) that is one of David's
 * categories, spelled as the settings spell it. Values from other apps that aren't one of his are not shown. */
export function categoryFinder(categories: string[]): (values: string[] | undefined) => string | undefined {
	const byKey = new Map<string, string>();
	for (const c of categories) if (!byKey.has(key(c))) byKey.set(key(c), c);
	return (values) => {
		for (const value of (values ?? []).slice(0, LOOKED_AT)) {
			const found = byKey.get(key(value));
			if (found) return found;
		}
		return undefined;
	};
}

/** A task's category; see categoryFinder, which is quicker for many tasks. */
export const categoryOf = (values: string[] | undefined, categories: string[]) => categoryFinder(categories)(values);

export const daysBetween = (from: string, to: string) =>
	Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000);

/** `categories` are David's task categories, from the settings: the List menu offers these. */
export function applyEdit(item: Item, f: EditFields, categories: string[]): { item: Item } | { error: string } {
	const title = f.title.trim();
	if (!title) return { error: 'Give it a title' };
	const tooLong = (value: string, was: string | undefined, limit: number) => value.length > limit && value !== (was ?? '').trim();
	if (tooLong(title, item.title, LIMITS.title)) return { error: `Shorten the title to ${LIMITS.title} letters or fewer` };
	if (tooLong(f.location.trim(), item.location, LIMITS.location)) return { error: `Shorten the location to ${LIMITS.location} letters or fewer` };
	if (tooLong(f.notes.trim(), item.notes, LIMITS.notes)) return { error: `Shorten the notes to ${LIMITS.notes.toLocaleString('en-CA')} letters or fewer` };
	if (f.kind !== 'event' && f.kind !== 'task') return { error: 'Choose event or task' };
	if (f.date && !realDate(f.date)) return { error: 'That date is not valid' };
	if (f.kind === 'event' && !f.date) return { error: 'An event needs a date; make it a task to keep it unscheduled' };
	if (f.time && !HHMM.test(f.time)) return { error: 'That time is not valid' };
	if (f.endTime && !HHMM.test(f.endTime)) return { error: 'That end time is not valid' };
	const category = f.label ? categories.find((c) => sameName(c, f.label)) : undefined;
	if (f.label && !category) return { error: 'Unknown list' };
	const preset = REPEATS.find((r) => r.value === f.repeat);
	if (!preset && f.repeat !== 'custom') return { error: 'Unknown repeat' };
	let recurrence: string | undefined = preset ? preset.rule : item.recurrence;
	if (recurrence && !f.date) return { error: 'A repeating item needs a start date' };
	if (f.repeat === 'monthly') {
		const every = f.every?.trim() ? Number(f.every) : 1;
		if (!Number.isInteger(every) || every < 1 || every > MOST_MONTHS) return { error: `Repeat every 1 to ${MOST_MONTHS} months` };
		recurrence = monthlyRule(f.date, every, f.monthlyWay || 'day');
		if (!recurrence) return { error: 'Choose which day of the month it repeats on' };
	}

	const next: Item = { uid: item.uid, kind: f.kind, title, state: item.state };
	if (f.date) next.date = f.date;
	if (f.date && f.time) next.time = f.time;
	if (f.kind === 'event' && f.date && f.time && f.endTime && f.endTime > f.time) next.endTime = f.endTime;
	// A multi-day all-day event keeps its length when its first day moves.
	if (f.kind === 'event' && item.endDate && item.date && !f.time) {
		next.endDate = addDays(f.date, daysBetween(item.date, item.endDate));
	}
	if (f.location.trim()) next.location = f.location.trim();
	if (f.notes.trim()) next.notes = f.notes.trim();
	// Lists are for tasks: the sheet shows the List field only for one. On a task, the chosen category replaces any
	// of David's it had, and values other apps added stay as they are; an event's categories are left alone.
	const davids = new Set(categories.map(key));
	const kept = item.kind === 'task' && f.kind === 'task'
		? [...(category ? [category] : []), ...(item.categories ?? []).filter((v) => !davids.has(key(v)))]
		: (item.categories ?? []);
	if (kept.length) next.categories = kept;
	if (item.carriedFrom && f.date === item.date) next.carriedFrom = item.carriedFrom;
	if (recurrence) next.recurrence = recurrence;
	return { item: next };
}
