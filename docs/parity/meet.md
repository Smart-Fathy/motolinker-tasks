# Meet — the classic portals and the new app

The Meet page: "Start Meeting" and "Join a Meeting" (a code), and below them the meetings scheduled with the team — the list, its
Schedule button, and the sheet that schedules, changes and cancels them. From the module `apps/web/src/modules/meet` (the data, the
page and the sheet), `apps/web/src/ui` (`Sheet`, the classic shared dialog; `Btn`, the in-page button; `BrandSelect`, the classic
dropdown), and the server's `src/modules/meetings` behind `/api/v1/meetings`. The classic code (`public/assets/meetings.js`, the two
portals' `#page-meet`, `src/routes/meetings.js` as an adapter now) stays where it is until the cutover.

Test files named below: **S** `tests/meetings.js` (server: the classic routes characterised first, then `/api/v1`), **P**
`tests/meetparity.js` (look, value by value, in a real browser), **E** `tests/webmeet.js` (the real server, Google stood in for, the
built app, a real browser), **U** `apps/web/src/modules/meet/` (`model.test.ts`, `meet.test.tsx`) and `apps/web/src/ui/`
(`Sheet.test.tsx`, `BrandSelect.test.tsx`), **M** `tests/modules.js` (the catalogue against the classic pages), **W**
`tests/webframe.js` and `tests/webshell.js`, **A** `tests/actor.js` and the route inventory (who may ask which route), **C**
`tests/meetstest.js` (the classic page itself, unchanged).

## What the server is asked

| Classic (both portals) | New | Held by |
|---|---|---|
| `GET /api/<portal>/meetings` — the meetings from a day ago on, soonest first, a hundred at most; `meet.view` | `GET /api/v1/meetings` — `{ items }`; `meet.view`; the Google event ids stay on the server | S (the same ids in the same order, asked of the database the same way; the viewer, the admin; no section is 403; nobody is 401) · A · E |
| `POST /api/<portal>/meetings` — the sheet's body; `meet.schedule`; a title and a start time that is a time, or a 400 with one line; the length is cut to 5–480 minutes; attendees are made text; who made it is recorded; the answer comes before Google is asked | `POST /api/v1/meetings` → 201; the same rules, but **strict** (see below) | S (every field, trimmed, clamped, stored; Google: the company's calendar is asked with the attendees' emails and a Meet link to make, an attendee's own calendar gets the event; the attendees are told, not the scheduler) · U ("sends what was filled in…") · E ("scheduling stores the meeting as filled in…", "behind the answer, the company's Google Calendar is asked…", "each attendee is told by the admin's name…") |
| `PUT /api/<portal>/meetings/:id` — the same body; the event is patched, nobody is told again; a meeting that is not there is a 500 with the database's words | `PUT /api/v1/meetings/:id`; a 404 `not_found` | S · U ("Edit opens the meeting as it stands…") · E ("the event is patched rather than made again, and nobody is told again") |
| `DELETE /api/<portal>/meetings/:id` — the events are removed from the company's calendar and each personal one; cancelling what is gone is ok | `DELETE /api/v1/meetings/:id` → `{ ok: true }`; the same | S · U ("Cancel asks first…") · E ("Cancel asks first, then removes the meeting", "…its event is removed…") |
| A failing database: a 500 with the database's words | A 503 `unavailable` without them | S · U ("says why when the meetings cannot be had…") · E |
| The people to invite: `GET /api/dashboard/employees-for-tasks` (admin), `GET /api/employee/coworkers` (team); the chat rooms: `GET <base>/chat/rooms` | The same routes (no v1 routes for them yet); what cannot be had is nobody and no rooms | U ("opens all the same when the people or the rooms cannot be had") |

## What the page does

| Classic | New | Held by |
|---|---|---|
| "Google Meet" and "Start or join a video meeting instantly."; two cards | The same | U ("says what it is for…") · P |
| "Start Meeting": a link to `meet.google.com/new` in a new tab | The same | U · P |
| "Join a Meeting": a code (spaces taken out) opens `meet.google.com/<code>` in a new tab, on Join and on Enter; nothing happens with no code | The same | U ("joins a meeting by its code…") · P |
| The list: "Upcoming meetings"; a row per meeting — the weekday and the day, the title (cut at the edge), "time · N min · N attendee(s)" | The same | U ("lists the upcoming meetings…") · P (`list`) |
| Join: a link opens in a new tab (a bare domain is given `https://`, anything but http(s) is never a link); a huddle shows "Join huddle"; a meeting with neither shows nothing | The same; **Join huddle opens the huddle's room in the classic portal**, in a new tab (see below) | U ("joins a meeting where it is held…") · P |
| Schedule a meeting / Edit / Cancel for whoever has `meet.schedule` | The same; Cancel asks "Cancel this meeting? Calendar events are removed for everyone." | U ("who may do what…") · E (Bo: nothing to change, and the server refuses) |
| A person without `meet.view` gets the cards and no list | The same, and the server is not asked | U · E (Cy) |
| "Loading meetings…"; "Nothing scheduled. A scheduled meeting lands on every attendee's Google Calendar automatically." | The same | U · P (`loading`, `empty`) |
| The sheet: Title, Date, Time, Duration (15·30·45·60·90·120), Attendees (checkboxes, with the line about Google Calendar), Where (Google Meet · In-app huddle · A link I already have) with the room or the link, Notes; "Title is required." / "Pick a date and time." before it asks, the server's words after (it stays open); "Scheduled — it lands on every attendee's calendar." / "Meeting updated — calendars re-sync in the background." | The same | U ("scheduling a meeting", "changing and cancelling…") · E · P (`sheet`, `sheetLink`, `sheetError`) |

## Look

`tests/meetparity.js` opens the classic page and the new app as the same person, in both portals, both colour modes and two looks (the
original and a loud one), at 390, 670, 800 and 1100 px, in six states (the loader, the list, the empty list, the scheduling sheet, the
sheet with "a link I already have" chosen, the sheet sent with no title), and compares the computed style of every named part — the
title, the cards and their parts, the code field and its button, the list's head and its rows and their parts, the sheet and its head,
body and foot, each field's group, label and control, the attendees' box and chips — and the words in them: more than 600,000 values,
none different, no difference accepted.

## Decisions and deliberate differences

- **`Join huddle` opens the room in the classic portal** (`/legacy/<portal>?chat=<room>`, a new tab) until huddles move into the new
  app with chat. The classic button joined the call in place. The sheet's line "everyone gets a Join button that opens the huddle here"
  is kept word for word.
- **A list that could not be read says so.** The classic page showed "Nothing scheduled", which is untrue; v1 answers 503 and the page
  says why. (Not a look: tested in U and E, left out of P.)
- **A meeting whose length is not one the sheet offers keeps it** (25 minutes stays 25 minutes). The classic sheet silently made it
  fifteen when it was edited.
- **A huddle option with no chat rooms can be seen and not chosen.** The classic dropdown let it be chosen and then offered an empty
  list of rooms.
- **Cancel tells the person when it could not cancel**; the classic page said nothing and drew the list again.
- **v1 is strict where the classic routes were forgiving**: a title over 200 characters, a start that is not a clear instant (with an
  offset or `Z`), a length outside 5–480 or not a whole number, attendees that are not employee ids (the classic route made a `null` into
  the text "null"), notes over 2000 characters, and any field the sheet does not offer are a 400 with what was wrong; a meeting that is
  not there is a 404; an id that is not digits is a 400. The classic routes still take whatever they took.
- **A click on the dim curtain does not close the sheet** (what was typed is kept); Escape and the × close it, focus goes in, stays in
  and goes back, and Escape in an open dropdown closes the dropdown and not the sheet.
- **The dropdown is the classic one** (`BrandSelect`): a button and a floating panel, which the classic portals make by swapping every
  `<select>` at runtime. It is placed under its button or above it, kept in view, searched when the list is long, and walked with the
  arrow keys (the classic one had no keyboard).
- **A cancel button is red in the team's sheet and not in the admin's.** The classic admin theme holds `.btn-outline`'s colour with
  `!important`, so the inline red never showed; both are kept until the redesign makes them one.

## Not in this module (so not here)

The in-app huddle itself, chat and the chat rooms' own pages (batch 4); the Calendar (its own module, [calendar](calendar.md)), which
schedules and edits through this module's sheet.
