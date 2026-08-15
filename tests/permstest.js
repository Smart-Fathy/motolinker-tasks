// The permission model, end to end.
//
// Permissions are five things that have to agree: PERM_ACTIONS on the server, the
// route guards, the catalogue the admin editor is built from, the team portal's
// nav gating, and the Home widget gates. The interesting failures are not "does
// empCan work" — it is a three-line function — but the seams: a section with a
// checkbox and no guard, a guard for an action no checkbox can grant, a nav item
// for a page whose endpoint refuses it.
//
// So most of what follows reads the real files and compares them to each other.
const fs = require('fs');
const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const EMP  = fs.readFileSync('src/routes/employee-portal.js', 'utf8');
const IDX  = fs.readFileSync('index.js', 'utf8');
const HOME = fs.readFileSync('src/routes/home.js', 'utf8');
const PORTAL_JS   = fs.readFileSync('public/assets/employee.js', 'utf8');
const PORTAL_HTML = fs.readFileSync('public/employee.html', 'utf8');
const DASH_JS     = fs.readFileSync('public/assets/dashboard.js', 'utf8');
const HUDDLES     = fs.readFileSync('src/routes/huddles.js', 'utf8');
const STREAMS     = fs.readFileSync('src/routes/notif-streams.js', 'utf8');
const NOTIFS      = fs.readFileSync('src/routes/notifications.js', 'utf8');
// The procurement modules serve both portals from one set of handlers, so their
// guards count as enforcement the same as anything in index.js.
const PROC = ['suppliers', 'supplier-catalogue', 'rfq', 'purchase-orders', 'contracts', 'submissions']
  .map(f => fs.readFileSync(`src/routes/${f}.js`, 'utf8'));
const SERVER_FILES = [IDX, EMP, HUDDLES, STREAMS, NOTIFS, ...PROC].join('\n');

// ── Load the model out of the real module ─────────────────────────────────────
// Sliced rather than required, because employee-portal.js registers a hundred
// routes on import and needs the whole context built first.
function loadModel() {
  const from = EMP.indexOf('const DEFAULT_PERMISSIONS =');
  const to = EMP.indexOf('function empHasScope');
  if (from < 0 || to < 0) throw new Error('could not slice the permission block');
  const block = EMP.slice(from, to).replace(/receiver\.router\.get\([\s\S]*?\);\n/, '');
  return new Function('ctx', 'autoNorm',
    block + '; return { DEFAULT_PERMISSIONS, PERM_ACTIONS, PERM_LEGACY, normEmpPerms, empCan, permCatalogue };')(
    { DEAL_STAGES: ['lead', 'inquiry', 'quoted', 'negotiating', 'won', 'lost'] },
    x => String(x == null ? '' : x).toLowerCase().trim().replace(/[\s-]+/g, '_'));
}
const M = loadModel();
const emp = (permissions, job_title) => ({ job_title: job_title || 'Sales', permissions: M.normEmpPerms(permissions) });

// ── Nothing is taken away from anyone who already had it ──────────────────────
// The whole risk of widening the model: an employee record written before a
// section existed has no key for it, and a careless default of `false` locks the
// team out of pages they use every day the moment this ships.
{
  const legacy = M.normEmpPerms({ requests: true, drive: true, sheets: true, leads: true });
  const kept = ['requests', 'tasks', 'hours', 'drive', 'sheets', 'calendar', 'meet', 'chat'];
  c('an employee record from before these sections existed keeps all of them',
    kept.every(k => legacy[k] === true), kept.filter(k => legacy[k] !== true).join(',') || 'all kept');
  c('…and gains nothing sensitive by default',
    ['email', 'gchat', 'issues', 'quotation', 'deals', 'reports'].every(k => legacy[k] !== true));
  c('a legacy master switch still means every action in that section',
    Object.values(legacy.leadsActions).every(Boolean), JSON.stringify(legacy.leadsActions));
}

// ── The one action a master switch must NOT imply ─────────────────────────────
// Requests is on for everybody. If requests.viewAll inherited that, every rep
// would silently start reading the whole company's requests on deploy.
{
  const plain = M.normEmpPerms({ requests: true });
  c('requests.viewAll is NOT granted by the Requests master switch',
    plain.requestsActions.viewAll === false);
  const old = M.normEmpPerms({ requests: true, viewAllRequests: true });
  c('…but the old viewAllRequests flag still grants it',
    old.requestsActions.viewAll === true);
  c('…and the flat flag is kept in step for anything still reading it',
    old.viewAllRequests === true && plain.viewAllRequests === false);
  const explicit = M.normEmpPerms({ requests: true, requestsActions: { view: true, viewAll: true } });
  c('an explicit action object wins over both', explicit.requestsActions.viewAll === true
    && explicit.requestsActions.create === false);
}

// ── Adding an action to a section must not strip anyone of anything ──────────
// The editor writes explicit true/false for every action it knows, so a key
// MISSING from a saved actions object can only mean "saved before the action
// existed". Turning that into false would hide the Sales tab from the whole
// team the day it gained a checkbox.
{
  // An employee saved before deals.sales existed: rich shape, no 'sales' key.
  const before = M.normEmpPerms({ deals: true, dealsActions: { view: true, create: false, edit: true, delete: false, move: true } });
  c('a pre-existing rich shape keeps the Sales tab (follows view)',
    before.dealsActions.sales === true, JSON.stringify(before.dealsActions));
  c('…and salesEdit follows edit', before.dealsActions.salesEdit === true);
  const noView = M.normEmpPerms({ deals: true, dealsActions: { view: false, edit: false } });
  c('…but not for someone who could not see deals rows anyway',
    noView.dealsActions.sales === false && noView.dealsActions.salesEdit === false);
  const explicit = M.normEmpPerms({ deals: true, dealsActions: { view: true, sales: false, salesEdit: false } });
  c('an explicit false wins over the fallback',
    explicit.dealsActions.sales === false && explicit.dealsActions.salesEdit === false);
  const legacyFlat = M.normEmpPerms({ deals: true });
  c('a legacy flat shape still grants every action including the new ones',
    legacyFlat.dealsActions.sales === true && legacyFlat.dealsActions.salesEdit === true);
  const sup = M.normEmpPerms({ suppliers: true, suppliersActions: { view: true, docs: true } });
  c('suppliers.purchases follows view for pre-existing shapes',
    sup.suppliersActions.purchases === true);
  // The fallback must never invent a grant where the saved object explicitly
  // denies everything the fallback is keyed on.
  c('a fully-denied rich shape stays fully denied',
    M.normEmpPerms({ deals: true, dealsActions: {} }).dealsActions.sales === false);
}

// ── Bulk apply ────────────────────────────────────────────────────────────────
{
  c('the bulk route replaces rather than merges, through normEmpPerms',
    /permissions\/bulk[\s\S]{0,400}normEmpPerms\(b\.permissions/.test(EMP)
    && /update\(\{ permissions: perms/.test(EMP));
  c('…and nudges the sessions it holds in memory',
    /employeeSessions\.set\(token, \{ \.\.\.sess, permissions: perms \}\)/.test(EMP));
  c('the employees list offers the selection UI',
    /emp-select-all/.test(DASH_JS) && /openBulkPermsModal/.test(DASH_JS));
  c('the bulk modal reuses the catalogue-generated form, not a copy',
    /bulk-perms-form[\s\S]{0,400}cat\.groups\.map\(empPermGroup\)/.test(DASH_JS));
  c('and says in words that it REPLACES',
    /<strong>replaces<\/strong> the permissions/.test(DASH_JS));
}

// ── The CTO keeps the Issues centre ───────────────────────────────────────────
{
  c('a CTO reaches Issues with no permission set',
    M.empCan(emp({}, 'Chief Technical Officer'), 'issues', 'view') === true);
  c('a CTO may resolve as well as read',
    M.empCan(emp({}, 'Chief Technical Officer'), 'issues', 'resolve') === true);
  c('nobody else does', M.empCan(emp({}), 'issues', 'view') === false);
  c('…until they are granted it',
    M.empCan(emp({ issues: true, issuesActions: { view: true, resolve: false } }), 'issues', 'view') === true);
  c('and a granted view does not carry resolve with it',
    M.empCan(emp({ issues: true, issuesActions: { view: true, resolve: false } }), 'issues', 'resolve') === false);
  c('the CTO rule does not leak into other sections',
    M.empCan(emp({}, 'Chief Technical Officer'), 'leads', 'view') === false);
}

// ── Every action is enforced somewhere ────────────────────────────────────────
// A checkbox that governs nothing is worse than no checkbox: the admin turns it
// off and believes something changed. `scope` actions are exempt — they filter
// rows rather than gate a route — as are the CRM sections, whose enforcement
// predates requirePerm and lives inside handler bodies.
{
  const guarded = new Set((SERVER_FILES.match(/requirePerm\('([a-z]+)',\s*'([A-Za-z]+)'\)/g) || [])
    .map(m => m.match(/'([a-z]+)',\s*'([A-Za-z]+)'/).slice(1, 3).join('.')));
  const inline = new Set((SERVER_FILES.match(/empCan\([^,]+,\s*'([a-z]+)',\s*'([A-Za-z]+)'\)/g) || [])
    .map(m => m.match(/'([a-z]+)',\s*'([A-Za-z]+)'/).slice(1, 3).join('.')));
  // The team portal enforces some actions in the client only — the button is
  // hidden and the underlying route is shared with a broader grant.
  const clientOnly = new Set(
    (PORTAL_HTML.match(/data-perm="([a-z]+)\.([A-Za-z]+)"/g) || [])
      .concat(PORTAL_JS.match(/data-perm="([a-z]+)\.([A-Za-z]+)"/g) || [])
      .concat((PORTAL_JS.match(/empCan\('([a-z]+)',\s*'([A-Za-z]+)'\)/g) || []))
      .map(m => m.match(/'?([a-z]+)'?[.,]\s*'?([A-Za-z]+)/).slice(1, 3).join('.')));
  const covered = new Set([...guarded, ...inline, ...clientOnly]);
  const missing = [];
  for (const [section, actions] of Object.entries(M.PERM_ACTIONS)) {
    // Enforced inside the CRM handlers, which predate the middleware.
    if (['leads', 'deals', 'quotation', 'reports'].includes(section)) continue;
    for (const a of actions) if (!covered.has(section + '.' + a)) missing.push(section + '.' + a);
  }
  c('every non-CRM action is enforced somewhere', missing.length === 0, missing.join(', '));

  // And the reverse: a guard for an action the model does not define would fail
  // closed forever, because no checkbox could ever grant it.
  const undefined_ = [...guarded].filter(k => {
    const [s, a] = k.split('.');
    return !M.PERM_ACTIONS[s] || !M.PERM_ACTIONS[s].includes(a);
  });
  c('no route guards an action the model cannot grant', undefined_.length === 0, undefined_.join(', '));
}

// ── requirePerm must be admin-safe where the handlers are shared ──────────────
// Chat and huddles mount the same handlers behind requireAuth for the dashboard.
// If the guard treated a missing req.employee as "no permissions", the admin
// would lose chat entirely.
{
  const fn = IDX.slice(IDX.indexOf('function requirePerm')).match(/^function requirePerm[\s\S]*?\n}/)[0];
  const make = allow => new Function('ctx', fn + '; return requirePerm;')({ empCan: () => allow });
  const run = (guard, req) => {
    let code = 0, nexted = false;
    guard(req, { status(s) { code = s; return this; }, json() {} }, () => { nexted = true; });
    return { code, nexted };
  };
  c('an admin request (no req.employee) passes any guard',
    run(make(false)('chat', 'huddle'), {}).nexted === true);
  c('a permitted employee passes',
    run(make(true)('chat', 'huddle'), { employee: {} }).nexted === true);
  const denied = run(make(false)('chat', 'huddle'), { employee: {} });
  c('an unpermitted employee gets 403 and the handler never runs',
    denied.code === 403 && denied.nexted === false, JSON.stringify(denied));
}

// ── The admin editor covers the model, exactly ────────────────────────────────
{
  const cat = M.permCatalogue();
  const inEditor = new Set(cat.flatMap(g => g.sections.map(s => s.key)));
  const modelled = Object.keys(M.PERM_ACTIONS);
  c('every section in the model has a place in the admin editor',
    modelled.every(k => inEditor.has(k)), modelled.filter(k => !inEditor.has(k)).join(','));
  c('and every section in the editor is one the model knows',
    [...inEditor].every(k => modelled.includes(k)));
  const unlabelled = cat.flatMap(g => g.sections).flatMap(s =>
    s.actions.filter(a => a.label === a.key).map(a => s.key + '.' + a.key));
  c('no action reaches the admin as a bare camelCase key', unlabelled.length === 0, unlabelled.join(', '));
  c('the catalogue carries the server default for each section',
    cat.flatMap(g => g.sections).every(s => s.defaultOn === (M.DEFAULT_PERMISSIONS[s.key] === true)));
  c('the editor is served over an endpoint rather than restated in dashboard.js',
    /\/api\/dashboard\/permissions\/catalogue/.test(EMP) && /permissions\/catalogue/.test(DASH_JS));
  c('dashboard.js no longer keeps its own copy of the section list',
    !/EMP_CRM_ACTIONS|EMP_SIMPLE_PERMS/.test(DASH_JS));
  c('and it reads the form back from that same catalogue',
    /for \(const g of \(_permCatalogue\.groups \|\| \[\]\)\)/.test(DASH_JS));
}

// ── A catalogue that fails to load must not wipe anybody's access ─────────────
// The editor is generated from a fetch. If that fetch fails the form has no
// checkboxes, and reading them back would mean "nothing is allowed" — an admin
// fixing a typo in a name would silently strip an employee of every section.
{
  const src = DASH_JS;
  const build = src.slice(src.indexOf('function empBuildPerms')).match(/^function empBuildPerms[\s\S]*?\n}/)[0];
  const existing = { leads: true, leadsActions: { view: true } };
  const run = (catalogue) => new Function('_permCatalogue', '_empModalPerms', 'document',
    build + '; return empBuildPerms();')(catalogue, existing,
    { getElementById: () => null, querySelectorAll: () => [] });
  c('with no catalogue, saving leaves the existing permissions untouched',
    run(null) === existing, JSON.stringify(run(null)));
  const built = run({ groups: [{ group: 'CRM', sections: [{ key: 'leads', actions: [{ key: 'view' }] }] }] });
  c('with a catalogue, it reads the form back section by section',
    built.leads === false && typeof built.leadsActions === 'object', JSON.stringify(built));
  c('the fetch failure is not cached, so the next open retries',
    /return \{ groups: \[\], stages: \[\], failed: true \};/.test(src)
    && !/_permCatalogue = \{ groups: \[\]/.test(src));
  c('…and the form says so instead of pretending the boxes are accurate',
    /cat\.failed[\s\S]{0,200}Could not load the permission list/.test(src));
}

// ── The team portal hides what the server would refuse ────────────────────────
{
  const listed = (PORTAL_JS.match(/const PERM_SECTIONS = \[([\s\S]*?)\]/) || [])[1] || '';
  const gated = new Set((listed.match(/'([a-z]+)'/g) || []).map(s => s.slice(1, -1)));
  // Every nav item that has a page, minus the three nobody is locked out of.
  const navIds = [...PORTAL_HTML.matchAll(/id="nav-([a-z]+)"/g)].map(m => m[1]);
  const ALWAYS = ['home', 'notif', 'help'];
  const actionNav = ['log', 'hours'];   // governed by hours.log / hours.view
  const ungoverned = navIds.filter(id => !ALWAYS.includes(id) && !actionNav.includes(id) && !gated.has(id));
  c('every nav item in the team portal is governed by a permission',
    ungoverned.length === 0, ungoverned.join(', '));
  c('…except the three nobody should be locked out of',
    ALWAYS.every(id => !gated.has(id)));
  c('Log Hours and Hours Log are separate actions of one section',
    /PERM_NAV_ACTIONS = \{ log: \['hours', 'log'\], hours: \['hours', 'view'\] \}/.test(PORTAL_JS));
  c('every section the portal gates is one the server models',
    [...gated].every(k => M.PERM_ACTIONS[k]), [...gated].filter(k => !M.PERM_ACTIONS[k]).join(','));
  c("the portal's fallback defaults match the server's",
    Object.entries(M.DEFAULT_PERMISSIONS)
      .filter(([k]) => M.PERM_ACTIONS[k])
      .every(([k, v]) => new RegExp(`${k}:${v}`).test(PORTAL_JS.replace(/\s/g, ''))));
}

// ── Operations and procurement reach both portals from one set of handlers ────
// Suppliers, RFQ, Purchase Orders, Sales Contracts and Submissions used to be
// admin-only. Rather than a second copy of each under /api/employee, every module
// mounts its handlers twice — so a fix cannot land in the dashboard and miss the
// portal, and the permission actions are the only difference between the two.
{
  const MOUNTS = [
    ['suppliers.js', 'mountSupplierRoutes', '/api/employee/suppliers'],
    ['rfq.js', 'mountRfqRoutes', '/api/employee/rfqs'],
    ['purchase-orders.js', 'mountPurchaseOrderRoutes', '/api/employee/purchase-orders'],
    ['contracts.js', 'mountContractRoutes', '/api/employee/contracts'],
    ['submissions.js', 'mountSubmissionRoutes', '/api/employee/submissions'],
  ];
  for (const [file, fn, empBase] of MOUNTS) {
    const src = fs.readFileSync('src/routes/' + file, 'utf8');
    const admin = new RegExp(`${fn}\\('/api/(dashboard/|)[a-z-]+', requireAuth\\)`).test(src);
    c(`${file} mounts one handler set for both portals`,
      admin && src.includes(`${fn}('${empBase}', requireEmployeeAuth)`), fn);
    c(`…and keeps no second copy of its routes for employees`,
      !new RegExp(`receiver\\.router\\.[a-z]+\\('${empBase}`).test(src));
  }
  // Every route inside those factories carries an action; a bare `guard` would be
  // a route an employee reaches with no permission at all.
  const bare = [];
  for (const [file] of MOUNTS) {
    const src = fs.readFileSync('src/routes/' + file, 'utf8');
    for (const m of src.matchAll(/receiver\.router\.[a-z]+\((?:base|`\$\{base[^`]*`)\s*,\s*guard\s*,\s*([A-Za-z]+)/g)) {
      if (m[1] !== 'requirePerm') bare.push(file + ': ' + m[0].slice(0, 60));
    }
  }
  c('no route in a shared factory is mounted without an action', bare.length === 0, bare.join(' | '));

  // Whoever drafts the paperwork is credited for it. Every one of these hardcoded
  // 'dashboard' / 'Admin', which would have put the admin's name on an employee's
  // contract the moment the portal could create one.
  // Scoped to the shared factory: rfq.js also holds the admin-only quotation
  // generator, where 'Admin' is the correct answer and must stay.
  for (const [f, fn] of [['contracts.js', 'mountContractRoutes'], ['rfq.js', 'mountRfqRoutes'],
                         ['purchase-orders.js', 'mountPurchaseOrderRoutes'], ['suppliers.js', 'mountSupplierRoutes']]) {
    const src = fs.readFileSync('src/routes/' + f, 'utf8');
    const body = src.slice(src.indexOf(`function ${fn}(`), src.indexOf(`${fn}('/api/dashboard`));
    c(`${f} records who actually created the record`,
      body.length > 100 && !/created_by: 'dashboard'|authorKey: 'admin'/.test(body) && /callerIdentity\(/.test(body));
  }

  // Their Home widgets follow the section now, not the 'admin' gate.
  c('the operations widgets follow their sections rather than being admin-only',
    [['suppliers_top', 'suppliers'], ['rfq_open', 'rfq'], ['po_status', 'purchaseorders'],
     ['contracts_recent', 'contracts'], ['submissions_recent', 'submissions']]
      .every(([id, sec]) => new RegExp(`${id}:\\s+\\{ gate: '${sec}'`).test(HOME)));
  c('…and are off by default, so widening the model granted nobody anything',
    ['suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions']
      .every(k => M.DEFAULT_PERMISSIONS[k] === false));

  // Inventory: the vehicle picker and two Home widgets are real employee surface,
  // and the widgets used to be open to everyone.
  c('inventory is a permission, because the portal really can read it',
    !!M.PERM_ACTIONS.stock && /requirePerm\('stock', 'view'\)/.test(EMP));
  c('…and the stock widgets are no longer open to every employee',
    /stock_summary:\s+\{ gate: 'stock'/.test(HOME) && /stock_models:\s+\{ gate: 'stock'/.test(HOME));
  c('…while staying on by default, so nobody loses it',
    M.DEFAULT_PERMISSIONS.stock === true);
}

// ── Home widgets are gated by the same sections ───────────────────────────────
{
  const gates = [...HOME.matchAll(/^  ([a-z_]+):\s+\{ gate: (.*?),\s+src:/gm)]
    .map(m => [m[1], m[2].trim()]);
  const unknown = gates.filter(([, g]) => {
    if (g === 'null' || g === "'admin'") return false;
    const s = (g.match(/^'([a-z]+)'$/) || g.match(/section: '([a-z]+)'/) || [])[1];
    return !s || !M.PERM_ACTIONS[s];
  });
  c('every Home widget gate names a section the model defines', unknown.length === 0,
    unknown.map(x => x.join('=')).join(', '));
  c("the 'cto' gate is gone, replaced by the issues permission",
    !/gate: 'cto'/.test(HOME) && !/=== 'cto'/.test(HOME) && /section: 'issues'/.test(HOME));
  const byId = Object.fromEntries(gates);
  for (const [id, section] of [['my_tasks', 'tasks'], ['unread_chat', 'chat'], ['calendar', 'calendar'], ['meet_quick', 'meet']]) {
    c(`the ${id} widget follows ${section}`, byId[id] === `'${section}'`, byId[id]);
  }
  // The client keeps a fallback copy for the moment before the server answers.
  const CLIENT = fs.readFileSync('public/assets/home.js', 'utf8');
  const clientPerms = [...CLIENT.matchAll(/^  ([a-z_]+):\s+\{ title:.*?perm: (null|'[a-z]+')/gm)]
    .map(m => [m[1], m[2]]);
  const drift = clientPerms.filter(([id, p]) => {
    const server = byId[id];
    if (server === undefined) return false;
    const s = (server.match(/^'([a-z]+)'$/) || server.match(/section: '([a-z]+)'/) || [])[1];
    return s ? p !== `'${s}'` : (server === 'null' ? p !== 'null' : false);
  });
  c("the client's fallback gates have not drifted from the server's", drift.length === 0,
    drift.map(x => x.join('=')).join(', '));
}

// ── The huddle button obeys the permission, in the portal only ────────────────
{
  const HD = fs.readFileSync('public/assets/huddle.js', 'utf8');
  c('the shared huddle module asks its portal whether huddles are allowed',
    /HDCFG\.can\('chat', 'huddle'\)/.test(HD));
  c('…the dashboard answers yes unconditionally', /can: \(\) => true,/.test(DASH_JS));
  c('…and the portal defers to empCan',
    /can: \(section, action\) => empCan\(section, action\)/.test(PORTAL_JS));
  c('someone already in a call can always leave it',
    /inThis[\s\S]{0,200}huddleLeave\(\)[\s\S]{0,120}!mayHuddle \? ''/.test(HD));
}

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
