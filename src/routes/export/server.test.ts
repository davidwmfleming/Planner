// The export address with a pretend calendar server: what the planner page is told when an export fails.
import { describe, expect, it, vi } from 'vitest';
import { ExportError } from '$lib/server/export';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
let exportFailure: Error | undefined;
vi.mock('$lib/server/store', () => ({ getStore: async () => ({}) }));
vi.mock('$lib/server/export', async (original) => ({
	...(await original<typeof import('$lib/server/export')>()),
	exportZip: async () => {
		if (exportFailure) throw exportFailure;
		return new Uint8Array([80, 75, 5, 6]);
	}
}));

const { GET } = await import('./+server');
const run = () => (GET as unknown as () => Promise<Response>)();

describe('GET /export', () => {
	it('sends the zip as a dated download', async () => {
		exportFailure = undefined;
		const response = await run();
		expect(response.headers.get('Content-Type')).toBe('application/zip');
		expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="planner-export-\d{4}-\d{2}-\d{2}\.zip"$/);
	});

	it('names the calendar that stopped the export', async () => {
		exportFailure = new ExportError('The calendar server did not hand out "Family", so nothing was downloaded. Try again in a moment.');
		await expect(run()).rejects.toMatchObject({ status: 502, body: { message: expect.stringContaining('"Family"') } });
	});

	it('keeps other failures plain, without the server\'s details', async () => {
		exportFailure = new Error('connect ECONNREFUSED 10.1.2.3:5232');
		await expect(run()).rejects.toMatchObject({ status: 502, body: { message: expect.not.stringContaining('10.1.2.3') } });
	});
});
