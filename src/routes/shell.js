// Serves the two portals' pages and install manifests with the workspace's name,
// picture and look already in them. src/lib/shell.js does the writing; this decides
// what to write and when to answer 304.
//
// Two UIs share these addresses. The classic portals (public/dashboard.html, employee.html) are what
// everybody gets; the new app (apps/web, built to apps/web/dist) is what a browser gets after asking for it
// with ?ui=next (src/http/ui-choice.js: the question, the cookie that remembers the answer, the env defaults).
// The new app's page is dressed by the same code as the classic ones (src/http/spa-shell.js), so it opens in the
// same look from the first paint. The classic page is always available at /legacy/dashboard and /legacy/employee,
// and ?ui=legacy puts a browser back. Anything that stops the new app being sent — no build, a template that
// cannot be dressed — sends the classic page instead; the switch can never leave a page that does not open.
//
// Mounted by index.js before express.static: a static file is answered first, and
// /dashboard.html would otherwise reach the page without any of this. It is handed what
// it needs rather than reading it from the context, because at that point in index.js
// the context has not been filled yet — and the workspace profile is asked for per
// request, by which time it has.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { renderShell, renderManifest, DEFAULT_NAME } = require('../lib/shell');
const { makeRenderSpa } = require('../http/spa-shell');
const { chooseUi, rememberCookie, defaultFor } = require('../http/ui-choice');

const renderSpa = makeRenderSpa({ renderShell, defaultName: DEFAULT_NAME });

const PAGES = [
  { kind: 'admin', file: 'dashboard.html', routes: ['/dashboard', '/dashboard.html'], inside: '/dashboard/*', classic: '/legacy/dashboard', manifest: 'manifest-dashboard.json' },
  { kind: 'team', file: 'employee.html', routes: ['/employee', '/employee.html'], inside: '/employee/*', classic: '/legacy/employee', manifest: 'manifest-employee.json' },
];

// A page is rebuilt when the workspace changes or the file does, not on every request.
const built = new Map();   // key -> { text }
function remember(key, make) {
  let hit = built.get(key);
  if (!hit) {
    hit = make();
    built.set(key, hit);
    if (built.size > 40) built.delete(built.keys().next().value);   // ?safe=1 and old versions do not pile up
  }
  return hit;
}
const mtime = file => { try { return fs.statSync(file).mtimeMs; } catch (_) { return 0; } };

function mountShell({ receiver, publicDir, profile, webDist }) {
  // Where `npm run build` writes the new app. ML_WEB_DIST is for tests; absent a build, everybody gets the classic page.
  const spaDir = webDist || process.env.ML_WEB_DIST || path.join(__dirname, '..', '..', 'apps', 'web', 'dist');
  const spaIndex = () => path.join(spaDir, 'index.html');
  const spaBuilt = () => fs.existsSync(spaIndex());

  // The built files, under /ui. Their names carry a hash of their content, so a year in a cache is safe. index.html
  // is not one of them: the app's page is sent at /dashboard and /employee, dressed with the workspace.
  const assets = express.static(spaDir, { index: false, maxAge: '365d', immutable: true });
  receiver.router.use('/ui', function serveWebAssets(req, res, next) {
    return req.path === '/index.html' ? next() : assets(req, res, next);
  });

  for (const page of PAGES) {
    const htmlFile = () => path.join(publicDir, page.file);
    const manifestFile = () => path.join(publicDir, page.manifest);

    // The classic page, dressed with the workspace.
    const sendClassic = async (req, res) => {
      try {
        const safe = req.query.safe === '1';
        const ws = await profile();
        const make = () => ({ text: renderShell(fs.readFileSync(htmlFile(), 'utf8'), ws, { safe }) });
        // A database that has not answered says so; whatever look it happened to describe is not believed.
        const text = ws.degraded ? make().text : remember(`${page.kind}|${safe}|${ws.updated_at}|${ws.name}|${mtime(htmlFile())}`, make).text;
        res.set('Cache-Control', 'no-cache');
        res.type('html').send(text);
      } catch (e) {
        // Never let dressing the page up be the reason it does not open.
        console.warn('[shell] could not dress ' + page.file + ':', e.message);
        res.sendFile(htmlFile());
      }
    };

    // The new app's page, dressed the same way. False means nothing was sent, and the classic page should be.
    const sendSpa = async (req, res) => {
      try {
        const safe = req.query.safe === '1';
        const ws = await profile();
        const make = () => ({ text: renderSpa(fs.readFileSync(spaIndex(), 'utf8'), ws, { kind: page.kind, safe }) });
        const text = ws.degraded ? make().text : remember(`spa|${page.kind}|${safe}|${ws.updated_at}|${ws.name}|${mtime(spaIndex())}`, make).text;
        res.set('Cache-Control', 'no-cache');
        res.type('html').send(text);
        return true;
      } catch (e) {
        console.warn('[shell] could not send the new app for ' + page.kind + '; sending the classic page:', e.message);
        return false;
      }
    };

    // Which UI this request asked for. A switch that breaks must not keep the classic page from opening.
    const choose = (req, res) => {
      let choice = { ui: 'legacy', remember: null };
      try {
        choice = chooseUi({ query: req.query, cookie: req.headers.cookie, defaultUi: defaultFor(page.kind) });
      } catch (e) {
        console.warn('[shell] could not read the UI switch:', e.message);
      }
      if (choice.remember) res.append('Set-Cookie', rememberCookie(choice.remember));
      res.vary('Cookie');   // the same address answers differently by cookie
      return choice;
    };

    // One registration per path (not an array): tools/smoke-routes.js and the route
    // inventory read each route's path as a string.
    for (const route of page.routes) receiver.router.get(route, async (req, res) => {
      const choice = choose(req, res);
      if (choice.ui === 'next' && spaBuilt() && await sendSpa(req, res)) return;
      return sendClassic(req, res);
    });

    // The classic page, whatever the switch says: the way back, and what the new app shows for anything it does not do yet.
    receiver.router.get(page.classic, sendClassic);

    // Addresses inside the new app. Only the new app has any; for a browser that has not chosen it they do not exist, as before.
    receiver.router.get(page.inside, async (req, res, next) => {
      const choice = choose(req, res);
      if (choice.ui === 'next' && spaBuilt() && await sendSpa(req, res)) return;
      next();
    });

    receiver.router.get('/' + page.manifest, async (req, res) => {
      try {
        const ws = await profile();
        const text = JSON.stringify(renderManifest(JSON.parse(fs.readFileSync(manifestFile(), 'utf8')), ws, page.kind, { safe: req.query.safe === '1' }), null, 2);
        res.set('Cache-Control', 'no-cache');
        res.type('application/json').send(text);
      } catch (e) {
        console.warn('[shell] could not dress ' + page.manifest + ':', e.message);
        res.sendFile(manifestFile());
      }
    });
  }
}

module.exports = { mountShell };
