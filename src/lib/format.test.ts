import { describe, expect, it } from 'vitest';
import { dayName, pageSubtitle, saysReload, shortTitle, weekNumber } from './format';

describe('titles quoted in messages', () => {
	it('leaves a short title as it is', () => {
		expect(shortTitle('Dentist')).toBe('Dentist');
		expect(shortTitle('x'.repeat(40))).toBe('x'.repeat(40));
	});

	it('cuts a long title to about 40 characters, ending in …', () => {
		const long = 'Pick up the dry cleaning and then the groceries for the weekend party';
		expect(shortTitle(long)).toBe('Pick up the dry cleaning and then the g…');
		expect([...shortTitle(long)].length).toBeLessThanOrEqual(40);
	});

	it('never cuts an emoji in half', () => {
		expect(shortTitle(`${'a'.repeat(38)}🎉🎉🎉`)).toBe(`${'a'.repeat(38)}🎉…`);
	});

	it('counts and cuts what a person sees as one character, such as a family emoji or a flag', () => {
		const family = '👨‍👩‍👧‍👦';
		const flag = '🇬🇧';
		expect(shortTitle(family.repeat(40))).toBe(family.repeat(40));
		expect(shortTitle(family.repeat(41))).toBe(`${family.repeat(39)}…`);
		// Flags are pairs of letters: cutting between them would show the wrong flag, or two stray letters.
		expect(shortTitle(`${'a'.repeat(38)}${flag.repeat(3)}`)).toBe(`${'a'.repeat(38)}${flag}…`);
		expect(shortTitle(`${'a'.repeat(37)}${flag.repeat(4)}`)).toBe(`${'a'.repeat(37)}${flag.repeat(2)}…`);
	});
});

describe('messages that ask for a reload (they get a Reload button: the installed app has no browser controls)', () => {
	it.each([
		"The calendar server isn't answering. Check that it is running, then reload.",
		'That item is no longer on the calendar; reload the page',
		'The calendar server didn\'t delete "Dentist". Reload the page and try again.',
		'"Dentist" may now be in two calendars, because the calendar server didn\'t confirm it removed the old one. Wait a minute before reloading the page; then, if it\'s still in two, delete the one in Me.',
		"That calendar isn't there any more; reload the page"
	])('%s', (message) => {
		expect(saysReload(message)).toBe(true);
	});

	it('leaves out messages that do not', () => {
		expect(saysReload('There is no calendar for events yet. Add one in Settings.')).toBe(false);
		expect(saysReload('Check the connection, then tap the line and try again.')).toBe(false);
	});
});

describe('dayName', () => {
	it('names the day of the week in full', () => {
		expect(dayName('2026-10-22')).toBe('Thursday');
		expect(dayName('2026-10-25')).toBe('Sunday');
	});
});

describe('the line under the month in the page header', () => {
	it('numbers weeks from Monday, the first week holding a Thursday', () => {
		expect(weekNumber('2026-10-19')).toBe(43);
		expect(weekNumber('2026-10-25')).toBe(43);
		expect(weekNumber('2026-10-26')).toBe(44);
		// 1 January 2027 is a Friday, so it belongs to the last week of 2026.
		expect(weekNumber('2027-01-01')).toBe(53);
		expect(weekNumber('2027-01-04')).toBe(1);
	});

	it('names the week and the days on the page', () => {
		expect(pageSubtitle(['2026-10-19', '2026-10-20', '2026-10-21'])).toBe('Week 43 · Monday to Wednesday');
		expect(pageSubtitle(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])).toBe('Week 43 · Thursday to Sunday');
		expect(pageSubtitle(['2026-10-22'])).toBe('Week 43 · Thursday');
		expect(pageSubtitle([])).toBe('');
	});
});
