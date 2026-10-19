import { beforeAll, describe, expect, it } from 'vitest';
import { feedEventsBetween } from './feed';

// Outlook publishes times in its own time-zone names; the planner shows them in the household's time.
beforeAll(() => {
	process.env.TZ = 'America/Toronto';
});

const OUTLOOK = `BEGIN:VCALENDAR
METHOD:PUBLISH
PRODID:Microsoft Exchange Server 2010
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Pacific Standard Time
BEGIN:STANDARD
DTSTART:16010101T020000
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:econ
SUMMARY:Economic Modelling
DTSTART;TZID=Pacific Standard Time:20261020T060000
DTEND;TZID=Pacific Standard Time:20261020T070000
LOCATION:Room 4B
END:VEVENT
BEGIN:VEVENT
UID:standup
SUMMARY:Stand-up
DTSTART:20261019T140000Z
DTEND:20261019T141500Z
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
EXDATE:20261021T140000Z
END:VEVENT
BEGIN:VEVENT
UID:standup
RECURRENCE-ID:20261022T140000Z
SUMMARY:Stand-up (moved)
DTSTART:20261022T160000Z
DTEND:20261022T161500Z
END:VEVENT
BEGIN:VEVENT
UID:offsite
SUMMARY:Offsite
DTSTART;VALUE=DATE:20261021
DTEND;VALUE=DATE:20261023
END:VEVENT
BEGIN:VEVENT
UID:gone
SUMMARY:Cancelled review
STATUS:CANCELLED
DTSTART:20261020T170000Z
DTEND:20261020T180000Z
END:VEVENT
END:VCALENDAR
`;

const show = (from: string, to: string) =>
	feedEventsBetween(OUTLOOK, from, to, 'work')
		.map((i) => [i.date, i.time ?? 'all day', i.title])
		.sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`));

describe('reading a published work calendar', () => {
	it('shows each meeting at local time, read-only, with its place', () => {
		const [econ] = feedEventsBetween(OUTLOOK, '2026-10-20', '2026-10-20', 'work').filter((i) => i.title === 'Economic Modelling');
		expect(econ).toMatchObject({ kind: 'event', date: '2026-10-20', time: '09:00', endTime: '10:00', location: 'Room 4B', feed: 'work', state: 'open' });
	});

	it('repeats meetings, skips removed days, follows moved ones, and leaves out cancelled ones', () => {
		expect(show('2026-10-19', '2026-10-23')).toEqual([
			['2026-10-19', '10:00', 'Stand-up'],
			['2026-10-20', '09:00', 'Economic Modelling'],
			['2026-10-20', '10:00', 'Stand-up'],
			['2026-10-21', 'all day', 'Offsite'],
			['2026-10-22', '12:00', 'Stand-up (moved)'],
			['2026-10-23', '10:00', 'Stand-up']
		]);
	});

	it('gives every showing its own id, so a repeating meeting can sit on several days of one page', () => {
		const ids = feedEventsBetween(OUTLOOK, '2026-10-19', '2026-10-23', 'work').map((i) => i.uid);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('shows nothing outside the asked-for days', () => {
		expect(show('2026-09-01', '2026-09-30')).toEqual([]);
	});
});
