// Download everything as a zip of .ics files, one per calendar. Fetched here with the planner's own
// calendar password, which never reaches the browser.
import { error } from '@sveltejs/kit';
import { toISODate } from '$lib/dates';
import { ExportError, exportZip, exportZipName } from '$lib/server/export';
import { getStore } from '$lib/server/store';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	let zip: Uint8Array;
	try {
		zip = await exportZip(await getStore());
	} catch (e) {
		// The page's message names the calendar; the log gets only what went wrong underneath, which names its address.
		console.error('Export failed', e instanceof ExportError ? e.cause : e);
		// Which calendar failed is worth saying; the server's own details (addresses, codes) stay in the log.
		error(502, e instanceof ExportError ? e.message : 'The calendar server did not answer, so nothing was downloaded. Try again in a moment.');
	}
	return new Response(zip as Uint8Array<ArrayBuffer>, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${exportZipName(toISODate(new Date()))}"`,
			'Cache-Control': 'no-store'
		}
	});
};
