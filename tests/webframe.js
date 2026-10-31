// A screen that has not moved into the new app, as it appears there: the classic page itself, in a frame, against the real
// server and a real browser.
//
// tests/embed.js holds the classic page's side of this (what it hides, what it leaves to the app, what it says); the app's own
// tests hold the frame's logic against a script. This is the two together, whole: every screen the rail lists opens its classic
// page — or says why it cannot — for the admin and for a team member who holds everything; one frame serves them all, without a
// reload; what the person does inside the page moves the app's address, and the browser's back button moves the page; a session
// that ends inside the frame ends in the app; the colour mode and the look the admin saves reach the page; nothing runs twice.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath } = require('./helpers/browser');
const M = require('@motolinker/contracts/modules');
const T = require('../public/assets/theme-core.js');
const P = require('@motolinker/contracts/permissions');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const only = process.env.FRAME_ONLY ? new Set(process.env.FRAME_ONLY.split(',')) : null;   // a mutation run needs only the part it can break
const wants = part => !only || only.has(part);

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-frame-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// Screens a frame cannot hold (apps/web/src/legacy/frameable.ts): they say why, and where the classic page is. (Security was one
// until it moved: it is a panel over the page, tested in tests/websecurity.js.)
const NOT_FRAMED = ['chat'];
// Screens that have moved into the app: their page is the app's own, not the classic page in a frame.
const MOVED = { notifications: '[data-part=notificationsPage]', submissions: '[data-part=submissionsPage]', issues: '[data-part=issuesPage]', meet: '[data-part=meetPage]', calendar: '[data-part=calendarPage]', suppliers: '[data-part=suppliersPage]', rfq: '[data-part=docPage]', purchaseorders: '[data-part=docPage]', contracts: '[data-part=docPage]', stock: '[data-part=stockPage]', drive: '[data-part=googlePage]', sheets: '[data-part=googlePage]' };

(async () => {
  const db = createFakeSupabase(seedTables(parseSchema()));
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3994, env: { ML_WEB_DIST: dist, GOOGLE_CHAT_ENABLED: '1', GOOGLE_CHAT_CLIENT_ID: 'chat-client' } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));

  // ── the people: the admin, and a team member who holds everything there is to hold ────────────
  const ALL = {};
  for (const [section, actions] of Object.entries(P.PERM_ACTIONS)) { ALL[section] = true; ALL[section + 'Actions'] = Object.fromEntries(actions.map(a => [a, true])); }
  const SARA = { id: 41, name: 'Sara', title: 'Everything', raw: ALL };
  db.tables.employees = db.tables.employees.filter(e => e.id !== SARA.id).concat([{ ...db.tables.employees[0], id: SARA.id, name: SARA.name, username: 'sara', job_title: SARA.title, permissions: SARA.raw, email: 'sara@example.com' }]);
  const PEOPLE = {
    admin: { portal: 'admin', token: 'frame-admin', key: 'ml_admin_token', route: '/dashboard', classic: '/legacy/dashboard' },
    team: { portal: 'team', token: 'frame-sara', key: 'ml_emp_token', route: '/employee', classic: '/legacy/employee' },
  };
  ctx.sessions.set(PEOPLE.admin.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(PEOPLE.team.token, { id: SARA.id, name: SARA.name, username: 'sara', job_title: SARA.title, permissions: normEmpPerms(SARA.raw), createdAt: Date.now() });
  const api = async (method, p, token, body) => {
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // ── the browser ───────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const STUBS = () => {
    // (the classic pages draw their icons with lucide and their charts with Chart.js, both from a CDN)
    window.lucide = { createIcons() {} };
    window.Chart = function () { return { destroy() {}, update() {} }; };
  };
  const open = async (p, { url, mode = 'dark', width = 1100, height = 800, safe = false } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const requests = [];
    page.on('request', r => requests.push({ url: r.url(), frame: r.frame() === page.mainFrame() ? 'app' : 'frame' }));
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(STUBS);
    await page.evaluateOnNewDocument((key, token, mode) => { localStorage.setItem(key, token); if (mode) localStorage.setItem('ml_mode', mode); }, p.key, p.token, mode);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width, height });
    await page.goto(base + (url || p.route) + (safe ? '?safe=1' : ''), { waitUntil: 'domcontentloaded' });
    return Object.assign(page, { requests, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg);
  const shell = page => page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
  const frameOf = page => page.frames().find(f => f.url().includes('/legacy/'));
  const shown = async page => { const f = frameOf(page); return f ? f.evaluate(() => (document.querySelector('.page.active') || {}).id || null).catch(() => null) : null; };
  const railOf = page => page.evaluate(() => [...document.querySelectorAll('[data-part=item],[data-part=itemActive]')].map(i => i.dataset.screen));
  const click = (page, id) => page.evaluate(i => document.querySelector(`[data-part=item][data-screen=${i}],[data-part=itemActive][data-screen=${i}]`).click(), id);
  const where = page => page.evaluate(() => location.pathname + location.search);
  const activeItem = page => page.evaluate(() => (document.querySelector('[data-part=itemActive]') || {}).dataset?.screen || null);
  // the page the frame is meant to be showing for a screen, once the address says the screen and the page says it is on it
  const arrived = async (page, portal, id) => {
    const want = 'page-' + M.legacyIdOf(M.screenOf(id), portal);
    for (let i = 0; i < 150; i++) {
      if ((await where(page)).endsWith('/' + id) && (await shown(page)) === want) return true;
      await sleep(100);
    }
    return false;
  };

  // ── 1. every screen in the rail ───────────────────────────────────────────────────────────
  if (wants('walk')) {
    for (const p of Object.values(PEOPLE)) {
      const page = await open(p, { url: p.route + '/home' });
      await shell(page);
      const rail = (await railOf(page)).filter(id => id !== 'home');
      const framed = rail.filter(id => !NOT_FRAMED.includes(id) && !Object.hasOwn(MOVED, id));
      const cards = rail.filter(id => NOT_FRAMED.includes(id));
      check(`${p.portal}: the rail lists the screens the portal has (${rail.length} besides Home, ${framed.length} of them framed)`, rail.length >= 20 && framed.length >= 10, rail.join());

      // all of them, one after the other, through the rail: the first opens the frame, the rest are asked of it
      const problems = [];
      let first = true;
      for (const id of framed) {
        await click(page, id);
        if (first) { await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 }); await frameOf(page).evaluate(() => { window.__marker = 'one load'; }); first = false; }
        if (!(await arrived(page, p.portal, id))) problems.push(`${id} (wants ${M.legacyIdOf(M.screenOf(id), p.portal)}, shows ${await shown(page)})`);
        else if ((await activeItem(page)) !== id) problems.push(`${id} (the rail says ${await activeItem(page)})`);
      }
      check(`${p.portal}: every framed screen in the rail shows its classic page, and the rail and the address say the same`, problems.length === 0, problems.join('; '));
      const marker = await frameOf(page).evaluate(() => window.__marker).catch(() => null);
      const frames = await page.evaluate(() => document.querySelectorAll('iframe').length);
      check(`${p.portal}: …in one frame that was loaded once (a click is a message, not a reload)`, marker === 'one load' && frames === 1, `${marker} ${frames}`);
      const forced = requested => requested.filter(r => r.frame === 'frame' && /\/legacy\//.test(r.url) && !/[?&]embed=1/.test(r.url));
      check(`${p.portal}: …and it was only ever the embedded page that was asked for`, forced(page.requests).length === 0, forced(page.requests).map(r => r.url).join());

      // the ones that have moved are the app's own page: no frame, nothing of the classic page
      const moved = [];
      for (const [id, own] of Object.entries(MOVED)) {
        await click(page, id);
        await page.waitForSelector(own, { timeout: 20000 });
        const there = await page.evaluate(() => ({ frame: !!document.querySelector('iframe'), at: location.pathname }));
        if (there.frame || !rail.includes(id) || !there.at.endsWith('/' + id) || (await activeItem(page)) !== id) moved.push(id + ' ' + JSON.stringify(there));
      }
      check(`${p.portal}: a screen that has moved (${Object.keys(MOVED).join(', ')}) is in the rail and is the app's own page, not a frame`, moved.length === 0, moved.join('; '));

      // the ones a frame cannot hold say why and where to go
      const cardProblems = [];
      for (const id of NOT_FRAMED) {
        await page.goto(base + p.route + '/' + id, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-part=unported]', { timeout: 20000 });
        const card = await page.evaluate(() => ({ text: document.querySelector('[data-part=unported] p').textContent.trim(), href: document.querySelector('[data-part=unported] a').getAttribute('href'), frame: !!document.querySelector('iframe') }));
        if (card.frame || card.text.length < 20 || card.href !== p.classic + '#' + M.legacyIdOf(M.screenOf(id), p.portal)) cardProblems.push(id + ' ' + JSON.stringify(card));
      }
      check(`${p.portal}: a screen a frame cannot hold (${NOT_FRAMED.join(', ')}) says why and links to the classic page that has it`, cardProblems.length === 0, cardProblems.join('; '));
      check(`${p.portal}: …and the live chat, which is in the rail, is one of them`, cards.join() === 'chat');
      await page.shut();
    }
  }


  // ── 2. opened straight at a screen (a bookmark, a reload, a link in a notification) ─────────────
  if (wants('direct')) {
    const picks = { admin: ['leads', 'tasks', 'reports', 'deals', 'accounting'], team: ['leads', 'tasks', 'hours', 'requests'] };
    for (const p of Object.values(PEOPLE)) {
      const bad = [];
      for (const id of picks[p.portal]) {
        const page = await open(p, { url: p.route + '/' + id });
        await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
        const want = M.legacyIdOf(M.screenOf(id), p.portal);
        const src = await page.evaluate(() => document.querySelector('iframe').getAttribute('src'));
        if (src !== `${p.classic}?embed=1#${want}` || !(await arrived(page, p.portal, id)) || (await activeItem(page)) !== id) bad.push(`${id}: ${src} shows ${await shown(page)}`);
        await page.shut();
      }
      check(`${p.portal}: opened straight at a screen, the frame opens on that screen's page (${picks[p.portal].join(', ')})`, bad.length === 0, bad.join('; '));
    }
  }

  // ── 3. what the person does inside the page, and the browser's own buttons ─────────────────────
  if (wants('follow')) {
    const p = PEOPLE.admin;
    const page = await open(p, { url: p.route + '/leads' });
    await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
    await arrived(page, 'admin', 'leads');
    await frameOf(page).evaluate(() => { window.__same = 'one load'; navigate('deals'); });
    check('a person who moves about inside the page moves the app with it: the address and the rail follow', await arrived(page, 'admin', 'deals') && (await activeItem(page)) === 'deals');
    await click(page, 'tasks');
    check('…and the rail still moves the page', await arrived(page, 'admin', 'tasks'));
    await page.goBack();
    check('the back button goes to the screen before — the page is asked to go there, not loaded again', await arrived(page, 'admin', 'deals') && (await frameOf(page).evaluate(() => window.__same)) === 'one load');
    await page.goBack();
    check('…and again, to where the frame first opened', await arrived(page, 'admin', 'leads'));
    await page.goForward();
    check('…and forward', await arrived(page, 'admin', 'deals'));
    await page.shut();
  }

  // ── 4. a session that ends ────────────────────────────────────────────────────────────────────
  if (wants('end')) {
    for (const p of Object.values(PEOPLE)) {
      const sessions = p.portal === 'admin' ? ctx.sessions : ctx.employeeSessions;
      const kept = sessions.get(p.token);
      const left = page => page.evaluate(key => ({ token: localStorage.getItem(key), frame: !!document.querySelector('iframe'), signIn: !!document.querySelector('input[name=username]') }), p.key);

      let page = await open(p, { url: p.route + '/leads' });
      await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
      if (p.portal === 'admin') await page.evaluate(() => document.querySelector('[data-part=signOut]').click());
      else { await page.evaluate(() => document.querySelector('[data-part=profileBtn]').click()); await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /sign out/i.test(b.textContent)).click()); }
      await page.waitForSelector('input[name=username]', { timeout: 20000 });
      let now = await left(page);
      check(`${p.portal}: signing out in the app takes the framed page away with it, and the browser forgets the session`, now.token === null && !now.frame && now.signIn, JSON.stringify(now));
      await page.shut();

      // the server ends the session while the page is open; the framed page's next call is refused, and says so
      sessions.set(p.token, kept);      // (signing out ended it at the server, too)
      page = await open(p, { url: p.route + '/leads' });
      await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
      sessions.delete(p.token);
      await frameOf(page).evaluate((call, path) => window[call](path), p.portal === 'admin' ? 'apiFetch' : 'ef', p.portal === 'admin' ? '/api/auth/check' : '/api/employee/check');
      await page.waitForSelector('input[name=username]', { timeout: 20000 });
      now = await left(page);
      check(`${p.portal}: a session the server ends is found out by the framed page's next call: the app shows the sign-in, and the frame is gone`, now.token === null && !now.frame && now.signIn, JSON.stringify(now));
      sessions.set(p.token, kept);
      await page.shut();
    }
  }

  // ── 5. the look and the colour mode reach the page ─────────────────────────────────────────────
  if (wants('look')) {
    const p = PEOPLE.admin;
    const colour = target => target.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    const modeOf = target => target.evaluate(() => document.documentElement.getAttribute('data-mode'));
    const page = await open(p, { url: p.route + '/leads' });
    await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
    const before = { app: await colour(page), frame: await colour(frameOf(page)) };
    check('the framed page wears the look the app wears', before.app !== '' && before.app === before.frame, JSON.stringify(before));
    await api('PUT', '/api/dashboard/workspace/theme', p.token, { theme: { preset: 'ember' } });
    await until(page, prev => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() !== prev, before.app);
    let now = {};
    for (let i = 0; i < 50; i++) { now = { app: await colour(page), frame: await colour(frameOf(page)) }; if (now.frame === now.app) break; await sleep(100); }
    check('a look the admin saves reaches the app and the framed page together, without a reload', now.app !== before.app && now.frame === now.app, JSON.stringify({ before, now }));
    await api('PUT', '/api/dashboard/workspace/theme', p.token, { reset: true });

    const first = await modeOf(page);
    await page.click('[data-part=modeToggle]');
    await until(page, was => document.documentElement.getAttribute('data-mode') !== was, first);
    const app = await modeOf(page);
    let frameMode = null;
    for (let i = 0; i < 50 && frameMode !== app; i++) { frameMode = await modeOf(frameOf(page)); await sleep(100); }
    check('the colour button changes the framed page too', app !== first && frameMode === app, `${first} → app ${app}, frame ${frameMode}`);
    await page.shut();
  }

  // ── 6. the original look (?safe=1) ─────────────────────────────────────────────────────────────
  if (wants('safe')) {
    const p = PEOPLE.admin;
    await api('PUT', '/api/dashboard/workspace/theme', p.token, { theme: { preset: 'ember' } });
    const page = await open(p, { url: p.route + '/leads', safe: true });
    await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
    const src = await page.evaluate(() => document.querySelector('iframe').getAttribute('src'));
    const css = await frameOf(page).evaluate(() => document.getElementById('ws-theme').textContent);
    check('opened in safe mode, the frame is asked for the page in safe mode, and it wears the original look whatever is saved', /[?&]safe=1/.test(src) && css === T.renderThemeCss(T.normalize({})), src);
    await page.shut();
    await api('PUT', '/api/dashboard/workspace/theme', p.token, { reset: true });
  }

  // ── 7. nothing runs twice ──────────────────────────────────────────────────────────────────────
  if (wants('once')) {
    for (const p of Object.values(PEOPLE)) {
      const page = await open(p, { url: p.route + '/leads' });
      await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
      await sleep(3000);
      const by = (who, re) => page.requests.filter(r => r.frame === who && re.test(r.url)).length;
      const key = p.portal === 'admin' ? 'admin' : 'employee_' + SARA.id;
      const STREAM = /\/notifications\/stream/, PRESENCE = /\/presence\/heartbeat/, PUSH = /\/push\/subscribe|\/api\/push\/vapid-public-key/, HUDDLE = /\/huddle\/live/;
      check(`${p.portal}: the live stream is opened once, by the app, and not again by the page in the frame`, by('app', STREAM) === 1 && by('frame', STREAM) === 0 && (ctx.notifSseClients.get(key) || new Set()).size === 1, `app ${by('app', STREAM)}, frame ${by('frame', STREAM)}, open ${(ctx.notifSseClients.get(key) || new Set()).size}`);
      check(`${p.portal}: the page in the frame reports no presence, asks for no push, and revives no huddle`, by('frame', PRESENCE) === 0 && by('frame', PUSH) === 0 && by('frame', HUDDLE) === 0);
      await page.shut();
    }
  }

  // ── 8. the page fits the window ────────────────────────────────────────────────────────────────
  if (wants('fit')) {
    const p = PEOPLE.team;
    const edges = page => page.evaluate(() => {
      const f = document.querySelector('iframe').getBoundingClientRect();
      const bar = document.querySelector('[data-part=bottomNav]');
      const shownBar = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect() : null;
      return { top: f.top, bottom: f.bottom, left: f.left, right: f.right, height: innerHeight, width: innerWidth, bar: shownBar && shownBar.top };
    });
    let page = await open(p, { url: p.route + '/leads', width: 1100, height: 800 });
    await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
    let e = await edges(page);
    check('on a desktop the frame ends where the window does, and is as wide as the space beside the rail', Math.abs(e.bottom - e.height) <= 1 && e.right === e.width && e.left > 100 && e.bar === null, JSON.stringify(e));
    await page.shut();
    page = await open(p, { url: p.route + '/leads', width: 390, height: 760 });
    await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
    e = await edges(page);
    check('on a phone it ends where the bottom bar begins, and fills the width', e.bar !== null && Math.abs(e.bottom - e.bar) <= 1 && e.left === 0 && e.right === e.width, JSON.stringify(e));
    await page.shut();
  }

  // ── done ──────────────────────────────────────────────────────────────────────────────────
  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
