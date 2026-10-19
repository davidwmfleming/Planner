import type { Item } from './item';

/**
 * Unfinished tasks from earlier days that should move onto today.
 * Each keeps the day it was first written on, so a task carried three times still says where it started.
 * Repeating tasks stay put: each occurrence belongs to its own day.
 */
export function rolloverChanges<T extends Item>(items: T[], today: string): { item: T; changes: Partial<Item> }[] {
	return items
		.filter((i) => i.kind === 'task' && i.state === 'open' && i.date && i.date < today && !i.recurrence)
		.map((item) => ({ item, changes: { date: today, carriedFrom: item.carriedFrom ?? item.date } }));
}
