// Turns one written line into a title and an optional start time, the way David writes in the paper book:
// "9am Dentist", "845 ADHD follow-up", "2:30pm Call", "8 - Terry Fox", "Pick up meds".
// An @tag can name the calendar or list it goes in: "9am Standup @Work".

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

/** A calendar name as an @tag is matched to it: case, spaces and punctuation aside, so @MorganMeals finds "Morgan Meals". */
const tagKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The calendar a line names with an @tag ("@Work Team lunch", "Call bank @home"), and the line without that tag.
 * The first tag that matches one of the given calendars wins. A tag that matches none stays in the line as written,
 * and no calendar is given, so the item goes where new items go.
 */
export function takeCalendarTag<T extends { name: string }>(text: string, calendars: T[]): { text: string; calendar?: T } {
	// Each calendar's key, worked out once: a long line can hold many tags. The first calendar with a key keeps it.
	const byKey = new Map<string, T>();
	for (const c of calendars) if (!byKey.has(tagKey(c.name))) byKey.set(tagKey(c.name), c);
	for (const m of text.matchAll(/(^|\s)@(\S+)/g)) {
		const key = tagKey(m[2]);
		const calendar = key ? byKey.get(key) : undefined;
		if (!calendar) continue;
		const start = m.index + m[1].length;
		return { text: `${text.slice(0, start)} ${text.slice(start + m[2].length + 1)}`.replace(/\s+/g, ' ').trim(), calendar };
	}
	return { text };
}
