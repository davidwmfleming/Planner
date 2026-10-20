// Reads and writes planner items on a CalDAV server (Radicale in production and development).
import { DAVClient, type DAVCalendar } from 'tsdav';
import type { Item, ItemKind } from '$lib/item';
import { parseSettings, type Settings, type SettingsSeed } from '$lib/settings';
import { icsToItems, itemToICS, withOccurrence, withoutOccurrence } from './ical';

export interface StoreConfig {
	serverUrl: string;
	username: string;
	password: string;
}

/** An item plus where it lives on the server, needed to update or delete it. */
export interface StoredItem extends Item {
	calendarUrl: string;
	url: string;
	etag?: string;
	/** The whole document as stored, so saving keeps what the planner doesn't show (a repeat's one-off changes, time zones). */
	ics: string;
}

export interface Calendar {
	url: string;
	name: string;
	/** Which kinds of item the calendar accepts (from its supported components). */
	accepts: ItemKind[];
}

/** The planner's own XML namespace, for the settings property it keeps on the Tasks collection. */
const PLANNER_NS = 'urn:planner:ns';

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ALL_COMPONENTS = { 'comp-filter': { _attributes: { name: 'VCALENDAR' } } };

/** A DAV property's text, whether the XML parser gave a plain value or a wrapper. */
function davText(value: unknown): string | undefined {
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	const wrapped = value as { _cdata?: unknown; _text?: unknown } | undefined;
	const inner = wrapped?._cdata ?? wrapped?._text;
	return typeof inner === 'string' ? inner : undefined;
}

export class CalendarStore {
	private client: DAVClient;
	private davCalendars: DAVCalendar[] = [];

	constructor(private config: StoreConfig) {
		this.client = new DAVClient({
			serverUrl: config.serverUrl,
			credentials: { username: config.username, password: config.password },
			authMethod: 'Basic',
			defaultAccountType: 'caldav'
		});
	}

	async connect(): Promise<void> {
		await this.client.login();
		await this.refreshCalendars();
	}

	private async refreshCalendars() {
		this.davCalendars = await this.client.fetchCalendars();
	}

	calendars(): Calendar[] {
		return this.davCalendars.map((c) => {
			const comps = (c.components ?? []).map((x) => x.toUpperCase());
			const accepts: ItemKind[] = [];
			if (comps.length === 0 || comps.includes('VEVENT')) accepts.push('event');
			if (comps.length === 0 || comps.includes('VTODO')) accepts.push('task');
			return { url: c.url, name: String(c.displayName ?? c.url), accepts };
		});
	}

	/** Creates a calendar if one with this name doesn't exist yet. Used for setup and seeding. */
	async ensureCalendar(name: string, accepts: ItemKind[]): Promise<Calendar> {
		const existing = this.calendars().find((c) => c.name === name);
		if (existing) return existing;
		const home = this.client.account?.homeUrl;
		if (!home) throw new Error('The calendar server did not report a home folder for this user');
		const made = this.client.makeCalendar({
			url: this.freeAddress(name, home),
			props: {
				displayname: name,
				'c:supported-calendar-component-set': {
					'c:comp': accepts.map((k) => ({ _attributes: { name: k === 'event' ? 'VEVENT' : 'VTODO' } }))
				}
			}
		});
		// Another program (or another copy of the planner) may create it at the same moment; that's fine.
		await made.catch(() => undefined);
		await this.refreshCalendars();
		const created = this.calendars().find((c) => c.name === name);
		if (!created) throw new Error(`Could not create the calendar "${name}"`);
		return created;
	}

	/** An address for a new calendar, from its name, that no calendar uses yet. A renamed calendar keeps
	 * its old address, so "Work" renamed to "Office" still sits at work/ and a new "Work" gets work-2/. */
	private freeAddress(name: string, home: string): string {
		const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'calendar';
		const used = new Set(this.calendars().map((c) => new URL(c.url).pathname));
		for (let n = 1; ; n++) {
			const url = new URL(`${n === 1 ? slug : `${slug}-${n}`}/`, home);
			if (!used.has(url.pathname)) return url.href;
		}
	}

	/** Changes a calendar's display name; its address and contents stay the same. Does nothing if it isn't there. */
	async renameCalendar(from: string, to: string): Promise<void> {
		const calendar = this.calendars().find((c) => c.name === from);
		if (calendar) await this.renameCalendarAt(calendar.url, to);
	}

	/** Renames the calendar at this address, so two calendars with the same name can't be mixed up. */
	async renameCalendarAt(url: string, to: string): Promise<void> {
		const status = await this.proppatch(url, `<d:displayname>${escapeXml(to)}</d:displayname>`);
		if (status >= 300) throw new Error(`The calendar server refused to rename ${url} (${status})`);
		await this.refreshCalendars();
	}

	/** The settings kept on a collection (the Tasks one), with defaults for anything not stored. */
	async readSettings(calendarUrl: string, seed?: SettingsSeed): Promise<Settings> {
		return parseSettings(await this.storedSettings(calendarUrl), this.calendars(), seed);
	}

	/** The settings exactly as stored, or undefined if nothing is stored there yet. */
	async storedSettings(calendarUrl: string): Promise<string | undefined> {
		const [response] = await this.client.propfind({
			url: calendarUrl,
			props: { 'p:planner-settings': { _attributes: { 'xmlns:p': PLANNER_NS } } },
			depth: '0'
		});
		// A missing property (or collection) comes back as 404; that just means the defaults.
		return response?.ok ? davText(response.props?.plannerSettings) : undefined;
	}

	async writeSettings(calendarUrl: string, settings: Settings): Promise<void> {
		const status = await this.proppatch(calendarUrl, `<p:planner-settings xmlns:p="${PLANNER_NS}">${escapeXml(JSON.stringify(settings))}</p:planner-settings>`);
		if (status >= 300) throw new Error(`The calendar server refused to save the settings (${status})`);
	}

	/** Sets one property on a collection and returns the status. Radicale answers 207 even when it refuses
	 * a property, with the real answer inside, so the first status that isn't a success is returned. */
	private async proppatch(url: string, prop: string): Promise<number> {
		const response = await fetch(url, {
			method: 'PROPPATCH',
			headers: {
				Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
				'Content-Type': 'application/xml; charset=utf-8'
			},
			body: `<?xml version="1.0" encoding="utf-8"?><d:propertyupdate xmlns:d="DAV:"><d:set><d:prop>${prop}</d:prop></d:set></d:propertyupdate>`
		});
		if (!response.ok) return response.status;
		const inner = [...(await response.text()).matchAll(/<(?:\w+:)?status>HTTP\/[\d.]+ (\d{3})/g)].map((m) => Number(m[1]));
		return inner.find((status) => status >= 300) ?? response.status;
	}

	async listItems(): Promise<StoredItem[]> {
		const all: StoredItem[] = [];
		for (const calendar of this.davCalendars) {
			// One query that returns everything, rather than a list followed by a fetch: an item added or
			// deleted between the two (on a phone, or by another page load) would make the fetch fail.
			const responses = await this.client.calendarQuery({
				url: calendar.url,
				props: { 'd:getetag': {}, 'c:calendar-data': {} },
				filters: ALL_COMPONENTS,
				depth: '1'
			});
			for (const res of responses) {
				const data = davText(res.props?.calendarData);
				if (!res.href || !data?.trim()) continue;
				const url = new URL(res.href, calendar.url).href;
				for (const item of icsToItems(data)) {
					all.push({ ...item, calendarUrl: calendar.url, url, etag: davText(res.props?.getetag), ics: data });
				}
			}
		}
		return all;
	}

	/** Saves a new item. Given the document of an item it replaces elsewhere, keeps that one's one-off changes. */
	async create(calendarUrl: string, item: Item, previous?: string): Promise<StoredItem> {
		const calendar = this.calendarAt(calendarUrl);
		const filename = `${item.uid}.ics`;
		const ics = itemToICS(item, previous);
		const res = await this.client.createCalendarObject({ calendar, filename, iCalString: ics });
		if (!res.ok) throw new Error(`Saving "${item.title}" failed (${res.status})`);
		return { ...item, calendarUrl, url: new URL(filename, calendar.url).href, etag: res.headers.get('etag') ?? undefined, ics };
	}

	/** Saves changes. Fails if someone else changed the item since it was read, so no edit is silently lost. */
	async update(stored: StoredItem, changes: Partial<Item>): Promise<StoredItem> {
		const { calendarUrl, url, etag, ics, ...item } = stored;
		return this.replace(stored, { ...item, ...changes });
	}

	/** Changes one showing of a repeating item, leaving the rest of the series as it is. */
	async updateOccurrence(stored: StoredItem, day: string, change: (current: Item) => Partial<Item>): Promise<void> {
		await this.put(stored, withOccurrence(stored.ics, day, change));
	}

	/** Removes one showing of a repeating item. */
	async removeOccurrence(stored: StoredItem, day: string): Promise<void> {
		await this.put(stored, withoutOccurrence(stored.ics, day));
	}

	private async put(stored: StoredItem, data: string): Promise<string | undefined> {
		const res = await this.client.updateCalendarObject({ calendarObject: { url: stored.url, etag: stored.etag, data } });
		if (!res.ok) throw new Error(`Saving "${stored.title}" failed (${res.status}); reload and try again`);
		return res.headers.get('etag') ?? undefined;
	}

	/** Saves an item exactly as given, dropping any field it no longer has. */
	async replace(stored: StoredItem, item: Item): Promise<StoredItem> {
		const ics = itemToICS(item, stored.ics);
		const etag = await this.put(stored, ics);
		return { ...item, calendarUrl: stored.calendarUrl, url: stored.url, etag, ics };
	}

	async remove(stored: StoredItem): Promise<void> {
		const res = await this.client.deleteCalendarObject({ calendarObject: { url: stored.url, etag: stored.etag } });
		if (!res.ok) throw new Error(`Deleting "${stored.title}" failed (${res.status})`);
	}

	private calendarAt(url: string): DAVCalendar {
		const calendar = this.davCalendars.find((c) => c.url === url);
		if (!calendar) throw new Error(`No calendar at ${url}`);
		return calendar;
	}
}
