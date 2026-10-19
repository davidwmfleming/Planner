import { expect, test } from '@playwright/test';
import { futureWeek } from './dates';
import { unique } from './unique';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('writing a line in a column saves an event or a task on that day, ready for the next line', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const today = iso(new Date());
	await page.goto('/');
	const day = page.locator(`section.day[data-date="${today}"]`);

	const eventLine = page.locator(`#add-event-${today}`);
	await eventLine.fill(`9am Dentist ${tag}`);
	await eventLine.press('Enter');
	const saved = day.locator('li', { hasText: `Dentist ${tag}` });
	await expect(saved).toBeVisible();
	await expect(saved.getByText('9:00 am')).toBeVisible();
	await expect(eventLine).toHaveValue('');
	await expect(eventLine).toBeFocused();

	const taskLine = page.locator(`#add-task-${today}`);
	await taskLine.fill(`Pick up dry cleaning ${tag}`);
	await taskLine.press('Enter');
	await expect(day.locator('.col').nth(1).getByText(`Pick up dry cleaning ${tag}`)).toBeVisible();

	// It is really on the calendar server: still there after a reload.
	await page.reload();
	await expect(day.getByText(`Dentist ${tag}`)).toBeVisible();
});

test('tapping away from a written line saves it, and the cursor goes where you tapped', async ({ page }, info) => {
	const tag = unique('', info).trim();
	const { mon } = futureWeek();
	await page.goto(`/?page=${mon}`);
	const day = page.locator(`section.day[data-date="${mon}"]`);
	const taskLine = page.locator(`#add-task-${mon}`);
	const eventLine = page.locator(`#add-event-${mon}`);

	await taskLine.fill(`Book flu shot ${tag}`);
	await eventLine.click();
	await expect(day.locator('li', { hasText: `Book flu shot ${tag}` })).toBeVisible();
	await expect(taskLine).toHaveValue('');
	await expect(eventLine).toBeFocused();

	// An empty line saves nothing.
	await eventLine.blur();
	await page.reload();
	await expect(day.getByText(`Book flu shot ${tag}`)).toHaveCount(1);
});
