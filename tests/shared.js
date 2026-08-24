// The huddle and Home code is shared by both portals. It used to be a verbatim copy
// in each bundle, which is how a fix could land in the admin dashboard and quietly
// miss the team portal. This asserts it stays in one place: the shared files exist,
// both portals load them, both service workers cache them, and neither bundle has
// grown its own copy back.
const fs = require('fs');

const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const read = p => fs.readFileSync(p, 'utf8');
const home    = read('public/assets/home.js');
const huddle  = read('public/assets/huddle.js');
const filters = read('public/assets/lead-filters.js');
const lviews  = read('public/assets/lead-views.js');
const mobile  = read('public/assets/mobile.css');
const mobjs   = read('public/assets/mobile.js');
const proc    = read('public/assets/procurement.js');
const colsjs  = read('public/assets/columns.js');
const quote   = read('public/assets/quote.js');
const meets   = read('public/assets/meetings.js');
const avail   = read('public/assets/availability.js');
const bundles = { dashboard: read('public/assets/dashboard.js'), employee: read('public/assets/employee.js') };
const pages   = { dashboard: read('public/dashboard.html'),      employee: read('public/employee.html') };
const workers = { dashboard: read('public/sw-dashboard.js'),     employee: read('public/sw-employee.js') };

// A marker per module that is distinctive enough not to appear by accident, and that
// sits at the very top of the block so a partial copy still trips it.
const MARKERS = {
  '/assets/home.js':         { src: home,    re: /const HOME_WIDGETS = \{/ },
  '/assets/huddle.js':       { src: huddle,  re: /let _hd = \{ roomId: null/ },
  '/assets/lead-filters.js': { src: filters, re: /function leadFilterMatch\(/ },
  '/assets/lead-views.js':   { src: lviews,  re: /function renderLeadBoard\(/ },
  '/assets/mobile.js':       { src: mobjs,   re: /function labelTable\(/ },
  '/assets/procurement.js':  { src: proc,    re: /function procPath\(/ },
  '/assets/columns.js':      { src: colsjs,  re: /function ColumnsEngine\(/ },
  '/assets/quote.js':        { src: quote,   re: /function openQuoteForm\(/ },
  '/assets/meetings.js':     { src: meets,   re: /function openMeetingForm\(/ },
  '/assets/availability.js': { src: avail,   re: /function renderAvailabilityBoard\(/ },
};

for (const [path, { src, re }] of Object.entries(MARKERS)) {
  check(`${path} holds the real module`, re.test(src));
  for (const portal of ['dashboard', 'employee']) {
    // Asset URLs carry the deploy stamp now (?v=N) — accept it in both places.
    check(`${portal} loads ${path}`, new RegExp(`src="${path}(\\?v=\\d+)?"`).test(pages[portal]));
    check(`${portal} service worker caches ${path}`,
      workers[portal].includes(`'${path}'`) || workers[portal].includes(`'${path}?v=' + V`));
    check(`${portal} bundle has no second copy of ${path}`, !re.test(bundles[portal]));
  }
}

// The adapters are the seam and must stay in the portal bundles, not the shared files.
for (const portal of ['dashboard', 'employee']) {
  check(`${portal} still defines its HOMECFG adapter`, /const HOMECFG = \{/.test(bundles[portal]));
  check(`${portal} still defines its HDCFG adapter`,   /const HDCFG = \{/.test(bundles[portal]));
}
for (const portal of ['dashboard', 'employee']) {
  check(`${portal} still defines its PROCFG adapter`, /const PROCFG = \{/.test(bundles[portal]));
}
check('the shared files define no adapter of their own',
  !/const H(OME)?CFG = \{/.test(home) && !/const HDCFG = \{/.test(huddle)
  && !/^const PROCFG = \{/m.test(proc));

// The operations module reaches its portal's API through PROCFG.base rather than
// the dashboard paths it was written with, and that mapping is the single place it
// happens — a stray '/api/dashboard' left in a fetch would 404 for the team portal.
check('the operations module routes every call through the base mapping',
  !/PROCFG\.fetch\(['\`]\/api/.test(proc) && /procPath\(url\)/.test(proc));
// The filter engine takes its adapter at runtime rather than declaring one.
for (const portal of ['dashboard', 'employee']) {
  check(`${portal} binds the filter engine with lfInit`, /lfInit\(\{/.test(bundles[portal]));
}
check('the filter engine declares no adapter of its own', !/^const LFCFG = \{/m.test(filters));

// ── Deploy atomicity ──────────────────────────────────────────────────────────
// The HTML is network-first but the assets are cache-first, so without a version
// stamp a deploy paired NEW markup with the OLD bundle out of the service-worker
// cache — the "blank page until several refreshes" report. The stamp is the SW
// cache version riding every asset URL; these keep the two in agreement.
for (const portal of ['dashboard', 'employee']) {
  const swVer = (workers[portal].match(/-v(\d+)';/) || [])[1];
  check(`${portal} service worker declares a version`, !!swVer, String(swVer));
  const refs = [...pages[portal].matchAll(/(?:href|src)="(\/(?:assets\/[a-z-]+\.(?:js|css)|help-docs\.js))(?:\?v=(\d+))?"/g)];
  const unstamped = refs.filter(m => !m[2]).map(m => m[1]);
  const wrong = refs.filter(m => m[2] && m[2] !== swVer).map(m => `${m[1]}?v=${m[2]}`);
  check(`${portal} stamps every asset URL`, refs.length >= 8 && unstamped.length === 0, unstamped.join(', '));
  check(`${portal} asset stamps match the service worker version (v${swVer})`, wrong.length === 0, wrong.join(', '));
  check(`${portal} service worker shell carries the same stamp`,
    /\?v=' \+ V/.test(workers[portal]) && /const V = CACHE\.split\('-v'\)\[1\]/.test(workers[portal]));
  check(`${portal} service worker installs per-URL, tolerating a missing file`,
    !/c\.addAll\(SHELL\)/.test(workers[portal]) && /c\.add\(u\)\.catch/.test(workers[portal]));
  check(`${portal} service worker never answers a navigation with undefined`,
    !/\.catch\(\(\) => caches\.match\('\/(dashboard|employee)'\)\)/.test(workers[portal])
    && /hit \|\| new Response\(/.test(workers[portal]));
}

// ── One sidebar vocabulary ────────────────────────────────────────────────────
// The saved arrangement (quotation_settings.nav_config) is org-wide and BOTH
// portals apply it, matching groups by key. A section that exists in only one
// portal can never be arranged or renamed from the other side — which is how
// the team portal ended up with a section of its own called "Operations" while
// the admin filed the same pages under Tools and Logistics. Same keys, same
// order, same names, or the arrangement silently stops covering everything.
{
  const sections = html => [...html.matchAll(
    /<div class="nav-group" data-group="([a-z]+)">[\s\S]*?<span class="nav-group-label">([^<]+)<\/span>/g)]
    .map(m => `${m[1]}:${m[2].trim()}`);
  const a = sections(pages.dashboard);
  const t = sections(pages.employee);
  check('the admin ships seven sidebar sections', a.length === 7, a.join(' | '));
  check('the portal ships the same sections, in the same order, with the same names',
    a.length === t.length && a.every((v, i) => v === t[i]),
    `admin: ${a.join(' | ')}  ·  team: ${t.join(' | ')}`);
}

// ── Page nesting ──────────────────────────────────────────────────────────────
// Every screen is a sibling `.page` that navigate() shows by adding .active, and
// it de-activates all the others first. So a `.page` nested inside another page
// can never be seen: its ancestor is display:none whenever it is active. That is
// what a single missing </div> in the Reports block did — it swallowed
// Automations, WhatsApp, Google Chat, MotoChat and Notifications, which rendered
// as five blank screens with no console error to point at them. Depth is counted
// from the raw markup because the browser silently repairs the nesting, so the
// only place the mistake is visible is here.
for (const portal of ['dashboard', 'employee']) {
  const html = pages[portal].replace(/<!--[\s\S]*?-->/g, '');
  const depths = [];
  let depth = 0;
  for (const m of html.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    if (m[0] === '</div>') { depth--; continue; }
    const id = (m[0].match(/id="(page-[a-z]+)"/) || [])[1];
    if (id) depths.push([id, depth]);
    depth++;
  }
  const level = depths.length ? depths[0][1] : -1;
  const nested = depths.filter(([, d]) => d !== level).map(([id, d]) => `${id}@${d}`);
  check(`${portal} keeps every page a sibling, none nested in another`,
    depths.length >= 20 && nested.length === 0, nested.join(', ') || `${depths.length} pages at depth ${level}`);
}


// The mobile layer has to load LAST: several of its rules exist only to beat later
// same-specificity rules in the portal sheets, and it uses no !important to do it.
for (const portal of ['dashboard', 'employee']) {
  const html = pages[portal];
  const own = html.indexOf(`/assets/${portal}.css`);
  const mob = html.indexOf('/assets/mobile.css');
  check(`${portal} loads mobile.css after its own stylesheet`, own >= 0 && mob > own, `own@${own} mobile@${mob}`);
  check(`${portal} service worker caches mobile.css`,
    workers[portal].includes("'/assets/mobile.css'") || workers[portal].includes("'/assets/mobile.css?v=' + V"));
}
// Comments stripped first — the file explains twice why it avoids !important, and
// matching that prose would be the test failing on its own documentation.
check('the mobile layer needs no !important',
  !/!important/.test(mobile.replace(/\/\*[\s\S]*?\*\//g, '')));

// Load order: the shared files declare the functions the portal script calls, so they
// have to be parsed first.
for (const portal of ['dashboard', 'employee']) {
  const html = pages[portal];
  const shared = Math.max(html.indexOf('/assets/home.js'), html.indexOf('/assets/huddle.js'));
  const own = html.indexOf(`/assets/${portal}.js`);
  check(`${portal} loads the shared files before its own bundle`, shared >= 0 && own > shared,
    `shared@${shared} own@${own}`);
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} shared-module checks passed`);
process.exit(pass === results.length ? 0 : 1);
