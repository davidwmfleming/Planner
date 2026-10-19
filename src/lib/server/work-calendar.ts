// The work calendar, read from the link Outlook gives when a calendar is published (WORK_CALENDAR_URL).
// That link lets anyone read the calendar, so it lives in .env like a password. Nothing from it is
// stored: the latest copy is kept in memory for a few minutes so page flips stay fast.
import { readFile } from 'node:fs/promises';
import { env } from '$env/dynamic/private';
import type { Item } from '$lib/item';
import { feedEventsBetween } from './feed';

const FRESH_FOR = 10 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

let cached: { ics: string; at: number } | undefined;

export interface WorkEvents {
	events: Item[];
	/** Set when the calendar couldn't be read; events then come from the last copy, if any. */
	problem?: string;
}

export async function workEventsBetween(from: string, to: string): Promise<WorkEvents> {
	const url = env.WORK_CALENDAR_URL?.trim();
	if (!url) return { events: [] };
	let problem: string | undefined;
	if (!cached || Date.now() - cached.at > FRESH_FOR) {
		try {
			cached = { ics: await download(url), at: Date.now() };
		} catch (e) {
			problem = `The work calendar couldn't be read${cached ? '; showing the last copy' : ''}. (${(e as Error).message})`;
		}
	}
	if (!cached) return { events: [], problem };
	try {
		return { events: feedEventsBetween(cached.ics, from, to, 'work'), problem };
	} catch (e) {
		return { events: [], problem: `The work calendar couldn't be understood. (${(e as Error).message})` };
	}
}

async function download(url: string): Promise<string> {
	// Outlook hands out webcal:// links; they are the same address over https.
	const address = url.replace(/^webcal:/i, 'https:');
	// file: is for trying the planner with a sample calendar on a computer, not for real use.
	if (address.startsWith('file:')) return readFile(new URL(address), 'utf8');
	if (!address.startsWith('https:')) throw new Error('the link must start with https:// or webcal://');
	const res = await fetch(address, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
	if (!res.ok) throw new Error(`the server answered ${res.status}`);
	const text = await res.text();
	if (text.length > MAX_BYTES) throw new Error('it is larger than expected');
	if (!text.includes('BEGIN:VCALENDAR')) throw new Error('the link did not return a calendar');
	return text;
}
