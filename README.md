# Planner

David's weekly planner: two pages a week (Mon–Wed, Thu–Sun), events on the left, tasks on the right, stored in a self-hosted CalDAV calendar so phones and computers stay in sync.

- What and why: [docs/spec.md](docs/spec.md)
- How it's built and the task list: [docs/design.md](docs/design.md)
- The clickable prototype the layout came from: [docs/prototype/index.html](docs/prototype/index.html)

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app locally |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests at tablet and phone sizes (Playwright) |
| `npm run lint` | Type and Svelte checks |
| `npm run calendar` | Start a local Radicale calendar server (needs `python3 -m pip install radicale`) |
| `npm run seed` | Fill it with sample entries from the paper page |

## Installing it on a device

Open the planner's address in the browser, then add it to the home screen: in Chrome on Android (the ViWoods), menu → **Add to home screen** / **Install app**; in Safari on iPhone, Share → **Add to Home Screen**. It then opens full-screen like any app. It needs the home server (over Tailscale) to show anything; there is no offline copy, because the calendar server is the one place the data lives.

## Work calendar (read-only)

Work meetings from Outlook (Microsoft 365) can sit among the planner's events, shaded light red and marked **Work**. They can't be ticked or edited here; they change only in Outlook.

1. In Outlook on the web, open **Settings → Calendar → Shared calendars → Publish a calendar**.
2. Pick your calendar and **Can view titles and locations**, then **Publish**.
3. Copy the **ICS** link and put it in `.env` as `WORK_CALENDAR_URL=...`. Anyone with that link can read the calendar, so keep it there and nowhere else.

The planner re-reads it every 10 minutes and keeps nothing from it on disk. If your employer has turned publishing off, the Publish option won't be there; ask IT whether calendar publishing can be allowed.

To try it without a real link: `npx vite-node scripts/sample-work-feed.ts .dev-calendar/work.ics`, then start the app with `WORK_CALENDAR_URL=file://$PWD/.dev-calendar/work.ics npm run dev`.
