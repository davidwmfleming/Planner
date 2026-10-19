import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The household's time zone, for the app and the browser alike, so "today" and meeting times agree.
const TZ = 'America/Toronto';

export default defineConfig({
	testDir: 'e2e',
	use: { baseURL: 'http://localhost:4173', timezoneId: TZ },
	// On CI, failures also appear as annotations on the pull request.
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	webServer: [
		{
			// A seeded Radicale; the app is only started once seeding has printed its summary.
			command: 'bash scripts/e2e-calendar.sh',
			url: 'http://127.0.0.1:5233/.web/',
			reuseExistingServer: false,
			env: { TZ }
		},
		{
			command: 'npm run build && npm run preview -- --port 4173',
			port: 4173,
			env: {
				CALDAV_URL: 'http://127.0.0.1:5233/',
				CALDAV_USER: 'david',
				CALDAV_PASSWORD: 'dev',
				WORK_CALENDAR_URL: pathToFileURL(resolve('.e2e/work.ics')).href,
				TZ
			}
		}
	],
	projects: [
		{ name: 'tablet', use: { viewport: { width: 1000, height: 1400 }, isMobile: true, hasTouch: true } },
		{ name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
	]
});
