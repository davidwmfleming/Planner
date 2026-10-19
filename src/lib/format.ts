const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];

const parts = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	return { y, m, d, dow: new Date(y, m - 1, d).getDay() };
};

export const dayLetter = (date: string) => DOW[parts(date).dow];
export const dayNumber = (date: string) => parts(date).d;
export const monthShort = (date: string) => MONTHS[parts(date).m - 1].slice(0, 3);
export const monthYear = (date: string) => `${MONTHS[parts(date).m - 1]} ${parts(date).y}`;

/** "08:45" → "8:45 am" */
export function formatTime(time?: string): string {
	if (!time) return '';
	const [h, m] = time.split(':').map(Number);
	return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
