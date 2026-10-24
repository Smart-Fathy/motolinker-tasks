// Account security: the second factor, the record of who signed in, and the alerts.
//
// Three things sit around a sign-in, and they share one flow, so they live together:
//
//   1. Two-factor authentication (TOTP — an authenticator app). After the password (or
//      Google) is accepted, an account with a second factor gets a short-lived
//      challenge instead of a session, and the session starts only when it is answered.
//   2. A record of every sign-in — which browser, which address, and whether that
//      browser had signed in to this account before.
//   3. Alerts. A sign-in from a browser the account has not used before, a password
//      change, and every change to the second factor tell the account's owner, in the
//      app, by push, and by email. The email matters most: an in-app notice is in front
//      of whoever is signed in, which may be exactly the person it is about.
//
// Both portals use the same code: `kind` is 'admin' (the one environment-variable
// login) or 'employee', and `id` is 'admin' or the employee's id.
//
// src/ctx.js explains the context object.
const crypto = require('crypto');
const QRCode = require('qrcode');
const ctx = require('../ctx');
const totp = require('../lib/totp');
const { createBox } = require('../lib/secret-box');
const { createLimiter } = require('../lib/rate-limit');
const { requestMeta, readDeviceId, newDeviceId, hashDeviceId, setDeviceCookie } = require('../lib/request-info');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } =
  ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Registered on the context by modules that load before or after this one, so these
// are resolved when called rather than when required.
const startSession = (...a) => ctx.startSession(...a);
const revokeSessions = (...a) => ctx.revokeSessions(...a);
const revokeToken = (...a) => ctx.revokeToken(...a);
const createNotification = (...a) => ctx.createNotification(...a);
const isMissingRelation = e => ctx.isMissingRelation(e);

const ISSUER = 'MotoLinker';
const box = createBox();
// 'new' (default): alert when a browser the account has not signed in from before gets
// in. 'all': alert on every sign-in. 'off': record only.
const ALERT_MODE = (v => (v === 'all' || v === 'off' ? v : 'new'))(String(process.env.LOGIN_ALERTS || '').toLowerCase());
const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_TRIES = 5;
const HISTORY_KEEP_MS = 180 * 864e5;
const WINDOW = 15 * 60_000;

// ── Limits ───────────────────────────────────────────────────────────────────
// A six-digit code is only a second factor if the guesses are limited, and a password
// is only secret if they are too. Three nets for the password, because no one of them
// is enough alone:
//   user+address  a person mistyping at their own desk — tight, and an attacker cannot
//                 use it to lock the real person out from somewhere else
//   address       one machine trying many accounts
//   user          the backstop that does not depend on the address (which a client can
//                 influence through headers): a botnet still gets only 20 tries per
//                 account per 15 minutes
const limit = {
  loginUserIp: createLimiter({ max: 5, windowMs: WINDOW }),
  loginIp: createLimiter({ max: 40, windowMs: WINDOW }),
  loginUser: createLimiter({ max: 20, windowMs: WINDOW }),
  mfaAccount: createLimiter({ max: 10, windowMs: WINDOW }),     // wrong codes, per account
  reauth: createLimiter({ max: 5, windowMs: WINDOW }),          // wrong passwords in the Security panel
  forgot: createLimiter({ max: 5, windowMs: 60 * 60_000 }),     // reset emails, per address and per email
};
const norm = s => String(s == null ? '' : s).toLowerCase().trim().slice(0, 120);
const loginKeys = (kind, username, req) => {
  const u = norm(username), ip = requestMeta(req).ip;
  return [[limit.loginUserIp, `${kind}:${u}:${ip}`], [limit.loginIp, `${kind}:${ip}`], [limit.loginUser, `${kind}:${u}`]];
};
// Seconds the caller must wait, or 0.
function loginGate(kind, username, req) {
  return Math.max(0, ...loginKeys(kind, username, req).map(([l, k]) => l.retryAfter(k)));
}
function loginFailed(kind, username, req) { for (const [l, k] of loginKeys(kind, username, req)) l.fail(k); }
function loginSucceeded(kind, username, req) {
  const [[uip, kuip], , [user, kuser]] = loginKeys(kind, username, req);
  uip.reset(kuip); user.reset(kuser);
}
function tooMany(res, wait) {
  res.set('Retry-After', String(wait));
  return res.status(429).json({ error: `Too many attempts. Try again in ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'}.`, retryAfter: wait });
}

// ── The second factor, in the database ────────────────────────────────────────
const FACTOR_COLS = 'totp_secret,totp_pending,totp_enabled,recovery_codes,last_step,enabled_at,updated_at';
const now = () => new Date().toISOString();

// The account's row; null when it has none; undefined when the table does not exist
// (migration 023 not applied), which is the one case sign-in treats as "no second
// factor". Anything else — the database down, a timeout — throws, and sign-in fails
// closed: an outage must not be a way around the second factor.
async function loadFactor(kind, id) {
  const { data, error } = await supabase.from('account_security').select(FACTOR_COLS)
    .eq('kind', kind).eq('account_id', String(id)).maybeSingle();
  if (error) { if (isMissingRelation(error)) return undefined; throw error; }
  return data || null;
}
const isEnabled = f => !!(f && f.totp_enabled === true && f.totp_secret);

async function twoFactorFlags(ids) {
  try {
    const { data } = await supabase.from('account_security').select('account_id').eq('kind', 'employee').eq('totp_enabled', true);
    const on = new Set((data || []).map(r => String(r.account_id)));
    return new Set(ids.map(String).filter(i => on.has(i)));
  } catch (_) { return new Set(); }
}

// Check what the person typed against the account's factor. A six-digit code is
// checked as TOTP; ten letters-and-digits are a recovery code (and are spent).
// Resolves { ok, via: 'totp' | 'recovery', left } or { ok: false, reason }.
async function checkSecondFactor(kind, id, input) {
  const row = await loadFactor(kind, id);
  if (!isEnabled(row)) return { ok: false, reason: 'not_enabled' };
  const typed = String(input == null ? '' : input).trim();
  if (totp.looksLikeRecoveryCode(typed)) return spendRecoveryCode(kind, id, row, typed);

  let secret;
  try { secret = box.open(row.totp_secret); }
  catch (e) { console.error(`[2fa] cannot read the secret for ${kind}:${id}: ${e.message}`); return { ok: false, reason: 'unreadable' }; }
  const step = totp.verifyTotp(secret, typed, { afterStep: Number(row.last_step) || 0 });
  if (!step) return { ok: false, reason: 'invalid' };
  // Record the step so the same code cannot be used twice. Conditional on the stored
  // step still being older: of two requests carrying one code, only one updates a row.
  const { data, error } = await supabase.from('account_security').update({ last_step: step, updated_at: now() })
    .eq('kind', kind).eq('account_id', String(id)).lt('last_step', step).select('kind');
  if (error) throw error;
  if (!data || !data.length) return { ok: false, reason: 'replayed' };
  return { ok: true, via: 'totp' };
}

async function spendRecoveryCode(kind, id, row, typed, attempt = 0) {
  const hash = totp.hashRecoveryCode(typed);
  const list = Array.isArray(row.recovery_codes) ? row.recovery_codes : [];
  if (!list.includes(hash)) return { ok: false, reason: 'invalid' };
  const next = list.filter(h => h !== hash);
  // Conditional on the row not having changed since it was read, so one code cannot be
  // spent by two requests at once.
  const { data, error } = await supabase.from('account_security').update({ recovery_codes: next, updated_at: now() })
    .eq('kind', kind).eq('account_id', String(id)).eq('updated_at', row.updated_at).select('kind');
  if (error) throw error;
  if (data && data.length) return { ok: true, via: 'recovery', left: next.length };
  if (attempt >= 1) return { ok: false, reason: 'replayed' };
  const fresh = await loadFactor(kind, id);
  return isEnabled(fresh) ? spendRecoveryCode(kind, id, fresh, typed, attempt + 1) : { ok: false, reason: 'invalid' };
}

async function removeFactor(kind, id) {
  const { error } = await supabase.from('account_security').delete().eq('kind', kind).eq('account_id', String(id));
  if (error && !isMissingRelation(error)) throw error;
}

// ── Enrolment ─────────────────────────────────────────────────────────────────
async function startEnrolment(kind, id, accountLabel) {
  const secret = totp.generateSecret();
  const { error } = await supabase.from('account_security')
    .upsert({ kind, account_id: String(id), totp_pending: box.seal(secret), updated_at: now() }, { onConflict: 'kind,account_id' });
  if (error) throw error;
  const otpauth = totp.otpauthUri({ issuer: ISSUER, account: accountLabel, secret });
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 232, errorCorrectionLevel: 'M' });
  return { secret, otpauth, qr };
}

// The code from the authenticator proves the person really has it set up before the
// factor goes live — otherwise a typo in setup would lock them out of their account.
async function confirmEnrolment(kind, id, code) {
  const row = await loadFactor(kind, id);
  if (!row || !row.totp_pending) return { ok: false, reason: 'no_setup' };
  let secret;
  try { secret = box.open(row.totp_pending); } catch (_) { return { ok: false, reason: 'no_setup' }; }
  const step = totp.verifyTotp(secret, code);
  if (!step) return { ok: false, reason: 'invalid' };
  const codes = totp.generateRecoveryCodes();
  const { data, error } = await supabase.from('account_security').update({
    totp_secret: box.seal(secret), totp_pending: null, totp_enabled: true,
    recovery_codes: codes.map(totp.hashRecoveryCode), last_step: step, enabled_at: now(), updated_at: now(),
  }).eq('kind', kind).eq('account_id', String(id)).eq('totp_pending', row.totp_pending).select('kind');
  if (error) throw error;
  if (!data || !data.length) return { ok: false, reason: 'no_setup' };
  return { ok: true, recoveryCodes: codes };
}

async function replaceRecoveryCodes(kind, id) {
  const codes = totp.generateRecoveryCodes();
  const { error } = await supabase.from('account_security').update({ recovery_codes: codes.map(totp.hashRecoveryCode), updated_at: now() })
    .eq('kind', kind).eq('account_id', String(id));
  if (error) throw error;
  return codes;
}

// ── Alerts ────────────────────────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const when = d => new Date(d).toUTCString().replace(/ GMT$/, ' UTC');

// What each event says, to the person it happened to.
//
// `advice` is what to do if it was not them: 'password' for most, but a second factor
// someone else set up is not undone by a password reset (their phone is still enrolled),
// so that case points to a reset by an administrator instead.
const ALERTS = {
  new_signin: { title: 'New sign-in to your account', advice: 'password' },
  password_changed: { title: 'Your password was changed', text: 'All your other devices were signed out.', advice: 'password' },
  password_set_by_admin: { title: 'An administrator set a new password for you', text: 'All your devices were signed out.', advice: 'password' },
  twofa_enabled: { title: 'Two-factor authentication was turned on', text: 'Your other devices were signed out. From now on signing in needs a code from your authenticator app.', advice: 'twofa' },
  twofa_disabled: { title: 'Two-factor authentication was turned off', text: 'Your other devices were signed out. Your account is protected by your password alone again.', advice: 'password' },
  twofa_reset: { title: 'An administrator reset your two-factor authentication', text: 'All your devices were signed out. Set it up again from Security after you sign in.', advice: null },
  recovery_used: { title: 'A recovery code was used to sign in', text: '', advice: 'password' },
  recovery_new: { title: 'New recovery codes were generated', text: 'Your old recovery codes no longer work.', advice: 'password' },
  mfa_locked: { title: 'Someone entered your password but not your 2FA code', text: 'They knew your password but could not pass the second step, and were stopped after five wrong codes. Your password has probably leaked — change it now.', advice: 'password' },
};

// "If this wasn't you", for the email. The admin has no "forgot password" — its password
// is an environment variable — so it is told to rotate that, and how to clear a second
// factor someone else set up.
function adviceHtml(kind, mode, base, portal) {
  if (!mode) return '';
  const p = body => `<p style="margin:16px 0 0"><b>If this wasn't you</b>, ${body}</p>`;
  if (kind === 'admin') {
    return p(`change <code>ADMIN_PASSWORD</code> in your hosting settings and redeploy — that signs out every admin login.${mode === 'twofa'
      ? ' If someone else set up the two-factor authentication, clear it first with <code>node scripts/reset-2fa.js admin</code>.'
      : ' Then turn on two-factor authentication under Security.'}`);
  }
  if (mode === 'twofa') {
    return p('ask an administrator to reset your two-factor authentication — someone else may have set it up on their own phone, and changing your password would not remove that. Then change your password.');
  }
  return p(`${base ? `open <a href="${esc(portal)}">${esc(portal)}</a> and choose “Forgot password”` : 'use “Forgot password” on the sign-in page'}: resetting your password signs out every device. Then turn on two-factor authentication under Security.`);
}

async function recipientFor(kind, id) {
  if (kind === 'admin') return { email: process.env.ADMIN_EMAIL || '', name: 'Admin' };
  try {
    const { data } = await supabase.from('employees').select('email,name').eq('id', id).maybeSingle();
    return { email: (data && data.email) || '', name: (data && data.name) || '' };
  } catch (_) { return { email: '', name: '' }; }
}

// Tell the account's owner. Best-effort and never awaited by a sign-in: an alert that
// cannot be delivered must not stop anyone getting in, and one that is slow must not
// slow them down.
async function notifySecurity(kind, id, type, { meta = null, extra = '' } = {}) {
  const spec = ALERTS[type];
  if (!spec) return;
  const memberKey = ctx.sessionKeyOf(kind, id);
  const where = meta ? `${meta.device} · ${meta.ip}` : '';
  const body = [where, spec.text, extra, when(Date.now())].filter(Boolean).join(' · ');
  try {
    await createNotification(memberKey, { type: 'security', title: spec.title, body, url: kind === 'admin' ? '/dashboard#security' : '/employee#security' }, 'always');
  } catch (e) { console.warn('[security] in-app alert failed:', e.message); }
  try {
    const { email, name } = await recipientFor(kind, id);
    const mailer = email && ctx.createMailer && ctx.createMailer();
    if (!mailer) return;
    const base = (process.env.APP_URL || '').replace(/\/$/, '');
    const portal = base + (kind === 'admin' ? '/dashboard' : '/employee');
    const details = [meta && ['Device', meta.device], meta && ['Address', meta.ip], ['Time', when(Date.now())]].filter(Boolean)
      .map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#667">${esc(k)}</td><td style="padding:2px 0"><b>${esc(v)}</b></td></tr>`).join('');
    const advice = adviceHtml(kind, spec.advice, base, portal);
    await mailer.sendMail({
      from: ctx.SMTP_FROM, to: email,
      subject: `MotoLinker security alert — ${spec.title}`,
      html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:520px">`
        + `<p>Hi ${esc(name || 'there')},</p><p style="font-size:16px;margin:0 0 6px"><b>${esc(spec.title)}</b></p>`
        + (spec.text ? `<p style="margin:0 0 10px">${esc(spec.text)}</p>` : '') + (extra ? `<p style="margin:0 0 10px">${esc(extra)}</p>` : '')
        + `<table style="border-collapse:collapse;margin-top:8px">${details}</table>${advice}</div>`,
    });
  } catch (e) { console.warn('[security] alert email failed:', e.message); }
}

// ── Recording a sign-in ───────────────────────────────────────────────────────
// Browsers seen since this process started. Only consulted when the history table
// cannot be (migration 023 not applied, or the database is busy), so that case alerts
// once per browser instead of on every single sign-in.
const seenSinceBoot = new Set();
async function recordSignIn({ kind, id, method, meta, deviceHash }) {
  const memKey = `${kind}:${id}:${deviceHash}`;
  let known = false;
  try {
    const { data, error } = await supabase.from('login_events').select('id')
      .eq('kind', kind).eq('account_id', String(id)).eq('event', 'login').eq('device_hash', deviceHash).limit(1);
    if (error) throw error;
    known = !!(data && data.length);
  } catch (_) { known = seenSinceBoot.has(memKey); }   // no record to consult: a stranger until seen
  if (seenSinceBoot.size > 5000) seenSinceBoot.clear();
  seenSinceBoot.add(memKey);
  const newDevice = !known;
  try {
    await supabase.from('login_events').insert({
      kind, account_id: String(id), event: 'login', ip: meta.ip, user_agent: meta.ua, device: meta.device,
      device_hash: deviceHash, method, new_device: newDevice,
    });
    if (Math.random() < 0.02) {   // trim old history now and then rather than on a schedule
      await supabase.from('login_events').delete().lt('at', new Date(Date.now() - HISTORY_KEEP_MS).toISOString());
    }
  } catch (_) { /* migration 023 not applied, or the database is busy: the sign-in stands */ }
  if (ALERT_MODE === 'off') return;
  if (newDevice || ALERT_MODE === 'all') await notifySecurity(kind, id, 'new_signin', { meta, extra: method.includes('recovery') ? 'Signed in with a recovery code' : '' });
}

// ── Signing in ────────────────────────────────────────────────────────────────
const challenges = new Map();   // mfa_token -> { kind, id, method, tries, busy, expires }
setInterval(() => { const t = Date.now(); for (const [k, c] of challenges) if (c.expires < t) challenges.delete(k); }, 60_000).unref();

// A session starts here, whichever way the person got in. Marks the browser, records
// the sign-in, and alerts if it is new — without waiting for any of that.
function finishLogin(req, res, { kind, id, payload, method }) {
  const { token } = startSession(kind, payload, req, { method });
  let deviceId = readDeviceId(req);
  if (!deviceId) deviceId = newDeviceId();
  setDeviceCookie(res, req, deviceId);   // every sign-in renews it, so a browser in use stays known
  recordSignIn({ kind, id, method, meta: requestMeta(req), deviceHash: hashDeviceId(deviceId) })
    .catch(e => console.warn('[security] sign-in record failed:', e.message));
  return token;
}

// The password (or Google) has been accepted. Either start the session, or — if the
// account has a second factor — hand back a challenge to answer first.
//   → { token } | { mfa_required, mfa_token } | { error: { status, message } }
async function beginLogin(req, res, { kind, id, payload, method }) {
  let factor;
  try { factor = await loadFactor(kind, id); }
  catch (e) {
    console.error('[2fa] could not read the second factor:', e.message);
    return { error: { status: 503, message: 'Could not check your sign-in right now. Try again in a moment.' } };
  }
  if (isEnabled(factor)) {
    const mfa_token = crypto.randomBytes(24).toString('hex');
    challenges.set(mfa_token, { kind, id: String(id), method, tries: 0, busy: false, expires: Date.now() + CHALLENGE_TTL_MS });
    return { mfa_required: true, mfa_token };
  }
  return { token: finishLogin(req, res, { kind, id, payload, method }) };
}

// The second step. `complete(ch)` returns what to sign in as: { payload, respond(token) }
// or null (the account is gone). Answers are deliberately alike so a wrong code, an
// expired challenge and a used one do not teach anyone which they hit.
function mountSecondStep(path, kind, complete) {
  receiver.router.post(path, express.json(), async (req, res) => {
    const { mfa_token, code } = req.body || {};
    const ch = challenges.get(String(mfa_token || ''));
    if (!ch || ch.kind !== kind || ch.expires < Date.now()) {
      return res.status(401).json({ error: 'Your sign-in expired. Enter your password again.', expired: true });
    }
    const acct = `${kind}:${ch.id}`;
    const wait = limit.mfaAccount.retryAfter(acct);
    if (wait) return tooMany(res, wait);
    if (ch.busy) return res.status(429).json({ error: 'One moment — still checking the last code.' });
    ch.busy = true;
    try {
      let r;
      try { r = await checkSecondFactor(kind, ch.id, code); }
      catch (e) { console.error('[2fa] check failed:', e.message); return res.status(503).json({ error: 'Could not check the code right now. Try again in a moment.' }); }
      if (!r.ok && r.reason === 'not_enabled') {
        // Switched off while they were signing in (an administrator reset it). There is
        // nothing left to answer: start again, where the password alone will do.
        challenges.delete(mfa_token);
        return res.status(401).json({ error: 'Your sign-in expired. Enter your password again.', expired: true });
      }
      if (!r.ok) {
        limit.mfaAccount.fail(acct);
        ch.tries++;
        if (ch.tries >= CHALLENGE_TRIES) {
          challenges.delete(mfa_token);
          // They had the password. That is worth telling the owner about.
          notifySecurity(kind, ch.id, 'mfa_locked', { meta: requestMeta(req) }).catch(() => {});
          return res.status(401).json({ error: 'Too many wrong codes. Enter your password again.', expired: true });
        }
        return res.status(401).json({ error: r.reason === 'unreadable' ? 'This account\'s two-factor secret cannot be read. Ask an administrator to reset it.' : 'That code is not right.', attemptsLeft: CHALLENGE_TRIES - ch.tries });
      }
      challenges.delete(mfa_token);   // answered once; the challenge is spent
      limit.mfaAccount.reset(acct);
      const who = await complete(ch);
      if (!who) return res.status(401).json({ error: 'This account is no longer available.', expired: true });
      const method = `${ch.method}+${r.via === 'recovery' ? 'recovery' : '2fa'}`;
      const token = finishLogin(req, res, { kind, id: ch.id, payload: who.payload, method });
      if (r.via === 'recovery') {
        notifySecurity(kind, ch.id, 'recovery_used', { meta: requestMeta(req), extra: `${r.left} recovery code${r.left === 1 ? '' : 's'} left` }).catch(() => {});
      }
      return res.json(who.respond(token));
    } finally { ch.busy = false; }
  });
}

mountSecondStep('/api/employee/login/2fa', 'employee', async ch => {
  const { data: emp } = await supabase.from('employees').select('*').eq('id', ch.id).maybeSingle();
  if (!emp) return null;
  return { payload: ctx.employeeSessionPayload(emp), respond: token => ctx.employeeLoginResponse(emp, token) };
});
mountSecondStep('/api/auth/login/2fa', 'admin', async () => ({
  payload: { username: ctx.ADMIN_USERNAME }, respond: token => ({ token, username: ctx.ADMIN_USERNAME }),
}));

// ── The Security panel (both portals) ─────────────────────────────────────────
async function accountSessions(kind, id, currentToken) {
  const map = kind === 'admin' ? ctx.sessions : ctx.employeeSessions;
  const byToken = new Map();
  for (const [t, s] of map) if (kind === 'admin' || String(s.id) === String(id)) byToken.set(t, s);
  // Logins only the table knows (after a restart, before their next request).
  try {
    let q = supabase.from('sessions').select('token,payload,created_at').eq('kind', kind);
    if (kind === 'employee') q = q.eq('payload->>id', String(id));
    const { data } = await q;
    for (const r of data || []) {
      if (byToken.has(r.token) || Date.now() - Date.parse(r.created_at) > ctx.SESSION_MAX_AGE_MS) continue;
      byToken.set(r.token, { ...r.payload, createdAt: r.payload.createdAt || Date.parse(r.created_at) });
    }
  } catch (_) {}
  return [...byToken].map(([token, s]) => ({
    token, sid: s.sid || ctx.tokenTag(token), device: s.device || 'Unknown device', ip: s.ip || '',
    createdAt: s.createdAt || null, lastSeenAt: s.lastSeenAt || s.createdAt || null, method: s.method || '',
    current: token === currentToken,
  })).sort((a, b) => (b.current - a.current) || ((b.lastSeenAt || 0) - (a.lastSeenAt || 0)));
}

async function verifyAccountPassword(kind, id, password) {
  if (!password) return false;
  if (kind === 'admin') return ctx.verifyAdminPassword(password);
  const { data } = await supabase.from('employees').select('password_hash').eq('id', id).maybeSingle();
  return !!(data && ctx.verifyPassword(String(password), data.password_hash));
}

function mountSecurity(prefix, guard, who) {
  const json = express.json();
  // Sensitive changes ask for the password again, so a borrowed or stolen session can
  // neither lock the owner out (turn 2FA on) nor strip their protection (turn it off).
  async function reauth(req, res, w) {
    const key = `${w.kind}:${w.id}`;
    const wait = limit.reauth.retryAfter(key);
    if (wait) { tooMany(res, wait); return false; }
    if (await verifyAccountPassword(w.kind, w.id, (req.body || {}).password)) { limit.reauth.reset(key); return true; }
    limit.reauth.fail(key);
    // 403, not 401: the portals read any 401 as "your session ended" and sign the person
    // out, which is the wrong answer to a mistyped password.
    res.status(403).json({ error: 'That password is not right.' });
    return false;
  }
  // The same for the code, checked against the live factor.
  async function codeOk(req, res, w) {
    const wait = limit.mfaAccount.retryAfter(`${w.kind}:${w.id}`);
    if (wait) { tooMany(res, wait); return false; }
    const r = await checkSecondFactor(w.kind, w.id, (req.body || {}).code);
    if (r.ok) { limit.mfaAccount.reset(`${w.kind}:${w.id}`); return true; }
    limit.mfaAccount.fail(`${w.kind}:${w.id}`);
    res.status(403).json({ error: 'That code is not right.' });
    return false;
  }
  const guarded = (fn) => async (req, res) => {
    try { await fn(req, res, who(req)); }
    catch (e) {
      console.error(`[security] ${req.method} ${req.path}:`, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' });
    }
  };
  const unavailable = res => res.status(503).json({ error: 'Two-factor authentication is not available yet: the database migration (023_account_security.sql) has not been applied.' });

  receiver.router.get(`${prefix}/security`, guard, guarded(async (req, res, w) => {
    let factor, factorOk = true;
    try { factor = await loadFactor(w.kind, w.id); } catch (_) { factorOk = false; }
    // Not applied yet is something to ask for; a database that did not answer is something to retry.
    const unavailable = !factorOk ? 'error' : factor === undefined ? 'migration' : null;
    let logins = [], history = true;
    try {
      const { data, error } = await supabase.from('login_events').select('at,event,device,ip,method,new_device')
        .eq('kind', w.kind).eq('account_id', String(w.id)).order('at', { ascending: false }).limit(20);
      if (error) throw error;
      logins = data || [];
    } catch (_) { history = false; }
    const sessions = (await accountSessions(w.kind, w.id, req.sessionToken)).map(({ token, ...s }) => s);
    res.json({
      account: { kind: w.kind, name: w.name, canChangePassword: w.kind === 'employee' },
      twofa: {
        available: !unavailable, reason: unavailable, enabled: isEnabled(factor), enabledAt: factor && factor.enabled_at || null,
        recoveryLeft: isEnabled(factor) && Array.isArray(factor.recovery_codes) ? factor.recovery_codes.length : 0,
        encrypted: box.encrypted,
      },
      sessions, logins, history, alerts: ALERT_MODE,
    });
  }));

  receiver.router.post(`${prefix}/security/2fa/setup`, guard, json, guarded(async (req, res, w) => {
    const factor = await loadFactor(w.kind, w.id);
    if (factor === undefined) return unavailable(res);
    if (isEnabled(factor)) return res.status(409).json({ error: 'Two-factor authentication is already on. Turn it off first to set it up again.' });
    if (!(await reauth(req, res, w))) return;
    res.json(await startEnrolment(w.kind, w.id, w.label));
  }));

  receiver.router.post(`${prefix}/security/2fa/enable`, guard, json, guarded(async (req, res, w) => {
    const wait = limit.mfaAccount.retryAfter(`${w.kind}:${w.id}`);
    if (wait) return tooMany(res, wait);
    const r = await confirmEnrolment(w.kind, w.id, (req.body || {}).code);
    if (!r.ok) {
      if (r.reason === 'no_setup') return res.status(400).json({ error: 'Start the setup again — that code is no longer waiting.' });
      limit.mfaAccount.fail(`${w.kind}:${w.id}`);
      return res.status(403).json({ error: 'That code is not right. Check your phone\'s clock and try the next one.' });
    }
    limit.mfaAccount.reset(`${w.kind}:${w.id}`);
    // Everything signed in before the second factor existed is untrusted now. This device, which just proved it holds the authenticator, stays.
    const out = await revokeSessions(w.kind, w.id, { exceptToken: req.sessionToken });
    notifySecurity(w.kind, w.id, 'twofa_enabled', { meta: requestMeta(req) }).catch(() => {});
    res.json({ ok: true, recoveryCodes: r.recoveryCodes, sessionsRevoked: out.revoked });
  }));

  receiver.router.post(`${prefix}/security/2fa/disable`, guard, json, guarded(async (req, res, w) => {
    const factor = await loadFactor(w.kind, w.id);
    if (!isEnabled(factor)) return res.status(400).json({ error: 'Two-factor authentication is not on.' });
    if (!(await reauth(req, res, w)) || !(await codeOk(req, res, w))) return;
    await removeFactor(w.kind, w.id);
    const out = await revokeSessions(w.kind, w.id, { exceptToken: req.sessionToken });
    notifySecurity(w.kind, w.id, 'twofa_disabled', { meta: requestMeta(req) }).catch(() => {});
    res.json({ ok: true, sessionsRevoked: out.revoked });
  }));

  receiver.router.post(`${prefix}/security/2fa/recovery-codes`, guard, json, guarded(async (req, res, w) => {
    const factor = await loadFactor(w.kind, w.id);
    if (!isEnabled(factor)) return res.status(400).json({ error: 'Two-factor authentication is not on.' });
    if (!(await reauth(req, res, w)) || !(await codeOk(req, res, w))) return;
    const codes = await replaceRecoveryCodes(w.kind, w.id);
    notifySecurity(w.kind, w.id, 'recovery_new', { meta: requestMeta(req) }).catch(() => {});
    res.json({ ok: true, recoveryCodes: codes });
  }));

  receiver.router.post(`${prefix}/security/sessions/revoke-others`, guard, json, guarded(async (req, res, w) => {
    const out = await revokeSessions(w.kind, w.id, { exceptToken: req.sessionToken });
    res.json({ ok: out.persisted, sessionsRevoked: out.revoked, ...(out.persisted ? {} : { warning: 'Some sign-outs could not be saved. Try again.' }) });
  }));

  receiver.router.delete(`${prefix}/security/sessions/:sid`, guard, guarded(async (req, res, w) => {
    const target = (await accountSessions(w.kind, w.id, req.sessionToken)).find(s => s.sid === req.params.sid);
    if (!target) return res.status(404).json({ error: 'That session is already gone.' });
    if (target.current) return res.status(400).json({ error: 'That is this device. Use Sign out instead.' });
    await revokeToken(w.kind, w.id, target.token);
    res.json({ ok: true });
  }));
}

mountSecurity('/api/employee', requireEmployeeAuth, req => ({ kind: 'employee', id: req.employee.id, name: req.employee.name, label: req.employee.username }));
mountSecurity('/api/dashboard', requireAuth, req => ({ kind: 'admin', id: 'admin', name: 'Admin', label: ctx.ADMIN_USERNAME }));

// An administrator clears an employee's second factor — a lost phone and no recovery
// codes. The employee's logins end, and they are told, so this cannot be used quietly.
receiver.router.post('/api/dashboard/employees/:id/2fa/reset', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    await removeFactor('employee', id);
    const out = await revokeSessions('employee', id);
    notifySecurity('employee', id, 'twofa_reset').catch(() => {});
    res.json({ ok: true, sessionsRevoked: out.revoked, ...(out.persisted ? {} : { warning: 'Two-factor was cleared, but some of their saved logins could not be ended. Reset again, or restart the service.' }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { beginLogin, finishLogin, loginGate, loginFailed, loginSucceeded, tooMany, notifySecurity, twoFactorFlags, forgotLimiter: limit.forgot, removeFactor };
