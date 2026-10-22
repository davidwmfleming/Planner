/** One line in the planner. Events sit in the left column, tasks in the right. */
export type ItemKind = 'event' | 'task';
export type ItemState = 'open' | 'done' | 'dropped';

export interface Item {
	uid: string;
	kind: ItemKind;
	title: string;
	/** Day it sits on (YYYY-MM-DD). Tasks without a date are "future tasks". */
	date?: string;
	/** Last day of a multi-day all-day event, inclusive. */
	endDate?: string;
	/** Start time, HH:MM, local time. */
	time?: string;
	/** End time, HH:MM, events only. */
	endTime?: string;
	location?: string;
	notes?: string;
	/** Every CATEGORIES value, in the file's order, with the keys older planners wrote read as names. Some are David's
	 * task categories (from the settings); the others came from other apps and are kept as they are. */
	categories?: string[];
	/** The task's category as the page shows it: the first of `categories` that is one of David's, spelled as the
	 * settings spell it. Filled in for the page only; not part of the .ics. */
	label?: string;
	state: ItemState;
	/** Day an unfinished task was originally on before rollover moved it. */
	carriedFrom?: string;
	/** RRULE value, e.g. "FREQ=WEEKLY;BYDAY=MO". */
	recurrence?: string;
	/** On one showing of a repeating item: the day it was originally due (its RECURRENCE-ID). */
	occurrence?: string;
	/** On one showing of a repeating item: the day the series starts. */
	seriesStart?: string;
	/** Path of the calendar it is kept in (Me, Family, Work…), which a rename doesn't change. Not part of the .ics. */
	calendar?: string;
}
