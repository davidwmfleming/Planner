// "Download everything": a zip holding one .ics file per calendar, so each one can be imported into
// its own calendar elsewhere (Apple Calendar and Google Calendar import a file into one chosen calendar).
import { strToU8, Zip, ZipDeflate } from 'fflate';
import type { CalendarStore } from './calendar-store';

export const exportZipName = (date: string) => `planner-export-${date}.zip`;

// Characters that some computer can't have in a file name, plus control characters.
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
// Names Windows keeps for devices, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A calendar name made safe to unzip anywhere: no folders, no characters Windows or a Mac refuses. */
export function safeFileName(name: string): string {
	const cleaned = name.replace(UNSAFE, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
	const short = Array.from(cleaned).slice(0, 60).join('').trim(); // by character, so an emoji isn't cut in half
	if (!short) return 'Calendar';
	return RESERVED.test(short) ? `_${short}` : short;
}

/** One .ics file name per calendar, in the same order; a clash (names differing only in case or odd characters) gets a number. */
export function exportFileNames(names: string[]): string[] {
	const taken = new Set<string>();
	return names.map((name) => {
		const base = safeFileName(name);
		let file = `${base}.ics`;
		for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${base} (${n}).ics`;
		taken.add(file.toLowerCase());
		return file;
	});
}

/**
 * Fetches the calendars one at a time and compresses each as it arrives, so only one calendar's text
 * is held at once next to the (much smaller) zip. Building it whole before replying means a calendar
 * the server won't hand out gives a clear error rather than a half-downloaded file.
 */
export async function exportZip(store: CalendarStore): Promise<Uint8Array> {
	const calendars = store.calendars();
	const files = exportFileNames(calendars.map((c) => c.name));
	const chunks: Uint8Array[] = [];
	let failure: Error | null = null;
	const zip = new Zip((error, chunk) => {
		if (error) failure = error;
		else chunks.push(chunk);
	});
	for (const [i, calendar] of calendars.entries()) {
		const ics = await store.calendarFile(calendar.url);
		const file = new ZipDeflate(files[i], { level: 6 });
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
