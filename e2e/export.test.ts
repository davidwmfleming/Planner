import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './fixtures';
import { iso } from './dates';

test('"Download everything" saves a dated zip with one .ics per calendar', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('Apple Calendar and Google Calendar skip the tasks')).toBeVisible();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download everything (.ics)' }).click()]);
	expect(download.suggestedFilename()).toBe(`planner-export-${iso(new Date())}.zip`);

	const files = unzipSync(readFileSync(await download.path()));
	expect(Object.keys(files)).toEqual(expect.arrayContaining(['Me.ics', 'Family.ics', 'Workouts.ics', 'Morgan Meals.ics', 'Work.ics', 'Tasks.ics']));
	for (const ics of Object.values(files)) expect(strFromU8(ics)).toMatch(/^BEGIN:VCALENDAR\r?\n[\s\S]*END:VCALENDAR\s*$/);
	expect(strFromU8(files['Me.ics'])).toContain('SUMMARY:Terry Fox');
	expect(strFromU8(files['Work.ics'])).toContain('SUMMARY:Economic Modelling');
	expect(strFromU8(files['Tasks.ics'])).toContain('SUMMARY:Green cart');
	await expect(page.getByRole('link', { name: 'Download everything (.ics)' })).toBeVisible(); // still on the planner
});
