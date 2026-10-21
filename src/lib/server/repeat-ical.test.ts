import { describe, expect, it } from 'vitest';
import type { Item } from '$lib/item';
import { itemToICS, occurrenceOn, occurrencesBetween, withOccurrence, withoutOccurrence } from './ical';

const lift: Item = { uid: 'r1', kind: 'event', title: 'Lift', date: '2026-10-05', time: '06:30', endTime: '07:30', state: 'open', recurrence: 'FREQ=WEEKLY;BYDAY=MO,TH' };
const days = (items: Item[]) => items.map((i) => i.date).sort();

// The shape iPhone Calendar writes: a time zone, a skipped week, and one meeting moved.
const FROM_PHONE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iPhone OS 18//EN
BEGIN:VTIMEZONE
TZID:America/Toronto
BEGIN:STANDARD
DTSTART:20071104T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:20070311T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:phone-1
DTSTAMP:20261001T120000Z
SUMMARY:Policy team
DTSTART;TZID=America/Toronto:20261006T090000
DTEND;TZID=America/Toronto:20261006T100000
RRULE:FREQ=WEEKLY
EXDATE;TZID=America/Toronto:20261013T090000
END:VEVENT
BEGIN:VEVENT
UID:phone-1
DTSTAMP:20261001T120000Z
RECURRENCE-ID;TZID=America/Toronto:20261020T090000
SUMMARY:Policy team (moved)
DTSTART;TZID=America/Toronto:20261021T140000
DTEND;TZID=America/Toronto:20261021T150000
END:VEVENT
END:VCALENDAR
`;

describe('repeating items', () => {
	it('shows a repeating item on each day it falls on within the page', () => {
		const shown = occurrencesBetween(itemToICS(lift), '2026-10-19', '2026-10-25');
		expect(days(shown)).toEqual(['2026-10-19', '2026-10-22']);
		expect(shown[0]).toMatchObject({ uid: 'r1', time: '06:30', occurrence: shown[0].date, seriesStart: '2026-10-05', recurrence: lift.recurrence });
	});

	it('shows nothing before the series starts', () => {
		expect(occurrencesBetween(itemToICS(lift), '2026-09-28', '2026-10-04')).toEqual([]);
	});

	it('skips removed days and follows one-off changes made on the phone', () => {
		const shown = occurrencesBetween(FROM_PHONE, '2026-10-12', '2026-10-25');
		expect(shown.map((i) => [i.date, i.time, i.title])).toEqual([['2026-10-21', '14:00', 'Policy team (moved)']]);
		expect(shown[0].occurrence).toBe('2026-10-20');
	});

	it('ticks one day without touching the rest, and can untick it', () => {
		let ics = withOccurrence(itemToICS(lift), '2026-10-22', () => ({ state: 'done' }));
		expect(occurrencesBetween(ics, '2026-10-19', '2026-10-25').map((i) => [i.date, i.state])).toEqual([
			['2026-10-19', 'open'],
			['2026-10-22', 'done']
		]);
		ics = withOccurrence(ics, '2026-10-22', (now) => ({ state: now.state === 'done' ? 'open' : 'done' }));
		expect(occurrencesBetween(ics, '2026-10-22', '2026-10-22')[0].state).toBe('open');
		expect(ics.match(/RECURRENCE-ID/g)).toHaveLength(1);
	});

	it('moves one day to another, keeping the time zone of a phone-made series', () => {
		const ics = withOccurrence(FROM_PHONE, '2026-10-27', () => ({ date: '2026-10-28' }));
		expect(ics).toContain('RECURRENCE-ID;TZID=America/Toronto:20261027T090000');
		expect(days(occurrencesBetween(ics, '2026-10-26', '2026-11-01'))).toEqual(['2026-10-28']);
	});

	it('removes one day only', () => {
		const ics = withoutOccurrence(itemToICS(lift), '2026-10-19');
		expect(days(occurrencesBetween(ics, '2026-10-19', '2026-10-25'))).toEqual(['2026-10-22']);
	});

	it('keeps skipped days and one-off changes when the series itself is edited, and drops them when it stops repeating', () => {
		const renamed = itemToICS({ uid: 'phone-1', kind: 'event', title: 'Policy', date: '2026-10-06', time: '09:00', endTime: '10:00', state: 'open', recurrence: 'FREQ=WEEKLY' }, FROM_PHONE);
		expect(occurrencesBetween(renamed, '2026-10-12', '2026-10-25').map((i) => i.title)).toEqual(['Policy team (moved)']);
		const once = itemToICS({ uid: 'phone-1', kind: 'event', title: 'Policy', date: '2026-10-06', time: '09:00', state: 'open' }, FROM_PHONE);
		expect(once).not.toContain('RECURRENCE-ID');
		expect(once).not.toContain('EXDATE');
	});

	it('repeats a multi-day all-day event with the same length', () => {
		const camp: Item = { uid: 'r2', kind: 'event', title: 'Camp', date: '2026-10-02', endDate: '2026-10-04', state: 'open', recurrence: 'FREQ=MONTHLY' };
		const shown = occurrencesBetween(itemToICS(camp), '2026-11-03', '2026-11-05');
		expect(shown).toHaveLength(1);
		expect(shown[0]).toMatchObject({ date: '2026-11-02', endDate: '2026-11-04' });
	});

	it('repeats tasks too', () => {
		const bins: Item = { uid: 'r3', kind: 'task', title: 'Green cart', date: '2026-10-06', state: 'open', recurrence: 'FREQ=WEEKLY;INTERVAL=2' };
		expect(days(occurrencesBetween(itemToICS(bins), '2026-10-19', '2026-11-08'))).toEqual(['2026-10-20', '2026-11-03']);
	});
});

describe('occurrenceOn', () => {
	it('gives one day of a series as it stands: the series on a plain day, the one-off change on a changed one', () => {
		const ticked = withOccurrence(itemToICS(lift), '2026-10-08', () => ({ state: 'done' }));
		expect(occurrenceOn(ticked, '2026-10-05')).toMatchObject({ date: '2026-10-05', state: 'open', occurrence: '2026-10-05' });
		expect(occurrenceOn(ticked, '2026-10-08')).toMatchObject({ date: '2026-10-08', state: 'done', occurrence: '2026-10-08' });
	});
});

/** An event as another app might save it, with whatever repeat rule (and extra lines) it chose. */
const fromAnotherApp = (rule: string, extra = '') =>
	`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Some app//EN\r\nBEGIN:VEVENT\r\nUID:odd-1\r\nDTSTAMP:20261001T120000Z\r\nSUMMARY:Odd\r\nDTSTART:20261001T090000\r\nDTEND:20261001T093000\r\nRRULE:${rule}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('repeats the planner cannot sensibly show', () => {
	// Each of these would fill a page with thousands of showings, or repeat in a way that makes no sense,
	// so it is refused, and the page leaves the item out and counts it as one it couldn't read.
	it.each(['FREQ=SECONDLY', 'FREQ=MINUTELY', 'FREQ=HOURLY', 'FREQ=HOURLY;INTERVAL=6', 'FREQ=DAILY;INTERVAL=-2', 'FREQ=DAILY;INTERVAL=0', 'FREQ=WEEKLY;INTERVAL=1.5'])(
		'refuses %s',
		(rule) => {
			expect(() => occurrencesBetween(fromAnotherApp(rule), '2026-10-19', '2026-10-21')).toThrow();
		}
	);

	it('refuses a rule folded over two lines too', () => {
		const folded = fromAnotherApp('FREQ=DAILY;INTER\r\n VAL=-2');
		expect(() => occurrencesBetween(folded, '2026-10-19', '2026-10-21')).toThrow();
	});

	it('refuses a daily repeat that falls many times on each day', () => {
		const everyHour = 'FREQ=DAILY;BYHOUR=' + Array.from({ length: 24 }, (_, h) => h).join(',');
		expect(() => occurrencesBetween(fromAnotherApp(everyHour), '2026-10-19', '2026-10-21')).toThrow();
	});

	it('refuses a long list of extra days that crowds the page', () => {
		const rdates = Array.from({ length: 30 }, (_, m) => `20261020T${String(8 + Math.floor(m / 6)).padStart(2, '0')}${String((m % 6) * 10).padStart(2, '0')}00`).join(',');
		expect(() => occurrencesBetween(fromAnotherApp('FREQ=YEARLY', `RDATE:${rdates}\r\n`), '2026-10-19', '2026-10-21')).toThrow();
	});

	it('works it out quickly, not after building every second of the year', () => {
		const started = performance.now();
		expect(() => occurrencesBetween(fromAnotherApp('FREQ=SECONDLY'), '2026-10-19', '2026-10-21')).toThrow();
		expect(performance.now() - started).toBeLessThan(100);
	});

	it('still shows ordinary repeats: daily once a day, every other day, twice a day, monthly and yearly', () => {
		const range = ['2026-10-19', '2026-10-21'] as const;
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=DAILY'), ...range))).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=DAILY;INTERVAL=2'), ...range))).toEqual(['2026-10-19', '2026-10-21']);
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=DAILY;INTERVAL=+1'), ...range))).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
		expect(occurrencesBetween(fromAnotherApp('FREQ=DAILY;BYHOUR=9,17'), ...range)).toHaveLength(6);
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=MONTHLY'), '2026-11-01', '2026-11-03'))).toEqual(['2026-11-01']);
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=YEARLY'), '2027-10-01', '2027-10-01'))).toEqual(['2027-10-01']);
	});

	it('does not mind a time zone’s own yearly rules', () => {
		expect(days(occurrencesBetween(FROM_PHONE, '2026-10-26', '2026-10-28'))).toEqual(['2026-10-27']);
	});
});
