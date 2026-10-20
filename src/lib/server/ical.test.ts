import { describe, expect, it } from 'vitest';
import type { Item } from '$lib/item';
import { icsToItems, itemToICS } from './ical';

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
	it('keeps an undated task with its list label', () => {
		const item: Item = { uid: 't1', kind: 'task', title: 'Fix piano keys', label: 'someday', state: 'open' };
		const ics = itemToICS(item);
		expect(ics).toContain('BEGIN:VTODO');
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

	it('remembers where a carried-over task came from', () => {
		const item: Item = { uid: 't4', kind: 'task', title: 'Book dentist', date: '2026-10-19', carriedFrom: '2026-10-18', state: 'open' };
		expect(roundTrip(item)).toEqual(item);
	});
});

describe('reading other apps\' data', () => {
	it('reads an undated task written by another app, with its label', () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r1', 'DTSTAMP:20261019T000000Z',
			'SUMMARY:Green cart', 'STATUS:NEEDS-ACTION', 'CATEGORIES:Waiting', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		expect(icsToItems(ics)).toEqual([{ uid: 'r1', kind: 'task', title: 'Green cart', label: 'waiting', state: 'open' }]);
	});

	it('uses DUE as the day when a task has no start, as Apple Reminders writes it', () => {
		const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x', 'BEGIN:VTODO', 'UID:r2', 'DTSTAMP:20261019T000000Z',
			'SUMMARY:Sheets', 'DUE;VALUE=DATE:20261021', 'END:VTODO', 'END:VCALENDAR'].join('\r\n');
		expect(icsToItems(ics)[0]).toMatchObject({ date: '2026-10-21', state: 'open' });
	});
});
