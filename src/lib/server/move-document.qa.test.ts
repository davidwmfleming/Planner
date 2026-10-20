// QA's findings on CalendarStore.moveDocument (from the review of c4efaad), kept as tests.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { CalendarStore } from './calendar-store';

const ics = (uid: string, title: string) =>
	`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261019T120000Z\r\nDTSTART;VALUE=DATE:20261021\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

async function fromAndTo(answer: (method: string, path: string) => { status: number; body?: string }) {
	const asked: string[] = [];
	const server = createServer((req, res) => {
		asked.push(`${req.method} ${req.url}`);
		const { status, body = '' } = answer(req.method!, req.url!);
		res.writeHead(status, { 'Content-Type': 'text/calendar' }).end(body);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/david/`;
	const store = new CalendarStore({ serverUrl: base.replace('david/', ''), username: 'david', password: 'dev', timeoutMs: 500 });
	(store as unknown as { davCalendars: unknown }).davCalendars = [
		{ url: `${base}from/`, displayName: 'From' },
		{ url: `${base}to/`, displayName: 'To' }
	];
	const doc = { calendarUrl: `${base}from/`, url: `${base}from/a.ics`, etag: '"1"', ics: ics('a', 'Swim') };
	return { store, doc, to: `${base}to/`, asked, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

describe('moving a document (QA proposals)', () => {
	it('does not call it moved when the old copy vanished before it was removed (deleted on a phone, or moved elsewhere by another device)', async () => {
		// The copy is made, then the old one is already gone: either David deleted it on his phone (the copy brings it back)
		// or another device moved it to a third calendar (now it is in two). Either way "moved" hides it from the page.
		const s = await fromAndTo((m) => ({ status: m === 'PUT' ? 201 : 404 }));
		try {
			const outcome = await s.store.moveDocument(s.doc, s.to);
			const tookCopyBack = s.asked.includes('DELETE /david/to/a.ics');
			expect(outcome === 'both' || tookCopyBack, `outcome ${outcome}, asked ${s.asked.join(', ')}`).toBe(true);
		} finally {
			await s.close();
		}
	});

});
