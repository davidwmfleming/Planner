import { describe, expect, it } from 'vitest';
import { byName, calendarAtPath, checkCalendarName, DEFAULT_CATEGORIES, parseSettings } from './settings';

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

	it('allows 40 letters but not 41, counting an emoji as one', () => {
		expect(checkCalendarName('a'.repeat(40), all)).toEqual({ name: 'a'.repeat(40) });
		expect(checkCalendarName('a'.repeat(41), all)).toEqual({ error: 'Keep the name to 40 letters or fewer' });
		expect(checkCalendarName(`${'a'.repeat(38)}🎹`, all)).toEqual({ name: `${'a'.repeat(38)}🎹` });
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
