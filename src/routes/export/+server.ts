// Download everything as a zip of .ics files, one per calendar. Fetched here with the planner's own
// calendar password, which never reaches the browser.
import { error } from '@sveltejs/kit';
import { toISODate } from '$lib/dates';
import { exportZip, exportZipName } from '$lib/server/export';
import { getStore } from '$lib/server/store';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	let zip: Uint8Array;
	try {
		zip = await exportZip(await getStore());
	} catch (e) {
		console.error('Export failed', e);
		error(502, 'The calendar server did not hand out every calendar; try again in a moment.');
	}
	return new Response(zip as Uint8Array<ArrayBuffer>, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${exportZipName(toISODate(new Date()))}"`,
			'Cache-Control': 'no-store'
		}
	});
};
