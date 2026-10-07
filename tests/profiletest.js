// The lead profile is one round trip, and still refuses what it should.
//
// Opening a lead, and refreshing it after every activity, follow-up and status
// change, used to wait for the lead row before starting the six reads that hang
// off it, though all seven only need the id in the URL. They now go out together,
// which moves the 404 and the scope check after the reads instead of before. So
// this pins both: the reads overlap, and a missing or out-of-scope lead still
// gets 404 / 403 with none of the lead's data in the body.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3994';

const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const LEADS = {
  5: { id: 5, name: 'Mine', phone: '0100', assigned_to: 7, lead_status: 'warm', custom_fields: {} },
  6: { id: 6, name: 'Theirs', phone: '0101', assigned_to: 9, lead_status: 'warm', custom_fields: {} },
};
const CHILD = ['lead_activities', 'lead_followups', 'quotations', 'deals', 'contracts', 'purchase_orders'];
const LEAD_DELAY = 300;  // the lead row answers slowly, so overlap is measurable
let log = [];            // { table, at } per request to a profile table

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  if (table === 'customers' && accept.includes('pgrst.object')) {
    log.push({ table, at: Date.now() });
    await new Promise(r => setTimeout(r, LEAD_DELAY));
    const row = LEADS[(u.searchParams.get('id') || '').replace('eq.', '')];
    return row ? json(row) : json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' }, 406);
  }
  if (CHILD.includes(table)) {
    log.push({ table, at: Date.now() });
    const id = Number((u.searchParams.get('customer_id') || '').replace('eq.', ''));
    return json(table === 'lead_activities' ? [{ id: 1, customer_id: id, type: 'call', body: 'Called about the Seal' }] : []);
  }
  return json(accept.includes('pgrst.object') ? {} : []);
};

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
const base = 'http://127.0.0.1:' + process.env.PORT;

ctx.employeeSessions.set('emp-scoped', {
  id: 7, name: 'Sara', username: 'sara', job_title: 'Sales',
  permissions: normEmpPerms({ leads: true, scope: { assignedOnly: true } }),
});
const get = async (path, token) => {
  const r = await realFetch(base + path, { headers: { Authorization: 'Bearer ' + token } });
  return { status: r.status, body: await r.text() };
};

// Did all six child reads start before the lead row came back?
function overlapped() {
  const lead = log.find(e => e.table === 'customers');
  const kids = log.filter(e => e.table !== 'customers');
  return !!lead && kids.length === CHILD.length && kids.every(k => k.at < lead.at + LEAD_DELAY);
}

(async () => {
  await new Promise(r => setTimeout(r, 400)); // let the server start listening
  const login = await realFetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pw' }) }).then(r => r.json());
  const admin = login.token;

  log = [];
  let r = await get('/api/employee/customers/5/profile', 'emp-scoped');
  let d = JSON.parse(r.body);
  c('team: an in-scope lead opens', r.status === 200 && d.customer && d.customer.name === 'Mine', `${r.status}`);
  c('team: with its timeline', Array.isArray(d.activities) && d.activities.length === 1 && d.activities[0].body === 'Called about the Seal');
  c('team: the six reads went out with the lead, not after it', overlapped(), JSON.stringify(log.map(e => e.table)));

  log = [];
  r = await get('/api/employee/customers/6/profile', 'emp-scoped');
  c('team: someone else\'s lead is still refused under "assigned only"', r.status === 403, `${r.status}`);
  c('team: …and the refusal carries none of its data', !/Theirs|Called about/.test(r.body), r.body.slice(0, 120));

  r = await get('/api/employee/customers/404/profile', 'emp-scoped');
  c('team: a missing lead is a 404', r.status === 404, `${r.status}`);
  c('team: …with nothing else in it', !/Called about|activities/.test(r.body), r.body.slice(0, 120));

  log = [];
  r = await get('/api/dashboard/customers/6/profile', admin);
  d = JSON.parse(r.body);
  c('admin: any lead opens', r.status === 200 && d.customer && d.customer.name === 'Theirs', `${r.status}`);
  c('admin: the six reads went out with the lead, not after it', overlapped(), JSON.stringify(log.map(e => e.table)));
  r = await get('/api/dashboard/customers/404/profile', admin);
  c('admin: a missing lead is a 404', r.status === 404, `${r.status}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
