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

/** What a person sees as letters: an emoji family or a letter with a separately typed accent counts as one. */
const letters = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);

/** Longest address ending shown in a menu; a phone's own addresses are long, and their ends tell them apart. */
const HINT_LENGTH = 12;

/** The last part of a calendar's address, readable: /david/family-2/ → family-2. A long one keeps only its end. */
function lastSegment(path: string): string {
	const segment = path.split('/').filter(Boolean).pop() ?? path;
	let readable = segment;
	try {
		readable = decodeURIComponent(segment);
	} catch {
		// not percent-encoded text; show it as it is
	}
	const all = letters(readable);
	return all.length > HINT_LENGTH ? `…${all.slice(-HINT_LENGTH).join('')}` : readable;
}

/** What each calendar is called in a menu: its name, plus the end of its address when another calendar
 * has the same name (made on a phone, say), so the two entries can be told apart. */
export function menuLabels<T extends { path: string; name: string }>(calendars: T[]): (T & { label: string })[] {
	const clashes = (c: T) => calendars.some((other) => other !== c && other.name.toLowerCase() === c.name.toLowerCase());
	return calendars.map((c) => ({ ...c, label: clashes(c) ? `${c.name} (${lastSegment(c.path)})` : c.name }));
}

/** Longest calendar name the settings page accepts. */
export const MAX_NAME = 40;

/** Joiners between two emoji (a family, the rainbow flag) and the tag letters of a flag such as Scotland's are part of the emoji. */
const EMOJI_JOINER = /(?<=[\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])\u200d(?=\p{Extended_Pictographic})/gu;
const FLAG_TAGS = /\u{1f3f4}[\u{e0020}-\u{e007e}]+\u{e007f}/gu;
/** A non-joiner between two letters is part of the spelling in Persian, Kurdish and some Indian scripts. */
const WORD_NON_JOINER = /(?<=[\p{L}\p{M}\p{N}])\u200c(?=[\p{L}\p{M}\p{N}])/gu;

/** Drops invisible format characters (Unicode Cf) that aren't part of an emoji or of a word's spelling. */
function withoutFormatCharacters(text: string): string {
	const kept = new Set<number>();
	for (const m of text.matchAll(EMOJI_JOINER)) kept.add(m.index);
	for (const m of text.matchAll(WORD_NON_JOINER)) kept.add(m.index);
	for (const m of text.matchAll(FLAG_TAGS)) for (let i = m.index + 2; i < m.index + m[0].length; i++) kept.add(i);
	return text.replace(/\p{Cf}/gu, (c, at: number) => (kept.has(at) ? c : ''));
}

/** Checks a name for a new or renamed calendar: 1 to 40 letters, not used by any other collection (case ignored).
 * `current` is the URL of the calendar being renamed, which may keep its own name. */
export function checkCalendarName(raw: string, calendars: { url: string; name: string }[], current?: string): { name: string } | { error: string } {
	// Line breaks and tabs become spaces; other control characters and invisible format characters
	// (zero-width spaces, right-to-left overrides) are dropped, except those that spell an emoji or a word.
	const name = withoutFormatCharacters(raw.replace(/\s+/g, ' ').replace(/\p{Cc}/gu, '')).replace(/ {2,}/g, ' ').trim();
	if (!name) return { error: 'Give the calendar a name' };
	if (letters(name).length > MAX_NAME) return { error: `Keep the name to ${MAX_NAME} letters or fewer` };
	const taken = calendars.find((c) => c.url !== current && c.name.toLowerCase() === name.toLowerCase());
	if (taken) return { error: `There is already a calendar called "${taken.name}"` };
	return { name };
}
