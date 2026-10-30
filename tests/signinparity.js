// The new app's sign-in screens against the classic pages', value by value.
//
// "Same look first" is the rule the whole move is held to: until the redesign, a person who is switched to the new app
// must see what they saw. For the screen every person sees first, that is checked here rather than by eye. The classic
// page and the new app are both opened in a real browser (the new one built for real, served by the real server), put
// through the same steps — the password, the second step with a wrong code on it, the team's forgot-password and
// set-new-password forms — and the computed style of every part of the card is read: size and position, spacing,
// colours, type, borders, shadows, for both portals, in both modes, at a phone's width, a tablet's and a desktop's. Any
// property that differs is a failure, except the few named in ACCEPTED, each with its reason.
//
// The classic page is what this holds the new one to, so it goes when the classic page does (Run P4), and the suite with it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { chromePath } = require('./helpers/browser');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// What is compared. Position and size come from the box (_rect): the computed width and height of an inline element are
// "auto", which says nothing.
const PROPS = ['display', 'position', 'boxSizing', 'minHeight', 'maxWidth', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderTopLeftRadius',
  'backgroundColor', 'backgroundImage', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
  'textTransform', 'textAlign', 'textDecorationLine', 'boxShadow', 'opacity', 'gap', 'alignItems', 'justifyContent', 'flexDirection', 'cursor', 'filter', 'backdropFilter'];

// Where the two differ on purpose or by necessity, and why. Each must still differ, or it is stale and fails.
const ACCEPTED = {
  'card.maxWidth': 'the admin card may not be wider than a screen narrower than 360px; the classic one overflows it',
  'forgot.display': 'a <button> that reads as the classic <a>: a button cannot be display:inline (it is inline-block)',
  'mfaToggle.display': 'the same',
};

// The part of the page each role names, in the classic page and in the new app.
const SELECTORS = {
  admin: {
    classic: {
      screen: '#auth-screen', card: '#auth-screen .auth-card', icon: '.auth-icon', title: '.auth-title', sub: '.auth-sub',
      user: '#login-username', pass: '#login-password', button: '#login-btn', error: '#auth-error',
      mfaLead: '#admin-mfa-lead', mfaCode: '#admin-mfa-code', mfaButton: '#admin-mfa-btn', mfaError: '#admin-mfa-error', mfaToggle: '#admin-mfa-toggle', mfaLinks: '#admin-mfa > p:last-child',
    },
    next: {
      screen: '[data-part=screen]', card: '[data-part=card]', icon: '[data-part=icon]', title: '[data-part=title]', sub: '[data-part=sub]',
      user: 'input[name=username]', pass: 'input[name=password]', button: '[data-step=password] [data-part=button]', error: '[data-step=password] [data-part=error]',
      mfaLead: '[data-step=code] [data-part=lead]', mfaCode: 'input[name=code]', mfaButton: '[data-step=code] [data-part=button]', mfaError: '[data-step=code] [data-part=error]', mfaToggle: '[data-step=code] [data-part=link]', mfaLinks: '[data-step=code] > p:last-of-type',
    },
  },
  team: {
    classic: {
      screen: '#auth-wrap', card: '#auth-wrap .auth-card', icon: '.auth-logo-icon', title: '.auth-logo h1', sub: '.auth-logo p', error: '#auth-err',
      userGroup: '#login-form-panel .form-group', orRow: '#login-form-panel > div:nth-of-type(4)', forgotRow: '#login-form-panel > div:nth-of-type(3)', mfaLinks: '#mfa-form-panel > div:last-child',
      userLabel: '#login-form-panel .form-label', user: '#login-user', pass: '#login-pass', button: '#login-btn', forgot: '#login-form-panel a[onclick*=showForgotPassword]',
      google: '#login-form-panel a.btn-outline',
      mfaTitle: '#mfa-form-panel > div:first-child', mfaLead: '#mfa-lead', mfaLabel: '#mfa-label', mfaCode: '#mfa-code', mfaButton: '#mfa-btn', mfaToggle: '#mfa-toggle',
      forgotTitle: '#forgot-form-panel > div:first-child', forgotLead: '#forgot-form-panel > div:nth-child(2)', forgotEmail: '#forgot-email', forgotButton: '#forgot-btn',
      resetPass: '#reset-pass', resetButton: '#reset-btn',
    },
    next: {
      screen: '[data-part=screen]', card: '[data-part=card]', icon: '[data-part=icon]', title: '[data-part=title]', sub: '[data-part=sub]', error: '[data-part=error]',
      userGroup: '[data-step=password] [data-part=field]', orRow: '[data-step=password] [role=separator]', forgotRow: '[data-step=password] > p:last-of-type', mfaLinks: '[data-step=code] > p:last-of-type',
      userLabel: '[data-step=password] [data-part=label]', user: 'input[name=username]', pass: 'input[name=password]', button: '[data-step=password] button[data-part=button]', forgot: '[data-step=password] [data-part=link]',
      google: '[data-step=password] a[data-part=button]',
      mfaTitle: '[data-step=code] h2', mfaLead: '[data-step=code] [data-part=lead]', mfaLabel: '[data-step=code] [data-part=label]', mfaCode: 'input[name=code]', mfaButton: '[data-step=code] [data-part=button]', mfaToggle: '[data-step=code] [data-part=link]',
      forgotTitle: '[data-step=forgot] h2', forgotLead: '[data-step=forgot] [data-part=lead]', forgotEmail: 'input[name=email]', forgotButton: '[data-step=forgot] [data-part=button]',
      resetPass: 'input[name=new-password]', resetButton: '[data-step=reset] [data-part=button]',
    },
  },
};
// The steps of each portal's sign-in, and the parts on each.
const STEPS = {
  admin: {
    password: ['screen', 'card', 'icon', 'title', 'sub', 'user', 'pass', 'button', 'error'],
    code: ['mfaLead', 'mfaCode', 'mfaButton', 'mfaError', 'mfaToggle', 'mfaLinks'],
  },
  team: {
    password: ['screen', 'card', 'icon', 'title', 'sub', 'error', 'userGroup', 'userLabel', 'user', 'pass', 'button', 'forgotRow', 'forgot', 'orRow', 'google'],
    code: ['mfaTitle', 'mfaLead', 'mfaLabel', 'mfaCode', 'mfaButton', 'mfaToggle', 'mfaLinks'],
    forgot: ['forgotTitle', 'forgotLead', 'forgotEmail', 'forgotButton'],
    reset: ['resetPass', 'resetButton'],
  },
};
const MODES = ['dark', 'light'];
// A phone, a tablet inside the 640–700px band where the two classic sheets break differently, and a desktop.
const WIDTHS = [390, 670, 1100];

// Everything that is not the page under test stays out of it: no request leaves the machine (so fonts and icons from other
// hosts never arrive, and the comparison is of the fallbacks, the same on every machine), and nothing animates, so a
// style is read as it will be and not part-way to it.
const STILL = '*,*::before,*::after{transition:none!important;animation:none!important}';

const readRoles = (page, selectors, roles) => page.evaluate((selectors, roles, props) => {
  const out = {};
  for (const role of roles) {
    const el = document.querySelector(selectors[role]);
    if (!el) { out[role] = null; continue; }
    const cs = getComputedStyle(el), o = {};
    for (const p of props) o[p] = cs[p];
    const r = el.getBoundingClientRect();
    o._rect = [Math.round(r.x * 2) / 2, Math.round(r.y * 2) / 2, Math.round(r.width * 2) / 2, Math.round(r.height * 2) / 2];
    out[role] = o;
  }
  return out;
}, selectors, roles, PROPS);

(async () => {
  const puppeteer = require('puppeteer');
  const db = createFakeSupabase({ employees: [], sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [], presence: [], customers: [], deals: [] });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3997, env: { ML_WEB_DIST: dist } });
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });

  // A page of its own, in a context of its own: what one page leaves in the browser's caches made the next page draw in a
  // font only the first had asked for, and a comparison must not depend on which was opened first.
  const open = async (url, { next, answers } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (/^https?:/.test(u) && !u.startsWith(base)) return r.abort();
      if (answers && r.method() === 'POST') {
        const a = answers[new URL(u).pathname];
        if (a) return r.respond({ status: a[0], contentType: 'application/json', body: JSON.stringify(a[1]) });
      }
      r.continue();
    });
    if (next) await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.goto(base + url, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: STILL });
    page.shut = async () => { await page.close(); await context.close(); };
    return page;
  };
  const settle = page => page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); }).then(() => page.mouse.move(0, 0)).then(() => new Promise(r => setTimeout(r, 60)));
  const typeCredentials = async page => { await page.type('input[name=username]', 'sara'); await page.type('input[name=password]', 'x'); await page.click('[data-step=password] button[type=submit]'); };

  /** The state the page is in, read at every mode and width. The result: { 'mode/width': { role: style } } */
  const capture = async (page, selectors, roles, { focusUser } = {}) => {
    const out = {};
    for (const mode of MODES) {
      await page.evaluate(m => document.documentElement.setAttribute('data-mode', m), mode);
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const here = await readRoles(page, selectors, roles);
        if (focusUser) {
          await page.focus(selectors.user);
          here.userFocus = (await readRoles(page, selectors, ['user'])).user;
          await settle(page);
        }
        out[`${mode}/${width}`] = here;
      }
    }
    return out;
  };
  const merge = (into, part) => { for (const [k, v] of Object.entries(part)) into[k] = { ...(into[k] || {}), ...v }; };

  const observed = {}; // portal -> side -> 'mode/width' -> role -> style
  for (const portal of ['admin', 'team']) {
    const sel = SELECTORS[portal];
    const steps = STEPS[portal];
    const login = portal === 'admin' ? '/api/auth/login' : '/api/employee/login';
    const code = portal === 'admin' ? '/api/auth/login/2fa' : '/api/employee/login/2fa';
    const classicUrl = portal === 'admin' ? '/legacy/dashboard' : '/legacy/employee';
    const nextUrl = portal === 'admin' ? '/dashboard' : '/employee';
    const classic = {}, next = {};
    observed[portal] = { classic, next };

    // — the classic page: one load, its steps shown the way its own script shows them —
    {
      const page = await open(classicUrl);
      await page.evaluate(portal => {
        const e = document.querySelector(portal === 'admin' ? '#auth-error' : '#auth-err');
        e.textContent = 'Invalid username or password'; e.style.display = 'block';
      }, portal);
      merge(classic, await capture(page, sel.classic, steps.password, { focusUser: true }));
      await page.evaluate(portal => {
        if (portal === 'admin') showAdminMfa('x'); else showMfa('x');
        const e = document.querySelector(portal === 'admin' ? '#admin-mfa-error' : '#auth-err');
        e.textContent = 'That code is not right.'; e.style.display = 'block';
      }, portal);
      merge(classic, await capture(page, sel.classic, steps.code));
      if (portal === 'team') {
        await page.evaluate(() => showForgotPassword());
        merge(classic, await capture(page, sel.classic, steps.forgot));
        await page.evaluate(() => showResetPasswordForm('t'));
        merge(classic, await capture(page, sel.classic, steps.reset));
      }
      await page.shut();
    }

    // — the new app: each step reached the way a person reaches it, against a server that answers as scripted —
    {
      const page = await open(nextUrl, { next: true, answers: { [login]: [401, { error: 'Invalid username or password' }] } });
      await typeCredentials(page);
      await page.waitForSelector('[data-step=password] [role=alert]');
      merge(next, await capture(page, sel.next, steps.password, { focusUser: true }));
      await page.shut();
    }
    {
      const page = await open(nextUrl, { next: true, answers: { [login]: [200, { mfa_required: true, mfa_token: 'x' }], [code]: [401, { error: 'That code is not right.' }] } });
      await typeCredentials(page);
      await page.waitForSelector('[data-step=code]');
      await page.type('input[name=code]', '123456');
      await page.click('[data-step=code] button[type=submit]');
      await page.waitForSelector('[data-step=code] [role=alert]');
      merge(next, await capture(page, sel.next, steps.code));
      await page.shut();
    }
    if (portal === 'team') {
      let page = await open(nextUrl, { next: true });
      await page.click('[data-step=password] [data-part=link]');
      await page.waitForSelector('[data-step=forgot]');
      merge(next, await capture(page, sel.next, steps.forgot));
      await page.shut();
      page = await open(nextUrl + '?reset=t', { next: true });
      await page.waitForSelector('[data-step=reset]');
      merge(next, await capture(page, sel.next, steps.reset));
      await page.shut();
    }
  }
  await browser.close();

  // ── compare ──
  const near = (a, b) => Array.isArray(a) ? a.every((v, i) => Math.abs(v - b[i]) <= 0.5) : a === b;
  const stale = new Set(Object.keys(ACCEPTED));
  let compared = 0;
  for (const portal of ['admin', 'team']) {
    const { classic, next } = observed[portal];
    for (const mode of MODES) {
      for (const width of WIDTHS) {
        const k = `${mode}/${width}`;
        const bad = [];
        let n = 0;
        for (const role of Object.keys(classic[k])) {
          const c = classic[k][role], x = next[k] && next[k][role];
          if (!c || !x) { bad.push(`${role}: ${c ? 'missing from the new app' : 'missing from the classic page'}`); continue; }
          for (const p of [...PROPS, '_rect']) {
            n++; compared++;
            if (near(c[p], x[p])) continue;
            if (ACCEPTED[`${role}.${p}`]) { stale.delete(`${role}.${p}`); continue; }
            bad.push(`${role}.${p}: classic ${JSON.stringify(c[p])} vs new ${JSON.stringify(x[p])}`);
          }
        }
        check(`${portal} sign-in, ${mode}, ${width}px: ${n} values are the classic page's`, bad.length === 0, bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
      }
    }
  }
  check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 9000, String(compared));
  check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));

  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
