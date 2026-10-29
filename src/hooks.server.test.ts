// What a request that came through Tailscale Funnel (from the internet) can reach: only a shared calendar link.
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ building: true }));
vi.mock('$lib/server/rollover', () => ({ scheduleNightlyRollover: () => {} }));
const proxied = vi.fn(async () => new Response('calendar server'));
vi.mock('$lib/server/dav-proxy', () => ({ isDavPath: (path: string) => path.startsWith('/dav'), proxyToCalendarServer: proxied }));

const { handle } = await import('./hooks.server');
const LINK = `/feed/${'a'.repeat(43)}.ics`;

async function send(path: string, { method = 'GET', funnel = false } = {}) {
	const request = new Request(`https://homebase.example.ts.net${path}`, { method, headers: funnel ? { 'Tailscale-Funnel-Request': '?1' } : {} });
	const resolve = vi.fn(async () => new Response('planner'));
	const response = await (handle as unknown as (input: unknown) => Promise<Response>)({ event: { request, url: new URL(request.url) }, resolve });
	return { status: response.status, body: await response.text(), resolved: resolve.mock.calls.length > 0 };
}

describe('requests from the internet', () => {
	it('reach a shared calendar link, to read it', async () => {
		expect(await send(LINK, { funnel: true })).toMatchObject({ status: 200, resolved: true });
		expect(await send(LINK, { method: 'HEAD', funnel: true })).toMatchObject({ resolved: true });
	});

	it('never reach the planner, its settings, its other addresses or the calendar server', async () => {
		proxied.mockClear();
		for (const path of ['/', '/settings', '/export', '/?/add', '/dav/david/', '/feed/', `/feed/${'a'.repeat(43)}`, '/_app/version.json']) {
			expect(await send(path, { funnel: true })).toEqual({ status: 404, body: 'Not found', resolved: false });
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
