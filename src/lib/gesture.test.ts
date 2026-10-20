import { describe, expect, it } from 'vitest';
import { readStroke, reversals, type Point } from './gesture';

const line = (from: Point, to: Point, steps = 10): Point[] =>
	Array.from({ length: steps + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }));

/** A zig-zag across a line of text: right, left, right, left… */
const scribble = (passes: number, width = 120, y = 300, drift = 4): Point[] =>
	Array.from({ length: passes }, (_, i) => line({ x: i % 2 ? 100 + width : 100, y: y + i * drift }, { x: i % 2 ? 100 : 100 + width, y: y + (i + 1) * drift })).flat();

describe('readStroke', () => {
	it('a leftward sweep turns to the next page, a rightward one back', () => {
		expect(readStroke(line({ x: 600, y: 400 }, { x: 300, y: 430 }))).toBe('next');
		expect(readStroke(line({ x: 300, y: 400 }, { x: 600, y: 380 }))).toBe('previous');
	});

	it('a short or mostly vertical stroke is nothing', () => {
		expect(readStroke(line({ x: 300, y: 400 }, { x: 350, y: 400 }))).toBe('none');
		expect(readStroke(line({ x: 300, y: 100 }, { x: 400, y: 600 }))).toBe('none');
		expect(readStroke([{ x: 1, y: 1 }])).toBe('none');
	});

	it('a back-and-forth scribble on one line is a scratch-out', () => {
		expect(readStroke(scribble(4))).toBe('scratch');
		expect(readStroke(scribble(6, 60))).toBe('scratch');
	});

	it('a zig-zag up and down, moving along the line, is a scratch-out', () => {
		const zigzag = Array.from({ length: 8 }, (_, i) => line({ x: 100 + i * 20, y: i % 2 ? 330 : 300 }, { x: 120 + i * 20, y: i % 2 ? 300 : 330 })).flat();
		expect(readStroke(zigzag)).toBe('scratch');
	});

	it('a loopy squiggle along the line is a scratch-out', () => {
		const loops = Array.from({ length: 80 }, (_, i) => {
			const t = (i / 80) * Math.PI * 2 * 5;
			return { x: 100 + i * 2 + 18 * Math.cos(t), y: 300 + 18 * Math.sin(t) };
		});
		expect(readStroke(loops)).toBe('scratch');
	});

	it('across and back again is a scratch-out', () => {
		expect(readStroke(scribble(2))).toBe('scratch');
	});

	it('a single pass is not a scratch-out', () => {
		expect(readStroke(scribble(1))).not.toBe('scratch');
	});

	it('a zig-zag down the page is not a scratch-out', () => {
		expect(readStroke(scribble(4, 60, 100, 80))).toBe('none');
	});

	it('a check mark is a tick, whatever its size', () => {
		expect(readStroke([...line({ x: 100, y: 300 }, { x: 115, y: 318 }), ...line({ x: 115, y: 318 }, { x: 150, y: 270 })])).toBe('tick');
		expect(readStroke([...line({ x: 100, y: 300 }, { x: 130, y: 340 }), ...line({ x: 130, y: 340 }, { x: 200, y: 250 })])).toBe('tick');
	});

	it('a V, an upside-down check or a long sweep is not a tick', () => {
		expect(readStroke([...line({ x: 100, y: 300 }, { x: 140, y: 360 }), ...line({ x: 140, y: 360 }, { x: 160, y: 330 })])).not.toBe('tick');
		expect(readStroke([...line({ x: 100, y: 300 }, { x: 120, y: 270 }), ...line({ x: 120, y: 270 }, { x: 160, y: 320 })])).not.toBe('tick');
		expect(readStroke([...line({ x: 100, y: 300 }, { x: 200, y: 330 }), ...line({ x: 200, y: 330 }, { x: 500, y: 300 })])).not.toBe('tick');
	});

	it('hand wobble does not count as turning back', () => {
		const shaky = line({ x: 100, y: 0 }, { x: 400, y: 0 }, 60).map((p, i) => ({ ...p, x: p.x + (i % 2 ? 4 : -4) }));
		expect(reversals(shaky)).toBe(0);
		expect(readStroke(shaky)).toBe('previous');
	});
});
