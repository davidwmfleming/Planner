import { describe, expect, it } from 'vitest';
import { byName, calendarAtPath, calendarName, calendarTags, checkCalendarName, checkCategoryName, DEFAULT_CATEGORIES, menuLabels, parseSettings } from './settings';

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

describe('category names in the stored settings', () => {
	const read = (categories: unknown[]) => parseSettings(JSON.stringify({ categories }), calendars).categories;

	it('cleans them as calendar names are cleaned: line breaks and tabs become spaces, control characters go', () => {
		expect(read(['This\r\nmonth', 'Wait\ting', 'Some\rday', 'Er\u0000ra\u0007nds\u007f', ' Kids  & school '])).toEqual(['This month', 'Wait ing', 'Some day', 'Errands', 'Kids & school']);
		expect(read(['Sch\u200bool', '\u202eKrow\u202c', '👨\u200d👩\u200d👧 Home'])).toEqual(['School', 'Krow', '👨\u200d👩\u200d👧 Home']);
	});

	it('drops names left empty, longer than 40 letters, or with a comma (commas separate CATEGORIES values)', () => {
		expect(read(['\u200b\u200d', '\u0001', 'x'.repeat(41), `${'é'.repeat(40)}`, 'Kids, school', 'Waiting'])).toEqual(['é'.repeat(40), 'Waiting']);
	});

	it('keeps names that are the same once cleaned only once', () => {
		expect(read(['Waiting', 'waiting\n', 'Wait\u200bing'])).toEqual(['Waiting']);
	});

	it('reads 20,000 stored names (mostly repeats, some huge) quickly, keeping the first 51 different ones in order', () => {
		// Ten times the 200 letters looked at; longer only makes the JSON itself slow to read.
		const huge = 'x'.repeat(2_000);
		const names = Array.from({ length: 20_000 }, (_, i) => (i % 7 === 3 ? huge : i % 3 === 0 && i < 300 ? `List ${i}` : 'waiting'));
		const raw = JSON.stringify({ categories: names });
		const started = performance.now();
		const kept = parseSettings(raw, calendars).categories;
		// Much of this is parsing about 6 MB of JSON; the old way took seconds, so 1 s still catches it without failing on a busy runner.
		expect(performance.now() - started).toBeLessThan(1000);
		const first51 = [...new Set(names.filter((n) => n !== huge))].slice(0, 51);
		expect(first51.slice(0, 4)).toEqual(['List 0', 'waiting', 'List 6', 'List 9']);
		expect(kept).toEqual(first51);
	});

	it('keeps at most 51: the 50 the settings page allows, and one more while a rename is under way', () => {
		const many = Array.from({ length: 80 }, (_, i) => `List ${i + 1}`);
		expect(read(many)).toEqual(many.slice(0, 51));
	});
});

describe('a rename of a category that is under way', () => {
	const stored = (value: object) => parseSettings(JSON.stringify(value), calendars);

	it('is read when both names are on the list, spelled as the list spells them', () => {
		expect(stored({ categories: ['Waiting', 'Waiting for', 'Someday'], renaming: { from: 'waiting', to: 'WAITING FOR' } }).renaming).toEqual({ from: 'Waiting', to: 'Waiting for' });
	});

	it('is dropped when it is damaged or one of the names is not on the list', () => {
		expect(stored({ categories: ['Waiting'], renaming: { from: 'Waiting', to: 'Later' } })).not.toHaveProperty('renaming');
		expect(stored({ categories: ['Waiting', 'Later'], renaming: { from: 'Waiting', to: 7 } })).not.toHaveProperty('renaming');
		expect(stored({ categories: ['Waiting', 'Later'], renaming: 'Waiting' })).not.toHaveProperty('renaming');
		expect(stored({ categories: ['Waiting', 'Later'], renaming: { from: 'Waiting', to: 'waiting' } })).not.toHaveProperty('renaming');
	});
});

describe('checkCategoryName', () => {
	const lists = ['This month', 'Waiting', 'Someday'];

	it('accepts a new name, cleaned as calendar names are', () => {
		expect(checkCategoryName('  Kids\t&  school\u200b ', lists)).toEqual({ name: 'Kids & school' });
	});

	it('refuses an empty name, a long one, and one with a comma', () => {
		expect(checkCategoryName(' \u200b ', lists)).toEqual({ error: 'Give the category a name' });
		expect(checkCategoryName('x'.repeat(41), lists)).toEqual({ error: 'Keep the name to 40 letters or fewer' });
		expect(checkCategoryName('é'.repeat(40), lists)).toEqual({ name: 'é'.repeat(40) });
		expect(checkCategoryName('Kids, school', lists)).toEqual({ error: "A category name can't have a comma in it: other apps would read it as two" });
	});

	it('refuses a name already on the list, whatever its case, but lets a category change the case of its own', () => {
		expect(checkCategoryName('waiting', lists)).toEqual({ error: 'There is already a category called "Waiting"' });
		expect(checkCategoryName('WAITING', lists, 'Waiting')).toEqual({ name: 'WAITING' });
		expect(checkCategoryName('someday', lists, 'Waiting')).toEqual({ error: 'There is already a category called "Someday"' });
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

	it('uses a few more letters, up to 6, when two tags would be the same', () => {
		// David's own calendars: Work and Workouts.
		expect(tags('Me', 'Family', 'Workouts', 'Morgan Meals', 'Work')).toEqual(['Me', 'Fami', 'Worko', 'Morg', 'Work']);
		expect(tags('Kids A', 'Kids B', 'Kidstuff')).toEqual(['Kids A', 'Kids B', 'Kidst']);
		expect(tags('Kids art', 'Kids ball')).toEqual(['Kids a', 'Kids b']);
	});

	it('numbers calendars still alike after 6 letters, in the order of their addresses', () => {
		expect(tags('Swimming lessons Mon', 'Swimming lessons Tue', 'Me')).toEqual(['Swim 1', 'Swim 2', 'Me']);
		// A name that is all of another's start can't grow either.
		expect(tags('Family', 'Family trips')).toEqual(['Fami 1', 'Fami 2']);
		const tagged = calendarTags([
			{ path: '/david/family-2/', name: 'Family' },
			{ path: '/david/family/', name: 'Family' }
		]);
		expect(tagged).toEqual({ '/david/family/': 'Fami 1', '/david/family-2/': 'Fami 2' });
	});

	it('treats tags that differ only in case as the same, since they are hard to tell apart', () => {
		expect(tags('school', 'School trips')).toEqual(['scho 1', 'Scho 2']);
		expect(tags('Kids', 'kids')).toEqual(['Kids 1', 'kids 2']);
	});

	it('tells apart a cut that ends at a space from a short name', () => {
		expect(tags('Ab   x', 'Ab')).toEqual(['Ab   x', 'Ab']);
	});

	it('never shows a piece of the calendar address', () => {
		const tagged = calendarTags([
			{ path: '/david/kids-upper/', name: 'Kids' },
			{ path: '/david/a-kids-lower/', name: 'kids' }
		]);
		expect(Object.values(tagged).join(' ')).not.toMatch(/upper|lower|\(/);
	});

	it('says Work for the work calendar, whatever it is called, and keeps other tags apart from it', () => {
		const tagged = calendarTags(
			[
				{ path: '/david/work/', name: 'Job' },
				{ path: '/david/workouts/', name: 'Workouts' },
				{ path: '/david/work-2/', name: 'Work' },
				{ path: '/david/me/', name: 'Me' }
			],
			'/david/work/'
		);
		expect(tagged).toEqual({ '/david/work/': 'Work', '/david/workouts/': 'Worko', '/david/work-2/': 'Work 2', '/david/me/': 'Me' });
	});

	it('never gives two calendars the same tag, numbers included', () => {
		const names = ['Work', 'Workouts', 'Work ', 'work', 'Wor', 'Worko', 'Workout', 'W o r k', 'Work trips', 'Work travel', 'Work 1', 'Work 2', ''];
		const all = Object.values(calendarTags(names.map((name, i) => ({ path: `/david/c${i}/`, name })), '/david/c0/')).map((t) => t.toLowerCase());
		expect(new Set(all).size).toBe(names.length);
		expect(tags('Swim 1', 'Swim 2', 'Swimming M', 'Swimming T')).toEqual(['Swim 1', 'Swim 2', 'Swim 3', 'Swim 4']);
	});

	// Names come from the calendar server, which doesn't limit their length (a phone or another app may set any name).
	it('stays quick with very long names that differ only at the end, and still tells them apart', () => {
		const calendars = Array.from({ length: 20 }, (_, i) => ({ path: `/david/c${String(i).padStart(2, '0')}/`, name: `${'x'.repeat(99_999)}${String.fromCharCode(97 + i)}` }));
		const started = performance.now();
		const tagged = Object.values(calendarTags(calendars));
		// Generous for a slow runner; the old way took whole seconds.
		expect(performance.now() - started).toBeLessThan(250);
		expect(tagged).toEqual(Array.from({ length: 20 }, (_, i) => `xxxx ${i + 1}`));
	});

	it('gives a very long name a short tag', () => {
		expect(tags('y'.repeat(100_000))).toEqual(['yyyy']);
	});

	it('is Cal for a calendar with no name', () => {
		expect(tags('', 'Me')).toEqual(['Cal', 'Me']);
		expect(tags('', '   ')).toEqual(['Cal 1', 'Cal 2']);
	});
});

describe('calendarName', () => {
	it('is the name without spaces at the ends, or Unnamed calendar', () => {
		expect(calendarName('  Gym  ')).toBe('Gym');
		expect(calendarName('   ')).toBe('Unnamed calendar');
	});
});
