# apps/web — the new MotoLinker web app

Vite + React 19 + TypeScript. It is built by `npm run build` (a type-check, then Vite) into `apps/web/dist`, and
**served by the Node server**, not by Vite: `src/routes/shell.js` sends `dist/index.html`, dressed with the workspace's
look, at `/dashboard` and `/employee` to a browser that has asked for the new app (`?ui=next`, remembered in the
`ml_ui` cookie; see the root README, "Looking at the new app"), and the hashed files under `/ui/`.

```
index.html          a template: its <head> is the classic pages' head, because the server finds its places in
                    it by exact text (src/http/spa-shell.js, src/lib/shell.js). tests/spashell.js fails if a
                    hook goes missing. Prettier leaves it alone for the same reason.
src/main.tsx        mounts <App/>
src/app/            the app: App.tsx, useMe.ts (who is signed in, from GET /api/v1/me)
src/lib/            env.ts (what the server tells the page: window.__ML__), session.ts (the token, under the
                    classic portals' own keys), api.ts (fetch + the check of the /api/v1/me answer)
src/styles/         base.css: the classic portals' design tokens with the values they ship; the server writes
                    the workspace's look after it
```

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
- **Look first, redesign later**: the app wears the classic look from the workspace's tokens
  (`src/styles/tokens.test.ts` holds `base.css` to the classic sheet's values).
