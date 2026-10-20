// Docker stops the planner with SIGTERM and kills it 10 seconds later if it is still running.
// The built app must stop on its own straight away, so a restart or an update doesn't hang.
import { spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('the built planner stops promptly when asked to', async ({}, info) => {
	// The same built app serves every project; checking once is enough.
	test.skip(info.project.name !== 'tablet', 'checked once, on the tablet run');
	// Any free port, so it never clashes with the app the other tests use.
	const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', CALDAV_URL: 'http://127.0.0.1:5233/', CALDAV_USER: 'david', CALDAV_PASSWORD: 'dev' };
	const app = spawn(process.execPath, ['build'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
	const exited = new Promise<number | null>((resolve) => app.on('exit', (code) => resolve(code)));
	try {
		const address = await new Promise<string>((resolve, reject) => {
			app.stdout.on('data', (chunk: Buffer) => {
				const listening = /Listening on (http:\S+)/.exec(chunk.toString());
				if (listening) resolve(listening[1]);
			});
			app.on('exit', () => reject(new Error('The planner stopped before it started listening')));
		});
		// Show a page first, so the planner has talked to the calendar server and started its nightly timer.
		expect((await fetch(address)).status).toBe(200);
		const asked = Date.now();
		app.kill('SIGTERM');
		const code = await Promise.race([exited, new Promise<'still running'>((resolve) => setTimeout(() => resolve('still running'), 3000))]);
		expect(code, 'the planner should exit within 3 seconds of SIGTERM').toBe(0);
		expect(Date.now() - asked).toBeLessThan(3000);
	} finally {
		if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL');
	}
});
