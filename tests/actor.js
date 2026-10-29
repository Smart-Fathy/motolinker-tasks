// Who is acting, and what the new API lets them do.
//
// /api/v1 is guarded by one rule: every route needs an actor (admin or employee), and a route that asks
// for a capability fails CLOSED — no actor is a 401, never a pass. This suite holds that from four sides:
//
//   1. requireCan on its own (mock request/response): 401 without an actor, 403 without the capability,
//      next() with it, and a capability that is not in the catalogue is refused when the route is mounted
//   2. GET /api/v1/me on the booted app, for every kind of caller: nobody, a token nobody issued, the
//      admin, an employee (whose permissions come fresh from their record, not from the session's copy),
//      sessions that exist only in the sessions table (a restart), an expired one, a database that is down
//   3. the inventory: every /api/v1 route in the router is in the table src/http/mount-v1.js keeps, behind
//      requireActor (unless it was declared public on purpose) and behind requireCan(its capability)
//   4. the matrix: every route that can be asked without parameters, asked by each kind of actor, answers
//      what its declaration says it should
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const nowIso = () => new Date().toISOString();
const DAY = 24 * 3600 * 1000;

// ── 1. requireCan, alone ────────────────────────────────────────────────────────────────────────
function unitTests() {
  const C = require('../packages/contracts');
  const { requireCan, actorOf, assertKnownCapability } = require('../src/http/actor');
  const run = (guard, req) => {
    const out = { status: null, body: null, nexted: false };
    const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
    guard(req, res, () => { out.nexted = true; });
    return out;
  };
  const sara = C.employeeActor({ id: 7, name: 'Sara', job_title: 'Sales', permissions: C.normalisePermissions({ leads: true, leadsActions: { view: true } }, { dealStages: [], normStatus: String }) });

  const noActor = run(requireCan('leads.view'), {});
  check('no actor: 401, and the request does not go on', noActor.status === 401 && !noActor.nexted);
  const without = run(requireCan('leads.edit'), { actor: sara });
  check('an actor without the capability: 403, and the request does not go on', without.status === 403 && !without.nexted);
  const withCap = run(requireCan('leads.view'), { actor: sara });
  check('an actor with it: the request goes on', withCap.nexted && withCap.status === null);
  check('the admin holds every capability', run(requireCan('accounting.ai'), { actor: C.adminActor() }).nexted);
  check('actorOf reads req.actor, or says there is none', actorOf({ actor: sara }) === sara && actorOf({}) === null);
  check('the guard is named for its capability, so the route inventory can show it', requireCan('leads.view').name === 'requireCan(leads.view)');
  const refused = ['leads', 'leads.', '.view', 'leads.fly', 'flying.view', 'leads.view.extra', '', 'leads edit'].filter(cap => { try { assertKnownCapability(cap); return false; } catch (_) { return true; } });
  check('a capability that is not in the catalogue is refused when the route is mounted, not when someone calls it', refused.length === 8 && ['leads.view', 'accounting.ai', 'stock.tracking'].every(cap => { try { requireCan(cap); return true; } catch (_) { return false; } }), `${refused.length}/8 refused`);
}

// ── 2–4. The booted app ─────────────────────────────────────────────────────────────────────────
(async () => {
  unitTests();

  const everyAction = on => {
    const { PERM_ACTIONS } = require('../packages/contracts');
    const p = {};
    for (const [s, actions] of Object.entries(PERM_ACTIONS)) { p[s] = on; p[s + 'Actions'] = Object.fromEntries(actions.map(a => [a, on])); }
    return p;
  };
  const employees = [
    { id: 1, name: 'Nada', username: 'nada', email: '', password_hash: 'x', job_title: 'Sales', permissions: { leads: true, leadsActions: { view: true, edit: true } }, avatar_url: '', status_text: '', status_emoji: '' },
    { id: 2, name: 'Omar', username: 'omar', email: '', password_hash: 'x', job_title: 'Ops', permissions: everyAction(false), avatar_url: '', status_text: '', status_emoji: '' },
    { id: 3, name: 'Hana', username: 'hana', email: '', password_hash: 'x', job_title: 'Finance', permissions: everyAction(true), avatar_url: '', status_text: '', status_emoji: '' },
  ];
  const db = createFakeSupabase({ employees, sessions: [], quotation_settings: [], google_tokens: [], push_subscriptions: [], notifications: [] });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3992 });
  const ctx = require(process.cwd() + '/src/ctx');
  const C = require('../packages/contracts');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');

  const session = (id, name, permissions, extra) => ({ id, name, username: name.toLowerCase(), job_title: 'x', permissions: normEmpPerms(permissions), createdAt: Date.now(), ...extra });
  ctx.sessions.set('t-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  // Nada's session still carries what she was given a week ago (no leads); her record says she has leads now.
  ctx.employeeSessions.set('t-nada', session(1, 'Nada', {}));
  ctx.employeeSessions.set('t-omar', session(2, 'Omar', everyAction(false)));
  ctx.employeeSessions.set('t-hana', session(3, 'Hana', everyAction(true)));
  ctx.employeeSessions.set('t-old', session(1, 'Nada', {}, { createdAt: Date.now() - 40 * DAY }));
  const get = async (path, token) => {
    const r = await fetch(base + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    let body = null; try { body = await r.json(); } catch (_) {}
    return { status: r.status, body, retryAfter: r.headers.get('retry-after') };
  };

  const none = await get('/api/v1/me');
  check('/api/v1/me with no token: 401', none.status === 401);
  const junk = await get('/api/v1/me', 'not-a-token-anyone-issued');
  check('…with a token nobody issued: 401 (the sessions table is asked once and has no such token)', junk.status === 401);
  const header = await fetch(base + '/api/v1/me', { headers: { Authorization: 'Basic abc' } });
  check('…with an authorization header that is not a bearer token: 401', header.status === 401);

  const admin = await get('/api/v1/me', 't-admin');
  check('the admin: 200, an admin actor with every capability and every section', admin.status === 200 && admin.body.actor.kind === 'admin' && admin.body.actor.key === 'admin' && admin.body.caps === '*' && admin.body.sections === '*');
  check('…the answer is what the schema says (and carries the workspace)', C.schemas.MeResponse.safeParse(admin.body).success && admin.body.workspace.name === 'MotoLinker');

  const nada = await get('/api/v1/me', 't-nada');
  check('an employee: 200, an employee actor keyed employee_<id>', nada.status === 200 && nada.body.actor.kind === 'employee' && nada.body.actor.key === 'employee_1' && nada.body.actor.name === 'Nada');
  check('…whose permissions come fresh from their record, not from the copy the session was opened with', nada.body.caps.includes('leads.view') && nada.body.caps.includes('leads.edit') && !nada.body.caps.includes('leads.delete') && nada.body.sections.includes('leads'), JSON.stringify(nada.body.caps.filter(c => c.startsWith('leads'))));
  check('…and the session itself is brought up to date, as /check does', ctx.employeeSessions.get('t-nada').permissions.leads === true);
  check('…an employee answer is a valid /me response too', C.schemas.MeResponse.safeParse(nada.body).success);
  const omar = await get('/api/v1/me', 't-omar');
  check('an employee with nothing granted has no capability and no section', omar.status === 200 && omar.body.caps.length === 0 && omar.body.sections.length === 0, JSON.stringify(omar.body.caps.slice(0, 3)));
  const expired = await get('/api/v1/me', 't-old');
  check('an expired session: 401', expired.status === 401);

  // Sessions that live only in the sessions table: what a restart leaves behind.
  db.tables.sessions.push({ token: 'r-hana', kind: 'employee', payload: session(3, 'Hana', {}), created_at: nowIso() });
  db.tables.sessions.push({ token: 'r-admin', kind: 'admin', payload: { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() }, created_at: nowIso() });
  db.tables.sessions.push({ token: 'r-stale', kind: 'admin', payload: { username: 'admin', pwv: 'an-old-password', createdAt: Date.now() }, created_at: nowIso() });
  const rHana = await get('/api/v1/me', 'r-hana');
  check('an employee session that exists only in the table is restored, and answers as that employee', rHana.status === 200 && rHana.body.actor.key === 'employee_3' && rHana.body.caps.length > 50 && ctx.employeeSessions.has('r-hana'));
  const rAdmin = await get('/api/v1/me', 'r-admin');
  check('an admin session that exists only in the table is restored too', rAdmin.status === 200 && rAdmin.body.actor.kind === 'admin' && ctx.sessions.has('r-admin'));
  const rStale = await get('/api/v1/me', 'r-stale');
  check('…and one opened under an earlier admin password is refused, as the legacy guard refuses it', rStale.status === 401);

  db.failing.add('sessions');
  const down = await get('/api/v1/me', 'a-token-the-map-does-not-know');
  check('a token the map does not know while the database is down: 503 with Retry-After, not 401 (nobody is signed out by an outage)', down.status === 503 && !!down.retryAfter);
  const stillIn = await get('/api/v1/me', 't-admin');
  check('…and a session the map does know keeps working through it', stillIn.status === 200);
  db.failing.delete('sessions');

  // 2b. The health route the host asks before it moves traffic to a new deployment (railway.json): public,
  //     light, and independent of the database.
  const http = require('http');
  const asHost = (hostname, path) => new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path, method: 'GET', headers: { Host: hostname } }, res => {
      let body = ''; res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
  const queriesBefore = db.log.length;
  const health = await fetch(base + '/api/v1/health');
  const healthBody = await health.json().catch(() => null);
  check('/api/v1/health with no token: 200 {ok: true, uptime_s}', health.status === 200 && !!healthBody && healthBody.ok === true && Number.isInteger(healthBody.uptime_s) && healthBody.uptime_s >= 0, JSON.stringify(healthBody));
  check('…it is never cached and sets no cookie', health.headers.get('cache-control') === 'no-store' && !health.headers.get('set-cookie'));
  check('…it asks the database nothing', db.log.length === queriesBefore, `${db.log.length - queriesBefore} queries`);
  check('…a token it is handed is not looked at (a public route neither signs anyone in nor out)', (await get('/api/v1/health', 'not-a-token-anyone-issued')).status === 200);
  const fromHost = await asHost('healthcheck.railway.app', '/api/v1/health');
  check('…it answers the hostname the platform asks from (healthcheck.railway.app)', fromHost.status === 200 && JSON.parse(fromHost.body).ok === true, String(fromHost.status));
  for (const t of ['sessions', 'employees', 'quotation_settings']) db.failing.add(t);
  const whileDown = await fetch(base + '/api/v1/health');
  check('…and it answers while the database is down: an outage cannot hold a deploy or a rollback hostage', whileDown.status === 200);
  db.failing.clear();

  // 3. The inventory: nothing under /api/v1 that did not go through v1().
  const { routes } = require('../src/http/mount-v1');
  const receiver = require(process.cwd() + '/index.js');
  const stack = (receiver.app._router || receiver.app.router).stack;
  const live = [];
  for (const layer of stack) if (layer.route && layer.route.path.startsWith('/api/v1/')) {
    for (const m of Object.keys(layer.route.methods)) live.push({ method: m.toUpperCase(), path: layer.route.path, guards: layer.route.stack.slice(0, -1).map(h => h.name) });
  }
  const declared = new Map(routes.map(r => [r.method + ' ' + r.path, r]));
  check('every /api/v1 route in the router was declared through v1() — none went around it', live.length > 0 && live.every(r => declared.has(r.method + ' ' + r.path)) && live.length === routes.length, `${live.length} live, ${routes.length} declared`);
  const unguarded = live.filter(r => { const d = declared.get(r.method + ' ' + r.path); return d && !d.public && r.guards[0] !== 'requireActor'; });
  check('every route that is not declared public starts with requireActor', unguarded.length === 0, unguarded.map(r => r.path).join(', '));
  const missingCap = live.filter(r => { const d = declared.get(r.method + ' ' + r.path); return d && d.cap && !r.guards.includes(`requireCan(${d.cap})`); });
  check('every route that names a capability is behind requireCan for exactly that capability', missingCap.length === 0, missingCap.map(r => r.path).join(', '));
  const knownCaps = routes.filter(r => r.cap).every(r => { try { require('../src/http/actor').assertKnownCapability(r.cap); return true; } catch (_) { return false; } });
  check('every capability a route names is in the permission catalogue', knownCaps);
  const publicOnes = routes.filter(r => r.public).map(r => r.method + ' ' + r.path);
  check('the routes declared public are the ones this suite was told about', JSON.stringify(publicOnes.sort()) === JSON.stringify(['GET /api/v1/health']), publicOnes.join(', '));

  // 4. The matrix: each kind of actor asks each route that can be asked without parameters.
  const NOT_IN_MATRIX = {};   // 'METHOD /path': why it cannot be asked generically — an entry here is a decision, reviewed
  const kinds = [
    ['nobody', null], ['a token nobody issued', 'x-nobody'], ['the admin', 't-admin'],
    ['an employee with nothing', 't-omar'], ['an employee with everything', 't-hana'],
  ];
  let asked = 0; const wrong = []; const skipped = [];
  for (const r of routes) {
    const id = r.method + ' ' + r.path;
    if (r.method !== 'GET' || /:/.test(r.path)) { if (!NOT_IN_MATRIX[id]) skipped.push(id); continue; }
    for (const [label, token] of kinds) {
      const want = r.public ? 'ok' : !token || token === 'x-nobody' ? 401 : token === 't-admin' || token === 't-hana' ? 'ok' : (r.cap ? 403 : 'ok');
      const got = (await get(r.path, token)).status;
      asked++;
      if (want === 'ok' ? !(got >= 200 && got < 300) : got !== want) wrong.push(`${id} as ${label}: ${got}, wanted ${want}`);
    }
  }
  check(`every route that can be asked without parameters answers each kind of actor as it was declared (${asked} questions)`, wrong.length === 0 && asked > 0, wrong.slice(0, 3).join('; '));
  check('…and every route that cannot is on the reviewed list with a reason, not skipped by accident', skipped.length === 0, skipped.join(', '));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
