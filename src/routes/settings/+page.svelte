<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { fetchExport } from '$lib/export-download';
	import { saysReload } from '$lib/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// What went wrong with the last add or rename, shown next to it. Cleared when David starts again.
	let addError = $derived(form?.action === 'add' ? form.message : undefined);
	let renameError = $derived(form?.action === 'rename' ? form.message : undefined);

	/** The calendar whose name is being changed (by path, which a rename doesn't change). */
	let renaming = $state<string | undefined>();

	async function startRename(path: string) {
		if (busyPath) return; // a delete is under way; it redraws the list when done
		closeDelete();
		renaming = path;
		renameError = undefined;
		await tick();
		document.querySelector<HTMLInputElement>('#rename-field')?.select();
	}

	/** Closes the name field and puts the keyboard back on that calendar's Rename button. */
	async function stopRename() {
		const path = renaming;
		renaming = undefined;
		await tick();
		document.querySelector<HTMLButtonElement>(`button[data-rename="${CSS.escape(path ?? '')}"]`)?.focus();
	}

	// Added and renamed calendars are read out by screen readers; the page itself shows the change in the list.
	let announcement = $state('');

	// "Saved" shows after the choices are stored, until one is changed again.
	let saved = $state(false);
	const chose: SubmitFunction = ({ submitter }) => async ({ result, update }) => {
		await update({ reset: false });
		saved = result.type === 'success';
		if (submitter instanceof HTMLElement && submitter.isConnected) submitter.focus();
	};

	/** After adding, the field is ready for another name (or to fix the one refused). */
	const added: SubmitFunction = () => async ({ result, update }) => {
		await update();
		if (result.type === 'success') announcement = `Added ${result.data?.added}`;
		document.querySelector<HTMLInputElement>('#new-calendar')?.focus();
	};

	/** A rename that worked closes its field; one that didn't keeps it open with the reason. */
	const renamed: SubmitFunction = ({ formData }) => {
		const from = data.eventCalendars.find((c) => c.path === formData.get('path'))?.name;
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') return;
			announcement = `Renamed ${from} to ${result.data?.renamed}`;
			await stopRename();
		};
	};

	/** The calendar being deleted (by path), how many items it held when counted, and the version counted:
	 * "Delete them too" deletes only that version, so nothing added on a phone since is deleted unseen. */
	let deleting = $state<{ path: string; count: number; version: string } | undefined>();
	/** The calendar whose Delete was last tapped. */
	let deletePath = $state<string | undefined>();
	/** Why a calendar can't be deleted (or not yet), shown only next to the calendar it is about. */
	let deleteError = $state<{ path: string; message: string } | undefined>();
	/** The calendar whose delete is under way. It can't be stopped once sent, so until it is done there is no Cancel,
	 * and Delete and Rename on the other calendars do nothing. */
	let busyPath = $state<string | undefined>();
	/** What happens to its items: nothing is chosen at first, so a hasty tap can't delete them. */
	let mode = $state<'move' | 'delete' | undefined>();
	let moveTo = $state('');
	/** What the last delete did, shown on the page until something else is done. */
	let deletedMessage = $state('');

	const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;
	const SOMETHING_WRONG = 'Something went wrong; reload the page and try again.';

	function closeDelete() {
		deleting = deletePath = deleteError = mode = undefined;
	}

	/** A new choice of where the items go: the reason the last one was refused no longer applies. */
	function choiceChanged() {
		if (deleteError?.path === deletePath) deleteError = undefined;
	}

	function confirmKeys(e: KeyboardEvent) {
		if (e.key === 'Escape' && deletingCategory && !categoryBusy) {
			e.preventDefault();
			cancelCategoryDelete();
			return;
		}
		if (e.key !== 'Escape' || !deleting || busyPath) return;
		e.preventDefault();
		cancelDelete();
	}

	/** Closes the confirm and puts the keyboard back on that calendar's Delete button. */
	async function cancelDelete() {
		if (busyPath) return; // it can't be stopped once sent
		const path = deletePath;
		closeDelete();
		await tick();
		document.querySelector<HTMLButtonElement>(`button[data-delete="${CSS.escape(path ?? '')}"]`)?.focus();
	}

	/** Delete asks the server how many items the calendar holds; the confirm then shows on the page. */
	const counted: SubmitFunction = ({ formData, cancel }) => {
		const path = String(formData.get('path'));
		if (busyPath) return cancel();
		renaming = undefined;
		closeDelete();
		deletedMessage = '';
		deletePath = path;
		return async ({ result }) => {
			// Another calendar's Delete was tapped since: this answer is no longer wanted.
			if (deletePath !== path) return;
			if (result.type === 'success') {
				const { count, version } = result.data as { count: number; version: string };
				deleting = { path, count, version };
				// The calendar new events go in is the likeliest home for the items; otherwise the first one left.
				const others = data.eventCalendars.filter((c) => c.path !== path);
				moveTo = (others.find((c) => c.path === data.defaultEventPath) ?? others[0])?.path ?? '';
				await tick();
				document.querySelector<HTMLElement>('#delete-count')?.focus();
			} else deleteError = { path, message: messageOf(result) };
		};
	};

	const messageOf = (result: ActionResult) => (result.type === 'failure' ? String(result.data?.message) : SOMETHING_WRONG);

	/** A delete that worked says what it did and redraws the list; one that didn't keeps the confirm open with the reason. */
	const deletedCalendar: SubmitFunction = ({ formData, cancel }) => {
		// A second tap while the first is working would only repeat it.
		if (busyPath) return cancel();
		const path = String(formData.get('path'));
		busyPath = path;
		deleteError = undefined;
		return async ({ result, update }) => {
			busyPath = undefined;
			await afterDelete(path, result, update);
		};
	};

	/** Every answer is about the calendar it was sent for, whatever is open now. */
	async function afterDelete(path: string, result: ActionResult, update: () => Promise<void>) {
		if (result.type === 'success') {
			const { deleted, count, movedTo } = result.data as unknown as { deleted: string; count: number; movedTo?: string };
			closeDelete();
			await update();
			deletedMessage = movedTo
				? `Deleted ${deleted}. Its ${items(count)} ${count === 1 ? 'is' : 'are'} now in ${movedTo}.`
				: count ? `Deleted ${deleted} and its ${items(count)}.` : `Deleted ${deleted}.`;
			await tick();
			document.querySelector<HTMLElement>('#deleted-message')?.focus();
			return;
		}
		deleteError = { path, message: messageOf(result) };
		// The calendar changed since it was counted: show the new count, which a second tap then deletes.
		const fresh = result.type === 'failure' ? (result.data as { count?: number; version?: string }) : {};
		if (deleting?.path === path && fresh.count !== undefined && fresh.version) deleting = { ...deleting, count: fresh.count, version: fresh.version };
		// The button that was tapped has given way to "Deleting…" and back; keep the keyboard in the confirm, on the count.
		await tick();
		if (deleting?.path === path) document.querySelector<HTMLElement>('#delete-count')?.focus();
	}

	// Task categories: add and rename work like the calendars', on the page itself.
	let addCategoryError = $derived(form?.action === 'addCategory' ? form.message : undefined);
	/** The category whose name is being changed, and why the last rename of it was refused. */
	let renamingCategory = $state<string | undefined>();
	let categoryError = $derived(
		form?.action === 'renameCategory' || form?.action === 'checkCategory' || form?.action === 'deleteCategory' ? { category: form.category, message: form.message } : undefined
	);
	/** A rename under way changes every task with that name; meanwhile the other category buttons do nothing. */
	let categoryBusy = $state(false);

	async function startCategoryRename(category: string) {
		if (categoryBusy) return;
		deletingCategory = undefined;
		renamingCategory = category;
		categoryError = undefined;
		await tick();
		document.querySelector<HTMLInputElement>('#category-rename-field')?.select();
	}

	/** Closes the name field and puts the keyboard back on that category's Rename button. */
	async function stopCategoryRename(category = renamingCategory) {
		renamingCategory = undefined;
		await tick();
		document.querySelector<HTMLButtonElement>(`button[data-rename-category="${CSS.escape(category ?? '')}"]`)?.focus();
	}

	function categoryRenameKeys(e: KeyboardEvent) {
		if (e.key === 'Escape' && !categoryBusy) {
			e.preventDefault();
			stopCategoryRename();
		}
	}

	const addedCategory: SubmitFunction = () => async ({ result, update }) => {
		await update();
		if (result.type === 'success') announcement = `Added ${result.data?.added}`;
		document.querySelector<HTMLInputElement>('#new-category')?.focus();
	};

	/** A rename that worked closes its field and says how many tasks changed; one that didn't keeps the reason next to it. */
	const renamedCategory: SubmitFunction = ({ cancel }) => {
		if (categoryBusy) return cancel();
		categoryBusy = true;
		return async ({ result, update }) => {
			categoryBusy = false;
			await update({ reset: false });
			if (result.type !== 'success') {
				// A refusal doesn't read the page again, but a rename that stopped halfway has changed the list:
				// read it, so the new name shows and the field gives way to "Finish renaming", with the reason next to it.
				const category = renamingCategory;
				await invalidateAll();
				if (data.renaming && data.renaming.from === category) {
					renamingCategory = undefined;
					await tick();
					document.querySelector<HTMLButtonElement>(`button[data-finish-category="${CSS.escape(category)}"]`)?.focus();
				}
				return;
			}
			const { from, renamed, count } = result.data as { from: string; renamed: string; count: number };
			categoryMessage = `Renamed ${from} to ${renamed}${count ? `, on ${count} ${count === 1 ? 'task' : 'tasks'}` : ''}.`;
			announcement = categoryMessage;
			await stopCategoryRename(renamed);
		};
	};
	/** What the last category change did, shown under the list until something else is done. */
	let categoryMessage = $state('');

	/** The category being deleted and how many tasks it held when counted; and where they go ('' for no list). */
	let deletingCategory = $state<{ category: string; count: number } | undefined>();
	let categoryMoveTo = $state('');
	const tasksCount = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;
	/** Where a deleted category's tasks can go: another category, but not one in a rename under way. */
	const movesFor = (category: string) => data.categories.filter((c) => c !== category && c !== data.renaming?.from && c !== data.renaming?.to);

	/** Delete asks the server how many tasks have the category; the confirm then shows on the page. */
	const countedCategory: SubmitFunction = ({ formData, cancel }) => {
		if (categoryBusy) return cancel();
		const category = String(formData.get('category'));
		renamingCategory = undefined;
		deletingCategory = undefined;
		categoryMessage = '';
		return async ({ result, update }) => {
			if (result.type !== 'success') return update();
			deletingCategory = { category, count: Number(result.data?.count ?? 0) };
			categoryMoveTo = movesFor(category)[0] ?? '';
			categoryError = undefined;
			await tick();
			document.querySelector<HTMLElement>('#category-delete-count')?.focus();
		};
	};

	/** Closes the confirm and puts the keyboard back on that category's Delete button. */
	async function cancelCategoryDelete() {
		if (categoryBusy) return; // it can't be stopped once sent
		const category = deletingCategory?.category;
		deletingCategory = undefined;
		await tick();
		document.querySelector<HTMLButtonElement>(`button[data-delete-category="${CSS.escape(category ?? '')}"]`)?.focus();
	}


	/** A delete that worked says where the tasks went; one that stopped keeps the confirm open with the reason. */
	const deletedCategory: SubmitFunction = ({ cancel }) => {
		if (categoryBusy) return cancel();
		categoryBusy = true;
		return async ({ result, update }) => {
			categoryBusy = false;
			await update({ reset: false });
			if (result.type !== 'success') {
				// Read the page again: a delete that stopped partway has moved some tasks, so the count shown is old.
				await invalidateAll();
				if (result.type === 'failure' && result.status === 502 && deletingCategory) {
					// Closed, with the reason next to the category; Delete counts again before it finishes the job.
					const { category } = deletingCategory;
					deletingCategory = undefined;
					await tick();
					document.querySelector<HTMLButtonElement>(`button[data-delete-category="${CSS.escape(category)}"]`)?.focus();
					return;
				}
				await tick();
				document.querySelector<HTMLElement>('#category-delete-count')?.focus();
				return;
			}
			const { deleted, count, movedTo } = result.data as { deleted: string; count: number; movedTo?: string };
			deletingCategory = undefined;
			const are = count === 1 ? 'is' : 'are';
			categoryMessage = !count ? `Deleted ${deleted}.` : movedTo ? `Deleted ${deleted}. Its ${tasksCount(count)} ${are} now in ${movedTo}.` : `Deleted ${deleted}. Its ${tasksCount(count)} ${are} now without a list.`;
			announcement = categoryMessage;
			await tick();
			document.querySelector<HTMLElement>('#category-message')?.focus();
		};
	};

	// "Download everything": one export at a time; a failure is said here, on the page.
	let exporting = $state(false);
	let exportError = $state<string | undefined>();
	/** A zip the phone wouldn't open the share sheet for (too long after the tap); one more tap shares it. */
	let unshared = $state<File | undefined>();

	async function downloadEverything() {
		if (exporting) return;
		exporting = true;
		exportError = undefined;
		unshared = undefined;
		try {
			const result = await fetchExport();
			if ('error' in result) exportError = result.error;
			else await save(result.file);
		} finally {
			exporting = false;
		}
	}

	/** The installed app (home screen) has no downloads bar, so there the zip goes to the share sheet when the phone allows it. */
	const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

	async function save(file: File) {
		unshared = undefined;
		if (installed() && navigator.canShare?.({ files: [file] })) {
			try {
				await navigator.share({ files: [file] });
				return;
			} catch (e) {
				const name = e instanceof DOMException ? e.name : '';
				if (name === 'AbortError') return; // the share sheet was closed
				if (name === 'NotAllowedError') {
					unshared = file;
					return;
				}
				// Any other refusal: save it as an ordinary download instead.
			}
		}
		const url = URL.createObjectURL(file);
		const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}

	function renameKeys(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			stopRename();
		}
	}
</script>

<!-- Messages that ask for a reload get a Reload button: the installed app has no browser controls. -->
{#snippet problem(message: string)}
	<p class="error" role="alert">{message}{#if saysReload(message)} <button type="button" class="btn small" onclick={() => location.reload()}>Reload</button>{/if}</p>
{/snippet}

<!-- Deleting a calendar: how many items it holds, where they go, and a confirm on the page itself
     (the installed app and the e-ink viewer can't show the browser's confirm box). -->
{#snippet confirmDelete(calendar: (typeof data.eventCalendars)[number], counted: { count: number; version: string })}
	{@const others = data.eventCalendars.filter((c) => c.path !== calendar.path)}
	{@const toLabel = others.find((c) => c.path === moveTo)?.label}
	<form method="POST" action="?/delete" use:enhance={deletedCalendar} class="confirm">
		<div role="group" aria-label="Delete {calendar.label}">
			<input type="hidden" name="path" value={calendar.path} />
			<input type="hidden" name="version" value={counted.version} />
			<p id="delete-count" tabindex="-1"><strong>{calendar.label} {counted.count ? `holds ${items(counted.count)}.` : 'is empty.'}</strong></p>
			{#if counted.count}
				<fieldset>
					<legend>What happens to {counted.count === 1 ? 'it' : 'them'}</legend>
					<div class="move">
						<label class="choice"><input type="radio" name="mode" value="move" bind:group={mode} onchange={choiceChanged} /> Move them to</label>
						<select name="to" aria-label="Calendar to move them to" bind:value={moveTo} onchange={() => ((mode = 'move'), choiceChanged())}>
							{#each others as other (other.path)}<option value={other.path}>{other.label}</option>{/each}
						</select>
					</div>
					<label class="choice"><input type="radio" name="mode" value="delete" bind:group={mode} onchange={choiceChanged} /> Delete them too</label>
				</fieldset>
			{:else}
				<input type="hidden" name="mode" value="delete" />
			{/if}
			<p class="hint">{calendar.label} also disappears from every phone and computer that syncs it, including anyone it is shared with.</p>
			{#if calendar.work}<p class="hint">The Work shading goes to None.</p>{/if}
			{#if calendar.newEvents}<p class="hint">New events will go in {others[0]?.label}.</p>{/if}
			<!-- aria-disabled, not disabled: a disabled button drops keyboard and screen-reader focus to the page. -->
			<div class="edit" aria-busy={busyPath === calendar.path}>
				{#if busyPath === calendar.path}
					<button type="button" class="btn primary" aria-disabled="true">{mode === 'move' ? 'Moving and deleting…' : 'Deleting…'}</button>
				{:else if !counted.count}
					<button class="btn primary">Delete {calendar.label}</button>
				{:else if mode === 'move' && toLabel}
					<button class="btn primary">Move {items(counted.count)} to {toLabel} and delete {calendar.label}</button>
				{:else if mode === 'delete'}
					<button class="btn primary">Delete {calendar.label} and its {items(counted.count)}</button>
				{/if}
				{#if busyPath !== calendar.path}<button type="button" class="btn" onclick={cancelDelete}>Cancel</button>{/if}
			</div>
			{#if deleteError?.path === calendar.path}{@render problem(deleteError.message)}{/if}
		</div>
	</form>
{/snippet}

<!-- Deleting a task category: how many tasks have it and where they go. A category is only a label, so no task is deleted. -->
{#snippet confirmCategoryDelete(category: string, count: number)}
	{@const others = movesFor(category)}
	<form method="POST" action="?/deleteCategory" use:enhance={deletedCategory} class="confirm">
		<div role="group" aria-label="Delete {category}">
			<input type="hidden" name="category" value={category} />
			<p id="category-delete-count" tabindex="-1"><strong>{category} {count ? `holds ${tasksCount(count)}.` : 'holds no tasks.'}</strong></p>
			{#if count}
				<div class="move">
					<label for="category-move-to" class="choice">Move them to</label>
					<select id="category-move-to" name="to" bind:value={categoryMoveTo}>
						{#each others as other (other)}<option value={other}>{other}</option>{/each}
						<option value="">No list</option>
					</select>
				</div>
				<p class="hint">No task is deleted{categoryMoveTo ? '' : ': with No list they stay on Future tasks, or on their day, without a category'}.</p>
			{:else}
				<input type="hidden" name="to" value="" />
			{/if}
			<div class="edit" aria-busy={categoryBusy}>
				{#if categoryBusy}
					<button type="button" class="btn primary" aria-disabled="true">Deleting…</button>
				{:else}
					<button class="btn primary">{!count ? `Delete ${category}` : categoryMoveTo ? `Move ${tasksCount(count)} to ${categoryMoveTo} and delete ${category}` : `Delete ${category}, keeping its ${tasksCount(count)}`}</button>
					<button type="button" class="btn" onclick={cancelCategoryDelete}>Cancel</button>
				{/if}
			</div>
		</div>
	</form>
{/snippet}

<!-- Escape closes the delete confirm, as Cancel does (not while the delete is under way). -->
<svelte:window onkeydown={confirmKeys} />

<svelte:head>
	<title>Planner · Settings</title>
</svelte:head>

<div class="wrap">
	<!-- The installed app has no browser back button, so the way back is always at the top. -->
	<header class="bar">
		<a class="btn" href="/" aria-label="Back to the planner">‹ Planner</a>
		<h1>Settings</h1>
	</header>
	<p class="announce" role="status">{announcement}</p>

	<main>
		<section aria-labelledby="h-calendars">
			<h2 id="h-calendars">Event calendars</h2>
			<ul class="lines">
				{#each data.eventCalendars as calendar (calendar.path)}
					<li class:work={calendar.work}>
						{#if renaming === calendar.path}
							<form method="POST" action="?/rename" use:enhance={renamed} class="edit">
								<input type="hidden" name="path" value={calendar.path} />
								<input id="rename-field" class="text" name="name" value={calendar.name} aria-label="New name for {calendar.label}" autocomplete="off" onkeydown={renameKeys} />
								<button class="btn primary">Save name</button>
								<button type="button" class="btn" onclick={stopRename}>Cancel</button>
								{#if renameError}{@render problem(renameError)}{/if}
							</form>
						{:else}
							<!-- Two calendars can share a name (one made on a phone, say); the label adds the end of the address. -->
							<span class="name">{calendar.label}</span>
							{#if calendar.work}<span class="tag work-tag">Work</span>{/if}
							{#if calendar.newEvents}<span class="tag">New events</span>{/if}
							<button type="button" class="btn small" aria-label="Rename {calendar.label}" class:waiting={!!busyPath} data-rename={calendar.path} onclick={() => startRename(calendar.path)}>Rename</button>
							<form method="POST" action="?/check" use:enhance={counted} class="inline">
								<input type="hidden" name="path" value={calendar.path} />
								<button class="btn small" aria-label="Delete {calendar.label}" class:waiting={!!busyPath} data-delete={calendar.path}>Delete</button>
							</form>
							{#if deleting?.path === calendar.path}
								{@render confirmDelete(calendar, deleting)}
							{:else if deleteError?.path === calendar.path}
								{@render problem(deleteError.message)}
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			<form method="POST" action="?/add" use:enhance={added} class="add">
				<label for="new-calendar">New calendar</label>
				<div class="edit">
					<input id="new-calendar" class="text" name="name" value={form?.action === 'add' ? form.name : ''} placeholder="Name, up to 40 letters" autocomplete="off" />
					<button class="btn" aria-label="Add calendar">Add</button>
				</div>
				{#if addError}{@render problem(addError)}{/if}
			</form>
			{#if data.eventCalendars.length}
				<form method="POST" action="?/choose" use:enhance={chose} class="choices">
					<div class="field">
						<label for="work-calendar">Show as work (light red)</label>
						<select id="work-calendar" name="work" value={data.workPath ?? ''} onchange={() => (saved = false)}>
							<option value="">None</option>
							{#each data.eventCalendars as calendar (calendar.path)}<option value={calendar.path}>{calendar.label}</option>{/each}
						</select>
					</div>
					<div class="field">
						<label for="new-events-calendar">New events go in</label>
						<select id="new-events-calendar" name="newEvents" value={data.defaultEventPath} onchange={() => (saved = false)}>
							{#each data.eventCalendars as calendar (calendar.path)}<option value={calendar.path}>{calendar.label}</option>{/each}
						</select>
					</div>
					<div class="edit">
						<button class="btn primary">Save choices</button>
						<span role="status">{saved ? 'Saved' : ''}</span>
					</div>
					{#if form?.action === 'choose' && form.message}{@render problem(form.message)}{/if}
				</form>
			{:else}
				<p class="hint">Add a calendar first; new events need somewhere to go.</p>
			{/if}
			{#if deletedMessage}<p id="deleted-message" class="done" role="status" tabindex="-1">{deletedMessage}</p>{/if}
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
					<li>
						{#if renamingCategory === category}
							<form method="POST" action="?/renameCategory" use:enhance={renamedCategory} class="edit">
								<input type="hidden" name="category" value={category} />
								<input id="category-rename-field" class="text" name="name" value={category} aria-label="New name for {category}" autocomplete="off" onkeydown={categoryRenameKeys} />
								{#if categoryBusy}
									<button type="button" class="btn primary" aria-disabled="true">Renaming…</button>
								{:else}
									<button class="btn primary">Save name</button>
									<button type="button" class="btn" onclick={() => stopCategoryRename()}>Cancel</button>
								{/if}
							</form>
						{:else}
							<span class="name">{category}</span>
							{#if data.renaming?.from === category}
								<!-- A rename that stopped halfway: both names stay on the list until every task has the new one. -->
								<form method="POST" action="?/renameCategory" use:enhance={renamedCategory} class="inline">
									<input type="hidden" name="category" value={category} />
									<input type="hidden" name="name" value={data.renaming.to} />
									<button class="btn small primary" class:waiting={categoryBusy} aria-label="Finish renaming {category} to {data.renaming.to}" data-finish-category={category}>{categoryBusy ? 'Renaming…' : 'Finish renaming'}</button>
								</form>
							{:else}
								<button type="button" class="btn small" aria-label="Rename {category}" class:waiting={categoryBusy} data-rename-category={category} onclick={() => startCategoryRename(category)}>Rename</button>
								<form method="POST" action="?/checkCategory" use:enhance={countedCategory} class="inline">
									<input type="hidden" name="category" value={category} />
									<button class="btn small" aria-label="Delete {category}" class:waiting={categoryBusy} data-delete-category={category}>Delete</button>
								</form>
							{/if}
						{/if}
						{#if deletingCategory?.category === category}{@render confirmCategoryDelete(category, deletingCategory.count)}{/if}
						{#if data.renaming?.from === category}<p class="hint row-hint">Being renamed to {data.renaming.to}; some tasks still say {category}.</p>{/if}
						{#if categoryError?.category === category && categoryError.message}{@render problem(categoryError.message)}{/if}
					</li>
				{/each}
			</ul>
			<form method="POST" action="?/addCategory" use:enhance={addedCategory} class="add">
				<label for="new-category">New category</label>
				<div class="edit">
					<input id="new-category" class="text" name="name" value={form?.action === 'addCategory' ? form.name : ''} placeholder="Name, up to 40 letters" autocomplete="off" />
					<button class="btn" aria-label="Add category">Add</button>
				</div>
				{#if addCategoryError}{@render problem(addCategoryError)}{/if}
			</form>
			<p class="hint">In this order on the Future tasks list and in the List menu. A new name is given to every task in that category, on every phone too.</p>
			{#if categoryMessage}<p id="category-message" class="done" role="status" tabindex="-1">{categoryMessage}</p>{/if}
		</section>

		<section aria-labelledby="h-export">
			<h2 id="h-export">Export</h2>
			<div class="edit">
				<!-- aria-disabled, not disabled: a disabled button drops keyboard and screen-reader focus to the page. -->
				<button type="button" class="btn" aria-disabled={exporting} aria-busy={exporting} onclick={downloadEverything}>{exporting ? 'Making the export…' : 'Download everything (.ics)'}</button>
				{#if unshared}<button type="button" class="btn primary" onclick={() => unshared && save(unshared)}>Save or share the zip</button>{/if}
			</div>
			{#if exportError}<p class="error" role="alert">{exportError}</p>{/if}
			<p class="hint">A zip with one .ics file per calendar, to keep or to move elsewhere. Import each file on its own, into the calendar it should go in. Apple Calendar and Google Calendar skip the tasks in Tasks.ics; task apps such as Thunderbird read them.</p>
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
	.lines li { min-height: var(--line); border-bottom: 1px solid var(--rule); display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; }
	/* A name never shrinks below its longest word: if that word and the tags and buttons don't fit on one line,
	   they wrap below it, rather than the name breaking mid-word. Only a word wider than the whole row is broken. */
	.name { flex: 1 1 0%; max-width: 100%; overflow-wrap: break-word; color: var(--pen); }
	.tag { font-size: 0.72rem; border: 1px solid var(--muted); color: var(--muted); border-radius: 99px; padding: 0 0.4rem; white-space: nowrap; }
	/* Work: light red shading, plus a word, since e-ink shows the shade only as grey. */
	li.work { background: var(--work); }
	.work-tag { border-color: var(--ink); color: var(--ink); }
	/* A long calendar name must not widen the choices past a narrow phone screen. */
	.choices { margin: 1rem 0 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.6rem; }
	.field { min-width: 0; display: grid; gap: 0.25rem; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); }
	.field select {
		font: inherit;
		font-size: 1rem;
		font-weight: 400;
		letter-spacing: 0;
		color: var(--ink);
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 6px;
		min-height: 44px;
		width: 100%;
		min-width: 0;
		padding: 0.2rem 0.5rem;
	}
	[role='status'] { font-weight: 700; }
	/* Read out, not shown: the list already shows what changed. */
	.announce { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; margin: 0; }
	.hint { color: var(--muted); font-size: 0.9rem; margin: 0.5rem 0 0; }
	button.btn { cursor: pointer; }
	button.btn:disabled,
	button.btn[aria-disabled='true'] { color: var(--muted); border-color: var(--muted); cursor: progress; }
	/* While a delete is under way, the other calendars' buttons look asleep, and a tap on them does nothing. */
	button.btn.waiting { color: var(--muted); border-color: var(--muted); cursor: progress; }
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
	/* The Delete button's form sits in the row like a plain button. */
	.inline { display: contents; }
	/* The delete confirm takes the whole width under its calendar's row. */
	.confirm { flex-basis: 100%; min-width: 0; padding-block: 0.3rem 0.6rem; }
	.confirm p { margin: 0.3rem 0; overflow-wrap: anywhere; }
	.confirm fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
	.confirm legend { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); padding: 0; }
	.move { display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.4rem; }
	.choice { min-height: 44px; display: flex; align-items: center; gap: 0.5rem; cursor: pointer; }
	.choice input { width: 22px; height: 22px; margin: 0; accent-color: var(--ink); }
	.move label.choice { font-size: 0.9rem; }
	.move select {
		flex: 1 1 10rem;
		min-width: 0;
		max-width: 100%;
		font: inherit;
		color: var(--ink);
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 6px;
		min-height: 44px;
		padding: 0.2rem 0.5rem;
	}
	/* A long confirm ("Move 42 items to … and delete …") wraps rather than widening the page. */
	.confirm .btn { max-width: 100%; overflow-wrap: anywhere; text-align: center; padding-block: 0.3rem; }
	.confirm #delete-count:focus, .confirm #category-delete-count:focus, .done:focus { outline: none; }
	.done { margin: 0.7rem 0 0; }
	.row-hint { flex-basis: 100%; margin: 0 0 0.3rem; }
	.error { flex-basis: 100%; color: var(--ink); border: 2px solid var(--ink); border-radius: 6px; padding: 0.4rem 0.6rem; margin: 0; font-weight: 700; }
</style>
