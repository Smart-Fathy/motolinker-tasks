// Signing in to the new app, end to end: a real browser, the built app, the real server on an in-memory database.
//
// The app's own tests (apps/web) answer from scripts, so they prove what the screens do with each answer. This proves the
// answers: that what the server really sends is what the screens read, for both portals — the password, the second step
// (a code, a recovery code, a challenge that has run out, too many wrong codes), the team's forgot-password email and
// the link in it, Google's return in each of its three forms, a rate limit, a database that is down — and that a session
// started here is a session in the classic portal, and the other way round, because they share one origin and one key.
//
// The clock is under the test's control (as in signintest.js): a code is good for one 30-second step and is refused
// a second time, and a challenge lasts five minutes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const totp = require('../src/lib/totp');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { chromePath } = require('./helpers/browser');

const ROOT = path.join(__dirname, '..');
const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;
const advance = seconds => { skew += seconds * 1000; };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

const db = createFakeSupabase({
  employees: [], sessions: [], push_subscriptions: [], notifications: [], password_reset_tokens: [], quotation_settings: [],
  google_tokens: [], account_security: [], login_events: [], customers: [], deals: [],
}, {
  defaults: {
    password_reset_tokens: () => ({ used: false }),
    account_security: () => ({ totp_enabled: false, recovery_codes: [], last_step: 0, updated_at: new Date().toISOString() }),
    login_events: () => ({ at: new Date().toISOString(), event: 'login', new_device: false }),
  },
});
db.install();

// Google's side of "Sign in with Google", answered locally (the browser never goes there: the test plays the part of
// the redirect back, which is the only part the app has a say in).
const realFetch = global.fetch;
let googleEmail = 'lina@example.com';
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return ok({ access_token: 'g-token', expires_in: 3600 });
  if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return ok({ email: googleEmail, name: 'Google Person' });
  return realFetch(input, init);
};

// Mail is "sent" into a list. The reset email comes from a mailer the route builds from the SMTP settings, and the security
// notices from one on the context, so both are given: settings that make the first exist, and a transport that keeps what it is handed.
const mails = [];
require('nodemailer').createTransport = () => ({ sendMail: async m => { mails.push(m); } });

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3998, env: {
    ML_WEB_DIST: dist, MFA_ENCRYPTION_KEY: 'k'.repeat(40), GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', APP_URL: 'https://app.example.com',
    SMTP_HOST: 'smtp.example.com', SMTP_USER: 'mailer', SMTP_PASS: 'secret', SMTP_FROM: 'MotoLinker <noreply@example.com>',
  } });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  ctx.createMailer = () => ({ sendMail: async m => { mails.push(m); } });
  const resetMails = () => mails.filter(m => /Password Reset/i.test(m.subject));
  const hash = ctx.hashPassword;
  T.employees.push(
    { id: 2, name: 'Sara', username: 'sara', email: 'sara@example.com', password_hash: hash('sara-password-1'), permissions: null, job_title: 'Sales', avatar_url: '', status_text: '', status_emoji: '' },
    { id: 3, name: 'Omar', username: 'omar', email: 'omar@example.com', password_hash: hash('omar-password-1'), permissions: null, job_title: 'Ops', avatar_url: '', status_text: '', status_emoji: '' },
    { id: 4, name: 'Lina', username: 'lina', email: 'lina@example.com', password_hash: hash('lina-password-1'), permissions: null, job_title: 'Ops', avatar_url: '', status_text: '', status_emoji: '' },
    { id: 5, name: 'Nora', username: 'nora', email: 'nora@example.com', password_hash: hash('nora-password-1'), permissions: null, job_title: 'Ops', avatar_url: '', status_text: '', status_emoji: '' },
  );

  // — the server, spoken to directly where the test needs a person or a state the browser should not have to make —
  const post = async (p, body, token) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const status = async (p, token) => (await fetch(base + p, { headers: { Authorization: 'Bearer ' + token } })).status;
  // Omar has two-factor authentication on, made through the server the way a person makes it.
  const omar = await post('/api/employee/login', { username: 'omar', password: 'omar-password-1' });
  const setup = await post('/api/employee/security/2fa/setup', { password: 'omar-password-1' }, omar.token);
  const enabled = await post('/api/employee/security/2fa/enable', { code: totp.totpAt(setup.secret, Date.now()) }, omar.token);
  const SECRET = setup.secret;
  const recovery = [...enabled.recoveryCodes];
  const code = () => { advance(30); return totp.totpAt(SECRET, Date.now()); };

  // ── the browser ─────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  // Nothing leaves this machine. The pages refuse every other host themselves (see open() below), but a service worker's own
  // requests do not pass through the page: the classic worker, which answers the fonts' and libraries' hosts, would go to the real
  // internet, and what this suite sees would depend on how fast that is on the day. Those names do not resolve here.
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'] });
  const errors = [];
  // A person's browser: one profile, which keeps its storage across the pages it opens.
  const person = async () => {
    const context = await browser.createBrowserContext();
    const open = async (url, { next = true } = {}) => {
      const page = await context.newPage();
      await page.setViewport({ width: 1100, height: 800 });
      await page.setRequestInterception(true);
      page.asked = [];
      page.on('request', r => {
        const u = r.url();
        page.asked.push(u.replace(base, ''));
        if (u.startsWith(base) || !/^https?:/.test(u)) return r.continue();
        // The classic pages call into two libraries from other hosts as they start; without a stand-in they stop with a
        // ReferenceError before they ask whether anyone is signed in, which is the thing under test.
        if (/lucide/.test(u)) return r.respond({ status: 200, contentType: 'text/javascript', body: 'window.lucide={createIcons:function(){}};' });
        if (/chart\.js/.test(u)) return r.respond({ status: 200, contentType: 'text/javascript', body: 'window.Chart=function(){return{update:function(){},destroy:function(){}}};Chart.register=function(){};' });
        r.abort();
      });
      if (next) page.on('pageerror', e => errors.push(url + ': ' + e.message));
      if (process.env.WEBAUTH_DEBUG) {
        page.on('pageerror', e => console.log('   [pageerror]', url, e.message.slice(0, 160)));
        page.on('console', m => { if (m.type() === 'error') console.log('   [console]', url, m.text().slice(0, 160)); });
        page.on('response', async r => { if (/\/api\/(employee\/check|auth\/check|v1\/me)/.test(r.url()) || r.status() >= 400) console.log('   [response]', url, r.status(), r.url().replace(base, '').slice(0, 90), (await r.text().catch(() => '')).slice(0, 120), JSON.stringify(r.request().headers()['authorization'] || '').slice(0, 30)); });
      }
      await page.setCookie({ name: 'ml_ui', value: next ? 'next' : 'legacy', url: base });
      // The classic portals hold a stream open once someone is signed in, so the network is never quiet there.
      await page.goto(base + url, { waitUntil: next ? 'load' : 'domcontentloaded' }).catch(e => {
        // A page that does not finish loading says what it had asked for by then (the page's own requests: a worker answers some itself).
        console.log('   ' + url + ' did not finish loading; it had asked for: ' + page.asked.slice(-15).join(' '));
        throw e;
      });
      return page;
    };
    return { context, open, close: () => context.close() };
  };
  const text = (page, sel) => page.$eval(sel, e => e.textContent).catch(() => null);
  // Wait until an element's text is `want` (a string, or a RegExp: functions cannot carry one into the page, so its source goes
  // and is rebuilt there). A miss is not an error here: the caller reads what is there, and the check says what was wrong.
  const waitFor = async (page, sel, want, ms = 8000) => {
    const re = want instanceof RegExp ? want.source : null, exact = want instanceof RegExp ? null : want;
    try {
      await page.waitForFunction((sel, re, exact) => { const e = document.querySelector(sel); if (!e) return false; return re ? new RegExp(re).test(e.textContent) : e.textContent === exact; }, { timeout: ms }, sel, re, exact);
    } catch (_) { /* the caller reads what is there */ }
    return text(page, sel);
  };
  const token = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
  const type = async (page, sel, value) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, value); };
  const submit = (page, step) => page.click(`[data-step=${step}] button[type=submit]`);
  const signInWith = async (page, name, pw) => { await type(page, 'input[name=username]', name); await type(page, 'input[name=password]', pw); await submit(page, 'password'); };
  const heading = page => waitFor(page, 'h1, h2', /./).then(() => page.$eval('h1', e => e.textContent).catch(() => null));
  const signedInAs = (page, who) => waitFor(page, 'h2', 'Signed in as ' + who);
  // Signing out from inside the frame: the admin's button is in the sidebar's footer; the team's is in the account menu
  // behind their initials. (Clicked from the page, so it works whatever width the page was opened at.)
  const signOut = async page => {
    await page.waitForSelector('[data-part=signOut], [data-part=profileBtn]', { timeout: 15000 }).catch(async e => {
      // A page that never drew its shell says what it was instead: where it was, what it had, and which worker was in charge.
      const seen = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration('/').catch(() => null);
        const one = w => (w ? new URL(w.scriptURL).pathname + ':' + w.state : null);
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
        return {
          at: location.pathname + location.search, ready: document.readyState, signedIn: !!(localStorage.getItem('ml_admin_token') || localStorage.getItem('ml_emp_token')),
          controller: navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : null,
          registrations: regs.map(g => ({ scope: new URL(g.scope).pathname, installing: one(g.installing), waiting: one(g.waiting), active: one(g.active) })),
          root: (document.getElementById('root') || { innerHTML: '(no #root)' }).innerHTML.slice(0, 200), body: document.body.innerText.slice(0, 200), r: !!r,
        };
      }).catch(x => ({ unreadable: String(x) }));
      console.log('   the shell never drew: ' + JSON.stringify(seen) + '\n   last requests: ' + (page.asked || []).slice(-12).join(' '));
      throw e;
    });
    if (await page.$('[data-part=signOut]')) return page.evaluate(() => document.querySelector('[data-part=signOut]').click());
    await page.evaluate(() => document.querySelector('[data-part=profileBtn]').click());
    await page.waitForSelector('[data-part=profileMenu]', { timeout: 8000 });
    return page.evaluate(() => [...document.querySelectorAll('[data-part=profileMenu] button')].find(b => /sign out/i.test(b.textContent)).click());
  };
  const alertText = (page, ms) => waitFor(page, '[role=alert]', /./, ms);
  // A classic page registers its service worker once it has loaded, and that worker takes the scope the app's worker holds (they
  // take turns: whichever portal's page was opened last is in charge, tests/webpwa.js). Until it has installed and activated,
  // the other worker is still in charge, and then is taken from under whatever is loading — so a visit to a classic page is not
  // over until its worker is in charge, or the next page opens in the middle of the swap.
  // (The classic page is at /legacy/…, outside the scope its worker holds, so the registration is asked for by the scope's own address.)
  const workerInCharge = (page, scope, script) => page.waitForFunction(async (scope, want) => {
    const g = await navigator.serviceWorker.getRegistration(scope);
    return !!g && !g.installing && !g.waiting && !!g.active && g.active.state === 'activated' && new URL(g.active.scriptURL).pathname === want;
  }, { timeout: 15000, polling: 50 }, scope, script).then(() => true, () => false);
  const sessionsOf = id => T.sessions.filter(s => s.kind === 'employee' && s.payload && s.payload.id === id).length;

  // ═══ A. the admin portal ═══════════════════════════════════════════════════════════════
  {
    const p = await person();
    let page = await p.open('/dashboard');
    c('the admin portal opens on its sign-in', (await heading(page)) === 'Admin Access' && (await page.evaluate(() => window.__ML__.portal)) === 'admin');
    await signInWith(page, 'admin', 'not-the-password');
    c('a wrong password says why, in the server\'s words, and keeps no session', (await alertText(page)) === 'Invalid username or password' && (await token(page, 'ml_admin_token')) === null);
    await signInWith(page, 'admin', 'pw');
    c('the right one signs in, and the app says who it is', (await signedInAs(page, 'Admin')) !== null && (await text(page, 'dl')).includes('Administrator'));
    const adminToken = await token(page, 'ml_admin_token');
    c('…the session is the classic portal\'s key, and the server knows it', !!adminToken && (await status('/api/auth/check', adminToken)) === 200);
    await page.close();
    page = await p.open('/dashboard');
    c('…and it is still there after a reload', (await signedInAs(page, 'Admin')) !== null && (await page.$('input[name=password]')) === null);
    await page.close();
    page = await p.open('/legacy/dashboard', { next: false });
    await page.waitForFunction(() => document.getElementById('auth-screen') && document.getElementById('app'), { timeout: 8000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('app')).display !== 'none', { timeout: 8000 }).catch(() => {});
    c('a session started in the new app is a session in the classic portal', await page.evaluate(() => getComputedStyle(document.getElementById('auth-screen')).display === 'none'));
    c('…and the classic page puts its own worker in charge of the scope', await workerInCharge(page, '/dashboard', '/sw-dashboard.js'));
    await page.close();
    page = await p.open('/dashboard');
    await signedInAs(page, 'Admin');
    await signOut(page);
    c('signing out shows the sign-in again', (await heading(page)) === 'Admin Access' && (await token(page, 'ml_admin_token')) === null);
    c('…and the server ended the session, rather than only forgetting it here', (await status('/api/auth/check', adminToken)) === 401);
    await p.close();
  }

  // ═══ B. a team member ══════════════════════════════════════════════════════════════════
  {
    const p = await person();
    let page = await p.open('/employee');
    c('the team portal opens on its sign-in, with Google and a reset link', (await heading(page)) === 'Team Portal' && !!(await page.$('a[href="/api/employee/auth/google"]')) && (await text(page, '[data-step=password]')).includes('Forgot password?'));
    await signInWith(page, 'sara', 'wrong-password');
    c('a wrong password says why and keeps no session', (await alertText(page)) === 'Invalid username or password' && (await token(page, 'ml_emp_token')) === null);
    await signInWith(page, 'sara', 'sara-password-1');
    c('the right one signs in: who, and what they may do', (await signedInAs(page, 'Sara')) !== null && (await text(page, 'dl')).includes('Team member · Sales'));
    const saraToken = await token(page, 'ml_emp_token');
    c('…on the classic portal\'s key, and the server knows the session', !!saraToken && (await status('/api/employee/check', saraToken)) === 200);
    await page.close();
    page = await p.open('/legacy/employee', { next: false });
    await page.waitForFunction(() => document.getElementById('auth-wrap'), { timeout: 8000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('auth-wrap')).display === 'none', { timeout: 8000 }).catch(() => {});
    c('a session started in the new app is a session in the classic portal', await page.evaluate(() => getComputedStyle(document.getElementById('auth-wrap')).display === 'none'));
    await page.waitForFunction(() => true, { timeout: 100 }).catch(() => {});
    await sleep(1500);   // the classic page's loaders go on after it shows the app
    c('…and the classic page puts its own worker in charge of the scope', await workerInCharge(page, '/employee', '/sw-employee.js'));
    // The classic team portal is also at /legacy/employee, and the script it shares with the admin portal used to tell the two
    // apart by the address: from here it asked the ADMIN's route for the person's preferences, was refused, and the team portal
    // read the refusal as "signed out" — and ended the session in both apps.
    c('…and it stays signed in at /legacy/employee, asking its own routes and never the admin\'s',
      (await token(page, 'ml_emp_token')) === saraToken && page.asked.some(u => u.startsWith('/api/employee/ui-prefs')) && !page.asked.some(u => u.startsWith('/api/dashboard/')), page.asked.filter(u => u.startsWith('/api/dashboard/')).join(', '));
    await page.close();
    page = await p.open('/employee');
    await signedInAs(page, 'Sara');
    await signOut(page);
    c('signing out shows the sign-in, and ends the session at the server', (await heading(page)) === 'Team Portal' && (await token(page, 'ml_emp_token')) === null && (await status('/api/employee/check', saraToken)) === 401);
    await p.close();
  }

  // ═══ C. the other way: signing in at the classic portal ═══════════════════════════════
  {
    const p = await person();
    let page = await p.open('/legacy/employee', { next: false });
    await page.type('#login-user', 'sara'); await page.type('#login-pass', 'sara-password-1');
    await page.click('#login-btn');
    await page.waitForFunction(() => localStorage.getItem('ml_emp_token'), { timeout: 8000 });
    await page.close();
    page = await p.open('/employee');
    c('a session started in the classic portal is a session in the new app', (await signedInAs(page, 'Sara')) !== null);
    await p.close();
  }

  // ═══ D. the second step ═════════════════════════════════════════════════════════════════
  {
    const p = await person();
    let page = await p.open('/employee');
    const before = sessionsOf(3);
    await signInWith(page, 'omar', 'omar-password-1');
    c('the password alone does not sign in: the second step is asked for, and no session exists yet', (await heading(page)) === 'Team Portal' && (await waitFor(page, 'h2', 'Two-step verification')) !== null && (await token(page, 'ml_emp_token')) === null && sessionsOf(3) === before);
    await type(page, 'input[name=code]', '000000'); await submit(page, 'code');
    c('a wrong code is refused with the server\'s words, and the step stays', (await alertText(page)) === 'That code is not right.' && !!(await page.$('input[name=code]')));
    await type(page, 'input[name=code]', code()); await submit(page, 'code');
    c('the right code signs in', (await signedInAs(page, 'Omar')) !== null && !!(await token(page, 'ml_emp_token')));
    c('…the server records that a second factor was used', T.sessions.some(s => s.payload && s.payload.id === 3 && s.payload.method === 'password+2fa'));
    await signOut(page);
    await heading(page);

    // a recovery code, once
    await signInWith(page, 'omar', 'omar-password-1');
    await waitFor(page, 'h2', 'Two-step verification');
    await page.click('[data-step=code] [data-part=link]');
    c('"Use a recovery code instead" changes the label, the keyboard and the example', (await text(page, '[data-step=code] label')) === 'Recovery code' && (await page.$eval('input[name=code]', e => e.getAttribute('inputmode') + '|' + e.placeholder)) === 'text|xxxxx-xxxxx');
    await type(page, 'input[name=code]', recovery[0]); await submit(page, 'code');
    c('a recovery code signs in', (await signedInAs(page, 'Omar')) !== null);
    await signOut(page);
    await heading(page);
    await signInWith(page, 'omar', 'omar-password-1');
    await waitFor(page, 'h2', 'Two-step verification');
    await page.click('[data-step=code] [data-part=link]');
    await type(page, 'input[name=code]', recovery[0]); await submit(page, 'code');
    c('…once: the same recovery code is refused the second time', (await alertText(page)) === 'That code is not right.');

    // the challenge runs out
    await page.click('[data-step=code] [data-part=link]:last-of-type');
    await signInWith(page, 'omar', 'omar-password-1');
    await waitFor(page, 'h2', 'Two-step verification');
    advance(6 * 60);
    await type(page, 'input[name=code]', code()); await submit(page, 'code');
    c('a challenge that has run out sends the person back to the password, with the server\'s words and their username kept',
      (await alertText(page)) === 'Your sign-in expired. Enter your password again.' && !!(await page.$('input[name=password]')) && (await page.$eval('input[name=username]', e => e.value)) === 'omar');

    // too many wrong codes
    await signInWith(page, 'omar', 'omar-password-1');
    await waitFor(page, 'h2', 'Two-step verification');
    let last = null;
    for (let i = 0; i < 5; i++) {
      await type(page, 'input[name=code]', String(100000 + i)); await submit(page, 'code');
      last = await waitFor(page, '[role=alert]', i < 4 ? /not right/ : /Too many wrong codes/);
    }
    c('too many wrong codes end the challenge, in the server\'s words: back to the password', last === 'Too many wrong codes. Enter your password again.' && !!(await page.$('input[name=password]')), last);
    await p.close();
  }

  // ═══ E. a rate limit, and a database that is down ══════════════════════════════════════
  {
    const p = await person();
    let page = await p.open('/employee');
    for (let i = 0; i < 5; i++) await post('/api/employee/login', { username: 'nora', password: 'wrong-' + i });
    await signInWith(page, 'nora', 'nora-password-1');
    const limited = await alertText(page);
    c('too many attempts is said as the server says it, with the wait', /^Too many attempts\. Try again in \d+ (seconds|minutes)\.$/.test(limited || ''), limited);
    c('…and even the right password is not let through while it lasts', (await token(page, 'ml_emp_token')) === null);

    await page.close();
    page = await p.open('/employee');
    db.restarting.add('account_security');
    await signInWith(page, 'sara', 'sara-password-1');
    const outage = await alertText(page);
    db.restarting.delete('account_security');
    c('a database that is coming back is reported, and nobody is waved through or signed in', /try again/i.test(outage || '') && (await token(page, 'ml_emp_token')) === null, outage);
    await signInWith(page, 'sara', 'sara-password-1');
    c('…and the same sign-in works the moment it is back', (await signedInAs(page, 'Sara')) !== null);

    // a session the server has to look up, while the database that holds it is down
    const kept = await token(page, 'ml_emp_token');
    ctx.employeeSessions.delete(kept);
    db.failing.add('sessions');
    await page.reload({ waitUntil: 'networkidle0' });
    c('when the session cannot be looked up, the person is told so and is NOT signed out', (await waitFor(page, 'h2', 'The server cannot answer just now')) !== null && (await token(page, 'ml_emp_token')) === kept && (await page.$('input[name=password]')) === null);
    db.failing.delete('sessions');
    await page.click('button:not([type=submit])');
    c('…and "Try again" signs them straight back in', (await signedInAs(page, 'Sara')) !== null);
    await p.close();
  }

  // ═══ F. "Forgot password?" and the link in the email ══════════════════════════════════
  {
    const p = await person();
    let page = await p.open('/employee');
    await page.click('[data-step=password] [data-part=link]');
    mails.length = 0;
    await type(page, 'input[name=email]', 'nobody@example.com'); await submit(page, 'forgot');
    const unknown = await waitFor(page, '[role=status]', /./);
    c('an address nobody has gets the same answer, and no email', unknown === 'If an account with that email exists, a reset link has been sent.' && resetMails().length === 0, unknown);
    await type(page, 'input[name=email]', 'sara@example.com'); await submit(page, 'forgot');
    await waitFor(page, '[role=status]', /./);
    await sleep(300);
    c('a team member\'s address gets the same words, and a link by email', resetMails().length === 1 && resetMails()[0].to === 'sara@example.com' && /https:\/\/app\.example\.com\/employee\?reset=[a-f0-9]+/.test(resetMails()[0].html), JSON.stringify(mails.map(m => m.subject)));
    const link = resetMails()[0].html.match(/https:\/\/app\.example\.com(\/employee\?reset=[a-f0-9]+)/)[1];
    await page.close();

    page = await p.open(link);
    c('the link opens the new-password form, and takes the token out of the address bar', (await waitFor(page, 'h2', 'Set New Password')) !== null && !(await page.evaluate(() => location.search)).includes('reset'));
    const tokens = T.password_reset_tokens.length;
    await type(page, 'input[name=new-password]', 'short'); await type(page, 'input[name=confirm-password]', 'short'); await submit(page, 'reset');
    const short = await alertText(page);
    await type(page, 'input[name=new-password]', 'a-long-new-password'); await type(page, 'input[name=confirm-password]', 'another-long-one'); await submit(page, 'reset');
    c('a short password, or two that differ, are caught before the server is asked', short === 'Password must be at least 8 characters.' && (await waitFor(page, '[role=alert]', 'Passwords do not match.')) !== null && !page.asked.some(u => u.startsWith('/api/employee/reset-password')) && T.password_reset_tokens.every(t => !t.used));
    const signedInBefore = await post('/api/employee/login', { username: 'sara', password: 'sara-password-1' });
    await type(page, 'input[name=confirm-password]', 'a-long-new-password'); await submit(page, 'reset');
    c('the new password is set, and the person is told', (await waitFor(page, '[role=status]', 'Password updated! You can now sign in.')) !== null);
    c('…the sign-in form comes back by itself', !!(await page.waitForSelector('input[name=password]', { timeout: 6000 }).catch(() => null)));
    c('…every device signed in before is signed out (a reset is how an account is recovered)', (await status('/api/employee/check', signedInBefore.token)) === 401);
    await signInWith(page, 'sara', 'sara-password-1');
    c('…the old password no longer works', (await alertText(page)) === 'Invalid username or password');
    await signInWith(page, 'sara', 'a-long-new-password');
    c('…and the new one does', (await signedInAs(page, 'Sara')) !== null);
    await p.close();
    // (a browser that is signed in has no use for a reset form, and is not shown one: the link is opened from a fresh one)
    const again = await person();
    page = await again.open(link);
    await waitFor(page, 'h2', 'Set New Password');
    await type(page, 'input[name=new-password]', 'yet-another-password'); await type(page, 'input[name=confirm-password]', 'yet-another-password'); await submit(page, 'reset');
    if (process.env.WEBAUTH_DEBUG) console.log('   [tokens]', JSON.stringify(T.password_reset_tokens.map(t => ({ ...t, token: t.token.slice(0, 6) }))), await page.evaluate(() => document.body.innerText.slice(0, 300)));
    const used = await alertText(page);
    c('the link works once: used again it says it is used up', used === 'Invalid or expired reset link' && T.password_reset_tokens.length >= tokens, used);
    await again.close();
  }

  // ═══ G. Google's return ═════════════════════════════════════════════════════════════════
  {
    const p = await person();
    const startGoogle = async email => {
      googleEmail = email;
      const start = await fetch(base + '/api/employee/auth/google', { redirect: 'manual' });
      const state = new URL(start.headers.get('location')).searchParams.get('state');
      const back = await fetch(base + `/api/email/callback?code=abc&state=${state}`, { redirect: 'manual' });
      return { start, location: back.headers.get('location') || '' };
    };
    const g1 = await startGoogle('lina@example.com');
    c('"Sign in with Google" goes to Google, and Google\'s return is a link to the team portal with a session in it', /^https:\/\/accounts\.google\.com\//.test(g1.start.headers.get('location')) && g1.location.startsWith('/employee?emp_token='), g1.location);
    let page = await p.open(g1.location);
    c('…which signs the person in at once, and the session is out of the address bar', (await signedInAs(page, 'Lina')) !== null && !(await page.evaluate(() => location.search)).includes('emp_token') && !!(await token(page, 'ml_emp_token')));
    await page.close();
    await p.close();

    const q = await person();
    const g2 = await startGoogle('omar@example.com');
    c('for an account with a second step, Google\'s return carries a challenge and no session', g2.location.startsWith('/employee?mfa_token=') && !g2.location.includes('emp_token'), g2.location);
    page = await q.open(g2.location);
    c('…and the app asks for the code, with the challenge out of the address bar', (await waitFor(page, 'h2', 'Two-step verification')) !== null && !(await page.evaluate(() => location.search)).includes('mfa_token') && (await token(page, 'ml_emp_token')) === null);
    await type(page, 'input[name=code]', code()); await submit(page, 'code');
    c('…and the code completes it', (await signedInAs(page, 'Omar')) !== null);
    await page.close();

    const g3 = await startGoogle('stranger@example.com');
    c('an address nobody has is refused with a sentence', g3.location.startsWith('/employee?google_login_error='), g3.location);
    const r = await person();
    page = await r.open(g3.location.replace('?', '?x=1&'));
    const refusal = await alertText(page), left = await page.evaluate(() => location.search);
    c('…which the sign-in shows as text, and takes out of the address bar (other parameters stay)', refusal === 'No account linked to this Google address. Contact your admin.' && left === '?x=1', refusal + ' | ' + left);
    await page.close();
    await r.close();

    page = await q.open('/dashboard?emp_token=abc&mfa_token=def&reset=ghi&google_login_error=nope');
    c('the admin portal has no Google sign-in or reset email: it ignores all of it, and leaves the address as it was', (await heading(page)) === 'Admin Access' && (await page.evaluate(() => location.search)) === '?emp_token=abc&mfa_token=def&reset=ghi&google_login_error=nope' && (await page.$('[role=alert]')) === null);
    await q.close();
  }

  await browser.close();
  c('no page raised an error of its own', errors.length === 0, errors.slice(0, 3).join(' | '));
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
