<script lang="ts">
	import { readStroke, type Point } from '$lib/gesture';
	import { onMount } from 'svelte';

	// What this browser reports for the pen: helps tune the planner's pen marks for a new tablet.
	let lines = $state<string[]>([]);
	let pad = $state<HTMLDivElement>();
	let points: Point[] = [];
	let moves = 0;
	let stylusTouch = false;
	const note = (line: string) => (lines = [line, ...lines].slice(0, 12));

	onMount(() => {
		const el = pad!;
		const down = (e: PointerEvent) => {
			points = [{ x: e.clientX, y: e.clientY }];
			moves = 0;
			stylusTouch = false;
		};
		const move = (e: PointerEvent) => {
			points.push({ x: e.clientX, y: e.clientY });
			moves++;
		};
		const up = (e: PointerEvent) => note(`${e.pointerType}: ${moves} moves, read as "${readStroke(points)}"${stylusTouch ? ', stylus touch' : ''}`);
		const cancel = (e: PointerEvent) => note(`${e.pointerType}: cancelled after ${moves} moves (the browser took over the stroke)`);
		const touch = (e: TouchEvent) => {
			// Same as the planner: a pen stroke doesn't scroll the page.
			if ([...e.touches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')) {
				stylusTouch = true;
				if (e.cancelable) e.preventDefault();
			}
		};
		el.addEventListener('pointerdown', down);
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', cancel);
		el.addEventListener('touchmove', touch, { passive: false });
	});
</script>

<svelte:head><title>Pen check</title></svelte:head>

<main>
	<h1>Pen check</h1>
	<p>Draw in the box: a sideways sweep, a ✓, a scribble. Each stroke adds a line below.</p>
	<div class="pad" bind:this={pad}></div>
	<ol>
		{#each lines as line, i (i + line)}<li>{line}</li>{/each}
	</ol>
	<p><a href="/">Back to the planner</a></p>
</main>

<style>
	main { font-family: system-ui, sans-serif; padding: 1rem max(16px, env(safe-area-inset-right, 0px)) 1rem max(16px, env(safe-area-inset-left, 0px)); }
	.pad { border: 2px solid #000; height: 45vh; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
	li { font-variant-numeric: tabular-nums; }
</style>
