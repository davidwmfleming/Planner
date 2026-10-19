<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { addDays } from '$lib/dates';
	import { movedFar, readStroke, type Point } from '$lib/gesture';
	import { dayLetter, dayNumber, formatTime, monthShort, monthYear } from '$lib/format';
	import type { Item } from '$lib/item';
	import { REPEATS, repeatChoice } from '$lib/repeat';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The details sheet: tap an item's title to see and edit everything about it.
	let editing = $state<Item | null>(null);
	let sheet = $state<HTMLDialogElement>();
	// Picking "New calendar…" in the sheet asks for its name.
	let newCalendar = $state(false);
	function openDetails(item: Item) {
		editing = item;
		newCalendar = false;
		sheet?.showModal();
	}
	const closeOnSuccess: SubmitFunction = () => async ({ result, update }) => {
		await update();
		if (result.type === 'success' || result.type === 'redirect') sheet?.close();
	};

	// "Future tasks" stays out of the way until asked for; the choice is remembered on this device.
	let showUnscheduled = $state(false);
	onMount(() => {
		try {
			showUnscheduled = localStorage.getItem('planner-show-unscheduled') === '1';
		} catch {
			// private browsing: just start hidden
		}
	});
	function toggleUnscheduled() {
		showUnscheduled = !showUnscheduled;
		try {
			localStorage.setItem('planner-show-unscheduled', showUnscheduled ? '1' : '');
		} catch {
			// not remembered, still works
		}
	}
	const LIST_NAMES = { month: 'This month', waiting: 'Waiting', someday: 'Someday' } as const;

	const pageUrl = (start: string) => `?page=${start}`;

	// Pen (or finger) marks on the page, like on paper: sweep sideways to turn the page, draw ✓ on an item to tick it,
	// scribble over it to strike it out, or drag it onto another day. The tap buttons all still work.
	type Active = { id: number; points: Point[]; row?: HTMLElement; uid?: string; occurrence?: string; from?: string };
	let stroke: Active | null = null;
	let dropDay = $state<string | null>(null);
	let dragging = $state<string | null>(null);
	let gestureMessage = $state('');
	let swallowClick = false;

	const dayAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('section.day')?.dataset.date;

	function onStrokeStart(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (!e.isPrimary || target.closest('input, select, textarea, dialog, header, a')) return;
		swallowClick = false;
		const row = target.closest<HTMLElement>('li[data-uid]') ?? undefined;
		stroke = {
			id: e.pointerId,
			points: [{ x: e.clientX, y: e.clientY }],
			row,
			uid: row?.dataset.uid,
			occurrence: row?.dataset.occurrence,
			from: row ? (row.closest<HTMLElement>('section.day')?.dataset.date ?? '') : undefined
		};
	}
	function onStrokeMove(e: PointerEvent) {
		if (!stroke || e.pointerId !== stroke.id) return;
		stroke.points.push({ x: e.clientX, y: e.clientY });
		if (stroke.uid && movedFar(stroke.points[0], stroke.points[stroke.points.length - 1])) {
			const day = dayAt(e.clientX, e.clientY);
			dragging = stroke.uid;
			dropDay = day && day !== stroke.from ? day : null;
			// Near the top or bottom edge, scroll so a day off screen can be reached (a phone shows only a day or two).
			const edge = 60;
			if (e.clientY > innerHeight - edge) scrollBy(0, 24);
			else if (e.clientY < edge) scrollBy(0, -24);
		}
	}
	function onStrokeEnd(e: PointerEvent) {
		const done = stroke;
		const target = dropDay;
		onStrokeCancel();
		if (!done || e.pointerId !== done.id) return;
		done.points.push({ x: e.clientX, y: e.clientY });
		// A tap with a little wobble is still a tap.
		if (!done.points.some((p) => movedFar(done.points[0], p))) return;
		swallowClick = true;
		setTimeout(() => (swallowClick = false), 400);
		const item = done.uid ? { uid: done.uid, ...(done.occurrence ? { occurrence: done.occurrence } : {}) } : undefined;
		if (item && target) return send('move', { ...item, to: target });
		const read = readStroke(done.points);
		if (read === 'next' || read === 'previous') return goto(pageUrl(read === 'next' ? data.next : data.previous));
		if (!item) return;
		const row = done.row;
		// Marks only ever set a state; doing the same mark twice would undo it, as the buttons do.
		if (read === 'tick' && !row?.classList.contains('done')) return send('mark', { ...item, state: 'done' });
		if (read === 'scratch' && !row?.classList.contains('dropped')) return send('mark', { ...item, state: 'dropped' });
	}
	function onStrokeCancel() {
		stroke = null;
		dropDay = null;
		dragging = null;
	}
	// A pen stroke shouldn't also scroll the page (fingers still scroll). Pointer events can't stop that; touch events can.
	function holdPagePen(e: TouchEvent) {
		if (stroke && e.cancelable && [...e.touches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')) e.preventDefault();
	}
	// The stroke has done its job; don't let it also count as a tap on whatever it ended on.
	function afterStroke(e: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		e.preventDefault();
		e.stopPropagation();
	}
	let wrap = $state<HTMLDivElement>();
	onMount(() => {
		const listen = { pointerdown: onStrokeStart, pointermove: onStrokeMove, pointerup: onStrokeEnd, pointercancel: onStrokeCancel };
		for (const [name, fn] of Object.entries(listen)) wrap?.addEventListener(name, fn as EventListener);
		window.addEventListener('touchmove', holdPagePen, { passive: false });
		window.addEventListener('click', afterStroke, true);
		return () => {
			for (const [name, fn] of Object.entries(listen)) wrap?.removeEventListener(name, fn as EventListener);
			window.removeEventListener('touchmove', holdPagePen);
			window.removeEventListener('click', afterStroke, true);
		};
	});

	async function send(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const response = await fetch(`?page=${data.start}&/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await response.text());
		gestureMessage = result.type === 'failure' ? String(result.data?.message ?? 'That did not work; try again') : result.type === 'error' ? 'That did not work; try again' : '';
		await invalidateAll();
	}
	// After saving a line, keep the cursor on the blank line so the next entry can follow straight away.
	// Tapping away from a line saves it too, so handwriting needs no Enter. The cursor then stays where you tapped.
	// The line is cleared as soon as it is sent, so you can keep writing while it saves; if saving fails, the words come back.
	// (Saving redraws the page, which can drop focus, so focus is put back on purpose.)
	const saving = new Set<HTMLFormElement>();
	const left = new Set<HTMLFormElement>();
	const tappedTo = new Map<HTMLFormElement, HTMLElement>();
	const lineOf = (form: HTMLFormElement) => form.querySelector<HTMLInputElement>('input[name="text"]')!;
	const keepWriting: SubmitFunction = ({ formElement, formData }) => {
		const line = lineOf(formElement);
		const written = String(formData.get('text') ?? '');
		saving.add(formElement);
		line.value = '';
		return async ({ result, update }) => {
			if (result.type === 'success' || result.type === 'redirect') {
				gestureMessage = '';
				await update({ reset: false });
			} else {
				line.value = line.value.trim() ? `${written} ${line.value}` : written;
				gestureMessage =
					result.type === 'failure' ? String(result.data?.message ?? `Couldn't save "${written}"; try again`) : `Couldn't save "${written}". Check the connection, then tap the line and try again.`;
			}
			saving.delete(formElement);
			const next = tappedTo.get(formElement) ?? (left.has(formElement) ? undefined : line);
			if (next?.isConnected && (document.activeElement === document.body || document.activeElement === null)) next.focus();
			// Words written while the last line was saving, then left: save those too (and keep the cursor where it went).
			if (result.type !== 'error' && line.value.trim() && document.activeElement !== line) {
				left.add(formElement);
				formElement.requestSubmit();
				return;
			}
			tappedTo.delete(formElement);
			left.delete(formElement);
		};
	};
	function saveOnLeave(e: FocusEvent) {
		const input = e.currentTarget as HTMLInputElement;
		if (!input.form || (!saving.has(input.form) && !input.value.trim())) return;
		// SvelteKit parks focus on the page body while it redraws; that isn't a tap.
		if (e.relatedTarget instanceof HTMLElement && e.relatedTarget !== document.body) tappedTo.set(input.form, e.relatedTarget);
		if (saving.has(input.form)) return;
		left.add(input.form);
		input.form.requestSubmit();
	}

	function onJump(e: Event) {
		const value = (e.currentTarget as HTMLInputElement).value;
		if (value) goto(pageUrl(value));
	}
</script>

{#snippet itemRow(item: Item, date: string)}
	<li class={[item.state, item.calendar === data.workCalendar && 'work', dragging === item.uid && 'dragging']} data-uid={item.uid} data-occurrence={item.occurrence}>
		<form method="POST" action="?page={data.start}&/mark" use:enhance class="inline">
			<input type="hidden" name="uid" value={item.uid} />
			{#if item.occurrence}<input type="hidden" name="occurrence" value={item.occurrence} />{/if}
			<button class="box" name="state" value="done" aria-label="{item.state === 'done' ? 'Untick' : 'Tick'} {item.title}"><span class="sq">{item.state === 'done' ? '✓' : ''}</span></button>
		</form>
		{#if item.time}<span class="time">{formatTime(item.time)}</span>{:else if item.kind === 'event'}<span class="allday">All day</span>{/if}
		<button type="button" class="title" onclick={() => openDetails(item)} aria-label="Details for {item.title}">{item.title}</button>
		{#if item.label}<span class="tag">{LIST_NAMES[item.label]}</span>{/if}
		{#if item.calendar === data.workCalendar}<span class="tag work-tag">Work</span>{/if}
		{#if item.recurrence}<span class="repeat" title="Repeats">⟳</span>{/if}
		{#if item.carriedFrom && item.state === 'open'}<span class="carry" title="Carried over">↻ {dayLetter(item.carriedFrom)} {dayNumber(item.carriedFrom)}</span>{/if}
		<form method="POST" action="?page={data.start}&/mark" use:enhance class="inline">
			<input type="hidden" name="uid" value={item.uid} />
			{#if item.occurrence}<input type="hidden" name="occurrence" value={item.occurrence} />{/if}
			<button class="act" name="state" value="dropped" aria-label="{item.state === 'dropped' ? 'Restore' : 'Drop'} {item.title}">✕</button>
		</form>
		{#if item.kind === 'task' && date}
			<form method="POST" action="?page={data.start}&/move" use:enhance class="inline">
				<input type="hidden" name="uid" value={item.uid} />
			{#if item.occurrence}<input type="hidden" name="occurrence" value={item.occurrence} />{/if}
				<button class="act" name="to" value={addDays(date, 1)} aria-label="Move {item.title} to the next day">→</button>
			</form>
			{#if !item.recurrence}
				<form method="POST" action="?page={data.start}&/unschedule" use:enhance class="inline">
					<input type="hidden" name="uid" value={item.uid} />
					<button class="act" aria-label="Put {item.title} back on Future tasks" title="Back to Future tasks">↩</button>
				</form>
			{/if}
		{/if}
	</li>
{/snippet}

{#snippet pullButtons(item: Item)}
	<form method="POST" action="?page={data.start}&/move" use:enhance class="inline">
		<input type="hidden" name="uid" value={item.uid} />
		<button class="pull" name="to" value={data.today} aria-label="Put {item.title} on today">Today</button>
		<button class="pull" name="to" value={data.saturday} aria-label="Put {item.title} on Saturday">Sat</button>
	</form>
{/snippet}

{#snippet blankLine(kind: 'event' | 'task', date: string)}
	<li class="blank">
		<form method="POST" action="?page={data.start}&/add" use:enhance={keepWriting}>
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="date" value={date} />
			<input
				class="entry"
				onblur={saveOnLeave}
				name="text"
				id="add-{kind}-{date || 'unscheduled'}"
				autocomplete="off"
				enterkeyhint="done"
				placeholder={kind === 'event' ? 'add event' : 'add task'}
				aria-label={date ? `Add ${kind} on ${date}` : 'Add a future task'}
			/>
		</form>
	</li>
{/snippet}

<svelte:head>
	<title>Planner · {monthYear(data.start)}</title>
</svelte:head>

<div class="wrap" bind:this={wrap}>
	<header class="bar">
		<h1>Planner <span>· {monthYear(data.start)}</span></h1>
		<nav aria-label="Pages">
			<a class="btn" href={pageUrl(data.previous)} aria-label="Previous page">‹</a>
			<a class="btn" href={pageUrl(data.todayPage)}>Today</a>
			<a class="btn" href={pageUrl(data.next)} aria-label="Next page">›</a>
			<input type="date" id="jump" aria-label="Go to date" value={data.start} onchange={onJump} />
		</nav>
	</header>

	{#if gestureMessage}<p class="error" role="alert">{gestureMessage}</p>{/if}
	<main class="page">
		{#each data.days as day (day.date)}
			<section class="day" class:weekend={day.weekend} class:drop-target={dropDay === day.date} aria-label={day.date} data-date={day.date}>
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
								{@render itemRow(item, day.date)}
							{/each}
							{@render blankLine('event', day.date)}
						</ul>
					</div>
					<div class="col">
						<h2>Tasks</h2>
						<ul class="lines">
							{#each day.tasks as item (item.uid)}
								{@render itemRow(item, day.date)}
							{/each}
							{@render blankLine('task', day.date)}
						</ul>
					</div>
				</div>
			</section>
		{/each}
	</main>

	<section class="someday" aria-label="Future tasks">
		<button type="button" class="btn wide" aria-expanded={showUnscheduled} onclick={toggleUnscheduled}>
			{showUnscheduled ? 'Hide' : 'Show'} future tasks ({data.unscheduled.length})
		</button>
		{#if showUnscheduled}
			<p class="hint">This month, waiting on and someday. Put any of them on today or the coming Saturday.</p>
			<ul class="lines">
				{#each data.unscheduled as item (item.uid)}
					<li class={[item.state, dragging === item.uid && 'dragging']} data-uid={item.uid}>
						<button type="button" class="title" onclick={() => openDetails(item)} aria-label="Details for {item.title}">{item.title}</button>
						{#if item.label}<span class="tag">{LIST_NAMES[item.label]}</span>{/if}
						{@render pullButtons(item)}
					</li>
				{/each}
				{@render blankLine('task', '')}
			</ul>
		{/if}
	</section>
</div>

<dialog bind:this={sheet} class="sheet" aria-label="Details" onclose={() => (editing = null)}>
	{#if editing}
		{#key editing.uid}
			<form method="POST" action="?page={data.start}&/save" use:enhance={closeOnSuccess}>
				<input type="hidden" name="uid" value={editing.uid} />
				{#if editing.occurrence}<input type="hidden" name="occurrence" value={editing.occurrence} />{/if}
				<h2 class="sheet-title">Details</h2>
				<label class="field">Title <input name="title" id="f-title" value={editing.title} required /></label>
				<fieldset class="field">
					<legend>Kind</legend>
					<div class="seg">
						<label><input type="radio" name="kind" value="event" checked={editing.kind === 'event'} /> Event</label>
						<label><input type="radio" name="kind" value="task" checked={editing.kind === 'task'} /> Task</label>
					</div>
				</fieldset>
				<div class="row2">
					<label class="field">{editing.recurrence ? 'Starts' : 'Date'} <input type="date" name="date" id="f-date" value={editing.seriesStart ?? editing.date ?? ''} /></label>
					<label class="field">Time <input type="time" name="time" id="f-time" value={editing.time ?? ''} /></label>
				</div>
				<div class="row2">
					<label class="field">Ends (events) <input type="time" name="endTime" id="f-end" value={editing.endTime ?? ''} /></label>
					<label class="field">List
						<select name="label" id="f-label" value={editing.label ?? ''}>
							<option value="">None</option>
							<option value="month">This month</option>
							<option value="waiting">Waiting on</option>
							<option value="someday">Someday</option>
						</select>
					</label>
				</div>
				{#if editing.kind === 'event'}
					<label class="field">Calendar
						<select name="calendar" id="f-calendar" value={editing.calendar ?? data.defaultEventCalendar} onchange={(e) => (newCalendar = e.currentTarget.value === '+new')}>
							{#each data.eventCalendars as name (name)}<option value={name}>{name}</option>{/each}
							<option value="+new">New calendar…</option>
						</select>
					</label>
					{#if newCalendar}
						<label class="field">New calendar's name <input name="newCalendar" id="f-new-calendar" maxlength="40" required /></label>
					{/if}
				{/if}
				<label class="field">Repeats
					<select name="repeat" id="f-repeat" value={repeatChoice(editing.recurrence)}>
						{#each REPEATS as r (r.value)}<option value={r.value}>{r.name}</option>{/each}
						{#if repeatChoice(editing.recurrence) === 'custom'}<option value="custom">As set on another device</option>{/if}
					</select>
				</label>
				<label class="field">Location <input name="location" id="f-location" value={editing.location ?? ''} /></label>
				<label class="field">Notes <textarea name="notes" id="f-notes" rows="3">{editing.notes ?? ''}</textarea></label>
				{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
				<p class="hint">
					Leave the date empty to keep a task in Future tasks.
					{#if editing.recurrence}Changes here apply to every day it repeats; tick, ✕ and → change just one day.{/if}
				</p>
				<div class="actions">
					{#if editing.occurrence}
						<span class="actions-left">
							<button class="btn" formaction="?page={data.start}&/deleteOne" formnovalidate>Delete this day</button>
							<button class="btn" formaction="?page={data.start}&/delete" formnovalidate>Delete all</button>
						</span>
					{:else}
						<button class="btn" formaction="?page={data.start}&/delete" formnovalidate>Delete</button>
					{/if}
					<span class="actions-right">
						<button type="button" class="btn" onclick={() => sheet?.close()}>Cancel</button>
						<button class="btn primary">Save</button>
					</span>
				</div>
			</form>
		{/key}
	{/if}
</dialog>

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
	.wrap { touch-action: pan-y; }
	.page { margin-top: 0.4rem; }
	/* Dragging an item: it gets a dashed outline, and the day it would land on a thick one. */
	.lines li[data-uid] { user-select: none; -webkit-user-select: none; }
	li.dragging { outline: 2px dashed var(--ink); }
	.day.drop-target { outline: 4px solid var(--ink); outline-offset: -2px; }
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
	.inline { display: contents; }
	.act {
		font: inherit;
		background: none;
		border: 0;
		color: var(--muted);
		min-width: var(--line);
		min-height: var(--line);
		padding: 0;
		cursor: pointer;
	}
	/* The square is small like a paper box, but the whole line height around it is tappable. */
	.box { cursor: pointer; padding: 0; margin-left: -0.5rem; background: none; border: 0; width: 2.25rem; min-height: var(--line); flex: none; display: grid; place-items: center; }
	.sq { background: var(--paper); width: 1.25rem; height: 1.25rem; border: 2px solid var(--pen); border-radius: 3px; display: grid; place-items: center; font-weight: 800; font-size: 0.95rem; line-height: 1; color: var(--pen); }
	.time { font-variant-numeric: tabular-nums; color: var(--pen); font-weight: 700; min-width: 4.4em; font-size: 0.92rem; }
	.allday { color: var(--pen); font-weight: 700; font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; min-width: 4.4em; }
	.title { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--pen); }
	li.done .title, li.done .time { color: var(--muted); }
	li.dropped .title, li.dropped .time { text-decoration: line-through; text-decoration-thickness: 2px; color: var(--muted); }
	.blank form { flex: 1; display: flex; }
	.entry {
		flex: 1;
		min-width: 0;
		font: inherit;
		color: var(--pen);
		background: transparent;
		border: 0;
		padding: 0.2rem 0;
		min-height: var(--line);
	}
	.entry::placeholder { color: var(--muted); opacity: 0.6; font-size: 0.85rem; }
	.entry:focus { background: var(--wash); outline-offset: 0; }
	button.title {
		font: inherit;
		text-align: left;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		min-height: var(--line);
	}
	.someday { margin-top: 1.2rem; }
	.btn.wide { width: 100%; }
	.hint { color: var(--muted); font-size: 0.9rem; margin: 0.5rem 0; }
	.pull {
		font: inherit;
		font-size: 0.82rem;
		color: var(--ink);
		background: var(--paper);
		border: 1.5px solid var(--ink);
		border-radius: 6px;
		min-height: 40px;
		padding: 0 0.7rem;
		cursor: pointer;
		margin-left: 0.3rem;
	}
	.sheet {
		border: 2px solid var(--ink);
		border-radius: 10px;
		background: var(--paper);
		color: var(--ink);
		width: min(560px, calc(100vw - 32px));
		padding: 1rem;
	}
	.sheet::backdrop { background: rgba(0, 0, 0, 0.35); }
	.sheet form { display: grid; gap: 0.7rem; }
	.sheet-title { font-size: 1.2rem; margin: 0; }
	.field { display: grid; gap: 0.25rem; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); border: 0; padding: 0; margin: 0; }
	.field input, .field select, .field textarea {
		font: inherit;
		font-size: 1rem;
		font-weight: 400;
		letter-spacing: 0;
		color: var(--ink);
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 6px;
		min-height: 44px;
		padding: 0.2rem 0.5rem;
	}
	.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
	.seg { display: flex; gap: 0.4rem; }
	.seg label { display: flex; gap: 0.3rem; align-items: center; border: 2px solid var(--ink); border-radius: 6px; padding: 0 0.7rem; min-height: 44px; color: var(--ink); font-size: 1rem; font-weight: 400; }
	/* Save stays in reach on a phone while the rest of the sheet scrolls. */
	.actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; position: sticky; bottom: 0; background: var(--paper); padding-block: 0.6rem; border-top: 1px solid var(--rule); }
	.actions-left, .actions-right { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.btn.primary { background: var(--ink); color: var(--paper); }
	button.btn { cursor: pointer; }
	.error { color: var(--ink); border: 2px solid var(--ink); border-radius: 6px; padding: 0.4rem 0.6rem; margin: 0; font-weight: 700; }
	.tag { font-size: 0.72rem; border: 1px solid var(--muted); color: var(--muted); border-radius: 99px; padding: 0 0.4rem; white-space: nowrap; }
	.carry { font-size: 0.72rem; color: var(--muted); white-space: nowrap; }
	.repeat { font-size: 1rem; line-height: 1; color: var(--muted); }
	/* Work meetings: light red shading, plus a word, since e-ink shows the shade only as grey. */
	li.work { background: var(--work); }
	.work-tag { border-color: var(--ink); color: var(--ink); }
	@media (max-width: 520px) {
		.cols { grid-template-columns: 1fr; gap: 0.4rem; }
		.row2 { grid-template-columns: 1fr; }
		/* Title and month on one line, all four controls on the next: no third row eating the page. */
		h1 { flex-basis: 100%; }
		nav { flex-wrap: nowrap; width: 100%; }
		input[type='date'] { flex: 1; min-width: 0; font-size: 0.95rem; }
	}
</style>
