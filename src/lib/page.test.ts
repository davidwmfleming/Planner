import { describe, expect, it } from 'vitest';
import type { Item } from './item';
import { buildDays } from './page';

const item = (x: Partial<Item>): Item => ({ uid: crypto.randomUUID(), kind: 'task', title: 'x', state: 'open', ...x });

describe('buildDays', () => {
	it('sorts each day into events and tasks, all-day first then by time', () => {
		const items = [
			item({ kind: 'event', title: 'Policy team', date: '2026-10-19', time: '09:00' }),
			item({ kind: 'event', title: 'Terry Fox', date: '2026-10-19', time: '08:00' }),
			item({ kind: 'event', title: 'Camp', date: '2026-10-19' }),
			item({ title: 'Green cart', date: '2026-10-19' }),
			item({ title: 'Not today', date: '2026-10-20' }),
			item({ title: 'Someday' })
		];
		const [mon, tue] = buildDays(['2026-10-19', '2026-10-20'], items);
		expect(mon.events.map((e) => e.title)).toEqual(['Camp', 'Terry Fox', 'Policy team']);
		expect(mon.tasks.map((t) => t.title)).toEqual(['Green cart']);
		expect(tue.tasks.map((t) => t.title)).toEqual(['Not today']);
	});

	it('repeats a multi-day event on every day it covers, and marks weekends', () => {
		const camp = item({ kind: 'event', title: 'Camp', date: '2026-10-23', endDate: '2026-10-25' });
		const days = buildDays(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'], [camp]);
		expect(days.map((d) => d.events.length)).toEqual([0, 1, 1, 1]);
		expect(days.map((d) => d.weekend)).toEqual([false, false, true, true]);
	});
});
