import { describe, expect, it } from 'vitest';
import { byName, calendarAtPath, calendarTags, checkCalendarName, DEFAULT_CATEGORIES, menuLabels, parseSettings } from './settings';

const calendars = [
	{ url: 'http://127.0.0.1:5232/david/me/', name: 'Me' },
	{ url: 'http://127.0.0.1:5232/david/work/', name: 'Work' },
	{ url: 'http://127.0.0.1:5232/david/family/', name: 'Family' }
];

describe('parseSettings', () => {
	it('reads stored settings as they are', () => {
		const stored = { categories: ['Errands', 'Waiting'], workCalendar: null, defaultEventCalendar: '/david/family/' };
		expect(parseSettings(JSON.stringify(stored), calendars)).toEqual(stored);
	});

	it('uses the three lists, Work and Me when nothing is stored', () => {
		expect(parseSettings(undefined, calendars)).toEqual({
			categories: DEFAULT_CATEGORIES,
			workCalendar: '/david/work/',
			defaultEventCalendar: '/david/me/'
		});
		expect(DEFAULT_CATEGORIES).toEqual(['This month', 'Waiting', 'Someday']);
	});

	it('has no work or default calendar when those calendars are missing', () => {
		expect(parseSettings(undefined, [])).toEqual({ categories: DEFAULT_CATEGORIES, workCalendar: null, defaultEventCalendar: null });
	});

	it('falls back field by field when the stored value is damaged', () => {
		expect(parseSettings('not json', calendars).categories).toEqual(DEFAULT_CATEGORIES);
		expect(parseSettings('[1, 2]', calendars).workCalendar).toBe('/david/work/');
		const partly = parseSettings(JSON.stringify({ categories: ['Errands', 7, ''], workCalendar: 3 }), calendars);
		expect(partly).toEqual({ categories: DEFAULT_CATEGORIES, workCalendar: '/david/work/', defaultEventCalendar: '/david/me/' });
	});
});

describe('filling in the Work and default choices', () => {
	it('can use other calendar names than Work and Me', () => {
		const chosen = parseSettings(undefined, calendars, { workCalendar: 'Family', defaultEventCalendar: 'Work' });
		expect(chosen).toEqual({ categories: DEFAULT_CATEGORIES, workCalendar: '/david/family/', defaultEventCalendar: '/david/work/' });
	});

	it('leaves a choice empty when the named calendar is missing', () => {
		expect(parseSettings(undefined, calendars, { workCalendar: 'Office', defaultEventCalendar: 'Me' }).workCalendar).toBeNull();
	});
});

describe('calendarAtPath', () => {
	it('finds a calendar by the path stored in the settings', () => {
		expect(calendarAtPath(calendars, '/david/work/')?.name).toBe('Work');
	});

	it('finds nothing for no choice or a calendar that is gone', () => {
		expect(calendarAtPath(calendars, null)).toBeUndefined();
		expect(calendarAtPath(calendars, '/david/old/')).toBeUndefined();
	});
});

describe('checkCalendarName', () => {
	const all = [...calendars, { url: 'http://127.0.0.1:5232/david/tasks/', name: 'Tasks' }];

	it('accepts a new name, tidying spaces', () => {
		expect(checkCalendarName('  School   run ', all)).toEqual({ name: 'School run' });
	});

	it('refuses an empty name', () => {
		expect(checkCalendarName('', all)).toEqual({ error: 'Give the calendar a name' });
		expect(checkCalendarName('   ', all)).toEqual({ error: 'Give the calendar a name' });
	});

	it('removes control characters and refuses a name of only invisible characters', () => {
		expect(checkCalendarName('School\u0000\u0007 run\n', all)).toEqual({ name: 'School run' });
		expect(checkCalendarName('\u200b\u200d\ufeff', all)).toEqual({ error: 'Give the calendar a name' });
		expect(checkCalendarName('\u0001\u001f\u007f', all)).toEqual({ error: 'Give the calendar a name' });
		// A joiner inside an emoji family is part of the name, not padding.
		expect(checkCalendarName('👨\u200d👩\u200d👧 Home', all)).toEqual({ name: '👨\u200d👩\u200d👧 Home' });
	});

	it('removes invisible format characters, keeping the ones inside an emoji', () => {
		expect(checkCalendarName('Sch\u200bool\ufeff', all)).toEqual({ name: 'School' });
		// A right-to-left override would make the name read backwards on the page.
		expect(checkCalendarName('\u202eKrow\u202c', all)).toEqual({ name: 'Krow' });
		expect(checkCalendarName('Ho\u200dme\u2060', all)).toEqual({ name: 'Home' });
		expect(checkCalendarName('\u200d\u{1f469}\u200d', all)).toEqual({ name: '\u{1f469}' });
		expect(checkCalendarName('\u{1f3f3}\ufe0f\u200d\u{1f308} Club', all)).toEqual({ name: '\u{1f3f3}\ufe0f\u200d\u{1f308} Club' });
		expect(checkCalendarName('\u{1f469}\u{1f3fd}\u200d\u{1f4bb} Desk', all)).toEqual({ name: '\u{1f469}\u{1f3fd}\u200d\u{1f4bb} Desk' });
		// A flag like Scotland's is spelled with invisible tag letters after the black flag.
		const scotland = '\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}';
		expect(checkCalendarName(`${scotland} Trip`, all)).toEqual({ name: `${scotland} Trip` });
		expect(checkCalendarName('Trip\u{e0067}\u{e007f}', all)).toEqual({ name: 'Trip' });
		// The duplicate check sees the cleaned name.
		expect(checkCalendarName('Fam\u200bily', all)).toEqual({ error: 'There is already a calendar called "Family"' });
	});

	it('keeps a zero-width non-joiner inside a word, where Persian and other scripts need it, but not at the ends', () => {
		expect(checkCalendarName('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645', all)).toEqual({ name: '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645' });
		expect(checkCalendarName('\u200cHome\u200c', all)).toEqual({ name: 'Home' });
		expect(checkCalendarName('Home \u200c', all)).toEqual({ name: 'Home' });
		expect(checkCalendarName('\u200c\u200c', all)).toEqual({ error: 'Give the calendar a name' });
	});

	it('allows 40 letters but not 41, counting an emoji as one', () => {
		expect(checkCalendarName('a'.repeat(40), all)).toEqual({ name: 'a'.repeat(40) });
		expect(checkCalendarName('a'.repeat(41), all)).toEqual({ error: 'Keep the name to 40 letters or fewer' });
		expect(checkCalendarName(`${'a'.repeat(38)}🎹`, all)).toEqual({ name: `${'a'.repeat(38)}🎹` });
	});

	it('counts what a person sees as one letter as one: a family emoji, an accent typed separately', () => {
		const family = '👨\u200d👩\u200d👧';
		expect(checkCalendarName(`${'a'.repeat(39)}${family}`, all)).toEqual({ name: `${'a'.repeat(39)}${family}` });
		expect(checkCalendarName(`${'a'.repeat(39)}e\u0301`, all)).toEqual({ name: `${'a'.repeat(39)}e\u0301` });
		expect(checkCalendarName(`${'a'.repeat(40)}${family}`, all)).toEqual({ error: 'Keep the name to 40 letters or fewer' });
	});

	it('refuses a name already used by any calendar or list, whatever the case', () => {
		expect(checkCalendarName('family', all)).toEqual({ error: 'There is already a calendar called "Family"' });
		expect(checkCalendarName('TASKS', all)).toEqual({ error: 'There is already a calendar called "Tasks"' });
	});

	it('lets a calendar being renamed keep its name or change only its case', () => {
		expect(checkCalendarName('Work', all, 'http://127.0.0.1:5232/david/work/')).toEqual({ name: 'Work' });
		expect(checkCalendarName('WORK', all, 'http://127.0.0.1:5232/david/work/')).toEqual({ name: 'WORK' });
		expect(checkCalendarName('Me', all, 'http://127.0.0.1:5232/david/work/')).toEqual({ error: 'There is already a calendar called "Me"' });
	});
});

describe('byName', () => {
	it('sorts calendars by name the way a person would', () => {
		const sorted = [{ name: 'work' }, { name: 'Family' }, { name: 'Ärzte' }, { name: 'Me 10' }, { name: 'Me 9' }].sort(byName);
		expect(sorted.map((c) => c.name)).toEqual(['Ärzte', 'Family', 'Me 9', 'Me 10', 'work']);
	});
});

describe('menuLabels', () => {
	it('shows just the name when no other calendar has it', () => {
		expect(menuLabels([{ path: '/david/me/', name: 'Me' }, { path: '/david/work/', name: 'Work' }])).toEqual([
			{ path: '/david/me/', name: 'Me', label: 'Me' },
			{ path: '/david/work/', name: 'Work', label: 'Work' }
		]);
	});

	it('adds the end of the address when two calendars share a name, whatever the case', () => {
		const labels = menuLabels([
			{ path: '/david/family/', name: 'Family', work: true },
			{ path: '/david/family-2/', name: 'family' },
			{ path: '/david/%C3%84rzte/', name: 'Doctors' },
			{ path: '/david/doctors/', name: 'Doctors' },
			{ path: '/david/me/', name: 'Me' }
		]).map((c) => c.label);
		expect(labels).toEqual(['Family (family)', 'family (family-2)', 'Doctors (Ärzte)', 'Doctors (doctors)', 'Me']);
	});

	it('shows only the end of a long address, so the menu stays readable on a phone', () => {
		const labels = menuLabels([
			{ path: '/david/0f8a3c2e-1b4d-4e5f-9a6b-7c8d9e0f1a2b/', name: 'Family' },
			{ path: '/david/family-from-the-old-ipad/', name: 'Family' },
			{ path: '/david/family/', name: 'Family' }
		]).map((c) => c.label);
		expect(labels).toEqual(['Family (…7c8d9e0f1a2b)', 'Family (…the-old-ipad)', 'Family (family)']);
	});

	it('shows the whole of a short address when the ends of two are the same', () => {
		const labels = menuLabels([
			{ path: '/david/kids-shared-calendar/', name: 'Family' },
			{ path: '/david/home-shared-calendar/', name: 'Family' },
			{ path: '/david/shared-calendar/', name: 'Family' }
		]).map((c) => c.label);
		expect(labels).toEqual(['Family (kids-shared-calendar)', 'Family (home-shared-calendar)', 'Family (shared-calendar)']);
	});

	it('shows the part that differs when two long addresses end the same way (Google calendars)', () => {
		const labels = menuLabels([
			{ path: '/david/c_9f3e2a1b7c6d5e4f%40group.calendar.google.com/', name: 'Family' },
			{ path: '/david/c_0a1b2c3d4e5f6a7b%40group.calendar.google.com/', name: 'Family' },
			{ path: '/david/me/', name: 'Me' }
		]).map((c) => c.label);
		expect(labels).toEqual(['Family (…2a1b7c6d5e4f…)', 'Family (…2c3d4e5f6a7b…)', 'Me']);
	});

	it('tells apart a long address that is the end of another', () => {
		const labels = menuLabels([
			{ path: '/david/shared-calendar-of-the-family/', name: 'Family' },
			{ path: '/david/kids-shared-calendar-of-the-family/', name: 'Family' }
		]).map((c) => c.label);
		expect(labels).toEqual(['Family (…f-the-family)', 'Family (kids-…)']);
	});

	it('never shows two of a name the same way, however alike their addresses', () => {
		const paths = ['/david/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-x-calendar-for-the-family/', '/david/baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-x-calendar-for-the-family/', '/david/zz-calendar-for-the-family/'];
		const labels = menuLabels(paths.map((path) => ({ path, name: 'Family' }))).map((c) => c.label);
		expect(new Set(labels).size).toBe(3);
	});

	it('keeps the other fields', () => {
		expect(menuLabels([{ path: '/david/me/', name: 'Me', work: true }])[0]).toMatchObject({ work: true });
	});
});

describe('calendarTags', () => {
	const tags = (...names: string[]) => Object.values(calendarTags(names.map((name, i) => ({ path: `/david/c${i}/`, name }))));

	it('is the first 4 letters of the name, or all of a short one', () => {
		expect(tags('Family', 'Me', 'Morgan Meals', 'Tasks', 'Trip')).toEqual(['Fami', 'Me', 'Morg', 'Task', 'Trip']);
	});

	it('is keyed by path', () => {
		expect(calendarTags([{ path: '/david/family/', name: 'Family' }, { path: '/david/me/', name: 'Me' }])).toEqual({ '/david/family/': 'Fami', '/david/me/': 'Me' });
	});

	it('drops spaces at either end, so a cut at a space leaves no gap in the tag', () => {
		expect(tags('The list', 'To do list', '  Kids  ')).toEqual(['The', 'To d', 'Kids']);
	});

	it('counts an emoji, a flag or an accented letter as one letter, and never cuts one in half', () => {
		const family = '👨‍👩‍👧';
		expect(tags('🎉 Party', `${family}${family} Home`, '🇬🇧🇫🇷 trips', '🏴󠁧󠁢󠁳󠁣󠁴󠁿 golf')).toEqual(['🎉 Pa', `${family}${family} H`, '🇬🇧🇫🇷 t', '🏴󠁧󠁢󠁳󠁣󠁴󠁿 go']);
		// Accents typed as one character, and as a letter followed by a separate accent mark.
		expect(tags('\u00c9v\u00e9nements', 'E\u0301te\u0301s camps')).toEqual(['\u00c9v\u00e9n', 'E\u0301te\u0301s']);
		expect(tags('Ärzte', 'Ψυχαγωγία', '日本の休日')).toEqual(['Ärzt', 'Ψυχα', '日本の休']);
	});

	it('uses a few more letters when two tags would be the same', () => {
		// David's own calendars: Work and Workouts.
		expect(tags('Me', 'Family', 'Workouts', 'Morgan Meals', 'Work')).toEqual(['Me', 'Fami', 'Worko', 'Morg', 'Work']);
		expect(tags('Kids A', 'Kids B', 'Kidstuff')).toEqual(['Kids A', 'Kids B', 'Kidst']);
		// A name that is all of another's start is shown whole; the other gets letters up to where they differ.
		expect(tags('Family', 'Family trips')).toEqual(['Family', 'Family t']);
	});

	it('treats tags that differ only in case as the same, since they are hard to tell apart', () => {
		expect(tags('school', 'School trips')).toEqual(['school', 'School t']);
	});

	it('tells apart a cut that ends at a space from a short name', () => {
		expect(tags('Ab   x', 'Ab')).toEqual(['Ab   x', 'Ab']);
	});

	it('adds the end of the address, as the menus do, when two calendars have the same name', () => {
		const tagged = calendarTags([
			{ path: '/david/family/', name: 'Family' },
			{ path: '/david/family-2/', name: 'family' },
			{ path: '/david/me/', name: 'Me' }
		]);
		expect(tagged).toEqual({ '/david/family/': 'Fami (family)', '/david/family-2/': 'fami (family-2)', '/david/me/': 'Me' });
		// A third calendar that starts the same way still gets more letters.
		expect(tags('Family', 'Family', 'Family trips')).toEqual(['Fami (c0)', 'Fami (c1)', 'Famil']);
	});

	it('never gives two calendars the same tag', () => {
		const names = ['Work', 'Workouts', 'Work ', 'work', 'Wor', 'Worko', 'Workout', 'W o r k', 'Work trips', 'Work travel'];
		const all = tags(...names).map((t) => t.toLowerCase());
		expect(new Set(all).size).toBe(names.length);
	});

	it('is empty for a calendar with no name', () => {
		expect(tags('', '   ')).toEqual(['', '']);
	});
});
