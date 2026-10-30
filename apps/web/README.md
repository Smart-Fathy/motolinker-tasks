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
src/app/            App.tsx (signed out: the sign-in; signed in: who you are, and a way out) and useMe.ts
                    (who is signed in, from GET /api/v1/me; signing in and out)
src/auth/           the sign-in: SignIn.tsx (which step, and what carries between them) and a component per
                    step: PasswordStep, CodeStep (second step), ForgotStep, ResetStep; copy.ts holds every
                    line they say
src/ui/             the design primitives: Button, Field, Alert, AuthLayout (CSS Modules, in the `ui` layer)
src/lib/            env.ts (what the server tells the page: window.__ML__ — the portal, the workspace's name
                    and its replaced wording), session.ts (the token, under the classic portals' own keys),
                    api.ts (GET /api/v1/me and the check of its answer), auth-api.ts (the sign-in routes, read
                    into results a screen can act on), arrival.ts (Google's return and the reset link)
src/styles/         base.css: the layers and the classic portals' design tokens with the values they ship;
                    portal-team.css: where the team portal's sheet starts from something else
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
  try again. Signing out tells the server, but does not wait for it.
- **One send.** A submit while one is on its way sends nothing (a ref, not only the disabled button: a second
  submit can arrive before the page has drawn the first).

`tests/webauth.js` runs all of this against the real server and the built app; the unit tests (`SignIn.test.tsx`,
`App.test.tsx`, `auth-api.test.ts`, `arrival.test.ts`) answer from scripts.

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

## Working on it

```
npm run dev -w apps/web     the app on http://localhost:5173/ui/ (the API, manifests and icons are proxied
                            to a server on port 3000: `npm run dev` in the root)
npm run test:web            the unit tests (Vitest + Testing Library, jsdom)
npm run build               type-check, then bundle into apps/web/dist
npm run typecheck           includes this app
```

Opened from the dev server there is no `window.__ML__`; the app falls back to the admin portal.

## Rules

- **Everything here is build-time.** The server never loads it, so `package.json` declares no `dependencies`
  (`tests/deployconfig.js` holds that); the bundler takes what it needs from `devDependencies`.
- **The same keys as the classic portals** (`ml_admin_token`, `ml_emp_token`): a session opened in either is a
  session in both while they live side by side.
- **Permissions come from `@motolinker/contracts/access`** (the one rule the server's guards ask, with no zod in the
  bundle), never from a copy.
- **The bundle has a budget**: 250 kB gzipped for the JavaScript (`tests/spashell.js`).
- **Look first, redesign later**: the app wears the classic look from the workspace's tokens, and a suite
  (`tests/signinparity.js`) holds the sign-in to the classic page's computed style. A new screen gets the same
  treatment before it replaces a classic one.
