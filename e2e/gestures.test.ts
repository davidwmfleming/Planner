import { expect, test, type Page } from '@playwright/test';
import { futureWeek } from './dates';
import { unique } from './unique';

const { mon, tue } = futureWeek();

/** Draws a stroke through the points, like a pen (the planner reads mouse, finger and pen strokes alike). */
async function draw(page: Page, points: [number, number][]) {
	await page.mouse.move(...points[0]);
	await page.mouse.down();
	for (const p of points.slice(1)) await page.mouse.move(...p, { steps: 6 });
	await page.mouse.up();
}

async function addTask(page: Page, day: string, name: string) {
	const line = page.locator(`#add-task-${day}`);
	await line.fill(name);
	await line.press('Enter');
	const row = page.locator(`section.day[data-date="${day}"] li`, { hasText: name });
	await expect(row).toBeVisible();
	return row;
}

test('a check mark drawn on an item ticks it, and a scribble strikes it out', async ({ page }, info) => {
	const tick = unique('Call the bank', info);
	const scratch = unique('Buy stamps', info);
	await page.goto(`/?page=${mon}`);
	const ticked = await addTask(page, mon, tick);
	const scratched = await addTask(page, mon, scratch);

	let box = (await ticked.boundingBox())!;
	let y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await expect(ticked).toHaveClass(/done/);

	box = (await scratched.boundingBox())!;
	y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y], [box.x + 160, y + 2], [box.x + 60, y + 4], [box.x + 160, y + 2], [box.x + 60, y]]);
	await expect(scratched).toHaveClass(/dropped/);
	// The stroke ended on the title, but it must not also open the details.
	await expect(page.locator('dialog.sheet[open]')).toHaveCount(0);
});

test('dragging an item onto another day moves it there', async ({ page }, info) => {
	const name = unique('Return library books', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	// The next day is on screen even on a phone.
	await page.locator(`section.day[data-date="${tue}"]`).scrollIntoViewIfNeeded();
	const box = (await row.boundingBox())!;
	const tuesday = (await page.locator(`section.day[data-date="${tue}"]`).boundingBox())!;
	const from: [number, number] = [box.x + 80, box.y + box.height / 2];
	await page.mouse.move(...from);
	await page.mouse.down();
	await page.mouse.move(from[0], from[1] + 40, { steps: 5 });
	await page.mouse.move(tuesday.x + tuesday.width / 2, tuesday.y + 30, { steps: 15 });
	await expect(page.locator(`section.day[data-date="${tue}"]`)).toHaveClass(/drop-target/);
	await page.mouse.up();
	await expect(page.locator(`section.day[data-date="${tue}"]`).getByText(name)).toBeVisible();
	await expect(page.locator(`section.day[data-date="${mon}"]`).getByText(name)).toHaveCount(0);
});

test('a sideways sweep turns the page', async ({ page }) => {
	await page.goto(`/?page=${mon}`);
	const day = (await page.locator(`section.day[data-date="${mon}"]`).boundingBox())!;
	const y = day.y + 30;
	const right = Math.min(day.x + day.width - 20, 600);
	await draw(page, [[right, y], [right - 250, y + 10]]);
	await expect(page).not.toHaveURL(new RegExp(`page=${mon}`));
	await expect(page.locator(`section.day[data-date="${mon}"]`)).toHaveCount(0);
	await draw(page, [[right - 250, y], [right, y + 10]]);
	await expect(page.locator(`section.day[data-date="${mon}"]`)).toBeVisible();
});
