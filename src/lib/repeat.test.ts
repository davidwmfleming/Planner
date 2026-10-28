import { describe, expect, it } from 'vitest';
import { monthlyChoice, monthlyRule, monthlyWays, repeatChoice } from './repeat';

describe('monthly repeats', () => {
	it('offers the date, the weekday of the month, and the last weekday when it is the last one', () => {
		expect(monthlyWays('2026-10-22').map((w) => w.name)).toEqual(['The 22nd', 'The 4th Thursday']);
		expect(monthlyWays('2026-11-26').map((w) => w.name)).toEqual(['The 26th', 'The 4th Thursday', 'The last Thursday']);
		// A 5th Thursday is offered only as the last one.
		expect(monthlyWays('2026-10-29').map((w) => w.name)).toEqual(['The 29th', 'The last Thursday']);
		expect(monthlyWays('2026-10-31')[0].name).toBe('The 31st');
		expect(monthlyWays('2026-10-01').map((w) => w.name)).toEqual(['The 1st', 'The 1st Thursday']);
		expect(monthlyWays('2026-10-11')[0].name).toBe('The 11th');
	});

	it('writes standard rules, every month or every few months', () => {
		expect(monthlyRule('2026-10-31', 1, 'day')).toBe('FREQ=MONTHLY');
		expect(monthlyRule('2026-10-22', 3, 'day')).toBe('FREQ=MONTHLY;INTERVAL=3');
		expect(monthlyRule('2026-10-22', 1, 'weekday')).toBe('FREQ=MONTHLY;BYDAY=4TH');
		expect(monthlyRule('2026-11-26', 2, 'last')).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=-1TH');
		expect(monthlyRule('2026-10-22', 1, 'last')).toBeUndefined();
		expect(monthlyRule('2026-10-22', 0, 'day')).toBeUndefined();
		expect(monthlyRule('2026-10-22', 100, 'day')).toBeUndefined();
	});

	it('reads its own rules back, in any order, and leaves other rules as made elsewhere', () => {
		expect(monthlyChoice('FREQ=MONTHLY;BYDAY=4TH;INTERVAL=2', '2026-10-22')).toEqual({ every: 2, way: 'weekday' });
		expect(monthlyChoice('FREQ=MONTHLY', '2026-10-31')).toEqual({ every: 1, way: 'day' });
		expect(repeatChoice('FREQ=MONTHLY;INTERVAL=6', '2026-10-22')).toBe('monthly');
		// The 2nd Tuesday doesn't match a series starting on the 4th Thursday.
		expect(repeatChoice('FREQ=MONTHLY;BYDAY=2TU', '2026-10-22')).toBe('custom');
		expect(repeatChoice('FREQ=MONTHLY;BYMONTHDAY=1,15', '2026-10-01')).toBe('custom');
		expect(repeatChoice('FREQ=MONTHLY;COUNT=3', '2026-10-01')).toBe('custom');
		expect(repeatChoice('FREQ=WEEKLY;INTERVAL=2', '2026-10-22')).toBe('fortnightly');
	});
});
