# Planner: discovery notes

Raw notes from David's interview, in his words where possible. The spec is written from these.

## Q1: how the paper planner works (2026-10-19)

**Monthly two-page spread**
- To-dos for this month, plus lingering "someday" items. Examples: fix piano keys (glue, not urgent); defrost freezer (before winter); budget update and chat with wife (before January); cancel a credit card (one phone call).
- Things being tracked / waiting on: wills (meeting in a week), tax credit submission awaiting adjudication, French training for work awaiting an answer.
- Purpose: "stuff I don't want to forget about."

**Dailies: three days per page**
- Work meetings (from Outlook), personal events (personal calendar), tasks (mostly iOS Reminders; some added as they come up in person).

**Outside the book**
- Starred emails = waiting on; snoozed emails = come back later.
- Work to-dos and work email are kept entirely separate. Work events are pulled in only to see how busy a day is.

**What works about paper**
- Opens straight to today/tomorrow/next day on one page.
- Quick to flip to a future date.
- Quick to fill in ahead of time.
- A longer unscheduled list he can pull forward any time.
- Easy to move things from one day to another.

**What doesn't**
- Everything is already stored elsewhere; writing it again feels like double entry.
- The problem has never been the data, it's the layout and how fast he can get from one thing to another.

**Device**
- Owns a ViWoods AI Paper (large), an e-ink Android tablet with a pen. Its Daily app supports handwriting but is too convoluted.
- Goal: an app on that device that replaces the paper book.
- Offered a photo of his layout.

## Early implications (PM's read, to confirm)
- The app is mostly a *view* over data that already exists (calendars, reminders), plus two lists the book adds: a monthly/someday list and a waiting-on list.
- Primary screen: three days side by side, events and tasks together, work events shown as busy blocks.
- Must be designed for e-ink: high contrast, no animation, big tap targets, fast page turns. Phone is a secondary screen.
- Moving a task between days must be one gesture.
- Open question: can the work Outlook calendar be read at all (employer policy)?

## Q2: where things get entered (2026-10-19)

- Enter in the app, but it syncs everywhere. The e-ink tablet isn't always with him; the phone is, and the phone is where notifications reach him.
- An event entered in the app must appear in his phone calendar (for alerts) and ideally his work calendar.
- Must also be able to add events and tasks from the phone or computer when the tablet isn't there: standard calendar entry.

**Implications (PM's read)**
- Two-way sync over open standards: a self-hosted CalDAV server (e.g. Radicale) holds calendars and tasks; the planner app, iPhone Calendar and the Mac all read and write it. The app never owns a private copy.
- Phone notifications then come free from the phone's own calendar app.
- To verify: how well iOS Reminders handles tasks from a non-iCloud CalDAV account; fallback is a CalDAV-capable task app on the phone.
- Work calendar: writing personal events into an employer's Outlook is often blocked by policy. Options: read-only feed of work events into the planner, and personal events reach him through the phone instead. Needs checking with his employer's setup.
- Existing iCloud calendars and reminders would be migrated to the CalDAV server.

## Q3: other people and the data model (2026-10-19)

- Wife keeps using a standard calendar app; shared calendars just need to be in a standard format. She never needs the planner.
- David doesn't care about the event/task distinction. Wants one kind of item with optional dimensions: events have location and start/end; tasks may have no date, brief notes, categories like "waiting", and a done checkbox that records completion.

**Implications (PM's read)**
- This maps directly onto iCalendar (the .ics standard): events (VEVENT) and tasks (VTODO) are siblings in one format. Tasks can be undated, have categories, and record a completion time.
- In the planner they're one "item". Under the hood: anything with a time slot is saved as an event (so it shows and alerts in every calendar app); anything undated or checkable is saved as a task. Converting between the two is one tap.
- "Waiting on", "this month" and "someday" become categories or lists, not separate systems.

## Q4: day-one must-haves, and the daily page photo (2026-10-19)

Photo: docs/paper-daily-page.jpg

**Must-haves in his words**
- Opens on today, tomorrow and the day after, all on one screen.
- Page flip with a single gesture.
- Quick check-off of what happened or got done.
- Entry as simple as writing a line: tap a line, type "9am Dentist Appt". Left column → calendar event at 9 that day; right column → task that day starting at 9. Recurring items can use a "more details" option.
- Unchecked tasks automatically move to the next day so nothing gets lost.

**What the photo shows (PM's read)**
- Three days stacked top to bottom on one page (Mon 17, Tue 18, Wed 19), not side by side. Each day is a band: day letter and date top left, events in the left column, tasks in the right.
- Events: a time then a title ("8:45 ADHD Follow Up", "9 Georgetown CleanTech Visit"); a multi-day all-day event ("Cornwall Camp") repeats on each day.
- Tasks: checkbox squares ("Green Cart", "Pick up meds", "Veggie Box", "Lift", "Sheets").
- Four distinct marks: ticked = done; struck through = dropped/cancelled (not the same as done); an arrow drawn from one day to the next = moved; a few loose notes at the bottom of the page.
- Lots of white space. Each day holds roughly 3-5 events and 3-6 tasks.
