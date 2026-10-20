/** David's choices from the settings page, stored as one JSON value on the Tasks collection. */
export interface Settings {
	/** Task categories, in the order the Future tasks panel and the List menu show them. */
	categories: string[];
	/** Path of the calendar shown as work meetings (light red), or null for none. */
	workCalendar: string | null;
	/** Path of the calendar new events go in, or null to use the first event calendar. */
	defaultEventCalendar: string | null;
}

export const DEFAULT_CATEGORIES = ['This month', 'Waiting', 'Someday'];

/** Calendar names that fill in the Work and default choices when nothing is stored yet. */
export interface SettingsSeed {
	workCalendar: string;
	defaultEventCalendar: string;
}

const SEED: SettingsSeed = { workCalendar: 'Work', defaultEventCalendar: 'Me' };

const pathOf = (calendars: { url: string; name: string }[], name: string) => {
	const found = calendars.find((c) => c.name === name);
	return found ? new URL(found.url).pathname : null;
};

/** Keeps the first of names that differ only in case; the settings page lists categories keyed by name. */
const withoutRepeats = (names: string[]) => names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);

const isPath = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value !== '');

/** Reads the stored value. Anything missing or damaged gets its default, so a bad value never stops the planner. */
export function parseSettings(raw: string | undefined, calendars: { url: string; name: string }[], seed = SEED): Settings {
	let stored: Partial<Record<keyof Settings, unknown>> = {};
	try {
		const parsed = raw ? JSON.parse(raw) : {};
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
	} catch {
		// not JSON; use the defaults
	}
	const categories = stored.categories;
	const validCategories = Array.isArray(categories) && categories.every((c) => typeof c === 'string' && c.trim() !== '');
	return {
		categories: validCategories ? withoutRepeats(categories) : DEFAULT_CATEGORIES,
		workCalendar: isPath(stored.workCalendar) ? stored.workCalendar : pathOf(calendars, seed.workCalendar),
		defaultEventCalendar: isPath(stored.defaultEventCalendar) ? stored.defaultEventCalendar : pathOf(calendars, seed.defaultEventCalendar)
	};
}

/** The calendar a stored path points at, if it is still there. Paths stay the same when a calendar is renamed. */
export function calendarAtPath<T extends { url: string }>(calendars: T[], path: string | null): T | undefined {
	return path ? calendars.find((c) => new URL(c.url).pathname === path) : undefined;
}
