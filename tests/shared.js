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
const mobile  = read('public/assets/mobile.css');
const bundles = { dashboard: read('public/assets/dashboard.js'), employee: read('public/assets/employee.js') };
const pages   = { dashboard: read('public/dashboard.html'),      employee: read('public/employee.html') };
const workers = { dashboard: read('public/sw-dashboard.js'),     employee: read('public/sw-employee.js') };

// A marker per module that is distinctive enough not to appear by accident, and that
// sits at the very top of the block so a partial copy still trips it.
const MARKERS = {
  '/assets/home.js':         { src: home,    re: /const HOME_WIDGETS = \{/ },
  '/assets/huddle.js':       { src: huddle,  re: /let _hd = \{ roomId: null/ },
  '/assets/lead-filters.js': { src: filters, re: /function leadFilterMatch\(/ },
};

for (const [path, { src, re }] of Object.entries(MARKERS)) {
  check(`${path} holds the real module`, re.test(src));
  for (const portal of ['dashboard', 'employee']) {
    check(`${portal} loads ${path}`, pages[portal].includes(`src="${path}"`));
    check(`${portal} service worker caches ${path}`, workers[portal].includes(`'${path}'`));
    check(`${portal} bundle has no second copy of ${path}`, !re.test(bundles[portal]));
  }
}

// The adapters are the seam and must stay in the portal bundles, not the shared files.
for (const portal of ['dashboard', 'employee']) {
  check(`${portal} still defines its HOMECFG adapter`, /const HOMECFG = \{/.test(bundles[portal]));
  check(`${portal} still defines its HDCFG adapter`,   /const HDCFG = \{/.test(bundles[portal]));
}
check('the shared files define no adapter of their own',
  !/const H(OME)?CFG = \{/.test(home) && !/const HDCFG = \{/.test(huddle));
// The filter engine takes its adapter at runtime rather than declaring one.
for (const portal of ['dashboard', 'employee']) {
  check(`${portal} binds the filter engine with lfInit`, /lfInit\(\{/.test(bundles[portal]));
}
check('the filter engine declares no adapter of its own', !/^const LFCFG = \{/m.test(filters));

// The mobile layer has to load LAST: several of its rules exist only to beat later
// same-specificity rules in the portal sheets, and it uses no !important to do it.
for (const portal of ['dashboard', 'employee']) {
  const html = pages[portal];
  const own = html.indexOf(`/assets/${portal}.css`);
  const mob = html.indexOf('/assets/mobile.css');
  check(`${portal} loads mobile.css after its own stylesheet`, own >= 0 && mob > own, `own@${own} mobile@${mob}`);
  check(`${portal} service worker caches mobile.css`, workers[portal].includes("'/assets/mobile.css'"));
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
