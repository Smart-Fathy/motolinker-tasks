// Persisted sessions, against the running app.
//
// The bug class: sessions lived only in two in-memory Maps, so every deploy
// logged the whole company out — and the portals kept the dead token in
// localStorage, which surfaced as blank pages and raw 401 bodies. The server
// now writes sessions through to a table and reads unknown tokens back once.
//
// The Maps here start EMPTY (a fresh boot); only the stubbed sessions table
// knows the tokens. Every accepted request below therefore proves the
// read-through path, not the Map.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3992';

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// ── A minimal sessions table ──────────────────────────────────────────────────
const rows = new Map();   // token -> row
rows.set('restored-admin',    { token: 'restored-admin', kind: 'admin',    payload: { username: 'admin' }, created_at: new Date().toISOString() });
rows.set('restored-employee', { token: 'restored-employee', kind: 'employee',
  payload: { id: 2, name: 'Sara', username: 'sara', job_title: '', permissions: null }, created_at: new Date().toISOString() });
rows.set('expired-employee',  { token: 'expired-employee', kind: 'employee',
  payload: { id: 2, name: 'Sara', username: 'sara', job_title: '', permissions: null },
  created_at: new Date(Date.now() - 40 * 864e5).toISOString() });
rows.set('wrong-kind', { token: 'wrong-kind', kind: 'employee', payload: { id: 2 }, created_at: new Date().toISOString() });

const writes = { upserts: [], deletes: [] };
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const table = (url.match(/\/rest\/v1\/([^?/]+)/) || [])[1] || '?';
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  const single = accept.includes('pgrst.object');
  const method = (init && init.method) || 'GET';
  const q = new URL(url).searchParams;

  if (table === 'sessions') {
    const tokenEq = (q.get('token') || '').replace('eq.', '');
    if (method === 'DELETE') { writes.deletes.push(tokenEq); rows.delete(tokenEq); return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    if (method === 'POST') { const b = JSON.parse(init.body); const r = Array.isArray(b) ? b[0] : b; writes.upserts.push(r); rows.set(r.token, r); return new Response(single ? JSON.stringify(r) : JSON.stringify([r]), { status: 201, headers: { 'Content-Type': 'application/json' } }); }
    const hit = rows.get(tokenEq);
    const body = single ? JSON.stringify(hit || {}) : JSON.stringify(hit ? [hit] : []);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const body = single ? '{}' : '[]';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

require(process.cwd() + '/index.js');
const base = 'http://127.0.0.1:' + process.env.PORT;
const hit = async (p, token) =>
  fetch(base + p, { headers: { Authorization: 'Bearer ' + token } });

setTimeout(async () => {
  // 1. A token only the table knows is accepted — the restart survival itself.
  const a = await hit('/api/auth/check', 'restored-admin');
  c('an admin session survives a restart via the table', a.status === 200, String(a.status));

  const e = await hit('/api/employee/tasks', 'restored-employee');
  c('an employee session survives a restart via the table', e.status !== 401, String(e.status));

  // 2. The read-through happens once; afterwards the Map answers.
  const before = writes.upserts.length;
  const reads = rows.get('restored-admin');
  rows.delete('restored-admin');   // gone from the "DB" — only the Map has it now
  const a2 = await hit('/api/auth/check', 'restored-admin');
  c('…and is cached in memory afterwards', a2.status === 200, String(a2.status));
  rows.set('restored-admin', reads);

  // 3. Expiry: a 30-day-old row is refused and cleaned up.
  const ex = await hit('/api/employee/tasks', 'expired-employee');
  c('a 30-day-old session is refused', ex.status === 401, String(ex.status));
  c('…and deleted from the table', writes.deletes.includes('expired-employee'), writes.deletes.join(','));

  // 4. Kind mismatch: an employee token is not an admin token.
  const wk = await hit('/api/auth/check', 'wrong-kind');
  c('an employee session cannot authenticate as admin', wk.status === 401, String(wk.status));

  // 5. Login writes through; logout deletes.
  const login = await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) });
  const { token } = await login.json();
  await new Promise(r => setTimeout(r, 150));   // write-through is fire-and-forget
  c('login persists the session', writes.upserts.some(u => u.token === token && u.kind === 'admin'),
    writes.upserts.map(u => u.kind).join(','));
  await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  await new Promise(r => setTimeout(r, 150));
  c('logout deletes the persisted session', writes.deletes.includes(token));

  // 6. Google disconnects persist as nulled token rows (the resurrection bug).
  const src = require('fs').readFileSync('index.js', 'utf8');
  c('admin drive disconnect persists', /api\/drive\/disconnect[\s\S]{0,200}saveGoogleToken\('admin_drive', null\)/.test(src));
  c('admin gmail disconnect persists', /gmailTokens = null;\s*\n\s*saveGoogleToken\('admin_gmail', null\)/.test(src));
  c('employee drive disconnect persists', /employeeDriveTokens\.delete\(req\.employee\.id\); saveGoogleToken\(`\$\{req\.employee\.id\}_drive`, null\)/.test(src));
  c('employee gmail disconnect persists', /employeeEmailTokens\.delete\(req\.employee\.id\); saveGoogleToken\(`\$\{req\.employee\.id\}_gmail`, null\)/.test(src));
  c('a nulled token row is not restored at boot', /if \(!t\) continue;/.test(src));

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
}, 1200);
