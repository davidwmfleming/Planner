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
| `npm run test:e2e` | Browser tests at tablet and phone sizes (Playwright); tests that change the Work or new-event choice run last, on their own |
| `npm run lint` | Type and Svelte checks |
| `npm run calendar` | Start a local Radicale calendar server (needs `python3 -m pip install radicale`) |
| `npm run seed` | Fill it with sample entries from the paper page |

## Installing it on a device

Open the planner's address in the browser, then add it to the home screen: in Chrome on Android (the ViWoods), menu → **Add to home screen** / **Install app**; in Safari on iPhone, Share → **Add to Home Screen**. It then opens full-screen like any app. It needs the home server (over Tailscale) to show anything; there is no offline copy, because the calendar server is the one place the data lives.

## Work events

Work meetings are entered by hand into the **Work** calendar (created automatically on the calendar server): write the line as usual, open its details and choose **Calendar → Work**. Work events are shaded light red and tagged **Work**, and otherwise behave like any other event. Which calendar counts as Work, and which one new events go in (**Me** at first), are chosen on the Settings page and kept in the planner's settings on the calendar server, so they still apply after a calendar is renamed. `WORK_CALENDAR` and `EVENTS_CALENDAR` in `.env` only fill these in the first time the planner starts.

The starting calendars (Me, Family, Workouts, Morgan Meals, Work and the Tasks list) are made only on a first run, when the calendar server has no event calendars yet, so a calendar deleted on a phone stays deleted.

## Settings

The gear at the top of the planner opens **Settings**, which lists the event calendars, the Tasks list and the task categories, and shows which calendar is shaded as Work and where new events go. **Add** makes a new event calendar, and **Rename** changes a calendar's name; phones that sync it pick up the new name on their next sync. A name can be up to 40 letters and can't match another calendar or list (capitals don't count). The Tasks list can't be renamed, since every task and the settings live there. Below the calendars, **Show as work (light red)** picks the calendar shaded as Work (or None), and **New events go in** picks where a line written in the events column is saved; **Save choices** stores both. **‹ Planner** at the top leads back, which matters in the installed app, where there is no browser back button.

## Running it on the server (or a test VM)

The planner and its calendar server run in Docker (`compose.yaml`), reachable only over Tailscale with an https address from Tailscale Serve. All calendar data lives in the Compose volume `planner_data`, which the nightly backup covers. On a fresh Ubuntu Server with your user able to `sudo`:

```
curl -fsSO https://raw.githubusercontent.com/davidwmfleming/Planner/main/scripts/server-setup.sh
bash server-setup.sh            # add --sample on a test machine for the sample entries
```

The script installs Docker and Tailscale if needed (Tailscale prints a sign-in link the first time), puts the code in `/srv/planner`, writes `/srv/planner/.env` with a random calendar password, starts everything, and prints the planner's address and the calendar-app details. Run it again to update. In the Tailscale admin console, MagicDNS and HTTPS certificates must be on. Set `HTTPS_PORT` (for example `HTTPS_PORT=8443 bash server-setup.sh`) if another service already uses 443.

## Syncing with other calendar apps

The planner's calendars can be added to Apple Calendar (Mac or iPhone), or to Android with DAVx⁵, as a CalDAV account. Events and tasks added on either side show on the other. The planner passes everything under `/dav/` to the calendar server, which asks for its own user name (`CALDAV_USER`, usually `david`) and password (`CALDAV_PASSWORD` in `.env`).

- **iPhone:** Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add CalDAV Account. Server: the planner's address without `https://`; then the user name and the calendar password.
- **Mac:** Calendar → Settings → Accounts → + → Other CalDAV Account. Account type: Manual; server address: `https://<planner address>/dav/`.
