// Run by repeat-ical.test.ts in a child process, so a rule that makes ical.js loop forever fails the test on a
// time limit instead of hanging the test run. Prints, for each rule given, whether the planner refused it.
import { occurrencesBetween } from './ical';

// Each argument is a rule, optionally followed by @ and the start (20261002T090000, say).
const event = (arg: string) => {
	const [rule, start = '20261001T090000'] = arg.split('@');
	return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:hang\r\nDTSTART:${start}\r\nRRULE:${rule}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
};

const results = process.argv.slice(2).map((rule) => {
	try {
		occurrencesBetween(event(rule), '2026-10-19', '2026-10-21');
		return 'shown';
	} catch {
		return 'refused';
	}
});
console.log(JSON.stringify(results));
