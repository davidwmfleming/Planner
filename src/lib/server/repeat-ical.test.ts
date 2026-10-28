import { spawnSync } from 'node:child_process';
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import type { Item } from '$lib/item';
import { addDays as addDaysTo } from '$lib/dates';
import { itemToICS, occurrenceOn, occurrencesBetween, pageStepBudget, withOccurrence, withoutOccurrence } from './ical';

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

	it('repeats every few months on the 4th Thursday, years later too, and skips months without a 31st', () => {
		const club: Item = { uid: 'r4', kind: 'event', title: 'Book club', date: '2026-10-22', time: '19:00', state: 'open', recurrence: 'FREQ=MONTHLY;INTERVAL=2;BYDAY=4TH' };
		expect(days(occurrencesBetween(itemToICS(club), '2026-10-01', '2027-04-30'))).toEqual(['2026-10-22', '2026-12-24', '2027-02-25', '2027-04-22']);
		expect(days(occurrencesBetween(itemToICS(club), '2030-01-01', '2030-12-31'))).toEqual(['2030-02-28', '2030-04-25', '2030-06-27', '2030-08-22', '2030-10-24', '2030-12-26']);
		const rent: Item = { uid: 'r5', kind: 'task', title: 'Rent', date: '2026-10-31', state: 'open', recurrence: 'FREQ=MONTHLY' };
		expect(days(occurrencesBetween(itemToICS(rent), '2026-10-01', '2027-03-31'))).toEqual(['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31']);
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
	it.each([
		'FREQ=SECONDLY',
		'FREQ=MINUTELY',
		'FREQ=HOURLY',
		'FREQ=HOURLY;INTERVAL=6',
		'FREQ=DAILY;INTERVAL=-2',
		'FREQ=DAILY;INTERVAL=0',
		'FREQ=WEEKLY;INTERVAL=1.5',
		'INTERVAL=2',
		'FREQ=DAILY;FREQ=WEEKLY',
		'FREQ=DAILY;SOMETHING=1',
		'FREQ=DAILY;COUNT=0',
		'FREQ=DAILY;UNTIL=soon',
		'FREQ=DAILY;BYHOUR=9,17',
		'FREQ=DAILY;BYMINUTE=0',
		'FREQ=DAILY;BYSECOND=0',
		'FREQ=YEARLY;BYYEARDAY=100',
		'FREQ=YEARLY;BYWEEKNO=20',
		'FREQ=DAILY;BYMONTH=2',
		'FREQ=DAILY;BYDAY=1MO',
		'FREQ=WEEKLY;BYDAY=2MO',
		'FREQ=WEEKLY;BYMONTHDAY=3',
		'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30',
		'FREQ=MONTHLY;BYMONTHDAY=32',
		'FREQ=MONTHLY;BYMONTHDAY=0',
		'FREQ=MONTHLY;BYDAY=6MO',
		'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=6',
		'FREQ=MONTHLY;BYSETPOS=1',
		'FREQ=MONTHLY;BYDAY=1FR;BYMONTHDAY=13',
		'FREQ=YEARLY;BYMONTH=13',
		'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
		'FREQ=YEARLY;BYMONTH=2,4;BYMONTHDAY=31',
		'FREQ=YEARLY;BYMONTH=2;BYDAY=MO;BYSETPOS=6',
		'FREQ=YEARLY;BYDAY=20MO',
		'FREQ=YEARLY;BYMONTHDAY=15',
		'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=13;BYDAY=FR',
		// Rules that, from some starts, never fall on any day at all.
		'FREQ=DAILY;INTERVAL=14;BYDAY=MO',
		'FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=31',
		'FREQ=MONTHLY;INTERVAL=24;BYDAY=5MO',
		'FREQ=MONTHLY;INTERVAL=12;BYDAY=MO;BYSETPOS=-5',
		'FREQ=MONTHLY;INTERVAL=2;BYDAY=FR;BYMONTHDAY=13',
		'FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29',
		'FREQ=YEARLY;INTERVAL=28;BYMONTH=3;BYDAY=5MO'
	])(
		'refuses %s',
		(rule) => {
			expect(() => occurrencesBetween(fromAnotherApp(rule), '2026-10-19', '2026-10-21')).toThrow();
		}
	);

	it('refuses a rule folded over two lines too', () => {
		const folded = fromAnotherApp('FREQ=DAILY;INTER\r\n VAL=-2');
		expect(() => occurrencesBetween(folded, '2026-10-19', '2026-10-21')).toThrow();
	});

	it('refuses, rather than hangs on, rules ical.js would work on forever', () => {
		// Each would hang the server inside a single step of ical.js, so it is run apart, with a time limit.
		const hanging = [
			'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
			'FREQ=DAILY;BYYEARDAY=366;BYMONTH=1',
			'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30',
			'FREQ=DAILY;BYDAY=1MO',
			'FREQ=YEARLY;BYMONTH=2;BYDAY=MO;BYSETPOS=6',
			// Starts on a Thursday, so every 7th day is a Thursday too, never a Monday or Tuesday.
			'FREQ=DAILY;INTERVAL=7;BYDAY=MO,TU'
		];
		// Stopped outright at the limit: a process stuck inside ical.js doesn't stop when asked politely.
		const run = spawnSync('node_modules/.bin/vite-node', ['--config', 'scripts/vite-node.config.ts', 'src/lib/server/repeat-hang.fixture.ts', ...hanging], {
			encoding: 'utf8',
			timeout: 20_000,
			killSignal: 'SIGKILL'
		});
		expect(run.error, 'finished within the time limit').toBeUndefined();
		expect(JSON.parse(run.stdout.trim().split('\n').at(-1)!)).toEqual(hanging.map(() => 'refused'));
	}, 30_000);

	it('refuses a long list of extra days that crowds the page', () => {
		const rdates = Array.from({ length: 30 }, (_, m) => `20261020T${String(8 + Math.floor(m / 6)).padStart(2, '0')}${String((m % 6) * 10).padStart(2, '0')}00`).join(',');
		expect(() => occurrencesBetween(fromAnotherApp('FREQ=YEARLY', `RDATE:${rdates}\r\n`), '2026-10-19', '2026-10-21')).toThrow();
	});

	it('passes over empty parts, as a trailing semicolon leaves', () => {
		const range = ['2026-10-19', '2026-10-25'] as const;
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=WEEKLY;BYDAY=MO;'), ...range))).toEqual(['2026-10-19']);
		expect(days(occurrencesBetween(fromAnotherApp(';FREQ=WEEKLY;;BYDAY=MO,TH'), ...range))).toEqual(['2026-10-19', '2026-10-22']);
	});

	it('refuses a document listing more than 2,000 skipped and extra days, counted across lines, folded or not', () => {
		const day = (n: number) => {
			const d = new Date(Date.UTC(2000, 0, 1) + n * 86_400_000);
			return `${d.toISOString().slice(0, 10).replaceAll('-', '')}T090000`;
		};
		const list = (from: number, count: number) => Array.from({ length: count }, (_, n) => day(from + n)).join(',');
		// 1,000 skipped days on one line, folded every 70 characters, and 1,001 extra days over two lines.
		const folded = `EXDATE:${list(0, 1000)}`.replace(/(.{70})/g, '$1\r\n ');
		const flood = `${folded}\r\nRDATE:${list(3000, 500)}\r\nRDATE;VALUE=DATE-TIME:${list(4000, 501)}\r\n`;
		expect(() => occurrencesBetween(fromAnotherApp('FREQ=DAILY', flood), '2026-10-19', '2026-10-21')).toThrow(/more than 2000/);
		// One more than allowed tips it over; exactly 2,000 is still shown.
		const atLimit = `EXDATE:${list(0, 1000)}\r\nEXDATE:${list(1000, 1000)}\r\n`;
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=DAILY', atLimit), '2026-10-19', '2026-10-21'))).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
		expect(() => occurrencesBetween(fromAnotherApp('FREQ=DAILY', `${atLimit}RDATE:${day(5000)}\r\n`), '2026-10-19', '2026-10-21')).toThrow(/more than 2000/);
	});

	it('passes over an app’s own X- parts, as Evolution writes', () => {
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=WEEKLY;BYDAY=MO;X-EVOLUTION-ENDDATE=20271231T120000Z'), '2026-10-19', '2026-10-25'))).toEqual(['2026-10-19']);
	});

	it('works it out quickly, not after building every second of the year', () => {
		const started = performance.now();
		expect(() => occurrencesBetween(fromAnotherApp('FREQ=SECONDLY'), '2026-10-19', '2026-10-21')).toThrow();
		expect(performance.now() - started).toBeLessThan(100);
	});

	it('still shows ordinary repeats: daily once a day, every other day, monthly and yearly', () => {
		const range = ['2026-10-19', '2026-10-21'] as const;
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=DAILY'), ...range))).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=DAILY;INTERVAL=2'), ...range))).toEqual(['2026-10-19', '2026-10-21']);
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=DAILY;INTERVAL=+1'), ...range))).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=MONTHLY'), '2026-11-01', '2026-11-03'))).toEqual(['2026-11-01']);
		expect(days(occurrencesBetween(fromAnotherApp('FREQ=YEARLY'), '2027-10-01', '2027-10-01'))).toEqual(['2027-10-01']);
	});

	// The shapes iPhone and Mac Calendar's Custom repeat writes, and Google's and Outlook's.
	it.each([
		['every weekday, as a daily rule', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', '2026-10-23', '2026-10-27', ['2026-10-23', '2026-10-26', '2026-10-27']],
		['every 2 weeks on Monday and Thursday', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=SU', '2026-10-01', '2026-10-16', ['2026-10-01', '2026-10-12', '2026-10-15']],
		['monthly on the 3rd and 15th', 'FREQ=MONTHLY;BYMONTHDAY=3,15', '2026-11-01', '2026-11-30', ['2026-11-03', '2026-11-15']],
		['monthly on the last day', 'FREQ=MONTHLY;BYMONTHDAY=-1', '2026-11-01', '2026-11-30', ['2026-11-30']],
		['every 2nd Tuesday of the month', 'FREQ=MONTHLY;BYDAY=2TU', '2026-11-01', '2026-11-30', ['2026-11-10']],
		['the last Friday of the month', 'FREQ=MONTHLY;BYDAY=-1FR', '2026-11-01', '2026-11-30', ['2026-11-27']],
		['the last weekday of the month', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2026-11-01', '2026-11-30', ['2026-11-30']],
		['the first weekend day of the month', 'FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1', '2026-11-01', '2026-11-30', ['2026-11-01']],
		['yearly on 3 March', 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=3', '2027-03-01', '2027-03-31', ['2027-03-03']],
		['yearly in March, on the start day', 'FREQ=YEARLY;BYMONTH=3', '2027-03-01', '2027-03-31', ['2027-03-01']],
		['yearly on the 2nd Sunday of March', 'FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', '2027-03-01', '2027-03-31', ['2027-03-14']],
		['yearly on the 2nd Sunday of March, by position', 'FREQ=YEARLY;BYMONTH=3;BYDAY=SU;BYSETPOS=2', '2027-03-01', '2027-03-31', ['2027-03-14']],
		['daily, five times', 'FREQ=DAILY;COUNT=5', '2026-10-04', '2026-10-08', ['2026-10-04', '2026-10-05']],
		['weekly until a day', 'FREQ=WEEKLY;UNTIL=20261015T235959Z', '2026-10-01', '2026-10-31', ['2026-10-01', '2026-10-08', '2026-10-15']]
	] as const)('still shows %s', (_, rule, from, to, expected) => {
		expect(days(occurrencesBetween(fromAnotherApp(rule), from, to))).toEqual(expected);
	});

	it('does not mind a time zone’s own yearly rules', () => {
		expect(days(occurrencesBetween(FROM_PHONE, '2026-10-26', '2026-10-28'))).toEqual(['2026-10-27']);
	});
});

/** Every showing ical.js works out by stepping through every repeat from the start: slow, but surely right. */
function everyStep(ics: string, from: string, to: string) {
	const comp = new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!;
	const expansion = new ICAL.RecurExpansion({ component: comp, dtstart: comp.getFirstPropertyValue('dtstart') as ICAL.Time });
	const found: string[] = [];
	for (let next = expansion.next(); next; next = expansion.next()) {
		const day = next.toString().slice(0, 10);
		if (day > to) break;
		if (day >= from) found.push(day);
	}
	return found;
}

const longAgo = (rule: string, start = '19700105T090000', extra = '') =>
	`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:old\r\nSUMMARY:Old\r\nDTSTART:${start}\r\nRRULE:${rule}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('items that started long ago', () => {
	// Started decades back, so a page far on skips ahead rather than stepping through every day since.
	it.each([
		['FREQ=DAILY', '19700101T090000'],
		['FREQ=DAILY;INTERVAL=3', '19700101T090000'],
		['FREQ=DAILY;INTERVAL=3;BYDAY=MO,TU', '19700102T090000'],
		['FREQ=DAILY;BYDAY=MO,WE,FR', '19700101T090000'],
		['FREQ=WEEKLY', '19700101T090000'],
		['FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,TH,SU', '19700101T090000'],
		['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;WKST=SU', '19991231T090000'],
		['FREQ=DAILY;COUNT=20678', '19700101T090000'],
		['FREQ=DAILY;COUNT=20682', '19700101T090000'],
		['FREQ=DAILY;INTERVAL=2;COUNT=10340', '19700101T090000'],
		['FREQ=WEEKLY;INTERVAL=2;COUNT=1478', '19700101T090000'],
		['FREQ=DAILY;UNTIL=20261020T090000', '19700101T090000'],
		['FREQ=DAILY;UNTIL=99991231T235959Z', '19700101T090000'],
		['FREQ=DAILY;BYDAY=TU,TH;COUNT=300', '19700101T090000'],
		['FREQ=MONTHLY', '19700131T090000'],
		['FREQ=MONTHLY;INTERVAL=5;BYDAY=2TU', '19700101T090000'],
		['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '19700101T090000'],
		['FREQ=MONTHLY;INTERVAL=7;BYMONTHDAY=31,-30', '19700101T090000'],
		['FREQ=MONTHLY;BYDAY=MO,TH', '20000229T090000'],
		['FREQ=YEARLY;INTERVAL=3', '19700101T090000'],
		['FREQ=YEARLY', '19720229T090000'],
		['FREQ=YEARLY;BYMONTH=10;BYDAY=-1MO', '19700101T090000'],
		['FREQ=YEARLY;BYMONTH=9,10;BYDAY=SA,SU;BYSETPOS=1,-1', '19700101T090000']
	])('shows %s (from %s) on the same days as stepping through every one', (rule, start) => {
		for (const [from, to] of [['2026-10-19', '2026-10-31'], ['2028-02-26', '2028-03-03']]) {
			expect(days(occurrencesBetween(longAgo(rule, start), from, to)), `${from}..${to}`).toEqual(everyStep(longAgo(rule, start), from, to));
		}
	});

	it('keeps skipped days and one-off changes', () => {
		const ics = longAgo('FREQ=DAILY', '19700101T090000', 'EXDATE:20261020T090000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:old\r\nRECURRENCE-ID:20261021T090000\r\nSUMMARY:Old (moved)\r\nDTSTART:20261021T150000\r\n');
		expect(occurrencesBetween(ics, '2026-10-19', '2026-10-21').map((i) => [i.date, i.time, i.seriesStart])).toEqual([
			['2026-10-19', '09:00', '1970-01-01'],
			['2026-10-21', '15:00', '1970-01-01']
		]);
	});

	it('works out ten daily items from 1970, one that never ends and one with a huge count, well within a second', () => {
		const budget = pageStepBudget();
		const items = [...Array.from({ length: 10 }, () => longAgo('FREQ=DAILY')), longAgo('FREQ=DAILY;UNTIL=99991231T235959Z'), longAgo('FREQ=DAILY;COUNT=999999999')];
		const started = performance.now();
		for (const ics of items) expect(days(occurrencesBetween(ics, '2026-10-19', '2026-10-21', budget))).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
		expect(performance.now() - started).toBeLessThan(250);
	});

	it('gives up on, rather than slowly works out, an item with too many repeats before the page', () => {
		// Weekdays and a count can't be skipped ahead safely, so this one is stepped through, up to a limit.
		const started = performance.now();
		expect(() => occurrencesBetween(longAgo('FREQ=DAILY;BYDAY=TU,TH;COUNT=999999999'), '2026-10-19', '2026-10-21')).toThrow();
		expect(performance.now() - started).toBeLessThan(500);
	});

	it('shares one budget across a page, so many slow items cannot add up', () => {
		const budget = { steps: 100 };
		// Weekdays and a count: stepped through from 2020, which takes more than 100 steps.
		expect(() => occurrencesBetween(longAgo('FREQ=DAILY;BYDAY=TU,TH;COUNT=999', '20200101T090000'), '2026-10-19', '2026-10-21', budget)).toThrow();
		expect(budget.steps).toBeLessThanOrEqual(0);
		// The next item on the same page has none left.
		expect(() => occurrencesBetween(fromAnotherApp('FREQ=DAILY'), '2026-10-19', '2026-10-21', budget)).toThrow();
		expect(occurrencesBetween(fromAnotherApp('FREQ=DAILY'), '2026-10-19', '2026-10-21', pageStepBudget())).toHaveLength(3);
	});
});

/** The time zone part of FROM_PHONE, as iPhone and Google write it into each document. */
const TORONTO = FROM_PHONE.slice(FROM_PHONE.indexOf('BEGIN:VTIMEZONE'), FROM_PHONE.indexOf('END:VTIMEZONE') + 'END:VTIMEZONE\n'.length);
/** A series in Toronto time, as iPhone saves one: its own skipped days and moved days are in Toronto time too. */
const inToronto = (start: string, rule: string, extra = '', after = '') =>
	`BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Apple Inc.//iPhone OS 18//EN\n${TORONTO}BEGIN:VEVENT\nUID:tz-1\nDTSTAMP:20261001T120000Z\nSUMMARY:Swim\nDTSTART;TZID=America/Toronto:${start}\nDTEND;TZID=America/Toronto:${start.slice(0, 9)}235900\nRRULE:${rule}\n${extra}END:VEVENT\n${after}END:VCALENDAR\n`;
const movedInToronto = (from: string, to: string) =>
	`BEGIN:VEVENT\nUID:tz-1\nDTSTAMP:20261002T120000Z\nRECURRENCE-ID;TZID=America/Toronto:${from}\nSUMMARY:Swim (moved)\nDTSTART;TZID=America/Toronto:${to}\nDTEND;TZID=America/Toronto:${to.slice(0, 9)}235900\nEND:VEVENT\n`;

describe('series in a time zone, worked out from a later start', () => {
	// The page is weeks after the start, so the planner skips ahead; skipped and moved days must still be found.
	const swim = inToronto('20261026T163000', 'FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=America/Toronto:20261116T163000\n', movedInToronto('20261109T163000', '20261110T173000'));

	it('keeps a day deleted on the phone deleted', () => {
		expect(days(occurrencesBetween(swim, '2026-11-16', '2026-11-18'))).toEqual([]);
		expect(days(occurrencesBetween(swim, '2026-11-23', '2026-11-25'))).toEqual(['2026-11-23']);
	});

	it('shows a day moved on the phone once, on its new day', () => {
		expect(occurrencesBetween(swim, '2026-11-09', '2026-11-11').map((i) => [i.date, i.time, i.title, i.occurrence])).toEqual([['2026-11-10', '17:30', 'Swim (moved)', '2026-11-09']]);
	});

	it.each([
		['weekly since 2015', inToronto('20150105T163000', 'FREQ=WEEKLY', 'EXDATE;TZID=America/Toronto:20261123T163000\n'), '2026-11-23', '2026-11-30'],
		['weekly since 2015, with a count', inToronto('20150105T163000', 'FREQ=WEEKLY;COUNT=1000', 'EXDATE;TZID=America/Toronto:20261123T163000\n'), '2026-11-23', '2026-11-30'],
		['daily since 2015, on weekdays', inToronto('20150101T061500', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'EXDATE;TZID=America/Toronto:20261124T061500\n'), '2026-11-24', '2026-11-25'],
		['monthly since 2015', inToronto('20150123T090000', 'FREQ=MONTHLY', 'EXDATE;TZID=America/Toronto:20261123T090000\n'), '2026-11-23', '2026-12-23']
	])('keeps a skipped day skipped in a series %s', (_, ics, skipped, next) => {
		expect(days(occurrencesBetween(ics, skipped, skipped))).toEqual([]);
		expect(days(occurrencesBetween(ics, next, next))).toEqual([next]);
	});

	it('keeps a day deleted here deleted', () => {
		const deleted = withoutOccurrence(swim, '2026-11-30');
		expect(deleted).toContain('EXDATE;TZID=America/Toronto:20261130T163000');
		expect(days(occurrencesBetween(deleted, '2026-11-30', '2026-12-02'))).toEqual([]);
		expect(days(occurrencesBetween(deleted, '2026-12-07', '2026-12-09'))).toEqual(['2026-12-07']);
		// Its earlier skipped and moved days are still as they were.
		expect(days(occurrencesBetween(deleted, '2026-11-16', '2026-11-18'))).toEqual([]);
		expect(days(occurrencesBetween(deleted, '2026-11-09', '2026-11-11'))).toEqual(['2026-11-10']);
	});

	// Checked against stepping through every repeat from the start, with the same skipped and moved days.
	it.each([
		['FREQ=WEEKLY;BYDAY=MO', '20150105T163000'],
		['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=SU', '20150105T163000'],
		['FREQ=WEEKLY;COUNT=1000', '20150105T163000'],
		['FREQ=DAILY;INTERVAL=3', '20150101T061500'],
		['FREQ=DAILY;COUNT=5000', '20150101T061500'],
		['FREQ=MONTHLY;BYDAY=2TU', '20150113T190000'],
		['FREQ=YEARLY;BYMONTH=11;BYDAY=-1MO', '20151130T090000']
	])('shows %s (from %s) as stepping through every one would', (rule, start) => {
		const firstPass = everyStep(inToronto(start, rule), '2026-10-01', '2027-01-31');
		// Skip every third showing, and move the one after each to the next day.
		const skipped = firstPass.filter((_, n) => n % 3 === 0);
		const movedFrom = firstPass.filter((_, n) => n % 3 === 1);
		const time = start.slice(8);
		const ics = inToronto(
			start,
			rule,
			skipped.map((d) => `EXDATE;TZID=America/Toronto:${d.replaceAll('-', '')}${time}\n`).join(''),
			movedFrom.map((d) => movedInToronto(`${d.replaceAll('-', '')}${time}`, `${addDaysTo(d, 1).replaceAll('-', '')}T120000`)).join('')
		);
		const want = (from: string, to: string) =>
			[...everyStep(inToronto(start, rule), from, to).filter((d) => !skipped.includes(d) && !movedFrom.includes(d)), ...movedFrom.map((d) => addDaysTo(d, 1)).filter((d) => d >= from && d <= to)].sort();
		for (const [from, to] of [['2026-10-19', '2026-10-31'], ['2026-11-09', '2026-11-25'], ['2026-12-28', '2027-01-10']]) {
			expect(days(occurrencesBetween(ics, from, to)), `${from}..${to}`).toEqual(want(from, to));
		}
	});
});
