# Submissions — the classic portals and the new app

What the public website's form sent us: a table of the newest two hundred, with the lead each one became, a Refresh button, and a
Delete button for whoever may clear them. In both portals, from the module `apps/web/src/modules/submissions` (the data and the
page) and the server's `src/modules/submissions` behind `/api/v1`. The classic code (`public/assets/procurement.js`, one script both
portals load, with each portal's page around it) stays where it is until the cutover; this is what it did and where each thing is held.

Test files named below: **S** `tests/submissions.js` (server), **P** `tests/subparity.js` (look, value by value, in a real browser),
**U** `apps/web/src/modules/submissions/` (`model.test.ts`, `submissions.test.tsx`, `data.test.tsx`), **A** `tests/actor.js` (who may
ask which route), **F** `tests/webframe.js` (the screen is the app's own page, not a frame).

## What the server is asked

| Classic | New | Held by |
|---|---|---|
| `GET /api/<portal>/submissions` — the newest 200 with the matched lead's name joined in; each row also carries `submitted_at` (the same moment as `created_at`) and `lead_name` | `GET /api/v1/submissions` — `{ items }`, the same rows through the same service (`src/modules/submissions`); a column the database left null is an empty string; a database that cannot be asked is a 503 `unavailable` without its own words | S (the classic routes are characterised first and answer exactly as before after the move; v1 returns the same ids, in the same order, asked of the database the same way) · U (`submissions.test.tsx`: "is asked of the server…", "lists what the website sent…") |
| `DELETE /api/<portal>/submissions/:id` — one row; deleting what is gone is ok | `DELETE /api/v1/submissions/:id` — the same; an id that is not digits is a 400, and the database is not asked about it | S (also: "deleting what is already gone is ok too") · U ("has Delete for whoever may clear them…") |
| Who may ask: the portal's own login, and in the team portal the `submissions` section (`view` to list, `delete` to delete) | Any signed-in actor with `submissions.view` / `submissions.delete`: the admin has both; a team member as granted | S (a reader is refused the delete; one without the section is refused both; nobody and an unknown token are 401, and a refused request changes nothing) · A (the matrix) |
| A failing database: the page shows the database's own words | The page shows what the route says ("Submissions are unavailable right now. Try again in a moment."); the database's words are never sent | S · U ("says why it could not be had…") |

## What the page does

| Classic | New | Held by |
|---|---|---|
| Opening the page asks for the list and shows "Loading submissions…" until it comes | The same, each time the screen opens (the list is never trusted to be fresh) | U ("is a loader until the server answers") · P (`loading`) |
| The table: Name · Lead · Email (a `mailto:` link) · Phone · Car Interest · Message (wraps, keeps line breaks) · Submitted (the browser's `toLocaleString()`) · Delete | The same; a lead's chip is `→ <lead name>`, a row with no lead shows a dash, as do an empty phone, car and message | U ("lists what the website sent…") · P (`table`: the table and its first three rows, cell by cell) |
| On a phone (≤ 700 px) each row is a card and each cell a labelled line (`mobile.css` turns every `.table-scroll` table into cards, using each cell's heading) | The cells carry their heading as `data-label`, and the same rules draw the cards | U ("labels each cell with its heading…") · P (390 and 670 px) |
| Nothing yet: "No submissions yet / Submissions from website forms will appear here." | The same | U · P (`empty`) |
| Refresh asks again and shows the loader while it waits | The same | U ("asks again when Refresh is pressed…") · P |
| Delete: a confirm ("Delete this submission?"), then the delete and a fresh list; "Delete failed" in an alert when the server would not | The same | U ("has Delete for whoever may clear them…", "does nothing when the person changes their mind", "says so when the server would not delete it…") |
| The Delete button is drawn for whoever has `submissions.delete` | The same, from the same capability | U ("is read-only for a team member who may read them but not clear them…") |
| The two portals head it differently: the admin's page title ("Form Submissions") and Refresh in a page header; the team's card title ("Website Submissions") with a line under it ("Enquiries the public website sent us.") | The same, per portal | U ("is headed as each portal's classic page is…") · P |
| An error: the message in a red box | The same, in the server's words | U · P (`error`: compared by look, not by words) |

## Look

`tests/subparity.js` opens the classic page and the new app as the same person, in both portals, both colour modes and two looks
(the original and a loud one), at 390, 670, 800 and 1100 px, in four states (a list, loading, empty, an error), and compares the
computed style of every named part — the page header and title, Refresh, the table and its head, a row's cells, the lead chip,
the mail link, Delete, the loader, the empty page — and the words in them: more than 125,000 values, none different.

## Decisions and deliberate differences

- **The lead's chip goes to the Leads screen.** The classic chip opened the lead's own profile in a drawer on the same page
  (`openLeadProfile`). The drawer is Leads', and Leads has not moved; the chip takes the person to Leads, where the profile opens.
  (When Leads moves, the chip opens the profile again.)
- **The assistant's card is not drawn.** The classic pages put the assistant's card at the top of this page; the assistant is its own
  batch. (`tests/subparity.js` hides it on the classic side.)
- **The chip is a `span` with `role="button"`** and answers Enter and Space: a `<button>` cannot be `display: inline`, which the
  classic chip is.
- **v1 is strict where the classic routes were forgiving** (an id that is not digits is a 400; the database's words are not sent);
  the error shape is the one every v1 route has, `{ error, code, issues? }`.

## Not in this module (so not here)

Leads, and the lead's profile (the chip's target); the assistant's card.
