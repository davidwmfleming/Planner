<script lang="ts">
	import { page } from '$app/state';

	// The installed app has no browser buttons, so this page carries its own way to try again and its own way back.
	const message = $derived(page.status === 404 ? "There's no page here." : (page.error?.message ?? 'Something went wrong.'));
</script>

<svelte:head>
	<title>Planner · Trouble</title>
</svelte:head>

<main class="wrap">
	<h1>Planner</h1>
	<p class="error">{message}</p>
	<div class="actions">
		<button type="button" class="btn primary" onclick={() => location.reload()}>Reload</button>
		<a class="btn" href="/">Back to the planner</a>
	</div>
</main>

<style>
	.wrap {
		max-width: 560px;
		margin: 0 auto;
		padding: max(1.5rem, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) 2rem max(16px, env(safe-area-inset-left, 0px));
	}
	h1 { font-weight: 800; font-size: 1.25rem; margin: 0 0 1rem; }
	.error { border: 2px solid var(--ink); border-radius: 6px; padding: 0.6rem 0.8rem; margin: 0 0 1rem; font-weight: 700; overflow-wrap: anywhere; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.btn {
		font: inherit;
		color: var(--ink);
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 6px;
		min-height: 44px;
		padding: 0 0.8rem;
		display: inline-grid;
		place-items: center;
		text-decoration: none;
		cursor: pointer;
	}
	.btn.primary { background: var(--ink); color: var(--paper); }
</style>
