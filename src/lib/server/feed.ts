// Reads a published calendar (.ics feed) for display only, such as the work Outlook calendar.
// Times are converted to the server's local time zone, so a 9 a.m. Toronto meeting shows at 9:00.
import ICAL from 'ical.js';
import { addDays } from '$lib/dates';
import type { Item } from '$lib/item';

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDate = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

const MAX_REPEATS = 20_000;

/** The feed's events that touch the days from..to (inclusive), as read-only planner items. */
export function feedEventsBetween(ics: string, from: string, to: string, feed: 'work'): Item[] {
	const cal = new ICAL.Component(ICAL.parse(ics));
	const parts = cal.getAllSubcomponents('vevent');
	const masters = parts.filter((p) => !p.hasProperty('recurrence-id'));
	const items: Item[] = [];

	for (const master of masters) {
		const event = new ICAL.Event(master);
		for (const one of parts) if (one !== master && one.getFirstPropertyValue('uid') === event.uid) event.relateException(one);
		if (!event.startDate) continue;

		const show = (start: ICAL.Time, end: ICAL.Time | null, source: ICAL.Event) => {
			if (String(source.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
			const item = toItem(source, start, end, feed);
			if (item.date! <= to && (item.endDate ?? item.date!) >= from) items.push(item);
		};

		if (!event.isRecurring()) {
			show(event.startDate, event.endDate, event);
			continue;
		}
		const it = event.iterator();
		for (let n = 0; n < MAX_REPEATS; n++) {
			const next = it.next();
			if (!next) break;
			const o = event.getOccurrenceDetails(next);
			// A meeting moved into the page from outside it is still caught: overrides are checked by their new start.
			if (isoDate(next) > to && isoDate(o.startDate) > to) break;
			show(o.startDate, o.endDate, o.item);
		}
	}
	return items;
}

function toItem(source: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null, feed: 'work'): Item {
	const item: Item = { uid: `${feed}:${source.uid}:${start.toString()}`, kind: 'event', title: source.summary || '(busy)', state: 'open', feed };
	if (start.isDate) {
		item.date = isoDate(start);
		const last = end ? addDays(isoDate(end), -1) : item.date;
		if (last > item.date) item.endDate = last;
	} else {
		const s = start.toJSDate();
		item.date = localDate(s);
		item.time = localTime(s);
		if (end) {
			const e = end.toJSDate();
			if (localDate(e) === item.date && e > s) item.endTime = localTime(e);
		}
	}
	if (source.location) item.location = source.location;
	return item;
}
