import { describe, expect, it } from 'vitest';
import type { Item } from '$lib/item';
import { carriesCategory, icsToItems, itemToICS, occurrenceOn, withCategoryChanged, withDueDates, withOccurrence } from './ical';

const roundTrip = (item: Item) => icsToItems(itemToICS(item))[0];

describe('events', () => {
	it('keeps a timed event', () => {
		const item: Item = { uid: 'e1', kind: 'event', title: 'ADHD follow-up', date: '2026-10-19', time: '08:45', state: 'open' };
		expect(roundTrip(item)).toEqual({ ...item, endTime: '09:45' });
	});

	it('stamps an item with the time it was written, in UTC as the standard requires', () => {
		const ics = itemToICS({ uid: 'e0', kind: 'event', title: 'Stamp', date: '2026-10-19', state: 'open' });
		expect(ics).toMatch(/\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/);
	});

	it('keeps a multi-day all-day event and writes the exclusive end date the standard expects', () => {
		const item: Item = { uid: 'e2', kind: 'event', title: 'Cornwall Camp', date: '2026-10-19', endDate: '2026-10-21', state: 'open' };
		const ics = itemToICS(item);
		expect(ics).toContain('DTSTART;VALUE=DATE:20261019');
		expect(ics).toContain('DTEND;VALUE=DATE:20261022');
		expect(roundTrip(item)).toEqual(item);
	});

	it('records ticked and dropped events', () => {
		const base: Item = { uid: 'e3', kind: 'event', title: 'Policy team', date: '2026-10-20', time: '09:00', endTime: '10:00', state: 'open' };
		expect(roundTrip({ ...base, state: 'done' }).state).toBe('done');
		expect(itemToICS({ ...base, state: 'dropped' })).toContain('STATUS:CANCELLED');
		expect(roundTrip({ ...base, state: 'dropped' }).state).toBe('dropped');
	});

	it('keeps location, notes and a weekly repeat', () => {
		const item: Item = {
			uid: 'e4', kind: 'event', title: 'Lift', date: '2026-10-19', time: '06:30', endTime: '07:30',
			location: 'Gym', notes: 'Workout A', recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE', state: 'open'
		};
		expect(roundTrip(item)).toEqual(item);
	});

	it('refuses an event without a date', () => {
		expect(() => itemToICS({ uid: 'e5', kind: 'event', title: 'x', state: 'open' })).toThrow();
	});
});

describe('tasks', () => {
	it('keeps an undated task with its category, written by name', () => {
		const item: Item = { uid: 't1', kind: 'task', title: 'Fix piano keys', categories: ['Someday'], state: 'open' };
		const ics = itemToICS(item);
		expect(ics).toContain('BEGIN:VTODO');
		expect(ics).toContain('CATEGORIES:Someday');
		expect(ics).toContain('STATUS:NEEDS-ACTION');
		expect(ics).not.toContain('DTSTART');
		expect(roundTrip(item)).toEqual(item);
	});

	it('gives a timed task an alarm so phones can remind', () => {
		const item: Item = { uid: 't2', kind: 'task', title: 'Bag to truck', date: '2026-10-20', time: '17:00', state: 'open' };
		const ics = itemToICS(item);
		expect(ics).toContain('BEGIN:VALARM');
		expect(roundTrip(item)).toEqual(item);
	});

	it('records done with a completion time, and dropped as cancelled', () => {
		const base: Item = { uid: 't3', kind: 'task', title: 'Pick up meds', date: '2026-10-20', state: 'open' };
		const done = itemToICS({ ...base, state: 'done' });
		expect(done).toContain('STATUS:COMPLETED');
		expect(done).toContain('COMPLETED:');
		expect(roundTrip({ ...base, state: 'done' }).state).toBe('done');
		expect(roundTrip({ ...base, state: 'dropped' }).state).toBe('dropped');
	});

	it('writes the day as DUE too, so Apple Reminders shows it', () => {
		const allDay = itemToICS({ uid: 't5', kind: 'task', title: 'Call bank', date: '2026-10-22', state: 'open' });
		expect(allDay).toContain('DUE;VALUE=DATE:20261022');
		expect(allDay).toContain('DTSTART;VALUE=DATE:20261022');
		const timed = itemToICS({ uid: 't6', kind: 'task', title: 'Call bank', date: '2026-10-22', time: '09:30', state: 'open' });
		expect(timed).toContain('DUE:20261022T093000');
		const repeating: Item = { uid: 't7', kind: 'task', title: 'Bins', date: '2026-10-22', recurrence: 'FREQ=WEEKLY', state: 'open' };
		expect(itemToICS(repeating)).toContain('DUE;VALUE=DATE:20261022');
		const moved = withOccurrence(itemToICS(repeating), '2026-10-29', () => ({ date: '2026-10-30' }));
		expect(moved).toContain('DUE;VALUE=DATE:20261030');
	});

	it('reads the day from DUE when Reminders moved a task but left its start', () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r3', 'DTSTAMP:20261019T000000Z',
			'SUMMARY:Sheets', 'DTSTART;VALUE=DATE:20261021', 'DUE;VALUE=DATE:20261023', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		expect(icsToItems(ics)[0]).toMatchObject({ date: '2026-10-23' });
	});

	it('falls back to the start when another app wrote DUE as something other than a date', () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r4', 'DTSTAMP:20261019T000000Z',
			'SUMMARY:Sheets', 'DTSTART;VALUE=DATE:20261021', 'DUE;VALUE=PERIOD:20261023T090000/PT1H', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		expect(icsToItems(ics)[0]).toMatchObject({ date: '2026-10-21' });
	});

	it('remembers where a carried-over task came from', () => {
		const item: Item = { uid: 't4', kind: 'task', title: 'Book dentist', date: '2026-10-19', carriedFrom: '2026-10-18', state: 'open' };
		expect(roundTrip(item)).toEqual(item);
	});
});

describe('reading other apps\' data', () => {
	it('reads an undated task written by another app, with its categories', () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r1', 'DTSTAMP:20261019T000000Z',
			'SUMMARY:Green cart', 'STATUS:NEEDS-ACTION', 'CATEGORIES:Waiting', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		expect(icsToItems(ics)).toEqual([{ uid: 'r1', kind: 'task', title: 'Green cart', categories: ['Waiting'], state: 'open' }]);
	});

	it('reads the keys older planners wrote as names, and writes the names when saved again', () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r3', 'DTSTAMP:20261019T000000Z',
			'SUMMARY:Fix piano keys', 'CATEGORIES:month', 'CATEGORIES:Waiting', 'CATEGORIES:SOMEDAY', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		const [item] = icsToItems(ics);
		expect(item.categories).toEqual(['This month', 'Waiting', 'Someday']);
		const saved = itemToICS({ ...item, state: 'done' }, ics);
		expect(saved).toContain('CATEGORIES:This month,Waiting,Someday');
		expect(saved).not.toMatch(/CATEGORIES:month|SOMEDAY/);
	});

	it('keeps categories it does not know, from a phone say, as they are', () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r4', 'DTSTAMP:20261019T000000Z',
			'SUMMARY:Green cart', 'CATEGORIES:Home,Errands', 'CATEGORIES:waiting', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		const [item] = icsToItems(ics);
		expect(item.categories).toEqual(['Home', 'Errands', 'Waiting']);
		expect(icsToItems(itemToICS(item, ics))[0].categories).toEqual(['Home', 'Errands', 'Waiting']);
	});

	it("gives a ticked day of a repeating task the series' new categories, all of them", () => {
		const series: Item = { uid: 'r5', kind: 'task', title: 'Bins', date: '2026-10-19', categories: ['Home', 'This month'], state: 'open', recurrence: 'FREQ=WEEKLY' };
		const ticked = withOccurrence(itemToICS(series), '2026-10-26', () => ({ state: 'done' }));
		const recategorised = itemToICS({ ...series, categories: ['Waiting', 'Home'] }, ticked);
		expect(occurrenceOn(recategorised, '2026-10-26')).toMatchObject({ state: 'done', categories: ['Waiting', 'Home'] });
	});

	it("gives the ticked and moved days of an older repeating task (with keys, not names) the series' new category", () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r6', 'DTSTAMP:20261019T000000Z', 'SUMMARY:Bins',
			'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=DAILY;COUNT=5', 'CATEGORIES:month', 'CATEGORIES:Home', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		const ticked = withOccurrence(ics, '2026-10-20', () => ({ state: 'done' }));
		const moved = withOccurrence(ticked, '2026-10-21', () => ({ date: '2026-10-22' }));
		const [series] = icsToItems(moved);
		const changed = itemToICS({ ...series, categories: ['Someday', 'Home'] }, moved);
		expect(occurrenceOn(changed, '2026-10-20')).toMatchObject({ state: 'done', categories: ['Someday', 'Home'] });
		expect(occurrenceOn(changed, '2026-10-21')).toMatchObject({ date: '2026-10-22', categories: ['Someday', 'Home'] });
	});

	it('keeps a category a day was given for itself when the series changes', () => {
		const series: Item = { uid: 'r7', kind: 'task', title: 'Bins', date: '2026-10-19', categories: ['This month'], state: 'open', recurrence: 'FREQ=DAILY;COUNT=5' };
		const own = withOccurrence(itemToICS(series), '2026-10-20', () => ({ categories: ['Waiting'] }));
		const changed = itemToICS({ ...series, categories: ['Someday'] }, own);
		expect(occurrenceOn(changed, '2026-10-20')?.categories).toEqual(['Waiting']);
	});

	it('uses DUE as the day when a task has no start, as Apple Reminders writes it', () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r2', 'DTSTAMP:20261019T000000Z',
			'SUMMARY:Sheets', 'DUE;VALUE=DATE:20261021', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		expect(icsToItems(ics)[0]).toMatchObject({ date: '2026-10-21', state: 'open' });
	});
});

describe('changing a category on a stored task (rename or delete of a category)', () => {
	const doc = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//phone//EN', ...lines, 'END:VCALENDAR', ''].join('\r\n');
	const series = doc('BEGIN:VTIMEZONE', 'TZID:America/Toronto', 'BEGIN:STANDARD', 'DTSTART:20071104T020000', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE',
		'BEGIN:VTODO', 'UID:s1', 'DTSTAMP:20261019T000000Z', 'SUMMARY:Bins', 'DTSTART;TZID=America/Toronto:20261019T080000', 'RRULE:FREQ=DAILY;COUNT=5',
		'CATEGORIES:Home,waiting', 'X-PHONE-THING:kept', 'END:VTODO',
		'BEGIN:VTODO', 'UID:s1', 'DTSTAMP:20261019T000000Z', 'SUMMARY:Bins (late)', 'RECURRENCE-ID;TZID=America/Toronto:20261020T080000', 'DTSTART;TZID=America/Toronto:20261020T090000',
		'CATEGORIES:WAITING', 'CATEGORIES:Errands', 'END:VTODO');

	it('tells which tasks carry a category, old keys and any case included', () => {
		expect(carriesCategory(series, 'Waiting')).toBe(true);
		expect(carriesCategory(series, 'errands')).toBe(true);
		expect(carriesCategory(series, 'Someday')).toBe(false);
		expect(carriesCategory('not a calendar', 'Waiting')).toBe(false);
		const event = doc('BEGIN:VEVENT', 'UID:e1', 'DTSTAMP:20261019T000000Z', 'DTSTART:20261019T100000', 'SUMMARY:Board', 'CATEGORIES:Waiting', 'END:VEVENT');
		expect(carriesCategory(event, 'Waiting')).toBe(false);
	});

	it('renames it on the whole series, one-off changes included, and leaves everything else as it was', () => {
		const renamed = withCategoryChanged(series, 'Waiting', 'Waiting for')!;
		expect(renamed.replace(/\r\n /g, '').match(/^CATEGORIES:.*$/gm)).toEqual(['CATEGORIES:Home,Waiting for', 'CATEGORIES:Waiting for', 'CATEGORIES:Errands']);
		for (const kept of ['X-PHONE-THING:kept', 'TZID:America/Toronto', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Bins (late)', 'DTSTAMP:20261019T000000Z']) expect(renamed).toContain(kept);
		expect(occurrenceOn(renamed, '2026-10-20')).toMatchObject({ title: 'Bins (late)', categories: ['Waiting for', 'Errands'] });
	});

	it('moves it to another category without repeating that one, or takes it off', () => {
		const moved = withCategoryChanged(series, 'Waiting', 'errands')!;
		expect(moved.match(/^CATEGORIES:.*$/gm)).toEqual(['CATEGORIES:Home,errands', 'CATEGORIES:Errands']);
		expect(withCategoryChanged(doc('BEGIN:VTODO', 'UID:t', 'DTSTAMP:20261019T000000Z', 'SUMMARY:x', 'CATEGORIES:Waiting,waiting,Home', 'END:VTODO'), 'Waiting', 'Later')!.match(/^CATEGORIES:.*$/gm)).toEqual(['CATEGORIES:Later,Home']);
		const off = withCategoryChanged(series, 'waiting', undefined)!;
		expect(off.match(/^CATEGORIES:.*$/gm)).toEqual(['CATEGORIES:Home', 'CATEGORIES:Errands']);
	});

	it('changes only the spelling when a category changes its case', () => {
		expect(withCategoryChanged(series, 'Waiting', 'WAITING')!.match(/^CATEGORIES:.*$/gm)).toEqual(['CATEGORIES:Home,WAITING', 'CATEGORIES:WAITING', 'CATEGORIES:Errands']);
	});

	it('gives nothing back when no task carries the category, so nothing is saved', () => {
		expect(withCategoryChanged(series, 'Someday', 'Later')).toBeUndefined();
		expect(withCategoryChanged(doc('BEGIN:VTODO', 'UID:t', 'DTSTAMP:20261019T000000Z', 'SUMMARY:x', 'CATEGORIES:Later', 'END:VTODO'), 'Someday', 'Later')).toBeUndefined();
	});
});

describe('giving tasks saved before DUE was written their due date', () => {
	const doc = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', ...lines, 'END:VCALENDAR'].join('\r\n');

	it('copies the start to DUE on the series and each one-off change, time zone included, keeping everything else', () => {
		const ics = doc('BEGIN:VTODO', 'UID:o1', 'DTSTAMP:20261019T000000Z', 'SUMMARY:Bins', 'DTSTART;VALUE=DATE:20261019', 'RRULE:FREQ=WEEKLY',
			'X-PHONE-THING:keep', 'END:VTODO',
			'BEGIN:VTODO', 'UID:o1', 'DTSTAMP:20261019T000000Z', 'SUMMARY:Bins', 'RECURRENCE-ID;VALUE=DATE:20261026',
			'DTSTART;TZID=America/Halifax:20261027T080000', 'END:VTODO');
		const next = withDueDates(ics)!;
		expect(next).toContain('DUE;VALUE=DATE:20261019');
		expect(next).toContain('DUE;TZID=America/Halifax:20261027T080000');
		expect(next).toContain('X-PHONE-THING:keep');
		expect(icsToItems(next)[0]).toMatchObject({ date: '2026-10-19', recurrence: 'FREQ=WEEKLY' });
	});

	it('changes nothing for undated tasks, tasks with DUE or DURATION, and events', () => {
		expect(withDueDates(doc('BEGIN:VTODO', 'UID:o2', 'DTSTAMP:20261019T000000Z', 'SUMMARY:Someday', 'END:VTODO'))).toBeUndefined();
		expect(withDueDates(doc('BEGIN:VTODO', 'UID:o3', 'DTSTAMP:20261019T000000Z', 'DTSTART;VALUE=DATE:20261019', 'DUE;VALUE=DATE:20261020', 'END:VTODO'))).toBeUndefined();
		expect(withDueDates(doc('BEGIN:VTODO', 'UID:o4', 'DTSTAMP:20261019T000000Z', 'DTSTART:20261019T090000', 'DURATION:PT1H', 'END:VTODO'))).toBeUndefined();
		expect(withDueDates(doc('BEGIN:VEVENT', 'UID:o5', 'DTSTAMP:20261019T000000Z', 'DTSTART;VALUE=DATE:20261019', 'END:VEVENT'))).toBeUndefined();
	});
});
