import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	use: { baseURL: 'http://localhost:4173' },
	webServer: [
		{
			// A seeded Radicale; the app is only started once seeding has printed its summary.
			command: 'bash scripts/e2e-calendar.sh',
			url: 'http://127.0.0.1:5233/.web/',
			reuseExistingServer: false
		},
		{
			command: 'npm run build && npm run preview -- --port 4173',
			port: 4173,
			env: { CALDAV_URL: 'http://127.0.0.1:5233/', CALDAV_USER: 'david', CALDAV_PASSWORD: 'dev' }
		}
	],
	projects: [
		{ name: 'tablet', use: { viewport: { width: 1000, height: 1400 } } },
		{ name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
	]
});
