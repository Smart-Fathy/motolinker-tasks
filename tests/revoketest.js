// Changing a password ends the other logins.
//
// The bug: a password change, a "forgot password" reset, an administrator setting a
// new password, and deleting an employee all updated (or removed) the account and
// then left every session token it had issued working — in the in-memory map, in the
// table that survives a restart, on the live event streams, and in the push
// subscriptions. Someone who had the old password, or a stolen token, stayed in.
//
// This boots the real app against an in-memory database and checks all four places.
const http = require('http');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const db = createFakeSupabase({
  employees: [], sessions: [], push_subscriptions: [], notifications: [], password_reset_tokens: [],
  quotation_settings: [], google_tokens: [],
});
// The state a previous deploy left behind, before the app has ever run this code: an
// admin login in the table and an admin push subscription. Booting with an admin
// password the database has no record of is what a rotation looks like from here.
db.tables.sessions.push({ token: 'old-admin-login', kind: 'admin', payload: { username: 'admin' }, created_at: new Date().toISOString() });
db.tables.push_subscriptions.push({ id: 1, member_key: 'admin', endpoint: 'https://push/admin', p256dh: 'x', auth_key: 'y' });
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3987 });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  const json = r => r.json().catch(() => ({}));
  const call = (token, path, opts = {}) => fetch(base + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) } });
  const loginAs = async (username, password, ua = CHROME) => {
    const r = await fetch(base + '/api/employee/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify({ username, password }) });
    return { status: r.status, ...(await json(r)) };
  };
  const alive = async token => (await call(token, '/api/employee/check')).status === 200;
  const sessionRows = id => T.sessions.filter(s => s.kind === 'employee' && String(s.payload.id) === String(id));

  // ── Boot: the admin password the database has never seen ──────────────────
  c('booting with an admin password the database has not seen ends the old admin logins', !T.sessions.some(s => s.kind === 'admin' && s.token === 'old-admin-login'));
  c('…and the admin push subscriptions', !T.push_subscriptions.some(p => p.member_key === 'admin'));
  c('…and remembers the fingerprint, so an ordinary restart changes nothing',
    T.quotation_settings.some(r => r.key === 'admin_pw_version' && r.value === ctx.ADMIN_PW_VERSION));
  const adminLogin = await json(await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'pw' }) }));
  c('the admin can still sign in', !!adminLogin.token);
  const adminRow = T.sessions.find(s => s.token === adminLogin.token);
  c('an admin login is stored with the password fingerprint and the device it came from', adminRow && adminRow.payload.pwv === ctx.ADMIN_PW_VERSION && !!adminRow.payload.device && !!adminRow.payload.sid, JSON.stringify(adminRow && adminRow.payload).slice(0, 120));
  const ADMIN = adminLogin.token;

  // ── Fixtures ─────────────────────────────────────────────────────────────
  T.employees.push(
    { id: 2, name: 'Sara', username: 'sara', email: 'sara@example.com', password_hash: ctx.hashPassword('oldpassword1'), permissions: null, job_title: 'Sales' },
    { id: 3, name: 'Omar', username: 'omar', email: 'omar@example.com', password_hash: ctx.hashPassword('omarpassword1'), permissions: null, job_title: 'Ops' });
  T.push_subscriptions.push(
    { id: 10, member_key: 'employee_2', endpoint: 'https://push/sara-laptop', p256dh: 'x', auth_key: 'y' },
    { id: 11, member_key: 'employee_2', endpoint: 'https://push/sara-phone', p256dh: 'x', auth_key: 'y' },
    { id: 12, member_key: 'employee_3', endpoint: 'https://push/omar', p256dh: 'x', auth_key: 'y' });

  const A = await loginAs('sara', 'oldpassword1', CHROME);     // the device that will change the password
  const B = await loginAs('sara', 'oldpassword1', SAFARI);     // her phone
  const C = await loginAs('sara', 'oldpassword1', ANDROID);    // someone else's phone, with her password
  const O = await loginAs('omar', 'omarpassword1', CHROME);    // a colleague — must never be touched
  c('three logins for one employee are three different tokens', A.token && B.token && C.token && new Set([A.token, B.token, C.token]).size === 3);
  c('each session records its device, so a person can recognise it',
    sessionRows(2).map(s => s.payload.device).sort().join('|') === 'Chrome on Android|Chrome on Windows|Safari on iOS', sessionRows(2).map(s => s.payload.device).join('|'));
  c('…and the address and start time', sessionRows(2).every(s => s.payload.ip && s.payload.createdAt && s.payload.sid));

  // Live streams opened with the phone's and the laptop's tokens.
  const openStream = (path, token) => new Promise(resolve => {
    const state = { open: true, got: '' };
    const req = http.get(base + path, { headers: { Authorization: 'Bearer ' + token } }, res => {
      res.on('data', d => { state.got += d; });
      res.on('close', () => { state.open = false; });
      res.on('end', () => { state.open = false; });
      setTimeout(() => resolve({ state, req }), 150);
    });
    req.on('error', () => { state.open = false; });
  });
  const notifB = await openStream('/api/employee/notifications/stream', B.token);
  const chatC  = await openStream('/api/employee/chat/events', C.token);
  const notifA = await openStream('/api/employee/notifications/stream', A.token);
  c('the streams are open before the password changes', notifB.state.open && chatC.state.open && notifA.state.open && /:ok/.test(notifB.state.got));

  // ── A wrong current password changes nothing ─────────────────────────────
  const bad = await call(A.token, '/api/employee/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'nope-nope-1', newPassword: 'brandnewpass1' }) });
  c('a wrong current password is refused', bad.status === 401);
  c('…and signs nobody out', await alive(B.token) && await alive(C.token));

  // ── The change itself ────────────────────────────────────────────────────
  const ch = await call(A.token, '/api/employee/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'oldpassword1', newPassword: 'brandnewpass1' }) });
  const chBody = await json(ch);
  c('changing the password succeeds', ch.status === 200 && chBody.ok === true, JSON.stringify(chBody));
  c('…and reports the two other devices it signed out', chBody.sessionsRevoked === 2 && !chBody.warning, JSON.stringify(chBody));
  c('the device that changed it stays signed in', await alive(A.token));
  c('the other two devices are signed out', !(await alive(B.token)) && !(await alive(C.token)));
  c('a colleague is untouched', await alive(O.token));
  c('the table keeps the changing device and the colleague, and nothing else of Sara\'s', sessionRows(2).length === 1 && sessionRows(2)[0].token === A.token && sessionRows(3).length === 1,
    `${sessionRows(2).length} of Sara's, ${sessionRows(3).length} of Omar's`);
  await sleep(150);
  c('the phone\'s live notification stream was hung up', notifB.state.open === false);
  c('the other phone\'s live chat stream was hung up', chatC.state.open === false);
  c('the changing device\'s own stream stays open', notifA.state.open === true);
  c('push subscriptions registered by the signed-out devices are gone', !T.push_subscriptions.some(p => p.member_key === 'employee_2'));
  c('a colleague\'s push subscription is untouched', T.push_subscriptions.some(p => p.member_key === 'employee_3'));
  c('the old password no longer signs in', (await loginAs('sara', 'oldpassword1')).status === 401);
  const fresh = await loginAs('sara', 'brandnewpass1');
  c('the new password does', !!fresh.token);

  // A revoked token cannot come back through the table: a row a racing read could
  // still return, issued before the revoke, is refused; one issued after is accepted.
  const floor = Date.now();
  T.sessions.push({ token: 'ghost-before', kind: 'employee', payload: { id: 2, name: 'Sara', username: 'sara', createdAt: floor - 60_000 }, created_at: new Date(floor - 60_000).toISOString() });
  T.sessions.push({ token: 'fresh-after', kind: 'employee', payload: { id: 2, name: 'Sara', username: 'sara', createdAt: floor + 60_000 }, created_at: new Date(floor + 60_000).toISOString() });
  c('a session row issued before the revoke is refused if it turns up again', !(await alive('ghost-before')));
  c('a session issued after it is accepted (this is also what a restart looks like)', await alive('fresh-after'));

  // ── Guessing the current password from inside a borrowed session ─────────
  let last;
  for (let i = 0; i < 5; i++) last = await call(A.token, '/api/employee/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'guess-' + i + '-xx', newPassword: 'whatever-123' }) });
  const locked = await call(A.token, '/api/employee/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'brandnewpass1', newPassword: 'another-pass-1' }) });
  c('after five wrong "current password" guesses the form is locked, even for the right one', locked.status === 429 && !!locked.headers.get('retry-after'), String(locked.status));

  // ── Forgot-password reset: nobody stays signed in ────────────────────────
  const D = await loginAs('sara', 'brandnewpass1', SAFARI);
  const E = await loginAs('sara', 'brandnewpass1', ANDROID);
  const future = new Date(Date.now() + 3600_000).toISOString();
  T.password_reset_tokens.push(
    { id: 1, employee_id: 2, token: 'link-1', expires_at: future, used: false },
    { id: 2, employee_id: 2, token: 'link-2-older-email', expires_at: future, used: false },
    { id: 3, employee_id: 3, token: 'omars-link', expires_at: future, used: false });
  const rs = await fetch(base + '/api/employee/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'link-1', newPassword: 'resetpass-123' }) });
  const rsBody = await json(rs);
  c('a reset link sets the password', rs.status === 200 && rsBody.ok === true, JSON.stringify(rsBody));
  c('…and every login Sara had is over — the reset cannot be a way to stay in', !(await alive(A.token)) && !(await alive(D.token)) && !(await alive(E.token)) && !(await alive('fresh-after')) && sessionRows(2).length === 0, `${sessionRows(2).length} left`);
  c('an older emailed link is spent too', T.password_reset_tokens.find(t => t.token === 'link-2-older-email').used === true);
  c('…and cannot set a password afterwards', (await fetch(base + '/api/employee/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'link-2-older-email', newPassword: 'attacker-pass-1' }) })).status === 400);
  c('…nor can the link that was used', (await fetch(base + '/api/employee/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'link-1', newPassword: 'attacker-pass-1' }) })).status === 400);
  c('a colleague\'s link and session are untouched', T.password_reset_tokens.find(t => t.token === 'omars-link').used === false && await alive(O.token));
  c('the reset password signs in', !!(await loginAs('sara', 'resetpass-123')).token);

  // ── An administrator sets the password ───────────────────────────────────
  const F = await loginAs('sara', 'resetpass-123', CHROME);
  const edit = (body) => call(ADMIN, '/api/dashboard/employees/2', { method: 'PUT', body: JSON.stringify({ name: 'Sara', username: 'sara', email: 'sara@example.com', job_title: 'Sales', ...body }) });
  c('an admin edit that leaves the password alone signs nobody out', (await edit({ job_title: 'Sales lead' })).status === 200 && await alive(F.token));
  c('an admin setting a new password does', (await edit({ password: 'set-by-admin-1' })).status === 200 && !(await alive(F.token)));
  c('…and the admin-set password works', !!(await loginAs('sara', 'set-by-admin-1')).token);

  // ── Removing an employee ─────────────────────────────────────────────────
  c('before deletion the colleague is signed in', await alive(O.token));
  c('an administrator deletes the employee', (await call(ADMIN, '/api/dashboard/employees/3', { method: 'DELETE' })).status === 200);
  c('a deleted employee\'s login stops working immediately', !(await alive(O.token)));
  c('…and its row is gone', sessionRows(3).length === 0);

  // ── Sessions still end the old ways, and still expire ────────────────────
  const G = await loginAs('sara', 'set-by-admin-1');
  c('signing out still signs out', (await call(G.token, '/api/employee/logout', { method: 'POST' })).status === 200 && !(await alive(G.token)));
  const H = await loginAs('sara', 'set-by-admin-1');
  ctx.employeeSessions.get(H.token).createdAt = Date.now() - 31 * 864e5;
  c('a session already in memory is refused once it is 30 days old (it used to live as long as the process)', !(await alive(H.token)));

  // ── The admin password fingerprint ───────────────────────────────────────
  ctx.sessions.get(ADMIN).pwv = 'a-different-password';
  c('an admin session whose password fingerprint no longer matches is refused', (await call(ADMIN, '/api/auth/check')).status === 401);

  notifA.req.destroy();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} revocation checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
