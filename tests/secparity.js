// The new app's Security panel against the classic portals' (public/assets/security.js, in the admin's and the team's), value
// by value — the same method as tests/meetparity.js (see there): the classic page and the new app opened as the same person, in
// both colour modes and two looks, at a phone's width, two in-betweens and a desktop, and the computed style of every named part
// compared, and the words in them.
//
// What the server says is stood in for, the same on both sides (the panel is the same on both sides; what it is shown is what
// differs, and every state of it — a database without its table, a code about to run out — cannot be had from a real one):
//
//   loading        the server is slow to answer
//   off            two-factor is off: the devices, the sign-ins, and (team) the password card
//   on             it is on, with two recovery codes left (which says so), three devices and four sign-ins
//   unavailable    the database cannot hold a second factor (the migration), and has no history
//   broken         …it did not answer, alerts are off, and there are no sign-ins (and the admin's secrets are unencrypted)
//   setupPassword  Turn on: the password is asked for again
//   setupError     …Continue with none typed: the panel says so
//   setupScan      …the key and the picture to scan
//   codes          …the code was right: the recovery codes, and Done waiting for them to be saved
//   disable        Turn off: the password and a code
//   newCodes       New recovery codes: the password and a code
//   signedOut      one device signed out: the panel says so
//
// Run with --print to see every difference rather than the first few; --only=<portal>/<look>/<mode> narrows it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, sleep, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');

const ROOT = path.join(__dirname, '..');
const PRINT = process.argv.includes('--print');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// Where the two differ on purpose or by necessity, and why. Each must still differ, or it is stale and fails.
const ACCEPTED = {};

// ── What the server says ────────────────────────────────────────────────────────────────────────────────────────────────
const SETUP = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauth: 'otpauth://totp/MotoLinker:demo?secret=JBSWY3DPEHPK3PXP&issuer=MotoLinker',
  // a 232-pixel picture, drawn the way the server's is: opaque, square
  qr: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="232" height="232"><rect width="232" height="232" fill="#fff"/><rect x="20" y="20" width="60" height="60"/><rect x="152" y="20" width="60" height="60"/><rect x="20" y="152" width="60" height="60"/></svg>'),
};
const CODES = ['k3m9x-aq72b', 'p4t8c-zz91d', 'w7n2e-hh63f', 'r5v1j-yy48g', 'c9b6s-mm25h', 'd2f7u-nn80i', 'g8h4l-qq37j', 'x1y5z-tt69k', 'a6s3d-ww14l', 'm0o9p-ee52n'];

/** What the overview says, for a person of this kind in this state. Stamps are made when the scenario starts (the panel says "3 h ago"). */
function overview(kind, state) {
  const now = Date.now();
  const session = (o = {}) => ({ sid: 'sid-0', device: 'Chrome on Windows', ip: '10.0.0.1', createdAt: now - 3 * 3600e3, lastSeenAt: now - 20e3, method: 'password', current: true, ...o });
  const login = (o = {}) => ({ at: '2026-10-30T10:05:00.000Z', event: 'login', device: 'Chrome on Windows', ip: '10.0.0.1', method: 'password', new_device: false, ...o });
  const twofa = (o = {}) => ({ available: true, reason: null, enabled: false, enabledAt: null, recoveryLeft: 0, encrypted: true, ...o });
  const base = {
    account: { kind, name: kind === 'admin' ? 'Admin' : 'Admin Person', canChangePassword: kind === 'team' },
    twofa: twofa(), sessions: [session()], logins: [login(), login({ at: '2026-10-29T08:00:00.000Z', method: 'google', ip: '10.0.0.7', device: 'Safari on iPhone', new_device: true })],
    history: true, alerts: 'new',
  };
  if (kind === 'team') base.account.kind = 'employee';
  if (state === 'on') {
    return {
      ...base,
      twofa: twofa({ enabled: true, enabledAt: '2026-10-01T09:00:00.000Z', recoveryLeft: 2 }),
      sessions: [session(), session({ sid: 'sid-1', device: 'Safari on iPhone', ip: '10.0.0.7', current: false, createdAt: now - 26 * 3600e3, lastSeenAt: now - 5 * 3600e3, method: 'google+2fa' }),
        session({ sid: 'sid-2', device: 'Firefox on Linux', ip: '', current: false, createdAt: null, lastSeenAt: null, method: '' })],
      logins: [login({ method: 'password+2fa' }), login({ at: '2026-10-29T08:00:00.000Z', method: 'google+recovery', ip: '10.0.0.7', device: 'Safari on iPhone', new_device: true }),
        login({ at: '2026-10-28T08:00:00.000Z', device: null, ip: null, method: null }), login({ at: '2026-10-27T08:00:00.000Z', method: 'passkey' })],
    };
  }
  if (state === 'unavailable') return { ...base, twofa: twofa({ available: false, reason: 'migration' }), history: false, logins: [] };
  if (state === 'broken') return { ...base, twofa: twofa({ available: false, reason: 'error', encrypted: kind === 'team' }), alerts: 'off', logins: [] };
  if (state === 'unencrypted') return { ...base, twofa: twofa({ encrypted: false }) };
  return base;
}
const answers = (kind, state) => ({
  overview: { status: 200, body: overview(kind, state), delay: state === 'loading' ? 1800 : 0 },
  setup: { status: 200, body: SETUP },
  enable: { status: 200, body: { ok: true, recoveryCodes: CODES, sessionsRevoked: 2 } },
  disable: { status: 200, body: { ok: true, sessionsRevoked: 1 } },
  newCodes: { status: 200, body: { ok: true, recoveryCodes: CODES } },
  signOut: { status: 200, body: { ok: true } },
  others: { status: 200, body: { ok: true, sessionsRevoked: 2 } },
});

/** The page's questions to the security routes, answered from `S` (which a scenario changes as it goes). */
const stubFrom = S => async (url, method) => {
  const sub = /^\/api\/(?:dashboard|employee)\/security(\/[^?]*)?$/.exec(new URL(url).pathname);
  if (!sub) return null;
  const at = sub[1] || '';
  const a = method === 'GET' && at === '' ? S.overview
    : at === '/2fa/setup' ? S.setup : at === '/2fa/enable' ? S.enable : at === '/2fa/disable' ? S.disable
      : at === '/2fa/recovery-codes' ? S.newCodes : at === '/sessions/revoke-others' ? S.others
        : /^\/sessions\//.test(at) ? S.signOut : null;
  if (!a) return { status: 404, body: { error: 'not stubbed: ' + method + ' ' + at } };
  if (a.delay) await sleep(a.delay);
  return a;
};

// ── The parts ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// The panel floats over the page (a fixed curtain): where a part is, is where it is in the window.
const free = (c, x, text = false) => part(c, x, 'abs', null, text);
const BOX = '#sec-overlay .sec-box';
const NB = '[data-part=dialog]';
/** A card of the panel, n-th: the classic box holds the head, the lead and a message that is always there before them. */
const cardAt = n => `${BOX} > div:nth-of-type(${n + 2})`;
/** …and the same parts, named, in the new app. */
const NEW = { twofa: '[data-part=twofa]', devices: '[data-part=devices]', history: '[data-part=history]', password: '[data-part=passwordCard]',
  setupPassword: '[data-part=setupPassword]', setupScan: '[data-part=setupScan]', codes: '[data-part=codesCard]', disable: '[data-part=disable]', newCodes: '[data-part=newCodesCard]' };

/** A part inside a card, by the path the two share (the new app draws the classic panel's elements, in its order). */
const inCard = (card, n, newCard) => (name, path, text = false) => ({ [name]: free(cardAt(n) + path, NEW[newCard] + path, text) });
const merge = (...roles) => Object.assign({}, ...roles);

function rolesFor(who) {
  const head = {
    overlay: free('#sec-overlay', `${NB.replace(/\[data-part=dialog\]/, '[data-part=curtain]')}`),
    box: free(BOX, NB),
    head: free(`${BOX} > .sec-head`, `${NB} > [data-part=head]`),
    title: free(`${BOX} .sec-title`, `${NB} [data-part=title]`, true),
    x: free(`${BOX} .sec-x`, `${NB} [data-part=close]`, true),
    lead: free(`${BOX} > .sec-lead`, `${NB} [data-part=lead]`, true),
    msg: free('#sec-msg', `${NB} [data-part=message]`, true),
  };
  const loading = { loading: free(`${BOX} > div:nth-of-type(3)`, `${NB} [data-part=loading]`, true) };
  // Two-factor, in each of its states
  const t = inCard('twofa', 1, 'twofa');
  const off = merge(
    t('twofa', ''), t('tRow', ' > div:nth-child(1)'), t('tText', ' > div:nth-child(1) > div:nth-child(1)'),
    t('tH', ' > div:nth-child(1) > div:nth-child(1) > div:nth-child(1)', true), t('tPill', ' > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > span', true),
    t('tSub', ' > div:nth-child(1) > div:nth-child(1) > div:nth-child(2)', true), t('tActions', ' > div:nth-child(1) > div:nth-child(2)'),
    t('tTurnOn', ' > div:nth-child(1) > div:nth-child(2) > button', true),
  );
  const on = merge(
    off,
    t('tBold', ' > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > b', true),
    t('tNewCodes', ' > div:nth-child(1) > div:nth-child(2) > button:nth-child(1)', true), t('tTurnOff', ' > div:nth-child(1) > div:nth-child(2) > button:nth-child(2)', true),
  );
  const unavailable = merge(t('twofa', ''), t('tH', ' > div:nth-child(1)', true), t('tPill', ' > div:nth-child(1) > span', true), t('tSub', ' > div:nth-child(2)', true), t('tCode', ' > div:nth-child(2) code', true));
  const unencrypted = merge(off, t('tWarn', ' > div:nth-child(2)', true), t('tWarnCode', ' > div:nth-child(2) code', true));
  delete off.tBold;
  // The devices
  const d = inCard('devices', 2, 'devices');
  const devices = merge(
    d('devices', ''), d('dRow', ' > div:nth-child(1)'), d('dH', ' > div:nth-child(1) > div:nth-child(1) > div:nth-child(1)', true), d('dSub', ' > div:nth-child(1) > div:nth-child(1) > div:nth-child(2)', true),
    d('dList', ' > div:nth-child(2)'),
    d('dItem1', ' > div:nth-child(2) > div:nth-child(1)', true), d('dB1', ' > div:nth-child(2) > div:nth-child(1) b', true), d('dHere', ' > div:nth-child(2) > div:nth-child(1) span', true),
    d('dMeta1', ' > div:nth-child(2) > div:nth-child(1) > div > div', true),
  );
  const devicesMore = merge(
    d('dActions', ' > div:nth-child(1) > div:nth-child(2)'), d('dOthers', ' > div:nth-child(1) > div:nth-child(2) > button', true),
    d('dItem2', ' > div:nth-child(2) > div:nth-child(2)', true), d('dB2', ' > div:nth-child(2) > div:nth-child(2) b', true), d('dMeta2', ' > div:nth-child(2) > div:nth-child(2) > div > div', true),
    d('dSignOut2', ' > div:nth-child(2) > div:nth-child(2) > button', true),
    d('dItem3', ' > div:nth-child(2) > div:nth-child(3)', true), d('dMeta3', ' > div:nth-child(2) > div:nth-child(3) > div > div', true), d('dSignOut3', ' > div:nth-child(2) > div:nth-child(3) > button', true),
  );
  // The sign-in record
  const h = inCard('history', 3, 'history');
  const historyNone = merge(h('history', ''), h('hH', ' > div:nth-child(1)', true), h('hSub', ' > div:nth-child(2)', true), h('hList', ' > div:nth-child(3)'), h('hNote', ' > div:nth-child(3) > div', true));
  const history = merge(
    h('history', ''), h('hH', ' > div:nth-child(1)', true), h('hSub', ' > div:nth-child(2)', true), h('hList', ' > div:nth-child(3)'),
    h('hItem1', ' > div:nth-child(3) > div:nth-child(1)', true), h('hB1', ' > div:nth-child(3) > div:nth-child(1) b', true), h('hMeta1', ' > div:nth-child(3) > div:nth-child(1) > div:nth-child(1) > div', true),
    h('hStamp1', ' > div:nth-child(3) > div:nth-child(1) > div:nth-child(2)', true),
    h('hItem2', ' > div:nth-child(3) > div:nth-child(2)', true), h('hNew2', ' > div:nth-child(3) > div:nth-child(2) span', true), h('hMeta2', ' > div:nth-child(3) > div:nth-child(2) > div:nth-child(1) > div', true),
  );
  const historyMore = merge(h('hItem3', ' > div:nth-child(3) > div:nth-child(3)', true), h('hB3', ' > div:nth-child(3) > div:nth-child(3) b', true), h('hMeta3', ' > div:nth-child(3) > div:nth-child(3) > div:nth-child(1) > div', true));
  // The team's password card
  const pw = inCard('password', 4, 'password');
  const password = merge(pw('pwCard', ''), pw('pwRow', ' > div:nth-child(1)'), pw('pwH', ' > div:nth-child(1) > div:nth-child(1) > div:nth-child(1)', true), pw('pwSub', ' > div:nth-child(1) > div:nth-child(1) > div:nth-child(2)', true),
    pw('pwActions', ' > div:nth-child(1) > div:nth-child(2)'), pw('pwBtn', ' > div:nth-child(1) > div:nth-child(2) > button', true));

  // The forms
  const form = (newCard, nthLabel) => {
    const f = inCard(newCard, 1, newCard);
    return f;
  };
  const sp = inCard('setupPassword', 1, 'setupPassword');
  const setupPassword = merge(sp('spCard', ''), sp('spH', ' > div:nth-child(1)', true), sp('spSub', ' > div:nth-child(2)', true), sp('spLabel', ' > label', true), sp('spInput', ' > input'),
    sp('spFoot', ' > div:nth-child(5)'), sp('spCancel', ' > div:nth-child(5) > button:nth-child(1)', true), sp('spGo', ' > div:nth-child(5) > button:nth-child(2)', true));
  const ss = inCard('setupScan', 1, 'setupScan');
  const setupScan = merge(ss('ssCard', ''), ss('ssH', ' > div:nth-child(1)', true), ss('ssSteps', ' > ol', true), ss('ssStep1', ' > ol > li:nth-child(1)', true),
    ss('ssQr', ' > div:nth-child(3)'), ss('ssImg', ' > div:nth-child(3) > img'), ss('ssSide', ' > div:nth-child(3) > div'), ss('ssPhone', ' > div:nth-child(3) > div > div:nth-child(1)', true),
    ss('ssLink', ' > div:nth-child(3) > div > div:nth-child(1) a', true), ss('ssByHand', ' > div:nth-child(3) > div > div:nth-child(2)', true), ss('ssKey', ' > div:nth-child(3) > div > div:nth-child(3)', true),
    ss('ssLabel', ' > label', true), ss('ssInput', ' > input'), ss('ssFoot', ' > div:nth-child(6)'), ss('ssCancel', ' > div:nth-child(6) > button:nth-child(1)', true), ss('ssGo', ' > div:nth-child(6) > button:nth-child(2)', true));
  const cd = inCard('codes', 1, 'codes');
  const codes = merge(cd('cdCard', ''), cd('cdH', ' > div:nth-child(1)', true), cd('cdSub', ' > div:nth-child(2)', true), cd('cdBold', ' > div:nth-child(2) > b', true), cd('cdGrid', ' > div:nth-child(3)'),
    cd('cdCode1', ' > div:nth-child(3) > code:nth-child(1)', true), cd('cdCode2', ' > div:nth-child(3) > code:nth-child(2)', true), cd('cdActions', ' > div:nth-child(4)'), cd('cdCopy', ' > div:nth-child(4) > button:nth-child(1)', true),
    cd('cdDownload', ' > div:nth-child(4) > button:nth-child(2)', true), cd('cdSigned', ' > div:nth-child(5)', true), cd('cdCheck', ' > label', true), cd('cdBox', ' > label > input'),
    cd('cdFoot', ' > div:nth-child(7)'), cd('cdDone', ' > div:nth-child(7) > button', true));
  const dis = inCard('disable', 1, 'disable');
  const disable = merge(dis('diCard', ''), dis('diH', ' > div:nth-child(1)', true), dis('diSub', ' > div:nth-child(2)', true), dis('diLabel1', ' > label:nth-of-type(1)', true), dis('diPw', ' > input:nth-of-type(1)'),
    dis('diLabel2', ' > label:nth-of-type(2)', true), dis('diCode', ' > input:nth-of-type(2)'), dis('diFoot', ' > div:nth-child(7)'), dis('diCancel', ' > div:nth-child(7) > button:nth-child(1)', true), dis('diGo', ' > div:nth-child(7) > button:nth-child(2)', true));
  const nc = inCard('newCodes', 1, 'newCodes');
  const newCodes = merge(nc('ncCard', ''), nc('ncH', ' > div:nth-child(1)', true), nc('ncSub', ' > div:nth-child(2)', true), nc('ncLabel2', ' > label:nth-of-type(2)', true), nc('ncCode', ' > input:nth-of-type(2)'),
    nc('ncFoot', ' > div:nth-child(7)'), nc('ncGo', ' > div:nth-child(7) > button:nth-child(2)', true));
  void form;
  return { head, loading, off, on, unavailable, unencrypted, devices, devicesMore, historyNone, history, historyMore, password, setupPassword, setupScan, codes, disable, newCodes };
}

// What to read in each state (names of the groups above)
const READS = {
  loading: ['head', 'loading'],
  off: ['head', 'off', 'devices', 'history', 'password'],
  offAdmin: ['head', 'off', 'devices', 'history'],
  on: ['head', 'on', 'devices', 'devicesMore', 'history', 'historyMore', 'password'],
  onAdmin: ['head', 'on', 'devices', 'devicesMore', 'history', 'historyMore'],
  unavailable: ['head', 'unavailable', 'devices', 'historyNone', 'password'],
  broken: ['head', 'unavailable', 'devices', 'historyNone', 'password'],
  unencrypted: ['head', 'unencrypted', 'devices', 'history'],
  setupPassword: ['head', 'setupPassword'],
  setupError: ['head', 'setupPassword'],
  setupScan: ['head', 'setupScan'],
  codes: ['head', 'codes'],
  disable: ['head', 'disable'],
  newCodes: ['head', 'newCodes'],
  signedOut: ['head', 'on', 'devices', 'history'],
};

const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, portals } = await bootDemo({ port: process.env.PORT || 3974 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const kind = p.who;
    const ROLES = rolesFor(p.who);
    const S = answers(kind, 'off');
    const page = await openPage(browser, base, p, mode, next, stubFrom(S));
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active, #app', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + '.ai-card,[data-part=aiCard]{display:none!important}' });
    const pick = (classic, now) => next ? now : classic;
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => (document.querySelector('[data-part=dialog], #sec-overlay') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 240)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the panel says: "${seen}"`);
    });
    const reading = async (state, groups) => {
      const which = {};
      for (const g of groups) for (const [role, def] of Object.entries(ROLES[g])) which[role] = def;
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 900 });
        await settle(page);
        const at = `${p.who}/${key}/${state}/${width}`;
        (observed[at] = observed[at] || {})[side] = await readRoles(page, which, side, PROPS_MORE);
      }
      await page.setViewport({ width: 1100, height: 900 });
      await settle(page);
    };
    const click = (classic, now) => page.evaluate(s => document.querySelector(s).click(), pick(classic, now));
    const type = async (classic, now, text) => { await page.type(pick(classic, now), text); };
    const panelOpen = pick('#sec-overlay.open .sec-box', '[data-part=dialog]');
    const panelGone = () => until(s => !document.querySelector(s), panelOpen, 'the panel to go');
    // the entry points: the team's account menu, the admin's footer
    const open = async () => {
      if (p.who === 'team') {
        await click('#profile-btn', '[data-part=profileBtn]');
        await page.evaluate(next => [...document.querySelectorAll(next ? '[data-part=profileMenu] button' : '#profile-menu .profile-item')].find(b => b.textContent.trim() === 'Security').click(), next);
      } else {
        await page.evaluate(next => [...document.querySelectorAll(next ? '[data-part=footer] button' : '.sidebar-footer .logout-btn, .logout-btn')].find(b => b.textContent.trim().startsWith('Security')).click(), next);
      }
      await until(s => !!document.querySelector(s), panelOpen, 'the panel');
    };
    const close = async () => { await page.keyboard.press('Escape'); await panelGone(); };
    const loaded = what => until(s => { const e = document.querySelector(s); return !!e && !/Loading…/.test(e.innerText); }, pick('#sec-overlay .sec-box', '[data-part=dialog]'), what);
    const group = pick('#sec-overlay .sec-card', '[data-part=dialog] [data-part=twofa], [data-part=dialog] [data-part=setupPassword]');
    const reset = state => Object.assign(S, answers(kind, state));

    // loading: the server is slow, the panel is opened, the loader is read before the answer comes
    reset('loading');
    await open();
    await reading('loading', READS.loading);
    await loaded('the overview');
    await close();

    // off
    reset('off');
    await open(); await loaded('the overview');
    await until(s => !!document.querySelector(s), pick('#sec-overlay .sec-card', '[data-part=twofa]'), 'the cards');
    await reading(kind === 'admin' ? 'offAdmin' : 'off', READS[kind === 'admin' ? 'offAdmin' : 'off']);

    // turn on: the password, asked for again — and what it says when none was typed
    await click(pick('#sec-overlay .sec-btn.primary', '[data-part=turnOn]'), '[data-part=turnOn]');
    await until(s => !!document.querySelector(s), pick('#sec-pw', '[data-part=password]'), 'the password form');
    await reading('setupPassword', READS.setupPassword);
    await click(pick('#sec-go', '[data-part=go]'), '[data-part=go]');
    await until(s => { const e = document.querySelector(s); return !!e && e.textContent.trim().length > 0 && getComputedStyle(e).display !== 'none'; }, pick('#sec-msg', '[data-part=message]'), 'the message');
    await reading('setupError', READS.setupError);
    await type('#sec-pw', '[data-part=password]', 'sara-password-1');
    await click(pick('#sec-go', '[data-part=go]'), '[data-part=go]');
    await until(s => !!document.querySelector(s), pick('#sec-overlay .sec-qr img', '[data-part=qr] img'), 'the key to scan');
    await page.waitForFunction(s => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }, { timeout: 10000 }, pick('#sec-overlay .sec-qr img', '[data-part=qr] img'));
    await reading('setupScan', READS.setupScan);
    await type('#sec-code', '[data-part=code]', '123456');
    await click(pick('#sec-go', '[data-part=go]'), '[data-part=go]');
    await until(s => document.querySelectorAll(s).length === 10, pick('#sec-overlay .sec-codes code', '[data-part=codes] code'), 'the recovery codes');
    await reading('codes', READS.codes);
    await close();

    // on
    reset('on');
    await open(); await loaded('the overview');
    await until(s => document.querySelectorAll(s).length === 3, pick(`${cardAt(2)} .sec-item`, '[data-part=session]'), 'the devices');
    await reading(kind === 'admin' ? 'onAdmin' : 'on', READS[kind === 'admin' ? 'onAdmin' : 'on']);

    // turn off, and new codes
    await click(pick('#sec-overlay .sec-btn.danger.sm', '[data-part=turnOff]'), '[data-part=turnOff]');
    await until(s => !!document.querySelector(s), pick('#sec-code', '[data-part=code]'), 'the form to turn it off');
    await reading('disable', READS.disable);
    await click(pick('#sec-overlay .sec-foot .sec-btn:not(.danger)', '[data-part=cancel]'), '[data-part=cancel]');
    await until(s => !!document.querySelector(s), pick('#sec-overlay .sec-btn.sm', '[data-part=newCodes]'), 'the overview again');
    await click(pick('#sec-overlay .sec-btn.sm', '[data-part=newCodes]'), '[data-part=newCodes]');
    await until(s => !!document.querySelector(s), pick('#sec-code', '[data-part=code]'), 'the form for new codes');
    await reading('newCodes', READS.newCodes);
    await close();

    // a device signed out: the panel says so, over the list it asked for again
    reset('on');
    S.signOut = { status: 200, body: { ok: true } };
    await open(); await loaded('the overview');
    await until(s => document.querySelectorAll(s).length === 3, pick(`${cardAt(2)} .sec-item`, '[data-part=session]'), 'the devices');
    // (the next answer is the list without that device)
    const after = answers(kind, 'on').overview;
    after.body.sessions = after.body.sessions.filter(s => s.sid !== 'sid-1');
    S.overview = after;
    await page.evaluate(next => [...document.querySelectorAll(next ? '[data-part=session] button' : '#sec-overlay .sec-item button')].find(b => b.textContent.trim() === 'Sign out').click(), next);
    await until(s => { const e = document.querySelector(s); return !!e && /Signed out/.test(e.textContent); }, pick('#sec-msg', '[data-part=message]'), 'the message');
    await reading('signedOut', READS.signedOut);
    await close();

    // the database cannot hold a second factor / did not answer
    reset('unavailable');
    await open(); await loaded('the overview');
    await until(s => !!document.querySelector(s), pick('#sec-overlay .sec-card', '[data-part=twofa]'), 'the cards');
    await reading('unavailable', READS.unavailable);
    await close();
    reset('broken');
    await open(); await loaded('the overview');
    await until(s => !!document.querySelector(s), pick('#sec-overlay .sec-card', '[data-part=twofa]'), 'the cards');
    await reading('broken', READS.broken);
    await close();
    if (kind === 'admin') {
      reset('unencrypted');
      await open(); await loaded('the overview');
      await until(s => !!document.querySelector(s), pick('#sec-overlay .sec-card', '[data-part=twofa]'), 'the cards');
      await reading('unencrypted', READS.unencrypted);
      await close();
    }
    void group;
    await page.shut();
  };

  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const p of portals) for (const mode of MODES) for (const side of ['classic', 'next']) {
      if (ONLY && !`${p.who}/${look}/${mode}`.startsWith(ONLY)) continue;
      await scenario(p, mode, side, `${look}/${mode}`);
    }
  }
  await browser.close();

  const stale = new Set(Object.keys(ACCEPTED));
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const { n, bad } = diff(classic, next, ACCEPTED, stale, PROPS_MORE);
    compared += n;
    check(`${key}: ${n} values are the classic panel's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (!ONLY) {
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 600000, String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
