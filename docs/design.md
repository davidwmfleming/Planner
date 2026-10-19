# Planner: design

**Decision:** adopt + build. We adopt **Radicale**, a small open-source calendar server (CalDAV), to hold every event and task in the standard .ics format, so iPhone Calendar, the Mac and David's wife's phone all sync with it natively. We build only the **planner**: a web app that lays that data out as David's weekly pages and makes entry fast. No existing app does that layout, which is the whole point of the project.

## Components

```
ViWoods / phone / Mac browser
        │  HTTPS over Tailscale
        ▼
  planner (SvelteKit, Node)  ── CalDAV ──►  Radicale  ──► /srv/radicale/data (.ics files)
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
| Personal | events | David |
| Family | events | David and his wife (shared) |
| School meals | events | David and his wife |
| Workouts | events | David |
| Tasks | tasks | David |

## How planner items map to the .ics standard

| Planner | Stored as |
| --- | --- |
| Event (left column) | VEVENT with DTSTART (date or date-time), optional DTEND, LOCATION, RRULE |
| Task (right column) | VTODO with optional DTSTART (the day and start time); no date = not scheduled |
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

Radicale's data folder is plain files inside the nightly restic backup and the off-site copy. Restore = copy the folder back.

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
8. **Not scheduled panel**: hidden by default, with Today and Sat buttons.
9. **Rollover**: nightly job plus a check on every page load; carried-over marker.
10. **Repeating items**: show recurring events and tasks; create them from the details sheet. Tick, ✕ and → change one day (a standard one-off change, RECURRENCE-ID); the sheet edits the whole series; "Delete this day" skips one day (EXDATE). Edits keep one-off changes made on phones.
11. **E-ink and phone polish**: installable app (PWA), large tap targets, no animation, fast page flips; QA on tablet and phone sizes.
12. **Package and deploy**: Docker Compose for Radicale and planner on `homebase`, Tailscale Serve, backups.
13. **Move in**: export iCloud calendars and reminders into Radicale; set up David's and his wife's phones and the Mac; run alongside the paper book for two weeks.

**Work calendar (built after step 11, at David's request):** the planner reads Outlook's published ICS link (`WORK_CALENDAR_URL` in `.env`) every 10 minutes, keeps it only in memory, and shows the meetings among the day's events in local time, shaded light red with a "Work" tag and no controls. Nothing is written back. If the link can't be read, the page still loads and says so.

**Later versions:** school-meal emails to calendar (Proton Bridge), pen ticks and cross-outs, handwriting entry.
