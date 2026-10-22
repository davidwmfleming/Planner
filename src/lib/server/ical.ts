// Converts planner items to and from iCalendar (.ics), the format CalDAV servers store.
// Events are VEVENTs and tasks are VTODOs, so any calendar app can read what the planner writes.
// Times are written as floating local times: the household lives in one time zone.
import ICAL from 'ical.js';
import { addDays } from '$lib/dates';
import type { Item, ItemState } from '$lib/item';

const PRODID = '-//davidwmfleming//Planner//EN';
/** Text a one-off change of a repeating item shares with its series unless it was changed for that day. */
const SERIES_TEXT = ['summary', 'location', 'description', 'categories'];

/** Keys older planners wrote in CATEGORIES, read as the names they stand for. Saving writes the name. */
const OLD_KEYS: Record<string, string> = { month: 'This month', waiting: 'Waiting', someday: 'Someday' };

/** Every CATEGORIES value of a component, over all its CATEGORIES lines, as text. */
const categoriesOf = (comp: ICAL.Component) =>
	comp.getAllProperties('categories').flatMap((p) => p.getValues().map(String)).filter((v) => v.trim() !== '');

/** A component's categories as the planner reads them: old keys as their names. */
const namesOf = (comp: ICAL.Component) => categoriesOf(comp).map((c) => OLD_KEYS[c.toLowerCase()] ?? c);

/** A category name as compared: an old key as its name, without regard to case or spaces at the ends. */
const categoryKey = (value: string) => (OLD_KEYS[value.trim().toLowerCase()] ?? value).trim().toLowerCase();

/** Whether any task in a stored document carries this category. False for a document that can't be read. */
export function carriesCategory(ics: string, name: string): boolean {
	try {
		const cal = new ICAL.Component(ICAL.parse(ics));
		return cal.getAllSubcomponents('vtodo').some((todo) => categoriesOf(todo).some((c) => categoryKey(c) === categoryKey(name)));
	} catch {
		return false;
	}
}

/**
 * A stored document with one category changed on every task in it (the series and each one-off change):
 * renamed to `to`, or taken off when `to` is undefined. A task that already has `to` doesn't get it twice. Everything
 * else (other categories, other lines, time zones) stays as it was. Undefined when nothing changes, so nothing is saved.
 */
export function withCategoryChanged(ics: string, from: string, to: string | undefined): string | undefined {
	const cal = new ICAL.Component(ICAL.parse(ics));
	let changed = false;
	const [fromKey, toKey] = [categoryKey(from), to === undefined ? undefined : categoryKey(to)];
	for (const todo of cal.getAllSubcomponents('vtodo')) {
		// A task that has `to` already keeps it as it is spelled there, and just loses `from`.
		const hasTo = toKey !== fromKey && categoriesOf(todo).some((c) => categoryKey(c) === toKey);
		let given = false;
		for (const prop of todo.getAllProperties('categories')) {
			const values = prop.getValues().map(String);
			const next: string[] = [];
			for (const value of values) {
				if (categoryKey(value) !== fromKey) next.push(value);
				else if (to !== undefined && !hasTo && !given) {
					next.push(to);
					given = true;
				}
			}
			if (next.length === values.length && next.every((v, i) => v === values[i])) continue;
			changed = true;
			if (next.length) prop.setValues(next);
			else todo.removeProperty(prop);
		}
	}
	return changed ? cal.toString() : undefined;
}

/**
 * A stored document with a DUE added to each task that has a start but no due date, so Apple Reminders shows its day.
 * The DUE is a copy of the start, time zone included; everything else stays as it was. A task with a DURATION is left
 * alone, as the standard allows only one of the two. Undefined when nothing changes, so nothing is saved.
 */
export function withDueDates(ics: string): string | undefined {
	const cal = new ICAL.Component(ICAL.parse(ics));
	let changed = false;
	for (const todo of cal.getAllSubcomponents('vtodo')) {
		const start = todo.getFirstProperty('dtstart');
		if (!start || !(start.getFirstValue() instanceof ICAL.Time) || todo.hasProperty('due') || todo.hasProperty('duration')) continue;
		// A copy: toJSON() hands back the start's own line, so renaming it in place would turn DTSTART into DUE.
		const due = structuredClone(start.toJSON());
		due[0] = 'due';
		todo.addProperty(new ICAL.Property(due));
		changed = true;
	}
	return changed ? cal.toString() : undefined;
}

/** A property's value as text, to tell whether a one-off change has its own. CATEGORIES can hold several, and are
 * compared as names without regard to case, so a day written with "This month" still matches a series with "month". */
const textOf = (comp: ICAL.Component, name: string) =>
	name === 'categories' ? namesOf(comp).join(',').toLowerCase() : String(comp.getFirstPropertyValue(name) ?? '');

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
					if (textOf(one, name) !== textOf(oldMaster, name)) continue;
					one.removeAllProperties(name);
					for (const p of comp.getAllProperties(name)) one.addProperty(new ICAL.Property(p.toJSON()));
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
	comp.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true)); // in UTC, as the standard requires
	comp.addPropertyWithValue('summary', item.title);
	if (item.location) comp.addPropertyWithValue('location', item.location);
	if (item.notes) comp.addPropertyWithValue('description', item.notes);
	if (item.categories?.length) {
		const categories = new ICAL.Property('categories');
		categories.setValues(item.categories);
		comp.addProperty(categories);
	}
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
			// DUE is the date Apple Reminders and most task apps show; DTSTART is kept for repeats and older readers.
			const when = () => (item.time ? dateTimeValue(item.date!, item.time) : dateValue(item.date!));
			comp.addPropertyWithValue('dtstart', when());
			comp.addPropertyWithValue('due', when());
		}
		const status = { open: 'NEEDS-ACTION', done: 'COMPLETED', dropped: 'CANCELLED' }[item.state];
		comp.addPropertyWithValue('status', status);
		if (item.state === 'done') comp.addPropertyWithValue('completed', ICAL.Time.fromJSDate(new Date(), true));
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

/** Most showings of one repeating item on a single day; more than this and it isn't something to plan around. */
const MOST_A_DAY = 4;
/** Most steps through one item's repeats, and through all of a page's, before giving up on working them out. */
const MOST_STEPS = 5_000;
const MOST_PAGE_STEPS = 20_000;

/** How many steps through repeats one page may still take, shared by all its items so it stays quick. */
export type StepBudget = { steps: number };
export const pageStepBudget = (): StepBudget => ({ steps: MOST_PAGE_STEPS });

const WEEKDAY = '(MO|TU|WE|TH|FR|SA|SU)';
/** Longest each month can be; February counts its leap day. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The repeat rules the planner works out, and the parts each may use. Every calendar app's ordinary repeats fit
 * (iPhone and Mac Calendar, Google, Outlook): every n days or weeks on chosen weekdays; monthly on chosen dates,
 * on "the 2nd Tuesday" or "the last weekday"; yearly on a date or on "the 2nd Sunday of March". Anything else is
 * refused, because ical.js can loop forever on rules that can never happen (February 30th, "the 1st Monday" of a
 * daily rule, "the 6th Monday of February") and gets others wrong. Each rule is read from the text itself,
 * because ical.js quietly reads a bad value (INTERVAL=-2, say) as something else.
 */
function checkRule(text: string) {
	const refuse = (why: string): never => {
		throw new Error(`Repeat rule the planner can't show: ${why}`);
	};
	const rule = new Map<string, string>();
	// Empty parts, as a trailing semicolon leaves, say nothing and are passed over.
	for (const part of text.toUpperCase().split(';').filter((p) => p.trim())) {
		const [key, value, ...extra] = part.split('=');
		if (value === undefined || extra.length || rule.has(key)) refuse(`badly written part ${key}`);
		rule.set(key, value);
	}
	const freq = rule.get('FREQ') ?? '';
	const allowed: Record<string, string[]> = { DAILY: ['BYDAY'], WEEKLY: ['BYDAY'], MONTHLY: ['BYDAY', 'BYMONTHDAY', 'BYSETPOS'], YEARLY: ['BYMONTH', 'BYMONTHDAY', 'BYDAY', 'BYSETPOS'] };
	if (!allowed[freq]) refuse(`repeats ${freq.toLowerCase() || 'with no frequency'}, more often than daily`);
	// An app's own X- parts (Evolution writes X-EVOLUTION-ENDDATE) are allowed by the standard and change nothing.
	for (const key of rule.keys()) if (!key.startsWith('X-') && !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', ...allowed[freq]].includes(key)) refuse(`${key} with ${freq}`);

	const whole = (key: string, lowest: number, highest: number, signed = false) => {
		const value = rule.get(key);
		if (value === undefined) return [];
		return value.split(',').map((one) => {
			if (!(signed ? /^[+-]?\d{1,9}$/ : /^\+?\d{1,9}$/).test(one)) refuse(`${key} is not whole numbers`);
			const n = Number(one);
			if (Math.abs(n) < lowest || Math.abs(n) > highest) refuse(`${key} out of range`);
			return n;
		});
	};
	const [interval = 1] = whole('INTERVAL', 1, 999);
	whole('COUNT', 1, 999_999_999);
	if (rule.has('WKST') && !new RegExp(`^${WEEKDAY}$`).test(rule.get('WKST')!)) refuse('WKST is not a weekday');
	if (rule.has('UNTIL') && !/^\d{8}(T\d{6}Z?)?$/.test(rule.get('UNTIL')!)) refuse('UNTIL is not a date');

	const months = whole('BYMONTH', 1, 12);
	const days = rule.get('BYDAY')?.split(',') ?? [];
	const plainDays = days.every((d) => new RegExp(`^${WEEKDAY}$`).test(d));
	// "The 2nd Tuesday" or "the last Friday": only of a month, as there are at most five of each weekday in one.
	if (!plainDays && (freq === 'DAILY' || freq === 'WEEKLY' || !days.every((d) => new RegExp(`^[+-]?[1-5]${WEEKDAY}$`).test(d)))) refuse('BYDAY is not weekdays');
	const longest = freq === 'YEARLY' ? Math.min(...months.map((m) => MONTH_DAYS[m - 1])) : 31;
	const monthDays = whole('BYMONTHDAY', 1, longest, true);
	const setPos = whole('BYSETPOS', 1, 5, true);
	// Within a year, days and positions are only those of the chosen months.
	if (freq === 'YEARLY' && (days.length || monthDays.length) && !months.length) refuse('a yearly day with no month');
	if (setPos.length && (!days.length || !plainDays || monthDays.length)) refuse('BYSETPOS without plain weekdays');
	if (freq === 'YEARLY' && days.length && monthDays.length) refuse('both weekdays and dates in a year');
	if (monthDays.length && !plainDays) refuse('both "the nth weekday" and dates');

	// Some rules can match no day at all from some starts, and then ical.js looks forever. They are only allowed where
	// every step of the repeat surely has a day: every 7th day on other weekdays never comes, nor does the 31st when
	// every 12th month is a 30-day one, nor the 5th Monday or 29 February when every 4th year never has one.
	const fifth = days.some((d) => /^[+-]?5/.test(d)) || (days.length === 1 && setPos.some((p) => Math.abs(p) === 5));
	if (freq === 'DAILY' && days.length && interval % 7 === 0) refuse('weekdays every 7th day');
	if (freq === 'MONTHLY' && interval % 12 === 0 && (fifth || monthDays.some((d) => Math.abs(d) >= 29))) refuse('a day not in every month, every 12th month');
	if (freq === 'MONTHLY' && interval > 1 && days.length && monthDays.length) refuse('both weekdays and dates, not every month');
	const leapDay = months.includes(2) && monthDays.some((d) => Math.abs(d) === 29);
	if (freq === 'YEARLY' && interval > 1 && (fifth || leapDay)) refuse('a day not in every year, not every year');
}

/** Most skipped and extra days (EXDATE and RDATE values) one document may list; past that it is a flood, not a plan. */
const MOST_LISTED_DAYS = 2_000;

/**
 * Throws if any repeat rule of an event or task in the document isn't one the planner works out (see checkRule),
 * or if the document lists more than MOST_LISTED_DAYS skipped and extra days, which ical.js would sort and step
 * through whatever the step budget says.
 */
function checkRepeatRules(ics: string) {
	const within: string[] = [];
	let listed = 0;
	for (const line of ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
		const [, begin] = /^BEGIN:(\S+)/i.exec(line) ?? [];
		// The value starts after the first colon that isn't inside a quoted parameter (a TZID, say).
		const value = () => line.replace(/"[^"]*"/g, '').replace(/^[^:]*:/, '');
		if (begin) within.push(begin.toUpperCase());
		else if (/^END:/i.test(line)) within.pop();
		else if (/^(EXDATE|RDATE)[;:]/i.test(line)) {
			listed += value().split(',').length;
			if (listed > MOST_LISTED_DAYS) throw new Error(`Lists more than ${MOST_LISTED_DAYS} skipped or extra days, more than the planner can work out`);
		} else if (/^(RRULE|EXRULE)[;:]/i.test(line) && ['VEVENT', 'VTODO'].includes(within.at(-1) ?? '')) checkRule(value().trim());
	}
}

/**
 * Where to start working out a long-running series so it doesn't step through every past showing: a whole number of
 * its periods on (days or weeks for a daily or weekly rule, whole years for a monthly or yearly one, so each month and
 * date still lines up), still before any showing that could touch `from`. Undefined when it can't safely move: other
 * shapes, extra days, or a count that weekdays or months would make hard to follow.
 */
function laterStart(master: ICAL.Component, dtstart: ICAL.Time, from: string, length: number): { start: ICAL.Time; count?: number; rule: ICAL.Recur } | undefined {
	const rules = master.getAllProperties('rrule');
	if (rules.length !== 1 || master.hasProperty('rdate')) return undefined;
	const rule = rules[0].getFirstValue() as ICAL.Recur;
	const interval = rule.interval || 1;
	const lastBefore = addDays(from, -length - 1);
	const start = dtstart.clone();
	if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') {
		if (rule.count && rule.parts.BYDAY?.length) return undefined;
		const period = interval * (rule.freq === 'WEEKLY' ? 7 : 1);
		const periods = Math.floor(dayCount(isoDate(dtstart), lastBefore) / period);
		if (periods <= 0) return undefined;
		start.adjust(periods * period, 0, 0, 0);
		// A count of n showings from the old start is n less the showings skipped.
		return { start, count: rule.count ? rule.count - periods : undefined, rule };
	}
	if (rule.count) return undefined;
	const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
	const years = rule.freq === 'YEARLY' ? interval : interval / gcd(interval, 12);
	let periods = Math.floor((Number(lastBefore.slice(0, 4)) - dtstart.year) / years);
	const dayIn = (n: number) => `${String(dtstart.year + n * years).padStart(4, '0')}${isoDate(dtstart).slice(4)}`;
	// A start on 29 February moves only to another leap year, so it is still a real day.
	const fits = (n: number) => !(dtstart.month === 2 && dtstart.day === 29) || ICAL.Time.isLeapYear(dtstart.year + n * years);
	while (periods > 0 && (dayIn(periods) > lastBefore || !fits(periods))) periods--;
	if (periods <= 0) return undefined;
	start.year += periods * years;
	return { start, rule };
}

/**
 * Every showing of a repeating item that touches the days from..to (inclusive), with one-off changes applied.
 * Throws, without working them all out, for a repeat that would crowd the page or that can't be worked out
 * quickly: a rule the planner doesn't show (see checkRule), more than MOST_A_DAY showings on any day, or more
 * steps than this item or the page's budget allows.
 */
export function occurrencesBetween(ics: string, from: string, to: string, budget: StepBudget = pageStepBudget()): Item[] {
	const { master, overrides } = parts(ics);
	if (!master || !master.hasProperty('rrule')) return [];
	checkRepeatRules(ics);
	const series = componentToItem(master);
	if (!series.date) return [];
	const length = series.endDate ? dayCount(series.date, series.endDate) : 0;
	const touches = (i: Item) => !!i.date && i.date <= to && (i.endDate ?? i.date) >= from;

	const shown: Item[] = [];
	let dtstart = master.getFirstPropertyValue('dtstart') as ICAL.Time;
	const later = laterStart(master, dtstart, from, length);
	if (later) {
		dtstart = later.start;
		// The count is changed on the document's own series, never on a copy: a copy is cut off from the document's
		// time zones, so its skipped days (EXDATE;TZID=...) would no longer match. Each call reads the document afresh.
		if (later.count !== undefined) {
			const rule = later.rule.clone();
			rule.count = later.count;
			master.getFirstProperty('rrule')!.setValue(rule);
		}
	}
	// A count all used up before the page: nothing of the series is left to show.
	const expansion = later?.count !== undefined && later.count <= 0 ? undefined : new ICAL.RecurExpansion({ component: master, dtstart });
	let lastDay = '';
	let onLastDay = 0;
	for (let steps = 0; expansion; steps++) {
		if (steps >= MOST_STEPS || budget.steps-- <= 0) throw new Error('Repeats too many times before this page to work out quickly');
		const next = expansion.next();
		if (!next) break;
		const day = isoDate(next);
		if (day > to) break;
		// Showings come in order, so counting each day's as they come is enough; this also caps the page's total.
		onLastDay = day === lastDay ? onLastDay + 1 : 1;
		lastDay = day;
		if (onLastDay > MOST_A_DAY) throw new Error(`Repeats more than ${MOST_A_DAY} times a day, more than the planner can show`);
		if (addDays(day, length) < from || overrides.has(day)) continue;
		shown.push(showing(series, day));
	}
	for (const [day, comp] of overrides) {
		const changed = { ...componentToItem(comp), occurrence: day, seriesStart: series.date, recurrence: series.recurrence };
		if (touches(changed)) shown.push(changed);
	}
	return shown;
}

/** One showing of a repeating item as it stands now: the day's one-off change if there is one, or else the series on that day. */
export function occurrenceOn(ics: string, day: string): Item | undefined {
	const { master, overrides } = parts(ics);
	if (!master) return undefined;
	const existing = overrides.get(day);
	return existing ? { ...componentToItem(existing), occurrence: day } : showing(componentToItem(master), day);
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

	// A task's day is its DUE, the date Apple Reminders shows and changes, unless it repeats: repeats count from DTSTART.
	// Only a real date or time counts: a DUE written as a period or text by a faulty app falls back to DTSTART.
	const timeOf = (name: string) => {
		const v = comp.getFirstPropertyValue(name);
		return v instanceof ICAL.Time ? v : null;
	};
	const due = kind === 'task' ? timeOf('due') : null;
	const start = (!comp.hasProperty('rrule') && due) || timeOf('dtstart') || due;
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
	const categories = namesOf(comp);
	if (categories.length) item.categories = categories;
	const rrule = comp.getFirstPropertyValue('rrule') as ICAL.Recur | null;
	if (rrule) item.recurrence = rrule.toString();

	return item;
}
