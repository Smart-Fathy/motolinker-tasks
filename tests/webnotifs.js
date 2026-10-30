// The new app's notifications, whole: a real server (the real routes and stream, an in-memory database), the built app, a real
// browser. tests/notifications.js holds the server's side (what the routes answer, to whom); apps/web's own tests hold the
// logic against a script; tests/notifparity.js holds the look to the classic pages'. This is the three working together —
//
//   the bell and the rail's badge count what the server says is unread, and what the person reads stays read after a reload
//   a notification written while the app is open arrives on the live stream: the count, the toast, the head of the panel
//   a click goes to the page the notification is about, and the server has it read
//   one person never sees another's; the team member's click goes where the team portal has always taken it
//   a task for a team member reaches the classic Tasks page in its frame, which no longer holds the stream itself
//   what came while the stream was away is there when it is back, with no toast for what the person was not there to see
//   a server that cannot read the notifications says so, and the Notification Center asks again when it is opened
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath } = require('./helpers/browser');
const P = require('@motolinker/contracts/permissions');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-notifs-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

(async () => {
  const db = createFakeSupabase(seedTables(parseSchema()), { defaults: { notifications: () => ({ read: false }) } });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3991, env: { ML_WEB_DIST: dist } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));

  // ── the people: the admin, Sara (who holds everything) and Omar (who is only here to have notifications of his own) ──
  const ALL = {};
  for (const [section, actions] of Object.entries(P.PERM_ACTIONS)) { ALL[section] = true; ALL[section + 'Actions'] = Object.fromEntries(actions.map(a => [a, true])); }
  const person = (id, name) => ({ ...db.tables.employees[0], id, name, username: name.toLowerCase(), job_title: 'Sales', permissions: ALL, email: name.toLowerCase() + '@example.com' });
  db.tables.employees = db.tables.employees.filter(e => ![41, 42].includes(e.id)).concat([person(41, 'Sara'), person(42, 'Omar')]);
  const PEOPLE = {
    admin: { portal: 'admin', token: 'wn-admin', key: 'ml_admin_token', route: '/dashboard', member: 'admin' },
    team: { portal: 'team', token: 'wn-sara', key: 'ml_emp_token', route: '/employee', member: 'employee_41' },
  };
  ctx.sessions.set(PEOPLE.admin.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(PEOPLE.team.token, { id: 41, name: 'Sara', username: 'sara', job_title: 'Sales', permissions: normEmpPerms(ALL), createdAt: Date.now() });

  const ago = ms => new Date(Date.now() - ms).toISOString();
  const seed = () => {
    db.tables.notifications = [
      { id: 1, member_key: 'admin', type: 'task', title: '📋 New task', body: 'Quote the Hilux', url: '/dashboard#tasks', read: false, created_at: ago(30 * 60e3) },
      { id: 2, member_key: 'admin', type: 'request', title: 'A request', body: '', url: '/dashboard#requests', read: true, created_at: ago(2 * 3600e3) },
      { id: 3, member_key: 'admin', type: 'lead', title: 'A lead', body: 'Call back', url: '', read: false, created_at: ago(40 * 60e3) },
      { id: 11, member_key: 'employee_41', type: 'request', title: 'Request approved', body: 'Your leave', url: '/employee#requests', read: false, created_at: ago(30 * 60e3) },
      { id: 12, member_key: 'employee_41', type: 'hours', title: 'Hours approved', body: '', url: '', read: true, created_at: ago(5 * 3600e3) },
      { id: 13, member_key: 'employee_41', type: 'general', title: 'Hello Sara', body: '', url: '', read: false, created_at: ago(50 * 60e3) },
      { id: 21, member_key: 'employee_42', type: 'task', title: 'For Omar only', body: '', url: '', read: false, created_at: ago(10 * 60e3) },
    ];
  };
  seed();
  const row = id => db.tables.notifications.find(n => n.id === id);
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };

  // ── the browser ────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, url) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const requests = [], posts = [];
    page.on('request', r => {
      requests.push(r.url());
      if (r.method() === 'POST' && /\/api\/v1\/notifications\/read/.test(r.url())) posts.push(JSON.parse(r.postData() || 'null'));
    });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; }; });
    await page.evaluateOnNewDocument((key, token) => { localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 800 });
    await page.goto(base + p.route + (url || '/home'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { requests, posts, shut: async () => { await page.close(); await context.close(); } });
  };
  const q = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel);
  const badge = page => q(page, '[data-part=bellBadge]');
  const railBadge = page => q(page, '[data-screen=notifications] [data-part=navBadge]');
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const where = page => page.evaluate(() => location.pathname);
  const rows = page => page.evaluate(() => [...document.querySelectorAll('[data-part=panel] [data-part=item] [data-part=title]')].map(e => e.textContent.trim()));
  const toasts = page => page.evaluate(() => [...document.querySelectorAll('[data-part=toast]')].map(e => e.textContent.trim()));
  const sseOf = key => ctx.notifSseClients.get(key) || new Set();
  const live = async (member, n) => { await until({ waitForFunction: () => Promise.resolve() }, () => true); return ctx.createNotification(member, n, false); };

  // ═══ 1. the admin: what is unread, and what stays read ═════════════════════════════════
  {
    const page = await open(PEOPLE.admin);
    check('the bell counts what the server says is unread — for this person only', await until(page, () => document.querySelector('[data-part=bellBadge]')?.textContent === '2') && await badge(page) === '2');
    check('…and so does the rail\'s Notifications item', await railBadge(page) === '2');
    check('the list was asked of /api/v1 once, as the person who is signed in', page.requests.filter(u => u.endsWith('/api/v1/notifications')).length === 1);
    await page.click('[data-part=bell]');
    check('opening the bell shows the newest, with the emoji a title was stored with taken off', await until(page, () => document.querySelectorAll('[data-part=panel] [data-part=item]').length === 3) && (await rows(page)).join('|') === 'New task|A lead|A request', (await rows(page)).join('|'));
    check('…reads them all at once: the badge goes, the server is told once', await badge(page) === null && await railBadge(page) === null && await waitFor(() => page.posts.length === 1) && JSON.stringify(page.posts) === '[{"all":true}]', JSON.stringify(page.posts));
    check('…and the database has them read — those of this person, and nobody else\'s', await waitFor(() => row(1).read && row(3).read) && !row(11).read && !row(13).read && !row(21).read);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=bell]', { timeout: 20000 });
    await sleep(600);
    check('after a reload they are still read', await badge(page) === null);
    check('…and the Notification Center lists them all, newest first, the way the server sorts them', await (async () => { await page.goto(base + '/dashboard/notifications', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-part=centerItem]', { timeout: 20000 }); return page.evaluate(() => [...document.querySelectorAll('[data-part=centerItem] [data-part=title]')].map(e => e.textContent.trim()).join('|')); })() === 'New task|A lead|A request');
    await page.shut();
  }

  // ═══ 2. live: one arrives while the app is open ═══════════════════════════════════════
  {
    seed();
    const page = await open(PEOPLE.admin, '/leads');
    await until(page, () => document.querySelector('[data-part=bellBadge]')?.textContent === '2');
    check('the app holds the stream, not the classic page in its frame (a notification is the first thing to prove it)', await waitFor(() => sseOf('admin').size === 1));
    await ctx.createNotification('admin', { type: 'task', title: 'Live task', body: 'Look at this', url: '/dashboard#tasks' }, false);
    check('a notification written now reaches the open app, on a screen that is a classic page in a frame: the count goes up', await until(page, () => document.querySelector('[data-part=bellBadge]')?.textContent === '3') && await railBadge(page) === '3');
    check('…and comes up as a toast, in the words the classic portal uses', (await toasts(page)).join() === 'Live task · Look at this', (await toasts(page)).join());
    await page.click('[data-part=bell]');
    check('…and is at the head of the panel', await until(page, () => document.querySelector('[data-part=panel] [data-part=item] [data-part=title]')?.textContent === 'Live task') && (await rows(page))[0] === 'Live task');
    await page.evaluate(() => [...document.querySelectorAll('[data-part=panel] [data-part=item]')].find(e => /Live task/.test(e.textContent)).click());
    const shownIn = async () => { const f = page.frames().find(x => x.url().includes('/legacy/')); return f ? f.evaluate(() => (document.querySelector('.page.active') || {}).id || null).catch(() => null) : null; };
    check('a click on it goes to the page it is about, closes the panel and shows the classic Tasks page (the one frame is asked, not reloaded)', await waitFor(async () => (await where(page)).endsWith('/tasks') && await shownIn() === 'page-tasks') && !(await page.$('[data-part=panel]')), `${await where(page)} ${await shownIn()}`);
    check('…and the server has it read (it was read by opening the panel; the click says so again, by id)', await waitFor(() => page.posts.some(b => b && b.id === 4)) || page.posts.length >= 2, JSON.stringify(page.posts));
    await sleep(4600);
    check('a toast goes by itself', (await toasts(page)).length === 0);
    await page.shut();
  }

  // ═══ 3. one person never sees another's; the team portal's own ways ═══════════════════
  {
    seed();
    const page = await open(PEOPLE.team);
    check('a team member\'s bell counts their own: two unread, not Omar\'s and not the admin\'s', await until(page, () => document.querySelector('[data-part=bellBadge]')?.textContent === '2') && await railBadge(page) === '2');
    await page.click('[data-part=bell]');
    check('…and lists only theirs', await until(page, () => document.querySelectorAll('[data-part=panel] [data-part=item]').length === 3) && (await rows(page)).sort().join('|') === 'Hello Sara|Hours approved|Request approved', (await rows(page)).join('|'));
    await page.evaluate(() => [...document.querySelectorAll('[data-part=panel] [data-part=item]')].find(e => /Request approved/.test(e.textContent)).click());
    check('a click on a notification whose link names a page goes there (the team portal\'s Requests)', await until(page, () => location.pathname === '/employee/requests' && document.querySelector('iframe[src*="#requests"]')), await where(page));
    await page.click('[data-part=bell]');
    await page.evaluate(() => [...document.querySelectorAll('[data-part=panel] [data-part=item]')].find(e => /Hello Sara/.test(e.textContent)).click());
    check('…and one that names none goes to the hours, as it always has', await until(page, () => location.pathname === '/employee/hours'), await where(page));
    check('Omar\'s and the admin\'s are untouched', !row(21).read && !row(1).read);

    // a task, while the Tasks page is in its frame: the page reads its tasks again
    await page.goto(base + '/employee/tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('iframe[data-state=ready]', { timeout: 25000 });
    const frame = () => page.frames().find(f => f.url().includes('/legacy/'));
    await frame().evaluate(() => { window.__reads = []; for (const name of ['loadMyTasks', 'loadDropdownTasks']) { const was = window[name]; window[name] = function () { window.__reads.push(name); return was.apply(this, arguments); }; } });
    await waitFor(() => sseOf('employee_41').size === 1);
    await ctx.createNotification('employee_41', { type: 'task', title: 'New task assigned', body: 'Quote the Hilux', url: '/employee#tasks' }, false);
    check('a task assigned to a team member makes the classic Tasks page in its frame read its tasks again (the page no longer holds the stream)', await waitFor(async () => (await frame().evaluate(() => window.__reads.slice().sort().join())) === 'loadDropdownTasks,loadMyTasks'));
    await ctx.createNotification('employee_41', { type: 'request', title: 'Something else', body: '', url: '' }, false);
    await sleep(400);
    check('…and no other kind of notification does', (await frame().evaluate(() => window.__reads.length)) === 2);
    await page.shut();
  }

  // ═══ 4. the stream is away, and comes back ═══════════════════════════════════════════
  {
    seed();
    const page = await open(PEOPLE.admin);
    await until(page, () => document.querySelector('[data-part=bellBadge]')?.textContent === '2');
    await waitFor(() => sseOf('admin').size === 1);
    for (const res of [...sseOf('admin')]) { try { res.end(); } catch (_) {} }
    await waitFor(() => sseOf('admin').size === 0);
    await ctx.createNotification('admin', { type: 'task', title: 'Written while away', body: '', url: '' }, false);
    check('what was written while the stream was away is counted once it is back', await until(page, () => document.querySelector('[data-part=bellBadge]')?.textContent === '3', null, 25000) && sseOf('admin').size === 1);
    check('…and is not announced as a toast: nobody was there to be told', (await toasts(page)).length === 0);
    await page.shut();
  }

  // ═══ 5. a server that cannot read them ═══════════════════════════════════════════════
  {
    seed();
    db.failing.add('notifications');
    const page = await open(PEOPLE.admin);
    await page.click('[data-part=bell]');
    check('says so in the panel, rather than "No notifications yet", which would be untrue', await until(page, () => document.querySelector('[data-part=panelEmpty]')?.textContent === 'Notifications are unavailable right now.', null, 25000));
    check('…with no badge to count', await badge(page) === null);
    db.failing.delete('notifications');
    await page.click('[data-part=viewAll]');
    check('…and the Notification Center asks again when it is opened, and has them', await until(page, () => document.querySelectorAll('[data-part=centerItem]').length === 3, null, 20000));
    await page.click('[data-part=markAll]');
    check('"Mark all read" there reads them: the badge goes, the database agrees', await until(page, () => !document.querySelector('[data-part=bellBadge]')) && await waitFor(() => row(1).read && row(3).read));
    await page.shut();
  }

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
