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
