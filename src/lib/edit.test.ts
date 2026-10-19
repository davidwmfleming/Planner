import { describe, expect, it } from 'vitest';
import { applyEdit, type EditFields } from './edit';
import type { Item } from './item';

const fields = (f: Partial<EditFields>): EditFields => ({
	title: 'Dentist', kind: 'event', date: '2026-10-21', time: '09:00', endTime: '', location: '', label: '', notes: '', repeat: '', ...f
});
const event: Item = { uid: 'u1', kind: 'event', title: 'Dentist', date: '2026-10-21', time: '09:00', endTime: '10:00', state: 'open' };

describe('applyEdit', () => {
	it('changes the title, time, location and notes', () => {
		const r = applyEdit(event, fields({ title: 'Dentist cleaning', time: '10:30', endTime: '11:15', location: 'Main St', notes: 'Bring card' }));
		expect(r).toEqual({ item: { uid: 'u1', kind: 'event', title: 'Dentist cleaning', date: '2026-10-21', time: '10:30', endTime: '11:15', location: 'Main St', notes: 'Bring card', state: 'open' } });
	});

	it('turns an event into a task, and a task without a date into a "not scheduled" item', () => {
		const asTask = applyEdit(event, fields({ kind: 'task' }));
		expect(asTask).toEqual({ item: { uid: 'u1', kind: 'task', title: 'Dentist', date: '2026-10-21', time: '09:00', state: 'open' } });
		const someday = applyEdit({ ...event, kind: 'task' }, fields({ kind: 'task', date: '', time: '09:00', label: 'someday' }));
		expect(someday).toEqual({ item: { uid: 'u1', kind: 'task', title: 'Dentist', label: 'someday', state: 'open' } });
	});

	it('refuses an event without a date, and bad values', () => {
		expect(applyEdit(event, fields({ date: '' }))).toHaveProperty('error');
		expect(applyEdit(event, fields({ title: '  ' }))).toHaveProperty('error');
		expect(applyEdit(event, fields({ time: '25:00' }))).toHaveProperty('error');
		expect(applyEdit(event, fields({ label: 'urgent' }))).toHaveProperty('error');
	});

	it('keeps a multi-day event the same length when its first day moves', () => {
		const camp: Item = { uid: 'c', kind: 'event', title: 'Camp', date: '2026-10-19', endDate: '2026-10-21', state: 'open' };
		const r = applyEdit(camp, fields({ title: 'Camp', date: '2026-10-30', time: '' }));
		expect(r).toMatchObject({ item: { date: '2026-10-30', endDate: '2026-11-01' } });
	});

	it('keeps the carried-over marker only while the task stays on the same day', () => {
		const carried: Item = { uid: 't', kind: 'task', title: 'Book dentist', date: '2026-10-19', carriedFrom: '2026-10-18', state: 'open' };
		expect(applyEdit(carried, fields({ kind: 'task', title: 'Book dentist', date: '2026-10-19', time: '' }))).toMatchObject({ item: { carriedFrom: '2026-10-18' } });
		expect(applyEdit(carried, fields({ kind: 'task', title: 'Book dentist', date: '2026-10-22', time: '' }))).not.toMatchObject({ item: { carriedFrom: '2026-10-18' } });
	});

	it('saves a repeat choice as a standard rule, keeps a rule made elsewhere, and needs a date to repeat', () => {
		expect(applyEdit(event, fields({ repeat: 'weekdays' }))).toMatchObject({ item: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } });
		const fromPhone = { ...event, recurrence: 'FREQ=MONTHLY;BYDAY=2TU' };
		expect(applyEdit(fromPhone, fields({ repeat: 'custom' }))).toMatchObject({ item: { recurrence: 'FREQ=MONTHLY;BYDAY=2TU' } });
		expect(applyEdit(fromPhone, fields({ repeat: '' }))).not.toHaveProperty('item.recurrence');
		expect(applyEdit({ ...event, kind: 'task' }, fields({ kind: 'task', date: '', repeat: 'weekly' }))).toHaveProperty('error');
		expect(applyEdit(event, fields({ repeat: 'hourly' }))).toHaveProperty('error');
	});
});
