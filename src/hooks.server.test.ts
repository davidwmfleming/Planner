// What a request that came through Tailscale Funnel (from the internet) can reach: only a shared calendar link.
import { describe, expect, it, vi } from 'vitest';

const env: Record<string, string> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
const share = vi.fn(async (address: string) => address === '172.18.0.9');
vi.mock('$lib/server/access', async (original) => ({ ...(await original<object>()), fromShareMachine: share }));
vi.mock('$app/environment', () => ({ building: true }));
vi.mock('$lib/server/rollover', () => ({ scheduleNightlyRollover: () => {} }));
const proxied = vi.fn(async () => new Response('calendar server'));
vi.mock('$lib/server/dav-proxy', () => ({ isDavPath: (path: string) => path.startsWith('/dav'), proxyToCalendarServer: proxied }));

const { handle } = await import('./hooks.server');
const LINK = `/feed/${'a'.repeat(43)}.ics`;

async function send(path: string, { method = 'GET', funnel = false, login = '', from = '172.18.0.1' } = {}) {
	const headers: Record<string, string> = {};
	if (funnel) headers['Tailscale-Funnel-Request'] = '?1';
	if (login) headers['Tailscale-User-Login'] = login;
	const request = new Request(`https://homebase.example.ts.net${path}`, { method, headers });
	const resolve = vi.fn(async () => new Response('planner'));
	const event = { request, url: new URL(request.url), getClientAddress: () => from };
	const response = await (handle as unknown as (input: unknown) => Promise<Response>)({ event, resolve });
	return { status: response.status, body: await response.text(), resolved: resolve.mock.calls.length > 0, response };
}

describe('requests from the internet', () => {
	it('reach a shared calendar link, to read it', async () => {
		expect(await send(LINK, { funnel: true })).toMatchObject({ status: 200, resolved: true });
		expect(await send(LINK, { method: 'HEAD', funnel: true })).toMatchObject({ resolved: true });
	});

	it('never reach the planner, its settings, its other addresses or the calendar server', async () => {
		proxied.mockClear();
		for (const path of ['/', '/settings', '/export', '/?/add', '/dav/david/', '/feed/', `/feed/${'a'.repeat(43)}`, '/_app/version.json']) {
			expect(await send(path, { funnel: true })).toMatchObject({ status: 404, body: 'Not found', resolved: false });
		}
		expect(proxied).not.toHaveBeenCalled();
	});

	it('can only read a link, never write to it', async () => {
		for (const method of ['POST', 'PUT', 'DELETE', 'PROPFIND']) expect(await send(LINK, { method, funnel: true })).toMatchObject({ status: 404, resolved: false });
	});

	it('leave requests over Tailscale as they were', async () => {
		expect(await send('/settings')).toMatchObject({ status: 200, resolved: true });
		expect(await send('/dav/david/', { method: 'PROPFIND' })).toMatchObject({ body: 'calendar server' });
	});
});

describe('requests made by the planner-share container itself', () => {
	it('reach only a shared link, even claiming to be David', async () => {
		env.FEED_ORIGIN = 'https://planner-share.example.ts.net';
		try {
			const claim = { from: '172.18.0.9', login: 'david@example.com' };
			expect(await send('/settings', claim)).toMatchObject({ status: 404, resolved: false });
			expect(await send('/dav/david/', { ...claim, method: 'PROPFIND' })).toMatchObject({ status: 404, resolved: false });
			expect(await send(LINK, claim)).toMatchObject({ status: 200, resolved: true });
		} finally {
			delete env.FEED_ORIGIN;
		}
	});

	it("aren't looked for while sharing is off", async () => {
		share.mockClear();
		await send('/settings', { from: '172.18.0.9' });
		expect(share).not.toHaveBeenCalled();
	});
});

describe('who gets in over the tailnet', () => {
	it('only the logins on ALLOWED_USERS, once it is set', async () => {
		env.ALLOWED_USERS = 'david@example.com';
		try {
			expect(await send('/settings', { login: 'David@Example.com' })).toMatchObject({ status: 200, resolved: true });
			expect(await send('/settings', { login: 'friend@example.org' })).toMatchObject({ status: 403, resolved: false });
			expect(await send('/settings')).toMatchObject({ status: 403, resolved: false });
			const refused = await send('/', { login: 'friend@example.org' });
			expect(refused.body).toContain('friend@example.org');
			// CalDAV is left to the calendar server's own password, so a family member's phone keeps syncing.
			expect(await send('/dav/david/', { method: 'PROPFIND', login: 'friend@example.org' })).toMatchObject({ body: 'calendar server' });
			// A shared link needs no login: it comes from the internet.
			expect(await send(LINK, { funnel: true })).toMatchObject({ status: 200 });
		} finally {
			delete env.ALLOWED_USERS;
		}
	});
});

describe("the planner's pages", () => {
	it("can't be shown inside another site's page", async () => {
		const { response } = await send('/');
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
	});
});
