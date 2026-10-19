// Applies the details sheet's fields to an item. Pure, so the rules can be tested without a server.
import { addDays } from './dates';
import { LABELS, type Item, type ItemLabel } from './item';
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

export const daysBetween = (from: string, to: string) =>
	Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000);

export function applyEdit(item: Item, f: EditFields): { item: Item } | { error: string } {
	const title = f.title.trim();
	if (!title) return { error: 'Give it a title' };
	if (f.kind !== 'event' && f.kind !== 'task') return { error: 'Choose event or task' };
	if (f.date && !ISO.test(f.date)) return { error: 'That date is not valid' };
	if (f.kind === 'event' && !f.date) return { error: 'An event needs a date; make it a task to keep it unscheduled' };
	if (f.time && !HHMM.test(f.time)) return { error: 'That time is not valid' };
	if (f.endTime && !HHMM.test(f.endTime)) return { error: 'That end time is not valid' };
	if (f.label && !(LABELS as string[]).includes(f.label)) return { error: 'Unknown list' };
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
	if (f.label) next.label = f.label as ItemLabel;
	if (item.carriedFrom && f.date === item.date) next.carriedFrom = item.carriedFrom;
	if (recurrence) next.recurrence = recurrence;
	return { item: next };
}
