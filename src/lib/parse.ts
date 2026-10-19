// Turns one written line into a title and an optional start time, the way David writes in the paper book:
// "9am Dentist", "845 ADHD follow-up", "2:30pm Call", "8 - Terry Fox", "Pick up meds".

const pad = (n: number) => String(n).padStart(2, '0');

export interface ParsedLine {
	title: string;
	/** HH:MM, 24-hour, when the line starts with a time. */
	time?: string;
}

export function parseLine(text: string): ParsedLine {
	const line = text.trim();
	const m = line.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?(?=\s|$)\s*[-–]?\s*(.*)$/i);
	if (!m || !m[4]) return { title: line };
	let hour = Number(m[1]);
	const minute = m[2] ? Number(m[2]) : 0;
	const meridiem = (m[3] ?? '').toLowerCase()[0];
	if (hour > 23 || minute > 59) return { title: line };
	if (meridiem === 'p' && hour < 12) hour += 12;
	if (meridiem === 'a' && hour === 12) hour = 0;
	// Without am/pm, 1–6 means afternoon: nobody books "3 Kids pickup" at 3 a.m.
	if (!meridiem && hour >= 1 && hour <= 6) hour += 12;
	return { title: m[4].trim(), time: `${pad(hour)}:${pad(minute)}` };
}
