<script lang="ts">
	import { readStroke, type Point } from '$lib/gesture';
	import { onMount } from 'svelte';

	// What this browser reports for the pen: helps tune the planner's pen marks for a new tablet.
	let lines = $state<string[]>([]);
	let padA = $state<HTMLDivElement>();
	let padB = $state<HTMLDivElement>();
	const note = (line: string) => (lines = [line, ...lines].slice(0, 12));

	function watch(el: HTMLDivElement, name: string) {
		let points: Point[] = [];
		let moves = 0;
		let touches = 0;
		let held = 0;
		let stylus = false;
		let pen = false;
		el.addEventListener('pointerdown', (e) => {
			points = [{ x: e.clientX, y: e.clientY }];
			moves = touches = held = 0;
			stylus = false;
			pen = e.pointerType === 'pen';
		});
		el.addEventListener('pointermove', (e) => {
			points.push({ x: e.clientX, y: e.clientY });
			moves++;
		});
		const touchNote = () => `, ${touches} touch moves${held ? `, ${held} held` : ''}${stylus ? ', marked stylus' : ''}`;
		el.addEventListener('pointerup', (e) => note(`${name} ${e.pointerType}: ${moves} moves, read as "${readStroke(points)}"${touchNote()}`));
		el.addEventListener('pointercancel', (e) => note(`${name} ${e.pointerType}: cancelled after ${moves} moves (the browser took over the stroke)${touchNote()}`));
		// Same as the planner: a pen stroke doesn't scroll the page.
		el.addEventListener(
			'touchmove',
			(e) => {
				touches++;
				if ([...e.touches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')) stylus = true;
				if ((pen || stylus) && e.cancelable) {
					e.preventDefault();
					held++;
				}
			},
			{ passive: false }
		);
	}

	onMount(() => {
		watch(padA!, 'A');
		watch(padB!, 'B');
	});
</script>

<svelte:head><title>Pen check</title></svelte:head>

<main>
	<h1>Pen check</h1>
	<p>Draw in each box: a sideways sweep, a ✓, a scribble. Each stroke adds a line below. Box B never scrolls the page.</p>
	<div class="pads">
		<div class="pad" bind:this={padA}><span>A</span></div>
		<div class="pad fixed" bind:this={padB}><span>B</span></div>
	</div>
	<ol>
		{#each lines as line, i (i + line)}<li>{line}</li>{/each}
	</ol>
	<p><a href="/">Back to the planner</a></p>
</main>

<style>
	main { font-family: system-ui, sans-serif; padding: 1rem max(16px, env(safe-area-inset-right, 0px)) 1rem max(16px, env(safe-area-inset-left, 0px)); }
	.pads { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
	.pad { border: 2px solid #000; height: 35vh; touch-action: pan-y; user-select: none; -webkit-user-select: none; padding: 0.3rem; font-weight: 700; }
	.pad.fixed { touch-action: none; }
	li { font-variant-numeric: tabular-nums; }
</style>
