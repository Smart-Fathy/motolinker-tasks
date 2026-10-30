// What the website sent us, on the server: the list the two portals' Submissions pages read, and the delete beside it.
//
// The two portals' routes were already one piece of code mounted twice (GET and DELETE, behind each portal's own login and
// the section's `view` / `delete` permissions); this holds what that code does — which rows, in which order, for whom, what a
// failing database answers — so that moving it into src/modules/submissions and putting /api/v1/submissions beside it
// changes nothing for the classic pages, and so that the new routes are held to the same facts plus the ones the classic
// ones never had to be: honest about what went wrong (a database that is down is a 503, and its own words are not sent).
// The public form that creates a submission (POST /api/submissions) is not here: tests/submittest.js holds it.
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

(async () => {
  const BASE_TIME = Date.parse('2026-10-01T09:00:00Z');
  const at = i => new Date(BASE_TIME + i * 60000).toISOString();
  const sub = (id, over = {}) => ({ id, name: `Visitor ${id}`, email: `v${id}@example.com`, phone: `+2010000${String(id).padStart(4, '0')}`, message: `Hello ${id}`, car_interest: 'Tiguan', source: 'website', customer_id: null, created_at: at(id), ...over });
  const seed = () => {
    const rows = [];
    for (let id = 1; id <= 205; id++) rows.push(sub(id));
    // the one the form was matched to a lead for (the database joins the lead's name in; the fake keeps what is stored)
    rows[6] = sub(7, { customer_id: 41, customers: { name: 'Layla Hassan' } });
    return rows;
  };
  const employee = (id, name, title = 'Sales') => ({ id, name, username: name.toLowerCase(), email: '', password_hash: 'x', job_title: title, permissions: {}, avatar_url: '', status_text: '', status_emoji: '' });
  const employees = [employee(61, 'Ana'), employee(62, 'Bo'), employee(63, 'Cy')];
  const db = createFakeSupabase({ employees, sessions: [], quotation_settings: [], google_tokens: [], push_subscriptions: [], notifications: [], presence: [], form_submissions: seed(), customers: [] });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3960 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const reset = () => { db.tables.form_submissions.splice(0, db.tables.form_submissions.length, ...seed()); db.log.length = 0; db.failing.clear(); };

  ctx.sessions.set('sb-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  // Ana has no Submissions at all, Bo may read them, Cy may read and delete them.
  const raw = { 61: {}, 62: { submissions: true, submissionsActions: { view: true } }, 63: { submissions: true, submissionsActions: { view: true, delete: true } } };
  for (const [token, e] of [['sb-ana', employees[0]], ['sb-bo', employees[1]], ['sb-cy', employees[2]]]) {
    ctx.employeeSessions.set(token, { id: e.id, name: e.name, username: e.username, job_title: e.job_title, permissions: normEmpPerms(raw[e.id]), createdAt: Date.now() });
  }
  const call = async (method, path, token) => {
    const r = await fetch(base + path, { method, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
    return { status: r.status, body: json };
  };
  const ids = list => list.map(s => s.id);
  const queries = method => db.log.filter(l => l.method === method && l.table === 'form_submissions').map(l => l.query);
  const stored = id => db.tables.form_submissions.some(s => s.id === id);

  // The portals' own routes, as the classic pages call them.
  const LEGACY = [
    { who: 'the admin', token: 'sb-admin', path: '/api/submissions', wrongPortal: 'sb-cy' },
    { who: 'a team member', token: 'sb-bo', path: '/api/employee/submissions', wrongPortal: 'sb-admin' },
  ];

  // ═══ 1. The classic routes: what they do today ═══════════════════════════════════════════════
  {
    const admin = await call('GET', LEGACY[0].path, 'sb-admin');
    check('the admin\'s list is the newest two hundred, newest first', admin.status === 200 && Array.isArray(admin.body) && admin.body.length === 200 && admin.body[0].id === 205 && admin.body[199].id === 6, `${admin.status} ${admin.body && admin.body.length}`);
    check('…asked of the database as: everything with the lead\'s name joined in, newest first, two hundred at most', queries('GET')[0] === '?select=*%2Ccustomers%28name%29&order=created_at.desc&limit=200', queries('GET')[0]);
    const one = admin.body.find(s => s.id === 7), plain = admin.body.find(s => s.id === 8);
    check('each row carries when it came as submitted_at (the same moment as created_at)', admin.body.every(s => s.submitted_at === s.created_at && s.submitted_at) && plain.submitted_at === at(8));
    check('…and the name of the lead it was matched to, or nothing', one.lead_name === 'Layla Hassan' && one.customer_id === 41 && plain.lead_name === '' && plain.customer_id === null);
    check('…with the form\'s own columns as they were stored', plain.name === 'Visitor 8' && plain.email === 'v8@example.com' && plain.phone === '+20100000008' && plain.message === 'Hello 8' && plain.car_interest === 'Tiguan' && plain.source === 'website');

    const bo = await call('GET', LEGACY[1].path, 'sb-bo');
    check('a team member who may read them is given the same list', bo.status === 200 && JSON.stringify(ids(bo.body)) === JSON.stringify(ids(admin.body)) && bo.body[6].lead_name === admin.body[6].lead_name);
  }

  // ── who may read ──
  {
    const ana = await call('GET', LEGACY[1].path, 'sb-ana');
    check('a team member without the section is refused', ana.status === 403 && ana.body.error === 'Not permitted', JSON.stringify(ana));
    const wrong = [];
    for (const l of LEGACY) {
      for (const [label, token] of [['nobody', null], ['a token nobody issued', 'sb-nobody'], ['the other portal\'s login', l.wrongPortal]]) {
        for (const method of ['GET', 'DELETE']) {
          const path = method === 'GET' ? l.path : l.path + '/3';
          const got = (await call(method, path, token)).status;
          if (got !== 401) wrong.push(`${method} ${path} as ${label}: ${got}`);
        }
      }
    }
    check('nobody, a token nobody issued, and the other portal\'s login are 401 on both routes of both portals', wrong.length === 0, wrong.join('; '));
    check('…and a refused request changes nothing', db.tables.form_submissions.length === 205);
  }

  // ── deleting ──
  reset();
  {
    const admin = await call('DELETE', LEGACY[0].path + '/5', 'sb-admin');
    check('the admin deletes a submission: ok, and it is gone', admin.status === 200 && admin.body.ok === true && !stored(5) && stored(4) && stored(6) && db.tables.form_submissions.length === 204, JSON.stringify(admin));
    check('…as one delete of that row', queries('DELETE').join() === '?id=eq.5', queries('DELETE').join());

    const bo = await call('DELETE', LEGACY[1].path + '/9', 'sb-bo');
    check('a team member who may only read cannot delete', bo.status === 403 && bo.body.error === 'Not permitted' && stored(9));
    const cy = await call('DELETE', LEGACY[1].path + '/9', 'sb-cy');
    check('one who may delete can', cy.status === 200 && cy.body.ok === true && !stored(9));
    const gone = await call('DELETE', LEGACY[0].path + '/9', 'sb-admin');
    check('deleting what is already gone is ok too (a delete of nothing)', gone.status === 200 && gone.body.ok === true);
    const ana = await call('DELETE', LEGACY[1].path + '/10', 'sb-ana');
    check('one without the section cannot, and what they asked for is still there', ana.status === 403 && stored(10));
  }

  // ── a database that is down ──
  reset();
  {
    db.failing.add('form_submissions');
    const list = await call('GET', LEGACY[0].path, 'sb-admin');
    check('a database that cannot be asked is a 500 carrying the database\'s own words (the classic page shows them)', list.status === 500 && /simulated database failure/.test(list.body.error), JSON.stringify(list));
    const del = await call('DELETE', LEGACY[0].path + '/3', 'sb-admin');
    check('…and so is a delete', del.status === 500 && /simulated database failure/.test(del.body.error), JSON.stringify(del));
    db.failing.clear();
  }

  // ═══ 2. /api/v1/submissions: the same rows through the same service ═══════════════════════════
  const { schemas } = require(process.cwd() + '/packages/contracts');
  const V1 = '/api/v1/submissions';
  reset();
  {
    const classic = await call('GET', LEGACY[0].path, 'sb-admin');
    db.log.length = 0;
    const admin = await call('GET', V1, 'sb-admin');
    check('the admin\'s list is { items }: the same two hundred, in the same order as the classic page\'s', admin.status === 200 && Object.keys(admin.body).join() === 'items' && JSON.stringify(ids(admin.body.items)) === JSON.stringify(ids(classic.body)), `${admin.status}`);
    check('…every item is what the contract says a submission is', schemas.SubmissionList.safeParse(admin.body).success);
    check('…asked of the database exactly as the classic page asks', queries('GET').join() === '?select=*%2Ccustomers%28name%29&order=created_at.desc&limit=200', queries('GET').join());
    const one = admin.body.items.find(s => s.id === 7), plain = admin.body.items.find(s => s.id === 8);
    check('…with the lead\'s name flattened out of the join (and the join itself not sent), or empty', one.lead_name === 'Layla Hassan' && one.customer_id === 41 && plain.lead_name === '' && plain.customer_id === null && admin.body.items.every(s => !('customers' in s)));
    check('…and when it came as created_at, which is all it says (submitted_at is the classic page\'s own name for it)', plain.created_at === at(8) && admin.body.items.every(s => !('submitted_at' in s)));

    const bo = await call('GET', V1, 'sb-bo');
    check('a team member who may read them is given the same list', bo.status === 200 && JSON.stringify(ids(bo.body.items)) === JSON.stringify(ids(admin.body.items)));
    const ana = await call('GET', V1, 'sb-ana');
    check('one without the section is refused', ana.status === 403 && ana.body.error === 'Not permitted', JSON.stringify(ana));
    const nobody = await call('GET', V1, null), unknown = await call('GET', V1, 'sb-nobody');
    check('nobody, and a token nobody issued, are 401', nobody.status === 401 && unknown.status === 401);
  }

  // ── a submission with columns the database left empty ──
  reset();
  {
    db.tables.form_submissions.push({ id: 300, name: 'Plain', email: null, phone: null, message: null, car_interest: null, source: null, customer_id: null, created_at: at(300) });
    const list = await call('GET', V1, 'sb-admin');
    const row = list.body.items.find(s => s.id === 300);
    check('a column the database left null is an empty string, so a client never has to ask', row && row.email === '' && row.phone === '' && row.message === '' && row.car_interest === '' && row.source === '' && schemas.Submission.safeParse(row).success, JSON.stringify(row));
  }

  // ── deleting ──
  reset();
  {
    const admin = await call('DELETE', V1 + '/5', 'sb-admin');
    check('the admin deletes a submission: ok, and it is gone', admin.status === 200 && schemas.SubmissionDeleteResult.safeParse(admin.body).success && !stored(5) && db.tables.form_submissions.length === 204, JSON.stringify(admin));
    check('…as one delete of that row', queries('DELETE').join() === '?id=eq.5', queries('DELETE').join());
    const bo = await call('DELETE', V1 + '/9', 'sb-bo');
    check('a team member who may only read cannot delete', bo.status === 403 && stored(9));
    const cy = await call('DELETE', V1 + '/9', 'sb-cy');
    check('one who may delete can', cy.status === 200 && !stored(9));
    const again = await call('DELETE', V1 + '/9', 'sb-admin');
    check('deleting what is already gone is ok too', again.status === 200 && again.body.ok === true);
    const ana = await call('DELETE', V1 + '/10', 'sb-ana'), nobody = await call('DELETE', V1 + '/10', null);
    check('one without the section, and nobody, cannot — and the row is still there', ana.status === 403 && nobody.status === 401 && stored(10));
  }

  // ── an id that is not one ──
  reset();
  {
    db.log.length = 0;
    const bad = [];
    for (const id of ['abc', '1.5', '-1', '1e3', '%20', '99999999999999999999', '5;drop']) {
      const r = await call('DELETE', V1 + '/' + id, 'sb-admin');
      if (r.status !== 400 || r.body.code !== 'invalid') bad.push(`${id}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    check('anything that is not the digits of an id is a 400 — said in the one error shape', bad.length === 0, bad.join('; '));
    check('…and the database is not asked about it (a bigint column would answer with an error of its own)', queries('DELETE').length === 0 && db.tables.form_submissions.length === 205);
  }

  // ── a database that is down ──
  reset();
  {
    db.failing.add('form_submissions');
    const list = await call('GET', V1, 'sb-admin'), del = await call('DELETE', V1 + '/3', 'sb-admin');
    check('a database that cannot be asked is a 503 that says so — a list and a delete both', list.status === 503 && list.body.code === 'unavailable' && del.status === 503 && del.body.code === 'unavailable', JSON.stringify([list.body, del.body]));
    check('…and the database\'s own words are not sent', !/simulated|XX000/.test(JSON.stringify([list.body, del.body])));
    db.failing.clear();
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
