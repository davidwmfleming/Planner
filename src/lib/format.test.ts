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
});
