// Dates are handled as local calendar days in YYYY-MM-DD form; no time zones involved.

const pad = (n: number) => String(n).padStart(2, '0');

export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromISODate = (s: string) => {
	const [y, m, d] = s.split('-').map(Number);
	return new Date(y, m - 1, d);
};

export const addDays = (s: string, n: number) => {
	const d = fromISODate(s);
	d.setDate(d.getDate() + n);
	return toISODate(d);
};

/** The planner has two pages a week, like the paper book: Mon–Wed and Thu–Sun. */
export function pageStart(s: string): string {
	const dow = fromISODate(s).getDay(); // 0 = Sunday
	const back = dow >= 1 && dow <= 3 ? dow - 1 : dow === 0 ? 3 : dow - 4;
	return addDays(s, -back);
}

export function pageDays(start: string): string[] {
	const length = fromISODate(start).getDay() === 1 ? 3 : 4;
	return Array.from({ length }, (_, i) => addDays(start, i));
}

export function flipPage(start: string, direction: 1 | -1): string {
	const isMonday = fromISODate(start).getDay() === 1;
	if (direction > 0) return addDays(start, isMonday ? 3 : 4);
	return addDays(start, isMonday ? -4 : -3);
}

/** The coming Saturday, or today if today is Saturday. */
export function comingSaturday(today: string): string {
	return addDays(today, (6 - fromISODate(today).getDay() + 7) % 7);
}
