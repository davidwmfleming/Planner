import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedUser, forgetShareMachine, fromShareMachine } from './access';

const login = (value?: string) => new Headers(value ? { 'Tailscale-User-Login': value } : {});

describe('allowedUser', () => {
	it('lets everyone in while no list is set', () => {
		expect(allowedUser(login(), undefined)).toBe(true);
		expect(allowedUser(login(), ' , ')).toBe(true);
	});

	it('lets in only the listed logins, ignoring case and spaces', () => {
		const list = 'david@example.com, Partner@Example.com';
		expect(allowedUser(login('david@example.com'), list)).toBe(true);
		expect(allowedUser(login('partner@example.com'), list)).toBe(true);
		expect(allowedUser(login('friend@example.org'), list)).toBe(false);
		expect(allowedUser(login(), list)).toBe(false);
		expect(allowedUser(login('david@example.com.evil'), list)).toBe(false);
	});
});

describe('fromShareMachine', () => {
	beforeEach(() => forgetShareMachine());

	it('matches the share container by its address, written either way', async () => {
		const find = vi.fn(async () => [{ address: '172.18.0.9', family: 4 }]);
		expect(await fromShareMachine('172.18.0.9', find)).toBe(true);
		expect(await fromShareMachine('::ffff:172.18.0.9', find)).toBe(true);
		expect(await fromShareMachine('172.18.0.1', find)).toBe(false);
		expect(find).toHaveBeenCalledTimes(1);
	});

	it('matches nothing when the container is not running', async () => {
		const find = vi.fn(async () => {
			throw new Error('ENOTFOUND');
		});
		expect(await fromShareMachine('172.18.0.9', find)).toBe(false);
	});

	it('answers from the last lookup while a fresh one runs, one at a time', async () => {
		vi.useFakeTimers();
		try {
			let finish: (found: { address: string; family: number }[]) => void = () => {};
			const find = vi
				.fn()
				.mockResolvedValueOnce([{ address: '172.18.0.9', family: 4 }])
				.mockImplementation(() => new Promise((done) => (finish = done)));
			expect(await fromShareMachine('172.18.0.9', find)).toBe(true);
			vi.advanceTimersByTime(31_000);
			expect(await fromShareMachine('172.18.0.9', find)).toBe(true);
			expect(await fromShareMachine('172.18.0.9', find)).toBe(true);
			expect(find).toHaveBeenCalledTimes(2);
			finish([{ address: '172.18.0.7', family: 4 }]);
			await vi.waitFor(async () => expect(await fromShareMachine('172.18.0.7', find)).toBe(true));
		} finally {
			vi.useRealTimers();
		}
	});
});
