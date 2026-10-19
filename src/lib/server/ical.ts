// Converts planner items to and from iCalendar (.ics), the format CalDAV servers store.
// Events are VEVENTs and tasks are VTODOs, so any calendar app can read what the planner writes.
// Times are written as floating local times: the household lives in one time zone.
import ICAL from 'ical.js';
import { addDays } from '$lib/dates';
import { LABELS, type Item, type ItemLabel, type ItemState } from '$lib/item';

const PRODID = '-//davidwmfleming//Planner//EN';
/** Text a one-off change of a repeating item shares with its series unless it was changed for that day. */
const SERIES_TEXT = ['summary', 'location', 'description', 'categories'];

const dateValue = (date: string) => ICAL.Time.fromDateString(date);
const dateTimeValue = (date: string, time: string) => ICAL.Time.fromDateTimeString(`${date}T${time}:00`);

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;
const hhmm = (t: ICAL.Time) => `${pad(t.hour)}:${pad(t.minute)}`;

/**
 * Writes an item as an .ics document. Given the document it replaces, a repeating item keeps
 * its skipped days and its one-off changes (made here or on a phone), and time zone definitions are kept.
 */
export function itemToICS(item: Item, previous?: string): string {
	const cal = new ICAL.Component(['vcalendar', [], []]);
	cal.addPropertyWithValue('prodid', PRODID);
	cal.addPropertyWithValue('version', '2.0');
	const comp = itemComponent(item);
	cal.addSubcomponent(comp);
	if (previous) {
		const old = new ICAL.Component(ICAL.parse(previous));
		for (const tz of old.getAllSubcomponents('vtimezone')) cal.addSubcomponent(tz);
		const oldParts = [...old.getAllSubcomponents('vevent'), ...old.getAllSubcomponents('vtodo')].filter((p) => p.name === comp.name);
		const oldMaster = oldParts.find((p) => !p.hasProperty('recurrence-id'));
		if (item.recurrence && oldMaster) {
			// Rewritten to match the new start, so a skipped day stays skipped.
			const skipped = oldMaster.getAllProperties('exdate').flatMap((ex) => ex.getValues() as ICAL.Time[]);
			for (const t of skipped) addSeriesDay(comp, 'exdate', comp, isoDate(t));
			for (const one of oldParts.filter((p) => p.hasProperty('recurrence-id'))) {
				// A day that was only ticked or moved takes the series' new title, place and notes too.
				for (const name of SERIES_TEXT) {
					if (String(one.getFirstPropertyValue(name) ?? '') !== String(oldMaster.getFirstPropertyValue(name) ?? '')) continue;
					one.removeAllProperties(name);
					const value = comp.getFirstPropertyValue(name);
					if (value != null) one.addPropertyWithValue(name, value);
				}
				cal.addSubcomponent(one);
			}
		}
	}
	return cal.toString();
}

function itemComponent(item: Item): ICAL.Component {
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
	return comp;
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

/** The main component of a document and its one-off changes, keyed by the day each replaces. */
function parts(ics: string) {
	const cal = new ICAL.Component(ICAL.parse(ics));
	const all = [...cal.getAllSubcomponents('vevent'), ...cal.getAllSubcomponents('vtodo')];
	const master = all.find((c) => !c.hasProperty('recurrence-id'));
	const overrides = new Map<string, ICAL.Component>();
	for (const c of all) {
		const rid = c.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
		if (rid) overrides.set(isoDate(rid), c);
	}
	return { cal, master, overrides };
}

/** One showing of a repeating item on the day it was originally due, before any one-off change. */
function showing(series: Item, day: string): Item {
	const shown: Item = { ...series, date: day, occurrence: day, seriesStart: series.date, state: series.state === 'dropped' ? 'dropped' : 'open' };
	delete shown.carriedFrom;
	if (series.endDate && series.date) shown.endDate = addDays(day, dayCount(series.date, series.endDate));
	return shown;
}

const dayCount = (from: string, to: string) =>
	Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

const MAX_REPEATS = 20_000;

/** Every showing of a repeating item that touches the days from..to (inclusive), with one-off changes applied. */
export function occurrencesBetween(ics: string, from: string, to: string): Item[] {
	const { master, overrides } = parts(ics);
	if (!master || !master.hasProperty('rrule')) return [];
	const series = componentToItem(master);
	if (!series.date) return [];
	const length = series.endDate ? dayCount(series.date, series.endDate) : 0;
	const touches = (i: Item) => !!i.date && i.date <= to && (i.endDate ?? i.date) >= from;

	const shown: Item[] = [];
	const expansion = new ICAL.RecurExpansion({ component: master, dtstart: master.getFirstPropertyValue('dtstart') as ICAL.Time });
	for (let n = 0; n < MAX_REPEATS; n++) {
		const next = expansion.next();
		if (!next) break;
		const day = isoDate(next);
		if (day > to) break;
		if (addDays(day, length) < from || overrides.has(day)) continue;
		shown.push(showing(series, day));
	}
	for (const [day, comp] of overrides) {
		const changed = { ...componentToItem(comp), occurrence: day, seriesStart: series.date, recurrence: series.recurrence };
		if (touches(changed)) shown.push(changed);
	}
	return shown;
}

/** Changes one showing of a repeating item (tick, drop, move) by writing a one-off change for that day. */
export function withOccurrence(ics: string, day: string, change: (current: Item) => Partial<Item>): string {
	const { cal, master, overrides } = parts(ics);
	if (!master) throw new Error('Nothing to change in this calendar entry');
	const series = componentToItem(master);
	const existing = overrides.get(day);
	const current = existing ? { ...componentToItem(existing), occurrence: day } : showing(series, day);
	const next: Item = { ...current, ...change(current) };
	delete next.recurrence;
	delete next.occurrence;
	delete next.seriesStart;

	const comp = itemComponent(next);
	addSeriesDay(comp, 'recurrence-id', master, day);

	if (existing) cal.removeSubcomponent(existing);
	cal.addSubcomponent(comp);
	return cal.toString();
}

/** Removes one showing of a repeating item, leaving the rest of the series. */
export function withoutOccurrence(ics: string, day: string): string {
	const { cal, master, overrides } = parts(ics);
	if (!master) throw new Error('Nothing to change in this calendar entry');
	const existing = overrides.get(day);
	if (existing) cal.removeSubcomponent(existing);
	addSeriesDay(master, 'exdate', master, day);
	return cal.toString();
}

/** Names one day of a series the standard way: the series' start time and time zone, on that day. */
function addSeriesDay(comp: ICAL.Component, name: string, master: ICAL.Component, day: string) {
	const start = master.getFirstProperty('dtstart');
	if (!start) throw new Error('A repeating item needs a start');
	const value = (start.getFirstValue() as ICAL.Time).clone();
	const [y, m, d] = day.split('-').map(Number);
	value.year = y;
	value.month = m;
	value.day = d;
	const prop = comp.addPropertyWithValue(name, value);
	const tzid = start.getParameter('tzid');
	if (tzid) prop.setParameter('tzid', tzid);
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
