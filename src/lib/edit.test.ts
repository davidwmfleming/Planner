import { describe, expect, it } from 'vitest';
import { applyEdit, categoryOf, LIMITS, type EditFields } from './edit';
import type { Item } from './item';

const fields = (f: Partial<EditFields>): EditFields => ({
	title: 'Dentist', kind: 'event', date: '2026-10-21', time: '09:00', endTime: '', location: '', label: '', notes: '', repeat: '', ...f
});
const LISTS = ['This month', 'Waiting', 'Someday'];
const event: Item = { uid: 'u1', kind: 'event', title: 'Dentist', date: '2026-10-21', time: '09:00', endTime: '10:00', state: 'open' };

describe('applyEdit', () => {
	it('changes the title, time, location and notes', () => {
		const r = applyEdit(event, fields({ title: 'Dentist cleaning', time: '10:30', endTime: '11:15', location: 'Main St', notes: 'Bring card' }), LISTS);
		expect(r).toEqual({ item: { uid: 'u1', kind: 'event', title: 'Dentist cleaning', date: '2026-10-21', time: '10:30', endTime: '11:15', location: 'Main St', notes: 'Bring card', state: 'open' } });
	});

	it('turns an event into a task, and a task without a date into a "not scheduled" item', () => {
		const asTask = applyEdit(event, fields({ kind: 'task' }), LISTS);
		expect(asTask).toEqual({ item: { uid: 'u1', kind: 'task', title: 'Dentist', date: '2026-10-21', time: '09:00', state: 'open' } });
		const someday = applyEdit({ ...event, kind: 'task' }, fields({ kind: 'task', date: '', time: '09:00', label: 'Someday' }), LISTS);
		expect(someday).toEqual({ item: { uid: 'u1', kind: 'task', title: 'Dentist', categories: ['Someday'], state: 'open' } });
	});

	it('refuses an event without a date, and bad values', () => {
		expect(applyEdit(event, fields({ date: '' }), LISTS)).toHaveProperty('error');
		expect(applyEdit(event, fields({ title: '  ' }), LISTS)).toHaveProperty('error');
		expect(applyEdit(event, fields({ time: '25:00' }), LISTS)).toHaveProperty('error');
		expect(applyEdit(event, fields({ date: '2026-02-31' }), LISTS)).toEqual({ error: 'That date is not valid' });
		expect(applyEdit(event, fields({ date: '2026-13-01' }), LISTS)).toHaveProperty('error');
		expect(applyEdit(event, fields({ date: '2028-02-29' }), LISTS)).toHaveProperty('item');
		expect(applyEdit(event, fields({ label: 'urgent' }), LISTS)).toHaveProperty('error');
	});

	it('refuses a title, location or notes longer than the limit, but keeps long ones another app wrote while unchanged', () => {
		const long = (n: number) => 'a'.repeat(n);
		expect(applyEdit(event, fields({ title: long(LIMITS.title) }), LISTS)).toHaveProperty('item');
		expect(applyEdit(event, fields({ title: long(LIMITS.title + 1) }), LISTS)).toEqual({ error: 'Shorten the title to 500 letters or fewer' });
		expect(applyEdit(event, fields({ location: long(LIMITS.location + 1) }), LISTS)).toHaveProperty('error');
		expect(applyEdit(event, fields({ notes: long(LIMITS.notes + 1) }), LISTS)).toEqual({ error: 'Shorten the notes to 10,000 letters or fewer' });
		const fromPhone: Item = { ...event, title: long(600), notes: long(20_000) };
		expect(applyEdit(fromPhone, fields({ title: long(600), notes: long(20_000), time: '11:00' }), LISTS)).toHaveProperty('item');
		expect(applyEdit(fromPhone, fields({ title: long(601), notes: long(20_000) }), LISTS)).toHaveProperty('error');
	});

	it('keeps a multi-day event the same length when its first day moves', () => {
		const camp: Item = { uid: 'c', kind: 'event', title: 'Camp', date: '2026-10-19', endDate: '2026-10-21', state: 'open' };
		const r = applyEdit(camp, fields({ title: 'Camp', date: '2026-10-30', time: '' }), LISTS);
		expect(r).toMatchObject({ item: { date: '2026-10-30', endDate: '2026-11-01' } });
	});

	it('keeps the carried-over marker only while the task stays on the same day', () => {
		const carried: Item = { uid: 't', kind: 'task', title: 'Book dentist', date: '2026-10-19', carriedFrom: '2026-10-18', state: 'open' };
		expect(applyEdit(carried, fields({ kind: 'task', title: 'Book dentist', date: '2026-10-19', time: '' }), LISTS)).toMatchObject({ item: { carriedFrom: '2026-10-18' } });
		expect(applyEdit(carried, fields({ kind: 'task', title: 'Book dentist', date: '2026-10-22', time: '' }), LISTS)).not.toMatchObject({ item: { carriedFrom: '2026-10-18' } });
	});

	it('saves a repeat choice as a standard rule, keeps a rule made elsewhere, and needs a date to repeat', () => {
		expect(applyEdit(event, fields({ repeat: 'weekdays' }), LISTS)).toMatchObject({ item: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } });
		const fromPhone = { ...event, recurrence: 'FREQ=MONTHLY;BYDAY=2TU' };
		expect(applyEdit(fromPhone, fields({ repeat: 'custom' }), LISTS)).toMatchObject({ item: { recurrence: 'FREQ=MONTHLY;BYDAY=2TU' } });
		expect(applyEdit(fromPhone, fields({ repeat: '' }), LISTS)).not.toHaveProperty('item.recurrence');
		expect(applyEdit({ ...event, kind: 'task' }, fields({ kind: 'task', date: '', repeat: 'weekly' }), LISTS)).toHaveProperty('error');
		expect(applyEdit(event, fields({ repeat: 'hourly' }), LISTS)).toHaveProperty('error');
	});

	it('saves a monthly repeat every few months, on the date or on the weekday of the month, worked out from the new date', () => {
		expect(applyEdit(event, fields({ repeat: 'monthly', every: '3' }), LISTS)).toMatchObject({ item: { recurrence: 'FREQ=MONTHLY;INTERVAL=3' } });
		expect(applyEdit(event, fields({ repeat: 'monthly', every: '', monthlyWay: 'weekday' }), LISTS)).toMatchObject({ item: { recurrence: 'FREQ=MONTHLY;BYDAY=3WE' } });
		expect(applyEdit(event, fields({ date: '2026-11-26', repeat: 'monthly', monthlyWay: 'weekday' }), LISTS)).toMatchObject({ item: { recurrence: 'FREQ=MONTHLY;BYDAY=4TH' } });
		expect(applyEdit(event, fields({ repeat: 'monthly', every: '0' }), LISTS)).toEqual({ error: 'Repeat every 1 to 99 months' });
		expect(applyEdit(event, fields({ repeat: 'monthly', every: '1.5' }), LISTS)).toHaveProperty('error');
		expect(applyEdit(event, fields({ repeat: 'monthly', monthlyWay: 'last' }), LISTS)).toEqual({ error: 'Choose which day of the month it repeats on' });
	});

	it('files a task under a category by its name, as the settings spell it, whatever the case chosen', () => {
		const task: Item = { uid: 't', kind: 'task', title: 'Green cart', state: 'open' };
		const r = applyEdit(task, fields({ kind: 'task', title: 'Green cart', date: '', time: '', label: 'waiting' }), LISTS);
		expect(r).toMatchObject({ item: { categories: ['Waiting'] } });
		expect(applyEdit(task, fields({ kind: 'task', title: 'Green cart', date: '', time: '', label: 'Errands' }), ['Errands'])).toMatchObject({ item: { categories: ['Errands'] } });
	});

	it('keeps categories added in other apps when the category changes or is taken off', () => {
		const task: Item = { uid: 't', kind: 'task', title: 'Green cart', categories: ['Home', 'someday', 'Errands'], state: 'open' };
		const moved = applyEdit(task, fields({ kind: 'task', title: 'Green cart', date: '', time: '', label: 'This month' }), LISTS);
		expect(moved).toMatchObject({ item: { categories: ['This month', 'Home', 'Errands'] } });
		const none = applyEdit(task, fields({ kind: 'task', title: 'Green cart', date: '', time: '', label: '' }), LISTS);
		expect(none).toMatchObject({ item: { categories: ['Home', 'Errands'] } });
		const bare: Item = { ...task, categories: ['Waiting'] };
		expect(applyEdit(bare, fields({ kind: 'task', title: 'Green cart', date: '', time: '', label: '' }), LISTS)).not.toHaveProperty('item.categories');
	});
});

describe('events and lists', () => {
	it("leaves an event's categories (from another app) as they are; lists are for tasks", () => {
		const meeting: Item = { ...event, categories: ['Waiting', 'Business'] };
		expect(applyEdit(meeting, fields({ title: 'Dentist moved' }), LISTS)).toMatchObject({ item: { title: 'Dentist moved', categories: ['Waiting', 'Business'] } });
		expect(applyEdit(meeting, fields({ kind: 'task', label: '' }), LISTS)).toMatchObject({ item: { kind: 'task', categories: ['Waiting', 'Business'] } });
	});
});

describe('categoryOf', () => {
	it("is the first of a task's values that is one of David's categories, spelled as the settings spell it", () => {
		expect(categoryOf(['Home', 'WAITING', 'Someday'], LISTS)).toBe('Waiting');
		expect(categoryOf(['Home'], LISTS)).toBeUndefined();
		expect(categoryOf(undefined, LISTS)).toBeUndefined();
		expect(categoryOf(['Someday'], ['Errands'])).toBeUndefined();
	});
});
