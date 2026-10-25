import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { isDavPath, onServer, proxyToCalendarServer } from './dav-proxy';

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

describe('a calendar server that hangs', () => {
	/** A server that answers after `delay` ms with headers, then sends its body after `bodyDelay` more. */
	async function slow(delay: number, bodyDelay = 0): Promise<{ server: Server; url: string }> {
		const server = createServer((_req, res) => {
			const t1 = setTimeout(() => {
				res.writeHead(207, { 'content-type': 'text/xml' });
				res.write('<a>');
				const t2 = setTimeout(() => res.end('</a>'), bodyDelay);
				res.on('close', () => clearTimeout(t2));
			}, delay);
			res.on('close', () => clearTimeout(t1));
		});
		await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
		const { port } = server.address() as { port: number };
		return { server, url: `http://127.0.0.1:${port}/` };
	}
	const propfind = () => new Request('http://planner/dav/david/', { method: 'PROPFIND' });

	it('gives up with 504 when it does not start answering in time', async () => {
		const { server, url } = await slow(2_000);
		try {
			const reply = await proxyToCalendarServer(propfind(), new URL('http://planner/dav/david/'), url, { answer: 100, whole: 5_000 });
			expect(reply.status).toBe(504);
		} finally {
			server.closeAllConnections();
			server.close();
		}
	});

	it('lets a slow but answering server finish sending', async () => {
		const { server, url } = await slow(0, 300);
		try {
			const reply = await proxyToCalendarServer(propfind(), new URL('http://planner/dav/david/'), url, { answer: 100, whole: 5_000 });
			expect(reply.status).toBe(207);
			expect(await reply.text()).toBe('<a></a>');
		} finally {
			server.close();
		}
	});
});
