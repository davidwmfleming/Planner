import { error } from '@sveltejs/kit';
import { flipPage, pageDays, pageStart, toISODate } from '$lib/dates';
import { buildDays } from '$lib/page';
import { getStore } from '$lib/server/store';
import type { PageServerLoad } from './$types';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const load: PageServerLoad = async ({ url }) => {
	const today = toISODate(new Date());
	const asked = url.searchParams.get('page');
	const start = pageStart(asked && ISO.test(asked) ? asked : today);
	const dates = pageDays(start);

	let items;
	try {
		items = await (await getStore()).listItems();
	} catch (e) {
		error(503, `The calendar server isn't answering. Check that it is running, then reload. (${(e as Error).message})`);
	}

	return {
		today,
		start,
		previous: flipPage(start, -1),
		next: flipPage(start, 1),
		todayPage: pageStart(today),
		// Only plain data goes to the browser: drop server locations.
		days: buildDays(dates, items).map((d) => ({
			...d,
			events: d.events.map(({ calendarUrl, url, etag, ...i }) => i),
			tasks: d.tasks.map(({ calendarUrl, url, etag, ...i }) => i)
		}))
	};
};
