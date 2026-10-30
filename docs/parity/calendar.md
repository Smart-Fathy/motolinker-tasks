# Calendar — the classic portals and the new app

The company's calendar, a month or a week at a time: the meetings a person is in, the tasks due, and the leads they promised to call,
drawn as a grid; a busy day opens whole; a meeting opens with a way to join it; whoever may schedule can add an event; and — in the
admin's portal — whether new tasks are being added to a Google Calendar. From the module `apps/web/src/modules/calendar`, the Meet
module's scheduling sheet, and the server's `src/modules/calendar` behind `/api/v1/calendar`. The classic code
(`public/assets/calendar.js`, `src/routes/calendar-feed.js` as an adapter now) stays where it is until the cutover.

Test files named below: **S** `tests/calendar.js` (server: the classic routes characterised first, then `/api/v1`), **P**
`tests/calparity.js` (look, value by value, in a real browser), **E** `tests/webmeet.js` (the real server, Google stood in for, the
built app, a real browser), **U** `apps/web/src/modules/calendar/` (`model.test.ts`, `calendar.test.tsx`), **M** `tests/modules.js`,
**W** `tests/webframe.js` and `tests/webshell.js`, **A** `tests/actor.js` and the route inventory, **C** `tests/caltest.js` (the classic
page itself; it now reads the rules from `src/modules/calendar`).

## What the server is asked

| Classic (both portals) | New | Held by |
|---|---|---|
| `GET /api/<portal>/calendar?from=&to=` — a day either side of the window; the **admin** gets the company's diary, an **employee** their own: tasks assigned to them either way a task is assigned (or to an old Slack id), meetings they are in or made, follow-ups assigned to them; each source is gated by `tasks.view`, `meet.view`, `leads.view` and a person without one gets none of that kind, not a refusal | `GET /api/v1/calendar?from=&to=` — the same service; **`calendar.view`** (the classic routes were not gated by the Calendar section) | S (the same ids in the same order, asked of the database exactly as the classic page asks, for the admin and for five kinds of team member) · A · E |
| Dates that are not dates: a 400 "from and to must be dates"; no window is now for a month | A 400 `invalid` with what was wrong, the same words; dates are `YYYY-MM-DD` or an instant; the same default | S |
| A source the database cannot read is an empty source, and the page says nothing | A **503** `unavailable` without the database's words — a quiet month and a failure are not the same thing; an employee's tasks are found by asking twice, and if either could not be read the list is not guessed at | S · U ("says why when the calendar cannot be had…") · E |
| A meeting is the stored row | A meeting is the Meet page's (the Google event ids stay on the server); who a task is assigned to is always text | S |
| The admin's Google link: `GET /api/calendar/status`, `POST /api/calendar/disconnect`, `GET /api/calendar/connect?_t=<token>` | The same routes | U ("the admin's Google Calendar link") · E |

## What the page does

| Classic | New | Held by |
|---|---|---|
| The header: "Calendar" and a line about what it holds (the admin's and the team's differ); a "Google Calendar" link in a new tab; for the admin, "Google not configured" / "Task sync on · <email>" / "Task sync off" and a Disconnect / Connect for task sync button (Disconnect asks first) | The same; Connect leaves for Google carrying the session in the address, as before | U · P (`month` etc.) |
| The bar: Today · ‹ · › · the month or the week's title · the legend (N meetings, N tasks, N follow-ups) · Month / Week · New event (whoever may schedule) | The same | U ("shows October as the whole weeks it touches…", "counts what is on show…", "steps a month on and back…", "switches to a week…") · P |
| The grid: seven weekdays, the weeks the month touches, today lit, other months dimmed; a month shows three things a day and "+N more", a week shows all | The same | U ("shows the first three things on a day…", "shows all of them in a week") · P |
| Chips: a meeting (its time, a video or a huddle glyph), a follow-up (its time, the lead), a task (late ones red, finished ones struck through); meetings and follow-ups by their time, tasks at the end of the day | The same | U ("puts each thing on its day, in the order it happens", "marks a task that is late…") · P |
| The window loads with "Loading…" under the grid, and the last window stays on show meanwhile | The same | U ("shows the loader…", "keeps what the last window held on show…") · P (`loading`) |
| A day's sheet: its name, a chip per thing, "Nothing scheduled.", Schedule something (whoever may schedule), Close | The same | U · E · P (`day`) |
| A meeting's sheet: when, how long, how many, the notes, "Joins the in-app huddle — audio in MotoLinker, no Google account needed.", Join huddle / Join, Edit, Close | The same; **Edit opens that meeting** | U ("opens a meeting with when…", "Edit opens the meeting itself…") · E · P (`meeting`) |
| A task goes to Tasks; a follow-up to the lead's page | A task goes to **Tasks** and a follow-up to **Leads** (the screens; there is no page of a single task or lead to go to yet) | U ("where a task and a follow-up go") · E |
| New event, and a double-click on a day (at ten in the morning), schedule through the Meet module's sheet; the calendar is read again when it closes | The same; it is read again as soon as a meeting is stored, changed or cancelled — from the Meet page too | U · E ("…it is on that day of the calendar without a reload") |

## Look

`tests/calparity.js` opens the classic page and the new app as the same person, in both portals, both colour modes and two looks, at
390, 670, 800 and 1100 px, in five states (the loader, the month, the busy day's sheet, a meeting's sheet, the week), and compares the
computed style of every named part — the header and its parts, the bar's buttons and legend and view switch, the grid and its
weekdays, a busy day and its chips and "+N more", a day with a late task, a day of the next month, the loader, the sheets and their
parts — and the words in them: some 400,000 values, none different, no difference accepted.

## Decisions and deliberate differences

- **Edit from the Calendar opens the meeting itself.** The classic Edit looked the meeting up in the Meet page's list, which is empty
  until that page has been opened, and opened a blank "Schedule a meeting" sheet instead.
- **A task or a follow-up goes to its screen**, not to the item: the classic admin opened the task's modal and the lead's profile; there
  is no page of a single task or lead in the new app until Tasks and Leads move.
- **Join huddle opens the room in the classic portal**, as on the Meet page.
- **The feed is gated by the Calendar section** (`calendar.view`) as the page is; the classic route answered anyone.
- **A source that could not be read is said**, not drawn as nothing (the page shows the server's words above an empty grid, as the
  classic page does when the network fails).
- **The chips' glyphs are 11 px at every width** (the classic stylesheet's 9 px rule for a phone never took: the glyphs carry their size
  inline). The chips themselves become dots on a phone, as in the classic page.
- **The Calendar pads itself** (it is `padding: 0` in the classic team portal, so the shell does not pad it either; the page says so
  with `data-flush`).

## Not in this module (so not here)

A single task's or a single lead's page (Tasks and Leads); availability (the Home board and its editor, with Home); the Google
sign-in itself (it is the server's, and unchanged).
