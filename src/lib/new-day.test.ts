import { describe, expect, it } from 'vitest';
import { dayBegun, freshAddress, mayAsk, pageForNewDay, pageToRead, retryAfter, shownAddress, turnedToNewDay, untilMidnight } from './new-day';

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

describe('retryAfter', () => {
	const now = new Date(2026, 9, 22, 3, 0);
	it('asks again a minute later for the first five tries, then every ten minutes', () => {
		expect([1, 5, 6, 40].map((tries) => retryAfter(tries, 0, now))).toEqual([60_000, 60_000, 600_000, 600_000]);
	});
	it('after three hours of the server still on the old day, waits for the next midnight here', () => {
		expect(retryAfter(20, 3 * 3600_000 - 1, now)).toBe(600_000);
		expect(retryAfter(20, 3 * 3600_000, now)).toBe(untilMidnight(now));
		expect(retryAfter(20, 3 * 3600_000, now)).toBeGreaterThan(20 * 3600_000);
	});
});

describe('mayAsk', () => {
	it('lets a wake ask freely during the quick tries', () => {
		expect(mayAsk(0, 0)).toBe(true);
		expect(mayAsk(4, 1000)).toBe(true);
	});
	it('then lets a wake ask at most once per ten minutes', () => {
		expect(mayAsk(5, 599_000)).toBe(false);
		expect(mayAsk(9, 600_000)).toBe(true);
	});
});

describe('turnedToNewDay', () => {
	it('is true when the page went from the old today’s page to the new one', () => {
		expect(turnedToNewDay(wed, { ...thu, start: thu.todayPage })).toBe(true);
	});
	it('is false when the page stayed, or the viewer had turned to another page', () => {
		expect(turnedToNewDay(wed, { ...thu, start: wed.start })).toBe(false);
		expect(turnedToNewDay({ ...wed, start: '2026-10-15' }, { ...thu, start: '2026-10-15' })).toBe(false);
		expect(turnedToNewDay(wed, { ...wed, start: '2026-10-22' })).toBe(false);
	});
});

describe('pageToRead', () => {
	it('reads the page holding this device’s new today for a page showing today', () => {
		expect(pageToRead(wed, new Date(2026, 9, 22, 0, 0, 5))).toBe('2026-10-22');
	});
	it('reads the page on screen for a page flipped to', () => {
		expect(pageToRead({ ...wed, start: '2026-10-15' }, new Date(2026, 9, 22, 0, 0, 5))).toBe('2026-10-15');
	});
});

describe('freshAddress', () => {
	it('gives each read its own address', () => {
		expect(freshAddress('2026-10-22', 3)).toBe('?page=2026-10-22&fresh=3');
		expect(freshAddress('2026-10-22', 4)).not.toBe(freshAddress('2026-10-22', 3));
	});
});

describe('shownAddress', () => {
	it('keeps the planner’s own address for a page opened without one, now on the new today’s page', () => {
		expect(shownAddress(false, { ...thu, start: thu.todayPage })).toBe('');
	});
	it('otherwise names the page', () => {
		expect(shownAddress(true, { ...thu, start: thu.todayPage })).toBe('?page=2026-10-22');
		expect(shownAddress(false, { ...thu, start: '2026-10-15' })).toBe('?page=2026-10-15');
	});
});
