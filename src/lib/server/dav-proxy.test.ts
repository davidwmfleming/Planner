import { describe, expect, it } from 'vitest';
import { isDavPath, onServer } from './dav-proxy';

const server = new URL('http://127.0.0.1:8232/');

describe('the calendar-app address', () => {
	it('maps /dav/… onto the calendar server', () => {
		expect(onServer(server, '/dav/david/me/', '?x=1')?.href).toBe('http://127.0.0.1:8232/david/me/?x=1');
		expect(onServer(server, '/dav', '')?.href).toBe('http://127.0.0.1:8232/');
	});

	it('never leads to another host', () => {
		for (const path of ['/dav//evil.example/a', '/dav/\\evil.example/a', '/dav/david//x', '/dav@evil.example/']) {
			expect(onServer(server, path, '')).toBeUndefined();
		}
		expect(onServer(server, '/dav/a', '?@evil.example')?.origin).toBe(server.origin);
	});

	it('is only used for /dav and the well-known address', () => {
		expect(isDavPath('/dav/')).toBe(true);
		expect(isDavPath('/.well-known/caldav')).toBe(true);
		expect(isDavPath('/davidson')).toBe(false);
		expect(isDavPath('/')).toBe(false);
	});
});
