// The new app's service worker, end to end: a real browser (service workers and all), the built app, the real server.
//
// The worker is what lets the installed app start without a network, keep itself current without a reload prompt, show a push and
// take a tap on it to the right screen. It also shares a scope with the classic portal's own worker (/dashboard is both's, and
// /employee), so whichever portal's page was opened last is in charge; the two must be able to take turns without either
// emptying the other's caches or keeping the other's page. And it must never be the reason the app does not open.
//
// A small proxy stands between the browser and the server so the suite can take the network away (a worker's own requests
// fail too, which a browser's offline switch does not promise) and count what actually reached the server.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath } = require('./helpers/browser');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const only = process.env.PWA_ONLY ? new Set(process.env.PWA_ONLY.split(',')) : null;   // a mutation run needs only the part it can break
const wants = part => !only || only.has(part);

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-pwa-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }
const workerFile = path.join(dist, 'sw.js');
const builtWorker = fs.readFileSync(workerFile, 'utf8');
const BUILD_ID = (builtWorker.match(/`([0-9a-f]{10})`/) || [])[1];
const builtPage = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const jsFile = (builtPage.match(/src="(\/ui\/assets\/[^"]+\.js)"/) || [])[1];
const cssFile = (builtPage.match(/href="(\/ui\/assets\/[^"]+\.css)"/) || [])[1];

// The network, as the browser meets it: everything goes through here to the server, and can be cut.
function startProxy(target, port) {
  const to = new URL(target);
  const seen = [];
  const sockets = new Set();
  let down = false;
  const server = http.createServer((req, res) => {
    if (down) return req.socket.destroy();
    seen.push({ method: req.method, path: req.url });
    const up = http.request({ host: to.hostname, port: to.port, method: req.method, path: req.url, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => res.destroy());
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    base: 'http://127.0.0.1:' + port,
    seen,
    hits: (re) => seen.filter(s => re.test(s.path)).length,
    cut(v) { down = v; if (v) for (const s of sockets) s.destroy(); },
    close() { for (const s of sockets) s.destroy(); server.close(); },
  })));
}

(async () => {
  const db = createFakeSupabase(seedTables(parseSchema()));
  db.install();
  const appBase = await bootApp({ port: process.env.PORT || 3983, env: { ML_WEB_DIST: dist } });
  const net = await startProxy(appBase, Number(process.env.PROXY_PORT) || 3984);
  const base = net.base;
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));

  const SARA = { id: 31, name: 'Sara', title: 'Sales', raw: { leads: true, leadsActions: { view: true, edit: true }, deals: true, dealsActions: { view: true }, requests: true, requestsActions: { view: true } } };
  db.tables.employees = db.tables.employees.filter(e => e.id !== SARA.id).concat([{ ...db.tables.employees[0], id: SARA.id, name: SARA.name, username: 'sara', job_title: SARA.title, permissions: SARA.raw, email: 'sara@example.com' }]);
  const PORTALS = {
    admin: { name: 'admin', token: 'pwa-admin', key: 'ml_admin_token', route: '/dashboard', classic: '/legacy/dashboard', worker: '/sw-ui-dashboard.js', classicWorker: '/sw-dashboard.js', family: 'ml-ui-dashboard-', classicFamily: 'motolinker-dash-' },
    team: { name: 'team', token: 'pwa-sara', key: 'ml_emp_token', route: '/employee', classic: '/legacy/employee', worker: '/sw-ui-employee.js', classicWorker: '/sw-employee.js', family: 'ml-ui-employee-', classicFamily: 'motolinker-emp-' },
  };
  ctx.sessions.set(PORTALS.admin.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(PORTALS.team.token, { id: SARA.id, name: SARA.name, username: 'sara', job_title: SARA.title, permissions: normEmpPerms(SARA.raw), createdAt: Date.now() });

  // ── the browser ───────────────────────────────────────────────────────────────────────────
  // Every host but this machine is unreachable at once (fonts, icon libraries): nothing waits on the internet, and a font that
  // cannot be had must not matter to the worker.
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });

  const STUBS = () => {
    // (the classic pages draw their icons with lucide and their charts with Chart.js, both from a CDN)
    window.lucide = { createIcons() {} };
    window.Chart = function () { return { destroy() {}, update() {} }; };
  };
  // A fresh browser profile each time: its own workers, its own caches, its own storage.
  const visit = async (p, { url, next = true, signedIn = true, skew = false, context: joined } = {}) => {
    const context = joined || await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await context.overridePermissions(base, ['notifications']);
    await page.evaluateOnNewDocument(STUBS);
    await page.evaluateOnNewDocument((key, token) => { if (token) localStorage.setItem(key, token); }, p.key, signedIn ? p.token : '');
    if (skew) await page.evaluateOnNewDocument(() => {
      // a clock the suite can wind forward: what a page left open for hours sees
      const real = Date.now.bind(Date);
      window.__skew = 0;
      Date.now = () => real() + window.__skew;
    });
    if (next) await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 800 });
    if (url !== null) await page.goto(base + (url || p.route), { waitUntil: 'domcontentloaded' });
    return Object.assign(page, { context, errors, shut: async () => { await page.close(); if (!joined) await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg);
  // The worker in charge of the page's scope: its script, and whether it controls this page.
  const inCharge = page => page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { script: r && r.active ? new URL(r.active.scriptURL).pathname : null, scope: r ? new URL(r.scope).pathname : null, controller: navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : null };
  });
  const registrationState = page => page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    const one = w => w ? new URL(w.scriptURL).pathname + ':' + w.state : null;
    return r ? { installing: one(r.installing), waiting: one(r.waiting), active: one(r.active), controller: navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : null } : null;
  });
  const controlledBy = async (page, script) => {
    try { await until(page, s => navigator.serviceWorker.controller && new URL(navigator.serviceWorker.controller.scriptURL).pathname === s, script); }
    catch (e) { console.log('   (waiting for ' + script + '; registration: ' + JSON.stringify(await registrationState(page)) + '; errors: ' + JSON.stringify(page.errors) + ')'); throw e; }
  };
  const cachesOf = page => page.evaluate(async () => {
    const out = {};
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname + new URL(r.url).search);
    return out;
  });
  const shell = page => page.waitForSelector('[data-part=sidebar]', { timeout: 15000 });

  // ── 1. put in place ───────────────────────────────────────────────────────────────────────
  if (wants('place')) {
    for (const p of Object.values(PORTALS)) {
      const page = await visit(p);
      await controlledBy(page, p.worker);
      const state = await inCharge(page);
      check(`${p.name}: the app puts its worker in place, at its portal's scope, and the page it came with is in its charge`, state.script === p.worker && state.scope === p.route && state.controller === p.worker, JSON.stringify(state));
      const kept = await cachesOf(page);
      const names = Object.keys(kept);
      check(`${p.name}: its files are kept apart from every other worker's, under the name of this build`, names.length === 1 && names[0] === p.family + BUILD_ID, names.join());
      const files = kept[names[0]] || [];
      check(`${p.name}: the first load is kept — its script, its style and its page — and nothing that is loaded on demand`, files.includes(jsFile) && files.includes(cssFile) && files.includes(p.route) && !files.some(f => /Gallery/.test(f)), files.join());
      await shell(page);
      check(`${p.name}: the app opens as it always did, with a worker in charge`, page.errors.length === 0, page.errors.join(' | '));
      await page.shut();
    }
  }

  // ── 2. the network goes away ──────────────────────────────────────────────────────────────
  if (wants('offline')) {
    const p = PORTALS.admin;
    const page = await visit(p);
    await controlledBy(page, p.worker);
    await shell(page);
    // a screen is opened once with the network, as people do
    await page.goto(base + p.route + '/home', { waitUntil: 'domcontentloaded' });
    await shell(page);
    await page.evaluate(() => fetch('/manifest-dashboard.json').then(r => r.json()));     // (the install manifest, once, with the network)
    // (the files are cached by the browser for a year, so a page that had them could start without the worker: empty that)
    await (await page.createCDPSession()).send('Network.clearBrowserCache');
    net.cut(true);
    const opens = async (url) => {
      try { await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 8000 }); } catch (e) { return { failed: String(e.message).slice(0, 60) }; }
      return page.evaluate(() => ({ app: !!window.__ML__ && !!document.getElementById('root') && document.getElementById('root').children.length > 0, portal: window.__ML__ && window.__ML__.portal, title: document.title }));
    };
    const start = await opens(p.route);
    check('without a network the app still starts: its page and its files come from what the worker kept', start.app === true && start.portal === 'admin', JSON.stringify(start));
    const inside = await opens(p.route + '/leads');
    check('…at any address inside it, which is the same page', inside.app === true, JSON.stringify(inside));
    const kept = await page.evaluate(async () => {
      const manifest = await fetch('/manifest-dashboard.json').then(r => r.json(), () => null);
      const icon = await fetch('/icons/favicon.png').then(r => r.status, () => 0);
      return { start: manifest && manifest.start_url, icon };
    });
    check('…the install manifest and the icons are there too, as the last time they were had', kept.start === '/dashboard' && kept.icon === 200, JSON.stringify(kept));
    const api = await page.evaluate(() => fetch('/api/v1/me').then(r => 'answered ' + r.status, () => 'failed'));
    check('…and what the server alone can say is not kept for it: a call to the API fails, not answered from anywhere', api === 'failed', api);
    const classic = await opens(p.classic);
    check('…and the classic page, which is not the app\'s, is not made up: the browser says the network is gone', !!classic.failed, JSON.stringify(classic));
    net.cut(false);
    await page.shut();
  }


  // ── 3. the classic worker and this one take turns ─────────────────────────────────────────
  // Both hold /dashboard (and /employee): whichever page was opened last is the one in charge. Neither may empty the other's caches
  // when it takes over, and the classic worker may not keep the app's page as its own.
  if (wants('turns')) {
    for (const p of Object.values(PORTALS)) {
      const page = await visit(p);
      await controlledBy(page, p.worker);
      await shell(page);
      const ours = Object.keys(await cachesOf(page)).find(n => n.startsWith(p.family));
      const ourFiles = (await cachesOf(page))[ours];
      const isClassic = text => /href="\/assets\/[a-z-]+\.css/.test(text) && !/<div id="root">/.test(text);
      // every copy a cache holds of the portal's page, at whatever address it was asked for
      const pageKept = (name) => page.evaluate(async (n, route) => {
        const cache = await caches.open(n);
        const texts = [];
        for (const r of await cache.keys()) if (new URL(r.url).pathname === route) texts.push(await (await cache.match(r)).text());
        return texts;
      }, name, p.route);
      const allClassic = texts => texts.length > 0 && texts.every(isClassic);
      const allApp = texts => texts.length > 0 && texts.every(t => /<div id="root">/.test(t));

      await page.goto(base + p.route + '?ui=legacy', { waitUntil: 'domcontentloaded' });
      await controlledBy(page, p.classicWorker);
      const afterClassic = await cachesOf(page);
      const classicName = Object.keys(afterClassic).find(n => n.startsWith(p.classicFamily));
      check(`${p.name}: the classic page, opened after the app, takes over the scope with its own worker`, (await inCharge(page)).script === p.classicWorker);
      check(`${p.name}: …and the app\'s worker, which was in charge when the classic page was fetched, did not keep it as the app\'s page`, allApp(await pageKept(ours)));
      const holdsAll = (cached, files) => !!cached && files.every(f => cached.includes(f));
      check(`${p.name}: …and clearing out its own old caches leaves the app\'s alone: the app\'s files are all still there`, !!classicName && holdsAll(afterClassic[ours], ourFiles), Object.keys(afterClassic).join());
      check(`${p.name}: …and what it keeps of the page is the classic page`, allClassic(await pageKept(classicName)));

      // the switch is turned back without loading the app's page, so that the classic worker is still the one in charge of the visit
      await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
      await page.goto(base + p.route, { waitUntil: 'domcontentloaded' });
      await shell(page);
      await sleep(600);
      check(`${p.name}: the app, opened after the classic page, is not kept by the classic worker: what it has of the page is still the classic page`, allClassic(await pageKept(classicName)));
      await controlledBy(page, p.worker);
      const afterApp = await cachesOf(page);
      check(`${p.name}: …then the app puts its worker back in charge, and leaves the classic worker\'s caches as they were`, holdsAll(afterApp[classicName], afterClassic[classicName] || ['-']) && holdsAll(afterApp[ours], ourFiles), Object.keys(afterApp).join());
      await page.shut();
    }
  }

  // ── 4. a new build ────────────────────────────────────────────────────────────────────────
  // Found without a reload and without a prompt, when the page comes to the front after a while; in charge at once; the old
  // build's files gone; the other portal's untouched.
  if (wants('update')) {
    const p = PORTALS.admin;
    const page = await visit(p, { skew: true });
    await controlledBy(page, p.worker);
    await shell(page);
    const other = await visit(PORTALS.team, { context: page.context });
    await controlledBy(other, PORTALS.team.worker);
    const teamBefore = JSON.stringify(Object.entries(await cachesOf(other)).filter(([n]) => n.startsWith(PORTALS.team.family)));
    await page.evaluate(() => { window.__same = 'the same page'; });
    const names = async () => Object.keys(await cachesOf(page)).filter(n => n.startsWith(p.family));
    const first = await names();

    fs.writeFileSync(workerFile, builtWorker.replace(BUILD_ID, 'ffffffffff'));   // a new build is out
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await sleep(1500);
    check('a page that has only just opened does not go looking for a new build whenever it is looked at', JSON.stringify(await names()) === JSON.stringify(first), (await names()).join());

    await page.bringToFront();       // (it went to the back when the other portal's page was opened beside it)
    await page.evaluate(() => { window.__skew = 31 * 60 * 1000; document.dispatchEvent(new Event('visibilitychange')); });
    await until(page, (family) => caches.keys().then(ks => ks.some(k => k === family + 'ffffffffff') && !ks.some(k => k.startsWith(family) && k !== family + 'ffffffffff')), p.family);
    const after = await names();
    check('a page that has been open a while and comes to the front finds the new build: its files are kept under the new name, the old build\'s are gone', after.length === 1 && after[0] === p.family + 'ffffffffff', after.join());
    const kept = (await cachesOf(page))[after[0]] || [];
    check('…it is in charge at once, and the page was not reloaded', (await inCharge(page)).controller === p.worker && await page.evaluate(() => window.__same) === 'the same page');
    check('…with the first load kept again, ready for the next start', [jsFile, cssFile, p.route].every(f => kept.includes(f)), kept.join());
    check('…and the other portal\'s worker and files were not touched', JSON.stringify(Object.entries(await cachesOf(other)).filter(([n]) => n.startsWith(PORTALS.team.family))) === teamBefore);
    fs.writeFileSync(workerFile, builtWorker);
    await other.shut();
    await page.shut();
  }

  // ── 5. a page that was open while a new build went out ────────────────────────────────────
  if (wants('stale')) {
    const p = PORTALS.admin;
    const gallery = fs.readdirSync(path.join(dist, 'assets')).find(f => /^Gallery-.*\.js$/.test(f));
    fs.renameSync(path.join(dist, 'assets', gallery), path.join(dist, 'assets', gallery + '.away'));
    const page = await visit(p, { url: p.route + '/__gallery' });     // asks for a file the new build no longer has
    await sleep(4000);
    const loads = net.hits(/^\/dashboard\/__gallery$/);
    check('a page that asks for a file that is gone reloads itself, to get the build that has it — once, and not over and over', loads === 2, 'loads: ' + loads);
    fs.renameSync(path.join(dist, 'assets', gallery + '.away'), path.join(dist, 'assets', gallery));
    await page.shut();
  }

  // ── 6. a push, and a tap on it ────────────────────────────────────────────────────────────
  if (wants('push')) {
    const p = PORTALS.admin;
    const page = await visit(p, { url: p.route + '/home' });
    await controlledBy(page, p.worker);
    await shell(page);
    const target = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url() === base + p.worker && t.browserContext() === page.context, { timeout: 10000 });
    const worker = await target.worker();
    const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag, data: n.data })));
    const push = data => worker.evaluate(d => self.dispatchEvent(new PushEvent('push', d === undefined ? {} : { data: d })), data);
    const tap = () => worker.evaluate(async () => {
      const list = await self.registration.getNotifications();
      self.dispatchEvent(new NotificationEvent('notificationclick', { notification: list[list.length - 1] }));
    });
    const path_ = () => page.evaluate(() => location.pathname + location.search);

    await push(JSON.stringify({ title: 'New lead', body: 'Acme called', url: '/dashboard#customers' }));
    await until(page, async () => (await (await navigator.serviceWorker.ready).getNotifications()).length === 1);
    const first = (await shown())[0];
    check('a push is shown in the words it came with', first && first.title === 'New lead' && first.body === 'Acme called' && first.data.url === '/dashboard#customers', JSON.stringify(first));
    await tap();
    await until(page, () => location.pathname === '/dashboard/leads');
    check('…and a tap on it takes the open app to the screen it names, and the notification is put away', (await shown()).length === 0);
    check('…without a reload: it is the same page, moved', await page.evaluate(() => !!window.__ML__) && (await path_()) === '/dashboard/leads');

    await push(JSON.stringify({ senderName: 'Rana', body: 'On my way', roomId: 'room-7' }));
    await until(page, async () => (await (await navigator.serviceWorker.ready).getNotifications()).some(n => n.title === 'Rana'));
    const chat = (await shown()).find(n => n.title === 'Rana');
    check('a chat message is titled by who sent it, and tagged by its room, so a room\'s messages replace each other', chat && chat.tag === 'chat-room-room-7' && chat.data.roomId === 'room-7', JSON.stringify(chat));
    await tap();
    await until(page, () => location.pathname === '/dashboard/chat/room-7');
    check('…and a tap on that opens the room', true);

    const count = (await shown()).length;
    await push(); await push('not json at all'); await push('"a string"'); await push('[]');
    await sleep(800);
    check('a push that says nothing (none, or not JSON, or not a message) shows nothing, and does not hurt the worker', (await shown()).length === count && (await inCharge(page)).controller === p.worker);
    await page.shut();
  }

  // ── 7. what must never be in the way ──────────────────────────────────────────────────────
  if (wants('never')) {
    const p = PORTALS.admin;
    // …a worker that cannot be had
    fs.renameSync(workerFile, workerFile + '.away');
    const bare = await visit(p);
    await shell(bare);
    check('with no worker to be had the app opens all the same, without one', (await inCharge(bare)).controller === null && bare.errors.length === 0, JSON.stringify(bare.errors));
    await bare.shut();
    fs.renameSync(workerFile + '.away', workerFile);

    // …a worker loaded from an address that is not one of the two it is made for
    const inert = await visit(p, { url: '/ui/assets/' + jsFile.split('/').pop() });
    const odd = await inert.evaluate(async () => {
      const r = await navigator.serviceWorker.register('/ui/sw.js', { scope: '/ui/' });
      await new Promise(done => { const w = r.installing || r.waiting || r.active; if (!w || w.state === 'activated') return done(); w.addEventListener('statechange', () => w.state === 'activated' && done()); });
      return { active: !!r.active, caches: await caches.keys() };
    });
    check('a worker that finds itself at any other address does nothing: it starts, keeps nothing, and answers nothing', odd.active === true && odd.caches.length === 0, JSON.stringify(odd));
    await inert.shut();

    // …a browser that has gone back to the classic UI and opens an address inside the app: the server sends it to the classic page
    const sent = await visit(p);
    await controlledBy(sent, p.worker);
    await sent.setCookie({ name: 'ml_ui', value: 'legacy', url: base });
    await sent.goto(base + p.route + '/leads', { waitUntil: 'domcontentloaded' });
    const landed = await sent.evaluate(() => ({ at: location.pathname + location.hash, classic: !!document.getElementById('page-customers'), app: !!document.getElementById('root') }));
    check('an address inside the app, opened by a browser that has gone back to the classic UI, is sent on to the classic page — through the worker, which does not stand in the way', landed.at === '/dashboard#customers' && landed.classic && !landed.app, JSON.stringify(landed));
    await sent.shut();

    // …the server's own answers
    const page = await visit(p);
    await controlledBy(page, p.worker);
    await shell(page);
    const before = net.hits(/^\/api\/v1\/me$/);
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) await fetch('/api/v1/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('ml_admin_token') } }); });
    check('every call to the API reaches the server, however often it is made: none is answered by the worker', net.hits(/^\/api\/v1\/me$/) - before === 3, String(net.hits(/^\/api\/v1\/me$/) - before));

    // …the classic pages inside the app's frame
    const classicWorkerFetches = net.hits(/^\/sw-dashboard\.js/);
    await page.goto(base + p.route + '/leads', { waitUntil: 'domcontentloaded' });
    await until(page, () => document.querySelector('iframe[data-state=ready]'), null, 20000);
    const frame = page.frames().find(f => f.url().includes('/legacy/dashboard'));
    const guest = await frame.evaluate(async () => ({ controller: !!navigator.serviceWorker.controller, registration: !!(await navigator.serviceWorker.getRegistration()) }));
    check('the classic page in the app\'s frame is not under the worker, and starts none of its own', guest.controller === false && guest.registration === false && net.hits(/^\/sw-dashboard\.js/) === classicWorkerFetches, JSON.stringify(guest) + ' ' + (net.hits(/^\/sw-dashboard\.js/) - classicWorkerFetches));
    await page.shut();
  }

  // ── done ──────────────────────────────────────────────────────────────────────────────────
  await browser.close();
  net.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
