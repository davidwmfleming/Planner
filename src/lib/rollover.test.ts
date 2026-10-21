import { describe, expect, it } from 'vitest';
import type { Item } from './item';
import { rolloverChanges } from './rollover';

const item = (x: Partial<Item>): Item => ({ uid: crypto.randomUUID(), kind: 'task', title: 'x', state: 'open', ...x });
const TODAY = '2026-10-21';

describe('rolloverChanges', () => {
	it('moves open tasks from earlier days onto today, marked with the day they came from', () => {
		const late = item({ title: 'Green cart', date: '2026-10-19', time: '09:00' });
		expect(rolloverChanges([late], TODAY)).toEqual([
			{ item: late, changes: { date: TODAY, carriedFrom: '2026-10-19' } }
		]);
	});

	it('keeps the original day when a task is carried again', () => {
		const again = item({ date: '2026-10-20', carriedFrom: '2026-10-18' });
		expect(rolloverChanges([again], TODAY)[0].changes.carriedFrom).toBe('2026-10-18');
	});

	it('leaves done, dropped, undated, today, future, repeating tasks and all events alone', () => {
		const items = [
			item({ date: '2026-10-19', state: 'done' }),
			item({ date: '2026-10-19', state: 'dropped' }),
			item({ categories: ['Someday'] }),
			item({ date: TODAY }),
			item({ date: '2026-10-22' }),
			item({ date: '2026-10-19', recurrence: 'FREQ=WEEKLY' }),
			item({ kind: 'event', date: '2026-10-19' })
		];
		expect(rolloverChanges(items, TODAY)).toEqual([]);
	});
});
