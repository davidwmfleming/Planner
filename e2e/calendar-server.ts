import type { APIRequestContext } from '@playwright/test';

// What another device (a phone, the Mac) does to the calendars, through the planner's calendar-app address.
const auth = { Authorization: `Basic ${Buffer.from('david:dev').toString('base64')}` };

/** Makes a calendar at /david/<slug>/ with this name, taking these kinds of entry. Returns its path as the planner names it. */
export async function makeCalendar(request: APIRequestContext, slug: string, name: string, components = ['VEVENT']) {
	const comps = components.map((c) => `<c:comp name="${c}"/>`).join('');
	const body = `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>${name}</d:displayname><c:supported-calendar-component-set>${comps}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`;
	const made = await request.fetch(`/dav/david/${slug}/`, { method: 'MKCALENDAR', headers: { ...auth, 'Content-Type': 'application/xml' }, data: body });
	if (!made.ok()) throw new Error(`MKCALENDAR ${slug}: ${made.status()}`);
	return `/david/${slug}/`;
}

/** Deletes a calendar, given its path as the planner names it (/david/<slug>/). */
export async function deleteCalendar(request: APIRequestContext, path: string) {
	await request.fetch(`/dav${path}`, { method: 'DELETE', headers: auth });
}

/** Saves a calendar entry (.ics text) under this file name in a calendar, as a phone would. */
export async function putEntry(request: APIRequestContext, path: string, filename: string, ics: string) {
	const saved = await request.fetch(`/dav${path}${filename}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'text/calendar' }, data: ics });
	if (!saved.ok()) throw new Error(`PUT ${path}${filename}: ${saved.status()}`);
}

/** Whether a calendar holds an entry under this file name, as a phone syncing it would see. */
export async function hasEntry(request: APIRequestContext, path: string, filename: string) {
	const read = await request.fetch(`/dav${path}${filename}`, { headers: auth });
	if (read.status() !== 200 && read.status() !== 404) throw new Error(`GET ${path}${filename}: ${read.status()}`);
	return read.status() === 200;
}

const SETTINGS_PROP = '<p:planner-settings xmlns:p="urn:planner:ns"/>';

/** The planner's settings as stored on the Tasks list, as any calendar app could read them. */
export async function readSettings(request: APIRequestContext): Promise<Record<string, unknown>> {
	const read = await request.fetch('/dav/david/tasks/', {
		method: 'PROPFIND',
		headers: { ...auth, Depth: '0', 'Content-Type': 'application/xml' },
		data: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>${SETTINGS_PROP}</d:prop></d:propfind>`
	});
	const text = /<(?:\w+:)?planner-settings[^>]*>([^<]*)</.exec(await read.text())?.[1] ?? '{}';
	return JSON.parse(text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

/** Stores the planner's settings on the Tasks list, as any calendar app could. */
export async function writeSettings(request: APIRequestContext, settings: Record<string, unknown>) {
	const value = JSON.stringify(settings).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const saved = await request.fetch('/dav/david/tasks/', {
		method: 'PROPPATCH',
		headers: { ...auth, 'Content-Type': 'application/xml; charset=utf-8' },
		data: `<?xml version="1.0" encoding="utf-8"?><d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><p:planner-settings xmlns:p="urn:planner:ns">${value}</p:planner-settings></d:prop></d:set></d:propertyupdate>`
	});
	if (!saved.ok()) throw new Error(`PROPPATCH settings: ${saved.status()}`);
}
