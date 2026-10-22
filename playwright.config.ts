import { defineConfig } from '@playwright/test';

const tablet = { viewport: { width: 1000, height: 1400 }, isMobile: true, hasTouch: true };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const CHANGES_EVERY_PAGE = /settings-choices\.test\.ts/;
const CHANGES_CATEGORIES = /settings-categories\.test\.ts/;

export default defineConfig({
	testDir: 'e2e',
	use: { baseURL: 'http://localhost:4173' },
	// On CI, failures also appear as annotations on the pull request.
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	webServer: [
		{
			// A seeded Radicale; the app is only started once seeding has printed its summary.
			command: 'bash scripts/e2e-calendar.sh',
			url: 'http://127.0.0.1:5233/.web/',
			reuseExistingServer: false
		},
		{
			// Not NODE_ENV=production while serving (only while building), or the planner would refuse PLANNER_TEST_CLOCK.
			command: 'npm run build && NODE_ENV=test npm run preview -- --port 4173',
			port: 4173,
			env: { CALDAV_URL: 'http://127.0.0.1:5233/', CALDAV_USER: 'david', CALDAV_PASSWORD: 'dev', PLANNER_TEST_CLOCK: '1' }
		}
	],
	projects: [
		{ name: 'tablet', testIgnore: [CHANGES_EVERY_PAGE, CHANGES_CATEGORIES], use: tablet },
		{ name: 'phone', testIgnore: [CHANGES_EVERY_PAGE, CHANGES_CATEGORIES], use: phone },
		// Changing which calendar is Work, or where new events go, would upset tests running alongside,
		// so those tests run alone, once everything else has finished: tablet first, then phone.
		{ name: 'tablet-settings', testMatch: CHANGES_EVERY_PAGE, dependencies: ['tablet', 'phone'], use: tablet },
		{ name: 'phone-settings', testMatch: CHANGES_EVERY_PAGE, dependencies: ['tablet-settings'], use: phone },
		// Changing the task categories would upset the List menu of tests running alongside, and the settings tests' choices.
		{ name: 'tablet-categories', testMatch: CHANGES_CATEGORIES, dependencies: ['phone-settings'], use: tablet },
		{ name: 'phone-categories', testMatch: CHANGES_CATEGORIES, dependencies: ['tablet-categories'], use: phone }
	]
});
