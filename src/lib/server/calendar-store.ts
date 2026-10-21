// Reads and writes planner items on a CalDAV server (Radicale in production and development).
import { createHmac, randomBytes } from 'node:crypto';
import { DAVClient, type DAVCalendar } from 'tsdav';
import type { Item, ItemKind } from '$lib/item';
import { parseSettings, type Settings, type SettingsSeed } from '$lib/settings';
import { icsToItems, itemToICS, withOccurrence, withoutOccurrence } from './ical';

/** The key fingerprints in the log are made with. Each install has its own, kept on the Tasks collection beside the
 * settings (so in the data volume, and backed up), so fingerprints stay the same across restarts but nobody can work
 * out a calendar's name from a shared log by fingerprinting likely names. Until it is read, a key for this run only. */
let logKey = randomBytes(32);

/** Uses this install's key (64 hex characters) for fingerprints in the log from now on. */
export function useLogKey(key: string) {
	logKey = Buffer.from(key, 'hex');
}

const fingerprint = (text: string) => createHmac('sha256', logKey).update(text).digest('hex').slice(0, 8);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether an item's file name looks like a UID made by a program (a UUID, or a long run of mostly letters and digits
 * at random), not like words. Other apps can name files anything, the item's title included. */
function uidLike(stem: string): boolean {
	if (UUID.test(stem) || /^[0-9a-f]{16,}$/i.test(stem)) return true;
	const digits = stem.match(/\d/g)?.length ?? 0;
	return /^[a-z0-9]{16,}$/i.test(stem) && digits * 4 >= stem.length;
}

/** An address as it may appear in the server's log (house rule 4). A calendar's address is made from its name, so
 * each folder in it becomes a short fingerprint; so does an item's file name, unless it looks like a UID. */
export function logged(url: string): string {
	const path = /^[a-z]+:\/\//i.test(url) ? new URL(url).pathname : url;
	return path
		.split('/')
		.map((part, i) => {
			if (i < 2 || part === '') return part;
			if (!part.endsWith('.ics')) return fingerprint(part);
			const stem = part.slice(0, -'.ics'.length);
			return uidLike(stem) ? part : `${fingerprint(stem)}.ics`;
		})
		.join('/');
}

export interface StoreConfig {
	serverUrl: string;
	username: string;
	password: string;
	/** How long to wait for the calendar server before giving up (10 seconds unless a test says otherwise). */
	timeoutMs?: number;
}

/** An item plus where it lives on the server, needed to update or delete it. */
export interface StoredItem extends Item {
	calendarUrl: string;
	url: string;
	etag?: string;
	/** The whole document as stored, so saving keeps what the planner doesn't show (a repeat's one-off changes, time zones). */
	ics: string;
}

/** One stored document (an event or task with all its one-off changes) exactly as the server holds it. */
export interface StoredDocument {
	calendarUrl: string;
	url: string;
	etag?: string;
	ics: string;
}

/** What became of a document asked to move to another calendar:
 * moved (only in the new calendar), kept (surely only in the old one), both (the new copy is there, but so is
 * another: the old copy changed since it was read, so it wasn't removed, or it had already gone, deleted or moved
 * elsewhere by another device, or the same item with other details was already there), clash (surely only in the old
 * one: the new calendar holds a different item under that file name), or unsure (the server didn't answer: it may be in both). */
export type MoveOutcome = 'moved' | 'kept' | 'both' | 'clash' | 'unsure';

/** The UID of a stored document (its first one; one-off changes share it). */
const uidOf = (ics: string) => /^UID:(.*)$/m.exec(ics.replace(/\r?\n[ \t]/g, ''))?.[1]?.trim();

/** What the calendar server says about something that isn't there (any more). */
const GONE = [404, 410];

export interface Calendar {
	url: string;
	name: string;
	/** Which kinds of item the calendar accepts (from its supported components). */
	accepts: ItemKind[];
}

/** The planner's own XML namespace, for the settings property it keeps on the Tasks collection. */
const PLANNER_NS = 'urn:planner:ns';

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A calendar's address from its name, e.g. "Morgan Meals" → morgan-meals/. */
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'calendar';

const ALL_COMPONENTS = { 'comp-filter': { _attributes: { name: 'VCALENDAR' } } };

/** A DAV property's text, whether the XML parser gave a plain value or a wrapper. */
function davText(value: unknown): string | undefined {
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	const wrapped = value as { _cdata?: unknown; _text?: unknown } | undefined;
	const inner = wrapped?._cdata ?? wrapped?._text;
	return typeof inner === 'string' ? inner : undefined;
}

/** The calendar server answered and said no (an HTTP error status), so the change surely wasn't made.
 * Any other failure (no answer in time, a dropped connection) leaves it unknown: the server may still do it. */
export class RefusedError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

/** The calendar server didn't answer in time. It may still have done what was asked, or do it later. */
export class NoAnswerError extends Error {}

/** Whether a failure leaves it unknown if the change was made: no answer in time, or the connection dropped. */
export const unanswered = (e: unknown) => e instanceof NoAnswerError || (e instanceof TypeError && e.message === 'fetch failed');

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
		await this.timed(this.client.login(), 'signing in');
		await this.refreshCalendars();
	}

	private get timeoutMs() {
		return this.config.timeoutMs ?? 10_000;
	}

	/** Waits for the calendar server, but not forever: a server that hangs becomes an error the page can show. */
	private timed<T>(work: Promise<T>, what: string): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const late = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new NoAnswerError(`The calendar server did not answer in time (${what})`)), this.timeoutMs);
			// Only the request itself should keep the planner running, not the wait for it.
			timer.unref();
		});
		return Promise.race([work, late]).finally(() => clearTimeout(timer));
	}

	private home(): string {
		const home = this.client.account?.homeUrl;
		if (!home) throw new Error('The calendar server did not report a home folder for this user');
		// Always a folder, so "/david" never matches "/david-two/" and new calendars go inside it, not beside it.
		return home.endsWith('/') ? home : `${home}/`;
	}

	/** The address a calendar with this name is first made at. Tasks is found by it, since a phone can rename it. */
	addressFor(name: string): string {
		return new URL(`${slugOf(name)}/`, this.home()).href;
	}

	/** Reads the calendar list again, so ones added or deleted elsewhere (on a phone) are noticed. */
	async refreshCalendars(): Promise<void> {
		// One request for just the names and kinds. The library's fetchCalendars also asks for each calendar's
		// change tag, which Radicale works out by reading every item, and sends one more request per calendar.
		const home = this.home();
		const responses = await this.timed(
			this.client.propfind({
				url: home,
				props: { 'd:displayname': {}, 'd:resourcetype': {}, 'c:supported-calendar-component-set': {} },
				depth: '1'
			}),
			'listing the calendars'
		);
		if (!responses.some((r) => r.ok)) throw new Error(`Listing the calendars failed (${responses[0]?.status ?? 'no answer'})`);
		// Only calendars inside this user's home folder on the same server are kept, so a bad or hostile answer
		// can't send the planner's password (or David's events) anywhere else.
		const base = new URL(home);
		const inHome = (url: URL) => url.origin === base.origin && url.pathname.startsWith(base.pathname) && url.pathname !== base.pathname;
		this.davCalendars = responses
			.filter((r) => r.ok && r.href && 'calendar' in (r.props?.resourcetype ?? {}))
			.map((r) => {
				const comp = r.props?.supportedCalendarComponentSet?.comp;
				const components = (Array.isArray(comp) ? comp : comp ? [comp] : [])
					.map((x: { _attributes?: { name?: unknown } }) => x?._attributes?.name)
					.filter((n): n is string => typeof n === 'string');
				return { url: new URL(r.href!, home), displayName: davText(r.props?.displayname), components };
			})
			.filter((c) => inHome(c.url))
			// As folders, ending in '/', so an item's address can be checked to lie inside its calendar.
			.map((c) => ({ ...c, url: c.url.href.endsWith('/') ? c.url.href : `${c.url.href}/` }));
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

	/** Creates a calendar if one with this name doesn't exist yet. Used for setup and seeding.
	 * Given an address, it is the calendar at that address that must exist (Tasks, whatever it is called). */
	async ensureCalendar(name: string, accepts: ItemKind[], url?: string): Promise<Calendar> {
		const find = () => this.calendars().find((c) => (url ? c.url === url : c.name === name));
		const existing = find();
		if (existing) return existing;
		const address = url ?? this.freeAddress(name, this.home());
		const made = this.client.makeCalendar({
			url: address,
			props: {
				displayname: name,
				'c:supported-calendar-component-set': {
					'c:comp': accepts.map((k) => ({ _attributes: { name: k === 'event' ? 'VEVENT' : 'VTODO' } }))
				}
			}
		});
		// Another program (or another copy of the planner) may create it at the same moment; that's fine.
		// Messages name addresses, never names or titles: they end up in the server's log (house rule 4).
		await this.timed(made, `making ${logged(address)}`).catch(() => undefined);
		await this.refreshCalendars();
		const created = find();
		if (!created) throw new Error(`Could not create the calendar at ${logged(address)}`);
		return created;
	}

	/** An address for a new calendar, from its name, that no calendar uses yet. A renamed calendar keeps
	 * its old address, so "Work" renamed to "Office" still sits at work/ and a new "Work" gets work-2/. */
	private freeAddress(name: string, home: string): string {
		const slug = slugOf(name);
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
		if (status >= 300) throw new RefusedError(`The calendar server refused to rename ${logged(url)} (${status})`, status);
		await this.refreshCalendars();
	}

	/** The settings kept on a collection (the Tasks one), with defaults for anything not stored. */
	async readSettings(calendarUrl: string, seed?: SettingsSeed): Promise<Settings> {
		return parseSettings(await this.storedSettings(calendarUrl), this.calendars(), seed);
	}

	/** The settings exactly as stored, or undefined if nothing is stored there yet. Throws if the server
	 * couldn't say, so a hiccup is never mistaken for "no settings" and the stored ones overwritten. */
	async storedSettings(calendarUrl: string): Promise<string | undefined> {
		return (await this.settingsAt(calendarUrl)).stored;
	}

	/** Whether there is a collection at this address, and the settings stored on it. Throws if the server couldn't say. */
	async settingsAt(calendarUrl: string): Promise<{ found: boolean; stored: string | undefined }> {
		return this.plannerProperty(calendarUrl, 'settings');
	}

	/** One of the planner's own properties on a collection (planner-<name>). Throws if the server couldn't say. */
	private async plannerProperty(calendarUrl: string, name: 'settings' | 'log-key'): Promise<{ found: boolean; stored: string | undefined }> {
		const [response] = await this.timed(
			this.client.propfind({
				url: calendarUrl,
				props: { [`p:planner-${name}`]: { _attributes: { 'xmlns:p': PLANNER_NS } } },
				depth: '0'
			}),
			`reading the ${name}`
		);
		// The DAV library names properties in camel case: planner-log-key is plannerLogKey.
		const key = `planner-${name}`.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
		if (response?.ok) return { found: true, stored: davText(response.props?.[key]) };
		// A missing property comes back as 404 inside an answer about the collection; a missing collection, as a plain 404.
		if (response?.status === 404) return { found: (response.propStats?.length ?? 0) > 0, stored: undefined };
		throw new Error(`The calendar server could not read the ${name} (${response?.status ?? 'no answer'})`);
	}

	/** This install's key for fingerprints in the log, kept on the Tasks collection; made and stored the first time. */
	async logKey(calendarUrl: string): Promise<string> {
		const valid = (key: string | undefined) => (key && /^[0-9a-f]{64}$/.test(key.trim()) ? key.trim() : undefined);
		const stored = valid((await this.plannerProperty(calendarUrl, 'log-key')).stored);
		if (stored) return stored;
		const made = randomBytes(32).toString('hex');
		const status = await this.proppatch(calendarUrl, `<p:planner-log-key xmlns:p="${PLANNER_NS}">${made}</p:planner-log-key>`);
		if (status >= 300) throw new Error(`The calendar server refused to keep the log key (${status})`);
		// Another copy of the planner may have stored its own at the same moment: whichever is stored now is the one.
		return valid((await this.plannerProperty(calendarUrl, 'log-key')).stored) ?? made;
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
				Authorization: this.authorization(),
				'Content-Type': 'application/xml; charset=utf-8'
			},
			body: `<?xml version="1.0" encoding="utf-8"?><d:propertyupdate xmlns:d="DAV:"><d:set><d:prop>${prop}</d:prop></d:set></d:propertyupdate>`,
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		if (!response.ok) return response.status;
		const inner = [...(await response.text()).matchAll(/<(?:\w+:)?status>HTTP\/[\d.]+ (\d{3})/g)].map((m) => Number(m[1]));
		return inner.find((status) => status >= 300) ?? response.status;
	}

	/** A whole calendar as one .ics file, time zones included, exactly as the server hands it out.
	 * Undefined if the calendar has been deleted (on a phone) since the list was read. */
	async calendarFile(url: string): Promise<string | undefined> {
		const calendar = this.calendarAt(url);
		// The time limit covers the whole file, so a server that stops halfway can't hang the export either.
		const signal = AbortSignal.timeout(this.timeoutMs);
		try {
			const response = await fetch(calendar.url, { headers: { Authorization: this.authorization(), Accept: 'text/calendar' }, signal });
			if (response.status === 404) return undefined;
			if (!response.ok) throw new Error(`The calendar server would not hand out ${logged(calendar.url)} (${response.status})`);
			return await response.text();
		} catch (e) {
			if (signal.aborted) throw new NoAnswerError(`The calendar server did not answer in time (reading ${logged(calendar.url)})`, { cause: e });
			throw e;
		}
	}

	async listItems(): Promise<StoredItem[]> {
		return (await this.readItems()).items;
	}

	/** Every item, and the address of each stored document that couldn't be read (written badly by another app, say).
	 * One bad document is left out rather than failing them all, so the planner still shows everything else. */
	async readItems(): Promise<{ items: StoredItem[]; unreadable: string[] }> {
		await this.refreshCalendars();
		const all: StoredItem[] = [];
		const unreadable: string[] = [];
		for (const calendar of this.davCalendars) {
			const documents = await this.query(calendar).catch(async (e) => {
				// Deleted elsewhere since the list was read: skip it. Any other failure is real.
				await this.refreshCalendars();
				if (this.davCalendars.some((c) => c.url === calendar.url)) throw e;
				return [];
			});
			for (const doc of documents) {
				let items;
				try {
					items = icsToItems(doc.ics);
				} catch {
					unreadable.push(doc.url);
					continue;
				}
				for (const item of items) all.push({ ...item, ...doc });
			}
		}
		return { items: all, unreadable };
	}

	/** Every document in one calendar, and the calendar's version (its ETag) read just before them.
	 * Deleting the calendar with that version fails if anything in it changed since, so nothing unseen is lost. */
	async documents(calendarUrl: string): Promise<{ version: string | undefined; documents: StoredDocument[] }> {
		const calendar = this.calendarAt(calendarUrl);
		const [about] = await this.timed(this.client.propfind({ url: calendar.url, props: { 'd:getetag': {} }, depth: '0' }), `reading ${logged(calendar.url)}`);
		if (!about?.ok) throw new RefusedError(`Reading ${logged(calendar.url)} failed (${about?.status ?? 'no answer'})`, about?.status ?? 502);
		return { version: davText(about.props?.getetag), documents: await this.query(calendar) };
	}

	/** All documents in a calendar, in one query that returns everything, rather than a list followed by a fetch:
	 * an item added or deleted between the two (on a phone, or by another page load) would make the fetch fail. */
	private async query(calendar: DAVCalendar): Promise<StoredDocument[]> {
		const responses = await this.timed(
			this.client.calendarQuery({
				url: calendar.url,
				props: { 'd:getetag': {}, 'c:calendar-data': {} },
				filters: ALL_COMPONENTS,
				depth: '1'
			}),
			`reading ${logged(calendar.url)}`
		);
		const documents: StoredDocument[] = [];
		for (const res of responses) {
			const ics = davText(res.props?.calendarData);
			if (!res.href || !ics?.trim()) continue;
			const address = new URL(res.href, calendar.url);
			const url = address.href;
			// Saving, deleting or moving an item sends the password to its address, so it must be a plain file
			// directly inside its calendar: no query or fragment, not a sub-folder, not the calendar itself.
			if (!url.startsWith(calendar.url) || address.search || address.hash) continue;
			const file = url.slice(calendar.url.length);
			if (!file || file.includes('/')) continue;
			documents.push({ calendarUrl: calendar.url, url, etag: davText(res.props?.getetag), ics });
		}
		return documents;
	}

	/** Moves a document to another calendar unchanged, under the same file name, so repeats, one-off changes and alerts
	 * all go with it. The copy is made first; the old one is removed only once the copy is surely there, and only as it
	 * was read (a phone's change since then stops it). A copy already there and the same is a move that was cut short
	 * before: removing the old one finishes it. Never throws: every way it can end is an outcome. */
	async moveDocument(doc: StoredDocument, toCalendarUrl: string): Promise<MoveOutcome> {
		const to = this.calendarAt(toCalendarUrl);
		const filename = doc.url.startsWith(doc.calendarUrl) ? doc.url.slice(doc.calendarUrl.length) : '';
		// Only a plain file name: a query or fragment would send the copy somewhere other than a file in the new calendar.
		if (!filename || /[/?#]/.test(filename) || to.url === doc.calendarUrl) return 'kept';
		const target = new URL(filename, to.url).href;
		let copied: Response;
		try {
			copied = await this.send('PUT', target, { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, doc.ics);
		} catch {
			return 'unsure'; // the copy may or may not have been made
		}
		if (copied.status >= 500) return 'unsure';
		// Whether the identical copy was already there: put by an earlier run of this move, or one running alongside.
		let foundSame = false;
		if (copied.status === 412) {
			// Something already has that name there: this move cut short before (the same), or something else.
			const there = await this.holds(target, doc.ics);
			if (there !== 'same') return there;
			foundSame = true;
		} else if (!copied.ok) return 'kept';
		// Without a version, a change made on a phone since it was read could be deleted unseen.
		if (!doc.etag) return 'both';
		let removed: Response;
		try {
			removed = await this.send('DELETE', doc.url, { 'If-Match': doc.etag });
		} catch {
			return 'unsure'; // the server may still remove it
		}
		if (removed.ok) return 'moved';
		// Already gone. With the identical copy found already in place, another run of this same move got there first:
		// the item is in one place, as it was, so it is moved. After a fresh copy, another device deleted it (the copy
		// brings it back) or moved it elsewhere (now in two); only David can tell, so it is reported, never called moved.
		if (GONE.includes(removed.status)) return foundSame ? 'moved' : 'both';
		return removed.status >= 500 ? 'unsure' : 'both';
	}

	/** What the document at this address is, next to this one: the same ('same'), the same item with other details
	 * ('both': it is now in two calendars), or a different item ('clash'). If it can't be read, 'kept': the old copy stays. */
	private async holds(url: string, ics: string): Promise<'same' | 'both' | 'clash' | 'kept'> {
		let there: string;
		try {
			const response = await this.send('GET', url, { Accept: 'text/calendar' });
			if (!response.ok) return 'kept';
			there = await response.text();
		} catch {
			return 'kept';
		}
		const plain = (text: string) => text.replace(/\r\n/g, '\n').trim();
		if (plain(there) === plain(ics)) return 'same';
		const uid = uidOf(ics);
		return uid && uidOf(there) === uid ? 'both' : 'clash';
	}

	/** Deletes a whole calendar, only if it is still at the version given (from `documents`). The server refuses
	 * (412) if anything in it changed since, so an item added on a phone meanwhile is never deleted unseen. */
	async deleteCalendar(calendarUrl: string, version: string): Promise<void> {
		// Only a calendar from the listing: inside this user's home folder, and never the home folder itself.
		const calendar = this.calendarAt(calendarUrl);
		const res = await this.send('DELETE', calendar.url, { 'If-Match': version });
		if (!res.ok) throw new RefusedError(`The calendar server refused to delete ${logged(calendar.url)} (${res.status})`, res.status);
		this.davCalendars = this.davCalendars.filter((c) => c.url !== calendar.url);
	}

	/** Saves a new item. Given the document of an item it replaces elsewhere, keeps that one's one-off changes. */
	async create(calendarUrl: string, item: Item, previous?: string): Promise<StoredItem> {
		const calendar = this.calendarAt(calendarUrl);
		const filename = `${item.uid}.ics`;
		const ics = itemToICS(item, previous);
		const url = new URL(filename, calendar.url).href;
		const res = await this.timed(this.client.createCalendarObject({ calendar, filename, iCalString: ics }), `saving ${logged(url)}`);
		if (!res.ok) throw new RefusedError(`Saving ${logged(url)} failed (${res.status})`, res.status);
		return { ...item, calendarUrl, url, etag: res.headers.get('etag') ?? undefined, ics };
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
		const res = await this.timed(this.client.updateCalendarObject({ calendarObject: { url: stored.url, etag: stored.etag, data } }), `saving ${logged(stored.url)}`);
		if (!res.ok) throw new RefusedError(`Saving ${logged(stored.url)} failed (${res.status}); reload and try again`, res.status);
		return res.headers.get('etag') ?? undefined;
	}

	/** Saves an item exactly as given, dropping any field it no longer has. */
	async replace(stored: StoredItem, item: Item): Promise<StoredItem> {
		const ics = itemToICS(item, stored.ics);
		const etag = await this.put(stored, ics);
		return { ...item, calendarUrl: stored.calendarUrl, url: stored.url, etag, ics };
	}

	async remove(stored: StoredItem): Promise<void> {
		const res = await this.timed(this.client.deleteCalendarObject({ calendarObject: { url: stored.url, etag: stored.etag } }), `deleting ${logged(stored.url)}`);
		if (!res.ok) throw new RefusedError(`Deleting ${logged(stored.url)} failed (${res.status})`, res.status);
	}

	/** A plain request with the planner's sign-in and the time limit. No answer in time becomes a NoAnswerError. */
	private async send(method: string, url: string, headers: Record<string, string>, body?: string): Promise<Response> {
		const signal = AbortSignal.timeout(this.timeoutMs);
		try {
			return await fetch(url, { method, headers: { Authorization: this.authorization(), ...headers }, body, signal });
		} catch (e) {
			if (signal.aborted) throw new NoAnswerError(`The calendar server did not answer in time (${method} ${logged(url)})`, { cause: e });
			throw e;
		}
	}

	private authorization(): string {
		return `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
	}

	private calendarAt(url: string): DAVCalendar {
		const calendar = this.davCalendars.find((c) => c.url === url);
		if (!calendar) throw new Error(`No calendar at ${logged(url)}`);
		return calendar;
	}
}
