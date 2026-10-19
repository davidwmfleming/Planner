import { describe, expect, it } from 'vitest';
import { untilThreeAm } from './rollover';

describe('untilThreeAm', () => {
	it('waits until 3 a.m. the same night when it is before 3', () => {
		expect(untilThreeAm(new Date(2026, 9, 21, 1, 30))).toBe(90 * 60 * 1000);
	});

	it('waits until 3 a.m. the next night when it is 3 or later', () => {
		expect(untilThreeAm(new Date(2026, 9, 21, 3, 0))).toBe(24 * 3600 * 1000);
		expect(untilThreeAm(new Date(2026, 9, 21, 22, 0))).toBe(5 * 3600 * 1000);
	});
});
