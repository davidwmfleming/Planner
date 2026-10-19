import { describe, expect, it } from 'vitest';
import { passesTestGate } from './test-gate';

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('passesTestGate', () => {
	it('lets in the right password with any user name', () => {
		expect(passesTestGate(basic('david', 'plum-river-42'), 'plum-river-42')).toBe(true);
		expect(passesTestGate(basic('', 'plum-river-42'), 'plum-river-42')).toBe(true);
	});

	it('keeps out a wrong, missing or malformed password', () => {
		expect(passesTestGate(basic('david', 'plum-river-4'), 'plum-river-42')).toBe(false);
		expect(passesTestGate(null, 'plum-river-42')).toBe(false);
		expect(passesTestGate('Bearer x', 'plum-river-42')).toBe(false);
	});
});
