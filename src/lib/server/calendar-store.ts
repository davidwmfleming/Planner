// Reads and writes planner items on a CalDAV server (Radicale in production and development).
import { DAVClient, type DAVCalendar } from 'tsdav';
import type { Item, ItemKind } from '$lib/item';
import { icsToItems, itemToICS } from './ical';

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
}

export interface Calendar {
	url: string;
	name: string;
	/** Which kinds of item the calendar accepts (from its supported components). */
	accepts: ItemKind[];
}

const ALL_COMPONENTS = { 'comp-filter': { _attributes: { name: 'VCALENDAR' } } };

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
		const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
		await this.client.makeCalendar({
			url: new URL(`${slug}/`, home).href,
			props: {
				displayname: name,
				'c:supported-calendar-component-set': {
					'c:comp': accepts.map((k) => ({ _attributes: { name: k === 'event' ? 'VEVENT' : 'VTODO' } }))
				}
			}
		});
		await this.refreshCalendars();
		const created = this.calendars().find((c) => c.name === name);
		if (!created) throw new Error(`Could not create the calendar "${name}"`);
		return created;
	}

	async listItems(): Promise<StoredItem[]> {
		const all: StoredItem[] = [];
		for (const calendar of this.davCalendars) {
			const objects = await this.client.fetchCalendarObjects({ calendar, filters: ALL_COMPONENTS });
			for (const obj of objects) {
				if (typeof obj.data !== 'string' || !obj.data.trim()) continue;
				for (const item of icsToItems(obj.data)) {
					all.push({ ...item, calendarUrl: calendar.url, url: obj.url, etag: obj.etag });
				}
			}
		}
		return all;
	}

	async create(calendarUrl: string, item: Item): Promise<StoredItem> {
		const calendar = this.calendarAt(calendarUrl);
		const filename = `${item.uid}.ics`;
		const res = await this.client.createCalendarObject({ calendar, filename, iCalString: itemToICS(item) });
		if (!res.ok) throw new Error(`Saving "${item.title}" failed (${res.status})`);
		return { ...item, calendarUrl, url: new URL(filename, calendar.url).href, etag: res.headers.get('etag') ?? undefined };
	}

	/** Saves changes. Fails if someone else changed the item since it was read, so no edit is silently lost. */
	async update(stored: StoredItem, changes: Partial<Item>): Promise<StoredItem> {
		const next: StoredItem = { ...stored, ...changes };
		const res = await this.client.updateCalendarObject({
			calendarObject: { url: stored.url, etag: stored.etag, data: itemToICS(next) }
		});
		if (!res.ok) throw new Error(`Saving "${stored.title}" failed (${res.status}); reload and try again`);
		return { ...next, etag: res.headers.get('etag') ?? undefined };
	}

	/** Saves an item exactly as given, dropping any field it no longer has. */
	async replace(stored: StoredItem, item: Item): Promise<StoredItem> {
		const res = await this.client.updateCalendarObject({
			calendarObject: { url: stored.url, etag: stored.etag, data: itemToICS(item) }
		});
		if (!res.ok) throw new Error(`Saving "${item.title}" failed (${res.status}); reload and try again`);
		return { ...item, calendarUrl: stored.calendarUrl, url: stored.url, etag: res.headers.get('etag') ?? undefined };
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
