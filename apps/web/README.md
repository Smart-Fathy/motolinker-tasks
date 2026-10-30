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
src/modules/<id>/   a screen that has moved: index.ts default-exports defineModule('<id>', { Page }); home, notifications, submissions, issues
src/auth/           the sign-in: SignIn.tsx (which step, and what carries between them) and a component per
                    step: PasswordStep, CodeStep (second step), ForgotStep, ResetStep; copy.ts holds every
                    line they say
src/ui/             the design primitives: Button, Field, Alert, AuthLayout (CSS Modules, in the `ui` layer)
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
classic portal, Security and Sign out); the team has the classic rail with its brand block, the account menu (the
initials button: Security, the classic portal, Sign out) and the bottom bar on a phone. The parts carry
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
  says `ready{page}` once, first, then `navigated{page}` whenever the person moves about inside it, and `unauthorized`
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
  own chat, not a second copy) and Security (a panel that opens over a page). They are cards that say why and link to the
  classic page that has them.
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
  dialog with a name, Escape closes it, focus goes in and back out, and a click on the curtain does not close it.
- **Data.** The queue is `['issues', actor.key, 'list']`, a ticket's replies `['issues', actor.key, 'comments', id]` (separate, so
  that closing a ticket does not read the replies again). Closing or reopening puts the ticket the server returned in the queue;
  a reply asks for the replies again. A queue already in hand is kept when asking again fails.
- **Links** to a ticket's file open only where a browser should follow them (`fileHref`).
- Tests: `model.test.ts`, `data.test.tsx`, `issues.test.tsx`, `report.test.tsx`, `ui/Modal.test.tsx`; `tests/issparity.js` (look),
  `tests/webissues.js` (the real thing), `tests/issues.js` (the routes).

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
`tests/webauth.js`, `tests/webshell.js`, `tests/webnotifs.js` and `tests/webissues.js` (the real server, a real browser),
`tests/notifparity.js`, `tests/subparity.js` and `tests/issparity.js` (the pages, value by value), `tests/notifications.js`,
`tests/submissions.js` and `tests/issues.js` (the routes behind them), `tests/galleryaudit.js` (readability),
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
