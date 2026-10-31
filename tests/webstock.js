// The new app's Inventory & Logistics screen whole: a real server (the real routes, grants, column settings and CSV importer), the
// built app, a real browser. tests/stockroutes.js and tests/containerroutes.js hold the server's side (what each route accepts and
// refuses, to whom, and the shape of every answer), apps/web's own tests hold the screen against a script, and tests/stparity.js
// holds the look to the classic portals'. This is the three working together —
//
//   the register: the figures over it, a row for each car, the views (by status, by model), narrowing, grouping and searching
//   a model added, changed (what the form does not show is kept) and deleted; what is refused; the administrator's bulk upload
//   the boxes: the board, a look-up of a number that is not tracked and the form it leads to, a box changed, a car put in and
//     taken out, a refresh, and a box deleted (the administrator's alone)
//   what each grant gets, in the team's page: browse, add, change, follow the containers; and the deep links of both portals
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath, pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();
// The settings of a real carrier are the operator's, not the test's: whatever is in this machine's environment, nothing is configured.
for (const k of ['AIS_TRACKING_HEADER', 'AIS_TRACKING_KEY', 'AIS_TRACKING_NAME', 'AIS_TRACKING_URL', 'CONTAINER_TRACKING_AUTH_PREFIX', 'CONTAINER_TRACKING_FILTER',
  'CONTAINER_TRACKING_HEADER', 'CONTAINER_TRACKING_KEY', 'CONTAINER_TRACKING_NAME', 'CONTAINER_TRACKING_PROVIDER', 'CONTAINER_TRACKING_URL', 'SAFECUBE_BASE_URL',
  'SAFECUBE_ENDPOINT_ID', 'SAFECUBE_SEALINE', 'SAFECUBE_WEBHOOK_BASE_URL', 'TERMINAL49_WEBHOOK_SECRET', 'TRACKING_WEBHOOK_SECRET', 'TERMINAL49_API_KEY', 'SAFECUBE_API_KEY']) delete process.env[k];

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-webstock-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }
// what the bulk upload sends: a good row (a model with one car) and a row with no make
const CSV_FILE = path.join(dist, 'vehicles.csv');
fs.writeFileSync(CSV_FILE, 'make,model,trim,price,units,notes\nKia,Sportage,GT,1500000,KIA00000000000001:Black:in_logistics,Fresh in\n,Nameless,Base,100,,\n');

(async () => {
  const now = () => new Date().toISOString();
  const db = createFakeSupabase({ ...seedTables(parseSchema()), stock_vehicles: [], shipment_containers: [], container_vehicles: [] }, {
    serial: { stock_vehicles: 100, shipment_containers: 100, notifications: 100 },
    defaults: {
      stock_vehicles: () => ({ trim: '', price: 0, quantity: 0, notes: '', units: [], created_by: 'dashboard', updated_at: now() }),
      shipment_containers: () => ({
        container_type: '', bl_number: '', carrier: '', status: 'in_transit', latest_move: '', vessel_name: '', vessel_imo: '', pol_code: '', pol_name: '',
        pod_code: '', pod_name: '', moves: [], supplier: '', notes: '', source: 'manual', raw: {}, created_by: 'dashboard', updated_at: now(),
      }),
      container_vehicles: () => ({ linked_at: now(), linked_by: '' }),
    },
  });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 4013, env: { ML_WEB_DIST: dist } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));
  const T = db.tables;

  // who is asking: the administrator, and team members with different grants
  const grants = on => ({ view: false, browse: false, create: false, edit: false, tracking: false, ...on });
  const only = on => ({ stock: true, stockActions: grants(on) });
  const perms = {
    ana: only({ view: true, browse: true, create: true, edit: true, tracking: true }),
    ben: only({ view: true, browse: true }),
    eli: only({ view: true, browse: true, create: true }),
    dee: only({ view: true, browse: true, tracking: true }),
    cy: { stock: false, stockActions: grants({}) },
  };
  const member = (id, name, p) => ({ ...T.employees[0], id, name, username: name.toLowerCase(), job_title: 'Ops', permissions: p, email: name.toLowerCase() + '@example.com', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), avatar_url: '', status_text: '', status_emoji: '' });
  T.employees = T.employees.filter(e => ![81, 82, 83, 84, 85].includes(e.id)).concat([
    member(81, 'Ana', perms.ana), member(82, 'Ben', perms.ben), member(83, 'Eli', perms.eli), member(84, 'Dee', perms.dee), member(85, 'Cy', perms.cy)]);
  const sessionOf = (id, p) => ({ id, name: T.employees.find(e => e.id === id).name, username: T.employees.find(e => e.id === id).username, job_title: 'Ops', permissions: normEmpPerms(p), createdAt: Date.now() });
  const ADMIN = { who: 'admin', token: 'wst-admin', key: 'ml_admin_token', route: '/dashboard' };
  const member_ = (token, id, p) => ({ who: 'team', token, key: 'ml_emp_token', route: '/employee', id, p });
  const ANA = member_('wst-ana', 81, perms.ana), BEN = member_('wst-ben', 82, perms.ben), ELI = member_('wst-eli', 83, perms.eli), DEE = member_('wst-dee', 84, perms.dee), CY = member_('wst-cy', 85, perms.cy);
  ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const m of [ANA, BEN, ELI, DEE, CY]) ctx.employeeSessions.set(m.token, sessionOf(m.id, m.p));

  // what the screen holds
  const unit = over => ({ consignee: '', colour: '', vin: '', status: 'send_to_supplier', price_list: 0, discounted: 0, logistics: '', supplier: '', ...over });
  const car = (id, make, model, trim, price, units, over = {}) => ({ id, make, model, trim, price, quantity: units.length, notes: '', legacy_count: null, units, created_by: 'dashboard', created_at: '2026-09-0' + id + 'T10:00:00Z', updated_at: '2026-09-0' + id + 'T10:00:00Z', ...over });
  const box = (id, no, over = {}) => ({ id, container_no: no, container_type: '', bl_number: '', carrier: '', status: 'in_transit', latest_move: '', latest_move_at: null, pod_eta: null, vessel_name: '', vessel_imo: '', pol_code: '', pol_name: '', pod_code: '', pod_name: '', atd: null, eta: null, moves: [], po_id: null, supplier: '', notes: '', source: 'manual', last_synced_at: null, raw: {}, created_by: 'dashboard', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z', ...over });
  const reset = () => {
    T.stock_vehicles = [
      car(1, 'BYD', 'Seal', 'Design', 1950000, [unit({ vin: 'LGXC76C41P0123456', colour: 'White / Black', status: 'in_logistics', price_list: 1950000, supplier: 'BYD', consignee: 'Hany' }), unit({ vin: 'LGXC76C41P0123457', colour: 'Grey', status: 'delivered', supplier: 'BYD' })], { notes: 'Immediate delivery' }),
      car(2, 'Toyota', 'Corolla', 'GLI 1.6', 1150000, [], { legacy_count: 3 }),
      car(3, 'BYD', 'Atto 3', '', 0, [unit({ vin: 'LGXC76C41P0123458', colour: 'Red', status: 'in_preparation', price_list: 800000 })]),
    ];
    T.shipment_containers = [
      box(1, 'CSQU3054383', { container_type: "40' HIGH CUBE", carrier: 'MSC', latest_move: 'Vessel departure', pod_eta: '2026-11-20', vessel_name: 'MSC AURORA', vessel_imo: '9876543', pol_code: 'CNSHA', pol_name: 'Shanghai', pod_code: 'EGALY', pod_name: 'Alexandria', atd: '2026-08-01T00:00:00.000Z', eta: '2036-01-01T00:00:00.000Z' }),
      box(2, 'MSKU9070327', { status: 'arrived' }),
    ];
    T.container_vehicles = [{ container_id: 1, vin: 'LGXC76C41P0123456' }];
    T.quotation_settings = T.quotation_settings.filter(r => !/^columns_config:stock/.test(r.key));
    db.failing.clear();
  };
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };

  // ── the browser ──────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, screen = 'stock') => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failures = [];
    const asked = [];
    page.on('response', r => { if (r.status() === 401) failures.push(r.url()); });
    page.on('request', r => { if (/\/api\//.test(r.url())) asked.push(r.method() + ' ' + new URL(r.url()).pathname); });
    page.questions = [];
    // the page's own questions: confirm is answered yes (and kept), an alert is kept
    page.on('dialog', d => { page.questions.push(d.message()); return d.accept(); });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; }; });
    await page.evaluateOnNewDocument((key, token) => { localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); try { localStorage.removeItem('ml_stock_view'); } catch (_) {} }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto(base + p.route + '/' + screen, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { failures, asked, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const part = name => `[data-part=${name}]`;
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim().replace(/\s+/g, ' ') : null; }, sel);
  const texts = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(el => el.textContent.trim().replace(/\s+/g, ' ')), sel);
  const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
  const has = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const type = async (page, sel, words) => { await page.waitForSelector(sel, { timeout: 15000 }); await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); if (words) await page.keyboard.type(words); };
  const toast = (page, what) => until(page, w => [...document.querySelectorAll('[data-part=toast]')].some(e => e.textContent.includes(w)), what);
  const registerReady = page => until(page, () => !!document.querySelector('[data-part=register] [data-part=views], [data-part=register] [data-part=error]'), null);
  const sheetOpen = page => until(page, () => !!document.querySelector('[data-part=dialog]'), null);
  const sheetGone = page => until(page, () => !document.querySelector('[data-part=dialog]'), null);
  const unitRows = page => page.evaluate(() => [...document.querySelectorAll('[data-part=register] [data-part=unitRow]')].map(r => [...r.children].map(c => c.textContent.trim().replace(/\s+/g, ' '))));
  const SEARCH = 'input[placeholder^="Search make"]';
  const editRowOf = (page, vin) => page.evaluate(v => { const r = [...document.querySelectorAll('[data-part=unitRow]')].find(x => x.textContent.includes(v)); r.querySelector('[data-part=rowEdit]').click(); }, vin);
  const cardOf = (page, name) => page.evaluate(n => { const c = [...document.querySelectorAll('[data-part=modelCard]')].find(x => x.querySelector('[data-part=modelTitle]').textContent.replace(/\s+/g, ' ').trim().startsWith(n)); return c ? c.textContent.replace(/\s+/g, ' ').trim() : null; }, name);
  const tabNumber = n => `${part('tabs')} > :nth-child(${n})`;
  const boardReady = page => until(page, () => !!document.querySelector('[data-part=containers] [data-part=board], [data-part=containers] [data-part=nothing], [data-part=containers] [data-part=error]'), null);
  const boxes = page => page.evaluate(() => [...document.querySelectorAll('[data-part=board] [data-part=container]')].map(c => [c.querySelector('[data-part=ctStatus]').textContent.trim(), c.querySelectorAll('[data-part=ctValue]')[0].textContent.trim()]));
  const cell = (r, c) => `${part('dialog')} [data-part=form] ${part('gridRow')}:nth-child(${r}) ${part('gridCell')}:nth-child(${c}) input`;
  const choose = async (page, trigger, label) => { await press(page, trigger); await until(page, () => !!document.querySelector('[role=option]'), null); await page.evaluate(l => [...document.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === l).click(), label); };

  // ═══ 1. the register ═════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await registerReady(page);
    const rows = await unitRows(page);
    const seal = rows.find(r => r.includes('LGXC76C41P0123456')) || [];
    check('All vehicles has a row for each car, with its model and trim first, and Edit last',
      rows.length === 3 && rows.every(r => r[r.length - 1] === '') && /^BYD Seal ?Design/.test(seal[0]) && rows.some(r => /Atto 3/.test(r[0])), JSON.stringify(rows));
    check('…the cars\' own words in the columns: consignee, colour, VIN, status by its label, price list',
      seal.includes('Hany') && seal.some(c => /White \/ Black/.test(c)) && seal.some(c => /In Logistics/i.test(c)) && seal.some(c => /1,950,000/.test(c)), JSON.stringify(seal));
    check('the figures over it: how many cars, how many models, what the register is worth, and the 3 cars an older save counted and nobody named',
      (await text(page, part('mixCount'))) === '3' && /3 models/.test(await text(page, part('mixSide'))) && /3 units are unmatched/.test(await text(page, part('notice'))), `${await text(page, part('mixCount'))} · ${await text(page, part('mixSide'))} · ${await text(page, part('notice'))}`);
    check('the page says what it is, and offers the administrator the bulk upload and a new model', (await text(page, part('pageTitle'))) === 'Inventory & Logistics' && !!(await has(page, part('csv'))) && !!(await has(page, part('add'))));

    await type(page, SEARCH, 'atto');
    check('searching narrows the cars by make, model, trim or VIN', await until(page, () => document.querySelectorAll('[data-part=unitRow]').length === 1, null) && /Atto 3/.test((await unitRows(page))[0][0]));
    await type(page, SEARCH, 'LGXC76C41P0123457');
    check('…a VIN finds its car', await until(page, () => document.querySelectorAll('[data-part=unitRow]').length === 1, null) && (await unitRows(page))[0].includes('LGXC76C41P0123457'));
    await type(page, SEARCH, '');
    await until(page, () => document.querySelectorAll('[data-part=unitRow]').length === 3, null);

    await press(page, `${part('views')} > :nth-child(2)`);
    check('By status draws a lane for each state with its cars, its value and its share',
      await until(page, () => !!document.querySelector('[data-part=board]'), null) && (await count(page, part('lane'))) >= 3 && (await texts(page, part('laneCard'))).length === 3, String(await count(page, part('lane'))));
    await press(page, `${part('views')} > :nth-child(3)`);
    check('By model draws a card for each model, its cars inside and its notes',
      await until(page, () => document.querySelectorAll('[data-part=modelCard]').length === 3, null) && /Immediate delivery/.test(await cardOf(page, 'BYD Seal') || '') && /LGXC76C41P0123456/.test(await cardOf(page, 'BYD Seal') || ''), await text(page, part('modelGrid')));
    check('…and the view is remembered across a visit', await page.evaluate(() => /model/.test(JSON.stringify(Object.assign({}, localStorage)))), '');
    await press(page, `${part('views')} > :nth-child(1)`);
    await until(page, () => document.querySelectorAll('[data-part=unitRow]').length === 3, null);

    await press(page, part('filter'));
    await until(page, () => !!document.querySelector('[role=option]'), null);
    await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find(o => /Delivered/i.test(o.textContent)).click());
    check('Filter narrows the cars to a status and the chip says which; the chip takes it away',
      await until(page, () => document.querySelectorAll('[data-part=unitRow]').length === 1, null) && /Delivered/i.test(await text(page, part('chip')) || '') && (await press(page, part('chip')), await until(page, () => document.querySelectorAll('[data-part=unitRow]').length === 3, null)));
    await press(page, part('groupBy'));
    check('Group puts the cars under their suppliers, the cars of none together', await until(page, () => document.querySelectorAll('[data-part=supplierGroup]').length === 2, null), String(await count(page, part('supplierGroup'))));
    await press(page, part('groupBy'));
    check('none of it needed the app to ask for what it had no right to (no 401)', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 2. a model added, changed, deleted ═══════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await registerReady(page);
    await press(page, part('add'));
    check('Add model opens an empty form with no cars until one is asked for', await sheetOpen(page) && (await page.$eval('#stk-make', e => e.value)) === '' && (await count(page, part('gridRow'))) === 0);
    await press(page, part('save'));
    check('a form with no make or model is turned away in the classic page\'s words, and nothing is sent',
      await until(page, () => /Make and Model are required/i.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null) && T.stock_vehicles.length === 3, await text(page, part('formError')));
    await type(page, '#stk-make', ' Kia ');
    await type(page, '#stk-model', 'Sportage');
    await type(page, '#stk-trim', 'GT');
    await type(page, '#stk-price', '1500000');
    await press(page, part('addUnit'));
    await until(page, () => document.querySelectorAll('[data-part=gridRow]').length === 1, null);
    await type(page, cell(1, 4), 'kia00000000000001');
    await type(page, cell(1, 3), 'Black');
    await press(page, part('save'));
    check('Save keeps the model on the server: the words trimmed, the car\'s VIN in capitals, its colour, a count of one',
      await waitFor(() => T.stock_vehicles.length === 4), String(T.stock_vehicles.length));
    const made = T.stock_vehicles.find(r => r.id > 3) || {};
    check('…under its make and model, with its trim and price, and one car with that VIN and colour',
      made.make === 'Kia' && made.model === 'Sportage' && made.trim === 'GT' && Number(made.price) === 1500000 && made.quantity === 1 && made.units.length === 1 && made.units[0].vin === 'KIA00000000000001' && made.units[0].colour === 'Black', JSON.stringify(made));
    check('the sheet goes and the register has it', await sheetGone(page) && await until(page, () => document.querySelectorAll('[data-part=unitRow]').length === 4, null));

    // change one: the cars it holds, and what the form does not show
    T.stock_vehicles.find(r => r.id === 1).units[0].secret = 'keep me';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await registerReady(page);
    await editRowOf(page, 'LGXC76C41P0123456');
    check('Edit opens the model with its words and its cars', await sheetOpen(page) && await until(page, () => document.querySelectorAll('[data-part=gridRow]').length === 2, null) && (await page.$eval('#stk-model', e => e.value)) === 'Seal');
    await type(page, '#stk-trim', 'Design Plus');
    await page.evaluate(() => document.querySelector('[data-part=gridRow]:nth-child(2) [data-part=gridRemove]').click());
    await until(page, () => document.querySelectorAll('[data-part=gridRow]').length === 1, null);
    await press(page, part('save'));
    const saved = () => T.stock_vehicles.find(r => r.id === 1);
    check('saving changes the trim, takes the car away and recounts', await waitFor(() => saved().trim === 'Design Plus') && saved().units.length === 1 && saved().quantity === 1, JSON.stringify(saved()));
    check('…and keeps the model\'s notes, which the form shows, and the car\'s words it does not', saved().notes === 'Immediate delivery' && saved().units[0].vin === 'LGXC76C41P0123456' && saved().units[0].price_list === 1950000, JSON.stringify(saved().units));

    // delete
    await sheetGone(page);
    // (a save asks for the register again, and the page gives way to the loader while it does: its views are there again in a moment)
    await registerReady(page);
    await press(page, `${part('views')} > :nth-child(3)`);
    await until(page, () => document.querySelectorAll('[data-part=modelCard]').length === 4, null);
    const before = T.stock_vehicles.length;
    await press(page, `${part('modelCard')}:nth-child(1) ${part('cardDelete')}`);
    check('Delete asks, and takes the model away from the server', await waitFor(() => T.stock_vehicles.length === before - 1) && page.questions.some(q => /Delete/i.test(q)), page.questions.join(' | '));
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 3. the administrator's bulk upload ═════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await registerReady(page);
    await press(page, part('csv'));
    check('Bulk upload opens a sheet with the columns, a sample to start from (under the administrator\'s own token) and a file box',
      await sheetOpen(page) && /make, model, trim/.test(await text(page, part('csvForm'))) && /\/api\/dashboard\/stock\/template\.csv\?_t=wst-admin/.test(await page.$eval(part('template'), a => a.getAttribute('href'))));
    await press(page, part('upload'));
    check('Upload with no file says so', await until(page, () => /Please choose a CSV file\./.test((document.querySelector('[data-part=csvResult]') || {}).textContent || ''), null));
    const input = await page.$(part('csvFile'));
    await input.uploadFile(CSV_FILE);
    await press(page, part('upload'));
    check('a file with a good row and a bad one says how many went in and why the other did not',
      await until(page, () => /Imported 1 vehicle/.test((document.querySelector('[data-part=csvResult]') || {}).textContent || ''), null) && /make/i.test(await text(page, part('csvResult'))), await text(page, part('csvResult')));
    const kia = T.stock_vehicles.find(r => r.make === 'Kia') || {};
    check('…the good row is on the server with its car', T.stock_vehicles.length === 4 && kia.model === 'Sportage' && kia.units.length === 1 && kia.units[0].vin === 'KIA00000000000001' && kia.units[0].status === 'in_logistics', JSON.stringify(kia));
    check('…and the register has it behind the sheet', await until(page, () => document.querySelectorAll('[data-part=unitRow]').length === 4, null));
    await page.shut();
  }

  // ═══ 4. the boxes ═══════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await registerReady(page);
    await press(page, tabNumber(2));
    check('the Tracking tab draws a card for each box: its state, its number, and the ship and the leg where it has them', await boardReady(page) && JSON.stringify(await boxes(page)) === JSON.stringify([['In transit', 'CSQU3054383'], ['Arrived', 'MSKU9070327']]), JSON.stringify(await boxes(page)));
    check('…the voyage of the first, and none for the second', /MSC AURORA/.test(await text(page, `${part('container')}:nth-child(1) ${part('voyage')}`)) && /No voyage recorded yet/.test(await text(page, `${part('container')}:nth-child(2) ${part('voyage')}`)));
    check('…the cars inside the first and none in the second', /LGXC76C41P0123456/.test(await text(page, `${part('container')}:nth-child(1) ${part('cars')}`)) && /No vehicles linked yet/.test(await text(page, `${part('container')}:nth-child(2) ${part('cars')}`)));

    // a number nobody tracks
    await type(page, '#logi-ct-search', 'abcu 123 4567');
    await press(page, part('track'));
    check('a number that is not tracked says so, in one sentence (no carrier is set up here), warns of its check digit and offers to start tracking it',
      await until(page, () => !!document.querySelector('[data-part=notTracked]'), null) && /ABCU1234567 is not tracked yet/.test(await text(page, part('notTrackedHead'))) && /Automatic lookup is not set up/.test(await text(page, part('why'))) && /Check digit should be 0/.test(await text(page, part('checkWarn'))) && !!(await has(page, part('start'))),
      await text(page, part('notTracked')));
    check('…and the number was written back cleanly', (await page.$eval('#logi-ct-search', e => e.value)) === 'ABCU1234567');
    await press(page, part('start'));
    check('Start tracking it opens the form with that number', await sheetOpen(page) && (await page.$eval('#ct-no', e => e.value)) === 'ABCU1234567' && /Track a container/.test(await text(page, '[data-part=dialog] [data-part=title]')));
    await type(page, `${part('boxForm')} > :nth-child(4) input`, 'MSC');
    await press(page, part('save'));
    check('Start tracking keeps the box on the server by hand, with the carrier typed, and the board has it', await waitFor(() => T.shipment_containers.length === 3), String(T.shipment_containers.length));
    const added = T.shipment_containers.find(r => r.container_no === 'ABCU1234567') || {};
    check('…the number, the carrier, a state of in transit, entered by hand', added.carrier === 'MSC' && added.status === 'in_transit' && added.source === 'manual', JSON.stringify(added));
    check('…and says so', await toast(page, 'Now tracking ABCU1234567') && await until(page, () => document.querySelectorAll('[data-part=board] [data-part=container]').length === 3, null));

    // change a box: only what is carried is written
    await press(page, `${part('container')}:nth-child(1) ${part('edit')}`);
    await sheetOpen(page);
    check('Edit opens the box under its number with what it holds', /Container CSQU3054383/.test(await text(page, '[data-part=dialog] [data-part=title]')) && (await page.$eval(`${part('boxForm')} > :nth-child(8) input`, e => e.value)) === 'MSC AURORA');
    await type(page, `${part('boxForm')} > :nth-child(4) input`, 'MAERSK');
    await press(page, part('save'));
    const first = () => T.shipment_containers.find(r => r.id === 1);
    check('saving changes the carrier and leaves the voyage as it was', await waitFor(() => first().carrier === 'MAERSK') && first().vessel_name === 'MSC AURORA' && first().pod_code === 'EGALY', JSON.stringify(first()));
    check('…and says so', await toast(page, 'Container updated.'));

    // a car in, a car out
    await sheetGone(page);
    await boardReady(page);
    await press(page, `${part('container')}:nth-child(2) ${part('link')}`);
    await sheetOpen(page);
    await press(page, part('carPick'));
    await until(page, () => document.querySelectorAll('[role=option]').length > 0, null);
    const offered = await texts(page, '[role=option]');
    check('Add vehicle offers the cars that are in no box (the one in a box is not offered again), each with its model and colour',
      offered.length === 2 && offered.some(o => /^LGXC76C41P0123457 · BYD Seal Design · Grey/.test(o)) && offered.some(o => /^LGXC76C41P0123458 · BYD Atto 3 · Red/.test(o)) && !offered.some(o => /LGXC76C41P0123456/.test(o)), JSON.stringify(offered));
    await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find(o => o.textContent.startsWith('LGXC76C41P0123457')).click());
    await press(page, part('add'));
    check('Add puts the car in the box on the server', await waitFor(() => T.container_vehicles.some(l => l.container_id === 2 && l.vin === 'LGXC76C41P0123457')), JSON.stringify(T.container_vehicles));
    check('…and the card shows it', await sheetGone(page) && await until(page, () => /LGXC76C41P0123457/.test((document.querySelector('[data-part=board] [data-part=container]:nth-child(2) [data-part=cars]') || {}).textContent || ''), null));
    await press(page, `${part('container')}:nth-child(2) ${part('unlink')}`);
    check('× takes it out again', await waitFor(() => !T.container_vehicles.some(l => l.container_id === 2)) && await until(page, () => /No vehicles linked yet/.test((document.querySelector('[data-part=board] [data-part=container]:nth-child(2) [data-part=cars]') || {}).textContent || ''), null));

    // the carrier asked again (none is set up here)
    page.asked.length = 0;
    await press(page, `${part('container')}:nth-child(1) ${part('refresh')}`);
    check('Refresh asks the server for that box and says what came of it', await waitFor(() => page.asked.includes('POST /api/dashboard/containers/1/refresh')) && await until(page, () => document.querySelectorAll('[data-part=toast]').length > 0, null), page.asked.join());

    // delete: the administrator's
    await press(page, `${part('container')}:nth-child(3) ${part('edit')}`);
    await sheetOpen(page);
    check('the box\'s form has a Delete in the administrator\'s page', !!(await has(page, part('delete'))));
    await press(page, part('delete'));
    check('Delete asks, and stops tracking the box (the cars inside it stay in the register)', await waitFor(() => T.shipment_containers.length === 2) && page.questions.some(q => /Stop tracking/i.test(q)) && T.stock_vehicles.length === 3, page.questions.join(' | '));
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 5. the team's page: the same screen, the member's own grants ═══════════════════════════
  reset();
  {
    const ana = await open(ANA);
    await registerReady(ana);
    check('the team sees the same register through its own routes, never the administrator\'s',
      (await unitRows(ana)).length === 3 && ana.asked.includes('GET /api/employee/stock') && !ana.asked.some(p => p.includes('/api/dashboard/')), JSON.stringify([...new Set(ana.asked)]));
    check('Ana (everything) has the new-model button, Edit on every row and both tabs; there is no bulk upload and no Delete in the team\'s page',
      !!(await has(ana, part('add'))) && (await count(ana, part('rowEdit'))) === 3 && (await count(ana, `${part('tabs')} > *`)) === 2 && !(await has(ana, part('csv'))));
    await press(ana, `${part('views')} > :nth-child(3)`);
    await until(ana, () => document.querySelectorAll('[data-part=modelCard]').length === 3, null);
    check('…nor a Delete on a model\'s card', !(await has(ana, part('cardDelete'))) && (await count(ana, part('cardEdit'))) === 3);
    await press(ana, tabNumber(2));
    await boardReady(ana);
    check('Ana can follow the containers: refresh, edit and Add vehicle on a card', (await count(ana, part('refresh'))) === 2 && (await count(ana, part('edit'))) === 2 && (await count(ana, part('link'))) === 2);
    await press(ana, `${part('container')}:nth-child(1) ${part('edit')}`);
    await sheetOpen(ana);
    check('…and the box\'s form has no Delete (the administrator\'s alone)', !(await has(ana, part('delete'))));
    check('none of it signed anybody out', ana.failures.length === 0, ana.failures.join());
    await ana.shut();

    const ben = await open(BEN);
    await registerReady(ben);
    check('Ben (browse only) sees the cars, with no new-model button, no Edit and no Tracking tab', (await unitRows(ben)).length === 3 && !(await has(ben, part('add'))) && (await count(ben, part('rowEdit'))) === 0 && (await count(ben, `${part('tabs')} > *`)) === 1);
    await ben.shut();

    const eli = await open(ELI);
    await registerReady(eli);
    check('Eli (browse and add) has the new-model button and no Edit and no Tracking tab', !!(await has(eli, part('add'))) && (await count(eli, part('rowEdit'))) === 0 && (await count(eli, `${part('tabs')} > *`)) === 1);
    await press(eli, part('add'));
    await sheetOpen(eli);
    await type(eli, '#stk-make', 'Nio');
    await type(eli, '#stk-model', 'ET5');
    await press(eli, part('save'));
    check('…and what Eli adds is kept on the server', await waitFor(() => T.stock_vehicles.some(r => r.make === 'Nio' && r.model === 'ET5')), String(T.stock_vehicles.length));
    await eli.shut();

    const dee = await open(DEE);
    await registerReady(dee);
    check('Dee (browse and follow the containers) has the Tracking tab and its buttons, and no new-model button', (await count(dee, `${part('tabs')} > *`)) === 2 && !(await has(dee, part('add'))));
    await press(dee, tabNumber(2));
    await boardReady(dee);
    check('…and the boxes through the team\'s own routes', (await boxes(dee)).length === 2 && dee.asked.includes('GET /api/employee/containers') && !dee.asked.some(p => p.includes('/api/dashboard/')), JSON.stringify(dee.asked));
    await dee.shut();

    const cy = await open(CY, 'home');
    check('Cy (no stock grant) has no Inventory in the menu', !(await has(cy, '[data-screen=stock]')));
    await cy.shut();
  }

  // ═══ 6. the page when the server cannot give the register ══════════════════════════════════
  reset();
  {
    db.failing.add('stock_vehicles');
    const page = await open(ADMIN);
    check('a register that could not be had says so in the server\'s words, in place of the cars', await until(page, () => !!document.querySelector('[data-part=register] [data-part=error]'), null) && (await text(page, `${part('register')} ${part('error')}`) || '').length > 0, await text(page, part('register')));
    db.failing.clear();
    await page.shut();
  }

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
