import { describe, expect, it } from 'vitest';
import { fetchExport } from './export-download';

const zipResponse = (headers: Record<string, string> = {}) =>
	new Response(new Uint8Array([80, 75, 5, 6]), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="planner-export-2026-10-20.zip"', ...headers } });

describe('fetchExport', () => {
	it('gives the zip as a file named as the planner named it', async () => {
		const result = await fetchExport(async () => zipResponse());
		if (!('file' in result)) throw new Error(result.error);
		expect(result.file.name).toBe('planner-export-2026-10-20.zip');
		expect(result.file.type).toBe('application/zip');
		expect(result.file.size).toBe(4);
	});

	it('still names the file if the planner did not', async () => {
		const result = await fetchExport(async () => zipResponse({ 'Content-Disposition': 'attachment' }));
		expect('file' in result && result.file.name).toBe('planner-export.zip');
	});

	it('passes on the reason the planner gives for a failed export', async () => {
		const failed = new Response(JSON.stringify({ message: 'The calendar server did not hand out "Family".' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
		expect(await fetchExport(async () => failed)).toEqual({ error: 'The calendar server did not hand out "Family".' });
	});

	it('says something plain when the failure has no reason attached (an error page from elsewhere)', async () => {
		const failed = new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
		expect(await fetchExport(async () => failed)).toEqual({ error: expect.stringMatching(/did not work.*try again/i) });
	});

	it('does not save a page that is not a zip (a sign-in page, say) as if it were the export', async () => {
		const page = new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } });
		expect(await fetchExport(async () => page)).toEqual({ error: expect.stringMatching(/did not work/i) });
	});

	it('says when the planner could not be reached', async () => {
		expect(
			await fetchExport(async () => {
				throw new TypeError('Failed to fetch');
			})
		).toEqual({ error: expect.stringMatching(/could not reach the planner/i) });
	});
});
