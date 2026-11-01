# apps/web — the new MotoLinker web app

Vite + React 19 + TypeScript. It is built by `npm run build` (a type-check, then Vite) into `apps/web/dist`, and
**served by the Node server**, not by Vite: `src/routes/shell.js` sends `dist/index.html`, dressed with the workspace's
look, at `/dashboard` and `/employee` to a browser that has asked for the new app (`?ui=next`, remembered in the
`ml_ui` cookie; see the root README, "Looking at the new app"), and the hashed files under `/ui/`.

```
index.html          a template: its <head> is the classic pages' head, because the server finds its places in
                    it by exact text (src/http/spa-shell.js, src/lib/shell.js). tests/spashell.js fails if a
                    hook goes missing. Prettier leaves it alone for the same reason.
src/main.tsx        reads what the page was opened for (lib/arrival.ts), then mounts <App/>
src/app/            App.tsx (the gallery, or the product: signed out the sign-in, signed in a Session),
                    useMe.ts (who is signed in, from GET /api/v1/me; signing in and out),
                    Session.tsx (everything a signed-in person has: query client, api, theme, stream, router),
                    routes.tsx (where an address opens), nav.ts + nav-config.ts (the rail), access.ts (what a
                    person may open), registry.ts + define-module.ts (the screens that have moved),
                    Unported.tsx (the card a screen shows that cannot be framed, or did not open), context.tsx
src/app/shell/      the frame: Shell, Sidebar, Header, NotificationBell, BottomNav, icons, state (what it remembers), shell.module.css
src/legacy/         a screen that has not moved, shown as its classic page in a frame: LegacyFrame, bridge.ts (the
                    protocol with the page), frameable.ts (the screens a frame cannot hold)
src/sw/             the service worker: sw.ts (wiring), logic.ts (every decision, testable), shared.ts (what the
                    worker and the pages agree on); built to dist/sw.js by sw-plugin.ts
src/modules/<id>/   a screen that has moved: index.ts default-exports defineModule('<id>', { Page }); home, notifications, submissions, issues, meet, calendar, security, suppliers, rfq, purchaseorders, contracts, stock
src/columns/        the column editor every register-style table shares: how a saved list is read against a screen's own
                    columns, the menu behind a header, the Columns list, the dialogs, the inputs (model.ts, data.ts, useColumns.ts,
                    Layer.tsx, Fields.tsx)
src/docs/           what the document screens (RFQs, purchase orders, contracts) share: the answers' checks and the small
                    words (model.ts), the data (data.ts), the page, the lines grid, the supplier-catalogue picker, the viewer
src/auth/           the sign-in: SignIn.tsx (which step, and what carries between them) and a component per
                    step: PasswordStep, CodeStep (second step), ForgotStep, ResetStep; copy.ts holds every
                    line they say
src/ui/             the design primitives: Button, Field, Alert, AuthLayout, Modal (the team's dialog), Sheet (the shared
                    dialog both portals open their forms in), Form (a form's group, label and control), Btn (the in-page
                    button), BrandSelect (the dropdown), ToastHost (CSS Modules, in the `ui` layer)
src/gallery/        <portal>/__gallery: the primitives, the frame and the colours under any look (lazy chunk)
src/lib/            env.ts (what the server tells the page: window.__ML__ — the portal, the workspace's name
                    and its replaced wording), session.ts (the token, under the classic portals' own keys),
                    api.ts (authed calls, GET /api/v1/me and the check of its answer), auth-api.ts (the sign-in
                    routes, read into results a screen can act on), arrival.ts (Google's return and the reset
                    link), query.ts (the data cache), sse.ts (the live stream), toasts.ts (the small messages), theme.ts (the look and the
                    colour mode while the app is open), pwa.ts (the worker, from the page's side), throttle.ts
src/styles/         base.css: the layers and the classic portals' design tokens with the values they ship;
                    portal-team.css: where the team portal's sheet starts from something else
src/types/          the types of the one plain-JS file the app imports from the classic side (theme-core)
src/test/           helpers the tests share
```

## Signing in

`src/auth/` does everything the classic sign-in screens do, for both portals, and nothing the server has not
always answered:

- **Password.** `POST /api/auth/login` (admin) or `/api/employee/login` (team). The answer is a session, or a
  challenge when the account has a second step (`mfa_required`), or a refusal in the server's own words (wrong
  password, a rate limit with its wait, a database that is coming back). A session that comes with a challenge,
  or a challenge that comes with nothing to answer it with, is never a sign-in.
- **Second step.** The six digits of the authenticator app, or a recovery code (the link under the field
  switches, and the label, keyboard and example follow). A wrong code stays on the step with the same
  challenge; a challenge that has run out or been tried too often (`expired: true`) sends the person back to the
  password, with the server's words and their username still typed.
- **Team only.** "Forgot password?" (an address; the same words whoever it belongs to), the new-password form
  the link in the email opens (8 characters, twice, checked before the server is asked), and Google: a link
  to `/api/employee/auth/google`, whose return lands as `?emp_token=` (a session), `?mfa_token=` (a second step
  to take) or `?google_login_error=` (a refusal). `lib/arrival.ts` reads those, and `?reset=`, once, before
  React renders, and takes them out of the address bar. The admin portal ignores all four.
- **Never signed out by an outage.** Nothing but a "no" about the token itself (`401` from `/api/v1/me`) ends a
  session. A server that is down, slow or unreadable leaves the person signed in and says so, with a button to
  try again. Signing out tells the server, but does not wait for it. The same holds once the app is open: a call
  that comes back `401` makes the app ask `/api/v1/me` again (at most once in five seconds), and only that answer
  signs anyone out.
- **One send.** A submit while one is on its way sends nothing (a ref, not only the disabled button: a second
  submit can arrive before the page has drawn the first).

`tests/webauth.js` runs all of this against the real server and the built app; the unit tests (`SignIn.test.tsx`,
`App.test.tsx`, `auth-api.test.ts`, `arrival.test.ts`) answer from scripts.

## The frame

`app/shell/` is one component for both portals (`portal` says which): the rail, the top bar, the phone's bottom
bar, and the content outlet. The admin has the classic sidebar (groups that open and close, the footer with the
classic portal, Security and Sign out); the team has the classic rail with its brand block, the account menu (behind a
person's own face: picture, name and username, status, Report an issue, Change password, Security, the classic portal, Sign out)
and the bottom bar on a phone. The frame owns its panels (`useFrame().open('security' | 'report' | …)`): one is open at a time. The parts carry
`data-part` / `data-screen`, which the suites find them by.

- **Which screens, and who gets them** is the contracts package's, not the app's: `@motolinker/contracts/modules`
  holds the catalogue of screens (30 of them), what each needs (`always`, a section, a capability, any of several,
  or the admin), how each portal's rail groups and orders them (`NAV`, `BOTTOM_NAV`), and what the classic portals
  called each. `allows(actor, screen, flags)` is the one answer. Whatever the classic portal's own code shows or
  hides for a person, the catalogue says the same: `tests/modules.js` slices that code out of
  `public/assets/employee.js` and runs it over the permission corpus. `GET /api/v1/me` carries the `flags` a rule
  can need (`gchat`: Google Chat is configured on this server).
- **The arrangement** an admin saves for the sidebar (names, which group a screen sits in, hidden screens and
  sections) is read from the same place the classic portals read it (the portal's own `nav-config`:
  `/api/dashboard/nav-config`, `/api/employee/nav-config`) and applied by `buildRail` the way the classic
  `applyNavConfig` does: a rename and a move are followed, a screen the arrangement does not mention goes to the
  end, a group it does not mention comes after, an empty group is not drawn, and a hidden screen is hidden. An
  arrangement can only take screens out of a rail, never put one in front of someone who may not open it.
- **What it remembers** is what the classic portals remember, under their keys: the collapsed rail
  (`ml_admin_sidebar` / `ml_emp_sidebar`), the open groups (`ml_admin_navgroups` / `ml_emp_navgroups`) and the last
  page (`ml_page` / `ml_emp_page`, in the classic portals' own page ids), so a person who moves between the two
  finds each where they left it.
- **Where an address opens** (`app/routes.tsx`): a link that already exists in the world first
  (`@motolinker/contracts/deeplinks`: `/employee#requests` is `/requests`, `?chat=<room>` is `/chat/<room>`, and
  every link the server and the service workers write into notifications resolves to a screen of the portal it is
  for — `tests/modules.js` finds them in the source); otherwise the page the person was last on, if they may still
  open it; otherwise Home. An address
  for a screen the person may not open, or that belongs to the other portal, is Home.
- **A screen that has not moved** is in the rail all the same and opens as the classic page itself, in a frame
  under the app's rail and bars (see "Screens that have not moved" below). Home, Notifications, Submissions and Issues are the
  screens built so far; Home shows who is signed in and what they may do, which is the thing to check a grant against.
- **What it does not have yet**, named in `tests/shellparity.js` (`ACCEPTED`, each with its reason; one that stops
  differing fails the suite so the list cannot go stale): the search box and shortcuts above the rail, Arrange and
  the workspace settings in the footer, and the header's refresh countdown and help button. They arrive
  with their screens.
- **A deliberate difference:** when an admin hides a whole section of the sidebar, the classic admin portal hides
  it, but the classic team portal draws it again for anyone who holds a screen in it (it redraws every heading from
  the screens left after applying the arrangement). The new rail does what the admin asked, for both portals;
  `tests/webshell.js` pins it.

`tests/shellparity.js` opens the classic portal and the new app in a real browser, signed in as the same person,
in both modes and two looks, at four widths, and compares the computed style of every named part; then it collapses the
rail (the button on each side, clicked) and compares what the rail draws again, at the widths a rail can be collapsed
at (from 901px for the admin, 769px for the team). `tests/webshell.js` runs the frame on the real server and compares
the rail with the rail the classic portal's own code draws for the same person (the admin, and three team members with
different grants, with and without an arrangement saved).

## Screens that have not moved

`legacy/LegacyFrame.tsx` shows a screen the app has not rebuilt as the classic page itself: an `<iframe>` of
`/legacy/<portal>?embed=1#<page>` (and `&safe=1` in safe mode). The page is the real one, with its own code, over the
same session and the same server, so every item in the rail opens something real while the screens move one at a
time; each one that moves is deleted from the classic side in the same commit.

- **The page is a guest.** `?embed=1` makes the server dress the classic page for a frame (`src/lib/shell.js`):
  `<html data-embed="1">`, the bridge `public/assets/embed.js` right after the early theme script, and
  `public/assets/embed.css` before the workspace's look — no sidebar, no top bar, no bottom bar, no sign-in screen (the app
  draws the first three and does the last). The classic scripts read the same attribute and **skip what the app now
  does for every screen**: the service-worker registration (the scope is the app's), push, the notification stream,
  the presence heartbeat, a huddle revived on load, the assistant, and the sign-in and 401 handling (a dead session is
  told to the app instead). What stays is what a screen needs: the one-off list reads, page-level streams (a chat room,
  the Google Chat poller, WhatsApp) and auto-refresh. `tests/embed.js` holds all of it, both portals, every guard
  mutation-tested; a page opened with `?embed=1` outside a frame is exactly the page it was.
- **The conversation** (`legacy/bridge.ts` ↔ `public/assets/embed.js`) is `{ ml: 'embed', v: 1, type, … }`. The page
  says `ready{page}` once, first, then `navigated{page}` whenever the person moves about inside it (with a `lead` when a
  lead's page sent them on to make a document for that lead: the app opens `/rfq?lead=<id>`), and `unauthorized`
  when a call came back 401. The app says `navigate{page}` (a click in the rail: the page moves, it is not reloaded)
  and `look{profile}` (the admin saved a new look). Each side hears only the window that framed it, from its own origin,
  and answers with its own origin as the target.
- **One frame serves the screens that follow it.** The first screen opens the frame; the rest are asked of the page.
  What the person does inside it is followed: a page it moves to is the screen the address names (safe mode kept), the
  browser's back button asks the page for the screen before, a page that reloads itself is taken back to the screen the
  person is on, and a dead session is the app's to settle (`recheck`: it asks the server who this token is, and signs
  out only if the server says so).
- **Leaving for Google.** A "Connect Google Drive / Email / Calendar / Chat" button sends the window to Google's consent
  screen, which refuses to be drawn in a frame; in a frame those buttons send the app's own window (`goOut` in the classic
  scripts), and the callback brings it back to `/dashboard#<screen>`, which the app opens as that screen.
- **It never stays blank.** The page is drawn only when it has said it is up; after 20 seconds without that, the frame
  gives way to a card — "did not open here", with Try again and a link to the classic portal.
- **What cannot be framed** (`legacy/frameable.ts`): the live chat (a connection and a call that belong to the app's
  own chat, not a second copy). It is a card that says why and links to the classic page that has it.
- **Known limits while screens are moving**, each gone with the batch that rebuilds the thing: presence, the notification
  stream and bell, push subscription (an existing one is kept alive by the app; offering one is a screen's job),
  huddles and the assistant do not run in the app yet, because the classic scripts stand down in a frame and the app
  does not have them. The classic portal is one click away (`?ui=legacy`) for all of those.

## The service worker

`src/sw/sw.ts` is built beside the app (`sw-plugin.ts` runs a second Vite build after the first, handing the worker the
list of files the app's first load is made of) and served as `dist/sw.js` at `/sw-ui-dashboard.js` and
`/sw-ui-employee.js` — one script, whose address tells it which portal it is for. It holds the portal's own scope
(`/dashboard`, `/employee`), the same one the classic portal's worker holds: whichever portal's page was opened last is
the one in charge, and they take turns without either touching the other's caches (`tests/webpwa.js`).

- **A start without a network.** At install it keeps the entry script and style (and what they import at once) and the
  portal's page; every other file of the app (a screen's chunk, an icon) is kept the first time it is used, cache first,
  because their names carry a hash of their content. The page is network-first, so a new build arrives with the next
  open; the last one kept stands in without it, and is kept only if the server labelled it as the app's
  (`X-ML-UI: next`), whole, and not the original-look page (`?safe=1`).
- **Never the API, never the classic pages.** Nothing under `/api/` is answered by the worker, and the classic pages
  shown in the app's frame live at `/legacy/…`, outside its scope.
- **A new build is found and taken at once**, without a reload and without a prompt: the install is `skipWaiting`, the
  activation `clients.claim()` and deletes only the older builds of its own cache family (`ml-ui-<portal>-<build>`).
  A page left open asks for a newer worker when it comes to the front (at most every 30 minutes, `lib/pwa.ts`); a page
  that was open while a new build went out and asks for a file that is no longer there reloads itself once (Vite's
  `vite:preloadError`), never in a loop.
- **A push** is shown with the words it came with; a tap on it takes an open app to the screen it names
  (`useWorkerMessages`: the worker posts `{ ml: 'sw', type: 'open', url }`, the app resolves it with the same deep-link map as
  everything else) or opens one. The app tells the server again about a push subscription this browser already has, as the
  classic pages do each time they open; it never asks for permission.
- **The exits.** `?ui=legacy` puts the classic portal back (its page registers its own worker, which replaces this one in
  the scope), and a worker that cannot be had is the app without one. The classic workers delete only their own caches
  (`motolinker-dash-…`, `motolinker-emp-…`) and do not keep the app's page.

## Screens

A screen is in the catalogue (contracts) first; the app adds only its page. To move one in:

```ts
// src/modules/leads/index.ts   (the directory is the id: the app refuses to start if they disagree)
import { lazy } from 'react';
import { defineModule } from '../../app/define-module';
export default defineModule('leads', { Page: lazy(() => import('./Leads')) });
```

`app/registry.ts` finds every `modules/*/index.ts`; nothing else lists them. `defineModule` throws for an id that
is not in the catalogue. Who may open the screen, where it stands in the rail and what the classic portal called it
are not repeated here: the rail, the route guard and the deep links all read the catalogue. A screen reads the
session with `useSession()` (the person, the portal, the api, the theme) and its data with TanStack Query.

## Live data

- **`lib/api.ts`** — `makeApi(token)`: Bearer calls, `ApiError` (status 0 means the server could not be reached),
  and a `401` from anything is handed to `onUnauthorized` (see "Never signed out by an outage").
- **`lib/query.ts`** — one TanStack Query client per signed-in session (a new sign-in gets a new one, so nothing one
  person fetched can show to the next). A failed call is asked again only when the server could not be reached or
  fell over (at most twice); a "no" is not repeated.
- **`lib/sse.ts`** — the live stream, read with `fetch` rather than `EventSource`: the session travels in a header (the
  classic portals put it in the address, where logs and history keep it) and what happens when the stream drops is
  decided here. A `401`/`403` ends it and says `unauthorized`; nothing else does — a server that is down or
  restarting is waited for, with a pause that grows from 1 to 30 seconds (±20%, or the server's own `retry:`),
  coming back at once when the browser says it is online or the tab comes forward. A stream that goes quiet for 70
  seconds (the server speaks every 25) is replaced, and the last event id seen travels with the next attempt
  (`Last-Event-ID`). `Session` opens it on `<portal>/notifications/stream?hd=2` and applies the `workspace` events.

## The look

"Same look first": until the redesign a person switched to the new app sees what they saw. The two classic
portals' sheets are not the same sheet (the team's has a different radius, three different token defaults, a
sign-in card of a different structure, and breaks for small screens at 700px where the admin's breaks at 640 and
700), so the app has both: the server writes `<html data-portal="admin|team">` and `portal-team.css` starts the
team from its own values.

- Component styles are CSS Modules in `@layer ui`; `base.css` declares `@layer reset, base, ui`. The server's
  `<style id="ws-theme">` (the workspace's look) is not in a layer, so it wins over all of it whatever the
  specificity. The layers rank in the order they are first named in the built sheet, which is the import order
  in `main.tsx`: `base.css` first (`tests/spashell.js` checks the built sheet).
- Tokens are the classic sheets' values, held to them by `src/styles/tokens.test.ts` (CSS takes a token's LAST
  declaration, and so does the test).
- `tests/signinparity.js` opens the classic page and the new app in a real browser, puts both through every step
  of the sign-in, and compares the computed style of every part of the card — about 10,000 values — for both
  portals, in both modes, at 390, 670 and 1100px. It fails on any difference that is not named in `ACCEPTED` (each
  with its reason), and on an accepted one that stopped differing. It goes with the classic page.
- The words are the classic pages' (`src/auth/copy.ts`). The lines an admin can replace in the Workspace editor
  reach the app in `window.__ML__.workspace.texts` (the classic pages are dressed by markers in their HTML; this
  app draws its own text); `{ws}` is filled in with the workspace's name.

**While the app is open** (`lib/theme.ts`, the same rules as `public/assets/workspace.js`, so a person moving between
the two sees one behaviour):

- the server wrote the first paint; a look the admin saves arrives over the stream (`workspace`) and is applied at
  once by the same code that wrote it — `public/assets/theme-core.js`, imported into the app through the Vite alias
  `@theme-core` rather than copied (about 9 kB gzipped). A profile older than the one being worn is not worn, and
  neither is one from a database that did not answer;
- a person's own choice of dark, light or automatic (`ml_mode`, shared with the classic portals in this browser)
  wins when the workspace lets people choose; it is sent to the server (`/ui-prefs`) so it follows them to
  another device, and `auto` follows the system as it changes;
- `?safe=1` wears the original look whatever is saved: the name and picture still apply, the look and the mode
  choice do not, and the colour button is not offered. It is the way back in if a look ever makes the screen hard
  to use, and it is carried along when an address is sent to the classic page.

## Notifications

The first screen with a shell part of its own (`src/modules/notifications`, the bell in `app/shell/NotificationBell.tsx`; what
the classic portals did, row by row, and where each is held, is `docs/parity/notifications.md`).

- **One list.** `data.ts` reads `GET /api/v1/notifications` into the session's query cache under `['notifications', actor.key]`;
  the bell, the rail's badge and the Notification Center all read that one list, and how many are unread is counted from it.
  Reading one or all changes the list at once and tells the server after (and asks the server what is true if it will not
  take it); `Shell` calls `useLiveNotifications()` so the stream's `notification` events go to the head of the list, up as a
  toast, whichever screen is open — and so the list is read again when the stream comes back from a gap.
- **Toasts** are `lib/toasts.ts` (a store per session, on `useSession().toasts`) drawn by `ui/ToastHost`. Anything may
  `toasts.show(text)`.
- **Where a click goes** is `routeOf(portal, url, type)` in `model.ts`: the two portals' maps are kept as they were.
- **A task for a team member** while the Tasks screen is still the classic page in a frame: the frame is told
  (`{ type: 'refresh', what: 'tasks' }`, `legacy/bridge.ts`, handled in `public/assets/embed.js`) and the page reads its tasks
  again, as it did when it held the notification stream itself. When Tasks moves it will invalidate its own query instead.
- Tests: `model.test.ts` (the guards held to the schemas in contracts, the wording, every branch of the routing),
  `notifications.test.tsx` (the whole feature in a session against a script), `data.test.tsx` (the live hooks against a
  stream the test controls), `lib/toasts.test.ts`, `ui/ToastHost.test.tsx`; `tests/notifparity.js` (look) and
  `tests/webnotifs.js` (the real thing).

## Submissions

What the website's form sent us (`src/modules/submissions`; row by row, `docs/parity/submissions.md`). `data.ts` reads
`GET /api/v1/submissions` each time the screen opens and deletes through `DELETE /api/v1/submissions/:id`; the page is the
admin's page header and the team's card title around one table, and on a phone each row is a labelled card (the cells carry
their heading as `data-label`, which is what the classic `mobile.css` reads). Delete is drawn for whoever has
`submissions.delete`. Tests: `model.test.ts` (the guards held to the schemas in contracts), `submissions.test.tsx`,
`data.test.tsx`; `tests/subparity.js` (look) and `tests/submissions.js` (the routes).

## Issues

The Chief Technical Officer's centre (`src/modules/issues`; row by row, `docs/parity/issues.md`): a queue with All / Open /
Resolved chips, the ticket beside it, its conversation, a reply box, and Mark solved / Reopen for whoever has `issues.resolve`.
It is the classic **team** page, and the **admin portal now has it too** — `packages/contracts/src/modules.js` marks the screen
`fresh` for the admin: new to that portal, with no classic page behind it. That mark is how everything that speaks of classic pages
leaves it out and how the app is held to drawing it: `tests/modules.js` and `tests/webshell.js` leave it out of the comparison with
the classic rail and check that the classic page really does not have it, `registry.test.ts` checks that a module exists for it, the
shell does not remember it as the admin's last page, and `classicUrlFor` sends its address to the portal's front.

- **Report an Issue** is `ReportIssue.tsx`, opened from a button at the foot of the team's rail and a line in the team's account
  menu (the shell owns the open/closed state; the admin has neither). It checks a report before it asks (words, 10 MB) and
  posts a form to `POST /api/v1/issues` through `api.postForm`. The dialog is `ui/Modal.tsx`: a portal over the page, a modal
  dialog with a name, Escape closes it, focus goes in, stays in while Tab is pressed and goes back out, and a click on the curtain
  does not close it.
- **Data.** The queue is `['issues', actor.key, 'list']`, a ticket's replies `['issues', actor.key, 'comments', id]` (separate, so
  that closing a ticket does not read the replies again). Closing or reopening puts the ticket the server returned in the queue;
  a reply asks for the replies again. A queue already in hand is kept when asking again fails.
- **Links** to a ticket's file open only where a browser should follow them (`fileHref`).
- Tests: `model.test.ts`, `data.test.tsx`, `issues.test.tsx`, `report.test.tsx`, `ui/Modal.test.tsx`; `tests/issparity.js` (look),
  `tests/webissues.js` (the real thing), `tests/issues.js` (the routes).

## Meet and Calendar

The meetings scheduled with the team and the company's calendar (`src/modules/meetings` and `src/modules/calendar` on the server;
row by row, `docs/parity/meet.md` and `docs/parity/calendar.md`). Both portals have both pages.

- **Meet** (`modules/meet`): the two cards, the upcoming meetings (`GET /api/v1/meetings`, read each time the screen opens), and the
  sheet that schedules, changes and cancels them (`POST`, `PUT`, `DELETE`). Whoever has `meet.schedule` has the buttons; a person
  without `meet.view` gets the cards and no list, and the app does not ask for one. `useScheduling()` is what the Calendar uses too:
  `open(meeting | null, { date })` asks for the people to invite and the chat rooms to hold a huddle in (the classic routes: there are
  no v1 routes for them yet), then opens the sheet. A meeting stored, changed or cancelled drops every calendar window
  (`['calendar', actor.key, …]`) as well as the list (`['meetings', actor.key, …]`), so the Calendar is right without a reload.
- **Calendar** (`modules/calendar`): a month or a week (`GET /api/v1/calendar?from=&to=`; the window last had stays on show, as
  `placeholderData`, while the next is on its way), the legend, the grid with the first three things on a day and "+N more", the
  day's sheet and a meeting's. A task goes to Tasks and a follow-up to Leads. The admin's page also shows whether new tasks are being
  added to a Google Calendar (`/api/calendar/status`, `disconnect`, and `connect` which leaves the app, carrying the session in the
  address). A page that pads itself says so with `data-flush`, and the shell then does not pad it.
- **Sheet, Btn, BrandSelect** (`ui/`): the shared dialog of the classic portals, their in-page button, and their dropdown (a button
  and a floating panel, which the classic pages make by swapping every `<select>` at run time). `useDialog` is the focus handling
  `Modal` and `Sheet` share. The dropdown's Escape closes the dropdown and not the dialog it is in; an option that cannot be
  chosen is not chosen.
- Tests: `meet/model.test.ts` and `calendar/model.test.ts` (the guards held to the schemas in contracts), `meet.test.tsx`,
  `calendar.test.tsx`, `ui/Sheet.test.tsx`, `ui/BrandSelect.test.tsx`; `tests/meetparity.js` and `tests/calparity.js` (look),
  `tests/webmeet.js` (the real thing), `tests/meetings.js` and `tests/calendar.js` (the routes).

## Security and the account menu

The panel that holds two-factor authentication, the devices an account is signed in on and its recent sign-ins, and (team) the picture,
username, status and password behind a person's own face (`src/modules/security`; row by row, `docs/parity/security.md`). Both
portals have the panel; the account menu is the team's. The server side is not new — one handler already served both portals'
Security, and the picture, status, username and password routes have no twin — so the app calls them as they are
(`/api/employee/security…`, `/api/dashboard/security…`, `/api/employee/{avatar,status,username,change-password}`).

- **A panel, not a page.** Security is `panel: true` in the catalogue: in no rail, never where somebody "was" or starts. The profile menu,
  the admin's footer and `/security` (what a notification's `#security` and an alert email's link become) all ask the frame for it
  (`useFrame().open('security')`); `/security` opens it over the page the person was last on and puts the address back. Shell keeps
  which panel is open (report an issue, security, status, username, password): one at a time.
- **`SecurityPanel`** is the classic overlay (`security.module.css` is `public/assets/security.js`'s stylesheet, rule for rule): the
  overview is read when it opens and again after anything that changes it; each view (`views.tsx`) holds what is typed in it and the
  panel (`SecurityPanel.tsx`) decides what is done with it, one question at a time (a slow answer is not asked twice, and the button
  says what it is doing). A wrong password or code is the server's 403, said in the panel; **only a 401 can end a session**, and that
  is the app's to settle, so the panel says nothing of it. The recovery codes are shown once and **Done** waits until they are
  saved. After anything that signs the other devices out the app tells the server about this device's push subscription again.
- **`model.ts`** holds the checks on each answer (held to the schemas in `packages/contracts` by `model.test.ts`: the bundle does not
  carry zod) and the small words — "3 h ago", the ways to sign in, a key in groups of four, what Copy and Download give.
- **The account** (`account.ts`, `AccountDialogs.tsx`, the menu in `app/shell/Header.tsx`): the picture is chosen from the device
  (an image of 5 MB or less) and shown at once; the status has four presets; the username's refusal is said in its dialog; a new
  password says how many other devices were signed out. What a person has just changed is shown at once
  (`useSession().updateProfile`) and replaced by the server's word the next time it is asked (`/api/v1/me` carries the employee's
  `profile`).
- **`ui/Modal`** takes a `width`, a `head="plain"` (a smaller title and no ×, for the dialogs that never had one), a `hintGap`
  and `loose` (no gap between its parts, no foot of its own), for the account dialogs.
- Tests: `model.test.ts`, `security.test.tsx` (the panel: every view, state and refusal), `account.test.tsx` (the menu and its
  dialogs); `tests/secparity.js` and `tests/acctparity.js` (look), `tests/websecurity.js` (the real thing), `tests/account.js` (the
  routes and the answers' shapes).

## Suppliers and the column editor

`modules/suppliers` is the register behind the supplier pickers of the RFQ, purchase-order and stock screens; `src/columns` is the
column editor that comes with it and that every register-style table will share. Both portals have both; what a person may do is
the grants (`suppliers.view|create|edit|delete|catalogue|docs|purchases`), and what they may not do is not drawn.

- **The data** (`modules/suppliers/data.ts`) is the portals' own routes (`/api/dashboard/…`, `/api/employee/…`, which are one handler
  for both) read through the session's `api.base`: the register, the two lists a card's figures come from (`supplier-vehicles` and
  `stock` — they belong to other sections, so a refusal is a dash on the card, never a zero), a supplier's catalogue, documents and
  purchases, and the writes. The register is asked for each time the screen opens and again after every change; an answer is
  checked (`model.ts`, held to the schemas in `packages/contracts` by `model.test.ts`: the bundle does not carry zod) and one that
  is not what it should be is said, not drawn.
- **The register** (`Suppliers.tsx`): cards or a table (`ml_sup_view`, the classic page's own key), the count line, the form
  (`SupplierForm.tsx`), and a supplier's pages in a wide sheet (`Detail.tsx`: *Vehicles*, *Documents*, *Purchases*, each a grant).
  A form is made of the register's own columns, in the order, names and types the administrator gave them; **what it does not show
  it keeps** (a hidden column's value and an added field that is not on the form are sent back as they were). A catalogue cell saves
  the whole vehicle, for the same reason.
- **The engine** (`src/columns`): `useColumns(entity, builtins)` reads the saved list (`GET …/columns/:entity`, `null` where nothing
  was arranged) against the screen's own columns and offers what the editor does to it; a screen draws from `columns.shown`,
  puts `<ColumnsBar>` over its table, `<ColumnHeader>` in its head and `<ColumnsLayer>` anywhere in its tree. Only the administrator
  may change a list (the server refuses everyone else, so nobody else is offered the controls); each change is one PUT of the
  whole list, and one that is not kept is said and taken back. `model.ts` holds the rules as plain functions — merging, renaming,
  moving, hiding, deleting, a dropdown's options, a link, a badge — and `model.test.ts` runs each of them **against the classic
  engine on the same lists**. The editor's dialogs are their own layer above whatever is open (a sheet being filled in), close back
  to it on Escape or a press on the curtain, and keep Tab among themselves.
- Tests: `model.test.ts` (both modules), `suppliers.test.tsx` and `columns.test.tsx` (every state, grant and refusal);
  `tests/supparity.js` (look), `tests/websuppliers.js` (the real thing), `tests/suppliers.js` (the routes, both portals).

## RFQs and purchase orders

`modules/rfq` and `modules/purchaseorders` are the two documents sent to a supplier; `src/docs` is what they share (and what the
contract screen shares too, below). Both portals have both; what a person may do is the grants (`rfq|purchaseorders` + `view|create|edit|delete|export`).

- **The data** (`docs/data.ts`) is the portals' own routes through `api.base`: a kind of document is a `DocSpec` (its path, its noun,
  the checks of its answers), and one set of hooks serves both — `useDocList` (the list, again after every change), `useDocStart` (the
  record being edited, or the starting form of a new one — asked afresh each time, `?customer_id=` where a lead is named),
  `useDocWrites` (save: the server's words on a refusal; delete: said in a notice), `buildXlsx` / `buildPdf`, `useLeads` (the
  administrator's customers, a team member's own leads) and `useOfferLoader` (the supplier catalogue, asked when the picker opens).
  The checks (`model.ts`) are held to the schemas in `packages/contracts` by `model.test.ts`.
- **The screens** open at once and say what they are waiting for: the list has a loader whenever it is being read, the form's sheet
  is there before the starting form is (a record that cannot be had is said in it, with only *Cancel*). `?lead=<id>` on the address
  (`docs/useLeadParam.ts`) opens a new document made from that lead, once, and cleans the address.
- **The form** (`RfqForm.tsx`, `PoForm.tsx`) is made of the columns the administrator arranged for the document (`rfq_doc`,
  `po_doc`: its status and the fields added to every document) and for its lines (`rfq_items`, `po_items`): a grid by `docs/Lines.tsx`
  whose cells are the form's own, so that **what the grid does not show is kept** (each line is saved as it was with what the grid
  shows put over it, and the added fields are merged over the document's). A line made from the supplier catalogue carries the
  vehicle's words; a purchase-order line begins as the first status the administrator left.
- **The workbook and the PDF**: an RFQ is handed to the browser as `RFQ_<number>.xlsx` (a row's *Excel*, or *Save & export Excel*); a
  purchase order opens in `docs/Viewer.tsx` — at once, with "Rendering PDF…", the PDF in a frame when it is made and the reason in
  its place when it cannot be — and is given back when the viewer closes.
- **The lead's drawer** of the classic Leads page (still framed) hands the lead over through the embed bridge, so *RFQ* and
  *Purchase Order* there open the new screens' forms made for that lead.
- Tests: `docs/model.test.ts`, `data.test.tsx`, `docs.test.tsx`, `modules/rfq/rfq.test.tsx` and
  `modules/purchaseorders/purchaseorders.test.tsx` (every state, grant and refusal); `tests/docparity.js` (look),
  `tests/webdocs.js` (the real thing: real workbooks and PDFs), `tests/rfqpo.js` (the routes, both portals).

## Contracts

`modules/contracts` is the Arabic car-sale contract, on the same `src/docs` pieces as the two documents above (a `DocSpec` for
`contracts`, the list and start hooks, the page, the viewer). Both portals have it; what a person may do is the grants
(`contracts` + `view|create|edit|delete|export`).

- **The form** (`ContractForm.tsx`) is the blanks of the paper contract — the blocks and fields are `CONTRACT_SECTIONS` in
  `packages/contracts/src/documents.js`, which `tests/contractdocs.js` holds to what the contract prints — each a text box bound to a
  dotted path of the contract's `data` (`buyer.name`). `modules/contracts/model.ts` is the rules, as pure functions: where a blank
  lives (`getPath`/`withPath`), what a contract on the older wording is offered besides (`blocksOf`), the payment lines (`payRowsOf`,
  `fixedPaysOf`), what the data is once the form is done with it (`dataOf`: **what the form does not show is kept**, the lines are
  exactly the rows on screen, the contract's own number goes inside it) and what picking a lead puts in the buyer's block (`withLead`).
- **The lines**: a car-sale contract's payment lines are the person's to add and take away (a new one begins with the standing
  wording); a contract on the older wording keeps its lines and offers only their amounts.
- **The PDF** is `docs/Viewer.tsx` in its `contract` variant for the administrator (the classic *Contract Preview*) and the portal's
  document viewer for the team (the classic team page had no working preview); it opens at once, says why when a contract cannot be
  made, and is given back when it closes. *Save & preview PDF* shows the contract that was saved without asking for it again.
- **A won deal's contract** is drafted by the server; the list marks it **auto**. **The lead's drawer** of the framed classic Leads
  page hands its lead over (`window.mlEmbed.forLead`), so *Contract* there opens the new screen's form made for that lead.
- Tests: `modules/contracts/model.test.ts` and `contracts.test.tsx` (every state, grant and refusal); `tests/ctparity.js` (look),
  `tests/webcontracts.js` (the real thing: real PDFs), `tests/contractdocs.js` (the routes, both portals).

## Inventory & Logistics

`modules/stock` is two tabs on one screen, in both portals: **Models** (the register of cars) and **Tracking** (the containers on the
water). What a person may do is the grants (`stock` + `view|browse|create|edit|tracking`: browse reads the register, create and edit
change it, tracking opens every container route); deleting a model, deleting a box and the CSV are the administrator's.

- **The data** is the portals' own routes through `api.base`. `data.ts` is the register: `useStock` (asked each time the screen
  opens and after every change; the page gives way to the loader while it is) and `useStockWrites` (save: the server's words on a
  refusal; delete; the CSV). `containers.ts` is the board: `useContainers` and `useContainerWrites` (look-up, register, save, delete,
  refresh, link and unlink a car, the test of the carrier key, and `cars()` — the cars of the register that have a VIN, which is how a
  car is put in a box). The checks on every answer (`model.ts`, `tracking.ts`) are held to the schemas in `packages/contracts` by
  `model.test.ts` and `tracking.test.ts`; the lists both ends share (a box's states and sizes, the check on its number) are
  `@motolinker/contracts/logistics`.
- **The Models tab** (`Models.tsx`, `ModelForm.tsx`, `CsvSheet.tsx`): the pure rules are `model.ts` (a row for each car, the figures
  over them, searching, the grouping by supplier, a status by its label and colour, the remembered view) and the form's rows are the
  **column engine's** (`entity` `stock`): the eight fixed columns plus the ones the administrator added, and **what the grid does not
  show is kept**.
- **The Tracking tab** (`Tracking.tsx`, `ContainerCard.tsx`, `ContainerForm.tsx`, `LinkSheet.tsx`, `Diagnosis.tsx`): the pure rules
  are `tracking.ts` (the number's cleaning and check digit, how far along its leg a box is, how old a fix is, the sentence that says
  why a box is not tracked, what a refresh and a registration came to, the box form's fields to and from the carrier's words). The
  **map** (`TrackMap.tsx`, `leaflet.ts`) is Leaflet from a CDN, loaded once the first time a card with a fix is drawn; where it does not
  come the card says where the ship is and gives a link.
- **Phone**: a table is a card for each row (the classic `mobile.css`), labelled from its own heading; the page's head and tabs take
  the sizes of the classic phone sheet.
- Tests: `modules/stock/model.test.ts`, `tracking.test.ts`, `hooks.test.tsx` (what both tabs ask of a fake server, the words
  of each thing that goes wrong, and the Tracking tab drawn with and without its grant), `stock.test.tsx` and `tracking.test.tsx`
  (every state, grant and refusal); `tests/stparity.js` (look: both tabs, the forms and the CSV sheet, both portals),
  `tests/webstock.js` (the real thing), `tests/stockroutes.js` and `tests/containerroutes.js` (the routes, both portals).

## My Drive and My Sheets

`modules/drive` and `modules/sheets` are one page over two lists, in both portals, and are only the list they are: everything else is
`src/google`, which they share. What a person may do is the grants: `drive.view` reads the account and the files, `drive.connect` links an
account and lets go of it (the classic team page offered both to everyone), `sheets.view` reads the spreadsheets. The administrator has
them all.

- **The data** (`data.ts`) is the portals' own routes — the administrator's are Drive's own (`/api/drive/*`, not under `/api/dashboard`),
  the team's are `/api/employee/drive/*` — through `routesOf(portal)`. `useDriveLink` is the one answer both screens share (no Google project
  here, none linked, or whose account it is and whether it can upload), with the two things a person can do about it: `connect` (a
  navigation, so the session goes in the address; the team's page first asks `/api/employee/check`, as the classic page did) and
  `disconnect`. `useDriveFiles` reads the list once there is a link. **Nothing is kept for the next visit** (`gcTime: 0`): a screen opened
  again starts with the loader, never with the last visit's account.
- **The pieces** (`Pieces.tsx`, `FileGlyph.tsx`, `GoogleFiles.tsx`) are each portal's own: the administrator's page is a card in the middle
  of the page and a table card, the team's is lines of text and a card with a scrolling table; both are held to the classic pages by
  `tests/gdparity.js`. The file list is a card for each row on a phone (the classic `mobile.css`). The viewer is a dialog over the
  page (focus in, Tab kept in, Escape out).
- **The checks on every answer** (`model.ts`) are held to the schemas in `packages/contracts` by a corpus of every wrong value of every
  field (`test/wrongly.ts`, shared with the Inventory screen's tests).
- **Where it is deliberately not the classic page** is `docs/parity/drive.md`: the team's Disconnect button never worked in the classic page,
  linking an account is a grant of its own, and Google refusing is told in Google's words with the account and Disconnect kept.
- Tests: `google/model.test.ts`, `data.test.tsx` and `google.test.tsx` (every state, grant and refusal, in both portals);
  `tests/gdparity.js` (look), `tests/webdrive.js` (the real thing, including the trip to Google and back) and `tests/driveroutes.js`
  (the routes, both portals).

## My Email

`modules/email` is one page in both portals' own looks, over `src/google` (the link to the account, the cards that say there is nothing to
read yet, the account line, the loader — what My Drive and My Sheets use too). What a person may do is the grants: `email.view` reads the
account, the inbox and a message, `email.send` sends (Compose, Reply and Forward; the team's box under a message), `email.connect` links an
account and lets go of it (the classic team page offered all of it to everyone). The administrator has them all.

- **The link** is `src/google/link.ts`: `useGoogleLink` asks whose account it is on every visit, goes to Google to make the link (a
  navigation, so the session goes in the address; the team's page first asks `/api/employee/check`) and lets it go. My Drive, My Sheets and
  My Email each hand it their routes and how to read the answer. **Nothing is kept for the next visit** (`gcTime: 0`): a screen opened again
  starts with the loader, never with the last visit's inbox.
- **The data** (`data.ts`) is the portals' own routes — the administrator's are Gmail's own (`/api/email/*`, not under `/api/dashboard`), the
  team's are `/api/employee/email/*` — through `routesOf(portal)`: the inbox, one message, `useSend`, and `useRefresh`, which starts the
  page over as the administrator's **Refresh** does.
- **The checks on every answer** (`model.ts`) are held to the schemas in `packages/contracts` by a corpus of every wrong value of every
  field (`test/wrongly.ts`). A message the server answers as a message with nothing in it (Gmail did not give it) is an error to the page, not
  a blank card.
- **A message's HTML** is handed to a frame that runs nothing (`Frame.tsx`: `sandbox="allow-same-origin"`) exactly as it came; text is text.
- **The link says whether it can send** (`canSend`): one made before sending was asked for, or that left it out on Google's consent screen,
  is told so on both pages, with **Reconnect** for those who may link an account.
- **Where it is deliberately not the classic page** is `docs/parity/email.md`: the grants, a reply that does not stack another "Re:" or follow
  what was typed under another message, an error that is not read as an empty inbox, and the administrator's Gmail connection that now only
  trusts a return the server asked for.
- Tests: `modules/email/model.test.ts`, `data.test.tsx` and `email.test.tsx` (every state, grant and refusal, in both portals);
  `tests/emparity.js` (look), `tests/webemail.js` (the real thing, including the trip to Google and back) and `tests/emailroutes.js`
  (the routes, both portals).

## The gallery

`/dashboard/__gallery` and `/employee/__gallery` (with `?ui=next`; it needs no session) show the design system on
one page: the colours, every primitive, the sign-in card, and the real frame on a made-up everything-allowed session,
under any of the eight looks a workspace can have and either mode (the same runtime the app wears a look with). It
is its own chunk: the page the app opens with does not carry it (`tests/spashell.js`). `tests/galleryaudit.js` goes
round both portals, the eight looks and both modes and measures every text against what it is drawn on
(`tools/contrast.js`, the measure the classic portals' audit uses): 4.5:1 for ordinary text, 3:1 for large text and
for icons that mean something. Anything lower fails the run unless `ALLOWED` says why.

## Working on it

```
npm run dev -w apps/web     the app on http://localhost:5173/ui/ (the API, manifests and icons are proxied
                            to a server on port 3000: `npm run dev` in the root)
npm run test:web            the unit tests (Vitest + Testing Library, jsdom)
npm run build               type-check, then bundle into apps/web/dist
npm run typecheck           includes this app
```

Opened from the dev server there is no `window.__ML__`; the app falls back to the admin portal.

The suites that hold it, from the root: `tests/modules.js` (the catalogue against the classic portals), `tests/spashell.js`
(the build and the server half), `tests/signinparity.js` and `tests/shellparity.js` (look, value by value),
`tests/webauth.js`, `tests/webshell.js`, `tests/webnotifs.js`, `tests/webissues.js`, `tests/websuppliers.js` and `tests/webdocs.js` (the real
server, a real browser), `tests/notifparity.js`, `tests/subparity.js`, `tests/issparity.js`, `tests/supparity.js` and `tests/docparity.js` (the pages,
value by value), `tests/notifications.js`, `tests/submissions.js`, `tests/issues.js`, `tests/suppliers.js` and `tests/rfqpo.js` (the routes behind them),
`tests/galleryaudit.js` (readability),
`tests/embed.js` (the classic pages as guests), `tests/webframe.js` (every unmoved screen in its frame) and
`tests/webpwa.js` (the service worker, offline and in turns with the classic one).
The parity suites compare against the classic portals, so they go when the classic portals do. (Vitest's module cache is
off for this app: the registry is a glob of `modules/*/index.ts`, which a cache keyed on the registry's own text cannot see
change.)

## Rules

- **Everything here is build-time.** The server never loads it, so `package.json` declares no `dependencies`
  (`tests/deployconfig.js` holds that); the bundler takes what it needs from `devDependencies`.
- **The same keys as the classic portals** (`ml_admin_token`, `ml_emp_token`, and the sidebar, group, page and
  mode keys above): a session or a choice made in either is the same in both while they live side by side.
- **Permissions and the screens come from `@motolinker/contracts` subpaths that carry no zod** — `/access` (the one
  rule the server's guards ask), `/modules` (the catalogue), `/deeplinks`, `/permissions` (the catalogue of sections and
  actions and how a stored record is read) — never from a copy and never from the package root, which carries the
  response schemas. `tests/contracts.js` loads the subpaths in a process of their own and fails if zod comes with
  them; `tests/spashell.js` fails if zod is in any file the build writes.
- **The bundle has a budget**: 250 kB gzipped for the JavaScript the page opens with (`tests/spashell.js`; about 124 kB
  today). Anything that is not needed to open the app — the gallery today, a heavy screen later — is a chunk loaded
  on demand.
- **Look first, redesign later**: the app wears the classic look from the workspace's tokens, and a suite
  (`tests/signinparity.js`, `tests/shellparity.js`) holds each part to the classic page's computed style. A new screen
  gets the same treatment before it replaces a classic one.
