// Builds what one planner page shows: its days, each with events and tasks in reading order.
import type { Item } from './item';

export interface Day<T extends Item = Item> {
	date: string;
	weekend: boolean;
	events: T[];
	tasks: T[];
}

const onDay = (item: Item, date: string) =>
	!!item.date && (item.endDate ? item.date <= date && date <= item.endDate : item.date === date);

/** All-day events first, then by time; items without a time keep their order. */
const byTime = (a: Item, b: Item) => (a.time ?? '').localeCompare(b.time ?? '');

export function buildDays<T extends Item>(dates: string[], items: T[]): Day<T>[] {
	return dates.map((date) => {
		const dow = new Date(`${date}T12:00:00`).getDay();
		const here = items.filter((i) => onDay(i, date));
		return {
			date,
			weekend: dow === 0 || dow === 6,
			events: here.filter((i) => i.kind === 'event').sort(byTime),
			tasks: here.filter((i) => i.kind === 'task').sort(byTime)
		};
	});
}

