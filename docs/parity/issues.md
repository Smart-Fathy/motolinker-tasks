# Issues — the classic team portal and the new app (and the admin portal, which gets it now)

The Issues centre: what the team reported to the Chief Technical Officer, as a queue and a reading pane, with the conversation on
each ticket and the buttons to answer it and to close or reopen it — and "Report an Issue", the form the team raises one with. From
the module `apps/web/src/modules/issues` (the data, the page and the form), `apps/web/src/ui/Modal.tsx` (the dialog), the two
entry points in `apps/web/src/app/shell` (the foot of the team's rail, the team's account menu), and the server's
`src/modules/issues` behind `/api/v1`. The classic code (`public/assets/employee.js`, "Issues center" and "Report an Issue") stays
where it is until the cutover.

**The classic admin portal never had this page**, so there is nothing of the admin's to compare it to: the admin gets the team's page,
drawn in the admin's chrome from the same variables, and the catalogue (`packages/contracts/src/modules.js`) marks it `fresh` for the
admin — new to that portal. Everything below about the classic page is the team portal's.

Test files named below: **S** `tests/issues.js` (server), **P** `tests/issparity.js` (look, value by value, in a real browser),
**SP** `tests/shellparity.js` (the rail's new button against the classic footer's), **E** `tests/webissues.js` (the real server, the
built app, a real browser), **U** `apps/web/src/modules/issues/` (`model.test.ts`, `data.test.tsx`, `issues.test.tsx`,
`report.test.tsx`) and `apps/web/src/ui/Modal.test.tsx`, **M** `tests/modules.js` (the catalogue against the classic pages), **W**
`tests/webshell.js` and `tests/webframe.js`, **A** `tests/actor.js` and the route inventory (who may ask which route).

## What the server is asked

| Classic (team portal) | New | Held by |
|---|---|---|
| `GET /api/employee/issues` — every ticket, newest first, 200 at most; the CTO by job title, or anyone granted the section | `GET /api/v1/issues` — `{ items }`; `issues.view` (the CTO by title has it); **the admin too** | S (the classic route is characterised first; v1 returns the same tickets in the same order, asked the same way; anyone else, even the person who reported one, is 403) · A · E |
| `PUT /api/employee/issues/:id` — closes (`resolved`) or reopens (anything else is read as `open`); records who and when; tells the reporter, once | `PATCH /api/v1/issues/:id` `{ status: 'open' \| 'resolved' }`; `issues.resolve`; the admin is named "Admin" | S (closing what is closed tells nobody again; reopening clears who and when; a reader and the reporter are 403) · U ("marks an open ticket solved…", "reopens a closed one") · E ("Mark solved is stored with who closed it, and the reporter is told once") |
| `GET /api/employee/issues/:id/comments` — oldest first; the reporter, and anyone who may read the centre | `GET /api/v1/issues/:id/comments` — `{ items }`; the same people, and the admin | S (each reporter reads their own ticket's; an unrelated colleague is 403) · E |
| `POST /api/employee/issues/:id/comments` — a reply (words, or a file the app stored, or both); the reporter and every CTO are told, except the author | `POST /api/v1/issues/:id/comments` → 201; the same | S ("both ends of the ticket hear about it…") · U ("sends a reply, empties the box…") · E ("a reply is stored under her name…") |
| `POST /api/employee/report-issue` (multipart: title, description, file) — any signed-in team member; the file goes to `chat-files/issues/`; every CTO is told | `POST /api/v1/issues` (multipart) → 201 `{ ok, file }`; any signed-in actor (the admin included) | S (the attachment's name made safe; neither words is a 400; a title is cut at 150 and details at 2000) · U (`report.test.tsx`) · E ("sending stores the ticket under her name, with the file in the store") |
| A failing database: a 500 with the database's words; the thread of a ticket whose replies could not be read is an empty thread | A 503 `unavailable` without the database's words; the replies' failure is said, not "No replies yet." | S · U ("says why the conversation could not be had…") · E ("says so in the queue…") |

## What the page does

| Classic | New | Held by |
|---|---|---|
| "Reported issues"; under it "Tickets the team raised from “Report an issue”" until the queue has come, then "N still open" or "Nothing open — all clear" | The same | U ("is headed 'Reported issues'…") · P |
| Chips: All · Open · Resolved, each with its count; the pressed one is lit | The same (`aria-pressed`) | U ("counts the queue on its chips…", "shows only what a chip names…") · P (`queue`, `filter`) |
| The queue: a card per ticket — a stripe, the title (or "System issue"), "who · when", an Open/Resolved pill; a resolved card is dimmed; the picked card is lit | The same | U ("lists each ticket as a card…") · P |
| The reading pane: the title and pill, who reported it (initials, name, when), the details (or "No description was given."), "View attachment", "Solved by X · when" on a closed ticket | The same | U ("asks for nothing until one is picked…", "says who solved a closed ticket…") · P (`ticket`, `solved`) |
| Dropping the picked ticket when a chip does not show it (for good) | The same | U ("shows only what a chip names, and the ticket being read goes…", "lets go of a ticket that leaves the chip it was read from") |
| On a phone the pane is below the queue and is scrolled into view when a ticket is picked | The same | U ("scrolls the ticket into view on a phone…") · P (390 and 670 px) |
| The conversation: the loader, each reply (author, when, words, a file link), "No replies yet." | The same; a failure to read it is said | U · P (`threadLoading`, `ticket`, `solved`) |
| The reply box ("Reply to <name>…"), Send (nothing sent when empty; the box is disabled while it goes; focus returns), and Mark solved / Reopen for whoever has `issues.resolve` | The same | U ("answering a ticket", "closing and reopening") · E |
| Toasts: "Marked solved — the reporter has been told.", "Reopened", and the server's words when it would not | The same | U · E |
| Empty queue "No issues here — all clear! 🎉"; an error box | The same | U · P (`empty`, `error`) |
| Report an Issue: a button at the foot of the team's rail (hidden when the rail is narrowed to its icons) and a line in the account menu; a dialog with Summary (150), Details (2000), an attachment (images, pdf, log, txt, zip, mp4; up to 10 MB), Cancel and Submit Ticket; it says "Please describe the issue" / "File must be under 10 MB" before it asks, "Sending…" while it goes, "Ticket sent to the CTO — thank you!" after, and "Error: …" with the server's words when it would not | The same | U (`report.test.tsx`, `Modal.test.tsx`) · SP · E ("Report an Issue at the foot of the rail…", "an empty form says what is wrong…", "the request was a form…") |

## Look

`tests/issparity.js` opens the classic team page and the new app as the same person, in both colour modes and two looks (the original
and a loud one), at 390, 670, 800 and 1100 px, in eight states (loading, the queue, a chip pressed, a ticket whose conversation is
still on its way, a ticket and its conversation, a resolved ticket with no replies, an empty queue, an error), and compares the
computed style of every named part — the heading, the chips and their counts and dots, the queue's cards and their parts, the pane and
its parts, the thread and a reply, the reply box and its buttons — and the words in them: more than 300,000 values, none different.
`tests/shellparity.js` compares the new "Report an Issue" button with the classic footer's, expanded and collapsed.

## Decisions and deliberate differences

- **The admin has the page, and not the button.** The admin may read, answer and close tickets (as "Admin"); the form to raise a ticket
  is the team's, and the admin portal never had it, so the admin's rail has no "Report an Issue" (the route would take one).
  (E: "…has no 'Report an Issue' button".)
- **The admin's page is the team's, in the admin's chrome.** There is no classic admin page to match; it takes the colours, radius and
  type of whichever portal it is in. The admin's page pads itself (the admin's frame does not); the team's frame already does.
- **Opening a link to `#issues`** (the notifications carry `/employee#issues`) opens the centre in either portal. For the admin there is
  no classic page, so the shell does not remember Issues as the admin's last page, and "Classic portal" from it goes to the portal's front.
- **A reply stays in its box if it could not be sent**, and is cleared only when it was. The draft is kept while the ticket stays
  picked, through Mark solved and Reopen, and a ticket picked next starts with an empty box (the classic page redrew the pane, and
  so emptied the box, after Mark solved too).
- **A failed read of the conversation is said**, not "No replies yet." (the classic page swallowed the error).
- **A closed ticket is the server's answer**, put in the queue as it came; nothing is guessed ahead of it.
- **Attachments open only where a browser should follow them** (a web address or an address on this site): the classic page put
  whatever the row held into a link.
- **v1 is strict where the classic routes were forgiving**: a status that is not `open` or `resolved` is a 400 (the classic route read
  anything else as `open`); a reply of more than 2000 characters is a 400 (the classic route cut it); a ticket that is not there is a
  404 and an id that is not digits a 400; a ticket that cannot be stored is not announced (the classic route still tells the CTOs).
- **The report dialog is accessible** where the classic one was not: it is a modal dialog with a name, Escape closes it, focus goes in and
  back out, and the file input can be reached from the keyboard. A click on the dim curtain does not close it (what was typed is kept).
  Autofocus is left off so a phone's keyboard does not open over the form.

## Not in this module (so not here)

The assistant's card on the classic pages; the classic Security and Change-password dialogs the account menu also opens; the notification
that goes to the admin when the team has no CTO (its link is `/dashboard#notif`, which is the Notifications page in both portals).
