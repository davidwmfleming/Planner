// "Download everything", in the browser: the zip is fetched by the page rather than by following a link,
// so a failure is shown on the page instead of as a broken download or (in the installed app) a dead end.

const TRY_AGAIN = 'Try again in a moment.';

/** The zip as a file ready to save or share, or what to tell David if there isn't one. */
export async function fetchExport(fetcher: typeof fetch = fetch): Promise<{ file: File } | { error: string }> {
	try {
		const response = await fetcher('/export', { cache: 'no-store' });
		if (!response.ok) return { error: (await reason(response)) ?? `The export did not work (${response.status}). ${TRY_AGAIN}` };
		// Anything other than a zip (a sign-in or error page from something in between) must not be saved as one.
		if (response.headers.get('Content-Type') !== 'application/zip') return { error: `The export did not work. ${TRY_AGAIN}` };
		const blob = await response.blob();
		return { file: new File([blob], zipName(response.headers.get('Content-Disposition')), { type: 'application/zip' }) };
	} catch {
		return { error: `Could not reach the planner, so nothing was downloaded. Check the connection and try again.` };
	}
}

/** The message the planner sent with a failure, if it sent one. */
async function reason(response: Response): Promise<string | undefined> {
	if (!response.headers.get('Content-Type')?.includes('application/json')) return undefined;
	const body: unknown = await response.json().catch(() => undefined);
	const message = (body as { message?: unknown } | undefined)?.message;
	return typeof message === 'string' && message ? message : undefined;
}

/** The dated name the planner gave the zip (planner-export-YYYY-MM-DD.zip). */
function zipName(disposition: string | null): string {
	return disposition?.match(/filename="([^"/\\]+)"/)?.[1] ?? 'planner-export.zip';
}
