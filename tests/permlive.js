// The permission guards, against the running app.
//
// permstest.js compares the source files to each other, which catches a missing
// guard but cannot prove one works. This boots the real server and asks the same
// endpoints twice — once as an employee who has the section and once as one who
// does not — because the failure that matters is not "is there a requirePerm" but
// "does the request actually get turned away".
//
// The smoke runner already exercises every route with every permission granted, so
// the half it cannot show is this one: that withholding a permission withholds the
// data. A guard that always returns next() passes the smoke run perfectly.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3993';

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// Answer every Supabase read with an empty list. What comes back does not matter
// here — only whether the handler was reached at all.
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  const body = accept.includes('pgrst.object') ? '{}' : '[]';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms, PERM_ACTIONS } = require(process.cwd() + '/src/routes/employee-portal.js');
const base = 'http://127.0.0.1:' + process.env.PORT;

function mint(token, permissions, job_title) {
  ctx.employeeSessions.set(token, {
    id: 7, name: 'Test', username: 'test', job_title: job_title || 'Sales',
    permissions: normEmpPerms(permissions),
  });
  return token;
}
const hit = async (method, path, token) => {
  const r = await fetch(base + path, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: (method === 'GET' || method === 'DELETE') ? undefined : '{}',
  });
  return { status: r.status, text: await r.text() };
};
const refused = r => r.status === 403 && /Not permitted/.test(r.text);

// One representative read and one representative write per section, with the
// action each is guarded by.
const CASES = [
  ['suppliers',      'GET',  '/api/employee/suppliers',              'view'],
  ['suppliers',      'POST', '/api/employee/suppliers',              'create'],
  ['suppliers',      'GET',  '/api/employee/suppliers/1/docs',       'docs'],
  ['suppliers',      'POST', '/api/employee/suppliers/1/vehicles',   'catalogue'],
  ['rfq',            'GET',  '/api/employee/rfqs',                   'view'],
  ['rfq',            'POST', '/api/employee/rfqs',                   'create'],
  ['rfq',            'DELETE', '/api/employee/rfqs/1',               'delete'],
  ['purchaseorders', 'GET',  '/api/employee/purchase-orders',        'view'],
  ['purchaseorders', 'PUT',  '/api/employee/purchase-orders/1',      'edit'],
  ['contracts',      'GET',  '/api/employee/contracts',              'view'],
  ['contracts',      'POST', '/api/employee/contracts',              'create'],
  ['contracts',      'DELETE', '/api/employee/contracts/1',          'delete'],
  ['submissions',    'GET',  '/api/employee/submissions',            'view'],
  ['submissions',    'DELETE', '/api/employee/submissions/1',        'delete'],
  ['stock',          'GET',  '/api/employee/inventory/search?q=bmw', 'view'],
  ['tasks',          'GET',  '/api/employee/my-tasks',               'view'],
  ['deals',          'GET',  '/api/employee/sales',                  'sales'],
  ['deals',          'POST', '/api/employee/sales',                  'salesEdit'],
  ['suppliers',      'GET',  '/api/employee/suppliers/1/purchases',  'purchases'],
  ['hours',          'GET',  '/api/employee/hours',                  'view'],
  ['hours',          'POST', '/api/employee/hours',                  'log'],
  ['chat',           'GET',  '/api/employee/chat/rooms',             'view'],
  ['issues',         'GET',  '/api/employee/issues',                 'view'],
  ['deals',          'GET',  '/api/employee/payments',               'payments'],
  ['deals',          'POST', '/api/employee/payments',               'paymentsEdit'],
];

setTimeout(async () => {
  const allOn = {};
  for (const [k, v] of Object.entries(normEmpPerms({}))) if (typeof v === 'boolean') allOn[k] = true;
  const yes = mint('perm-live-yes', allOn);
  const no  = mint('perm-live-no', {});   // defaults only: every new section off
  const { token: adminToken } = await (await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();

  // ── Granted reaches the handler; withheld is refused ────────────────────────
  const reachedWithout = [], refusedWith = [];
  for (const [section, method, path, action] of CASES) {
    const granted = await hit(method, path, yes);
    if (refused(granted)) refusedWith.push(`${method} ${path} (${section}.${action})`);
    // The default employee has every one of these off — except the ones that are on
    // for the whole team, which are checked separately below.
    if (['suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions', 'issues', 'deals'].includes(section)) {
      const denied = await hit(method, path, no);
      if (!refused(denied)) reachedWithout.push(`${method} ${path} → ${denied.status}`);
    }
  }
  c('every granted action reaches its handler', refusedWith.length === 0, refusedWith.join(' | '));
  c('every withheld section is refused with 403 Not permitted',
    reachedWithout.length === 0, reachedWithout.join(' | '));

  // ── The Inventory actions that are never inherited ──────────────────────────
  // stock.units and stock.tracking cannot ride the section master: Inventory is
  // on for every employee (the vehicle picker needs it), and these two carry
  // what each vehicle cost and which supplier shipped it. So the blanket "grant
  // everything" session above does NOT have them, and they are checked here with
  // a grant of their own — which is also the proof that they are not inherited.
  {
    const withInv = mint('perm-live-inv', {
      stock: true,
      stockActions: { view: true, browse: true, create: false, edit: false, units: true, tracking: true },
    });
    const u = await hit('GET', '/api/employee/units', withInv);
    const t = await hit('GET', '/api/employee/containers', withInv);
    c('a granted vehicle register reaches its handler', !refused(u), String(u.status));
    c('granted container tracking reaches its handler', !refused(t), String(t.status));
    // The default employee holds `stock` and must still be refused both.
    const nu = await hit('GET', '/api/employee/units', no);
    const nt = await hit('GET', '/api/employee/containers', no);
    c('the register is refused without its own grant', refused(nu), String(nu.status));
    c('tracking is refused without its own grant', refused(nt), String(nt.status));
    // Writing a unit is a separate grant again, so read does not imply write.
    const w = await hit('POST', '/api/employee/units', withInv);
    c('reading the register does not carry the right to add to it', refused(w), String(w.status));
  }

  // ── One action at a time ────────────────────────────────────────────────────
  // The master switch being on must not carry the whole section. This is the shape
  // of grant an admin actually makes: "they may read purchase orders, not write".
  {
    const readonly = mint('perm-live-ro', {
      purchaseorders: true,
      purchaseordersActions: { view: true, create: false, edit: false, delete: false, export: false },
    });
    const r = await hit('GET', '/api/employee/purchase-orders', readonly);
    const w = await hit('POST', '/api/employee/purchase-orders', readonly);
    const d = await hit('DELETE', '/api/employee/purchase-orders/1', readonly);
    c('a read-only grant reads', !refused(r), String(r.status));
    c('…and cannot create', refused(w), `${w.status} ${w.text.slice(0, 60)}`);
    c('…and cannot delete', refused(d), String(d.status));
  }

  // ── A tab permission slices inside a section ────────────────────────────────
  // deals.view on, deals.sales explicitly off: the pipeline answers, the Sales
  // tab's endpoint refuses. This is the "sales tab in sales pipeline" grant.
  {
    const tabbed = mint('perm-live-tab', {
      deals: true,
      dealsActions: { view: true, create: true, edit: true, delete: false, move: true, sales: false, salesEdit: false },
    });
    const pipeline = await hit('GET', '/api/employee/deals', tabbed);
    const salesTab = await hit('GET', '/api/employee/sales', tabbed);
    c('deals.view alone still answers the pipeline', !refused(pipeline), String(pipeline.status));
    c('…but the Sales tab endpoint refuses without deals.sales', refused(salesTab), String(salesTab.status));
  }

  // ── Bulk apply, live ────────────────────────────────────────────────────────
  {
    const r = await fetch(base + '/api/dashboard/employees/permissions/bulk', {
      method: 'POST', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_ids: [7], permissions: { leads: true } }) });
    const d = await r.json();
    c('the bulk endpoint answers and normalizes', r.status === 200 && d.updated === 1, JSON.stringify(d));
    const empty = await fetch(base + '/api/dashboard/employees/permissions/bulk', {
      method: 'POST', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_ids: [], permissions: {} }) });
    c('…and refuses an empty target list', empty.status === 400, String(empty.status));
    const asEmp = await hit('POST', '/api/dashboard/employees/permissions/bulk', yes);
    c('…and an employee token cannot reach it', asEmp.status === 401, String(asEmp.status));
  }

  // ── Meet slices too ─────────────────────────────────────────────────────────
  {
    const viewer = mint('perm-live-meet', { meet: true, meetActions: { view: true, schedule: false } });
    const rd = await hit('GET', '/api/employee/meetings', viewer);
    const wr = await hit('POST', '/api/employee/meetings', viewer);
    c('meet.view reads the meeting list', !refused(rd), String(rd.status));
    c('…without meet.schedule, scheduling is refused', refused(wr), String(wr.status));
  }

  // ── Availability writes only the caller's own row ──────────────────────────
  {
    const setter = mint('perm-live-avail', { availability: true, availabilityActions: { view: true, set: true } });
    const r = await fetch(base + '/api/employee/availability', {
      method: 'PUT', headers: { Authorization: 'Bearer perm-live-avail', 'Content-Type': 'application/json' },
      // The body claims to be the admin — the server must ignore that entirely.
      body: JSON.stringify({ week: '2026-08-17', member_key: 'admin', days: [{ status: 'available' }] }) });
    c('an availability PUT is accepted for the caller', r.status === 200, String(r.status));
    const noSet = mint('perm-live-avail-ro', { availability: true, availabilityActions: { view: true, set: false } });
    const denied = await hit('PUT', '/api/employee/availability', noSet);
    c('…and refused without availability.set', refused(denied), String(denied.status));
  }

  // ── The Inventory page is its own grant ─────────────────────────────────────
  // stock is on by default for everyone (the vehicle picker needs it), so the
  // register itself has to be gated on the action, not the section — otherwise
  // the whole team could pull every model and price the company holds.
  {
    const picker = mint('perm-live-stock-ro', { stock: true, stockActions: { view: true, browse: false } });
    const denied = await hit('GET', '/api/employee/stock', picker);
    c('the stock register is refused with the picker grant alone', refused(denied), String(denied.status));
    const browser2 = mint('perm-live-stock-rw', { stock: true, stockActions: { view: true, browse: true } });
    const ok = await hit('GET', '/api/employee/stock', browser2);
    c('…and served with stock.browse', !refused(ok), String(ok.status));
    // Reading the register and keeping it are different jobs.
    const noWrite = await hit('POST', '/api/employee/stock', browser2);
    c('a reader cannot add a vehicle', refused(noWrite), String(noWrite.status));
    const noEdit = await hit('PUT', '/api/employee/stock/1', browser2);
    c('…nor edit one', refused(noEdit), String(noEdit.status));
    const keeper = mint('perm-live-stock-w', { stock: true, stockActions: { view: true, browse: true, create: true, edit: true } });
    const allowed = await hit('POST', '/api/employee/stock', keeper);
    c('…and a keeper is let through to the handler', !refused(allowed), String(allowed.status));
  }

  // ── The admin is never subject to employee permissions ──────────────────────
  // Both portals run the same handlers now. If requirePerm read a missing
  // req.employee as "no permissions", the dashboard would lose these outright.
  {
    const bad = [];
    for (const p of ['/api/dashboard/suppliers', '/api/dashboard/rfqs', '/api/dashboard/sales',
                     '/api/dashboard/purchase-orders', '/api/dashboard/contracts', '/api/submissions']) {
      const r = await hit('GET', p, adminToken);
      if (refused(r) || r.status === 401) bad.push(`${p} → ${r.status}`);
    }
    c('the admin still reaches every one of the shared sections', bad.length === 0, bad.join(', '));
  }

  // ── The CTO keeps Issues without a permission ───────────────────────────────
  {
    const cto = mint('perm-live-cto', {}, 'Chief Technical Officer');
    const r = await hit('GET', '/api/employee/issues', cto);
    c('a CTO reaches the issues centre on their job title alone', !refused(r), String(r.status));
  }

  // ── An unauthenticated request never gets as far as a permission ────────────
  {
    const r = await fetch(base + '/api/employee/suppliers');
    c('no session is 401, not 403', r.status === 401, String(r.status));
  }

  // Every action in the model is covered by at least one live case, or named here
  // as covered elsewhere — so a new action cannot be added without a decision
  // about how it gets proven.
  {
    const covered = new Set(CASES.map(([s, , , a]) => s + '.' + a));
    const ELSEWHERE = {
      // exercised by their own suites, or by the smoke run with a real payload
      leads: '*', deals: '*', quotation: '*', reports: '*', meet: '*',
      requests: '*', drive: '*', sheets: '*', email: '*', calendar: '*', gchat: '*',
      'tasks.create': 1, 'tasks.edit': 1, 'tasks.comment': 1,
      'chat.send': 1, 'chat.edit': 1, 'chat.delete': 1, 'chat.upload': 1, 'chat.huddle': 1,
      'issues.resolve': 1,
      'availability.view': 1, 'availability.set': 1,
      'suppliers.edit': 1, 'suppliers.delete': 1,
      'rfq.edit': 1, 'rfq.export': 1,
      'purchaseorders.create': 1, 'purchaseorders.delete': 1, 'purchaseorders.export': 1,
      'contracts.edit': 1, 'contracts.export': 1,
      'stock.view': 1,                    // the picker and the Home widgets
      'stock.browse': 1, 'stock.create': 1, 'stock.edit': 1,   // checked live above
      'stock.units': 1, 'stock.tracking': 1,  // their own block above — never inherited
      'leads.clientFolder': 1,            // foldertest drives it end to end
    };
    const gaps = [];
    for (const [section, actions] of Object.entries(PERM_ACTIONS)) {
      if (ELSEWHERE[section] === '*') continue;
      for (const a of actions) {
        const key = section + '.' + a;
        if (!covered.has(key) && !ELSEWHERE[key]) gaps.push(key);
      }
    }
    c('every action is either checked live here or accounted for', gaps.length === 0, gaps.join(', '));
  }

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
}, 1200);
