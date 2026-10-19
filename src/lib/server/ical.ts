// Converts planner items to and from iCalendar (.ics), the format CalDAV servers store.
// Events are VEVENTs and tasks are VTODOs, so any calendar app can read what the planner writes.
// Times are written as floating local times: the household lives in one time zone.
import ICAL from 'ical.js';
import { addDays } from '$lib/dates';
import { LABELS, type Item, type ItemLabel, type ItemState } from '$lib/item';

const PRODID = '-//davidwmfleming//Planner//EN';

const dateValue = (date: string) => ICAL.Time.fromDateString(date);
const dateTimeValue = (date: string, time: string) => ICAL.Time.fromDateTimeString(`${date}T${time}:00`);

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;
const hhmm = (t: ICAL.Time) => `${pad(t.hour)}:${pad(t.minute)}`;

export function itemToICS(item: Item): string {
	const cal = new ICAL.Component(['vcalendar', [], []]);
	cal.addPropertyWithValue('prodid', PRODID);
	cal.addPropertyWithValue('version', '2.0');

	const comp = new ICAL.Component(item.kind === 'event' ? 'vevent' : 'vtodo');
	comp.addPropertyWithValue('uid', item.uid);
	comp.addPropertyWithValue('dtstamp', ICAL.Time.now());
	comp.addPropertyWithValue('summary', item.title);
	if (item.location) comp.addPropertyWithValue('location', item.location);
	if (item.notes) comp.addPropertyWithValue('description', item.notes);
	if (item.label) comp.addPropertyWithValue('categories', item.label);
	if (item.carriedFrom) comp.addPropertyWithValue('x-planner-carried-from', item.carriedFrom);
	if (item.recurrence) comp.addPropertyWithValue('rrule', ICAL.Recur.fromString(item.recurrence));

	if (item.kind === 'event') {
		if (!item.date) throw new Error('An event needs a date');
		if (item.time) {
			comp.addPropertyWithValue('dtstart', dateTimeValue(item.date, item.time));
			comp.addPropertyWithValue('dtend', dateTimeValue(item.date, item.endTime ?? addHour(item.time)));
		} else {
			comp.addPropertyWithValue('dtstart', dateValue(item.date));
			comp.addPropertyWithValue('dtend', dateValue(addDays(item.endDate ?? item.date, 1)));
		}
		if (item.state === 'dropped') comp.addPropertyWithValue('status', 'CANCELLED');
		if (item.state === 'done') comp.addPropertyWithValue('x-planner-ticked', 'TRUE');
	} else {
		if (item.date) {
			comp.addPropertyWithValue('dtstart', item.time ? dateTimeValue(item.date, item.time) : dateValue(item.date));
		}
		const status = { open: 'NEEDS-ACTION', done: 'COMPLETED', dropped: 'CANCELLED' }[item.state];
		comp.addPropertyWithValue('status', status);
		if (item.state === 'done') comp.addPropertyWithValue('completed', ICAL.Time.now());
		if (item.date && item.time && item.state === 'open') {
			const alarm = new ICAL.Component('valarm');
			alarm.addPropertyWithValue('action', 'DISPLAY');
			alarm.addPropertyWithValue('description', item.title);
			const trigger = alarm.addPropertyWithValue('trigger', ICAL.Duration.fromString('PT0M'));
			trigger.setParameter('related', 'START');
			comp.addSubcomponent(alarm);
		}
	}

	cal.addSubcomponent(comp);
	return cal.toString();
}

function addHour(time: string): string {
	const [h, m] = time.split(':').map(Number);
	return `${pad(Math.min(h + 1, 23))}:${pad(h + 1 > 23 ? 59 : m)}`;
}

/** Reads every event and task in an .ics document. Recurrence instances are not expanded here. */
export function icsToItems(ics: string): Item[] {
	const cal = new ICAL.Component(ICAL.parse(ics));
	const items: Item[] = [];
	for (const comp of [...cal.getAllSubcomponents('vevent'), ...cal.getAllSubcomponents('vtodo')]) {
		if (comp.hasProperty('recurrence-id')) continue; // overrides of a repeating item come later
		items.push(componentToItem(comp));
	}
	return items;
}

function componentToItem(comp: ICAL.Component): Item {
	const kind = comp.name === 'vevent' ? 'event' : 'task';
	const text = (name: string) => {
		const v = comp.getFirstPropertyValue(name);
		return v == null ? undefined : String(v);
	};
	const item: Item = {
		uid: text('uid') ?? crypto.randomUUID(),
		kind,
		title: text('summary') ?? '',
		state: 'open'
	};

	// Apple Reminders and other task apps often set only DUE; treat it as the task's day.
	const start = (comp.getFirstPropertyValue('dtstart') ?? (kind === 'task' ? comp.getFirstPropertyValue('due') : null)) as ICAL.Time | null;
	if (start) {
		item.date = isoDate(start);
		if (!start.isDate) item.time = hhmm(start);
	}
	if (kind === 'event') {
		const end = comp.getFirstPropertyValue('dtend') as ICAL.Time | null;
		if (end && start) {
			if (start.isDate) {
				const last = addDays(isoDate(end), -1);
				if (last > item.date!) item.endDate = last;
			} else if (isoDate(end) === item.date) {
				item.endTime = hhmm(end);
			}
		}
	}

	const status = text('status')?.toUpperCase();
	if (status === 'CANCELLED') item.state = 'dropped';
	else if (status === 'COMPLETED' || text('x-planner-ticked') === 'TRUE') item.state = 'done';

	const location = text('location');
	if (location) item.location = location;
	const notes = text('description');
	if (notes) item.notes = notes;
	const carried = text('x-planner-carried-from');
	if (carried) item.carriedFrom = carried;
	const categories = comp.getAllProperties('categories').flatMap((p) => p.getValues().map(String));
	const label = categories.map((c) => c.toLowerCase()).find((c): c is ItemLabel => (LABELS as string[]).includes(c));
	if (label) item.label = label;
	const rrule = comp.getFirstPropertyValue('rrule') as ICAL.Recur | null;
	if (rrule) item.recurrence = rrule.toString();

	return item;
}
