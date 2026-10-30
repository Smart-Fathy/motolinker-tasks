# Notifications — the classic portals and the new app

The bell in the header, its panel, the badge on the rail's Notifications item, the toast when one arrives, and the
Notification Center page: in both portals, from the module `apps/web/src/modules/notifications` (the data and the page), the
bell in `apps/web/src/app/shell/NotificationBell.tsx`, and the server's `src/modules/notifications` behind `/api/v1`.
The classic code stays where it is until the cutover; this is what it did and where each thing is held.

Test files named below: **S** `tests/notifications.js` (server), **P** `tests/notifparity.js` (look, value by value, in a real
browser), **E** `tests/webnotifs.js` (the real server, the built app, a real browser), **U** `apps/web/src/modules/notifications/`
(`model.test.ts`, `notifications.test.tsx`, `data.test.tsx`), **T** `apps/web/src/lib/toasts.test.ts` and
`apps/web/src/ui/ToastHost.test.tsx`, **F** `apps/web/src/legacy/LegacyFrame.test.tsx`, **M** `tests/embed.js`.

## What the server is asked

| Classic | New | Held by |
|---|---|---|
| `GET /api/<portal>/notifications` — the member's newest 50, newest first; unread counted among them | `GET /api/v1/notifications` — the same rows through the same service (`src/modules/notifications`); `{ items, unread }`; a database that cannot be asked is a 503 `unavailable`, not an empty list | S (the classic routes are characterised first and answer exactly as before after the move; v1 returns the same ids, order and count) · U (`notifications.test.tsx`: "shows how many are unread", "says there is nothing, and says when it cannot tell") · E ("says so in the panel…") |
| `POST /api/<portal>/notifications/read` `{ id }` — one of the member's; `{ all: true }` or no body — all unread of the member's | `POST /api/v1/notifications/read` — exactly one of `{ id }` or `{ all: true }`, anything else a 400 with `issues` | S (marks one / all, never another member's, the exact queries; the strict-body table; non-JSON, too large, charset; a live-only `tmp-…` id, or any id a bigint cannot hold, is nothing to mark and the database is not asked about it) · U ("reads them all when it is opened", "reads everything from its button, once…") · E ("…reads them all at once", "the database has them read") |
| Who may ask: the portal's own login only (`requireAuth` / `requireEmployeeAuth`) | Any signed-in actor; the member is `actor.key` (`admin`, `employee_<id>`) | S (nobody / unknown token / the other portal's login: 401, and a refused request changes nothing) · `tests/actor.js` (the matrix) |
| A failing database: the bell shows nothing, no error | The app can tell "nothing" from "could not ask": the panel and the page say "Notifications are unavailable right now." | S · U · E (see the decisions) |
| `GET /api/<portal>/notifications/stream` — `notification` events carry the stored row (`tmp-…` id when it could not be stored) | Stays as it is (it also carries huddle signals and the look); the app's session holds it and reads the `notification` event | S ("a notification created for a member reaches their open stream as a row the contract reads") · U (`data.test.tsx`) · E ("a notification written now reaches the open app…") |

## What the page does

| Classic | New | Held by |
|---|---|---|
| Loaded once at sign-in (`loadNotifs`) | Loaded when the app opens, and shared by everything that shows a count | U · E |
| `notification` event: put at the head, keep 50, count if unread, toast `title · body` | The same; a row already held is not added twice | U (`model.test.ts` "has a new one at its head…", "does not add one it already has"; `data.test.tsx`; `notifications.test.tsx` "what the live stream brings") · E |
| Toast: 4 s, fades in and out; admin's dark card with a gold hairline, team's `.emp-toast` | `ui/ToastHost`, one store per session | T · P ("live" state: the toast, both portals, both modes, four widths) |
| Team portal only: a `task` / `reminder` notification refreshes the task list and the log-hours dropdown | While the Tasks page is a frame of the classic page, the app tells the frame (`{ type: 'refresh', what: 'tasks' }`) and the page reads them again; when Tasks moves, the same event invalidates its query | F ("a task assigned to a team member…") · M ("your tasks changed…") · E ("a task assigned to a team member makes the classic Tasks page…") |
| Bell with a count (`99+` from 100), hidden at 0 | The same; the label says how many are unread | U ("says 99+ for a hundred") · `model.test.ts` (`badgeText`) · P ("closed") |
| Rail item "Notifications" with a count, hidden when the rail is narrowed to its icons | The same | U · P ("page": the item's badge; "narrowed": drawn or not, at every width) · E |
| Opening the panel reads everything at once (optimistic; the server is told once; nothing sent when nothing is unread) | The same | U ("reads them all when it is opened") · E |
| Panel: the newest 20, "View all" (closes, goes to the Notification Center), "Mark all read" (stays open); outside click closes | The same; Escape also closes | U ("lists the newest twenty…", "closes on Escape and on a click anywhere else", "takes 'View all'…", "marks all read from its panel…") · P ("open") |
| A click on a row: close the panel, mark that one read (nothing sent for a `tmp-` id), go to its page | The same | U ("a click on a notification") · `data.test.tsx` · E |
| Where a click goes: `#security` opens Security; a `#<page>` that is a page of the portal; else the type's page (the admin stays where they are when the type has none; the team goes to their hours); the two maps differ per portal | `routeOf(portal, url, type)` with the two maps as they were; a type that is the name of something every object has (`constructor`) is not a page | U (`model.test.ts` "where a click goes": every branch, both portals, every target a screen of the portal) · E (the team's Requests and Hours) |
| Titles lose leading emoji/symbols; times read `just now / Nm / Nh / Nd ago`, then the date; one icon per type | The same | U (`model.test.ts`) · P (`itemTitle`, `itemTime`, icon parts, words compared) |
| Notification Center page: heading, hint (the portals word it differently), "Mark all read", rows with an unread marker, the date at the right; read again when opened | The same | U ("the Notification Center") · P ("page") · E |
| Closing/sign-out: the page closes its stream | The session closes the stream with itself (nothing of one person's list can show to the next: the list lives in a per-session cache) | `webframe` ("leaving closes it…") · U (`notificationsKey` is per actor) |

## Look

`tests/notifparity.js` opens the classic page and the new app as the same person, in both portals, both colour modes and two
looks (the original and a loud one), at 390, 670, 800 and 1100 px, and compares the computed style of every named part —
the bell and its icon, the badge, the panel and its head and buttons, a read row and an unread row and their parts, the toast,
the page, its heading and button, its read and unread rows and their parts, the rail item and its badge — and the words in
them: well over 160,000 values, none different except the two named in the suite's `ACCEPTED` (the classic header's other
buttons sit beside the bell; the classic rail has a search box above its list).

## Decisions and deliberate differences

- **The count is counted from the list.** Classic keeps a separate counter that only goes up on a live notification and so
  drifts when the 51st-oldest unread one falls off the end of the list. The app counts what it holds. (`model.test.ts`: "has a
  new one at its head and the oldest gone once there are more than fifty", "marks all read, and counts only what is not".)
- **Opening the bell still reads everything at once.** It is how both portals behave; a redesign may keep the highlights
  until the panel closes. (Post-cutover backlog.)
- **The Notification Center says "Loading…"** for the moment before the first reading arrives; the classic page's markup says
  "No notifications yet" until its script has drawn something.
- **"Unavailable" is said.** Classic shows "No notifications yet" when the list could not be read. The v1 route says 503, so
  the app can say so. Retrying is the query's (two tries on a server error), and the Notification Center asks again when opened.
- **What the stream missed is asked for.** After the stream has been away, the list is read again; classic never did. The
  toast is for what arrives live, so what was read this way does not announce itself. (E: "the stream is away, and comes back".)
- **Rows can be used with the keyboard** (Enter / Space) and the panel closes on Escape; the toast is a status region. Classic
  was pointer-only.
- **A link that already speaks the new vocabulary** (`#leads` for the admin) lands on the right screen; classic ignored it and
  used the type's page. Nothing the server writes today does this.
- **v1 is strict where the classic routes were forgiving** (a body that is not one id or `all: true`; a body that is not JSON
  or is too large): a 400/413 in the one error shape `{ error, code, issues? }`.

## Not in this module (so not here)

The header's Help button and Refresh button, the refresh countdown and "last updated" (the classic admin header); the
`huddle-signal`, `open` and `workspace` events on the same stream (huddles come with Chat; the look is the session's);
Chat's own unread badges.
