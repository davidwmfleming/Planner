<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// What went wrong with the last add or rename, shown next to it. Cleared when David starts again.
	let addError = $derived(form?.action === 'add' ? form.message : undefined);
	let renameError = $derived(form?.action === 'rename' ? form.message : undefined);

	/** The calendar whose name is being changed (by path, which a rename doesn't change). */
	let renaming = $state<string | undefined>();

	async function startRename(path: string) {
		renaming = path;
		renameError = undefined;
		await tick();
		document.querySelector<HTMLInputElement>('#rename-field')?.select();
	}

	/** A rename that worked closes its field; one that didn't keeps it open with the reason. */
	const renamed: SubmitFunction = () => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') renaming = undefined;
	};
</script>

<svelte:head>
	<title>Planner · Settings</title>
</svelte:head>

<div class="wrap">
	<!-- The installed app has no browser back button, so the way back is always at the top. -->
	<header class="bar">
		<a class="btn" href="/" aria-label="Back to the planner">‹ Planner</a>
		<h1>Settings</h1>
	</header>

	<main>
		<section aria-labelledby="h-calendars">
			<h2 id="h-calendars">Event calendars</h2>
			<ul class="lines">
				{#each data.eventCalendars as calendar (calendar.path)}
					<li class:work={calendar.work}>
						{#if renaming === calendar.path}
							<form method="POST" action="?/rename" use:enhance={renamed} class="edit">
								<input type="hidden" name="path" value={calendar.path} />
								<input id="rename-field" class="text" name="name" value={calendar.name} aria-label="New name for {calendar.name}" autocomplete="off" />
								<button class="btn primary">Save name</button>
								<button type="button" class="btn" onclick={() => (renaming = undefined)}>Cancel</button>
								{#if renameError}<p class="error" role="alert">{renameError}</p>{/if}
							</form>
						{:else}
							<span class="name">{calendar.name}</span>
							{#if calendar.work}<span class="tag work-tag">Work</span>{/if}
							{#if calendar.newEvents}<span class="tag">New events</span>{/if}
							<button type="button" class="btn small" aria-label="Rename {calendar.name}" onclick={() => startRename(calendar.path)}>Rename</button>
						{/if}
					</li>
				{/each}
			</ul>
			<form method="POST" action="?/add" use:enhance class="add">
				<label for="new-calendar">New calendar</label>
				<div class="edit">
					<input id="new-calendar" class="text" name="name" value={form?.action === 'add' ? form.name : ''} placeholder="Name, up to 40 letters" autocomplete="off" />
					<button class="btn" aria-label="Add calendar">Add</button>
				</div>
				{#if addError}<p class="error" role="alert">{addError}</p>{/if}
			</form>
			<dl class="choices">
				<div><dt>Show as work (light red)</dt><dd>{data.workCalendar ?? 'None'}</dd></div>
				<div><dt>New events go in</dt><dd>{data.defaultEventCalendar ?? 'No event calendar yet'}</dd></div>
			</dl>
		</section>

		<section aria-labelledby="h-tasks">
			<h2 id="h-tasks">Task list</h2>
			<ul class="lines">
				{#each data.taskLists as list (list.path)}
					<li><span class="name">{list.name}</span></li>
				{/each}
			</ul>
			<p class="hint">New tasks go in {data.taskLists.find((l) => l.newTasks)?.name ?? 'Tasks'}. It holds every task and these settings, so it can't be renamed or deleted.</p>
		</section>

		<section aria-labelledby="h-categories">
			<h2 id="h-categories">Task categories</h2>
			<ul class="lines">
				{#each data.categories as category (category)}
					<li><span class="name">{category}</span></li>
				{/each}
			</ul>
			<p class="hint">In this order on the Future tasks list.</p>
		</section>
	</main>
</div>

<style>
	/* The same paper, header and lines as the planner's pages. */
	.wrap {
		max-width: 980px;
		margin: 0 auto;
		padding-left: max(16px, env(safe-area-inset-left, 0px));
		padding-right: max(16px, env(safe-area-inset-right, 0px));
		padding-block: 0 2rem;
	}
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--paper);
		border-bottom: 2px solid var(--ink);
		display: flex;
		gap: 0.75rem;
		align-items: center;
		padding-block: 0.6rem;
	}
	h1 { font-weight: 800; font-size: 1.25rem; margin: 0; }
	.btn {
		font: inherit;
		color: var(--ink);
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 6px;
		min-height: 44px;
		min-width: 44px;
		padding: 0 0.8rem;
		display: inline-grid;
		place-items: center;
		text-decoration: none;
	}
	section { border-bottom: 2px solid var(--ink); padding-block: 0.9rem; }
	h2 { font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0; font-weight: 700; }
	.lines { list-style: none; margin: 0; padding: 0; }
	.lines li { min-height: var(--line); border-bottom: 1px solid var(--rule); display: flex; align-items: center; gap: 0.45rem; }
	.name { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--pen); }
	.tag { font-size: 0.72rem; border: 1px solid var(--muted); color: var(--muted); border-radius: 99px; padding: 0 0.4rem; white-space: nowrap; }
	/* Work: light red shading, plus a word, since e-ink shows the shade only as grey. */
	li.work { background: var(--work); }
	.work-tag { border-color: var(--ink); color: var(--ink); }
	.choices { margin: 0.7rem 0 0; display: grid; gap: 0.4rem; }
	.choices div { display: flex; flex-wrap: wrap; gap: 0 0.5rem; }
	.choices dt { color: var(--muted); }
	.choices dt::after { content: ':'; }
	.choices dd { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
	.hint { color: var(--muted); font-size: 0.9rem; margin: 0.5rem 0 0; }
	button.btn { cursor: pointer; }
	.btn.primary { background: var(--ink); color: var(--paper); }
	.btn.small { font-size: 0.85rem; padding: 0 0.6rem; }
	.lines li .btn { margin-block: 0.15rem; }
	/* A name field and its buttons on one line; the reason for a refusal wraps underneath. */
	.edit { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; padding-block: 0.3rem; }
	.text {
		flex: 1 1 10rem;
		min-width: 0;
		font: inherit;
		color: var(--ink);
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 6px;
		min-height: 44px;
		padding: 0.2rem 0.5rem;
	}
	.add { margin-top: 0.7rem; }
	.add label { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); }
	.error { flex-basis: 100%; color: var(--ink); border: 2px solid var(--ink); border-radius: 6px; padding: 0.4rem 0.6rem; margin: 0; font-weight: 700; }
</style>
