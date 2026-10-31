// The new app's Security panel and account menu, whole: a real server (the real routes, limits and sessions, an in-memory
// database), the built app, a real browser. tests/signintest.js and tests/account.js hold the server's side (what each route
// answers, to whom, and what it does), apps/web's own tests hold the screens against a script, and tests/secparity.js and
// tests/acctparity.js hold the look to the classic portals'. This is the three working together —
//
//   the team's account menu: the person's initials, then their status (a preset, their own words, cleared), their username
//     (a taken name, a bad one, a good one — and the session is told), their picture (a file that is not an image, and one that is),
//     all of it kept on the record and there again when the page is opened afresh
//   the password: a wrong current one is said so in the dialog and does NOT sign the person out; the right one signs the other
//     devices out (and says how many), and is the one to sign in with from then on
//   Security: two-factor on — the wrong password, the wrong code and the right ones, the key that is really a secret, the ten
//     recovery codes shown once and held until they are saved — then another device signed out, all the others, new codes,
//     and off again; the panel closes the three ways it should, and '/security' and '#security' open it over the page
//   the administrator's footer opens the same panel (without a password to change) and the same flow works
//   a session the server no longer knows ends the visit at the next question, as it does everywhere else
//
// The clock is under the test's control (as in signintest.js): a code is good for one 30-second step and is refused a second time.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const totp = require('../src/lib/totp');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath } = require('./helpers/browser');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;
const nextCode = secret => { skew += 30_000; return totp.totpAt(secret, Date.now()); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-websec-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// A picture one pixel across, and a file that is not one
const PNG = path.join(dist, 'face.png');
fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const TXT = path.join(dist, 'notes.txt');
fs.writeFileSync(TXT, 'not a picture');

(async () => {
  const db = createFakeSupabase({ ...seedTables(parseSchema()), account_security: [], login_events: [] }, {
    defaults: {
      notifications: () => ({ read: false }),
      account_security: () => ({ totp_enabled: false, recovery_codes: [], last_step: 0, updated_at: new Date().toISOString() }),
      login_events: () => ({ at: new Date().toISOString(), event: 'login', new_device: false }),
    },
  });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 4001, env: { ML_WEB_DIST: dist, MFA_ENCRYPTION_KEY: 'k'.repeat(40) } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));

  const person = (id, name, username, title, pw) => ({ ...db.tables.employees[0], id, name, username, job_title: title, permissions: {}, email: username + '@example.com', password_hash: ctx.hashPassword(pw), avatar_url: '', status_text: '', status_emoji: '' });
  db.tables.employees = db.tables.employees.filter(e => ![61, 62].includes(e.id)).concat([person(61, 'Sara Ali', 'sara', 'Sales', 'sara-password-1'), person(62, 'Omar Hassan', 'omar', 'Ops', 'omar-password-1')]);
  const SARA = { portal: 'team', token: 'ws-sara', key: 'ml_emp_token', route: '/employee', id: 61 };
  const ADMIN = { portal: 'admin', token: 'ws-admin', key: 'ml_admin_token', route: '/dashboard' };
  const sessionOf = (id, extra = {}) => ({ id, name: db.tables.employees.find(e => e.id === id).name, username: db.tables.employees.find(e => e.id === id).username, job_title: 'Sales', permissions: normEmpPerms({}), createdAt: Date.now(), ...extra });
  const give = () => {
    ctx.employeeSessions.set(SARA.token, sessionOf(61, { device: 'Chrome on Linux', ip: '127.0.0.1', method: 'password', sid: 'sid-here' }));
    ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now(), device: 'Chrome on Linux', ip: '127.0.0.1', method: 'password', sid: 'sid-admin' });
  };
  give();
  const row = () => db.tables.employees.find(e => e.id === 61);
  const factor = kind => db.tables.account_security.find(r => r.kind === kind && r.account_id === (kind === 'admin' ? 'admin' : '61'));
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };

  // ── the browser ──────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, url = '/home') => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failures = [];
    page.on('response', r => { if (/\/security|\/api\/employee\/(status|username|avatar|change-password)/.test(r.url()) && r.status() === 401) failures.push(r.url()); });
    page.on('dialog', d => d.accept());   // the "sign out every other device" question
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; }; });
    await page.evaluateOnNewDocument((key, token) => { localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto(base + p.route + url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { failures, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel);
  const part = name => `[data-part=${name}]`;
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const pressText = (page, scope, label) => page.evaluate((s, l) => { const b = [...document.querySelectorAll(s + ' button')].find(x => x.textContent.trim() === l); if (!b) return false; b.click(); return true; }, scope, label);
  const type = async (page, sel, words) => { await page.waitForSelector(sel, { timeout: 15000 }); await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.keyboard.type(words); };
  const where = page => page.evaluate(() => location.pathname + location.search + location.hash);
  const toasts = page => page.evaluate(() => [...document.querySelectorAll('[data-part=toast]')].map(e => e.textContent.trim()));
  const said = (page, what) => until(page, w => [...document.querySelectorAll('[data-part=toast]')].some(e => e.textContent.includes(w)), what);
  const messageIs = (page, re) => until(page, s => new RegExp(s).test((document.querySelector('[data-part=dialog] [data-part=message]') || {}).textContent || ''), re.source);
  const dialogOpen = (page, title) => until(page, t => [...document.querySelectorAll('[role=dialog]')].some(d => d.getAttribute('aria-label') === t || (d.querySelector('[data-part=title]') || {}).textContent === t), title);
  const menu = async page => { await press(page, part('profileBtn')); return until(page, () => !!document.querySelector('[data-part=profileMenu]'), null); };
  const panel = async (page, who) => {
    if (who === 'team') { await menu(page); await pressText(page, part('profileMenu'), 'Security'); }
    else await pressText(page, part('footer'), 'Security');
    return until(page, () => !!document.querySelector('[data-part=dialog][role], [role=dialog][aria-label="Account security"]'), null) && until(page, () => !!document.querySelector('[data-part=twofa]'), null);
  };
  const codesOf = page => page.evaluate(() => [...document.querySelectorAll('[data-part=codes] code')].map(e => e.textContent));
  const PANEL_X = '[role=dialog][aria-label="Account security"] [data-part=close]';

  // ═══ 1. the account menu: status, username, picture ═════════════════════════════════════
  {
    const page = await open(SARA);
    await menu(page);
    check('the account menu shows who she is: initials, name, job, and an invitation to set a status',
      (await text(page, part('avatar'))) === 'SA' && (await text(page, part('name'))) === 'Sara Ali' && (await text(page, part('status'))) === '＋ Set status', `${await text(page, part('avatar'))} / ${await text(page, part('name'))} / ${await text(page, part('status'))}`);

    // status
    await press(page, part('status'));
    check('the status line opens the status dialog, and the menu goes away behind it', await dialogOpen(page, 'Set status') && !(await page.$(part('profileMenu'))));
    await pressText(page, part('presets'), '📅 In a meeting');
    check('a preset fills both fields', (await page.$eval(part('emoji'), e => e.value)) === '📅' && (await page.$eval(part('text'), e => e.value)) === 'In a meeting');
    await pressText(page, part('dialog'), 'Save');
    check('Save keeps it on her record, closes the dialog and says so', await waitFor(() => row().status_text === 'In a meeting' && row().status_emoji === '📅') && await until(page, () => !document.querySelector('[data-part=dialog]'), null) && await said(page, 'Status updated'));
    await menu(page);
    check('…and the menu shows it', (await text(page, part('status'))) === '📅 In a meeting', await text(page, part('status')));
    await press(page, part('status'));
    check('the dialog opens with what she has', (await page.$eval(part('text'), e => e.value)) === 'In a meeting');
    await pressText(page, part('dialog'), 'Clear status');
    check('Clear status empties it on the record and says so', await waitFor(() => row().status_text === '' && row().status_emoji === '') && await said(page, 'Status cleared'));
    await menu(page);
    check('…and the invitation is back', (await text(page, part('status'))) === '＋ Set status');
    await press(page, part('status'));
    await type(page, part('text'), 'Back at 3');
    await pressText(page, part('dialog'), 'Save');
    check('her own words are kept as typed', await waitFor(() => row().status_text === 'Back at 3'));

    // username
    await menu(page);
    await press(page, part('changeUsername'));
    check('the pencil opens the username dialog with her name', await dialogOpen(page, 'Change Username') && (await page.$eval(part('username'), e => e.value)) === 'sara');
    await type(page, part('username'), 'omar');
    await pressText(page, part('dialog'), 'Save');
    check('a name somebody has says so in the dialog, and it stays open', await until(page, () => /already taken/.test((document.querySelector('[data-part=dialog] [data-part=error]') || {}).textContent || ''), null) && row().username === 'sara');
    await type(page, part('username'), 'a b');
    await pressText(page, part('dialog'), 'Save');
    check('a name that is not allowed says what a name may be', await until(page, () => /3-32 characters/.test((document.querySelector('[data-part=dialog] [data-part=error]') || {}).textContent || ''), null) && row().username === 'sara');
    await type(page, part('username'), 'sara.ali');
    await page.keyboard.press('Enter');
    check('a good name is kept, the dialog closes and it is said', await waitFor(() => row().username === 'sara.ali') && await until(page, () => !document.querySelector('[data-part=dialog]'), null) && await said(page, 'Username changed to sara.ali'));
    check('…and the session knows it (nothing undoes it on the next request)', ctx.employeeSessions.get(SARA.token).username === 'sara.ali');

    // picture
    await menu(page);
    const file = await page.$(part('avatarFile'));
    await file.uploadFile(TXT);
    check('a file that is not a picture is turned away before it is sent', await said(page, 'Please choose an image') && !db.storage.size);
    await file.uploadFile(PNG);
    check('a picture is stored and kept on her record', await waitFor(() => /avatars\/61_\d+\.png$/.test(row().avatar_url)) && [...db.storage.keys()].some(k => /^chat-files\/avatars\/61_/.test(k)) && await said(page, 'Profile picture updated'), row().avatar_url);
    check('…and it is shown in the button and the menu', await until(page, () => document.querySelectorAll('[data-part=avatar] img, [data-part=avatarLarge] img').length === 2, null));
    check('none of that signed her out', page.failures.length === 0, page.failures.join());

    // after a reload: the first paint has it all
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    await menu(page);
    check('opened afresh, the page has her picture, her status and her username (from /api/v1/me)',
      await until(page, () => document.querySelectorAll('[data-part=avatar] img').length === 1, null) && (await text(page, part('status'))) === 'Back at 3');
    await press(page, part('changeUsername'));
    check('…and the username dialog has her new name', (await page.$eval(part('username'), e => e.value)) === 'sara.ali');
    await page.keyboard.press('Escape');
    await page.shut();
  }

  // ═══ 2. the password ═════════════════════════════════════════════════════════════════════
  {
    ctx.employeeSessions.set('ws-sara-phone', sessionOf(61, { device: 'Safari on iPhone', sid: 'sid-phone' }));
    const page = await open(SARA);
    await menu(page);
    await pressText(page, part('profileMenu'), 'Change password');
    check('Change password opens its dialog, which says what it will do', await dialogOpen(page, 'Change Password') && /Every other device you are signed in on will be signed out/.test(await text(page, part('hint'))));
    await type(page, part('current'), 'not-her-password'); await type(page, part('new'), 'brand-new-pass-1'); await type(page, part('confirm'), 'brand-new-pass-1');
    await pressText(page, part('dialog'), 'Update Password');
    check('a wrong current password is said so in the dialog, in the server\'s words', await until(page, () => /Current password is incorrect/.test((document.querySelector('[data-part=dialog] [data-part=error]') || {}).textContent || ''), null));
    check('…and does not end her visit: still the app, no 401, her other device untouched', await page.$(part('sidebar')) !== null && page.failures.length === 0 && ctx.employeeSessions.has('ws-sara-phone'));
    await type(page, part('confirm'), 'something-else-1');
    await pressText(page, part('dialog'), 'Update Password');
    check('two different new passwords are said so before anything is sent', await until(page, () => /do not match/.test((document.querySelector('[data-part=dialog] [data-part=error]') || {}).textContent || ''), null));
    await type(page, part('current'), 'sara-password-1'); await type(page, part('new'), 'brand-new-pass-1'); await type(page, part('confirm'), 'brand-new-pass-1');
    await pressText(page, part('dialog'), 'Update Password');
    check('the right one says how many other devices were signed out', await until(page, () => /Password updated\. 1 other device was signed out\./.test((document.querySelector('[data-part=dialog] [data-part=done]') || {}).textContent || ''), null));
    check('…the other device is out and this one is in, and the new password is the one that works',
      !ctx.employeeSessions.has('ws-sara-phone') && ctx.employeeSessions.has(SARA.token) && ctx.verifyPassword('brand-new-pass-1', row().password_hash) && !ctx.verifyPassword('sara-password-1', row().password_hash));
    check('…and the fields are empty again', (await page.$eval(part('current'), e => e.value)) === '' && (await page.$eval(part('new'), e => e.value)) === '');
    await page.shut();
  }
  const PASSWORD = 'brand-new-pass-1';

  // ═══ 3. Security, team ═══════════════════════════════════════════════════════════════════
  {
    ctx.employeeSessions.set('ws-sara-tablet', sessionOf(61, { device: 'Chrome on Android', sid: 'sid-tablet', ip: '10.0.0.5' }));
    const page = await open(SARA);
    check('the account menu\'s Security opens the panel over the page, and the menu goes away', await panel(page, 'team') && !(await page.$(part('profileMenu'))) && (await where(page)).endsWith('/home'));
    check('…it says whose it is, that two-factor is off, and lists this device and the other one',
      /Sara Ali · Protect your account/.test(await text(page, part('lead'))) && /Off/.test(await text(page, part('twofa'))) && (await page.$$(part('session'))).length >= 2 && (await text(page, part('here'))) === 'This device');
    check('…with a Password card, which opens the password dialog and puts the panel away', await text(page, part('passwordCard')) !== null);

    // turn on
    await pressText(page, part('twofa'), 'Turn on');
    await pressText(page, part('dialog'), 'Continue');
    check('Continue with no password says so', await messageIs(page, /Enter your password\./));
    await type(page, part('password'), 'not-her-password');
    await pressText(page, part('dialog'), 'Continue');
    check('a wrong password is refused in the panel, in the server\'s words', await messageIs(page, /That password is not right\./));
    check('…and that is a 403, so she is still in the app (a 401 would have signed her out)', await page.$(part('sidebar')) !== null && page.failures.length === 0);
    await type(page, part('password'), PASSWORD);
    await pressText(page, part('dialog'), 'Continue');
    check('the right password shows a picture to scan', await until(page, () => { const i = document.querySelector('[data-part=qr] img'); return !!i && i.src.startsWith('data:image/png;base64,') && i.naturalWidth > 50; }, null));
    const secret = ((await text(page, part('key'))) || '').replace(/\s/g, '');
    check('…the key to type by hand, which is a real secret the server holds', /^[A-Z2-7]{32}$/.test(secret) && !!db.tables.account_security.length, secret);
    check('…and a link for opening it on a phone', (await page.$eval('[data-part=qr] a', a => a.getAttribute('href'))).startsWith('otpauth://totp/MotoLinker:'));
    await type(page, part('code'), '12345');
    await pressText(page, part('dialog'), 'Turn on');
    check('five digits are not a code, and say so', await messageIs(page, /Enter the 6-digit code from your app\./));
    await type(page, part('code'), '000000');
    await pressText(page, part('dialog'), 'Turn on');
    check('a wrong code does not turn it on', await messageIs(page, /That code is not right/) && !(factor('employee') || {}).totp_enabled);
    await type(page, part('code'), nextCode(secret));
    await pressText(page, part('dialog'), 'Turn on');
    check('the right code shows ten recovery codes', await until(page, () => document.querySelectorAll('[data-part=codes] code').length === 10, null));
    const codes = await codesOf(page);
    check('…which are the ones the server holds hashes of, and the factor is on', codes.every(c => /^[a-z0-9]{5}-[a-z0-9]{5}$/i.test(c)) && factor('employee').totp_enabled === true && factor('employee').recovery_codes.length === 10);
    check('…and the other devices were signed out, and the panel says how many', !ctx.employeeSessions.has('ws-sara-tablet') && ctx.employeeSessions.has(SARA.token) && /other device/.test(await text(page, part('signedOut'))), await text(page, part('signedOut')));
    check('"Done" waits until they are saved', await page.$eval(part('go'), b => b.disabled) === true);
    await press(page, part('saved'));
    await pressText(page, part('dialog'), 'Done');
    check('then the panel says two-factor is on, with ten codes left', await until(page, () => /On/.test((document.querySelector('[data-part=twofa]') || {}).textContent || '') && /10 recovery codes left/.test(document.body.innerText), null));

    // devices
    ctx.employeeSessions.set('ws-sara-phone2', sessionOf(61, { device: 'Safari on iPhone', sid: 'sid-phone2', ip: '10.0.0.9', method: 'google+2fa' }));
    await press(page, PANEL_X);
    await panel(page, 'team');
    check('a device that signed in another way is listed with how', await until(page, () => /Safari on iPhone.*Google \+ code/.test(document.querySelector('[data-part=devices]').innerText.replace(/\s+/g, ' ')), null));
    await page.evaluate(() => [...document.querySelectorAll('[data-part=session]')].find(s => /Safari/.test(s.textContent)).querySelector('button').click());
    check('signing one out ends that session and says so', await waitFor(() => !ctx.employeeSessions.has('ws-sara-phone2')) && await messageIs(page, /Signed out\. If you did not recognise it/));
    ctx.employeeSessions.set('ws-sara-a', sessionOf(61, { device: 'Chrome on Mac', sid: 'sid-a' }));
    ctx.employeeSessions.set('ws-sara-b', sessionOf(61, { device: 'Edge on Windows', sid: 'sid-b' }));
    await press(page, PANEL_X); await panel(page, 'team');
    await until(page, () => !!document.querySelector('[data-part=signOutOthers]'), null);
    await press(page, part('signOutOthers'));
    check('"Sign out all other devices" asks, then signs them out and counts them', await messageIs(page, /Signed out 2 other devices\./) && !ctx.employeeSessions.has('ws-sara-a') && !ctx.employeeSessions.has('ws-sara-b') && ctx.employeeSessions.has(SARA.token));

    // new codes
    await pressText(page, part('twofa'), 'New recovery codes');
    await type(page, part('password'), PASSWORD);
    await type(page, part('code'), nextCode(secret));
    await pressText(page, part('dialog'), 'Make new codes');
    check('new codes need the password and a code, and are ten others', await until(page, () => document.querySelectorAll('[data-part=codes] code').length === 10, null) && (await codesOf(page)).every(c => !codes.includes(c)));
    await press(page, part('saved'));
    await pressText(page, part('dialog'), 'Done');
    await until(page, () => /10 recovery codes left/.test(document.body.innerText), null);

    // turn off
    await pressText(page, part('twofa'), 'Turn off');
    await type(page, part('password'), 'not-her-password');
    await type(page, part('code'), nextCode(secret));
    await pressText(page, part('dialog'), 'Turn off');
    check('turning it off with the wrong password is refused, and she stays in', await messageIs(page, /That password is not right\./) && factor('employee').totp_enabled === true && page.failures.length === 0);
    await type(page, part('password'), PASSWORD);
    await type(page, part('code'), nextCode(secret));
    await pressText(page, part('dialog'), 'Turn off');
    check('with the password and a code it is off, and the panel says so', await messageIs(page, /Two-factor authentication is off\./) && !factor('employee') && /Off/.test(await text(page, part('twofa'))));

    // putting it away
    await page.keyboard.press('Escape');
    check('Escape puts the panel away', await until(page, () => !document.querySelector('[role=dialog][aria-label="Account security"]'), null));
    await panel(page, 'team');
    await press(page, PANEL_X);
    check('so does ×', await until(page, () => !document.querySelector('[role=dialog][aria-label="Account security"]'), null));
    await panel(page, 'team');
    await page.mouse.click(5, 5);
    check('so does a press on the curtain', await until(page, () => !document.querySelector('[role=dialog][aria-label="Account security"]'), null));
    await panel(page, 'team');
    await pressText(page, part('passwordCard'), 'Change password');
    check('Change password puts the panel away and opens the password dialog', await dialogOpen(page, 'Change Password') && !(await page.$('[role=dialog][aria-label="Account security"]')));
    await page.shut();
  }

  // ═══ 4. the links to it ══════════════════════════════════════════════════════════════════
  {
    const page = await open(SARA, '/security');
    check('/security opens the panel over the last page, and the address is that page\'s own', await until(page, () => !!document.querySelector('[role=dialog][aria-label="Account security"]'), null) && !/security/.test(await where(page)), await where(page));
    await page.shut();
    const hash = await open(SARA, '#security');
    check('#security, as a security alert\'s notification carries it, does the same', await until(hash, () => !!document.querySelector('[role=dialog][aria-label="Account security"]'), null) && !/security/.test(await where(hash)), await where(hash));
    await hash.shut();
  }

  // ═══ 5. the administrator ════════════════════════════════════════════════════════════════
  {
    const page = await open(ADMIN);
    check('the admin\'s footer opens the same panel', await panel(page, 'admin') && /Admin · Protect your account/.test(await text(page, part('lead'))));
    check('…which has no Password card (the administrator has no password to change here)', await page.$(part('passwordCard')) === null);
    await pressText(page, part('twofa'), 'Turn on');
    await type(page, part('password'), 'pw');
    await pressText(page, part('dialog'), 'Continue');
    await until(page, () => !!document.querySelector('[data-part=qr] img'), null);
    const secret = ((await text(page, part('key'))) || '').replace(/\s/g, '');
    await type(page, part('code'), nextCode(secret));
    await pressText(page, part('dialog'), 'Turn on');
    check('the admin turns two-factor on with the same steps', await until(page, () => document.querySelectorAll('[data-part=codes] code').length === 10, null) && factor('admin').totp_enabled === true);
    await press(page, part('saved'));
    await pressText(page, part('dialog'), 'Done');
    await until(page, () => /On/.test((document.querySelector('[data-part=twofa]') || {}).textContent || '') && !!document.querySelector('[data-part=turnOff]'), null);
    await pressText(page, part('twofa'), 'Turn off');
    await type(page, part('password'), 'pw');
    await type(page, part('code'), nextCode(secret));
    await pressText(page, part('dialog'), 'Turn off');
    check('…and off again', await messageIs(page, /Two-factor authentication is off\./) && !factor('admin'));
    await page.shut();
  }

  // ═══ 6. a session the server no longer knows ═════════════════════════════════════════════
  {
    const page = await open(SARA);
    await panel(page, 'team');
    await pressText(page, part('twofa'), 'Turn on');
    await type(page, part('password'), PASSWORD);
    // (the server forgets her only now, between the typing and the question: anything it was asked sooner would have ended the visit sooner)
    ctx.employeeSessions.delete(SARA.token);
    db.tables.sessions = db.tables.sessions.filter(r => r.token !== SARA.token);
    await pressText(page, part('dialog'), 'Continue');
    check('a question put to the server with a session it has forgotten ends the visit: the sign-in screen is back', await until(page, () => !document.querySelector('[data-part=sidebar]') && !!document.querySelector('input[type=password]'), null, 20000));
    await page.shut();
    give();
  }

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
