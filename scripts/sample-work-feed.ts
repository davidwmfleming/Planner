// Writes an Outlook-style published calendar (.ics) with work meetings around today, for trying the
// work calendar without a real feed. Usage: vite-node scripts/sample-work-feed.ts <file>
// Then set WORK_CALENDAR_URL=file:///absolute/path/to/that/file
import { writeFileSync } from 'node:fs';
import { addDays, toISODate } from '../src/lib/dates';

export function sampleWorkFeed(today: string): string {
	const d = (iso: string) => iso.replaceAll('-', '');
	const [t, t1] = [today, addDays(today, 1)];
	const event = (uid: string, title: string, day: string, start: string, end: string, extra = '') =>
		`BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${title}\r\nDTSTART;TZID=Eastern Standard Time:${d(day)}T${start}00\r\nDTEND;TZID=Eastern Standard Time:${d(day)}T${end}00\r\n${extra}DTSTAMP:20261001T120000Z\r\nEND:VEVENT\r\n`;
	return (
		'BEGIN:VCALENDAR\r\nMETHOD:PUBLISH\r\nPRODID:Microsoft Exchange Server 2010\r\nVERSION:2.0\r\nX-WR-CALNAME:Calendar\r\n' +
		'BEGIN:VTIMEZONE\r\nTZID:Eastern Standard Time\r\nBEGIN:STANDARD\r\nDTSTART:16010101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nRRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11\r\nEND:STANDARD\r\n' +
		'BEGIN:DAYLIGHT\r\nDTSTART:16010101T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nRRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\n' +
		event('work-econ', 'Economic Modelling', t, '0900', '1000', 'LOCATION:Room 4B\r\n') +
		event('work-standup', 'Team stand-up', t, '1000', '1015', 'RRULE:FREQ=DAILY;COUNT=10\r\n') +
		event('work-cancelled', 'Budget review (cancelled)', t1, '1300', '1400', 'STATUS:CANCELLED\r\n') +
		'END:VCALENDAR\r\n'
	);
}

if (process.argv[2]) {
	writeFileSync(process.argv[2], sampleWorkFeed(toISODate(new Date())));
	console.log(`Wrote a sample work calendar to ${process.argv[2]}`);
}
