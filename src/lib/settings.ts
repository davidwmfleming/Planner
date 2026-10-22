import { letters } from './format';

/** David's choices from the settings page, stored as one JSON value on the Tasks collection. */
export interface Settings {
	/** Task categories, in the order the Future tasks panel and the List menu show them. */
	categories: string[];
	/** Path of the calendar shown as work meetings (light red), or null for none. */
	workCalendar: string | null;
	/** Path of the calendar new events go in, or null to use the first event calendar. */
	defaultEventCalendar: string | null;
	/** A rename of a category that hasn't finished: both names are on the list until every task has the new one. */
	renaming?: { from: string; to: string };
}

export const DEFAULT_CATEGORIES = ['This month', 'Waiting', 'Someday'];
/** Most categories the settings page lets David have. */
export const MAX_CATEGORIES = 50;
/** Most kept from the stored settings: one more, for a rename under way (both names are on the list meanwhile). */
const MAX_STORED = MAX_CATEGORIES + 1;

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
const withoutRepeats = (names: string[]) => {
	const seen = new Set<string>();
	return names.filter((n) => !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()));
};

/** Stored names looked at, and the characters of each: enough for 50 names of 40 letters, with room for repeats and
 * accents, and no more, however much another app stored. */
const STORED_LOOKED_AT = MAX_CATEGORIES * 4;
const STORED_NAME_CHARS = 200;

/** Category names as stored, cleaned as calendar names are. Names left empty, longer than 40 letters or with a comma
 * (which separates CATEGORIES values) are dropped, and at most 51 are kept: the stored value can be changed by any
 * calendar app, so it is not trusted to be what the settings page saved. */
const storedCategories = (names: string[]) =>
	withoutRepeats(names.slice(0, STORED_LOOKED_AT).map((n) => cleanName(n.slice(0, STORED_NAME_CHARS))).filter((n) => n && !n.includes(',') && letters(n).length <= MAX_NAME)).slice(0, MAX_STORED);

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
	const settings: Settings = {
		categories: validCategories ? storedCategories(categories) : DEFAULT_CATEGORIES,
		workCalendar: isPath(stored.workCalendar) ? stored.workCalendar : pathOf(calendars, seed.workCalendar),
		defaultEventCalendar: isPath(stored.defaultEventCalendar) ? stored.defaultEventCalendar : pathOf(calendars, seed.defaultEventCalendar)
	};
	const renaming = storedRename(stored.renaming, settings.categories);
	if (renaming) settings.renaming = renaming;
	return settings;
}

/** A rename under way, with both names as the list spells them; none if damaged or either name isn't on the list. */
function storedRename(value: unknown, categories: string[]): Settings['renaming'] {
	if (!value || typeof value !== 'object') return undefined;
	const { from, to } = value as Record<string, unknown>;
	if (typeof from !== 'string' || typeof to !== 'string') return undefined;
	const onList = (name: string) => categories.find((c) => c.toLowerCase() === cleanName(name.slice(0, STORED_NAME_CHARS)).toLowerCase());
	const [listFrom, listTo] = [onList(from), onList(to)];
	return listFrom && listTo && listFrom !== listTo ? { from: listFrom, to: listTo } : undefined;
}

/** The calendar a stored path points at, if it is still there. Paths stay the same when a calendar is renamed. */
export function calendarAtPath<T extends { url: string }>(calendars: T[], path: string | null): T | undefined {
	return path ? calendars.find((c) => new URL(c.url).pathname === path) : undefined;
}

/** Orders calendars by name as a person would (capitals and accents aside, "Me 9" before "Me 10"). */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** Longest address ending shown in a menu; a phone's own addresses are long, and their ends tell them apart. */
const HINT_LENGTH = 12;
/** Longest address shown whole when the ends of two are the same. */
const WHOLE_LENGTH = 24;

/** A path segment as text, as letters: %C3%84rzte → Ärzte. */
function readable(segment: string): string[] {
	try {
		return letters(decodeURIComponent(segment));
	} catch {
		// not percent-encoded text; show it as it is
		return letters(segment);
	}
}

const lastSegment = (path: string) => readable(path.split('/').filter(Boolean).pop() ?? path);
const ending = (text: string[]) => (text.length > HINT_LENGTH ? `…${text.slice(-HINT_LENGTH).join('')}` : text.join(''));
const allDiffer = (hints: string[]) => new Set(hints).size === hints.length;

/** How each of a group of same-name calendars is told apart: the end of its address (/david/family-2/ → family-2),
 * else the whole of a short address, else the part before the ending they share, else the whole path. */
function hints(paths: string[]): string[] {
	const segments = paths.map(lastSegment);
	const ends = segments.map(ending);
	if (allDiffer(ends)) return ends;
	const whole = segments.map((s) => s.join(''));
	if (segments.every((s) => s.length <= WHOLE_LENGTH) && allDiffer(whole)) return whole;
	let shared = 0;
	while (segments.every((s) => shared < s.length && s[s.length - 1 - shared] === segments[0][segments[0].length - 1 - shared])) shared++;
	// An address that is all shared ending (one is the end of another) keeps its own ending.
	const parts = segments.map((s) => (s.length > shared ? `${ending(s.slice(0, s.length - shared))}…` : ending(s)));
	return allDiffer(parts) ? parts : paths.map((p) => readable(p).join(''));
}

/** What each calendar is called in a menu: its name, plus a piece of its address when another calendar
 * has the same name (made on a phone, say), so the two entries can be told apart. */
export function menuLabels<T extends { path: string; name: string }>(calendars: T[]): (T & { label: string })[] {
	const label = new Map<T, string>();
	for (const c of calendars) {
		if (label.has(c)) continue;
		const group = calendars.filter((other) => other.name.toLowerCase() === c.name.toLowerCase());
		if (group.length === 1) label.set(c, c.name);
		else hints(group.map((g) => g.path)).forEach((hint, i) => label.set(group[i], `${group[i].name} (${hint})`));
	}
	return calendars.map((c) => ({ ...c, label: label.get(c)! }));
}

/** A calendar's name as the planner shows it: without spaces at the ends, and "Unnamed calendar" when blank. */
export const calendarName = (name: string) => name.trim() || 'Unnamed calendar';

/** Letters a calendar's tag on the planner page shows, when no other calendar's tag starts the same way. */
export const TAG_LETTERS = 4;
/** Most letters a tag grows to when it clashes with another; beyond that the calendars are numbered. */
const MOST_TAG_LETTERS = 6;
/** Letters of a name looked at. Names come from the calendar server, which doesn't limit their length. */
const NAME_LETTERS = 64;

const trailingSlash = (path: string) => path.replace(/\/$/, '');
/** Addresses in a steady order, /david/family/ before /david/family-2/. */
const byAddress = (a: string, b: string) => (trailingSlash(a) < trailingSlash(b) ? -1 : trailingSlash(a) > trailingSlash(b) ? 1 : 0);

/** Each calendar's tag on the planner page, by path: the first 4 letters of its name (an emoji or an accented letter
 * counts as one), without spaces at the ends; "Cal" for a calendar with no name; "Work" for the work calendar.
 * When two tags would look the same, whatever the case, those calendars get more letters until they differ, up to 6.
 * Calendars still alike after that get their first 4 letters and a number, in the order of their addresses
 * ("Swim 1", "Swim 2"); the work calendar keeps "Work". No two calendars get the same tag. */
export function calendarTags(calendars: { path: string; name: string }[], workCalendar?: string | null): Record<string, string> {
	type Tagged = { path: string; chars: string[]; shown: number; most: number; fixed?: string };
	const all: Tagged[] = calendars.map((c) => {
		// Cut the text before splitting it into letters, so a huge name costs no more than a short one.
		const chars = letters(c.name.trim().slice(0, NAME_LETTERS * 4)).slice(0, NAME_LETTERS);
		const fixed = c.path === workCalendar ? 'Work' : chars.length ? undefined : 'Cal';
		const most = fixed ? 0 : Math.min(MOST_TAG_LETTERS, chars.length);
		return { path: c.path, chars, most, shown: Math.min(TAG_LETTERS, most), fixed };
	});
	const tagOf = (c: Tagged, shown = c.shown) => c.fixed ?? c.chars.slice(0, shown).join('').trimEnd();
	const clashing = () => [...Map.groupBy(all, (c) => tagOf(c).toLowerCase()).values()].filter((group) => group.length > 1);
	for (;;) {
		const growing = clashing().flat().filter((c) => c.shown < c.most);
		if (!growing.length) break;
		for (const c of growing) c.shown++;
	}
	const tag = new Map(all.map((c) => [c.path, tagOf(c)]));
	const numbered = clashing().flat().filter((c) => c.path !== workCalendar).sort((a, b) => byAddress(a.path, b.path));
	const used = new Set(all.filter((c) => !numbered.includes(c)).map((c) => tagOf(c).toLowerCase()));
	const next = new Map<string, number>();
	for (const c of numbered) {
		const start = tagOf(c, Math.min(TAG_LETTERS, c.chars.length));
		// After a calendar that shows just these letters (the work calendar's Work, say), numbers start at 2.
		let n = next.get(start.toLowerCase()) ?? (used.has(start.toLowerCase()) ? 2 : 1);
		while (used.has(`${start} ${n}`.toLowerCase())) n++;
		tag.set(c.path, `${start} ${n}`);
		used.add(`${start} ${n}`.toLowerCase());
		next.set(start.toLowerCase(), n + 1);
	}
	return Object.fromEntries(tag);
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
/** A name as the planner keeps it: line breaks and tabs become spaces; other control characters and invisible format
 * characters (zero-width spaces, right-to-left overrides) are dropped, except those that spell an emoji or a word. */
export const cleanName = (raw: string) => withoutFormatCharacters(raw.replace(/\s+/g, ' ').replace(/\p{Cc}/gu, '')).replace(/ {2,}/g, ' ').trim();

/** Checks a name for a new or renamed task category: 1 to 40 letters, no comma (commas separate CATEGORIES values),
 * and not already on the list (case ignored). `current` is the category being renamed, which may change its own case. */
export function checkCategoryName(raw: string, categories: string[], current?: string): { name: string } | { error: string } {
	const name = cleanName(raw);
	if (!name) return { error: 'Give the category a name' };
	if (letters(name).length > MAX_NAME) return { error: `Keep the name to ${MAX_NAME} letters or fewer` };
	if (name.includes(',')) return { error: "A category name can't have a comma in it: other apps would read it as two" };
	const taken = categories.find((c) => c !== current && c.toLowerCase() === name.toLowerCase());
	if (taken) return { error: `There is already a category called "${taken}"` };
	return { name };
}

export function checkCalendarName(raw: string, calendars: { url: string; name: string }[], current?: string): { name: string } | { error: string } {
	const name = cleanName(raw);
	if (!name) return { error: 'Give the calendar a name' };
	if (letters(name).length > MAX_NAME) return { error: `Keep the name to ${MAX_NAME} letters or fewer` };
	const taken = calendars.find((c) => c.url !== current && c.name.toLowerCase() === name.toLowerCase());
	if (taken) return { error: `There is already a calendar called "${taken.name}"` };
	return { name };
}
