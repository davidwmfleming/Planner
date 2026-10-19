/** One line in the planner. Events sit in the left column, tasks in the right. */
export type ItemKind = 'event' | 'task';
export type ItemState = 'open' | 'done' | 'dropped';
export type ItemLabel = 'month' | 'waiting' | 'someday';

export interface Item {
	uid: string;
	kind: ItemKind;
	title: string;
	/** Day it sits on (YYYY-MM-DD). Tasks without a date are "not scheduled". */
	date?: string;
	/** Last day of a multi-day all-day event, inclusive. */
	endDate?: string;
	/** Start time, HH:MM, local time. */
	time?: string;
	/** End time, HH:MM, events only. */
	endTime?: string;
	location?: string;
	notes?: string;
	label?: ItemLabel;
	state: ItemState;
	/** Day an unfinished task was originally on before rollover moved it. */
	carriedFrom?: string;
	/** RRULE value, e.g. "FREQ=WEEKLY;BYDAY=MO". Expanded in a later step. */
	recurrence?: string;
}

export const LABELS: ItemLabel[] = ['month', 'waiting', 'someday'];
