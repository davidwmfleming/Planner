// "Download everything": a zip holding one .ics file per calendar, so each one can be imported into
// its own calendar elsewhere (Apple Calendar and Google Calendar import a file into one chosen calendar).
import { strToU8, Zip, ZipDeflate } from 'fflate';
import type { Calendar, CalendarStore } from './calendar-store';

export const exportZipName = (date: string) => `planner-export-${date}.zip`;

// Characters that some computer can't have in a file name, plus control characters.
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
// Names Windows keeps for devices, with or without an extension (NUL.txt is as bad as NUL).
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** A calendar name made safe to unzip anywhere: no folders, no characters Windows or a Mac refuses. */
export function safeFileName(name: string): string {
	const cleaned = name.replace(UNSAFE, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
	const short = Array.from(cleaned).slice(0, 60).join('').trim(); // by character, so an emoji isn't cut in half
	if (!short) return 'Calendar';
	return RESERVED.test(short) ? `_${short}` : short;
}

/** One .ics file name per calendar. A clash (names differing only in case or odd characters) gets a number;
 * calendars are put in order of name, then address, first, so which one gets the plain name doesn't depend
 * on the order the server happens to list them in. */
export function exportFileNames(calendars: Calendar[]): { calendar: Calendar; file: string }[] {
	const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	const sorted = [...calendars].sort((a, b) => compare(a.name, b.name) || compare(a.url, b.url));
	const taken = new Set<string>();
	return sorted.map((calendar) => {
		const base = safeFileName(calendar.name);
		let file = `${base}.ics`;
		for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${base} (${n}).ics`;
		taken.add(file.toLowerCase());
		return { calendar, file };
	});
}

/** An export that failed for a reason worth telling David, such as which calendar the server wouldn't hand out. */
export class ExportError extends Error {}

/**
 * Fetches the calendars one at a time and compresses each as it arrives, so only one calendar's text
 * is held at once next to the (much smaller) zip. Building it whole before replying means a calendar
 * the server won't hand out gives a clear error rather than a half-downloaded file.
 */
export async function exportZip(store: CalendarStore): Promise<Uint8Array> {
	// Read the list afresh: calendars may have been added or deleted on a phone since the planner started.
	await store.refreshCalendars();
	const files = exportFileNames(store.calendars());
	const chunks: Uint8Array[] = [];
	let failure: Error | null = null;
	const zip = new Zip((error, chunk) => {
		if (error) failure = error;
		else chunks.push(chunk);
	});
	for (const { calendar, file: name } of files) {
		let ics: string | undefined;
		try {
			ics = await store.calendarFile(calendar.url);
		} catch (e) {
			throw new ExportError(`The calendar server did not hand out "${calendar.name}", so nothing was downloaded. Try again in a moment.`, { cause: e });
		}
		if (ics === undefined) continue; // deleted (on a phone) since the list was read
		const file = new ZipDeflate(name, { level: 6 });
		zip.add(file);
		file.push(strToU8(ics), true);
	}
	zip.end();
	if (failure) throw failure;
	const zipped = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of chunks) {
		zipped.set(c, at);
		at += c.length;
	}
	return zipped;
}
