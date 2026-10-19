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

## Work events

Work meetings are entered by hand into the **Work** calendar (created automatically on the calendar server): write the line as usual, open its details and choose **Calendar → Work**. Work events are shaded light red and tagged **Work**, and otherwise behave like any other event. Set `WORK_CALENDAR` in `.env` to use a different calendar name.

## Temporary test copy on NearlyFreeSpeech.NET

Until the home server is running, a test copy with **sample data only** can run on a NearlyFreeSpeech.NET site. It is on the open internet, so it sits behind a password (`TEST_PASSWORD`, checked by the browser's own password prompt) and must never hold real calendars. Over SSH on the site run `sh nfsn-setup.sh your-site.nfshost.com` (the script is `scripts/nfsn-setup.sh`); it installs and builds everything, makes the passwords, adds sample entries, and prints the three control-panel steps (two daemons and a proxy).
