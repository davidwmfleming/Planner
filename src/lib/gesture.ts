// Reads a pen or finger stroke as one of the planner's gestures, the way you'd mark a paper page.

export type Point = { x: number; y: number };
export type Stroke = 'next' | 'previous' | 'scratch' | 'tick' | 'none';

/** Ignore wobble smaller than this when counting changes of direction (CSS pixels). */
const JITTER = 10;

/** How many times the stroke turns back on itself along one axis (sideways by default). */
export function reversals(points: Point[], axis: 'x' | 'y' = 'x'): number {
	let turns = 0;
	let direction = 0;
	let anchor = points[0]?.[axis] ?? 0;
	for (const p of points) {
		const moved = p[axis] - anchor;
		if (Math.abs(moved) < JITTER) continue;
		const now = Math.sign(moved);
		if (direction && now !== direction) turns++;
		direction = now;
		anchor = p[axis];
	}
	return turns;
}

/** A check mark: a short stroke down, then a longer one up, moving rightward (✓). */
function isTick(points: Point[], width: number, height: number): boolean {
	if (width < 15 || width > 200 || height < 15 || height > 200) return false;
	if (reversals(points, 'y') !== 1 || reversals(points) > 0) return false;
	const lowest = points.reduce((low, p) => (p.y > low.y ? p : low));
	const first = points[0];
	const last = points[points.length - 1];
	const down = lowest.y - first.y;
	const up = lowest.y - last.y;
	return last.x > first.x && down > 0 && up >= down * 0.8;
}

/**
 * A quick sideways stroke flips the page (leftward to the next page, like turning paper).
 * A scribble on about one line is a scratch-out, whether it goes back and forth or zig-zags up and down along the line.
 * ✓ is a tick.
 */
export function readStroke(points: Point[]): Stroke {
	if (points.length < 2) return 'none';
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const width = Math.max(...xs) - Math.min(...xs);
	const height = Math.max(...ys) - Math.min(...ys);
	const turns = reversals(points);
	if (turns >= 3 && width >= 30 && height <= Math.max(60, width * 0.6)) return 'scratch';
	// The simplest cross-out: across the item and most of the way back again, staying flat on the line.
	// (A page sweep that hooks back a little at the end, or a circle round an item, is not one.)
	const back = Math.abs(points[points.length - 1].x - points[0].x);
	if (turns >= 1 && width >= 80 && back <= width * 0.4 && height <= Math.max(24, width * 0.2)) return 'scratch';
	// The other way to scratch out: a zig-zag up and down, moving along the line.
	if (reversals(points, 'y') >= 4 && width >= 40 && height <= 80) return 'scratch';
	if (isTick(points, width, height)) return 'tick';
	const dx = points[points.length - 1].x - points[0].x;
	const dy = points[points.length - 1].y - points[0].y;
	if (turns <= 1 && Math.abs(dx) > 80 && Math.abs(dy) < Math.abs(dx) * 0.6) return dx < 0 ? 'next' : 'previous';
	return 'none';
}

/** Far enough from where it started to be a stroke rather than a tap. */
export const movedFar = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) > 12;
