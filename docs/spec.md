# Planner: spec (draft 1)

**Problem:** David's calendars, reminders and "don't forget" lists are spread across several apps, and none lays them out the way his paper planner does, so he re-copies everything by hand every day.

**Who uses it:** David, on his ViWoods AI Paper (e-ink Android, large) first, then his phone and Mac browser. His wife never uses the planner; she keeps her normal calendar app and sees shared calendars through the standard format.

## Must-haves (day one)
1. **Weekly pages, like the book:** two pages per week, Mon–Wed and Thu–Sun, with Saturday and Sunday given about half the height of a weekday. Opens on the page holding today. Days stack top to bottom; each shows its date top left, events on the left, tasks on the right.
2. **One-gesture page flip** to the next or previous page, plus a quick jump to any date.
3. **One-tap marks:** done (tick), dropped (strike-through), and moved to another day. Done and dropped are recorded differently.
4. **Line-style entry (keyboard in v1):** tap an empty line, type "9am Dentist". In the events column it becomes an event at 9:00 that day; in the tasks column, a task starting at 9:00. "More details" opens recurrence, location, end time, labels and notes.
5. **Automatic rollover:** unchecked, undropped tasks move forward to today each morning, marked as carried over so nothing is lost silently.

6. **Tap marks (v1):** tap the box to mark done; a small ✕ button drops an item (shown struck through). Pen gestures come in a later version.

## Soon after
- **Not scheduled list:** this month's to-dos, someday items and a "waiting on" list (wills, tax credit, French training). Hidden behind a button at the bottom of the page; each item has one-tap **Today** and **Sat** buttons to pull it onto today or the coming Saturday. (Moved up to day one after prototype feedback.)
- School-meal emails turned into entries on the school calendar automatically.
- Work Outlook meetings shown as read-only events, if his employer allows a calendar feed.

## Non-goals
- No separate task and event apps: one kind of item, saved in the standard format.
- No work to-dos or work email.
- No food tracking, no gamification, no animations.

## Context
- E-ink first: black on white, no animation, large tap targets, fast redraws, pen- and finger-friendly.
- Works on the phone as a normal web app for quick entry on the go.
- Alerts come from the phone's own calendar and reminder apps, not from the planner.

## Connects to
- Self-hosted CalDAV server on the home server (calendars and tasks in the .ics standard), shared with iPhone Calendar, the Mac and his wife's phone.
- Later: Proton Bridge (school-meal emails), a work calendar feed.

## Data kept
- David's and the family's calendars and tasks, on the home server only, backed up nightly.

## Success test
After two weeks, David hasn't opened the paper planner, and nothing he wrote in the planner was missed or lost.

## If it breaks
Events and tasks are still on the CalDAV server, so his phone calendar keeps working; only the planner view is lost.

## Open questions
- Decided: v1 is keyboard and tap only. Pen gestures (tick, cross-out) and handwriting-to-text are later versions.
- Can the work Outlook calendar publish a read-only feed?
- Should events in the past also get ticked, or only tasks? (The photo shows ticks on events.)
- The loose notes at the bottom of the paper page: keep a per-day notes line?
