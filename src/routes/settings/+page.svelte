<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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
				{#each data.eventCalendars as calendar (calendar.name)}
					<li class:work={calendar.work}>
						<span class="name">{calendar.name}</span>
						{#if calendar.work}<span class="tag work-tag">Work</span>{/if}
						{#if calendar.newEvents}<span class="tag">New events</span>{/if}
					</li>
				{/each}
			</ul>
			<dl class="choices">
				<div><dt>Show as work (light red)</dt><dd>{data.workCalendar ?? 'None'}</dd></div>
				<div><dt>New events go in</dt><dd>{data.defaultEventCalendar ?? 'No event calendar yet'}</dd></div>
			</dl>
		</section>

		<section aria-labelledby="h-tasks">
			<h2 id="h-tasks">Task list</h2>
			<ul class="lines">
				{#each data.taskLists as list (list.name)}
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
</style>
