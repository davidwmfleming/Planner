import { describe, expect, it } from 'vitest';
import { dayBegun, pageForNewDay, untilMidnight } from './new-day';

// Wednesday 21 October 2026 is on the Mon–Wed page (from the 19th); Thursday starts the Thu–Sun page.
const wed = { today: '2026-10-21', todayPage: '2026-10-19', start: '2026-10-19' };
const thu = { today: '2026-10-22', todayPage: '2026-10-22' };

describe('untilMidnight', () => {
	it('waits until just after the next local midnight', () => {
		expect(untilMidnight(new Date(2026, 9, 21, 23, 59, 0), 2000)).toBe(62_000);
		expect(untilMidnight(new Date(2026, 9, 21, 0, 0, 0), 0)).toBe(24 * 3600_000);
	});
});

describe('dayBegun', () => {
	it('says when the clock has passed the page’s today', () => {
		expect(dayBegun(new Date(2026, 9, 21, 23, 59), '2026-10-21')).toBe(false);
		expect(dayBegun(new Date(2026, 9, 22, 0, 0, 1), '2026-10-21')).toBe(true);
	});
	it('ignores a clock that is behind the page’s today', () => {
		expect(dayBegun(new Date(2026, 9, 20, 23, 59), '2026-10-21')).toBe(false);
	});
});

describe('pageForNewDay', () => {
	it('moves a page left open on today on to the new today’s page', () => {
		expect(pageForNewDay(wed, { ...thu, start: wed.start })).toBe('2026-10-22');
	});
	it('does nothing while it is still the same day', () => {
		expect(pageForNewDay(wed, wed)).toBeUndefined();
	});
	it('does nothing when the new today is on the same page (Monday to Tuesday)', () => {
		const mon = { today: '2026-10-19', todayPage: '2026-10-19', start: '2026-10-19' };
		expect(pageForNewDay(mon, { ...mon, today: '2026-10-20' })).toBeUndefined();
	});
	it('leaves a page flipped to on purpose where it is', () => {
		const flipped = { ...wed, start: '2026-10-15' };
		expect(pageForNewDay(flipped, { ...thu, start: flipped.start })).toBeUndefined();
	});
	it('leaves a page the viewer has just turned to', () => {
		expect(pageForNewDay(wed, { ...thu, start: '2026-10-26' })).toBeUndefined();
	});
	it('does nothing when the page shown already is the new today’s (an address with no page in it)', () => {
		expect(pageForNewDay(wed, { ...thu, start: thu.todayPage })).toBeUndefined();
	});
});
