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

/** Orders calendars by name as a person would (capitals and accents aside, "Me 9" before "Me 10"). */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** Longest calendar name the settings page accepts. */
export const MAX_NAME = 40;

/** Checks a name for a new or renamed calendar: 1 to 40 letters, not used by any other collection (case ignored).
 * `current` is the URL of the calendar being renamed, which may keep its own name. */
export function checkCalendarName(raw: string, calendars: { url: string; name: string }[], current?: string): { name: string } | { error: string } {
	// Line breaks and tabs become spaces; other control characters are dropped. A name that is only
	// invisible characters (zero-width spaces and the like) counts as empty.
	const name = raw.replace(/\s+/g, ' ').replace(/\p{Cc}/gu, '').replace(/ {2,}/g, ' ').trim();
	if (!name.replace(/\p{Cf}/gu, '').trim()) return { error: 'Give the calendar a name' };
	if ([...name].length > MAX_NAME) return { error: `Keep the name to ${MAX_NAME} letters or fewer` };
	const taken = calendars.find((c) => c.url !== current && c.name.toLowerCase() === name.toLowerCase());
	if (taken) return { error: `There is already a calendar called "${taken.name}"` };
	return { name };
}
