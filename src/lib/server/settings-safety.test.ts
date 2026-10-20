// The planner must not lose David's settings or stop working when the calendar server hiccups or changes under it.
// Runs against a real Radicale in a temporary folder (skipped if Radicale isn't installed), like calendar-store.test.ts.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalendarStore } from './calendar-store';
import { prepareStore } from './startup';
import { parseSettings } from '$lib/settings';

const hasRadicale = spawnSync('python3', ['-m', 'radicale', '--version']).status === 0;
const PORT = 5296; // Radicale
const PROXY = 5295; // in front of it, can fail chosen requests
const options = { startingCalendars: ['Me', 'Family', 'Workouts', 'Morgan Meals'], workCalendar: 'Work', eventsCalendar: 'Me', tasksCalendar: 'Tasks' };

describe('parseSettings', () => {
	it('drops repeated categories, so the settings page (keyed by name) still opens', () => {
		// ["Waiting","Waiting"] made Svelte throw each_key_duplicate: the gear changed the URL but the page never showed.
		expect(parseSettings(JSON.stringify({ categories: ['Waiting', 'Waiting', 'waiting'] }), []).categories).toEqual(['Waiting']);
	});
});

describe.skipIf(!hasRadicale)('settings and calendars stay safe when the calendar server misbehaves', () => {
	let radicale: ChildProcess;
	let proxy: Server;
	let dir: string;
	let failSettingsRead = false;
	const url = (port: number) => `http://127.0.0.1:${port}/`;
	const connect = async (port: number) => {
		const s = new CalendarStore({ serverUrl: url(port), username: 'david', password: 'dev' });
		await s.connect();
		return s;
	};

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'planner-qa-'));
		radicale = spawn('bash', ['scripts/dev-calendar.sh'], { env: { ...process.env, DEV_CALENDAR_DIR: dir, DEV_CALENDAR_PORT: String(PORT) }, stdio: 'ignore' });
		for (let i = 0; i < 50; i++) {
			try {
				await fetch(url(PORT));
				break;
			} catch {
				await new Promise((r) => setTimeout(r, 100));
			}
		}
		proxy = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => {
				const body = Buffer.concat(chunks);
				if (failSettingsRead && req.method === 'PROPFIND' && body.includes('planner-settings')) {
					res.writeHead(500).end();
					return;
				}
				const up = request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
					res.writeHead(r.statusCode ?? 502, r.headers);
					r.pipe(res);
				});
				up.end(body);
			});
		}).listen(PROXY);
	}, 15000);

	afterAll(() => {
		radicale?.kill();
		proxy?.close();
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('never overwrites stored settings when reading them fails with a server error', async () => {
		const direct = await connect(PORT);
		await prepareStore(direct, options);
		const tasks = direct.calendars().find((c) => c.name === 'Tasks')!.url;
		const mine = { categories: ['Errands', 'Kids'], workCalendar: null, defaultEventCalendar: new URL(direct.calendars().find((c) => c.name === 'Family')!.url).pathname };
		await direct.writeSettings(tasks, mine);

		failSettingsRead = true;
		try {
			await prepareStore(await connect(PROXY), options); // the planner restarting during a hiccup
		} finally {
			failSettingsRead = false;
		}
		expect(await direct.readSettings(tasks)).toEqual(mine);
	}, 15000);

	it('keeps working when a calendar is deleted by a phone while the planner runs', async () => {
		const store = await connect(PORT);
		const doomed = await store.ensureCalendar('Doomed', ['event']);
		const auth = `Basic ${Buffer.from('david:dev').toString('base64')}`;
		expect((await fetch(doomed.url, { method: 'DELETE', headers: { Authorization: auth } })).ok).toBe(true);
		// Today this throws "Collection query failed: 404", which the planner shows as a 503 on every page until restarted.
		await expect(store.listItems()).resolves.toBeInstanceOf(Array);
	});

	it('shows a calendar added on a phone without a restart', async () => {
		const store = await connect(PORT);
		const auth = `Basic ${Buffer.from('david:dev').toString('base64')}`;
		const url = new URL('david/from-phone/', `http://127.0.0.1:${PORT}/`).href;
		const body = '<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>From phone</d:displayname></d:prop></d:set></c:mkcalendar>';
		expect((await fetch(url, { method: 'MKCALENDAR', headers: { Authorization: auth, 'Content-Type': 'application/xml' }, body })).ok).toBe(true);
		await store.listItems();
		expect(store.calendars().map((c) => c.name)).toContain('From phone');
	});

	it('does not bring back the starting calendars once settings exist, even if every event calendar is gone', async () => {
		const store = await connect(PORT);
		const auth = `Basic ${Buffer.from('david:dev').toString('base64')}`;
		for (const c of store.calendars().filter((c) => c.accepts.includes('event'))) await fetch(c.url, { method: 'DELETE', headers: { Authorization: auth } });
		const restarted = await connect(PORT);
		expect(restarted.calendars().some((c) => c.accepts.includes('event'))).toBe(false);
		await prepareStore(restarted, options);
		// Settings already stored on Tasks prove this is not a first run (and guard against a listing that comes back empty).
		expect(restarted.calendars().map((c) => c.name)).toEqual(['Tasks']);
	}, 15000);
});
