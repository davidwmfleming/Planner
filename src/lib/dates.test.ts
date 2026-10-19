import { describe, expect, it } from 'vitest';
import { comingSaturday, flipPage, pageDays, pageStart } from './dates';

// 2026-10-19 is a Monday.
describe('weekly pages', () => {
	it('puts Monday to Wednesday on the first page', () => {
		expect(pageStart('2026-10-19')).toBe('2026-10-19');
		expect(pageStart('2026-10-21')).toBe('2026-10-19');
		expect(pageDays('2026-10-19')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
	});

	it('puts Thursday to Sunday on the second page', () => {
		expect(pageStart('2026-10-22')).toBe('2026-10-22');
		expect(pageStart('2026-10-25')).toBe('2026-10-22');
		expect(pageDays('2026-10-22')).toEqual(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
	});

	it('flips between pages in both directions, across months', () => {
		expect(flipPage('2026-10-19', 1)).toBe('2026-10-22');
		expect(flipPage('2026-10-22', 1)).toBe('2026-10-26');
		expect(flipPage('2026-10-26', -1)).toBe('2026-10-22');
		expect(flipPage('2026-10-22', -1)).toBe('2026-10-19');
		expect(flipPage('2026-10-29', 1)).toBe('2026-11-02');
	});
});

describe('comingSaturday', () => {
	it('finds the next Saturday, or today on a Saturday', () => {
		expect(comingSaturday('2026-10-19')).toBe('2026-10-24');
		expect(comingSaturday('2026-10-24')).toBe('2026-10-24');
		expect(comingSaturday('2026-10-25')).toBe('2026-10-31');
	});
});
