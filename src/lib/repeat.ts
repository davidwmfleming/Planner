// The repeat choices offered in the details sheet, and the standard RRULE each one is saved as.
export const REPEATS = [
	{ value: '', name: 'Does not repeat', rule: undefined },
	{ value: 'daily', name: 'Every day', rule: 'FREQ=DAILY' },
	{ value: 'weekdays', name: 'Every weekday', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
	{ value: 'weekly', name: 'Every week', rule: 'FREQ=WEEKLY' },
	{ value: 'fortnightly', name: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
	{ value: 'monthly', name: 'Every month', rule: 'FREQ=MONTHLY' },
	{ value: 'yearly', name: 'Every year', rule: 'FREQ=YEARLY' }
] as const;

/** The sheet's choice for a saved rule; "custom" for rules made elsewhere (for example on the iPhone), which are kept as they are. */
export function repeatChoice(rule: string | undefined): string {
	if (!rule) return '';
	return REPEATS.find((r) => r.rule === rule)?.value ?? 'custom';
}
