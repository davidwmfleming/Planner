// Applies the details sheet's fields to an item. Pure, so the rules can be tested without a server.
import { addDays } from './dates';
import type { Item } from './item';
import { REPEATS } from './repeat';

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
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Category names are matched without regard to case (or spaces at the ends). */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A task's category: the first of its CATEGORIES values that is one of David's categories, spelled as the
 * settings spell it. Values from other apps that aren't one of his are not shown. */
export const categoryOf = (values: string[] | undefined, categories: string[]): string | undefined => {
	for (const value of values ?? []) {
		const found = categories.find((c) => sameName(c, value));
		if (found) return found;
	}
	return undefined;
};

export const daysBetween = (from: string, to: string) =>
	Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000);

/** `categories` are David's task categories, from the settings: the List menu offers these. */
export function applyEdit(item: Item, f: EditFields, categories: string[]): { item: Item } | { error: string } {
	const title = f.title.trim();
	if (!title) return { error: 'Give it a title' };
	if (f.kind !== 'event' && f.kind !== 'task') return { error: 'Choose event or task' };
	if (f.date && !ISO.test(f.date)) return { error: 'That date is not valid' };
	if (f.kind === 'event' && !f.date) return { error: 'An event needs a date; make it a task to keep it unscheduled' };
	if (f.time && !HHMM.test(f.time)) return { error: 'That time is not valid' };
	if (f.endTime && !HHMM.test(f.endTime)) return { error: 'That end time is not valid' };
	const category = f.label ? categories.find((c) => sameName(c, f.label)) : undefined;
	if (f.label && !category) return { error: 'Unknown list' };
	const preset = REPEATS.find((r) => r.value === f.repeat);
	if (!preset && f.repeat !== 'custom') return { error: 'Unknown repeat' };
	const recurrence = preset ? preset.rule : item.recurrence;
	if (recurrence && !f.date) return { error: 'A repeating item needs a start date' };

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
	// The chosen category replaces any of David's the task had; values other apps added stay as they are.
	const kept = [...(category ? [category] : []), ...(item.categories ?? []).filter((v) => !categories.some((c) => sameName(c, v)))];
	if (kept.length) next.categories = kept;
	if (item.carriedFrom && f.date === item.date) next.carriedFrom = item.carriedFrom;
	if (recurrence) next.recurrence = recurrence;
	return { item: next };
}
