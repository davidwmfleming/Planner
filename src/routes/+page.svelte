<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { beforeNavigate, goto, invalidateAll, preloadData, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { addDays, toISODate } from '$lib/dates';
	import { movedFar, readStroke, type Point } from '$lib/gesture';
	import { LIMITS } from '$lib/edit';
	import { dayLetter, dayName, dayNumber, formatTime, monthShort, monthYear, pageSubtitle, saysReload, shortTitle } from '$lib/format';
	import type { Item } from '$lib/item';
	import { dayBegun, freshAddress, mayAsk, pageForNewDay, pageToRead, retryAfter, shownAddress, turnedToNewDay, untilMidnight } from '$lib/new-day';
	import { REPEATS, repeatChoice } from '$lib/repeat';
	import { onMount, tick, untrack } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The details sheet: tap an item's title to see and edit everything about it.
	let editing = $state<Item | null>(null);
	let sheet = $state<HTMLDialogElement>();
	// Picking "New calendar…" in the sheet asks for its name.
	let newCalendar = $state(false);
	// Why the sheet's last save or delete didn't work.
	let sheetMessage = $state('');
	function openDetails(item: Item) {
		editing = item;
		newCalendar = false;
		sheetMessage = '';
		sheet?.showModal();
	}
	const DID_NOT_WORK = 'That did not work; try again';
	const OFFLINE = 'That did not save. Check the connection and try again.';
	/** A refusal or failure as a plain sentence. Never the error screen, which in the installed app has no way back.
	 * A request that never reached the planner (no connection) fails with a TypeError, rather than an answer. */
	const problemOf = (result: { type: string; data?: Record<string, unknown>; error?: unknown }) =>
		result.type === 'failure'
			? String(result.data?.message ?? DID_NOT_WORK)
			: result.type === 'error'
				? result.error instanceof TypeError ? OFFLINE : DID_NOT_WORK
				: '';
	/** The calendar server didn't answer in time: the change may be made after all, so sending it again could make two. */
	const mayBeDone = (message: string) => /\bmay or may not\b/i.test(message);
	let sheetTrouble = $state<HTMLElement>();
	let saveButton = $state<HTMLButtonElement>();
	/** Closing the sheet's message leaves focus on Save, ready to try again, not at the top of the page. */
	async function closeSheetMessage() {
		sheetMessage = '';
		await tick();
		saveButton?.focus();
	}
	// A second tap on Save (or Delete) while the sheet is still saving is ignored, like a double tap on a tick:
	// it would send the change twice, and a move between calendars could make two copies.
	let sheetSaving = false;
	const closeOnSuccess: SubmitFunction = ({ cancel }) => {
		if (sheetSaving) return cancel();
		sheetSaving = true;
		return async ({ result, update }) => {
			try {
				sheetMessage = problemOf(result);
				if (sheetMessage) {
					// The message sits in the sheet's Save bar, which a phone keeps on screen; make sure it is in view anyway.
					await tick();
					sheetTrouble?.scrollIntoView({ block: 'nearest' });
					return;
				}
				await update();
				sheet?.close();
			} finally {
				sheetSaving = false;
			}
		};
	};
	// Tick, ✕, → and the other taps on a row: a problem is said under the page's header, like a line that didn't save.
	// The same tap again while it is still saving (a double tap, a slow connection) is ignored: it would undo the first.
	const tapsSaving = new Set<string>();
	const reportProblems: SubmitFunction = ({ action, formData, cancel, submitter }) => {
		const tap = JSON.stringify([action.search, ...formData]);
		if (tapsSaving.has(tap)) return cancel();
		tapsSaving.add(tap);
		return async ({ result, update }) => {
			try {
				gestureMessage = problemOf(result);
				troubleAbout = submitter ?? undefined;
				if (!gestureMessage) await update();
			} finally {
				tapsSaving.delete(tap);
			}
		};
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

	const pageUrl = (start: string) => `?page=${start}`;

	// Marks on the page, like on paper: sweep a finger sideways to turn the page; with the pen, draw ✓ on an item to tick it,
	// scribble over it to strike it out, or drag it onto another day. The pen never scrolls; fingers do. The tap buttons all still work.
	type Active = { id: number; points: Point[]; pen: boolean; finger: boolean; row?: HTMLElement; uid?: string; occurrence?: string; calendar?: string; from?: string };
	let stroke: Active | null = null;
	let dropDay = $state<string | null>(null);
	let dragging = $state<string | null>(null);
	let gestureMessage = $state('');
	/** What the message under the header is about (the tapped button, the item, the line), for focus once it is closed. */
	let troubleAbout: Element | undefined;
	let pageTitle = $state<HTMLElement>();
	/** Closing a message puts focus back where it was, rather than at the top of the page. */
	async function closeGestureMessage() {
		gestureMessage = '';
		await tick();
		const back = troubleAbout?.isConnected ? troubleAbout : pageTitle;
		(back as HTMLElement | undefined)?.focus();
	}
	// Marks drawn on items, shown at once while they save.
	let marking = $state<Record<string, 'done' | 'dropped'>>({});
	// One row on the page. A UID alone isn't enough: a move between calendars that stopped halfway can leave
	// the same item in two calendars, and both copies are shown (each can be ticked or deleted on its own).
	const rowKey = (item: { uid: string; occurrence?: string; calendar?: string }) => `${item.calendar ?? ''} ${item.uid} ${item.occurrence ?? ''}`;
	// Items shown more than once on a day (or on Future tasks): each copy says which calendar it is in.
	const twice = $derived.by(() => {
		const seen = new Set<string>();
		const again = new Set<string>();
		const lists = [...data.days.map((d) => ({ date: d.date, items: [...d.events, ...d.tasks] })), { date: '', items: data.unscheduled }];
		for (const { date, items } of lists)
			for (const item of items) {
				const key = `${date} ${item.uid}`;
				(seen.has(key) ? again : seen).add(key);
			}
		return again;
	});
	/** What an item's calendar tag says, and the calendar's full name; none for a task in the main Tasks list. */
	function calendarTagOf(item: Item, date: string) {
		if (!item.calendar) return null;
		const work = item.calendar === data.workCalendar;
		if (!work && item.kind === 'task' && item.calendar === data.tasksCalendar && !twice.has(`${date} ${item.uid}`)) return null;
		return { work, name: data.calendarLabels[item.calendar] ?? 'Unnamed calendar', shown: data.calendarTags[item.calendar] ?? 'Cal' };
	}
	let swallowClick = false;

	const dayAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('section.day')?.dataset.date;

	function onStrokeStart(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (!e.isPrimary || target.closest('input, select, textarea, dialog, header, a')) return;
		// Near a line being written on, the pen belongs to the handwriting keyboard: no marks there.
		const writing = document.activeElement;
		if (writing?.classList.contains('entry')) {
			const r = writing.getBoundingClientRect();
			if (e.clientY > r.top - 24 && e.clientY < r.bottom + 24) return;
		}
		swallowClick = false;
		const row = target.closest<HTMLElement>('li[data-uid]') ?? undefined;
		stroke = {
			id: e.pointerId,
			points: [{ x: e.clientX, y: e.clientY }],
			pen: e.pointerType === 'pen',
			finger: e.pointerType === 'touch',
			row,
			uid: row?.dataset.uid,
			occurrence: row?.dataset.occurrence,
			calendar: row?.dataset.calendar,
			from: row ? (row.closest<HTMLElement>('section.day')?.dataset.date ?? '') : undefined
		};
	}
	function onStrokeMove(e: PointerEvent) {
		if (!stroke || e.pointerId !== stroke.id) return;
		stroke.points.push({ x: e.clientX, y: e.clientY });
		if (stroke.uid && movedFar(stroke.points[0], stroke.points[stroke.points.length - 1])) {
			const day = dayAt(e.clientX, e.clientY);
			dragging = rowKey({ ...stroke, uid: stroke.uid });
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
		const item = done.uid
			? { uid: done.uid, ...(done.occurrence ? { occurrence: done.occurrence } : {}), ...(done.calendar ? { keptIn: done.calendar } : {}) }
			: undefined;
		if (item && target) return send('move', { ...item, to: target });
		const read = readStroke(done.points);
		// Fingers (and a mouse) turn pages; the pen only makes marks, so a sloppy scribble never flips the page.
		if (read === 'next' || read === 'previous') return done.pen ? undefined : goto(pageUrl(read === 'next' ? data.next : data.previous));
		// Only the pen (or a mouse) makes marks; a finger is for turning pages and scrolling.
		if (!item || done.finger) return;
		const mark = read === 'tick' ? 'done' : read === 'scratch' ? 'dropped' : undefined;
		if (!mark || done.row?.classList.contains(mark)) return;
		// Show the mark at once; once saved, the page redraws from the server. A mark only ever sets a state,
		// so drawing it again (on a slow save, or on a page that is out of date) never undoes it.
		const key = rowKey({ ...done, uid: item.uid });
		marking[key] = mark;
		return send('mark', { ...item, state: mark, set: 'yes' }).finally(() => {
			if (marking[key] === mark) delete marking[key];
		});
	}
	function onStrokeCancel() {
		stroke = null;
		dropDay = null;
		dragging = null;
	}
	// A pen stroke shouldn't also scroll the page (fingers still scroll). Pointer events can't stop that; touch events can.
	function holdPagePen(e: TouchEvent) {
		// Some tablets (the ViWoods among them) don't mark pen touches as a stylus, so go by the pointer that started the stroke.
		const stylus = [...e.touches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus');
		if (stroke && e.cancelable && (stroke.pen || stylus)) e.preventDefault();
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

	/** A pen mark has no button of its own: its item's first button stands for it. */
	const itemButton = (uid?: string) => (uid ? (document.querySelector(`li[data-uid="${CSS.escape(uid)}"] button`) ?? undefined) : undefined);
	async function send(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		let result;
		try {
			const response = await fetch(`?page=${data.start}&/${action}`, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			result = deserialize(await response.text());
		} catch {
			gestureMessage = OFFLINE;
			troubleAbout = itemButton(fields.uid);
			return false;
		}
		gestureMessage = problemOf(result);
		troubleAbout = itemButton(fields.uid);
		// Only redraw after a change: with the calendar server down, redrawing would swap the page for an error screen.
		if (!gestureMessage) await invalidateAll();
		return result.type === 'success';
	}
	// After saving a line, keep the cursor on the blank line so the next entry can follow straight away.
	// Tapping away from a line saves it too, so handwriting needs no Enter. The cursor then stays where you tapped.
	// The line is cleared as soon as it is sent, so you can keep writing while it saves; if saving fails, the words come back.
	// (Saving redraws the page, which can drop focus, so focus is put back on purpose.)
	const LEAVE_DELAY = 700;
	const saving = new Set<HTMLFormElement>();
	const left = new Set<HTMLFormElement>();
	const tappedTo = new Map<HTMLFormElement, HTMLElement>();
	// Lines that may or may not have been saved (no answer in time) keep their words, but are only sent again on Enter:
	// sending them when the cursor leaves, or the page turns, could make a second copy.
	const unsure = new Set<HTMLFormElement>();
	const lineOf = (form: HTMLFormElement) => form.querySelector<HTMLInputElement>('input[name="text"]')!;
	const keepWriting: SubmitFunction = ({ formElement, formData }) => {
		const line = lineOf(formElement);
		const written = String(formData.get('text') ?? '');
		saving.add(formElement);
		unsure.delete(formElement);
		line.value = '';
		return async ({ result, update }) => {
			if (result.type === 'success' || result.type === 'redirect') {
				gestureMessage = '';
				await update({ reset: false });
			} else {
				line.value = line.value.trim() ? `${written} ${line.value}` : written;
				troubleAbout = line;
				gestureMessage =
					result.type === 'failure' ? String(result.data?.message ?? `Couldn't save "${shortTitle(written)}"; try again`) : `Couldn't save "${shortTitle(written)}". Check the connection, then tap the line and try again.`;
				if (result.type === 'failure' && mayBeDone(gestureMessage)) unsure.add(formElement);
			}
			saving.delete(formElement);
			const next = tappedTo.get(formElement) ?? (left.has(formElement) ? undefined : line);
			if (next?.isConnected && (document.activeElement === document.body || document.activeElement === null)) next.focus();
			// Words written while the last line was saving, then left: save those too (and keep the cursor where it went).
			if (result.type !== 'error' && !unsure.has(formElement) && line.value.trim() && document.activeElement !== line) {
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
		const form = input.form;
		// SvelteKit parks focus on the page body while it redraws; that isn't a tap.
		const tapped = e.relatedTarget instanceof HTMLElement && e.relatedTarget !== document.body ? e.relatedTarget : undefined;
		if (!form) return;
		// Wait a moment: a handwriting keyboard can take focus briefly mid-word, and the line must not be saved under it.
		const decide = () => {
			if (document.activeElement === input) return;
			input.classList.remove('writing');
			// The whole page lost focus (another app or the keyboard): decide when it comes back.
			if (!document.hasFocus()) return void addEventListener('focus', () => setTimeout(decide, LEAVE_DELAY), { once: true });
			if (!saving.has(form) && !input.value.trim()) return;
			if (unsure.has(form)) return;
			if (tapped) tappedTo.set(form, tapped);
			if (saving.has(form)) return;
			left.add(form);
			form.requestSubmit();
		};
		setTimeout(decide, LEAVE_DELAY);
	}

	// Turning the page or leaving it right after writing: save the words now rather than after the pause.
	const unsaved = () => [...document.querySelectorAll<HTMLInputElement>('input.entry')].filter((i) => i.form && i.value.trim() && !saving.has(i.form) && !unsure.has(i.form));
	function sendLine(input: HTMLInputElement, keepalive = false) {
		const body = new FormData(input.form!);
		input.value = '';
		return fetch(input.form!.action, { method: 'POST', body, keepalive, headers: { 'x-sveltekit-action': 'true' } });
	}
	beforeNavigate((nav) => {
		const lines = unsaved();
		if (!lines.length) return;
		if (nav.willUnload || !nav.to) {
			for (const line of lines) sendLine(line, true);
			return;
		}
		nav.cancel();
		const to = nav.to.url;
		Promise.all(lines.map((line) => sendLine(line))).finally(() => goto(to));
	});

	// A new day: a page left open overnight (the tablet asleep with the planner open) moves on by itself, at midnight
	// and when the screen wakes. The server's today decides; this device's clock only says when to ask.
	// A page showing today moves on to the new today's page; one flipped to on purpose stays, refreshed.
	// Nothing changes under a line being written or saved, a mark or tap saving, a stroke or the details sheet: it waits.
	const WHILE_WRITING = 10_000;
	// The server's clock may be behind this one, or it can't be reached yet: ask again (see retryAfter), and don't
	// let every wake or focus ask meanwhile (see mayAsk).
	let lastAsked = 0;
	// Said under the header while a line holds the page on the old day, so it isn't a mystery.
	let dayNote = $state('');
	const lineWritten = () => [...document.querySelectorAll<HTMLInputElement>('input.entry')].some((i) => i.value.trim());
	let seen: { today: string; todayPage: string; start: string } | undefined;
	let dayTimer: ReturnType<typeof setTimeout> | undefined;
	let checking = false;
	let tries = 0;
	let gone = false;
	const shown = () => ({ today: data.today, todayPage: data.todayPage, start: data.start });
	const busy = () =>
		saving.size > 0 || left.size > 0 || tapsSaving.size > 0 || sheetSaving || !!editing || !!stroke || Object.keys(marking).length > 0 || lineWritten();
	// Reads go to addresses of their own (see freshAddress), numbered.
	let reads = 0;
	// When the server first didn't have the new day (or couldn't be reached), for retryAfter.
	let troubleSince = 0;
	/** Reads a page's data ahead, without showing it. A refresh or turn that failed would swap the planner for the error
	 * screen (no Wi-Fi yet on waking, the calendar server down), so a page is only shown once read this way; showing
	 * it then uses what was read, so it is read once and nothing can fail in between. */
	async function readAhead(start: string) {
		const address = freshAddress(start, ++reads);
		try {
			const result = await preloadData(address);
			if (result.type === 'loaded' && result.status === 200) return { address, data: result.data as { today: string; todayPage: string; start: string } };
		} catch {
			// no connection: as if not answered
		}
		return undefined;
	}
	/** Shows a page read ahead, then puts its plain address back in the address bar. */
	async function showRead(address: string, hadPage: boolean) {
		await goto(address, { replaceState: true, noScroll: true, keepFocus: true });
		replaceState(shownAddress(hadPage, shown()) || location.pathname, page.state);
	}
	/** The timer's own checks always ask; a wake, focus or new data may be held back by mayAsk. */
	async function newDay(timed = false) {
		if (checking) return;
		seen ??= shown();
		const waiting = busy();
		const begun = dayBegun(new Date(), data.today);
		// Asked too often already: leave it to the timer, which is set.
		if (!timed && !waiting && begun && !pageForNewDay(seen, shown()) && !mayAsk(tries, Date.now() - lastAsked)) return;
		checking = true;
		clearTimeout(dayTimer);
		let wait;
		const before = seen;
		const hadPage = new URL(location.href).searchParams.has('page');
		try {
			let failed = false;
			if (!waiting && begun) {
				lastAsked = Date.now();
				const now = shown();
				let read = await readAhead(pageToRead(now, new Date()));
				// The server's new today is on another page than this device's (the clocks differ): read that one instead.
				if (read && read.data.today !== now.today && now.start === now.todayPage && read.data.start !== read.data.todayPage)
					read = await readAhead(read.data.todayPage);
				if (!read) failed = true;
				else if (read.data.today !== now.today && !busy()) await showRead(read.address, hadPage);
			}
			const to = pageForNewDay(seen, shown());
			const held = waiting || busy();
			if (to && !held) {
				const read = await readAhead(to);
				if (read) {
					await showRead(read.address, hadPage);
					seen = shown();
				} else failed = true;
			} else if (!to) seen = shown();
			const behind = dayBegun(new Date(), data.today);
			const trouble = (behind || failed) && !held;
			if (trouble && !tries) troubleSince = Date.now();
			tries = trouble ? tries + 1 : 0;
			// A phone keeps where it was scrolled to, which could leave the new today off screen.
			if (turnedToNewDay(before, shown())) scrollTo(0, 0);
			const turns = to || (behind && seen.start === seen.todayPage);
			dayNote = held && turns && lineWritten() ? `It's now ${dayName(to ? data.today : toISODate(new Date()))}. The page turns once this line is saved or cleared.` : '';
			wait = held && (to || behind) ? WHILE_WRITING : trouble ? retryAfter(tries, Date.now() - troubleSince, new Date()) : untilMidnight(new Date());
		} catch {
			if (!tries) troubleSince = Date.now();
			wait = retryAfter(++tries, Date.now() - troubleSince, new Date());
		} finally {
			checking = false;
		}
		if (!gone) dayTimer = setTimeout(() => newDay(true), wait);
	}
	// Any new data (a save, a turned page, a refresh) may bring a new today, or show where the viewer is now.
	$effect(() => {
		void [data.today, data.start];
		untrack(() => void newDay());
	});
	onMount(() => {
		const awake = () => document.visibilityState === 'visible' && newDay();
		document.addEventListener('visibilitychange', awake);
		addEventListener('focus', awake);
		addEventListener('pageshow', awake);
		return () => {
			gone = true;
			clearTimeout(dayTimer);
			document.removeEventListener('visibilitychange', awake);
			removeEventListener('focus', awake);
			removeEventListener('pageshow', awake);
		};
	});

	function onJump(e: Event) {
		const value = (e.currentTarget as HTMLInputElement).value;
		if (value) goto(pageUrl(value));
	}
</script>

{#snippet itemRow(item: Item, date: string)}
	{@const mark = marking[rowKey(item)]}
	<li class={[mark ?? item.state, mark && 'marked', item.calendar === data.workCalendar && 'work', dragging === rowKey(item) && 'dragging']} data-uid={item.uid} data-occurrence={item.occurrence} data-calendar={item.calendar}>
		<form method="POST" action="?page={data.start}&/mark" use:enhance={reportProblems} class="inline">
			<input type="hidden" name="uid" value={item.uid} /><input type="hidden" name="keptIn" value={item.calendar} />
			{#if item.occurrence}<input type="hidden" name="occurrence" value={item.occurrence} />{/if}
			<button class="box" name="state" value="done" aria-label="{item.state === 'done' ? 'Untick' : 'Tick'} {item.title}"><span class="sq">{item.state === 'done' ? '✓' : ''}</span></button>
		</form>
		{#if item.time}<span class="time">{formatTime(item.time)}</span>{:else if item.kind === 'event'}<span class="allday">All day</span>{/if}
		{@render titleOf(item, date)}
		{#if item.label}<span class="tag">{item.label}</span>{/if}
		{#if item.recurrence}<span class="repeat" title="Repeats">⟳</span>{/if}
		{#if item.carriedFrom && item.state === 'open'}<span class="carry" title="Carried over">↻ {dayLetter(item.carriedFrom)} {dayNumber(item.carriedFrom)}</span>{/if}
		<form method="POST" action="?page={data.start}&/mark" use:enhance={reportProblems} class="inline">
			<input type="hidden" name="uid" value={item.uid} /><input type="hidden" name="keptIn" value={item.calendar} />
			{#if item.occurrence}<input type="hidden" name="occurrence" value={item.occurrence} />{/if}
			<button class="act" name="state" value="dropped" aria-label="{item.state === 'dropped' ? 'Restore' : 'Drop'} {item.title}">✕</button>
		</form>
		{#if item.kind === 'task' && date}
			<form method="POST" action="?page={data.start}&/move" use:enhance={reportProblems} class="inline">
				<input type="hidden" name="uid" value={item.uid} /><input type="hidden" name="keptIn" value={item.calendar} />
			{#if item.occurrence}<input type="hidden" name="occurrence" value={item.occurrence} />{/if}
				<button class="act" name="to" value={addDays(date, 1)} aria-label="Move {item.title} to the next day">→</button>
			</form>
			{#if !item.recurrence}
				<form method="POST" action="?page={data.start}&/unschedule" use:enhance={reportProblems} class="inline">
					<input type="hidden" name="uid" value={item.uid} /><input type="hidden" name="keptIn" value={item.calendar} />
					<button class="act" aria-label="Put {item.title} back on Future tasks" title="Back to Future tasks">↩</button>
				</form>
			{/if}
		{/if}
	</li>
{/snippet}

<!-- An item's title, which opens its details, and the calendar it is in, in a few letters ("Fami" for Family). Work
     events say Work instead, since e-ink shows their shading only as grey. Tasks in the main Tasks list have no tag,
     unless the same task is also in another list. The tag goes under the title when the row is narrow, so the title
     keeps most of the row. Its full name is read out; a tap on it opens the details, like a tap on the title. -->
{#snippet titleOf(item: Item, date: string)}
	{@const tag = calendarTagOf(item, date)}
	{#if tag}
		<span class="titled">
			<button type="button" class="title" onclick={() => openDetails(item)} aria-label="Details for {item.title}">{item.title}</button>
			<span class={['tag', 'cal-tag', tag.work && 'work-tag']} title="In {tag.name}"><span aria-hidden="true">{tag.shown}</span><span class="unseen">, in {tag.name}</span></span>
		</span>
	{:else}
		<button type="button" class="title" onclick={() => openDetails(item)} aria-label="Details for {item.title}">{item.title}</button>
	{/if}
{/snippet}

{#snippet pullButtons(item: Item)}
	<form method="POST" action="?page={data.start}&/move" use:enhance={reportProblems} class="inline">
		<input type="hidden" name="uid" value={item.uid} /><input type="hidden" name="keptIn" value={item.calendar} />
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
				onfocus={(e) => e.currentTarget.classList.add('writing')}
				onblur={saveOnLeave}
				oninput={(e) => {
					// Emptied: whatever is written next is a new line, saved as usual.
					if (!e.currentTarget.value.trim()) unsure.delete(e.currentTarget.form!);
				}}
				name="text"
				maxlength={LIMITS.title}
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
		<!-- The month in large type, as at the top of a paper notebook page; "Planner" is still read out. -->
		<div class="heading">
			<h1 tabindex="-1" bind:this={pageTitle}><span class="unseen">Planner · </span>{monthYear(data.start)}</h1>
			<p class="week">{pageSubtitle(data.days.map((d) => d.date))}</p>
		</div>
		<nav aria-label="Pages">
			<a class="btn" href={pageUrl(data.previous)} aria-label="Previous page">‹</a>
			<a class="btn" href={pageUrl(data.todayPage)}>Today</a>
			<a class="btn" href={pageUrl(data.next)} aria-label="Next page">›</a>
			<input type="date" id="jump" aria-label="Go to date" value={data.start} onchange={onJump} />
		</nav>
		<!-- A drawn gear rather than ⚙, which some phones show as a colour emoji. -->
		<a class="btn gear" href="/settings" aria-label="Settings">
			<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor">
				<circle cx="12" cy="12" r="8.5" stroke-width="3.5" stroke-dasharray="3.34 3.34" />
				<circle cx="12" cy="12" r="6.5" stroke-width="2.5" />
				<circle cx="12" cy="12" r="2" stroke-width="2" />
			</svg>
		</a>
		<!-- In the header, which stays at the top of the screen, so a message is seen however far down the page is scrolled. -->
		{#if dayNote}<p class="notice day-note" role="status">{dayNote}</p>{/if}
		{#if gestureMessage}
			<div class="trouble">
				<span class="trouble-buttons">
					{#if saysReload(gestureMessage)}<button type="button" class="btn" onclick={() => location.reload()}>Reload</button>{/if}
					<button type="button" class="btn close" aria-label="Close the message" onclick={closeGestureMessage}>×</button>
				</span>
				<p class="error" role="alert">{gestureMessage}</p>
			</div>
		{/if}
	</header>

	{#if !data.eventCalendars.length}
		<p class="notice">There are no event calendars, so new events have nowhere to go. <a href="/settings">Add one in Settings</a>.</p>
	{/if}
	<!-- Saved by another app in a way the planner can't read; everything else is still shown. -->
	{#if data.unreadable}
		<p class="notice unreadable">{data.unreadable === 1 ? "1 item couldn't be read and isn't shown." : `${data.unreadable} items couldn't be read and aren't shown.`}</p>
	{/if}
	<main class="page">
		{#each data.days as day (day.date)}
			<!-- Today has a thick black bar down its left edge (drawn by the stylesheet), as well as its Today tag. -->
			<section class="day" class:weekend={day.weekend} class:today={day.date === data.today} class:drop-target={dropDay === day.date} aria-label={day.date} data-date={day.date}>
				<div class="day-head">
					<span class="dnum">{dayNumber(day.date)}</span>
					<!-- The month is in the header; a day in another month (a page running into November) says so. -->
					<span class="dname">{dayName(day.date)}{#if monthShort(day.date) !== monthShort(data.start)}<span class="dmonth">{' · '}{monthShort(day.date)}</span>{/if}</span>
					{#if day.date === data.today}<span class="today-tag">Today</span>{/if}
				</div>
				<div class="col">
					<h2>Events</h2>
					<ul class="lines">
						{#each day.events as item (rowKey(item))}
							{@render itemRow(item, day.date)}
						{/each}
						{@render blankLine('event', day.date)}
					</ul>
				</div>
				<div class="col">
					<h2>Tasks</h2>
					<ul class="lines">
						{#each day.tasks as item (rowKey(item))}
							{@render itemRow(item, day.date)}
						{/each}
						{@render blankLine('task', day.date)}
					</ul>
				</div>
			</section>
		{/each}
	</main>

	<section class="someday" aria-label="Future tasks">
		<button type="button" class="btn wide" aria-expanded={showUnscheduled} onclick={toggleUnscheduled}>
			{showUnscheduled ? 'Hide' : 'Show'} future tasks ({data.unscheduled.length})
		</button>
		{#if showUnscheduled}
			<p class="hint">Tasks without a day, by list. Put any of them on today or the coming Saturday.</p>
			<ul class="lines">
				{#each data.unscheduled as item (rowKey(item))}
					<li class={[marking[rowKey(item)] ?? item.state, marking[rowKey(item)] && 'marked', dragging === rowKey(item) && 'dragging']} data-uid={item.uid} data-calendar={item.calendar}>
						{@render titleOf(item, '')}
						{#if item.label}<span class="tag">{item.label}</span>{/if}
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
		{#key rowKey(editing)}
			<form method="POST" action="?page={data.start}&/save" use:enhance={closeOnSuccess}>
				<input type="hidden" name="uid" value={editing.uid} />
				<input type="hidden" name="keptIn" value={editing.calendar} />
				{#if editing.occurrence}<input type="hidden" name="occurrence" value={editing.occurrence} />{/if}
				<h2 class="sheet-title">Details</h2>
				<label class="field">Title <input name="title" id="f-title" value={editing.title} maxlength={Math.max(LIMITS.title, editing.title.length)} required /></label>
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
					{#if editing.kind === 'task'}
						<label class="field">List
							<select name="label" id="f-label" value={editing.label ?? ''}>
								<option value="">None</option>
								{#each data.categories as category (category)}<option value={category}>{category}</option>{/each}
							</select>
						</label>
					{/if}
				</div>
				{#if editing.kind === 'task' && editing.calendar && editing.calendar !== data.tasksCalendar}
					<p class="hint">In the list {data.calendarLabels[editing.calendar] ?? 'Unnamed calendar'}.</p>
				{/if}
				{#if editing.kind === 'event'}
					<label class="field">Calendar
						<select name="calendar" id="f-calendar" value={editing.calendar ?? data.defaultEventCalendar} onchange={(e) => (newCalendar = e.currentTarget.value === '+new')}>
							{#each data.eventCalendars as calendar (calendar.path)}<option value={calendar.path}>{calendar.label}</option>{/each}
							<option value="+new">New calendar…</option>
						</select>
					</label>
					{#if newCalendar}
						<label class="field">New calendar's name <input name="newCalendar" id="f-new-calendar" required /></label>
					{/if}
				{/if}
				<label class="field">Repeats
					<select name="repeat" id="f-repeat" value={repeatChoice(editing.recurrence)}>
						{#each REPEATS as r (r.value)}<option value={r.value}>{r.name}</option>{/each}
						{#if repeatChoice(editing.recurrence) === 'custom'}<option value="custom">As set on another device</option>{/if}
					</select>
				</label>
				<label class="field">Location <input name="location" id="f-location" value={editing.location ?? ''} maxlength={Math.max(LIMITS.location, editing.location?.length ?? 0)} /></label>
				<label class="field">Notes <textarea name="notes" id="f-notes" rows="3" maxlength={Math.max(LIMITS.notes, editing.notes?.length ?? 0)}>{editing.notes ?? ''}</textarea></label>
				<p class="hint">
					Leave the date empty to keep a task in Future tasks.
					{#if editing.recurrence}Changes here apply to every day it repeats; tick, ✕ and → change just one day.{/if}
				</p>
				<div class="actions">
					<!-- In the Save bar, which stays on screen on a phone while the rest of the sheet scrolls. -->
					{#if sheetMessage}
						<div class="trouble" bind:this={sheetTrouble}>
							<span class="trouble-buttons">
								{#if saysReload(sheetMessage)}<button type="button" class="btn" onclick={() => location.reload()}>Reload</button>{/if}
								<button type="button" class="btn close" aria-label="Close the message" onclick={closeSheetMessage}>×</button>
							</span>
							<p class="error" role="alert">{sheetMessage}</p>
						</div>
					{/if}
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
						<button class="btn primary" bind:this={saveButton}>Save</button>
					</span>
				</div>
			</form>
		{/key}
	{/if}
</dialog>

<style>
	/* The "Notebook" look: black on white, a serif month and day numbers, grey ruled lines, the tasks side in light grey.
	   The page runs edge to edge (so today's bar sits at the screen's edge); each part keeps its own margin, the gutter. */
	.wrap {
		--muted: #555555;
		--rule: #b8b8b8;
		--col-rule: #8a8a8a;
		--hint: #6b6b6b;
		--tasks-side: #ececec;
		/* Darker lines on the grey side, so they still show on an e-ink screen. */
		--rule-grey: #949494;
		--gutter: clamp(16px, 4.8vw, 48px);
		--gutter-left: max(var(--gutter), env(safe-area-inset-left, 0px));
		--gutter-right: max(var(--gutter), env(safe-area-inset-right, 0px));
		--line: 2.75rem;
		max-width: 1000px;
		margin: 0 auto;
		padding-block: 0 2rem;
		font-size: 1.1875rem;
	}
	/* A tablet's pen or finger gets the notebook's tall lines. */
	@media (pointer: coarse) and (min-width: 521px) { .wrap { --line: 3.25rem; } }
	@media (prefers-color-scheme: dark) {
		.wrap { --muted: #a3abb9; --rule: #2f3746; --col-rule: #586072; --hint: #8d95a3; --tasks-side: #1d222b; --rule-grey: #2f3746; }
	}
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--paper);
		border-bottom: 2px solid var(--ink);
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: center;
		padding: 28px var(--gutter-right) 20px var(--gutter-left);
		font-size: 1rem;
	}
	.heading { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	h1 { font-family: var(--serif); font-weight: 600; font-size: 2.25rem; line-height: 1.1; letter-spacing: -0.01em; margin: 0; }
	.week { margin: 0; font-size: 0.94rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
	nav { display: flex; gap: 0.75rem; flex-wrap: wrap; }
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
	/* The header's controls are round-ended, like the notebook's tabs. */
	.bar .btn, .bar input[type='date'] { border-width: 1.5px; border-radius: 24px; min-height: 48px; min-width: 48px; }
	.bar input[type='date'] { padding: 0 1rem; }
	nav .btn { font-weight: 700; padding: 0 1.25rem; }
	nav .btn[aria-label] { padding: 0; font-size: 1.4rem; }
	.bar .gear { padding: 0; border-color: transparent; }
	.wrap { touch-action: pan-y; }
	.page { margin-top: 0.4rem; }
	/* Dragging an item: it gets a dashed outline, and the day it would land on a thick one. */
	.lines li[data-uid] { user-select: none; -webkit-user-select: none; }
	li.dragging { outline: 2px dashed var(--ink); }
	.day.drop-target { outline: 4px solid var(--ink); outline-offset: -2px; }
	/* A day: the date in its own narrow column, then events, then tasks, each the day's full height. */
	.day {
		position: relative;
		display: grid;
		/* Wide enough for WEDNESDAY on one line. */
		grid-template-columns: calc(var(--gutter-left) + 96px) minmax(0, 1fr) minmax(0, 1fr);
		border-bottom: 1px solid var(--ink);
		min-height: calc((100dvh - 12rem) / 3);
	}
	.day.weekend { min-height: calc((100dvh - 12rem) / 6); }
	/* Today's bar, over everything in the day (on a phone the tasks run full width beneath the events). */
	.day.today::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 8px; background: var(--ink); pointer-events: none; z-index: 1; }
	.day-head { padding: 20px 0 16px var(--gutter-left); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.dnum { font-family: var(--serif); font-size: 3.25rem; line-height: 1; font-weight: 600; font-variant-numeric: tabular-nums; }
	.dname { font-size: 0.8125rem; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
	.today-tag { margin-top: 8px; align-self: flex-start; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; background: var(--ink); color: var(--paper); padding: 3px 7px; border-radius: 3px; }
	.col { min-width: 0; padding: 18px 24px 16px 16px; border-right: 1px solid var(--col-rule); }
	/* The tasks side is light grey, to set it apart from the events. */
	.col + .col { padding: 18px var(--gutter-right) 16px 24px; border-right: 0; background: var(--tasks-side); --rule: var(--rule-grey); }
	.col + .col .entry:focus { background: var(--paper); }
	h2 { font-size: 0.8125rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); margin: 0; padding-bottom: 6px; font-weight: 400; }
	.lines { list-style: none; margin: 0; padding: 0; }
	.lines li { min-height: var(--line); border-bottom: 1px solid var(--rule); display: flex; align-items: center; gap: 0.6rem; }
	.inline { display: contents; }
	.act {
		font: inherit;
		background: none;
		border: 0;
		color: var(--muted);
		/* Tall as the line, but not as wide, so a task's title keeps room beside ✕, → and ↩. */
		min-width: min(var(--line), 44px);
		min-height: var(--line);
		padding: 0;
		cursor: pointer;
	}
	/* The square is small like a paper box, but the whole line height around it is tappable. */
	.box { cursor: pointer; padding: 0; margin-left: -0.5rem; background: none; border: 0; width: 2.25rem; min-height: var(--line); flex: none; display: grid; place-items: center; }
	.sq { background: var(--paper); width: 22px; height: 22px; border: 2px solid var(--ink); border-radius: 3px; display: grid; place-items: center; font-weight: 700; font-size: 1.0625rem; line-height: 1; color: var(--ink); }
	.time { font-variant-numeric: tabular-nums; color: var(--ink); font-weight: 700; min-width: 4.4em; font-size: 0.9em; }
	.allday { color: var(--ink); font-weight: 700; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; min-width: 5.6em; }
	.title { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--ink); }
	li.done .title, li.done .time { color: var(--muted); }
	li.done.marked .sq::after { content: '✓'; }
	li.dropped .title, li.dropped .time { text-decoration: line-through; text-decoration-thickness: 2px; color: var(--muted); }
	.blank form { flex: 1; display: flex; }
	.entry {
		flex: 1;
		min-width: 0;
		font: inherit;
		color: var(--ink);
		background: transparent;
		border: 0;
		padding: 0.2rem 0;
		min-height: var(--line);
	}
	.entry::placeholder { color: var(--hint); opacity: 1; font-size: 1rem; }
	.entry:focus { background: var(--wash); outline-offset: 0; }
	/* A line being written on opens up, so there's room for handwriting. It closes a moment after you leave it,
	   so the page doesn't shift under a tap that is still landing. */
	.entry.writing { min-height: calc(var(--line) * 2.2); font-size: 1.15rem; }
	button.title {
		font: inherit;
		text-align: left;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		min-height: var(--line);
	}
	.someday { padding: 18px var(--gutter-right) 0 var(--gutter-left); }
	/* Future tasks: a round-ended button in the middle, like the header's. */
	.btn.wide { display: grid; margin-inline: auto; min-height: 48px; padding: 0 1.5rem; border-width: 1.5px; border-radius: 24px; font-weight: 700; }
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
	/* One column no wider than the sheet: a long title, or a long calendar name in a menu, must not widen it,
	   or the sheet scrolls sideways on a narrow phone (and slides when a message is brought into view). */
	.sheet form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.7rem; }
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
		min-width: 0;
		max-width: 100%;
		text-overflow: ellipsis;
	}
	.row2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.6rem; }
	.seg { display: flex; gap: 0.4rem; }
	.seg label { display: flex; gap: 0.3rem; align-items: center; border: 2px solid var(--ink); border-radius: 6px; padding: 0 0.7rem; min-height: 44px; color: var(--ink); font-size: 1rem; font-weight: 400; }
	/* Save stays in reach on a phone while the rest of the sheet scrolls. */
	.actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; position: sticky; bottom: 0; background: var(--paper); padding-block: 0.6rem; border-top: 1px solid var(--rule); }
	.actions-left, .actions-right { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.btn.primary { background: var(--ink); color: var(--paper); }
	button.btn { cursor: pointer; }
	.notice { border: 2px solid var(--ink); border-radius: 6px; padding: 0.4rem 0.6rem; margin: 0.5rem var(--gutter-right) 0 var(--gutter-left); }
	.bar .notice { margin: 0; }
	.notice a { color: var(--ink); font-weight: 700; }
	.day-note { flex: 1 0 100%; order: 3; margin: 0; }
	.error { color: var(--ink); border: 2px solid var(--ink); border-radius: 6px; padding: 0.4rem 0.6rem; margin: 0; font-weight: 700; }
	/* A whole row of its own, under the header's buttons or above the sheet's. */
	.trouble { flex: 1 0 100%; order: 2; display: flex; gap: 0.5rem; align-items: center; }
	.actions .trouble { order: -1; }
	.trouble .error { flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.trouble .close { font-size: 1.4rem; line-height: 1; padding-inline: 0.7rem; }
	/* The buttons come first, for the phone layout below; beside the text they go after it. */
	.trouble-buttons { display: contents; }
	.trouble .error { order: -1; }
	.tag { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border: 1.5px solid var(--muted); color: var(--muted); border-radius: 3px; padding: 1px 6px; white-space: nowrap; }
	.carry { font-size: 0.8125rem; font-style: italic; color: var(--muted); white-space: nowrap; }
	.repeat { font-size: 1rem; line-height: 1; color: var(--muted); }
	/* Work meetings: light red shading, plus a word, since e-ink shows the shade only as grey. */
	li.work { background: var(--work); }
	/* The title and its calendar tag share the title's place. The title wants 6.5rem (about 100px); when the tag doesn't fit beside it,
	   the tag goes on the line below. A long tag (two calendars of the same name) wraps rather than widening the row. */
	.titled { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.1rem 0.45rem; }
	.titled .title { flex: 1 1 6.5rem; }
	/* The title's button reaches over its tag too, so a tap on the tag opens the details. */
	.titled { position: relative; }
	.titled .title::after { content: ''; position: absolute; inset: 0; }
	/* Ink, not grey, and a firmer line, so the tag reads on e-ink. A tap on it goes to the title under it. */
	.cal-tag { max-width: 100%; white-space: normal; overflow-wrap: anywhere; color: var(--ink); border: 1.5px solid var(--ink); pointer-events: none; }
	.cal-tag.work-tag { background: var(--ink); color: var(--paper); }
	/* Read out, not shown. */
	.unseen { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	.work-tag { border-color: var(--ink); color: var(--ink); }
	@media (max-width: 520px) {
		.wrap { font-size: 1.0625rem; }
		/* The date across the top of the day, then events, then tasks, each the screen's full width. */
		.day { grid-template-columns: minmax(0, 1fr); }
		.day-head { flex-direction: row; align-items: baseline; gap: 0.6rem; padding: 14px var(--gutter-right) 2px var(--gutter-left); }
		.dnum { font-size: 2.25rem; }
		.today-tag { margin-top: 0; align-self: center; }
		.col, .col + .col { padding: 8px var(--gutter-right) 12px var(--gutter-left); border-right: 0; }
		/* A narrow row gives its room to the title: closer spacing, slimmer buttons and tags. */
		.lines li { gap: 0.45rem; }
		.act { min-width: 40px; }
		.tag { letter-spacing: 0.03em; padding: 1px 4px; }
		.row2 { grid-template-columns: minmax(0, 1fr); }
		/* Month and the gear on one line, the four page controls on the next: no third row eating the page. */
		.bar { padding-top: 12px; padding-bottom: 10px; gap: 0.5rem; }
		h1 { font-size: 1.6rem; }
		.week { font-size: 0.75rem; }
		nav { gap: 0.5rem; }
		.bar .btn, .bar input[type='date'] { min-height: 44px; min-width: 44px; }
		nav .btn { padding: 0 0.9rem; }
		nav { flex-wrap: nowrap; width: 100%; order: 1; }
		input[type='date'] { flex: 1; min-width: 0; font-size: 0.95rem; }
		/* A message beside its buttons is squeezed into a narrow column many lines tall. Here Reload and × sit
		   together in the top corner, and the text wraps round them, then runs the box's full width. */
		.trouble { display: flow-root; border: 2px solid var(--ink); border-radius: 6px; padding: 0.15rem 0.15rem 0.15rem 0.5rem; }
		.trouble .error { display: inline; border: 0; padding: 0; font-size: 0.95rem; }
		.trouble-buttons { display: flex; gap: 0.3rem; float: right; margin-left: 0.3rem; }
	}
</style>
