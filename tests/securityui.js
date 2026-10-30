// The Security panel and the second sign-in step, in a real browser against the real app.
//
// signintest.js proves the server. This proves the pages: that the buttons are wired to
// the endpoints, that the QR code and the recovery codes actually appear, that the
// portal shows the code prompt instead of the app after the password, and that a wrong
// code and a recovery code behave the way the text says. Both portals, because they
// share one panel (assets/security.js) but each has its own sign-in screen.
const puppeteer = require('puppeteer');
const totp = require('../src/lib/totp');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;
const advance = s => { skew += s * 1000; };

const db = createFakeSupabase({
  employees: [], sessions: [], push_subscriptions: [], notifications: [], password_reset_tokens: [],
  quotation_settings: [], google_tokens: [], account_security: [], login_events: [],
}, { defaults: {
  account_security: () => ({ totp_enabled: false, recovery_codes: [], last_step: 0, updated_at: new Date().toISOString() }),
  login_events: () => ({ at: new Date().toISOString(), event: 'login', new_device: false }),
} });
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3985, env: { MFA_ENCRYPTION_KEY: 'k'.repeat(40) } });
  const ctx = require(process.cwd() + '/src/ctx');
  db.tables.employees.push({ id: 2, name: 'Sara', username: 'sara', email: 'sara@example.com', password_hash: ctx.hashPassword('sara-password-1'), permissions: null, job_title: 'Sales', avatar_url: '', status_text: '', status_emoji: '' });

  const browser = await puppeteer.launch({ executablePath: require('./helpers/browser').chromePath(), headless: 'new', args: ['--no-sandbox'] });
  const errors = [];

  async function newPage() {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 900 });
    await page.setBypassServiceWorker(true);
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());   // the "sign out other devices" confirm
    await page.setRequestInterception(true);
    page.on('request', req => {
      // Fonts, icon and chart libraries come from CDNs the sandbox cannot reach.
      if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
      req.continue();
    });
    await page.evaluateOnNewDocument(() => {
      window.lucide = { createIcons() {} };
      window.Chart = function () { return { destroy() {}, update() {} }; };
    });
    return page;
  }
  // Poll a condition in this process (the database, not the page).
  const until = async (fn, ms = 4000) => { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await sleep(100); } return false; };
  const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; }, sel);
  const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, { timeout }, arg).then(() => true, () => false);
  const text = (page, sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
  const clickText = (page, selector, label) => page.evaluate((sel, l) => {
    const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(l));
    if (!el) return false; el.click(); return true;
  }, selector, label);

  // The panel is the same in both portals; drive it once per portal.
  async function enrolThroughPanel(page, password, who) {
    check(`${who}: the panel opens and says two-factor is off`, await waitFor(page, () => /Two-factor authentication/.test(document.getElementById('sec-overlay').textContent) && !!document.querySelector('#sec-overlay .sec-pill.off')));
    check(`${who}: it lists this device as signed in`, /This device/.test(await text(page, '#sec-overlay')));
    check(`${who}: "Turn on" starts the setup`, await clickText(page, '#sec-overlay .sec-btn', 'Turn on') && await waitFor(page, () => !!document.getElementById('sec-pw')));
    await page.type('#sec-pw', 'wrong-password');
    await page.click('#sec-go');
    check(`${who}: a wrong password is refused, in the panel`, await waitFor(page, () => /not right/.test((document.getElementById('sec-msg') || {}).textContent || '')));
    await page.$eval('#sec-pw', e => { e.value = ''; });
    await page.type('#sec-pw', password);
    await page.click('#sec-go');
    check(`${who}: the right password shows a QR code to scan`, await waitFor(page, () => { const i = document.querySelector('#sec-overlay .sec-qr img'); return !!i && i.src.startsWith('data:image/png;base64,') && i.naturalWidth > 50; }));
    const secret = (await text(page, '#sec-overlay .sec-key')).replace(/\s/g, '');
    check(`${who}: …and the key to type by hand`, /^[A-Z2-7]{32}$/.test(secret), secret);
    check(`${who}: …and a link for opening it on a phone`, (await page.$eval('#sec-overlay .sec-qr a', a => a.getAttribute('href'))).startsWith('otpauth://totp/MotoLinker:'));
    await page.type('#sec-code', '000000');
    await page.click('#sec-go');
    check(`${who}: a wrong code does not turn it on`, await waitFor(page, () => /not right/.test((document.getElementById('sec-msg') || {}).textContent || '')));
    await page.$eval('#sec-code', e => { e.value = ''; });
    await page.type('#sec-code', totp.totpAt(secret, Date.now()));
    await page.click('#sec-go');
    check(`${who}: the right code shows ten recovery codes`, await waitFor(page, () => document.querySelectorAll('#sec-overlay .sec-codes code').length === 10));
    const codes = await page.$$eval('#sec-overlay .sec-codes code', els => els.map(e => e.textContent));
    check(`${who}: "Done" waits until they are saved`, await page.$eval('#sec-go', b => b.disabled) === true);
    await page.click('#sec-saved');
    await page.click('#sec-go');
    check(`${who}: after Done the panel says two-factor is on, with ten codes left`, await waitFor(page, () => !!document.querySelector('#sec-overlay .sec-pill.on') && /10 recovery codes left/.test(document.getElementById('sec-overlay').textContent)));
    return { secret, codes };
  }
  const nextCode = secret => { advance(30); return totp.totpAt(secret, Date.now()); };
  // The sign-in fields keep what was typed last time; a person selects it and types over it.
  const fill = async (page, sel, value) => { await page.$eval(sel, e => { e.value = ''; }); await page.type(sel, value); };

  // ═══ Team portal ════════════════════════════════════════════════════════════
  {
    const page = await newPage();
    await page.goto(base + '/employee', { waitUntil: 'domcontentloaded' });
    check('portal: the sign-in screen is shown', await waitFor(page, () => document.getElementById('auth-wrap').style.display !== 'none'));
    check('portal: the second-step panel is hidden at first', !(await visible(page, '#mfa-form-panel')));
    await fill(page, '#login-user', 'sara'); await fill(page, '#login-pass', 'sara-password-1');
    await page.click('#login-btn');
    check('portal: signing in shows the app', await waitFor(page, () => document.getElementById('layout').style.display === 'flex'));
    await page.evaluate(() => openSecurity());
    const { secret, codes } = await enrolThroughPanel(page, 'sara-password-1', 'portal');

    // — sign out and back in: the code is now asked for —
    await page.evaluate(() => { logout(); });
    check('portal: signing out returns to the sign-in screen', await waitFor(page, () => document.getElementById('auth-wrap').style.display !== 'none'));
    check('portal: …and the Security panel, which was open, is put away rather than left over the sign-in form', !(await page.evaluate(() => document.getElementById('sec-overlay').classList.contains('open'))));
    await fill(page, '#login-user', 'sara'); await fill(page, '#login-pass', 'sara-password-1');
    await page.click('#login-btn');
    check('portal: the password alone now shows the code prompt, not the app', await waitFor(page, () => document.getElementById('mfa-form-panel').style.display !== 'none') && !(await visible(page, '#layout')) && !(await visible(page, '#login-form-panel')));
    check('portal: the password field is cleared', (await page.$eval('#login-pass', e => e.value)) === '');
    await page.type('#mfa-code', '123456'); await page.click('#mfa-btn');
    check('portal: a wrong code says so and keeps the prompt', await waitFor(page, () => /not right/.test(document.getElementById('auth-err').textContent) && document.getElementById('auth-err').style.display === 'block') && await visible(page, '#mfa-form-panel'));
    await page.$eval('#mfa-code', e => { e.value = ''; });
    await page.type('#mfa-code', nextCode(secret)); await page.click('#mfa-btn');
    check('portal: the right code signs in', await waitFor(page, () => document.getElementById('layout').style.display === 'flex'));
    await page.evaluate(() => { logout(); });
    check('portal: after a sign-in with a code, signing out shows the password form again, not the code prompt',
      await waitFor(page, () => document.getElementById('auth-wrap').style.display !== 'none') && await visible(page, '#login-form-panel') && !(await visible(page, '#mfa-form-panel')));
    await fill(page, '#login-user', 'sara'); await fill(page, '#login-pass', 'sara-password-1'); await page.click('#login-btn');
    await waitFor(page, () => document.getElementById('mfa-form-panel').style.display !== 'none');
    await page.$eval('#mfa-code', e => { e.value = ''; });
    await page.type('#mfa-code', nextCode(secret)); await page.click('#mfa-btn');
    await waitFor(page, () => document.getElementById('layout').style.display === 'flex');

    // — a recovery code —
    await page.evaluate(() => { logout(); });
    await waitFor(page, () => document.getElementById('auth-wrap').style.display !== 'none');
    await fill(page, '#login-user', 'sara'); await fill(page, '#login-pass', 'sara-password-1'); await page.click('#login-btn');
    await waitFor(page, () => document.getElementById('mfa-form-panel').style.display !== 'none');
    await page.click('#mfa-toggle');
    check('portal: "use a recovery code" changes the prompt', /Recovery code/.test(await text(page, '#mfa-label')) && (await page.$eval('#mfa-code', e => e.placeholder)) === 'xxxxx-xxxxx');
    await page.type('#mfa-code', codes[0]); await page.click('#mfa-btn');
    check('portal: a recovery code signs in', await waitFor(page, () => document.getElementById('layout').style.display === 'flex'));

    // — Google sign-in lands on /employee?mfa_token=… : the page asks for the code and scrubs the address bar —
    {
      const ch = await (await fetch(base + '/api/employee/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'sara', password: 'sara-password-1' }) })).json();
      const g = await newPage();
      // A person arriving from Google has no session in this browser; the earlier tab's would otherwise be shared.
      await g.evaluateOnNewDocument(() => { try { localStorage.removeItem('ml_emp_token'); } catch (_) {} });
      await g.goto(base + '/employee?mfa_token=' + ch.mfa_token, { waitUntil: 'domcontentloaded' });
      check('portal: arriving from Google with a challenge shows the code prompt, not the sign-in form', await waitFor(g, () => document.getElementById('mfa-form-panel').style.display !== 'none') && !(await visible(g, '#login-form-panel')) && !(await visible(g, '#layout')));
      check('portal: …and the token is removed from the address bar', !/mfa_token/.test(g.url()), g.url());
      await g.type('#mfa-code', nextCode(secret)); await g.click('#mfa-btn');
      check('portal: …and the code completes the sign-in', await waitFor(g, () => document.getElementById('layout').style.display === 'flex'));
      await g.close();
    }

    // — the panel after all that —
    await page.evaluate(() => openSecurity());
    await waitFor(page, () => /recovery codes? left/.test(document.getElementById('sec-overlay').textContent));
    check('portal: the panel counts the used recovery code', /9 recovery codes left/.test(await text(page, '#sec-overlay')));
    const rows = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#sec-overlay .sec-card')].find(c => /Recent sign-ins/.test(c.querySelector('.sec-h').textContent));
      return card ? [...card.querySelectorAll('.sec-item')].map(e => e.textContent) : [];
    });
    check('portal: recent sign-ins are listed, with the first marked as a new device', rows.length >= 3 && rows.some(r => /New device/.test(r)) && rows.some(r => /recovery/i.test(r)), rows.map(r => r.slice(0, 60)).join(' | '));
    check('portal: the session list marks one device as this one', (await page.$$eval('#sec-overlay .sec-pill.here', e => e.length)) === 1);

    // — turn it off through the panel —
    await clickText(page, '#sec-overlay .sec-btn', 'Turn off');
    await waitFor(page, () => !!document.getElementById('sec-pw'));
    await page.type('#sec-pw', 'sara-password-1'); await page.type('#sec-code', nextCode(secret));
    await page.click('#sec-go');
    check('portal: turning it off returns the panel to "Off"', await waitFor(page, () => !!document.querySelector('#sec-overlay .sec-pill.off')));
    await page.close();
  }

  // ═══ Admin dashboard ════════════════════════════════════════════════════════
  {
    const page = await newPage();
    await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded' });
    check('admin: the sign-in screen is shown', await waitFor(page, () => document.getElementById('auth-screen').style.display !== 'none'));
    check('admin: the second-step panel is hidden at first', !(await visible(page, '#admin-mfa')));
    await fill(page, '#login-username', 'admin'); await fill(page, '#login-password', 'pw');
    await page.click('#login-btn');
    check('admin: signing in shows the dashboard', await waitFor(page, () => document.getElementById('app').style.display === 'block'));
    await page.evaluate(() => openSecurity());
    const { secret, codes } = await enrolThroughPanel(page, 'pw', 'admin');

    await page.evaluate(() => { logout(); });
    check('admin: signing out returns to the sign-in screen', await waitFor(page, () => document.getElementById('auth-screen').style.display === 'flex'));
    check('admin: …and the Security panel, which was open, is put away rather than left over the sign-in form', !(await page.evaluate(() => document.getElementById('sec-overlay').classList.contains('open'))));
    await fill(page, '#login-username', 'admin'); await fill(page, '#login-password', 'pw');
    await page.click('#login-btn');
    check('admin: the password alone shows the code prompt, not the dashboard', await waitFor(page, () => document.getElementById('admin-mfa').style.display !== 'none') && !(await visible(page, '#app')) && !(await visible(page, '#login-password')));
    await page.type('#admin-mfa-code', '123456'); await page.click('#admin-mfa-btn');
    check('admin: a wrong code says so and keeps the prompt', await waitFor(page, () => /not right/.test(document.getElementById('admin-mfa-error').textContent) && document.getElementById('admin-mfa-error').style.display === 'block') && await visible(page, '#admin-mfa'));
    await page.$eval('#admin-mfa-code', e => { e.value = ''; });
    await page.type('#admin-mfa-code', nextCode(secret)); await page.click('#admin-mfa-btn');
    check('admin: the right code opens the dashboard', await waitFor(page, () => document.getElementById('app').style.display === 'block'));

    await page.evaluate(() => { logout(); });
    await waitFor(page, () => document.getElementById('auth-screen').style.display === 'flex');
    check('admin: after signing out the password form is back and the code prompt is gone', await visible(page, '#login-password') && await visible(page, '#login-btn') && !(await visible(page, '#admin-mfa')));
    await fill(page, '#login-username', 'admin'); await fill(page, '#login-password', 'pw'); await page.click('#login-btn');
    await waitFor(page, () => document.getElementById('admin-mfa').style.display !== 'none');
    await page.click('#admin-mfa-toggle');
    await page.type('#admin-mfa-code', codes[0]); await page.click('#admin-mfa-btn');
    check('admin: a recovery code opens the dashboard', await waitFor(page, () => document.getElementById('app').style.display === 'block'));

    // — the Employees table shows who has it on, and can reset it (a lost phone) —
    db.tables.account_security.push({ kind: 'employee', account_id: '2', totp_secret: 'plain:JBSWY3DPEHPK3PXP', totp_enabled: true, recovery_codes: [], last_step: 0, updated_at: new Date().toISOString() });
    // Any employee sets their own status emoji (8 characters). "<style>" fits, and printed
    // as markup it swallowed every row after it. Omar sorts before Sara, so Sara's checks
    // below fail too if it does.
    db.tables.employees.push({ id: 3, name: 'Omar', username: 'omar', email: 'omar@example.com', password_hash: ctx.hashPassword('omar-password-1'), permissions: null, job_title: 'Sales', avatar_url: '', status_text: 'Away', status_emoji: '<style>' });
    await page.evaluate(() => navigate('employees'));
    check('admin: the Employees table has a 2FA column', await waitFor(page, () => [...document.querySelectorAll('#employees-table-container th')].some(th => th.textContent === '2FA')));
    const omar = await page.evaluate(() => {
      const heads = document.querySelectorAll('#employees-table-container th').length;
      const row = [...document.querySelectorAll('#employees-table-container tbody tr')].find(tr => /omar/.test(tr.textContent));
      return row ? { cells: row.children.length, heads, text: row.textContent, styles: document.querySelectorAll('#employees-table-container style').length } : null;
    });
    check('admin: a status emoji is shown as text, not markup', omar && omar.cells === omar.heads && omar.text.includes('<style> Away') && omar.styles === 0, JSON.stringify(omar && { ...omar, text: undefined }));
    const cell = () => page.evaluate(() => {
      const idx = [...document.querySelectorAll('#employees-table-container th')].findIndex(th => th.textContent === '2FA');
      const row = [...document.querySelectorAll('#employees-table-container tbody tr')].find(tr => /sara/.test(tr.textContent));
      return row ? { cell: row.children[idx].textContent.trim(), reset: !![...row.querySelectorAll('button')].find(b => /Reset 2FA/.test(b.textContent)) } : null;
    });
    const before = await cell();
    check('admin: an employee with it on is marked On, with a Reset 2FA button', before && before.cell === 'On' && before.reset === true, JSON.stringify(before));
    await page.evaluate(() => [...document.querySelectorAll('#employees-table-container button')].find(b => /Reset 2FA/.test(b.textContent)).click());
    check('admin: resetting clears it on the server', await until(() => !db.tables.account_security.some(r => r.account_id === '2')));
    await waitFor(page, () => { const th = [...document.querySelectorAll('#employees-table-container th')].findIndex(t => t.textContent === '2FA'); const row = [...document.querySelectorAll('#employees-table-container tbody tr')].find(tr => /sara/.test(tr.textContent)); return row && row.children[th].textContent.trim() === 'Off'; });
    const after = await cell();
    check('admin: the table then shows Off and no Reset button', after && after.cell === 'Off' && after.reset === false, JSON.stringify(after));
    await page.close();
  }

  await browser.close();
  const mine = errors.filter(e => /Security|security|Mfa|mfa|openSecurity|SecurityPanel|startSessionFrom|showApp is not|sec-/.test(e));
  check('no script errors from the security code', mine.length === 0, mine.slice(0, 3).join(' || '));
  if (errors.length) console.log(`  (${errors.length} unrelated page error(s) from sections the stub database does not populate)`);

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} security UI checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
