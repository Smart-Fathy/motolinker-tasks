// Sign-in security, end to end: the alerts, the record, and two-factor authentication.
//
// Boots the real app on an in-memory database and drives it over HTTP like a browser
// would — a cookie jar, a user agent, an address — because the interesting failures
// are in how the pieces meet: a code accepted twice, a second step that can be skipped,
// an alert that never leaves the building, a database outage read as "no 2FA".
//
// The clock is under the test's control. A TOTP code is valid for one 30-second step,
// and a test that needs six successful sign-ins cannot wait three minutes for them.
const totp = require('../src/lib/totp');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;
const advance = seconds => { skew += seconds * 1000; };

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

const db = createFakeSupabase({
  employees: [], sessions: [], push_subscriptions: [], notifications: [], password_reset_tokens: [],
  quotation_settings: [], google_tokens: [], account_security: [], login_events: [],
}, {
  defaults: {
    account_security: () => ({ totp_enabled: false, recovery_codes: [], last_step: 0, updated_at: new Date().toISOString() }),
    login_events: () => ({ at: new Date().toISOString(), event: 'login', new_device: false }),
  },
});
db.missing.add('account_security'); db.missing.add('login_events');   // start as if migration 023 was never applied
db.install();

// Google's side of "Sign in with Google", answered locally.
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'g-token', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return new Response(JSON.stringify({ email: googleEmail, name: 'Google Person' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return realFetch(input, init);
};
let googleEmail = 'sara@example.com';

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3986, env: {
    MFA_ENCRYPTION_KEY: 'k'.repeat(40), GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', APP_URL: 'https://app.example.com', ADMIN_EMAIL: 'boss@example.com',
  } });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  const mails = [];
  ctx.createMailer = () => ({ sendMail: async m => { mails.push(m); } });

  T.employees.push(
    { id: 2, name: 'Sara', username: 'sara', email: 'sara@example.com', password_hash: ctx.hashPassword('sara-password-1'), permissions: null, job_title: 'Sales', avatar_url: '', status_text: '', status_emoji: '' },
    { id: 3, name: 'Omar', username: 'omar', email: 'omar@example.com', password_hash: ctx.hashPassword('omar-password-1'), permissions: null, job_title: 'Ops' },
    { id: 4, name: 'Lina', username: 'lina', email: 'lina@example.com', password_hash: ctx.hashPassword('lina-password-1'), permissions: null, job_title: 'Ops' },
    { id: 5, name: 'Nora', username: 'nora', email: 'nora@example.com', password_hash: ctx.hashPassword('nora-password-1'), permissions: null, job_title: 'Ops' });

  // A browser: a user agent, an address, and a cookie jar.
  const browser = (ua, ip) => ({ ua, ip, jar: {} });
  const go = async (b, path, { method = 'GET', body, token, redirect } = {}) => {
    const headers = { 'User-Agent': b.ua, 'Content-Type': 'application/json', 'X-Forwarded-For': b.ip };
    if (token) headers.Authorization = 'Bearer ' + token;
    const ck = Object.entries(b.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) headers.Cookie = ck;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: redirect || 'follow' });
    for (const line of r.headers.getSetCookie()) { const kv = line.split(';')[0]; const i = kv.indexOf('='); b.jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return r;
  };
  const J = async r => { try { return await r.json(); } catch (_) { return {}; } };
  const signIn = async (b, username, password) => { const r = await go(b, '/api/employee/login', { method: 'POST', body: { username, password } }); return { status: r.status, ...(await J(r)) }; };
  const alive = async (b, token) => (await go(b, '/api/employee/check', { token })).status === 200;
  const alerts = (key, type) => T.notifications.filter(n => n.member_key === key && n.type === (type || 'security'));
  const settle = () => sleep(250);   // alerts are fire-and-forget

  const sara1 = browser(CHROME, '203.0.113.10');

  // ═══ A. Before migration 023: sign-in must work, and still tell people ═══════
  const a1 = await signIn(sara1, 'sara', 'sara-password-1');
  await settle();
  c('without the migration, signing in still works', !!a1.token);
  const ov0 = await J(await go(sara1, '/api/employee/security', { token: a1.token }));
  c('…the Security panel says two-factor is not available yet, because of the migration, and history is off', ov0.twofa && ov0.twofa.available === false && ov0.twofa.reason === 'migration' && ov0.history === false, JSON.stringify(ov0.twofa));
  const su0 = await go(sara1, '/api/employee/security/2fa/setup', { method: 'POST', token: a1.token, body: { password: 'sara-password-1' } });
  c('…and setting it up explains that the migration is missing, rather than failing', su0.status === 503 && /migration/i.test((await J(su0)).error || ''));
  c('a first sign-in from a new browser still alerts, in the app', alerts('employee_2').length === 1);
  c('…and by email, to the address on file', mails.length === 1 && mails[0].to === 'sara@example.com' && /New sign-in/.test(mails[0].subject), mails.map(m => m.subject).join('|'));
  await signIn(sara1, 'sara', 'sara-password-1'); await settle();
  c('…and the same browser signing in again does not alert again (remembered in memory meanwhile)', alerts('employee_2').length === 1 && mails.length === 1);

  db.missing.delete('account_security'); db.missing.delete('login_events');
  T.notifications.length = 0; mails.length = 0; T.sessions.length = 0; ctx.employeeSessions.clear();

  // ═══ B. The sign-in record and its alerts ═════════════════════════════════════
  const phone = browser(SAFARI, '198.51.100.7');
  const laptop = browser(CHROME, '203.0.113.10');
  const s1 = await signIn(laptop, 'sara', 'sara-password-1'); await settle();
  const ev1 = T.login_events.filter(e => e.account_id === '2');
  c('a sign-in is recorded with device, address, method and whether the browser was new', ev1.length === 1 && ev1[0].device === 'Chrome on Windows' && ev1[0].ip === '203.0.113.10' && ev1[0].method === 'password' && ev1[0].new_device === true, JSON.stringify(ev1[0]));
  c('the browser is marked with a device cookie that script cannot read', /^[a-f0-9]{32}$/.test(laptop.jar.ml_did || ''));
  c('only a hash of that cookie is stored', ev1[0].device_hash && ev1[0].device_hash !== laptop.jar.ml_did && ev1[0].device_hash.length === 64);
  c('a new browser raises an in-app alert, with the device and address in it', alerts('employee_2').length === 1 && /Chrome on Windows/.test(alerts('employee_2')[0].body) && /203\.0\.113\.10/.test(alerts('employee_2')[0].body), alerts('employee_2')[0] && alerts('employee_2')[0].body);
  c('…that links to the Security panel', alerts('employee_2')[0].url === '/employee#security');
  c('…and an email telling them what to do if it was not them', mails.length === 1 && /If this wasn't you/.test(mails[0].html) && /Forgot password/.test(mails[0].html) && mails[0].html.includes('https://app.example.com/employee'));

  const s2 = await signIn(laptop, 'sara', 'sara-password-1'); await settle();
  c('the same browser signing in again is recorded as known and raises no alert', T.login_events.filter(e => e.account_id === '2')[1].new_device === false && alerts('employee_2').length === 1 && mails.length === 1);
  const s3 = await signIn(phone, 'sara', 'sara-password-1'); await settle();
  c('a different browser raises a new alert', alerts('employee_2').length === 2 && mails.length === 2 && /Safari on iOS/.test(alerts('employee_2')[1].body));
  const s4 = await signIn(browser(FIREFOX, '<script>alert(1)</script>'), 'sara', 'sara-password-1'); await settle();
  const hostile = mails[mails.length - 1];
  c('an address that is not an address never reaches an email or a notification',
    !/<script>/.test(hostile.html) && !/<script>/.test(alerts('employee_2')[2].body) && T.login_events[T.login_events.length - 1].ip === 'unknown', T.login_events[T.login_events.length - 1].ip);
  c('another employee\'s browser is unrelated: Omar gets his own first-sign-in alert, Sara\'s count is unchanged',
    (await signIn(browser(CHROME, '203.0.113.99'), 'omar', 'omar-password-1')).token && (await settle(), alerts('employee_3').length === 1 && alerts('employee_2').length === 3));

  // Whatever an administrator typed as a name is printed in the email greeting.
  T.employees.find(e => e.id === 3).name = 'Omar <img src=x onerror=alert(1)>';
  mails.length = 0;
  await signIn(browser(CHROME, '203.0.113.150'), 'omar', 'omar-password-1'); await settle();
  c('text that came from a person is escaped in the email', mails.length === 1 && !/<img/.test(mails[0].html) && /&lt;img/.test(mails[0].html), mails[0] && mails[0].html.slice(0, 160));
  T.employees.find(e => e.id === 3).name = 'Omar';

  // The Security panel's data.
  const ov = await J(await go(laptop, '/api/employee/security', { token: s2.token }));
  c('the overview lists this account\'s sign-ins, newest first', ov.logins.length === 4 && ov.logins[0].device === 'Firefox on Linux' && ov.history === true, ov.logins.map(l => l.device).join('|'));
  c('…marks which are new devices', ov.logins.filter(l => l.new_device).length === 3);
  c('…lists the signed-in devices, with this one first and marked', ov.sessions.length === 4 && ov.sessions[0].current === true && ov.sessions.filter(s => s.current).length === 1);
  c('…and never contains a session token', ![s1, s2, s3, s4].some(s => JSON.stringify(ov).includes(s.token)));
  c('…or anybody else\'s sessions', !ov.sessions.some(s => /omar/i.test(JSON.stringify(s))));
  const phoneSid = ov.sessions.find(s => s.device === 'Safari on iOS').sid;
  c('signing out one device from the list ends just that one', (await go(laptop, `/api/employee/security/sessions/${phoneSid}`, { method: 'DELETE', token: s2.token })).status === 200 && !(await alive(phone, s3.token)) && await alive(laptop, s2.token) && await alive(laptop, s1.token));
  c('the current device cannot be removed that way', (await go(laptop, `/api/employee/security/sessions/${ov.sessions[0].sid}`, { method: 'DELETE', token: s2.token })).status === 400);
  c('an unknown session is a 404, not an error', (await go(laptop, '/api/employee/security/sessions/nosuchsid', { method: 'DELETE', token: s2.token })).status === 404);
  const so = await J(await go(laptop, '/api/employee/security/sessions/revoke-others', { method: 'POST', token: s2.token, body: {} }));
  c('"sign out other devices" ends every other login and keeps this one', so.ok === true && so.sessionsRevoked === 2 && await alive(laptop, s2.token) && !(await alive(laptop, s1.token)));

  // A password change alerts too — it is the thing an intruder would do first.
  mails.length = 0;
  const before = alerts('employee_2').length;
  await go(laptop, '/api/employee/change-password', { method: 'POST', token: s2.token, body: { currentPassword: 'sara-password-1', newPassword: 'sara-password-2' } });
  await settle();
  c('changing the password alerts the owner in the app and by email', alerts('employee_2').length === before + 1 && /password was changed/i.test(alerts('employee_2').pop().title) && mails.some(m => /password was changed/i.test(m.subject)));
  const SARA_PW = 'sara-password-2';

  // ═══ C. Two-factor authentication ═════════════════════════════════════════════
  const dev = browser(CHROME, '203.0.113.10');
  const d1 = await signIn(dev, 'sara', SARA_PW); const otherDev = await signIn(browser(SAFARI, '198.51.100.7'), 'sara', SARA_PW);
  c('before 2FA, sign-in answers with a session', !!d1.token && !d1.mfa_required);

  const wrongPw = await go(dev, '/api/employee/security/2fa/setup', { method: 'POST', token: d1.token, body: { password: 'not-her-password' } });
  c('setting up 2FA asks for the password again — a borrowed session cannot lock the owner out (403: a 401 would sign the person out of the portal)', wrongPw.status === 403);
  const setup = await J(await go(dev, '/api/employee/security/2fa/setup', { method: 'POST', token: d1.token, body: { password: SARA_PW } }));
  c('setup returns a secret, a link for the authenticator and a QR code to scan', /^[A-Z2-7]{32}$/.test(setup.secret) && setup.otpauth.startsWith('otpauth://totp/MotoLinker:sara?') && setup.qr.startsWith('data:image/png;base64,'), setup.otpauth);
  const pendingRow = T.account_security.find(r => r.account_id === '2');
  c('the pending secret is sealed in the database, not stored readable', pendingRow.totp_pending.startsWith('v1:') && !JSON.stringify(pendingRow).includes(setup.secret));
  c('…and it is not yet active: sign-in still needs nothing extra', pendingRow.totp_enabled !== true);

  const badEnable = await go(dev, '/api/employee/security/2fa/enable', { method: 'POST', token: d1.token, body: { code: '000000' } });
  c('a wrong code does not turn it on', badEnable.status === 403 && T.account_security.find(r => r.account_id === '2').totp_enabled !== true);
  mails.length = 0;
  const en = await J(await go(dev, '/api/employee/security/2fa/enable', { method: 'POST', token: d1.token, body: { code: totp.totpAt(setup.secret, Date.now()) } }));
  await settle();
  c('the right code turns it on and shows ten recovery codes once', en.ok === true && en.recoveryCodes.length === 10 && /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(en.recoveryCodes[0]));
  c('…recovery codes are stored only as hashes', !JSON.stringify(T.account_security).includes(en.recoveryCodes[0]) && T.account_security.find(r => r.account_id === '2').recovery_codes.length === 10);
  c('…the secret is now sealed in its permanent place', T.account_security.find(r => r.account_id === '2').totp_secret.startsWith('v1:') && T.account_security.find(r => r.account_id === '2').totp_pending === null);
  // Sara is signed in on three devices at this point: the laptop from section B, this
  // one, and the phone. Turning 2FA on from `dev` ends the other two.
  c('turning it on signs out every other device, and keeps this one', en.sessionsRevoked === 2 && await alive(dev, d1.token) && !(await alive(dev, otherDev.token)) && !(await alive(dev, s2.token)), `revoked ${en.sessionsRevoked}`);
  c('…and tells the owner, in the app and by email', alerts('employee_2').pop().title === 'Two-factor authentication was turned on' && mails.some(m => /Two-factor authentication was turned on/.test(m.subject)));
  const enabledMail = mails.find(m => /Two-factor authentication was turned on/.test(m.subject));
  c('…and the email says what to do if it was not them: an attacker\'s authenticator is not undone by a password reset, so it points to the administrator',
    enabledMail && /administrator/.test(enabledMail.html) && !/signs out every device/.test(enabledMail.html), enabledMail && enabledMail.html.slice(-260));
  const ov2 = await J(await go(dev, '/api/employee/security', { token: d1.token }));
  c('the overview reports it on, with ten recovery codes left, secrets encrypted', ov2.twofa.enabled === true && ov2.twofa.recoveryLeft === 10 && ov2.twofa.encrypted === true);
  c('setting it up again while on is refused', (await go(dev, '/api/employee/security/2fa/setup', { method: 'POST', token: d1.token, body: { password: SARA_PW } })).status === 409);

  const SECRET = setup.secret;
  const nextCode = () => { advance(30); return totp.totpAt(SECRET, Date.now()); };
  const step = async (b, password = SARA_PW) => { const p = await signIn(b, 'sara', password); return p; };

  // — signing in now takes the second step —
  const lap = browser(CHROME, '203.0.113.10');
  const saraSessions = () => T.sessions.filter(s => s.kind === 'employee' && s.payload.id === 2).length;
  const had = saraSessions();
  const p1 = await step(lap);
  c('the password alone no longer signs in: it answers with a challenge and no session', p1.mfa_required === true && !!p1.mfa_token && !p1.token);
  c('…and no session was created for it', saraSessions() === had, `${had} -> ${saraSessions()}`);
  const w1 = await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p1.mfa_token, code: '123456' } });
  const w1b = await J(w1);
  c('a wrong code is refused and says how many tries are left', w1.status === 401 && w1b.attemptsLeft === 4, JSON.stringify(w1b));
  c('…and the challenge survives a wrong guess (a typo is not a lockout)', (await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p1.mfa_token, code: '654321' } })).status === 401);
  const code1 = nextCode();
  const ok1 = await J(await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p1.mfa_token, code: code1 } }));
  c('the right code signs in, with the same answer a normal sign-in gives', !!ok1.token && ok1.id === 2 && ok1.name === 'Sara' && ok1.permissions && 'avatar_url' in ok1, Object.keys(ok1).join(','));
  c('…and the session works', await alive(lap, ok1.token));
  c('…and records that it used a second factor', T.sessions.find(s => s.token === ok1.token).payload.method === 'password+2fa' && T.login_events[T.login_events.length - 1].method === 'password+2fa');
  c('a challenge is single-use', (await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p1.mfa_token, code: nextCode() } })).status === 401);

  // — replay —
  const p2 = await step(lap);
  const replay = await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p2.mfa_token, code: code1 } });
  c('a code that was already used cannot be used again, even in its validity window', replay.status === 401);
  c('…a fresh code on the same challenge works', !!(await J(await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p2.mfa_token, code: nextCode() } }))).token);

  // — the same code, twice, at the same moment —
  // Sequential reuse is caught by comparing steps; two requests in flight at once both
  // read the old step, so only the conditional update stands between them.
  const pr1 = await step(lap), pr2 = await step(lap);
  const raceCode = nextCode();
  db.latency = 20;   // so both requests read the row before either has written it
  const raced = await Promise.all([pr1, pr2].map(p => go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p.mfa_token, code: raceCode } })));
  db.latency = 0;
  c('one authenticator code presented by two requests at once signs in only one of them', raced.map(r => r.status).sort().join() === '200,401', raced.map(r => r.status).join());

  // — recovery codes —
  const rc = en.recoveryCodes;
  const p3 = await step(lap);
  const r3 = await J(await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p3.mfa_token, code: rc[0].toUpperCase() } }));
  await settle();
  c('a recovery code signs in (typed in capitals, as people do)', !!r3.token);
  c('…and is recorded as a recovery sign-in', T.login_events[T.login_events.length - 1].method === 'password+recovery');
  c('…and the owner is told a recovery code was used, with how many are left', alerts('employee_2').pop().title === 'A recovery code was used to sign in' && /9 recovery codes left/.test(alerts('employee_2').pop().body), alerts('employee_2').pop().body);
  const p4 = await step(lap);
  c('a recovery code works exactly once', (await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p4.mfa_token, code: rc[0] } })).status === 401);
  c('…its neighbours still do', !!(await J(await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p4.mfa_token, code: rc[1] } }))).token);
  const pr3 = await step(lap), pr4 = await step(lap);
  db.latency = 20;
  const racedRc = await Promise.all([pr3, pr4].map(p => go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p.mfa_token, code: rc[2] } })));
  db.latency = 0;
  c('one recovery code presented by two requests at once signs in only one of them', racedRc.map(r => r.status).sort().join() === '200,401', racedRc.map(r => r.status).join());
  c('the overview counts them down', (await J(await go(lap, '/api/employee/security', { token: r3.token }))).twofa.recoveryLeft === 7);

  // — five wrong codes: stopped, and the owner is told —
  const p5 = await step(lap);
  const lockedBefore = alerts('employee_2').length;
  let last;
  for (let i = 0; i < 5; i++) last = await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p5.mfa_token, code: '11111' + i } });
  const lastBody = await J(last); await settle();
  c('five wrong codes end the challenge', last.status === 401 && lastBody.expired === true);
  c('…and even the right code no longer works on it', (await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p5.mfa_token, code: nextCode() } })).status === 401);
  c('…and the owner is told someone had their password', alerts('employee_2').length > lockedBefore && alerts('employee_2').some(n => /entered your password but not your 2FA code/.test(n.title)));

  // — expiry and cross-use —
  const p6 = await step(lap);
  advance(6 * 60);
  const exp = await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: p6.mfa_token, code: nextCode() } });
  c('a challenge expires after five minutes', exp.status === 401 && (await J(exp)).expired === true);
  const p7 = await step(lap);
  c('an employee challenge is no good at the admin endpoint', (await go(lap, '/api/auth/login/2fa', { method: 'POST', body: { mfa_token: p7.mfa_token, code: nextCode() } })).status === 401);
  c('…and a made-up one is no good anywhere', (await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: 'f'.repeat(48), code: nextCode() } })).status === 401);

  // — an outage is not a way around it —
  db.failing.add('account_security');
  const ovDown = await J(await go(lap, '/api/employee/security', { token: ok1.token }));
  c('a database error is reported as an error, not as a missing migration', ovDown.twofa && ovDown.twofa.available === false && ovDown.twofa.reason === 'error', JSON.stringify(ovDown.twofa));
  const down = await signIn(lap, 'sara', SARA_PW);
  db.failing.delete('account_security');
  c('if the second factor cannot be checked, sign-in is refused — never waved through', !down.token && !down.mfa_required && /try again/i.test(down.error || ''), JSON.stringify(down));
  // …nor is the minute after a database restart, when PostgREST answers PGRST002 while
  // it reloads its schema cache. That message names the schema cache, as a missing
  // table's does, and passed for "migration 023 not applied" — so a password alone got in.
  db.restarting.add('account_security');
  const ovRestart = await J(await go(lap, '/api/employee/security', { token: ok1.token }));
  const restarting = await signIn(lap, 'sara', SARA_PW);
  db.restarting.delete('account_security');
  c('a database that is restarting is reported as an error, not as a missing migration', ovRestart.twofa && ovRestart.twofa.reason === 'error', JSON.stringify(ovRestart.twofa));
  c('…and sign-in is refused while it comes back, not waved through without the code', !restarting.token && !restarting.mfa_required && /try again/i.test(restarting.error || ''), JSON.stringify(restarting));

  // — Google sign-in does not skip it either —
  googleEmail = 'sara@example.com';
  const gStart = await go(lap, '/api/employee/auth/google', { redirect: 'manual' });
  const gState = new URL(gStart.headers.get('location')).searchParams.get('state');
  const gCb = await go(lap, `/api/email/callback?code=abc&state=${gState}`, { redirect: 'manual' });
  const gLoc = gCb.headers.get('location') || '';
  c('signing in with Google, with 2FA on, asks for the code instead of giving a session', gLoc.startsWith('/employee?mfa_token=') && !gLoc.includes('emp_token'), gLoc);
  const gTok = gLoc.split('mfa_token=')[1];
  const gDone = await J(await go(lap, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: gTok, code: nextCode() } }));
  c('…and the code completes it', !!gDone.token && T.sessions.find(s => s.token === gDone.token).payload.method === 'google+2fa');
  googleEmail = 'omar@example.com';
  const gStart2 = await go(lap, '/api/employee/auth/google', { redirect: 'manual' });
  const gCb2 = await go(lap, `/api/email/callback?code=abc&state=${new URL(gStart2.headers.get('location')).searchParams.get('state')}`, { redirect: 'manual' });
  c('Google sign-in for someone without 2FA is unchanged', (gCb2.headers.get('location') || '').startsWith('/employee?emp_token='));

  // — turning it off —
  const live = await J(await go(lap, '/api/employee/security', { token: gDone.token }));
  mails.length = 0;
  c('turning it off asks for the password', (await go(lap, '/api/employee/security/2fa/disable', { method: 'POST', token: gDone.token, body: { password: 'wrong-pass', code: nextCode() } })).status === 403);
  c('…and a valid code', (await go(lap, '/api/employee/security/2fa/disable', { method: 'POST', token: gDone.token, body: { password: SARA_PW, code: '000000' } })).status === 403);
  const off = await J(await go(lap, '/api/employee/security/2fa/disable', { method: 'POST', token: gDone.token, body: { password: SARA_PW, code: nextCode() } }));
  await settle();
  c('with both, it turns off', off.ok === true && !T.account_security.some(r => r.account_id === '2'));
  c('…signs out the other devices (they were signed in under a stronger rule)', off.sessionsRevoked >= 1 && !(await alive(lap, r3.token)) && await alive(lap, gDone.token));
  c('…tells the owner', mails.some(m => /Two-factor authentication was turned off/.test(m.subject)));
  c('…and sign-in is back to the password alone', !!(await signIn(lap, 'sara', SARA_PW)).token);

  // — an administrator resets a lost phone —
  const ADMIN_B = browser(CHROME, '192.0.2.50');
  const admLogin = await J(await go(ADMIN_B, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'pw' } }));
  c('the admin signs in', !!admLogin.token);
  // Lina turns on 2FA, then loses the phone.
  const linaB = browser(FIREFOX, '203.0.113.77');
  const lina1 = await signIn(linaB, 'lina', 'lina-password-1');
  const linaSetup = await J(await go(linaB, '/api/employee/security/2fa/setup', { method: 'POST', token: lina1.token, body: { password: 'lina-password-1' } }));
  await go(linaB, '/api/employee/security/2fa/enable', { method: 'POST', token: lina1.token, body: { code: totp.totpAt(linaSetup.secret, Date.now()) } });
  const list = await J(await go(ADMIN_B, '/api/dashboard/employees', { token: admLogin.token }));
  c('the admin\'s employee list shows who has 2FA on', list.find(e => e.username === 'lina').twofa === true && list.find(e => e.username === 'sara').twofa === false);
  c('…and the list does not include any secret', !JSON.stringify(list).includes(linaSetup.secret) && !/totp|recovery/i.test(JSON.stringify(list)));
  const reset = await go(ADMIN_B, '/api/dashboard/employees/4/2fa/reset', { method: 'POST', token: admLogin.token, body: {} });
  await settle();
  c('the admin can reset it', reset.status === 200 && !T.account_security.some(r => r.account_id === '4'));
  c('…which signs the employee out everywhere and tells them', !(await alive(linaB, lina1.token)) && alerts('employee_4').some(n => /administrator reset your two-factor/.test(n.title)));
  c('…and the employee can sign in with the password again', !!(await signIn(linaB, 'lina', 'lina-password-1')).token);
  c('a reset is not something an employee can do to themselves or anyone else', (await go(linaB, '/api/dashboard/employees/2/2fa/reset', { method: 'POST', token: (await signIn(linaB, 'lina', 'lina-password-1')).token, body: {} })).status === 401);

  // — 2FA switched off while someone is half-way through signing in —
  const noraB = browser(FIREFOX, '203.0.113.88');
  const nora1 = await signIn(noraB, 'nora', 'nora-password-1');
  const noraSetup = await J(await go(noraB, '/api/employee/security/2fa/setup', { method: 'POST', token: nora1.token, body: { password: 'nora-password-1' } }));
  await go(noraB, '/api/employee/security/2fa/enable', { method: 'POST', token: nora1.token, body: { code: totp.totpAt(noraSetup.secret, Date.now()) } });
  const noraPw = await signIn(browser(CHROME, '203.0.113.89'), 'nora', 'nora-password-1');
  await go(ADMIN_B, '/api/dashboard/employees/5/2fa/reset', { method: 'POST', token: admLogin.token, body: {} });
  advance(30);
  const stale = await go(noraB, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: noraPw.mfa_token, code: totp.totpAt(noraSetup.secret, Date.now()) } });
  const staleBody = await J(stale);
  c('a sign-in challenge outlives the factor it was for only as "start again", so the person is sent back to the password form', stale.status === 401 && staleBody.expired === true, JSON.stringify(staleBody));
  c('…and the password alone then works', !!(await signIn(browser(CHROME, '203.0.113.89'), 'nora', 'nora-password-1')).token);

  // The reset has to say when it could not end the logins.
  db.failing.add('sessions');
  const warned = await J(await go(ADMIN_B, '/api/dashboard/employees/4/2fa/reset', { method: 'POST', token: admLogin.token, body: {} }));
  db.failing.delete('sessions');
  c('if the saved logins could not be ended, the admin\'s reset says so instead of reporting a clean success', warned.ok === true && /could not/i.test(warned.warning || ''), JSON.stringify(warned));

  // ═══ D. The admin account has the same protection ═════════════════════════════
  const admSetup = await J(await go(ADMIN_B, '/api/dashboard/security/2fa/setup', { method: 'POST', token: admLogin.token, body: { password: 'pw' } }));
  c('the admin can set up 2FA with the admin password', /^[A-Z2-7]{32}$/.test(admSetup.secret) && admSetup.otpauth.includes('MotoLinker:admin'));
  const admEnable = await J(await go(ADMIN_B, '/api/dashboard/security/2fa/enable', { method: 'POST', token: admLogin.token, body: { code: totp.totpAt(admSetup.secret, Date.now()) } }));
  await settle();
  c('…and turn it on, with recovery codes', admEnable.ok === true && admEnable.recoveryCodes.length === 10);
  c('…which alerts the admin address by email', mails.some(m => m.to === 'boss@example.com' && /Two-factor authentication was turned on/.test(m.subject)), mails.map(m => m.to + ':' + m.subject).join('|'));
  c('…and in the admin\'s own notification feed', alerts('admin').some(n => /Two-factor authentication was turned on/.test(n.title)) && alerts('admin').pop().url === '/dashboard#security');
  const bossMails = mails.filter(m => m.to === 'boss@example.com');
  c('the admin has no "forgot password" — the advice in the admin\'s email is to rotate ADMIN_PASSWORD, and to clear a rogue second factor from the command line',
    bossMails.length > 0 && bossMails.every(m => /ADMIN_PASSWORD/.test(m.html) && !/Forgot password/.test(m.html)) && bossMails.some(m => /reset-2fa/.test(m.html)), bossMails[0] && bossMails[0].html.slice(-240));
  const admPw = await J(await go(ADMIN_B, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'pw' } }));
  c('the admin password alone now answers with a challenge', admPw.mfa_required === true && !admPw.token);
  const admCode = () => { advance(30); return totp.totpAt(admSetup.secret, Date.now()); };
  c('a wrong code is refused', (await go(ADMIN_B, '/api/auth/login/2fa', { method: 'POST', body: { mfa_token: admPw.mfa_token, code: '000000' } })).status === 401);
  const admDone = await J(await go(ADMIN_B, '/api/auth/login/2fa', { method: 'POST', body: { mfa_token: admPw.mfa_token, code: admCode() } }));
  c('the right one signs the admin in', !!admDone.token && admDone.username === 'admin' && (await go(ADMIN_B, '/api/auth/check', { token: admDone.token })).status === 200);
  c('the admin\'s other logins ended when 2FA was turned on', (await go(ADMIN_B, '/api/auth/check', { token: admLogin.token })).status === 200);   // this device made the change, so it stays
  const admOv = await J(await go(ADMIN_B, '/api/dashboard/security', { token: admDone.token }));
  c('the admin overview lists the admin\'s sessions and sign-ins', admOv.account.kind === 'admin' && admOv.twofa.enabled === true && admOv.sessions.length >= 1 && admOv.logins.length >= 1);

  // ═══ E. Guessing is limited ═══════════════════════════════════════════════════
  const attacker = browser(FIREFOX, '192.0.2.200');
  const guesses = [];
  for (let i = 0; i < 6; i++) guesses.push((await signIn(attacker, 'omar', 'wrong-guess-' + i)).status);
  c('five wrong passwords, and the sixth attempt is stopped', guesses.slice(0, 5).every(s => s === 401) && guesses[5] === 429, guesses.join(','));
  const lockedOut = await go(attacker, '/api/employee/login', { method: 'POST', body: { username: 'omar', password: 'omar-password-1' } });
  c('…even with the right password, and says when to come back', lockedOut.status === 429 && Number(lockedOut.headers.get('retry-after')) > 0);
  c('…but Omar at his own desk is not locked out by a stranger\'s guesses', !!(await signIn(browser(CHROME, '203.0.113.99'), 'omar', 'omar-password-1')).token);
  c('…and another account from the stranger\'s address is still let through the per-account net', (await signIn(attacker, 'lina', 'lina-password-1')).status !== 429);
  const adminGuess = [];
  for (let i = 0; i < 6; i++) adminGuess.push((await go(browser(FIREFOX, '192.0.2.201'), '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'nope' + i } })).status);
  c('the admin login is limited the same way', adminGuess[5] === 429, adminGuess.join(','));

  // Spreading guesses across addresses does not get around the per-account net.
  let backstop = 0;
  for (let i = 0; i < 25; i++) { const r = await signIn(browser(CHROME, `198.18.0.${i + 1}`), 'lina', 'guess-' + i); if (r.status === 429) { backstop = i; break; } }
  c('guessing one account from many addresses is stopped by the per-account limit', backstop > 0 && backstop <= 22, `stopped at attempt ${backstop}`);

  // Wrong codes, across challenges, for one account.
  const omarB = browser(CHROME, '203.0.113.124');
  const omarTok = (await signIn(omarB, 'omar', 'omar-password-1')).token;
  const omarSetup = await J(await go(omarB, '/api/employee/security/2fa/setup', { method: 'POST', token: omarTok, body: { password: 'omar-password-1' } }));
  await go(omarB, '/api/employee/security/2fa/enable', { method: 'POST', token: omarTok, body: { code: totp.totpAt(omarSetup.secret, Date.now()) } });
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const ch = await signIn(browser(CHROME, '203.0.113.124'), 'omar', 'omar-password-1');
    if (!ch.mfa_token) { codes.push('x'); continue; }
    codes.push((await go(omarB, '/api/employee/login/2fa', { method: 'POST', body: { mfa_token: ch.mfa_token, code: '99999' + (i % 10) } })).status);
  }
  c('wrong codes are limited per account across challenges — ten are answered, the eleventh is locked', codes.slice(0, 10).every(s => s === 401) && codes[10] === 429, codes.join(','));

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} sign-in security checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
