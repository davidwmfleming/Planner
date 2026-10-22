import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

// The first connection fails (the server hung and timed out); the next one works.
let attempts = 0;
vi.mock('./calendar-store', () => ({
	CalendarStore: class {
		async connect() {
			attempts++;
			if (attempts === 1) throw new Error('The calendar server did not answer in time (signing in)');
		}
		addressFor = (name: string) => `http://127.0.0.1:5232/david/${name.toLowerCase()}/`;
		async logKey() {
			return 'ab'.repeat(32);
		}
	},
	useLogKey: () => {}
}));
vi.mock('./startup', () => ({ prepareStore: async () => {}, addDueDates: async () => 0, tasksCalendarUrl: () => undefined }));

const { getStore } = await import('./store');

describe('the shared connection', () => {
	it('tries again on the next request after the calendar server failed to answer', async () => {
		await expect(getStore()).rejects.toThrow(/did not answer/);
		await new Promise((r) => setTimeout(r));
		await expect(getStore()).resolves.toBeDefined();
		expect(attempts).toBe(2);
	});
});
