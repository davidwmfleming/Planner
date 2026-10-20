import { describe, expect, it } from 'vitest';
import { shortTitle } from './format';

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
