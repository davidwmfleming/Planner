import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	webServer: {
		command: 'npm run build && npm run preview -- --port 4173',
		port: 4173
	},
	projects: [
		{ name: 'tablet', use: { viewport: { width: 1000, height: 1400 } } },
		{ name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
	]
});
