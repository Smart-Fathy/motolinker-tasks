// The new app's frame, end to end: a real browser, the built app, the real server on an in-memory database.
//
// The app's own tests answer from scripts, and the parity suite compares looks. This proves the behaviour against the real
// thing: that the rail the new app draws for a person is the rail the CLASSIC portal draws for them (the classic page's own
// code runs, over the same database, and its answer is read out of its markup) — for the admin and for team members who were
// granted different things, with and without the arrangement an admin saves for the sidebar; that the links which already exist
// in the world land on the right screen; that the colour button does what it says and the server remembers it; that a look
// the admin saves reaches an open page without a reload; and that the live stream is the person's own, ends when they leave,
// and is how a revoked session finds out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath } = require('./helpers/browser');
const M = require('@motolinker/contracts/modules');
const T = require('../public/assets/theme-core.js');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

(async () => {
  const db = createFakeSupabase(seedTables(parseSchema()));
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3981, env: { ML_WEB_DIST: dist, GOOGLE_CHAT_ENABLED: '1', GOOGLE_CHAT_CLIENT_ID: 'chat-client' } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));

  // ── the people ────────────────────────────────────────────────────────────────────────────
  const PEOPLE = {
    admin: { portal: 'admin', token: 'shell-admin', route: '/dashboard', classic: '/legacy/dashboard', key: 'ml_admin_token' },
    sara: { portal: 'team', id: 11, name: 'Sara', title: 'Sales', token: 'shell-sara', raw: { leads: true, leadsActions: { view: true, edit: true }, deals: true, dealsActions: { view: true }, quotation: true, reports: true, reportsActions: { leads: true }, gchat: true, gchatActions: { view: true, send: true } } },
    omar: { portal: 'team', id: 12, name: 'Omar', title: 'Ops', token: 'shell-omar', raw: { requests: false, tasks: false, hours: false, chat: false, drive: false, sheets: false, calendar: false, meet: false, stock: false } },
    cleo: { portal: 'team', id: 13, name: 'Cleo', title: 'Chief Technical Officer', token: 'shell-cleo', raw: { email: true, emailActions: { view: true }, accounting: true, accountingActions: { view: true }, stock: true, stockActions: { browse: true }, suppliers: true, hours: true, hoursActions: { view: true }, submissions: true } },
  };
  ctx.sessions.set(PEOPLE.admin.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const p of Object.values(PEOPLE)) {
    if (p.portal !== 'team') continue;
    p.route = '/employee'; p.classic = '/legacy/employee'; p.key = 'ml_emp_token';
    db.tables.employees = db.tables.employees.filter(e => e.id !== p.id).concat([{ ...db.tables.employees[0], id: p.id, name: p.name, username: p.name.toLowerCase(), job_title: p.title, permissions: p.raw, email: p.name.toLowerCase() + '@example.com' }]);
    ctx.employeeSessions.set(p.token, { id: p.id, name: p.name, username: p.name.toLowerCase(), job_title: p.title, permissions: normEmpPerms(p.raw), createdAt: Date.now() });
  }
  const api = async (method, p, token, body) => {
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const adminToken = PEOPLE.admin.token;

  // ── the browser ───────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
  const open = async (p, { next = true, url, mode = 'dark', width = 1100 } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(u)) return r.respond({ status: 200, contentType: 'text/plain', body: '' });
      if (/^https?:/.test(u) && !u.startsWith(base)) return r.abort('internetdisconnected');
      r.continue();
    });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument((key, token, mode) => {
      // (the classic pages draw their icons with lucide, which comes from a CDN; this draws the boxes and not the glyphs)
      window.lucide = { createIcons() {
        for (const i of document.querySelectorAll('i[data-lucide]')) {
          const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          for (const a of i.attributes) if (a.name !== 'data-lucide') s.setAttribute(a.name, a.value);
          s.setAttribute('class', ('lucide lucide-' + i.getAttribute('data-lucide') + ' ' + (i.getAttribute('class') || '')).trim());
          i.replaceWith(s);
        }
      } };
      window.Chart = function () { return { destroy() {}, update() {} }; };
      if (token) localStorage.setItem(key, token);
      if (mode) localStorage.setItem('ml_mode', mode);
    }, p.key, p.token, mode);
    if (next) await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width, height: 800 });
    await page.goto(base + (url || (next ? p.route : p.classic)), { waitUntil: 'domcontentloaded' });
    page.shut = async () => { await page.close(); await context.close(); };
    return page;
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg);

  // The rail as each page draws it: sections, in order, each with its screens, in order, as the person reads them.
  const readClassic = page => page.evaluate(() => {
    const words = el => { const c = el.cloneNode(true); c.querySelectorAll('span').forEach(s => s.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
    return [...document.querySelectorAll('#sidebar .nav-group')].filter(g => g.checkVisibility()).map(g => ({
      group: g.dataset.group,
      label: words(g.querySelector('.nav-group-label').parentElement.cloneNode(true)).replace(/\s*\d*$/, '') || g.querySelector('.nav-group-label').textContent.trim(),
      items: [...g.querySelectorAll('.nav-item')].filter(i => i.checkVisibility() && i.id !== 'nav-help').map(i => ({ page: i.id.replace(/^nav-/, ''), label: words(i) })),
    })).filter(g => g.items.length);
  });
  const readNext = page => page.evaluate(() => [...document.querySelectorAll('[data-part=group]')].map(g => ({
    group: g.dataset.group,
    label: g.querySelector('[data-part=groupLabel]').textContent.trim(),
    items: [...g.querySelectorAll('[data-part=item],[data-part=itemActive]')].map(i => ({ page: i.dataset.screen, label: i.lastElementChild.textContent.trim() })),
  })));
  const asScreens = (rail, portal) => rail.map(g => ({ ...g, items: g.items.map(i => ({ page: M.screenIdFromLegacy(i.page, portal) || i.page, label: i.label })) }));
  const show = rail => rail.map(g => g.label + ': ' + g.items.map(i => i.label).join(', ')).join(' | ');

  const sameRail = async (who, why) => {
    const p = PEOPLE[who];
    const c = await open(p, { next: false });
    await until(c, () => document.querySelector('#nav-home.active') && !!document.querySelector('.nav-group-count, #sidebar .nav-group-head'));
    await sleep(1200);   // (Google Chat's item is decided by an answer from the server, which arrives after the rest)
    const classic = asScreens(await readClassic(c), p.portal);
    await c.shut();
    const n = await open(p);
    await n.waitForSelector('[data-part=sidebar]', { timeout: 15000 });
    await sleep(1200);
    const drawn = await readNext(n);
    await n.shut();
    // A screen the classic portal never had (Issues, in the admin's) is the app's own: everything else is the classic rail.
    const isNew = i => { const sc = M.screenOf(i.page); return !!sc && M.isNewTo(sc, p.portal); };
    const next = drawn.map(g => ({ ...g, items: g.items.filter(i => !isNew(i)) })).filter(g => g.items.length);
    check(`${who}${why}: the new app draws the rail the classic portal draws (${classic.reduce((s, g) => s + g.items.length, 0)} screens in ${classic.length} sections)`, JSON.stringify(classic) === JSON.stringify(next), JSON.stringify(classic) === JSON.stringify(next) ? '' : '\n      classic: ' + show(classic) + '\n      new:     ' + show(next));
    return drawn;
  };

  // ── 1. The rail is the classic portal's, for every kind of person ───────────────────────────
  const rails = {};
  for (const who of Object.keys(PEOPLE)) rails[who] = await sameRail(who, '');
  const flat = r => r.flatMap(g => g.items.map(i => i.page));
  check('the admin has every screen of the admin portal, Google Chat among them because the server says it is set up', M.NAV.admin.flatMap(g => g.items).every(id => flat(rails.admin).includes(id)) && flat(rails.admin).length === M.NAV.admin.flatMap(g => g.items).length);
  check('the one screen the classic admin portal never had, Issues, stands beside Notifications in the admin\'s System section', (() => { const sys = rails.admin.find(g => g.group === 'system'); return !!sys && sys.items.map(i => i.page).join() === 'notifications,issues,workspace'; })());
  check('Sara has the screens she was granted and the ones everybody has, and Google Chat because she was given it', ['leads', 'deals', 'quotation', 'reports', 'gchat', 'tasks', 'notifications'].every(s => flat(rails.sara).includes(s)) && !flat(rails.sara).includes('accounting'));
  check('Omar, granted nothing, has Home and Notifications, and nothing of the admin\'s', flat(rails.omar).join() === 'home,notifications');
  check('Cleo has Issues because of her title, and what she was granted', ['issues', 'accounting', 'stock', 'suppliers', 'email', 'submissions', 'hours'].every(s => flat(rails.cleo).includes(s)));

  // …and with the arrangement the admin saved: renamed, moved, hidden, reordered
  const arranged = await api('PUT', '/api/dashboard/nav-config', adminToken, { groups: [
    { key: 'system', label: 'Account', items: [{ id: 'nav-notif', label: 'Alerts' }] },
    { key: 'crm', label: 'Sales & Marketing', items: [{ id: 'nav-customers', label: 'Prospects' }, { id: 'nav-deals' }, { id: 'nav-calendar' }] },
    { key: 'management', items: [{ id: 'nav-tasks', hidden: true }, { id: 'nav-requests' }, { id: 'nav-home' }] },
    { key: 'google', items: [{ id: 'nav-drive' }, { id: 'nav-meet' }] },
  ] });
  check('the admin saves an arrangement of the sidebar', arranged.status === 200);
  for (const who of ['admin', 'sara', 'cleo']) await sameRail(who, ', after the admin arranged the sidebar');
  // A whole section the admin hides. The classic admin portal hides it; the classic team portal draws it again for anyone with
  // a screen in it, because it redraws every heading from its visible screens after applying the arrangement (and the same code
  // says "the admin's hidden flag may only narrow"). The new app does what the admin asked, for both.
  await api('PUT', '/api/dashboard/nav-config', adminToken, { groups: [{ key: 'finance', hidden: true, items: [] }, { key: 'crm', hidden: true, items: [] }] });
  await sameRail('admin', ', with a section hidden');
  const hid = await open(PEOPLE.cleo);
  await hid.waitForSelector('[data-part=sidebar]', { timeout: 15000 });
  await sleep(1000);
  const hidden = (await readNext(hid)).map(g => g.group);
  await hid.shut();
  check('a section the admin hid is hidden for a team member too, even one who holds a screen in it (the classic team portal draws it again)', !hidden.includes('finance') && !hidden.includes('crm') && hidden.includes('management'), hidden.join());
  await api('DELETE', '/api/dashboard/nav-config', adminToken);

  // ── 2. Links that already exist land on the screen they mean ────────────────────────────────
  const where = async (p, url) => {
    const page = await open(p, { url });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 15000 });
    await sleep(500);
    const at = await page.evaluate(() => location.pathname + location.search + location.hash);
    const active = await page.evaluate(() => document.querySelector('[data-part=itemActive]')?.dataset.screen || null);
    await page.shut();
    return { at, active };
  };
  let w = await where(PEOPLE.admin, '/dashboard#customers');
  check('/dashboard#customers (a notification the server wrote) opens Leads, at the address the new app gives it', w.at === '/dashboard/leads' && w.active === 'leads', JSON.stringify(w));
  w = await where(PEOPLE.cleo, '/employee#log');
  check('/employee#log (the team portal\'s old key for hours) opens Hours', w.at === '/employee/hours' && w.active === 'hours', JSON.stringify(w));
  w = await where(PEOPLE.admin, '/dashboard?chat=room-9');
  check('/dashboard?chat=room-9 (a push notification\'s click) opens that room', w.at === '/dashboard/chat/room-9' && w.active === 'chat', JSON.stringify(w));
  w = await where(PEOPLE.sara, '/employee#deletions');
  check('a link to something the person has no screen for opens Home', w.at === '/employee/home' && w.active === 'home', JSON.stringify(w));
  w = await where(PEOPLE.omar, '/employee/deals');
  check('an address typed or bookmarked for a screen they were not granted opens Home, not an error', w.at === '/employee/home', JSON.stringify(w));
  w = await where(PEOPLE.admin, '/dashboard/leads');
  check('an address inside the app opens that screen straight away (and a reload would)', w.at === '/dashboard/leads' && w.active === 'leads', JSON.stringify(w));
  let page = await open(PEOPLE.sara, { url: '/employee/leads' });
  await page.waitForSelector('iframe[data-state=ready]', { timeout: 20000 });
  const framed = await page.evaluate(() => document.querySelector('iframe').getAttribute('src'));
  check('a screen that has not moved is the classic page, in a frame (tests/webframe.js holds every screen to it)', framed === '/legacy/employee?embed=1#leads', framed);
  await page.shut();
  // (a screen a frame cannot hold — the live chat — says so, and its button opens that screen in the classic portal)
  page = await open(PEOPLE.sara, { url: '/employee/chat' });
  await page.waitForSelector('[data-part=unported]', { timeout: 15000 });
  const pointer = await page.evaluate(() => document.querySelector('[data-part=unported] a')?.getAttribute('href'));
  check('a screen that cannot be shown in a frame says so, and its button opens that screen in the classic portal', pointer === '/legacy/employee#chat', pointer);
  await page.goto(base + pointer, { waitUntil: 'domcontentloaded' });
  await until(page, () => document.querySelector('#nav-chat.active'));
  check('…and the classic portal, opened that way, is the classic portal, signed in as the same person (one origin, one key)', await page.evaluate(() => !!document.querySelector('#page-chat') && location.pathname === '/legacy/employee'));
  await page.shut();

  // ── 3. The colour button ────────────────────────────────────────────────────────────────────
  page = await open(PEOPLE.admin, { mode: null });
  await page.waitForSelector('[data-part=modeToggle]', { timeout: 15000 });
  const modeOf = () => page.evaluate(() => document.documentElement.getAttribute('data-mode'));
  const labelOf = () => page.evaluate(() => document.querySelector('[data-part=modeToggle]').getAttribute('aria-label'));
  const first = await labelOf();
  await page.click('[data-part=modeToggle]');
  const second = await labelOf();
  check('the button names the mode and what the next press does, and a press changes both', /^Colour mode: (Dark|Light)/.test(first) && first !== second, first + ' → ' + second);
  const chosen = await page.evaluate(() => localStorage.getItem('ml_mode'));
  await until(page, () => true);
  await sleep(600);
  const saved = db.tables.quotation_settings.find(r => r.key === 'ui_prefs:admin');
  check('the choice is kept in the browser and at the server, so it follows the person to another device', !!chosen && !!saved && JSON.parse(saved.value).mode === chosen, `${chosen} / ${saved && saved.value}`);
  const after = await modeOf();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-part=modeToggle]', { timeout: 15000 });
  check('…and it is still the mode after a reload, from the first paint', (await modeOf()) === after);
  // pressing until it is light: the page is light, and the classic portal opened beside it wears the same mode
  for (let i = 0; i < 3 && (await page.evaluate(() => localStorage.getItem('ml_mode'))) !== 'light'; i++) await page.click('[data-part=modeToggle]');
  check('light is light', (await modeOf()) === 'light');
  const classicPage = await open(PEOPLE.admin, { next: false, mode: null });
  await until(classicPage, () => document.querySelector('#nav-home.active'));
  check('the classic portal, opened next, wears the mode that was chosen here (one key between them)', (await classicPage.evaluate(() => document.documentElement.getAttribute('data-mode'))) === 'light');
  await classicPage.shut();
  await page.shut();

  // ── 4. A look the admin saves reaches an open page ──────────────────────────────────────────
  page = await open(PEOPLE.omar);
  await page.waitForSelector('[data-part=brandName]', { timeout: 15000 });
  await until(page, () => window.__streamUp !== false);
  await sleep(800);
  const before = await page.evaluate(() => ({ css: document.getElementById('ws-theme').textContent, name: document.querySelector('[data-part=brandName]').textContent, title: document.title }));
  const named = await api('PUT', '/api/dashboard/workspace', adminToken, { name: 'Renamed Motors' });
  const themed = await api('PUT', '/api/dashboard/workspace/theme', adminToken, { theme: { preset: 'cyberpunk' }, texts: { team_role: 'Crew of {ws}' } });
  check('the admin renames the workspace and changes its look', named.status === 200 && themed.status === 200, JSON.stringify([named.body, themed.body]).slice(0, 200));
  await until(page, () => document.querySelector('[data-part=brandName]').textContent === 'Renamed Motors');
  await sleep(400);
  const now = await page.evaluate(() => ({ css: document.getElementById('ws-theme').textContent, name: document.querySelector('[data-part=brandName]').textContent, sub: document.querySelector('[data-part=brandSub]').textContent, title: document.title }));
  const profile = await (await fetch(base + '/api/workspace')).json();
  check('a team member\'s open page wears the new name, wording and tab title without a reload', now.name === 'Renamed Motors' && now.sub === 'Crew of Renamed Motors' && /Renamed Motors/.test(now.title), JSON.stringify(now).slice(0, 200));
  check('…and the look is the one the server writes for it: the very same style, by the same code', now.css !== before.css && now.css === T.renderThemeCss(T.normalize(profile)));
  await page.shut();
  await api('PUT', '/api/dashboard/workspace/theme', adminToken, { reset: true, });
  await api('PUT', '/api/dashboard/workspace', adminToken, { name: 'MotoLinker' });

  // ── 5. Safe mode ────────────────────────────────────────────────────────────────────────────
  await api('PUT', '/api/dashboard/workspace/theme', adminToken, { theme: { preset: 'cyberpunk' } });
  page = await open(PEOPLE.admin, { url: '/dashboard?safe=1' });
  await page.waitForSelector('[data-part=sidebar]', { timeout: 15000 });
  await sleep(600);
  const safe = await page.evaluate(() => ({ button: !!document.querySelector('[data-part=modeToggle]'), href: document.querySelector('[data-part=item]').getAttribute('href'), css: document.getElementById('ws-theme').textContent }));
  const original = T.renderThemeCss(T.normalize({}));
  check('?safe=1 wears the original look whatever is saved, offers no colour button, and keeps itself in every link', safe.css === original && !safe.button && /\?safe=1$/.test(safe.href), JSON.stringify({ ...safe, css: safe.css.length }));
  await page.shut();
  await api('PUT', '/api/dashboard/workspace/theme', adminToken, { reset: true });

  // ── 6. The live stream is the person's own ──────────────────────────────────────────────────
  page = await open(PEOPLE.sara);
  await page.waitForSelector('[data-part=sidebar]', { timeout: 15000 });
  await until(page, () => true);
  for (let i = 0; i < 30 && !ctx.notifSseClients.has('employee_11'); i++) await sleep(100);
  check('the stream the page opens is its person\'s (the header carries the session; the address does not)', ctx.notifSseClients.has('employee_11') && !ctx.notifSseClients.has('admin'));
  await page.evaluate(() => document.querySelector('[data-part=profileBtn]').click());
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /sign out/i.test(b.textContent)).click());
  await page.waitForSelector('input[name=username]', { timeout: 15000 });
  for (let i = 0; i < 30 && ctx.notifSseClients.has('employee_11'); i++) await sleep(100);
  check('leaving closes it: the person is no longer on the stream, and the browser has forgotten the session', !ctx.notifSseClients.has('employee_11') && (await page.evaluate(() => localStorage.getItem('ml_emp_token'))) === null);
  await page.shut();

  page = await open(PEOPLE.cleo);
  await page.waitForSelector('[data-part=sidebar]', { timeout: 15000 });
  for (let i = 0; i < 30 && !ctx.notifSseClients.has('employee_13'); i++) await sleep(100);
  // the session is revoked at the server and the connection drops, as it does when the server restarts or a login is ended
  ctx.employeeSessions.delete(PEOPLE.cleo.token);
  for (const res of [...(ctx.notifSseClients.get('employee_13') || [])]) { try { res.end(); } catch (_) {} }
  await page.waitForSelector('input[name=username]', { timeout: 20000 });
  check('a session the server has revoked finds out over the stream, and the person is shown the sign-in', (await page.evaluate(() => localStorage.getItem('ml_emp_token'))) === null);
  await page.shut();

  page = await open(PEOPLE.admin);
  await page.waitForSelector('[data-part=sidebar]', { timeout: 15000 });
  for (let i = 0; i < 30 && !ctx.notifSseClients.has('admin'); i++) await sleep(100);
  // the server drops the connection and is not reachable for a moment: nobody is signed out for that
  const streams = [...(ctx.notifSseClients.get('admin') || [])];
  db.failing = true;
  for (const res of streams) { try { res.end(); } catch (_) {} }
  await sleep(2500);
  const stillIn = await page.evaluate(() => ({ token: localStorage.getItem('ml_admin_token'), rail: !!document.querySelector('[data-part=sidebar]'), signIn: !!document.querySelector('input[name=username]') }));
  db.failing = false;
  check('a server that drops the stream and cannot answer for a moment does not sign anyone out', stillIn.token === PEOPLE.admin.token && stillIn.rail && !stillIn.signIn, JSON.stringify(stillIn));
  for (let i = 0; i < 80 && !ctx.notifSseClients.has('admin'); i++) await sleep(250);
  check('…and the stream comes back by itself once the server does', ctx.notifSseClients.has('admin'));
  await page.shut();

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
