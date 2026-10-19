// Moves unfinished tasks forward: nightly at 3 a.m. so phones see them on today,
// and on every page load as a safety net (the server was off, or a task was added to a past day).
import { toISODate } from '$lib/dates';
import { rolloverChanges } from '$lib/rollover';
import { getStore } from './store';

let queue: Promise<unknown> = Promise.resolve();

/** Carry unfinished tasks from earlier days onto today. Returns how many moved. */
export function rollover(today = toISODate(new Date())): Promise<number> {
	// One run at a time, so two page loads never move the same task twice; each run sees what came before it.
	const run = queue.then(async () => {
		const store = await getStore();
		const changes = rolloverChanges(await store.listItems(), today);
		for (const { item, changes: c } of changes) await store.update(item, c);
		return changes.length;
	});
	queue = run.catch(() => {});
	return run;
}

/** Milliseconds from `now` until the next 3 a.m. local time. */
export function untilThreeAm(now: Date): number {
	const next = new Date(now);
	next.setHours(3, 0, 0, 0);
	if (next <= now) next.setDate(next.getDate() + 1);
	return next.getTime() - now.getTime();
}

let timer: ReturnType<typeof setTimeout> | undefined;

export function scheduleNightlyRollover() {
	if (timer) return;
	const tick = () => {
		timer = setTimeout(async () => {
			try {
				const moved = await rollover();
				if (moved) console.log(`rollover: carried ${moved} unfinished task(s) to today`);
			} catch (e) {
				console.error('rollover failed; it will retry on the next page load', e);
			}
			tick();
		}, untilThreeAm(new Date()));
	};
	tick();
}
