<script lang="ts">
	import { goto } from '$app/navigation';
	import { dayLetter, dayNumber, formatTime, monthShort, monthYear } from '$lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const pageUrl = (start: string) => `?page=${start}`;

	// Swipe sideways on the page to flip, like turning a paper page.
	let swipeStart: { x: number; y: number } | null = null;
	function onPointerDown(e: PointerEvent) {
		swipeStart = { x: e.clientX, y: e.clientY };
	}
	function onPointerUp(e: PointerEvent) {
		if (!swipeStart) return;
		const dx = e.clientX - swipeStart.x;
		const dy = e.clientY - swipeStart.y;
		swipeStart = null;
		if (Math.abs(dx) > 80 && Math.abs(dy) < Math.abs(dx) * 0.6) goto(pageUrl(dx < 0 ? data.next : data.previous));
	}
	function onJump(e: Event) {
		const value = (e.currentTarget as HTMLInputElement).value;
		if (value) goto(pageUrl(value));
	}
</script>

<svelte:head>
	<title>Planner · {monthYear(data.start)}</title>
</svelte:head>

<div class="wrap">
	<header class="bar">
		<h1>Planner <span>· {monthYear(data.start)}</span></h1>
		<nav aria-label="Pages">
			<a class="btn" href={pageUrl(data.previous)} aria-label="Previous page">‹</a>
			<a class="btn" href={pageUrl(data.todayPage)}>Today</a>
			<a class="btn" href={pageUrl(data.next)} aria-label="Next page">›</a>
			<input type="date" id="jump" aria-label="Go to date" value={data.start} onchange={onJump} />
		</nav>
	</header>

	<main class="page" onpointerdown={onPointerDown} onpointerup={onPointerUp}>
		{#each data.days as day (day.date)}
			<section class="day" class:weekend={day.weekend} aria-label={day.date} data-date={day.date}>
				<div class="day-head">
					<span class="dow">{dayLetter(day.date)}</span>
					<span class="dnum">{dayNumber(day.date)}</span>
					<span class="dmonth">{monthShort(day.date)}</span>
					{#if day.date === data.today}<span class="today-tag">Today</span>{/if}
				</div>
				<div class="cols">
					<div class="col">
						<h2>Events</h2>
						<ul class="lines">
							{#each day.events as item (item.uid)}
								<li class={item.state}>
									<span class="box" aria-label={item.state === 'done' ? 'Done' : 'Not done'}>{item.state === 'done' ? '✓' : ''}</span>
									{#if item.time}<span class="time">{formatTime(item.time)}</span>{:else}<span class="allday">All day</span>{/if}
									<span class="title">{item.title}</span>
								</li>
							{/each}
						</ul>
					</div>
					<div class="col">
						<h2>Tasks</h2>
						<ul class="lines">
							{#each day.tasks as item (item.uid)}
								<li class={item.state}>
									<span class="box" aria-label={item.state === 'done' ? 'Done' : 'Not done'}>{item.state === 'done' ? '✓' : ''}</span>
									{#if item.time}<span class="time">{formatTime(item.time)}</span>{/if}
									<span class="title">{item.title}</span>
									{#if item.label}<span class="tag">{{ month: 'This month', waiting: 'Waiting', someday: 'Someday' }[item.label]}</span>{/if}
									{#if item.carriedFrom && item.state === 'open'}<span class="carry" title="Carried over">↻ {dayLetter(item.carriedFrom)} {dayNumber(item.carriedFrom)}</span>{/if}
								</li>
							{/each}
						</ul>
					</div>
				</div>
			</section>
		{/each}
	</main>
</div>

<style>
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
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding-block: 0.6rem;
	}
	h1 { font-weight: 800; font-size: 1.25rem; margin: 0 auto 0 0; }
	h1 span { font-weight: 600; color: var(--muted); }
	nav { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.btn, input[type='date'] {
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
	input[type='date'] { padding: 0 0.4rem; }
	.page { touch-action: pan-y; margin-top: 0.4rem; }
	.day { border-bottom: 2px solid var(--ink); padding-block: 0.5rem 0.9rem; min-height: calc((100dvh - 10rem) / 3); }
	.day.weekend { min-height: calc((100dvh - 10rem) / 6); }
	.day-head { display: flex; align-items: baseline; gap: 0.55rem; }
	.dow, .dnum { font-weight: 800; font-size: 1.6rem; }
	.dow { width: 1.3em; }
	.dnum { font-variant-numeric: tabular-nums; }
	.dmonth { color: var(--muted); font-size: 0.9rem; }
	.today-tag { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; border: 1.5px solid var(--ink); border-radius: 99px; padding: 0 0.5rem; }
	.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-top: 0.2rem; }
	.col { min-width: 0; }
	h2 { font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0; font-weight: 700; }
	.lines { list-style: none; margin: 0; padding: 0; }
	.lines li { min-height: var(--line); border-bottom: 1px solid var(--rule); display: flex; align-items: center; gap: 0.45rem; }
	.box { width: 1.25rem; height: 1.25rem; border: 2px solid var(--pen); border-radius: 3px; flex: none; display: grid; place-items: center; font-weight: 800; font-size: 0.95rem; line-height: 1; color: var(--pen); }
	.time { font-variant-numeric: tabular-nums; color: var(--pen); font-weight: 700; min-width: 4.4em; font-size: 0.92rem; }
	.allday { color: var(--pen); font-weight: 700; font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; min-width: 4.4em; }
	.title { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--pen); }
	li.done .title, li.done .time { color: var(--muted); }
	li.dropped .title, li.dropped .time { text-decoration: line-through; text-decoration-thickness: 2px; color: var(--muted); }
	.tag { font-size: 0.72rem; border: 1px solid var(--muted); color: var(--muted); border-radius: 99px; padding: 0 0.4rem; white-space: nowrap; }
	.carry { font-size: 0.72rem; color: var(--muted); white-space: nowrap; }
	@media (max-width: 520px) {
		.cols { grid-template-columns: 1fr; gap: 0.4rem; }
		h1 span { display: none; }
	}
</style>
