import { describe, expect, it } from 'vitest';
import { dataAddress, dataAnswered, dayBegun, mayAsk, pageForNewDay, retryAfter, turnedToNewDay, untilMidnight } from './new-day';

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

describe('dataAddress', () => {
	it('asks for the page’s data at its own path and query', () => {
		expect(dataAddress('/', '')).toBe('/__data.json');
		expect(dataAddress('/', '?page=2026-10-19')).toBe('/__data.json?page=2026-10-19');
	});
});

describe('dataAnswered', () => {
	const ok = JSON.stringify({ type: 'data', nodes: [{ type: 'skip' }, { type: 'data', data: [{}], uses: {} }] });
	it('is true only for page data that came back whole', () => {
		expect(dataAnswered(200, ok)).toBe(true);
		expect(dataAnswered(200, `${ok}\n{"type":"chunk"}`)).toBe(true);
	});
	it('is false when the calendar server is down (an error inside a 200)', () => {
		const down = { type: 'data', nodes: [{ type: 'skip' }, { type: 'error', error: { message: 'down' }, status: 503 }] };
		expect(dataAnswered(200, JSON.stringify(down))).toBe(false);
	});
	it('is false for a failed answer, a redirect or something that is not page data', () => {
		expect(dataAnswered(502, ok)).toBe(false);
		expect(dataAnswered(200, JSON.stringify({ type: 'redirect', location: '/' }))).toBe(false);
		expect(dataAnswered(200, '<html>Bad gateway</html>')).toBe(false);
	});
});

describe('retryAfter', () => {
	it('asks again a minute later for the first five tries, then every ten minutes', () => {
		expect([1, 5, 6, 40].map(retryAfter)).toEqual([60_000, 60_000, 600_000, 600_000]);
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
