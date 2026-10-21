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

type Store = Pick<CalendarStore, 'calendars' | 'addressFor' | 'ensureCalendar' | 'renameCalendar' | 'settingsAt' | 'writeSettings'>;

/** The collection holding every task and the settings, found by its address, which a rename on a phone doesn't change.
 * Undefined if the calendar listing doesn't show it. */
export function tasksCalendarUrl(store: Pick<CalendarStore, 'calendars' | 'addressFor'>, name: string): string | undefined {
	const url = store.addressFor(name);
	return store.calendars().find((c) => c.url === url && c.accepts.includes('task'))?.url;
}

/** A step that fails is logged and skipped, so the planner still starts and shows what it can. */
export async function prepareStore(store: Store, options: StartOptions): Promise<void> {
	// The settings are read straight from the Tasks address, not from the listing: a listing that comes back
	// empty must not look like a first run. If they can't be read, nothing is made or written: guessing
	// "first run" could bring back deleted calendars or overwrite David's settings.
	const tasks = store.addressFor(options.tasksCalendar);
	let found: Awaited<ReturnType<Store['settingsAt']>>;
	try {
		found = await store.settingsAt(tasks);
	} catch (e) {
		console.error('Could not read the settings; leaving the calendars and settings as they are', e);
		return;
	}
	// Stored settings mean the planner has run before; from then on the settings page owns every name and choice.
	if (found.stored !== undefined) return;
	// "Personal" was the first name for David's own calendar; it became "Me" before there were settings to rename it.
	if (!store.calendars().some((c) => c.name === 'Me')) await store.renameCalendar('Personal', 'Me').catch((e) => console.error('Could not rename Personal to Me', e));
	if (!found.found) {
		// Only no Tasks list at all (the server said so) and no event calendars means a first run.
		// The starting calendars are made only then, so one David deletes stays deleted.
		if (!store.calendars().some((c) => c.accepts.includes('event'))) {
			for (const name of [...options.startingCalendars, options.workCalendar]) {
				await store.ensureCalendar(name, ['event']).catch((e) => console.error('Could not create a starting calendar', e));
			}
		}
		try {
			await store.ensureCalendar(options.tasksCalendar, ['task'], tasks);
		} catch (e) {
			console.error('Could not create the task list', e);
			return;
		}
	}
	// The Work and default choices come from .env only until settings are first stored; after that the settings page owns them.
	// They are filled in from the listing, so a listing that can't even see Tasks waits for the next start.
	if (!tasksCalendarUrl(store, options.tasksCalendar)) return;
	try {
		const seed = { workCalendar: options.workCalendar, defaultEventCalendar: options.eventsCalendar };
		await store.writeSettings(tasks, parseSettings(undefined, store.calendars(), seed));
	} catch (e) {
		console.error('Could not store the starting settings', e);
	}
}
