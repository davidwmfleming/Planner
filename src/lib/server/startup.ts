// What the planner does with the calendar server each time it starts.
import { parseSettings } from '$lib/settings';
import type { CalendarStore } from './calendar-store';

export interface StartOptions {
	/** Event calendars made on a first run, besides Work. */
	startingCalendars: string[];
	/** Names that fill in the Work and default choices the first time (WORK_CALENDAR and EVENTS_CALENDAR in .env). */
	workCalendar: string;
	eventsCalendar: string;
	/** The list every task lives in, which also holds the settings. */
	tasksCalendar: string;
}

type Store = Pick<CalendarStore, 'calendars' | 'ensureCalendar' | 'renameCalendar' | 'storedSettings' | 'writeSettings'>;

/** The collection holding every task and the settings: the one with that name, else the first that takes tasks. */
export function tasksCalendarUrl(store: Pick<CalendarStore, 'calendars'>, name: string): string | undefined {
	const options = store.calendars().filter((c) => c.accepts.includes('task'));
	return (options.find((c) => c.name === name) ?? options[0])?.url;
}

/** A step that fails is logged and skipped, so the planner still starts and shows what it can. */
export async function prepareStore(store: Store, options: StartOptions): Promise<void> {
	// "Personal" was the first name for David's own calendar; it is now "Me".
	if (!store.calendars().some((c) => c.name === 'Me')) await store.renameCalendar('Personal', 'Me').catch((e) => console.error('Could not rename Personal to Me', e));
	// Settings stored on Tasks mean the planner has run before. If they can't be read, nothing is made or
	// written: guessing "first run" could bring back deleted calendars or overwrite David's settings.
	let stored: string | undefined;
	const existingTasks = tasksCalendarUrl(store, options.tasksCalendar);
	try {
		stored = existingTasks ? await store.storedSettings(existingTasks) : undefined;
	} catch (e) {
		console.error('Could not read the settings; leaving the calendars and settings as they are', e);
		return;
	}
	if (stored !== undefined) return;
	// The starting calendars are made only on a first run (no event calendars at all), so one David deletes stays deleted.
	if (!store.calendars().some((c) => c.accepts.includes('event'))) {
		for (const name of [...options.startingCalendars, options.workCalendar]) {
			await store.ensureCalendar(name, ['event']).catch((e) => console.error(`Could not create the ${name} calendar`, e));
		}
	}
	if (!tasksCalendarUrl(store, options.tasksCalendar)) {
		await store.ensureCalendar(options.tasksCalendar, ['task']).catch((e) => console.error(`Could not create the ${options.tasksCalendar} list`, e));
	}
	// The Work and default choices come from .env only until settings are first stored; after that the settings page owns them.
	const tasks = tasksCalendarUrl(store, options.tasksCalendar);
	if (!tasks) return;
	try {
		const seed = { workCalendar: options.workCalendar, defaultEventCalendar: options.eventsCalendar };
		await store.writeSettings(tasks, parseSettings(undefined, store.calendars(), seed));
	} catch (e) {
		console.error('Could not store the starting settings', e);
	}
}
