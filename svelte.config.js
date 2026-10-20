import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// One version name for the whole build. SvelteKit names the page's start-up data after it, and the server and
// browser halves must agree; left to itself it takes the time, which can differ between the halves on a slow
// machine, and then the page never starts in the browser.
process.env.PLANNER_VERSION ??= Date.now().toString();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter(),
		version: { name: process.env.PLANNER_VERSION }
	}
};

export default config;
