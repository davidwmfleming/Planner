import { describe, expect, it } from 'vitest';
import { pageToday } from './clock';

const now = new Date(2026, 9, 21, 12, 0);

describe('pageToday', () => {
	it('is the server clock’s day', () => {
		expect(pageToday(now, {}, '2031-01-15')).toBe('2026-10-21');
	});
	it('takes the browser tests’ day only on a planner started for them', () => {
		expect(pageToday(now, { PLANNER_TEST_CLOCK: '1' }, '2031-01-15')).toBe('2031-01-15');
		expect(pageToday(now, { PLANNER_TEST_CLOCK: '0' }, '2031-01-15')).toBe('2026-10-21');
	});
	it('ignores anything but a date', () => {
		expect(pageToday(now, { PLANNER_TEST_CLOCK: '1' }, 'tomorrow')).toBe('2026-10-21');
		expect(pageToday(now, { PLANNER_TEST_CLOCK: '1' }, undefined)).toBe('2026-10-21');
	});
});
