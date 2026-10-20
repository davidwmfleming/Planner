import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { futureWeek, iso } from './dates';
import { unique } from './unique';

const { mon, tue } = futureWeek();
// Four weeks later, so the drag test's days hold little else and the rows sit where the test expects.
const later = (day: string) => iso(new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8) + 28));

/** Draws a stroke through the points, like a pen (the planner reads mouse, finger and pen strokes alike). */
async function draw(page: Page, points: [number, number][]) {
	await page.mouse.move(...points[0]);
	await page.mouse.down();
	for (const p of points.slice(1)) await page.mouse.move(...p, { steps: 6 });
	await page.mouse.up();
}

/** Brings a row to the middle of the screen, clear of the page header that stays at the top. */
const onScreen = (row: Locator) => row.evaluate((el) => el.scrollIntoView({ block: 'center' }));

async function addTask(page: Page, day: string, name: string) {
	const line = page.locator(`#add-task-${day}`);
	await line.fill(name);
	await line.press('Enter');
	const row = page.locator(`section.day[data-date="${day}"] li`, { hasText: name });
	await expect(row).toBeVisible();
	// Done writing: put the pen down, as on paper. The day can be crowded by other tests, so bring the row on screen.
	await line.blur();
	await onScreen(row);
	return row;
}

test('a check mark drawn on an item ticks it, and a scribble strikes it out', async ({ page }, info) => {
	const tick = unique('Call the bank', info);
	const scratch = unique('Buy stamps', info);
	await page.goto(`/?page=${mon}`);
	const ticked = await addTask(page, mon, tick);
	const scratched = await addTask(page, mon, scratch);

	await onScreen(ticked);
	let box = (await ticked.boundingBox())!;
	let y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await expect(ticked).toHaveClass(/done/);

	await onScreen(scratched);
	box = (await scratched.boundingBox())!;
	y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y], [box.x + 160, y + 2], [box.x + 60, y + 4], [box.x + 160, y + 2], [box.x + 60, y]]);
	await expect(scratched).toHaveClass(/dropped/);
	// The stroke ended on the title, but it must not also open the details.
	await expect(page.locator('dialog.sheet[open]')).toHaveCount(0);
});

test('dragging an item onto another day moves it there', async ({ page }, info) => {
	const name = unique('Return library books', info);
	const [mon, tue] = [later(futureWeek().mon), later(futureWeek().tue)];
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

test('a tap that wobbles a little is still a tap', async ({ page }, info) => {
	const name = unique('Feed the cat', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	const box = (await row.getByRole('button', { name: `Tick ${name}` }).boundingBox())!;
	const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
	await draw(page, [[x, y], [x + 1, y + 1], [x + 2, y], [x + 1, y + 2]]);
	await expect(row).toHaveClass(/done/);
});

test('a check mark works straight after writing on a line, away from that line', async ({ page }, info) => {
	const name = unique('Post the parcel', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	// Still writing on Wednesday's line; the ✓ goes on Monday's item, and the line saves itself.
	const { wed } = futureWeek();
	const line = page.locator(`#add-task-${wed}`);
	await line.fill(`Next thing ${name}`);
	await expect(line).toBeFocused();
	await onScreen(row);
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await expect(row).toHaveClass(/done/);
	await expect(page.locator(`section.day[data-date="${wed}"]`).getByText(`Next thing ${name}`)).toBeVisible();
});

test('one stroke across an item and back again strikes it out', async ({ page }, info) => {
	const name = unique('Water the plants', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	await onScreen(row);
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	// Left-handed, as David writes: to the right, then back to the left.
	await draw(page, [[box.x + 60, y], [box.x + 180, y + 3], [box.x + 70, y + 6]]);
	await expect(row).toHaveClass(/dropped/);
});

test('a ✓ shows at once, before a slow save finishes', async ({ page }, info) => {
	const name = unique('Slow save', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	await page.route('**/*&/mark', async (route) => {
		await new Promise((done) => setTimeout(done, 3000));
		await route.continue();
	});
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await expect(row).toHaveClass(/done/, { timeout: 500 });
	await expect(row).not.toHaveClass(/marked/, { timeout: 6000 });
});

test('ticking twice while the first save is on its way leaves the item ticked', async ({ page }, info) => {
	const name = unique('Double tick', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	await page.route('**/*&/mark', async (route) => {
		await new Promise((done) => setTimeout(done, 1500));
		await route.continue();
	});
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	const tick = () => draw(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await tick();
	await tick();
	await page.waitForTimeout(4000);
	await page.reload();
	await expect(page.locator(`section.day[data-date="${mon}"] li`, { hasText: name })).toHaveClass(/done/);
});

test('if a mark cannot be saved, the item goes back as it was and says so', async ({ page }, info) => {
	const name = unique('Offline mark', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	await page.route('**/*&/mark', (route) => route.abort());
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await expect(page.getByRole('alert')).toContainText('did not save');
	await expect(row).not.toHaveClass(/done|marked/);
});

test('if the calendar server refuses a mark, the item goes back as it was and the page says why', async ({ page }, info) => {
	const name = unique('Refused mark', info);
	const message = `The calendar server didn't save the mark on "${name}". Reload the page and try again.`;
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	await page.route('**/*&/mark', (route) =>
		route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'failure', status: 502, data: JSON.stringify([{ message: 1 }, message]) }) })
	);
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await expect(page.getByRole('alert')).toHaveText(message);
	await expect(row).not.toHaveClass(/done|marked/);
	await expect(page.getByRole('heading', { name: /500|Internal Error/ })).toHaveCount(0);
});

/** A finger stroke (pointerType 'touch'), sent straight to the browser. */
async function fingerStroke(page: Page, points: [number, number][]) {
	const cdp = await page.context().newCDPSession(page);
	const at = (x: number, y: number) => [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }];
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(...points[0]) });
	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1];
		const [bx, by] = points[i];
		for (let s = 1; s <= 8; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(ax + ((bx - ax) * s) / 8, ay + ((by - ay) * s) / 8) });
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('a ✓ on a page that is out of date leaves an item ticked elsewhere ticked', async ({ page, context }, info) => {
	const name = unique('Out of date', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	const other = await context.newPage();
	await other.goto(`/?page=${mon}`);
	await other.getByRole('button', { name: `Tick ${name}` }).click();
	await expect(other.locator('li', { hasText: name })).toHaveClass(/done/);
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	await draw(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await expect(row).toHaveClass(/done/);
	await expect(row).not.toHaveClass(/marked/);
	await page.reload();
	await expect(page.locator(`section.day[data-date="${mon}"] li`, { hasText: name })).toHaveClass(/done/);
});

test('a finger drawing ✓ or a scribble on an item makes no mark', async ({ page }, info) => {
	const name = unique('Finger', info);
	await page.goto(`/?page=${mon}`);
	const row = await addTask(page, mon, name);
	const marks: string[] = [];
	page.on('request', (r) => r.url().includes('/mark') && marks.push(r.url()));
	let box = (await row.boundingBox())!;
	let y = box.y + box.height / 2;
	await fingerStroke(page, [[box.x + 60, y - 6], [box.x + 72, y + 8], [box.x + 100, y - 18]]);
	await onScreen(row);
	box = (await row.boundingBox())!;
	y = box.y + box.height / 2;
	await fingerStroke(page, [[box.x + 60, y], [box.x + 180, y + 3], [box.x + 70, y + 6]]);
	await page.waitForTimeout(1000);
	expect(marks).toEqual([]);
	await expect(row).not.toHaveClass(/done|dropped/);
});
