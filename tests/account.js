// An employee's own account — the picture, the status, the username, the password — and what the Security panel is told, as the
// server does them. The new app's account menu and Security panel call these routes as they are (they are the classic portals'
// own: nothing is written twice, so there is nothing to unify yet), and this holds what they may rely on: what is accepted and
// what is refused and with which status (a wrong password is a 403 — a 401 would sign the person out), what is kept, what
// the session is told, which other devices are signed out, and that every answer is the shape packages/contracts says it is.
//
// The Security panel's behaviour (the second factor, the recovery codes, the limits) is tests/signintest.js; this reads the
// answers the panel is drawn from.
const totp = require('../src/lib/totp');
const C = require('../packages/contracts');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

// The clock is the test's: a code is valid for one 30-second step and is not accepted twice, so each one that is needed
// is taken a step later than the last.
let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;
const nextCode = secret => { skew += 30_000; return totp.totpAt(secret, Date.now()); };

const S = C.schemas;
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };

const db = createFakeSupabase({
  employees: [], sessions: [], push_subscriptions: [], notifications: [], password_reset_tokens: [],
  quotation_settings: [], google_tokens: [], account_security: [], login_events: [],
}, { defaults: {
  account_security: () => ({ totp_enabled: false, recovery_codes: [], last_step: 0, updated_at: new Date().toISOString() }),
  login_events: () => ({ at: new Date().toISOString(), event: 'login', new_device: false }),
} });
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3973, env: { MFA_ENCRYPTION_KEY: 'k'.repeat(40) } });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  T.employees.push(
    { id: 2, name: 'Sara', username: 'sara', email: 'sara@example.com', password_hash: ctx.hashPassword('sara-password-1'), permissions: null, job_title: 'Sales', avatar_url: '', status_text: '', status_emoji: '' },
    { id: 3, name: 'Omar', username: 'omar', email: 'omar@example.com', password_hash: ctx.hashPassword('omar-password-1'), permissions: null, job_title: 'Ops', avatar_url: '', status_text: '', status_emoji: '' },
  );

  const call = async (method, path, { token, body, form } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
    let data = null; try { data = await r.json(); } catch (_) {}
    return { status: r.status, data, retryAfter: r.headers.get('retry-after') };
  };
  const signIn = async (username, password) => (await call('POST', '/api/employee/login', { body: { username, password } })).data.token;
  const row = id => T.employees.find(e => e.id === id);

  const sara = await signIn('sara', 'sara-password-1');
  const omar = await signIn('omar', 'omar-password-1');
  ctx.sessions.set('adm', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });

  // ═══ The status ═════════════════════════════════════════════════════════════
  check('a status needs a team member: nobody is 401, the administrator too (it is the team portal\'s)',
    (await call('PUT', '/api/employee/status', { body: { text: 'x', emoji: '🙂' } })).status === 401 && (await call('PUT', '/api/employee/status', { token: 'adm', body: { text: 'x', emoji: '🙂' } })).status === 401);
  const st = await call('PUT', '/api/employee/status', { token: sara, body: { text: '  In a meeting  ', emoji: ' 📅 ' } });
  check('setting one answers with what is kept, trimmed', st.status === 200 && st.data.status_text === 'In a meeting' && st.data.status_emoji === '📅', JSON.stringify(st.data));
  check('…and it is kept on the employee\'s record, in the shape the contract says', row(2).status_text === 'In a meeting' && row(2).status_emoji === '📅' && shape(S.StatusResult, st.data) === true, String(shape(S.StatusResult, st.data)));
  const long = await call('PUT', '/api/employee/status', { token: sara, body: { text: 'x'.repeat(130), emoji: '🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂' } });
  check('the words are cut to 100 characters and the emoji to 8 (UTF-16 units: four of these emoji)', long.data.status_text.length === 100 && long.data.status_emoji.length === 8, `${long.data.status_text.length}, ${long.data.status_emoji.length}`);
  const cleared = await call('PUT', '/api/employee/status', { token: sara, body: { text: '', emoji: '' } });
  check('an empty status clears it', cleared.status === 200 && row(2).status_text === '' && row(2).status_emoji === '');
  const bare = await call('PUT', '/api/employee/status', { token: sara, body: {} });
  check('…and so does saying nothing (the status is what was sent, not what was there)', bare.status === 200 && bare.data.status_text === '' && bare.data.status_emoji === '');
  await call('PUT', '/api/employee/status', { token: sara, body: { text: 'Focusing', emoji: '📚' } });
  const me1 = await call('GET', '/api/v1/me', { token: sara });
  check('/api/v1/me tells the next page load what it is now', me1.data.profile.statusText === 'Focusing' && me1.data.profile.statusEmoji === '📚', JSON.stringify(me1.data.profile));
  check('…and it is Sara\'s alone', (await call('GET', '/api/v1/me', { token: omar })).data.profile.statusText === '');

  // ═══ The username ═══════════════════════════════════════════════════════════
  const nameMsg = /Username must be 3-32 characters/;
  const bad = [['', 'nothing'], ['ab', 'two characters'], ['x'.repeat(33), 'thirty-three characters'], ['sara smith', 'a space'], ['sara@work', 'an @'], ['سارة', 'letters of another script']];
  for (const [username, what] of bad) {
    const r = await call('PUT', '/api/employee/username', { token: sara, body: { username } });
    check(`a username of ${what} is refused with 400 and the rule in words`, r.status === 400 && nameMsg.test(r.data.error), `${r.status} ${JSON.stringify(r.data)}`);
  }
  check('…and none of them was kept', row(2).username === 'sara');
  const taken = await call('PUT', '/api/employee/username', { token: sara, body: { username: 'omar' } });
  check('a name another employee has is 409, "Username already taken"', taken.status === 409 && taken.data.error === 'Username already taken', `${taken.status} ${JSON.stringify(taken.data)}`);
  const same = await call('PUT', '/api/employee/username', { token: sara, body: { username: 'sara' } });
  check('her own name is not "taken" by herself', same.status === 200 && same.data.username === 'sara');
  const nu = await call('PUT', '/api/employee/username', { token: sara, body: { username: '  sara.s_2-b  ' } });
  check('a good name (letters, numbers . _ -) is trimmed, kept and answered', nu.status === 200 && nu.data.ok === true && nu.data.username === 'sara.s_2-b' && row(2).username === 'sara.s_2-b' && shape(S.UsernameResult, nu.data) === true, JSON.stringify(nu.data));
  check('the live session is told (the next request does not undo it)', ctx.employeeSessions.get(sara).username === 'sara.s_2-b');
  check('/api/v1/me and /check both say so', (await call('GET', '/api/v1/me', { token: sara })).data.profile.username === 'sara.s_2-b' && (await call('GET', '/api/employee/check', { token: sara })).data.username === 'sara.s_2-b');
  check('it is the name to sign in with from now on, and the old one is not', !!(await signIn('sara.s_2-b', 'sara-password-1')) && (await call('POST', '/api/employee/login', { body: { username: 'sara', password: 'sara-password-1' } })).status === 401);

  // ═══ The picture ════════════════════════════════════════════════════════════
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const upload = (token, blob, name) => { const fd = new FormData(); if (blob) fd.append('file', blob, name); return call('POST', '/api/employee/avatar', { token, form: fd }); };
  check('a picture needs a team member', (await upload(undefined, new Blob([png], { type: 'image/png' }), 'a.png')).status === 401);
  const none = await upload(sara, null);
  check('no file is 400, "Please upload an image"', none.status === 400 && none.data.error === 'Please upload an image', JSON.stringify(none.data));
  const notImage = await upload(sara, new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  check('a file that is not an image is the same 400', notImage.status === 400 && notImage.data.error === 'Please upload an image');
  const av = await upload(sara, new Blob([png], { type: 'image/png' }), 'face.png');
  check('an image is stored (under avatars/ in the chat-files bucket) and its public address is answered', av.status === 200 && /\/avatars\/2_\d+\.png$/.test(av.data.avatar_url) && [...db.storage.keys()].some(k => /^chat-files\/avatars\/2_\d+\.png$/.test(k)) && shape(S.AvatarResult, av.data) === true, JSON.stringify(av.data));
  check('…it is on the record, and /api/v1/me gives it to the app', row(2).avatar_url === av.data.avatar_url && (await call('GET', '/api/v1/me', { token: sara })).data.profile.avatarUrl === av.data.avatar_url);
  const big = await upload(sara, new Blob([Buffer.alloc(5 * 1024 * 1024 + 10, 1)], { type: 'image/png' }), 'big.png');
  check('one over 5 MB is refused (the app says so before sending it; this is the server\'s own limit)', big.status >= 400 && big.status < 600 && !/big\.png/.test(JSON.stringify([...db.storage.keys()])), String(big.status));

  // ═══ The password ═══════════════════════════════════════════════════════════
  const second = await signIn('sara.s_2-b', 'sara-password-1');   // Sara's other device
  const pw = (token, body) => call('POST', '/api/employee/change-password', { token, body });
  check('changing a password needs a team member', (await pw(undefined, { currentPassword: 'a', newPassword: 'b' })).status === 401);
  const need = await pw(sara, { currentPassword: 'sara-password-1' });
  check('both are needed: 400, "Both passwords required"', need.status === 400 && need.data.error === 'Both passwords required');
  const short = await pw(sara, { currentPassword: 'sara-password-1', newPassword: '1234567' });
  check('a new one under 8 characters is 400, and says so', short.status === 400 && /at least 8 characters/.test(short.data.error), JSON.stringify(short.data));
  const wrong = await pw(sara, { currentPassword: 'not-her-password', newPassword: 'a-brand-new-one-1' });
  check('a wrong current password is 403, not 401 (the portals read a 401 as "your session ended")', wrong.status === 403 && wrong.data.error === 'Current password is incorrect', `${wrong.status} ${JSON.stringify(wrong.data)}`);
  check('…and nothing changed', ctx.verifyPassword('sara-password-1', row(2).password_hash) === true && ctx.employeeSessions.has(second));
  const ok = await pw(sara, { currentPassword: 'sara-password-1', newPassword: 'a-brand-new-one-1' });
  check('the right one changes it: 200 with how many other devices were signed out', ok.status === 200 && ok.data.ok === true && ok.data.sessionsRevoked >= 1 && shape(S.ChangePasswordResult, ok.data) === true, JSON.stringify(ok.data));
  check('…the new password is the one that works, and the old one is not', ctx.verifyPassword('a-brand-new-one-1', row(2).password_hash) === true && ctx.verifyPassword('sara-password-1', row(2).password_hash) === false);
  check('…this device stays signed in, the other one does not, and nobody else is touched', ctx.employeeSessions.has(sara) && !ctx.employeeSessions.has(second) && ctx.employeeSessions.has(omar));
  check('…and the person is told by a notification', T.notifications.some(n => n.member_key === 'employee_2' && /password was changed/i.test(n.title)), JSON.stringify(T.notifications.map(n => n.title)));
  // five wrong answers in a row lock the question for a while
  for (let i = 0; i < 5; i++) await pw(omar, { currentPassword: 'guess-' + i, newPassword: 'a-brand-new-one-1' });
  const locked = await pw(omar, { currentPassword: 'omar-password-1', newPassword: 'a-brand-new-one-1' });
  check('after five wrong answers the right one is refused too: 429 with Retry-After (a stolen session cannot guess at it)', locked.status === 429 && /Too many wrong attempts/.test(locked.data.error) && Number(locked.retryAfter) > 0, `${locked.status} ${locked.retryAfter}`);

  // ═══ What the Security panel is told ════════════════════════════════════════
  const ov = await call('GET', '/api/employee/security', { token: sara });
  check('the team portal\'s overview is what the contract says', shape(S.SecurityOverview, ov.data) === true, String(shape(S.SecurityOverview, ov.data)));
  check('…it is about a team member who may change their password, with two-factor off and a secret box that encrypts',
    ov.data.account.kind === 'employee' && ov.data.account.name === 'Sara' && ov.data.account.canChangePassword === true && ov.data.twofa.available === true && ov.data.twofa.enabled === false && ov.data.twofa.encrypted === true && ov.data.alerts === 'new');
  check('…and lists this device as the current one, with a handle that is not the token', ov.data.sessions.filter(s => s.current).length === 1 && ov.data.sessions.every(s => s.sid && s.sid !== sara && !JSON.stringify(s).includes(sara)));
  const aov = await call('GET', '/api/dashboard/security', { token: 'adm' });
  check('the administrator\'s is the same shape, about the administrator, who has no password to change here', shape(S.SecurityOverview, aov.data) === true && aov.data.account.kind === 'admin' && aov.data.account.canChangePassword === false);
  check('each portal\'s route is its own: the other portal\'s login is 401', (await call('GET', '/api/dashboard/security', { token: sara })).status === 401 && (await call('GET', '/api/employee/security', { token: 'adm' })).status === 401);

  const pass = 'a-brand-new-one-1';
  const setup0 = await call('POST', '/api/employee/security/2fa/setup', { token: sara, body: { password: 'nope' } });
  check('starting the setup with the wrong password is 403', setup0.status === 403 && /password is not right/.test(setup0.data.error), `${setup0.status} ${JSON.stringify(setup0.data)}`);
  const setup = await call('POST', '/api/employee/security/2fa/setup', { token: sara, body: { password: pass } });
  check('…with the right one it answers the key, the link and the picture', setup.status === 200 && shape(S.SecuritySetup, setup.data) === true && /^data:image\/png;base64,/.test(setup.data.qr) && /^otpauth:\/\/totp\//.test(setup.data.otpauth) && /^[A-Z2-7]{32}$/.test(setup.data.secret), String(shape(S.SecuritySetup, setup.data)));
  const bad6 = await call('POST', '/api/employee/security/2fa/enable', { token: sara, body: { code: '000000' } });
  check('a wrong code does not turn it on: 403', bad6.status === 403 && /not right/.test(bad6.data.error));
  const enable = await call('POST', '/api/employee/security/2fa/enable', { token: sara, body: { code: nextCode(setup.data.secret) } });
  check('the right one does, and answers ten recovery codes once', enable.status === 200 && shape(S.SecurityEnabled, enable.data) === true && enable.data.recoveryCodes.length === 10 && enable.data.recoveryCodes.every(x => /^[a-z0-9]{5}-[a-z0-9]{5}$/i.test(x)), JSON.stringify(enable.data).slice(0, 160));
  const ov2 = await call('GET', '/api/employee/security', { token: sara });
  check('the overview then says on, with ten codes left and when', ov2.data.twofa.enabled === true && ov2.data.twofa.recoveryLeft === 10 && typeof ov2.data.twofa.enabledAt === 'string' && shape(S.SecurityOverview, ov2.data) === true);
  check('…and sign-ins are recorded: this account\'s own history, newest first, in the shape the contract says', ov2.data.history === true && ov2.data.logins.length >= 1 && ov2.data.logins.every(l => shape(S.SecurityLogin, l) === true), JSON.stringify(ov2.data.logins[0]));
  const otherDevice = await call('POST', '/api/employee/login', { body: { username: 'sara.s_2-b', password: pass } });
  check('(a password now meets a code prompt, not a session)', otherDevice.data.mfa_required === true && !otherDevice.data.token);
  // a second session that is allowed to exist: put one in the map, as a device signed in before would be
  ctx.employeeSessions.set('sara-phone', { id: 2, name: 'Sara', username: 'sara.s_2-b', job_title: 'Sales', permissions: {}, createdAt: Date.now() - 5000, device: 'Safari on iPhone', ip: '10.0.0.9', sid: 'phone-sid', method: 'password' });
  const ov3 = await call('GET', '/api/employee/security', { token: sara });
  const phone = ov3.data.sessions.find(s => s.sid === 'phone-sid');
  check('another device is listed with what is known of it', !!phone && phone.current === false && phone.device === 'Safari on iPhone' && phone.ip === '10.0.0.9' && phone.method === 'password' && shape(S.SecuritySession, phone) === true, JSON.stringify(phone));
  const gone = await call('DELETE', '/api/employee/security/sessions/phone-sid', { token: sara });
  check('signing it out answers ok, and it is gone', gone.status === 200 && gone.data.ok === true && !ctx.employeeSessions.has('sara-phone'));
  const again = await call('DELETE', '/api/employee/security/sessions/phone-sid', { token: sara });
  check('…doing it again is a 404, "already gone"', again.status === 404 && /already gone/.test(again.data.error));
  const mine = ov3.data.sessions.find(s => s.current);
  const self = await call('DELETE', '/api/employee/security/sessions/' + encodeURIComponent(mine.sid), { token: sara });
  check('this device cannot be signed out from the list (400: use Sign out)', self.status === 400 && /this device/i.test(self.data.error));
  ctx.employeeSessions.set('sara-tablet', { id: 2, name: 'Sara', username: 'sara.s_2-b', job_title: 'Sales', permissions: {}, createdAt: Date.now() - 9000, device: 'Chrome on Android', sid: 'tablet-sid' });
  const others = await call('POST', '/api/employee/security/sessions/revoke-others', { token: sara, body: {} });
  check('signing out the others answers how many', others.status === 200 && others.data.ok === true && others.data.sessionsRevoked >= 1 && shape(S.SecurityRevoked, others.data) === true && ctx.employeeSessions.has(sara) && !ctx.employeeSessions.has('sara-tablet'), JSON.stringify(others.data));
  const reAuth = await call('POST', '/api/employee/security/2fa/recovery-codes', { token: sara, body: { password: 'nope', code: nextCode(setup.data.secret) } });
  check('new recovery codes need the password again: 403', reAuth.status === 403 && /password is not right/.test(reAuth.data.error));
  const fresh = await call('POST', '/api/employee/security/2fa/recovery-codes', { token: sara, body: { password: pass, code: nextCode(setup.data.secret) } });
  check('…and then they are made, ten, and the old ones are replaced', fresh.status === 200 && shape(S.SecurityNewCodes, fresh.data) === true && fresh.data.recoveryCodes.length === 10 && fresh.data.recoveryCodes.every(x => !enable.data.recoveryCodes.includes(x)));
  const off = await call('POST', '/api/employee/security/2fa/disable', { token: sara, body: { password: pass, code: nextCode(setup.data.secret) } });
  check('turning it off needs the password and a code, and answers ok', off.status === 200 && off.data.ok === true && shape(S.SecurityDisabled, off.data) === true, JSON.stringify(off.data));

  // the two states where the panel has nothing to turn on
  db.missing.add('account_security');
  const missing = await call('GET', '/api/employee/security', { token: sara });
  check('without its table the overview says "migration" and is still the contract\'s shape', missing.status === 200 && missing.data.twofa.available === false && missing.data.twofa.reason === 'migration' && shape(S.SecurityOverview, missing.data) === true, String(shape(S.SecurityOverview, missing.data)));
  db.missing.delete('account_security');
  db.failing.add('account_security'); db.failing.add('login_events');
  const down = await call('GET', '/api/employee/security', { token: sara });
  check('a database that does not answer is "error", with no history — and still the contract\'s shape', down.status === 200 && down.data.twofa.reason === 'error' && down.data.history === false && shape(S.SecurityOverview, down.data) === true, String(shape(S.SecurityOverview, down.data)));
  db.failing.delete('account_security'); db.failing.delete('login_events');

  const pass_ = results.filter(Boolean).length;
  console.log(`\n${pass_}/${results.length} passed`);
  process.exit(pass_ === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
