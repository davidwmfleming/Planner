import { describe, expect, it } from 'vitest';
import { calendarFor, feedUrl, fromInternet, newSecret, parseFeeds, secretIn } from './feeds';

const A = 'a'.repeat(43);
const B = 'B_-' + 'b'.repeat(40);

describe('shared calendar links', () => {
	it('makes secrets of 43 url-safe characters, a different one each time', () => {
		const one = newSecret();
		expect(one).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(newSecret()).not.toBe(one);
	});

	it('reads only well-formed links from the stored value, and nothing from a damaged one', () => {
		expect(parseFeeds(JSON.stringify({ '/david/me/': A, '/david/family/': 'short', 'no-slash': B, '/david/work/': 7 }))).toEqual({ '/david/me/': A });
		expect(parseFeeds('not json')).toEqual({});
		expect(parseFeeds('[1,2]')).toEqual({});
		expect(parseFeeds(undefined)).toEqual({});
		const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`/c${i}/`, A]));
		expect(Object.keys(parseFeeds(JSON.stringify(many)))).toHaveLength(200);
	});

	it('takes the secret only from an address that is exactly /feed/<secret>.ics', () => {
		expect(secretIn(`/feed/${A}.ics`)).toBe(A);
		expect(secretIn(`/feed/${A}`)).toBeUndefined();
		expect(secretIn(`/feed/${A}.ics/`)).toBeUndefined();
		expect(secretIn(`/feed/${A.slice(1)}.ics`)).toBeUndefined();
		expect(secretIn(`/feed/../settings/${A}.ics`)).toBeUndefined();
		expect(secretIn(`/x/feed/${A}.ics`)).toBeUndefined();
		expect(secretIn('/settings')).toBeUndefined();
	});

	it('finds the calendar for a secret, and none for a wrong or cancelled one', () => {
		const feeds = { '/david/me/': A, '/david/family/': B };
		expect(calendarFor(feeds, B)).toBe('/david/family/');
		expect(calendarFor(feeds, 'c'.repeat(43))).toBeUndefined();
		expect(calendarFor({}, A)).toBeUndefined();
	});

	it('knows a request that came through Tailscale Funnel by its header', () => {
		expect(fromInternet(new Headers({ 'Tailscale-Funnel-Request': '?1' }))).toBe(true);
		expect(fromInternet(new Headers({ 'Tailscale-User-Login': 'david@example.com' }))).toBe(false);
	});

	it('builds the public address, or none when sharing is off', () => {
		expect(feedUrl('https://homebase.example.ts.net:8443', A)).toBe(`https://homebase.example.ts.net:8443/feed/${A}.ics`);
		expect(feedUrl(undefined, A)).toBeUndefined();
		expect(feedUrl('', A)).toBeUndefined();
		expect(feedUrl('not a url', A)).toBeUndefined();
	});
});
