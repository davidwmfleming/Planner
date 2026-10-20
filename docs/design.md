# Planner: design

**Decision:** adopt + build. We adopt **Radicale**, a small open-source calendar server (CalDAV), to hold every event and task in the standard .ics format, so iPhone Calendar, the Mac and David's wife's phone all sync with it natively. We build only the **planner**: a web app that lays that data out as David's weekly pages and makes entry fast. No existing app does that layout, which is the whole point of the project.

## Components

```
ViWoods / phone / Mac browser
        │  HTTPS over Tailscale
        ▼
  planner (SvelteKit, Node)  ── CalDAV ──►  Radicale  ──► volume planner_data (.ics files)
        ▲                                      ▲
        │ nightly rollover job                 │ CalDAV over Tailscale
                                     iPhone Calendar / Reminders, Mac Calendar, wife's iPhone
```

- **Radicale** (Docker): calendars and task lists. Stores plain .ics files on disk, which makes backup and inspection trivial.
- **planner** (Docker): SvelteKit server talks CalDAV to Radicale; the browser only talks to the planner. No separate database; the .ics data is the single source of truth.
- **Rollover job**: runs inside the planner at 3 a.m. daily, and again on every page load as a safety net (the server was off, or a task was written on a past day). Open, non-repeating tasks dated before today move to today and keep the day they were first written on. The server must run in David's time zone (set `TZ` in compose.yaml).

## Calendars and lists

| Collection | Type | Who sees it |
| --- | --- | --- |
| Me | events | David |
| Family | events | David and his wife (shared) |
| Morgan Meals | events | David and his wife |
| Workouts | events | David |
| Work | events (entered by hand, shaded light red) | David |
| Tasks | tasks | David |

## How planner items map to the .ics standard

| Planner | Stored as |
| --- | --- |
| Event (left column) | VEVENT with DTSTART (date or date-time), optional DTEND, LOCATION, RRULE |
| Task (right column) | VTODO with optional DTSTART (the day and start time); no date = a future task |
| Done | VTODO STATUS:COMPLETED + COMPLETED timestamp (events: X-PLANNER-TICKED) |
| Dropped | STATUS:CANCELLED |
| This month / Waiting on / Someday | CATEGORIES |
| Carried over | X-PLANNER-CARRIED-FROM:<original date> |
| Event ↔ task conversion | delete one component, create the other with the same UID suffix and fields |

Timed tasks get a VALARM so phones that show tasks can alert on them.

## Access and sign-in

- Everything is reached only through Tailscale; no ports open to the internet.
- Planner: Tailscale Serve HTTPS address; the user is identified from Tailscale's identity headers, so there's no separate login.
- Radicale: one username and password per person (David, his wife), stored hashed; phones add it as a CalDAV account. His wife's phone needs the Tailscale app installed to sync.

## Backup

See "Settings and export (v3)" below. (The earlier note here promised a restic backup that was never set up. It is replaced by the plan below.)

## Development before the server arrives

Radicale runs as a plain Python program in a cloud session (no Docker needed), seeded with the prototype's sample data. The planner is built and tested against it. Only the Docker packaging and the move onto `homebase` wait for the box.

## What could break it later

- iOS changing how it handles CalDAV task lists (Reminders support for non-iCloud accounts is the riskiest piece; verify in task 13, fallback is a CalDAV task app on the phone).
- Recurring-event edge cases (time zones, exceptions); covered by tests in task 10.
- SvelteKit or Radicale major upgrades; pin versions, upgrade deliberately.

## Tasks

Each is one small PR with its own tests. 1–11 can be done before the server arrives.

1. **Scaffold** the repo: SvelteKit + TypeScript, Vitest, Playwright, lint, CI on every PR; copy the shop's CLAUDE.md and agents.
2. **Dev calendar server**: script that starts Radicale locally and seeds sample data.
3. **Data layer**: planner item ⇄ VEVENT/VTODO mapping and a CalDAV client (read, create, update, delete), fully unit-tested.
4. **Weekly pages, read-only**: Mon–Wed and Thu–Sun pages from live CalDAV data; flip, Today, date jump.
5. **Line entry**: tap a blank line, type, Enter; the time parser from the prototype with its tests.
6. **Quick actions**: tick done, ✕ drop, → next day, and Today/Sat pulls.
7. **Details sheet**: edit title, date, time, end time, location, list, notes; switch event ↔ task; delete.
8. **Future tasks panel** (first called Not scheduled): hidden by default, with Today and Sat buttons.
9. **Rollover**: nightly job plus a check on every page load; carried-over marker.
10. **Repeating items**: show recurring events and tasks; create them from the details sheet. Tick, ✕ and → change one day (a standard one-off change, RECURRENCE-ID); the sheet edits the whole series; "Delete this day" skips one day (EXDATE). Edits keep one-off changes made on phones.
11. **E-ink and phone polish**: installable app (PWA), large tap targets, no animation, fast page flips; QA on tablet and phone sizes.
12. **Package and deploy**: Docker Compose for Radicale and planner on `homebase`, Tailscale Serve, backups. `scripts/server-setup.sh` does it in one go; rehearsed first on an Ubuntu VM on the Mac. Radicale's data is the Compose volume `planner_data` (not a host folder), so the backup must include Docker's volumes.
13. **Move in**: export iCloud calendars and reminders into Radicale; set up David's and his wife's phones and the Mac; run alongside the paper book for two weeks.

**Pen marks (v2):** built in the browser, no library. `src/lib/gesture.ts` reads a stroke's points as a page sweep, ✓ or scratch-out; the page adds drag onto a day. Strokes come from pointer events. Fingers scroll and turn pages; only the pen (or a mouse) makes marks, and a pen stroke is kept from scrolling the page by cancelling its touchmove. Marks only set a state (a ✓ on a done item does nothing, even on a page that is out of date), and show at once while they save. `/pen-check` shows what a tablet's pen reports, for tuning.

## Settings and export (v3)

**Decision:** configure and build a small add-on. Radicale already does the heavy lifting: it creates, renames and deletes calendars, and it hands out a whole calendar as one .ics file. So the planner only adds a settings page, an export button and two small backup scripts. Backups use plain `tar`, systemd and `rsync`, which are already on the server and the Mac. No new service is added, and the only new library is `fflate`, a small zip library.

### Components and how they talk

```
/settings page ── form actions ──► planner server ── CalDAV (MKCALENDAR, PROPPATCH, DELETE, PUT) ──► Radicale
/export        ── GET ──────────► planner server ── GET each collection (Radicale returns one .ics) ──► zip ──► browser
systemd timer (02:30) ──► backup.sh ──► tar of volume planner_data ──► /srv/backups/planner/  (30 days kept)
Mac launchd job (07:00, or on wake) ── rsync over ssh, via Tailscale ──► Proton Drive folder on the Mac ──► Proton cloud
```

### Settings page (`/settings`, a gear link in the planner header)

**Where settings live.** All settings are one small JSON value, stored as a custom property (`planner-settings`, in the planner's own XML namespace) on the **Tasks** collection in Radicale:
`{ "categories": ["This month", "Waiting", "Someday"], "workCalendar": "<collection path>", "defaultEventCalendar": "<collection path>" }`.
So the settings sit in the one data volume next to the calendars and go into the same backup. The planner keeps nothing on its own disk. Calendars are referred to by their path, which never changes when a calendar is renamed. If the property is missing, the planner uses the defaults: the three lists above, "Work" as the work calendar, and "Me" as the default. Task 14 first checks that Radicale stores and returns a custom property. If it doesn't, the fallback is a `settings.json` in a `planner/` folder of the same volume, mounted into the planner container.

**Event calendars.**
- **Add:** a name of 1 to 40 characters that doesn't match any existing collection's name (case is ignored). The calendar is created with the existing `ensureCalendar`.
- **Rename:** uses the existing `renameCalendar`, which changes only the display name. Phones pick up the new name on their next sync, and the Work and default-calendar choices still apply because they are stored by path.
- **Delete:** the page shows "Family holds 42 items" and offers two choices: **Move them to [calendar ▾]** or **Delete them too**. A confirm button then appears on the page itself (no browser `confirm()`). The page also warns that the calendar disappears from every phone that syncs it, including his wife's. A move copies each stored document unchanged to the other calendar under the same file name, then deletes the original. This keeps repeats, one-off changes and alerts. Only after every item has been handled is the collection itself deleted. If something fails halfway, the page says how many items were done, and running the delete again finishes the job, because the items already moved are gone from the old calendar. The last event calendar can't be deleted, because new events need somewhere to go.
- **Work calendar:** a choice on the page, "Show as work (light red): [calendar ▾ / none]", stored by path. If the work calendar is deleted, the setting becomes "none". The `WORK_CALENDAR` setting in `.env` is used only once, to fill this in the first time, and is then retired.
- **Default for new events:** "New events go in: [calendar ▾]". It works the same way and replaces `EVENTS_CALENDAR`. If that calendar is deleted, new events go to the first remaining event calendar, as they do today.
- **Tasks collection:** shown, but it can't be deleted or renamed. Every task lives there, the settings are stored on it, and Reminders shows it by that name.
- **Startup change (needed, or deleted calendars come back):** today `getStore()` recreates Me, Family, Workouts, Morgan Meals and Work every time the planner starts. From now on it creates them only when the server has no event calendars at all, which means a first run. Start-up reads the settings straight from the Tasks address (`tasks/` under David's home folder), not from the calendar listing, which can come back empty; only a 404 for the Tasks collection itself (plus no event calendars) counts as a first run. The planner finds Tasks by that address everywhere, so a rename in Reminders doesn't make it pick another list. The old "Personal" → "Me" rename runs only while no settings are stored, so a rename made on the settings page sticks.

**Task categories.**
- Tasks store the category's **name** in CATEGORIES (for example `CATEGORIES:This month`), so other apps show something readable. Older tasks that carry the internal keys `month`, `waiting` or `someday` are read as This month, Waiting and Someday, and they get the new name the next time they are saved. Names are matched without regard to case. A CATEGORIES value that isn't one of David's categories (one added on a phone, say) is left in the file untouched and not shown.
- The order of the list is the order of the Future tasks panel and of the "List" menu in the details sheet. This replaces `LIST_NAMES`, `LIST_ORDER` and the fixed `ItemLabel` type.
- **Add:** a name of 1 to 40 characters, unique, with no comma, because commas separate CATEGORIES values.
- **Rename:** first adds the new name to the list, then rewrites every task that carries the old name (whole repeating series included), then removes the old name. If it stops halfway, running it again finishes it, and no task is ever left with a category that isn't on the list.
- **Delete:** the page shows "Waiting holds 5 tasks" and offers **Move them to [category ▾ / No list]**, then the same in-page confirm. A category is only a label, so deleting it never deletes tasks. With "No list" the tasks stay on Future tasks (or on their day) without a tag.

### Export (`/export`, a button on the settings page)

The export is **one zip holding one .ics file per collection**, for example `Me.ics`, `Family.ics` and `Tasks.ics`, named `planner-export-YYYY-MM-DD.zip`. A single combined .ics would lose which event belongs to which calendar, because Apple Calendar and Google Calendar each import an .ics file into one calendar that you pick. Radicale already returns a whole collection as one valid .ics, with its time zones, when asked with a plain GET, so the planner just fetches each collection and zips the results. Event calendars import into Apple Calendar and Google Calendar, one .ics file at a time (neither imports the zip itself). `Tasks.ics` holds standard VTODOs: Thunderbird and CalDAV task apps can import them, but Apple Calendar and Google Calendar ignore tasks. The page says so. **Zip library:** `fflate`, which is about 8 kB, has no dependencies of its own and is widely used. It was chosen over writing the zip format by hand because a proven library is less likely to have bugs.

### Nightly backup and restore

- **On the server:** `scripts/backup.sh` runs as root at 02:30 from `planner-backup.timer`, a systemd timer. `Persistent=true` means a run missed while the server was off happens at the next boot. The script runs `docker run --rm -v planner_data:/data:ro … tar czf` to write `/srv/backups/planner/planner-YYYY-MM-DD.tar.gz`, then deletes copies older than 30 days. The folder and files are readable only by David's account (modes 0700 and 0600). Settings live in `/etc/default/planner-backup` (`BACKUP_DIR=/srv/backups/planner`, `KEEP_DAYS=30`), so the destination can change later without editing the script. `server-setup.sh` installs the script, the config file, the service and the timer, and it can safely be run again. The backup contains the calendars, the settings and the hashed password file, but not `.env`, because `server-setup.sh` makes a new one.
- **Copy to Proton Drive, pulled by the Mac:** Proton has no official Linux app, and rclone's Proton Drive support is unofficial, so the server never talks to Proton. Instead, a launchd job on the Mac (`scripts/mac/pull-backup.sh` plus a plist, run daily at 07:00) uses `rsync` over ssh to the server's Tailscale name. It copies any new archives into a folder inside the Proton Drive synced folder, for example `~/Library/CloudStorage/ProtonDrive-…/Backups/planner/`, which is set in the script. Proton Drive then uploads them. rsync runs without `--delete`, so an empty or damaged server can never wipe the Mac's copies. The Mac deletes its own copies older than 30 days, but only after a pull succeeds. The Mac's ssh key is limited, in the server's `authorized_keys`, to `command="rrsync -ro /srv/backups/planner"`, so it can only read that one folder. The Mac pulls only when it is awake. launchd runs a missed job when the Mac wakes, so it catches up then. If the newest copy is more than 2 days old, the script shows a macOS notification.
- **Restore:** run `scripts/restore.sh <archive>`, using a file from `/srv/backups/planner`, or one copied back from the Mac with `scp`. It (1) runs `docker compose down`, (2) saves the current volume as `before-restore-<time>.tar.gz` in the backup folder, (3) empties the `planner_data` volume and unpacks the archive into it, and (4) runs `docker compose up -d`. To restore onto a new machine, run `server-setup.sh` first, then the restore. Phones resync on their own; if one shows stale items, remove and re-add the account. The restore is rehearsed on the Ubuntu VM before it counts as done.

### Who can sign in

Nothing changes. The settings page and the export can only be reached over Tailscale, like the rest of the planner. Actions are SvelteKit form actions (checked against ORIGIN) and the export is a plain GET. The backup copy is reachable only from the Mac's restricted key over the tailnet.

### What could break it later

- Radicale might stop keeping custom collection properties, or an app might delete the Tasks collection. In that case the planner falls back to the default settings and nothing is lost except custom category names and the Work and default choices.
- Deleting a shared calendar removes it from his wife's phone too. The page warns about this, and the nightly backup can bring it back.
- macOS privacy rules may stop a launchd job from writing into `~/Library/CloudStorage`. If they do, give `rsync` (or the script) Full Disk Access; this is checked when the job is installed.
- Proton Drive changing where its synced folder sits on the Mac (the path is set in one place in the script).
- The disk filling up isn't a concern: the data is a few MB, and 30 compressed copies are tiny.

### Tasks (v3)

Each is one small PR with its own tests.

14. **Settings store:** read and write the `planner-settings` property on the Tasks collection, with defaults when it is missing. An integration test against the dev Radicale proves the property survives a restart (if it doesn't, switch to the `settings.json` fallback and say so in the PR).
15. **Stop recreating calendars at start:** create the starting set only on a first run. Move Work and the default calendar into settings by path, filled in once from `.env`. The planner reads its Work shading and default calendar from settings. Unit tests.
16. **Settings page, read-only:** the `/settings` route, a gear link in the header, and lists of calendars and categories. Playwright test.
17. **Add and rename calendars** on the settings page, with name checks. Unit tests for the checks; Playwright for the flow.
18. **Work and default-calendar choices** on the settings page. Playwright test that the shading follows a renamed Work calendar.
19. **Store: move a document and delete a calendar.** `moveDocument` copies the stored document unchanged under the same file name; `deleteCalendar` sends a DAV DELETE. Integration tests, including a repeating event with a one-off change.
20. **Delete a calendar:** item count, move-or-delete choice, in-page confirm, phone warning, a refusal for the last event calendar, and clearing Work and default when they point at it. Playwright test.
21. **Categories as names:** `label` becomes a category name. Read the old keys, write the name, keep CATEGORIES values the planner doesn't know, and take the order from settings. Replace `LIST_NAMES` and the fixed menu. Unit tests in `ical.test.ts` and `edit.test.ts`.
22. **Add and rename categories:** rename rewrites tasks (add the new name, rewrite, remove the old name). Integration test, including running a half-finished rename again.
23. **Delete a category:** task count, move to another category or "No list", in-page confirm. Playwright test.
24. **Export:** `/export` returns a zip of one .ics per collection (with `fflate`), plus the button and its note about tasks. A test unzips the export, parses each file with ical.js, and finds every seeded item.
25. **Server backup:** `scripts/backup.sh`, `/etc/default/planner-backup`, the systemd service and timer, installed by `server-setup.sh`, which also prints the timer status. Shellcheck in CI; rehearse on the VM (`systemctl start planner-backup` makes an archive, and old ones are removed).
26. **Restore:** `scripts/restore.sh` with its safety copy, plus a README section. Rehearse on the VM: back up, delete a calendar, restore, and check it is back.
27. **Mac pull to Proton Drive:** `scripts/mac/pull-backup.sh`, the launchd plist, the read-only rrsync key line printed by `server-setup.sh`, and the stale-copy notification. Shellcheck in CI; test by hand on the Mac (including a run after waking from sleep).

**Later versions:** school-meal emails to calendar (Proton Bridge), work Outlook read-only feed, handwriting entry (configure the tablet's handwriting keyboard first).
