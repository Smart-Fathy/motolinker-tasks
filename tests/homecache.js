// Home summary: caching, scan caps, and — the assertion that actually matters —
// that the cache is per user and can never serve a rep the admin's numbers.
//
// This boots the real app and counts the HTTP calls it makes to Supabase, rather
// than stubbing the module: the cache lives between the route and the client, so a
// module-level stub would sit on the wrong side of it and prove nothing.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3994';

const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// ── Fixture ───────────────────────────────────────────────────────────────────
// Employee 2 owns exactly one task and one won deal; the admin sees everything. If
// the cache ever leaks across owners the employee's totals come back as the admin's.
const TASKS = [
  { id: 1, title: 'Admin only', status: 'todo', due_date: '2026-09-01', assignee_ids: [1], created_at: '2026-08-01' },
  { id: 2, title: 'Admin only 2', status: 'done', due_date: null, assignee_ids: [1], created_at: '2026-08-02' },
  { id: 3, title: 'Sara task', status: 'todo', due_date: '2026-09-03', assignee_ids: [2], created_at: '2026-08-03' },
];
const DEALS = [
  { id: 1, stage: 'won', budget_egp: 900000, assigned_to: 1, closed_at: new Date().toISOString(), created_at: '2026-08-01', customers: { assigned_to: 1 } },
  { id: 2, stage: 'won', budget_egp: 100000, assigned_to: 2, closed_at: new Date().toISOString(), created_at: '2026-08-02', customers: { assigned_to: 2 } },
];
const CUSTOMERS = [
  { id: 1, name: 'Ahmed', lead_status: 'hot', assigned_to: 1, created_at: '2026-08-01' },
  { id: 2, name: 'Mona', lead_status: 'warm', assigned_to: 2, created_at: '2026-08-02' },
];

// Flip to make the tasks table overflow the scan cap, for the `partial` assertion.
let floodTasks = false;
// Assigned to employee 3, the owner used for the cap assertion, so the count that
// comes back is the capped scan itself rather than an empty per-user filter.
const BIG = Array.from({ length: 2500 }, (_, i) =>
  ({ id: 1000 + i, title: 't' + i, status: 'todo', due_date: null, assignee_ids: [3], created_at: '2026-01-01' }));

const rowsFor = table => {
  if (table === 'tasks')     return floodTasks ? BIG : TASKS;
  if (table === 'deals')     return DEALS;
  if (table === 'customers') return CUSTOMERS;
  return [];
};

// ── Count what the app asks the database for ─────────────────────────────────
const calls = {};
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const table = (url.match(/\/rest\/v1\/([^?/]+)/) || [])[1] || '?';
  calls[table] = (calls[table] || 0) + 1;
  // `.single()` asks for one object rather than an array; answering with the wrong
  // shape makes supabase-js throw and the route 500 for reasons unrelated to caching.
  const h = (init && init.headers) || {};
  const accept = String(h.Accept || h.accept || '');
  const single = accept.includes('pgrst.object');
  // .limit() travels as a ?limit= query param, and PostgREST honours it. The stub must
  // too, or the cap assertion below would pass just as happily with no limit at all.
  let rows = rowsFor(table);
  const lim = Number(new URL(url).searchParams.get('limit'));
  if (lim > 0) rows = rows.slice(0, lim);
  const body = single ? JSON.stringify(rows[0] || {}) : JSON.stringify(rows);
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');

const base = 'http://127.0.0.1:' + process.env.PORT;
const get = async (p, token) =>
  (await fetch(base + p, { headers: { Authorization: 'Bearer ' + token } })).json();

setTimeout(async () => {
  const { token } = await (await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();

  // Sara: every section on, but scoped to rows assigned to her.
  const allOn = {};
  for (const [k, v] of Object.entries(normEmpPerms({}))) if (typeof v === 'boolean') allOn[k] = true;
  const empToken = 'home-cache-employee';
  ctx.employeeSessions.set(empToken, {
    id: 2, name: 'Sara', username: 'sara', job_title: '',
    permissions: { ...normEmpPerms(allOn), scope: { assignedOnly: true, dealStages: [], leadStatuses: [] } },
  });

  // ── 1. Two loads inside the window are one round trip ───────────────────────
  const a1 = await get('/api/dashboard/home/summary', token);
  const afterFirst = calls.tasks || 0;
  const a2 = await get('/api/dashboard/home/summary', token);
  const afterSecond = calls.tasks || 0;

  check('first admin load queries the database', afterFirst === 1, `tasks=${afterFirst}`);
  check('second admin load inside 60s adds no query', afterSecond === afterFirst, `tasks=${afterSecond}`);
  check('cached response is the same payload', JSON.stringify(a1) === JSON.stringify(a2));
  check('admin sees every task', a1.task_status.reduce((s, r) => s + r.count, 0) === 3,
    JSON.stringify(a1.task_status));

  // ── 2. The cache is per user ────────────────────────────────────────────────
  // This is the assertion that matters: a rep must never be handed the admin's
  // figures out of a shared entry.
  const e1 = await get('/api/employee/home/summary', empToken);
  check('employee load is not served from the admin entry', (calls.tasks || 0) > afterSecond,
    `tasks=${calls.tasks}`);
  check('employee sees only their own task', e1.task_status.reduce((s, r) => s + r.count, 0) === 1,
    JSON.stringify(e1.task_status));
  check('employee won_month is their own, not the company total',
    e1.won_month === 100000 && a1.won_month === 1000000, `emp=${e1.won_month} admin=${a1.won_month}`);
  check('employee my_tasks holds no admin task',
    !e1.my_tasks.some(t => /Admin only/.test(t.title)), JSON.stringify(e1.my_tasks.map(t => t.title)));

  // The employee's own second load caches too, and still does not disturb the admin's.
  const beforeE2 = calls.tasks;
  const e2 = await get('/api/employee/home/summary', empToken);
  check('employee second load is cached', calls.tasks === beforeE2);
  check('employee cached payload is still their own', e2.won_month === 100000);
  const a3 = await get('/api/dashboard/home/summary', token);
  check('admin entry survives the employee load unchanged', a3.won_month === a1.won_month);

  // ── 3. Scan caps are applied and admitted to ────────────────────────────────
  check('a normal load reports nothing partial', Array.isArray(a1.partial) && a1.partial.length === 0,
    JSON.stringify(a1.partial));

  floodTasks = true;
  // A fresh owner key, so the cap is measured on a cache miss rather than a hit.
  const floodToken = 'home-cache-flood';
  ctx.employeeSessions.set(floodToken, {
    id: 3, name: 'Flood', username: 'flood', job_title: '', permissions: normEmpPerms(allOn),
  });
  const f1 = await get('/api/employee/home/summary', floodToken);
  check('a capped scan says so', (f1.partial || []).includes('tasks'), JSON.stringify(f1.partial));
  // 2500 rows exist; exactly HOME_SCAN_CAP come back. Drop the .limit() and this is 2500.
  check('the cap actually bounded the rows', f1.task_status.reduce((s, r) => s + r.count, 0) === 2000,
    JSON.stringify(f1.task_status));

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} home-cache checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}, 3000);
