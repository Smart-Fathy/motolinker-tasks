// Serves the two portals' pages and install manifests with the workspace's name,
// picture and look already in them. src/lib/shell.js does the writing; this decides
// what to write and when to answer 304.
//
// Mounted by index.js before express.static: a static file is answered first, and
// /dashboard.html would otherwise reach the page without any of this. It is handed what
// it needs rather than reading it from the context, because at that point in index.js
// the context has not been filled yet — and the workspace profile is asked for per
// request, by which time it has.
const fs = require('fs');
const path = require('path');
const { renderShell, renderManifest } = require('../lib/shell');

const PAGES = [
  { kind: 'admin', file: 'dashboard.html', routes: ['/dashboard', '/dashboard.html'], manifest: 'manifest-dashboard.json' },
  { kind: 'team', file: 'employee.html', routes: ['/employee', '/employee.html'], manifest: 'manifest-employee.json' },
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

function mountShell({ receiver, publicDir, profile }) {
  for (const page of PAGES) {
    const htmlFile = () => path.join(publicDir, page.file);
    const manifestFile = () => path.join(publicDir, page.manifest);

    // One registration per path (not an array): tools/smoke-routes.js and the route
    // inventory read each route's path as a string.
    for (const route of page.routes) receiver.router.get(route, async (req, res) => {
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
