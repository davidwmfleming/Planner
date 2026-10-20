import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// For scripts run with vite-node. It leaves out the SvelteKit plugin on purpose: that plugin rewrites the app's
// generated files each time it loads, and in the browser tests the seed script runs while the app is being built,
// so the app could be built from two different sets of generated files and then never start in the browser.
export default defineConfig({
	resolve: { alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) } }
});
