const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const parts = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	return { y, m, d, dow: new Date(y, m - 1, d).getDay() };
};

export const dayLetter = (date: string) => DOW[parts(date).dow];
export const dayName = (date: string) => DAYS[parts(date).dow];
export const dayNumber = (date: string) => parts(date).d;
export const monthShort = (date: string) => MONTHS[parts(date).m - 1].slice(0, 3);
export const monthYear = (date: string) => `${MONTHS[parts(date).m - 1]} ${parts(date).y}`;

/** The week's number, counted from Monday; week 1 is the one holding the year's first Thursday (as printed diaries do). */
export function weekNumber(date: string): number {
	const { y, m, d, dow } = parts(date);
	// The Thursday of this week decides which year the week belongs to.
	const thursday = Date.UTC(y, m - 1, d + 3 - ((dow + 6) % 7));
	const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
	return Math.floor((thursday - yearStart) / 86_400_000 / 7) + 1;
}

/** "Week 43 · Monday to Wednesday": the line under the month in the page header. */
export function pageSubtitle(dates: string[]): string {
	if (!dates.length) return '';
	const first = dayName(dates[0]);
	const last = dayName(dates[dates.length - 1]);
	return `Week ${weekNumber(dates[0])} · ${first === last ? first : `${first} to ${last}`}`;
}

/** "08:45" → "8:45 am" */
export function formatTime(time?: string): string {
	if (!time) return '';
	const [h, m] = time.split(':').map(Number);
	return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** What a person sees as letters: an emoji family, a flag or a letter with a separately typed accent counts as one. */
export const letters = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);

/** Whether a message asks for a reload ("reload the page", "before reloading"…). Those get a Reload button:
 * the installed app has no browser controls. */
export const saysReload = (message: string) => /\breload/i.test(message);

/** A title as quoted in a message: long ones are cut to about 40 characters, so the message stays short on a phone. */
export function shortTitle(title: string, most = 40): string {
	const chars = letters(title.trim());
	return chars.length <= most ? chars.join('') : `${chars.slice(0, most - 1).join('').trimEnd()}…`;
}
