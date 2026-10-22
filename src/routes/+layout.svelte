<script lang="ts">
	import { onMount } from 'svelte';
	// The fonts are served by the planner itself (bundled at build time), so pages look the same with no internet.
	import '@fontsource/atkinson-hyperlegible/400.css';
	import '@fontsource/atkinson-hyperlegible/700.css';
	import '@fontsource/source-serif-4/600.css';
	import '../app.css';

	let { children } = $props();
	// Marks the moment the page has started in the browser, so the browser tests can wait for it as a person would.
	onMount(() => document.documentElement.setAttribute('data-started', ''));
</script>

<svelte:head>
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#121419" media="(prefers-color-scheme: dark)" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-title" content="Planner" />
</svelte:head>

{@render children?.()}
