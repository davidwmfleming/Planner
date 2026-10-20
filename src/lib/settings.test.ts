import { describe, expect, it } from 'vitest';
import { calendarAtPath, DEFAULT_CATEGORIES, parseSettings } from './settings';

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
