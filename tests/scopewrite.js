// A data scope ("only my assigned leads") must bind writes, not just reads.
//
// The team portal lists only the leads and deals inside an employee's scope, but the
// write routes checked the section permission alone. A rep limited to their own
// leads could PUT /api/employee/leads/<anyone's id> — edit it, reassign it to
// themselves — or add activities and follow-ups to it, by counting through ids.
// Each write is driven here against a stub database holding one lead, deal and
// follow-up that belong to someone else and one of each that belongs to the rep.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3959';

const REP = 7, OTHER = 99;
const TABLES = {
  customers: [{ id: 5, name: 'Theirs', assigned_to: OTHER, lead_status: 'hot' }, { id: 6, name: 'Mine', assigned_to: REP, lead_status: 'hot' }],
  deals: [{ id: 50, stage: 'negotiation', assigned_to: OTHER, customer_id: 5, customers: { assigned_to: OTHER, lead_status: 'hot' } },
          { id: 60, stage: 'negotiation', assigned_to: REP, customer_id: 6, customers: { assigned_to: REP, lead_status: 'hot' } }],
  lead_followups: [{ id: 70, customer_id: 5, status: 'pending' }, { id: 80, customer_id: 6, status: 'pending' }],
};
const writes = [];
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const method = (init && init.method) || 'GET';
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  const table = (/\/rest\/v1\/([a-z_]+)/.exec(url) || [])[1];
  const idEq = (/[?&]id=eq\.(\d+)/.exec(url) || [])[1];
  let rows = TABLES[table] ? TABLES[table].filter(r => idEq == null || String(r.id) === idEq) : [];
  // Only the records these routes own count; the server's own background writes at
  // boot (sessions, settings) can land in the middle of the first call.
  if (method !== 'GET' && ['customers', 'deals', 'lead_followups', 'lead_activities'].includes(table)) {
    writes.push({ table, method, id: idEq });
  }
  if (method !== 'GET') {
    if (method === 'POST') rows = [{ id: 1000 + writes.length, customer_id: 6, due_at: new Date().toISOString(), ...JSON.parse(String(init.body || '{}')) }];
  }
  const out = accept.includes('pgrst.object') ? (rows[0] || {}) : rows;
  return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
const base = 'http://127.0.0.1:' + process.env.PORT;

(async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/api/push/vapid-public-key'); break; }
    catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  const perms = scope => normEmpPerms({ leads: true, leadsActions: { view: true, edit: true },
    deals: true, dealsActions: { view: true, edit: true, move: true }, ...(scope ? { scope } : {}) });
  ctx.employeeSessions.set('scoped-rep', { id: REP, name: 'Rep', username: 'rep', job_title: 'Sales', permissions: perms({ assignedOnly: true }) });
  ctx.employeeSessions.set('open-rep', { id: REP, name: 'Rep', username: 'rep', job_title: 'Sales', permissions: perms(null) });
  check('the scoped session really carries its scope', !!ctx.employeeSessions.get('scoped-rep').permissions.scope.assignedOnly);

  const call = async (token, method, p, body) => {
    writes.length = 0;
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}) });
    return { status: r.status, wrote: writes.filter(w => w.table !== 'lead_activities' || p.includes('/activities')).length };
  };
  const CASES = [
    ['edit a lead', 'PUT', id => `/api/employee/leads/${id}`, { notes: 'x', assigned_to: REP }, 5, 6],
    ['edit a deal', 'PUT', id => `/api/employee/deals/${id}`, { notes: 'x' }, 50, 60],
    ['log an activity on a lead', 'POST', id => `/api/employee/customers/${id}/activities`, { type: 'note', body: 'called' }, 5, 6],
    ['schedule a follow-up on a lead', 'POST', id => `/api/employee/customers/${id}/followups`, { due_at: '2026-11-01T09:00:00Z', note: 'call back' }, 5, 6],
    ['close a follow-up', 'PUT', id => `/api/employee/followups/${id}`, { status: 'done' }, 70, 80],
  ];
  for (const [what, method, p, body, theirs, mine] of CASES) {
    const out = await call('scoped-rep', method, p(theirs), body);
    check(`a rep scoped to their own leads cannot ${what} that belongs to someone else`, out.status === 403 && out.wrote === 0, JSON.stringify(out));
    const own = await call('scoped-rep', method, p(mine), body);
    check(`…but can on their own`, own.status === 200 && own.wrote > 0, JSON.stringify(own));
  }
  const open = await call('open-rep', 'PUT', '/api/employee/leads/5', { notes: 'x' });
  check('a rep with no scope still edits any lead, as before', open.status === 200 && open.wrote > 0, JSON.stringify(open));

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} scope checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
