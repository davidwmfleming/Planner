// Renaming a task category, or taking one off every task, on the tasks stored in the calendar server.
// A category is a CATEGORIES value on each task, so a change to the list in the settings is carried to the tasks too.
import type { Settings } from '$lib/settings';
import { RefusedError, unanswered, type CalendarStore, type StoredDocument } from './calendar-store';
import { carriesCategory, withCategoryChanged } from './ical';

/** Where the settings are read and saved (on the Tasks collection). */
export interface SettingsPlace {
	read(): Promise<Settings>;
	write(settings: Settings): Promise<void>;
}

/** What a change to the tasks of a category did: how many tasks were changed, how many the calendar server refused
 * (changed on a phone since they were read, say), and whether it stopped answering, so that some may or may not be done. */
export interface Recategorised {
	changed: number;
	refused: number;
	unsure: boolean;
}

const GONE = [404, 410];
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Every stored document, in every calendar that takes tasks, with a task carrying this category (any case, old keys too).
 * A repeating task is one document, so it counts once. */
export async function tasksWith(store: CalendarStore, name: string): Promise<StoredDocument[]> {
	await store.refreshCalendars();
	const found: StoredDocument[] = [];
	for (const calendar of store.calendars().filter((c) => c.accepts.includes('task'))) {
		try {
			const { documents } = await store.documents(calendar.url);
			found.push(...documents.filter((d) => carriesCategory(d.ics, name)));
		} catch (e) {
			// Deleted on a phone since the list was read: it holds nothing now.
			if (e instanceof RefusedError && GONE.includes(e.status)) continue;
			throw e;
		}
	}
	return found;
}

/** Gives each task carrying `from` the category `to` instead, or none. Each document is saved only if it is still the
 * version read, so a change made on a phone meanwhile is never overwritten; it is counted as refused instead. */
export async function recategorise(store: CalendarStore, from: string, to: string | undefined): Promise<Recategorised> {
	const done: Recategorised = { changed: 0, refused: 0, unsure: false };
	for (const doc of await tasksWith(store, from)) {
		const ics = withCategoryChanged(doc.ics, from, to);
		if (!ics) continue;
		try {
			await store.saveDocument(doc, ics);
			done.changed++;
		} catch (e) {
			// Deleted on a phone meanwhile: nothing left to change.
			if (e instanceof RefusedError && GONE.includes(e.status)) continue;
			if (e instanceof RefusedError && e.status < 500) {
				done.refused++;
				continue;
			}
			// No answer, or a server error: it may still be saved. Stop rather than guess.
			if (unanswered(e) || e instanceof RefusedError) {
				done.unsure = true;
				break;
			}
			throw e;
		}
	}
	return done;
}

const finished = (r: Recategorised) => r.refused === 0 && !r.unsure;

/**
 * Renames a category in three steps, so that no task ever carries a name that isn't on the list: the new name goes on
 * the list (next to the old one, and the rename is noted), every task with the old name gets the new one, and then the
 * old name comes off. If it stops halfway, both names stay on the list, and the same rename run again finishes it.
 * A change of case only (waiting → Waiting) is the same category, so the list just changes once the tasks have.
 * Returns what was done to the tasks; the list is changed only when every task was.
 */
export async function renameCategory(store: CalendarStore, settings: SettingsPlace, from: string, to: string): Promise<Recategorised> {
	const before = await settings.read();
	if (!sameName(from, to) && !before.categories.some((c) => c === to)) {
		const categories = before.categories.flatMap((c) => (c === from ? [c, to] : [c]));
		await settings.write({ ...before, categories, renaming: { from, to } });
	}
	const done = await recategorise(store, from, to);
	if (!finished(done)) return done;
	// Read again, so a change saved meanwhile (on another device) is kept.
	const now = await settings.read();
	const categories = sameName(from, to) ? now.categories.map((c) => (c === from ? to : c)) : now.categories.filter((c) => c !== from);
	const next: Settings = { ...now, categories };
	delete next.renaming;
	await settings.write(next);
	return done;
}
