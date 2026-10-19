// Fills the development calendar server with sample entries taken from David's paper page,
// placed around today. Run with: npm run seed (after npm run calendar in another terminal).
import { addDays, toISODate } from '../src/lib/dates';
import type { Item } from '../src/lib/item';
import { CalendarStore } from '../src/lib/server/calendar-store';

const store = new CalendarStore({
	serverUrl: process.env.CALDAV_URL ?? 'http://127.0.0.1:5232/',
	username: process.env.CALDAV_USER ?? 'david',
	password: process.env.CALDAV_PASSWORD ?? 'dev'
});
await store.connect();
const me = await store.ensureCalendar('Me', ['event']);
for (const name of ['Family', 'Workouts', 'Morgan Meals']) await store.ensureCalendar(name, ['event']);
const work = await store.ensureCalendar('Work', ['event']);
const tasks = await store.ensureCalendar('Tasks', ['task']);

const t = toISODate(new Date());
const [t1, t2, y] = [addDays(t, 1), addDays(t, 2), addDays(t, -1)];
const ev = (date: string, title: string, time?: string, extra: Partial<Item> = {}): Item =>
	({ uid: crypto.randomUUID(), kind: 'event', date, title, time, state: 'open', ...extra });
const tk = (date: string | undefined, title: string, extra: Partial<Item> = {}): Item =>
	({ uid: crypto.randomUUID(), kind: 'task', date, title, state: 'open', ...extra });

const events = [
	ev(t, 'Cornwall Camp', undefined, { endDate: t2 }), ev(t, 'Terry Fox', '08:00'), ev(t, 'ADHD follow-up', '08:45'),
	ev(t, 'Georgetown CleanTech visit', '09:00'), ev(t1, 'Policy team', '09:00', { recurrence: 'FREQ=WEEKLY' }), ev(t1, 'Training', '11:00'), ev(t1, 'Reg policy', '12:00')
];
const todo = [
	tk(t, 'Green cart'), tk(t, 'Ruck', { state: 'dropped' }), tk(t, 'Anniversary gift ideas'), tk(y, 'Book dentist cleaning'),
	tk(t1, 'Hot tub'), tk(t1, 'Ruck walk', { state: 'dropped' }), tk(t1, 'Bag to truck', { time: '17:00' }), tk(t1, 'Pick up meds'),
	tk(t2, 'Veggie box'), tk(t2, 'Lift'), tk(t2, 'Sheets'),
	tk(undefined, 'Fix piano keys (glue)', { label: 'someday' }), tk(undefined, 'Defrost freezer before winter', { label: 'month' }),
	tk(undefined, 'Budget update and chat, before January', { label: 'month' }), tk(undefined, 'Cancel credit card (one call)', { label: 'month' }),
	tk(undefined, 'Wills: signing meeting', { label: 'waiting' }), tk(undefined, 'Tax credit: awaiting adjudication', { label: 'waiting' }),
	tk(undefined, 'French training: waiting to hear', { label: 'waiting' })
];
for (const e of events) await store.create(me.url, e);
await store.create(work.url, ev(t, 'Economic Modelling', '09:00', { endTime: '10:00' }));
for (const x of todo) await store.create(tasks.url, x);
console.log(`Seeded ${events.length} events and ${todo.length} tasks.`);
