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

const pathOf = (calendars: { url: string; name: string }[], name: string) => {
	const found = calendars.find((c) => c.name === name);
	return found ? new URL(found.url).pathname : null;
};

const isPath = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value !== '');

/** Reads the stored value. Anything missing or damaged gets its default, so a bad value never stops the planner. */
export function parseSettings(raw: string | undefined, calendars: { url: string; name: string }[]): Settings {
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
		categories: validCategories ? categories : DEFAULT_CATEGORIES,
		workCalendar: isPath(stored.workCalendar) ? stored.workCalendar : pathOf(calendars, 'Work'),
		defaultEventCalendar: isPath(stored.defaultEventCalendar) ? stored.defaultEventCalendar : pathOf(calendars, 'Me')
	};
}
