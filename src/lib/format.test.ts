import { describe, expect, it } from 'vitest';
import { saysReload, shortTitle } from './format';

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
