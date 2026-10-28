// The repeat choices offered in the details sheet, and the standard RRULE each one is saved as.
export const REPEATS = [
	{ value: '', name: 'Does not repeat', rule: undefined },
	{ value: 'daily', name: 'Every day', rule: 'FREQ=DAILY' },
	{ value: 'weekdays', name: 'Every weekday', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
	{ value: 'weekly', name: 'Every week', rule: 'FREQ=WEEKLY' },
	{ value: 'fortnightly', name: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
	// Every month or every few months, on the same date or the same weekday: see monthlyRule.
	{ value: 'monthly', name: 'Monthly', rule: 'FREQ=MONTHLY' },
	{ value: 'yearly', name: 'Every year', rule: 'FREQ=YEARLY' }
] as const;

/** Most months between showings that the sheet offers. */
export const MOST_MONTHS = 99;

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['1st', '2nd', '3rd', '4th'];

/** Where a date falls in its month: which of its weekday it is (1–5), and whether it is the last one. */
function placeInMonth(date: string) {
	const [y, m, d] = date.split('-').map(Number);
	const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return { day: d, weekday, nth: Math.ceil(d / 7), last: d + 7 > length };
}

const dayName = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;

/**
 * The ways a monthly repeat starting on `date` can fall: on that date ("the 31st"), on that weekday of the month
 * ("the 4th Thursday"), and, for the last such weekday, "the last Thursday". A 5th weekday is offered only as the
 * last one, as most months have no 5th. Months without the date (a 31st) are skipped, as on the iPhone.
 */
export function monthlyWays(date: string): { value: string; name: string }[] {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [{ value: 'day', name: 'The same date' }];
	const p = placeInMonth(date);
	const ways = [{ value: 'day', name: `The ${dayName(p.day)}` }];
	if (p.nth <= 4) ways.push({ value: 'weekday', name: `The ${ORDINALS[p.nth - 1]} ${WEEKDAY_NAMES[p.weekday]}` });
	if (p.last) ways.push({ value: 'last', name: `The last ${WEEKDAY_NAMES[p.weekday]}` });
	return ways;
}

/** The rule for a monthly repeat from `date`, every `every` months, falling one of monthlyWays's ways. */
export function monthlyRule(date: string, every: number, way: string): string | undefined {
	if (!monthlyWays(date).some((w) => w.value === way) || !Number.isInteger(every) || every < 1 || every > MOST_MONTHS) return undefined;
	const p = placeInMonth(date);
	const interval = every > 1 ? `;INTERVAL=${every}` : '';
	const byDay = way === 'weekday' ? `;BYDAY=${p.nth}${WEEKDAYS[p.weekday]}` : way === 'last' ? `;BYDAY=-1${WEEKDAYS[p.weekday]}` : '';
	return `FREQ=MONTHLY${interval}${byDay}`;
}

/** A saved monthly rule as the sheet shows it, if it is one the sheet makes for a series starting on `date`. */
export function monthlyChoice(rule: string | undefined, date: string | undefined): { every: number; way: string } | undefined {
	if (!rule || !date) return undefined;
	const parts = new Map(rule.toUpperCase().split(';').filter(Boolean).map((p) => p.split('=') as [string, string]));
	if (parts.get('FREQ') !== 'MONTHLY' || ![...parts.keys()].every((k) => ['FREQ', 'INTERVAL', 'BYDAY'].includes(k))) return undefined;
	const every = Number(parts.get('INTERVAL') ?? 1);
	// The same parts in the order monthlyRule writes them, as other apps may order them differently.
	const same = `FREQ=MONTHLY${every !== 1 ? `;INTERVAL=${parts.get('INTERVAL')}` : ''}${parts.has('BYDAY') ? `;BYDAY=${parts.get('BYDAY')}` : ''}`;
	const way = monthlyWays(date).find((w) => monthlyRule(date, every, w.value) === same)?.value;
	return way ? { every, way } : undefined;
}

/** The sheet's choice for a saved rule; "custom" for rules made elsewhere (for example on the iPhone), which are kept as they are. */
export function repeatChoice(rule: string | undefined, date?: string): string {
	if (!rule) return '';
	if (monthlyChoice(rule, date)) return 'monthly';
	return REPEATS.find((r) => r.rule === rule)?.value ?? 'custom';
}
