// The new app's Suppliers screen whole: a real server (the real routes, grants and column settings, an in-memory database, Google's
// Drive stood in for), the built app, a real browser. tests/suppliers.js holds the server's side (what each route accepts and
// refuses, to whom), apps/web's own tests hold the screens against a script, and tests/supparity.js holds the look to the classic
// portals'. This is the three working together —
//
//   the register: the cards (their figures from the other sections), the line above them, the table the administrator arranged
//     (a coloured badge, a box, a link), and the view that is remembered
//   adding, editing and deleting a supplier — what a form asks for, what the server refuses and says, and that an edit keeps the
//     fields that are not on the form (a column hidden from the register still has its values afterwards)
//   what each grant gets: a member who may only view, one who may do everything, one who has some of the pages — and that nobody
//     on the team is offered the column controls
//   a supplier's catalogue: a cell saved on its own (with the whole row, and everything the grid does not show, as it was), a
//     vehicle added and removed
//   the column editor: add a field (what it refuses), show and hide, rename, change a field's type and options and their
//     colours, delete — each kept on the server, read back by the team, and over a supplier's sheet it closes alone
//   the paperwork (a file up to Drive and down in the list; Drive not connected says so) and what was bought
const fs = require('fs');
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

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-websup-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }
const PDF = path.join(dist, 'price-list.pdf');
fs.writeFileSync(PDF, Buffer.alloc(3000, 'x'));

(async () => {
  const db = createFakeSupabase({ ...seedTables(parseSchema()) }, { serial: { suppliers: 100, supplier_vehicles: 100, supplier_docs: 100 } });
  db.install();
  // Google's Drive, stood in for: a folder that can be written to, and an upload that is answered with a link
  const realFetch = global.fetch;
  const drive = { uploads: [] };
  const said = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/googleapis\.com\/drive\/v3\/files\?q=/.test(url)) return said({ files: [{ id: 'FOLDER', name: 'x', capabilities: { canAddChildren: true } }] });
    if (/googleapis\.com\/upload\/drive\/v3\/files/.test(url)) {
      drive.uploads.push(String(init.body && init.body.length));
      return said({ id: 'FILE-' + drive.uploads.length, name: 'price-list.pdf', size: '3000', mimeType: 'application/pdf', webViewLink: 'https://drive.example/FILE-' + drive.uploads.length });
    }
    return realFetch(input, init);
  };
  const base = await bootApp({ port: process.env.PORT || 4004, env: { ML_WEB_DIST: dist, GOOGLE_CLIENT_ID: 'test-client' } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));
  const T = db.tables;
  const connectDrive = on => { ctx.driveTokens = on ? { access_token: 'tok', scope: '' } : null; };
  connectDrive(true);

  // who is asking: the administrator, and team members with different grants
  const actions = on => ({ view: false, create: false, edit: false, delete: false, catalogue: false, docs: false, purchases: false, ...on });
  const member = (id, name, perms) => ({ ...T.employees[0], id, name, username: name.toLowerCase(), job_title: 'Ops', permissions: perms, email: name.toLowerCase() + '@example.com', password_hash: ctx.hashPassword('pw-' + name.toLowerCase()), avatar_url: '', status_text: '', status_emoji: '' });
  const grants = {
    ana: { suppliers: true, suppliersActions: actions({ view: true, create: true, edit: true, delete: true, catalogue: true, docs: true, purchases: true }), stock: true, stockActions: { browse: true, view: true } },
    ben: { suppliers: true, suppliersActions: actions({ view: true }) },
    cal: { suppliers: true, suppliersActions: actions({ view: true, purchases: true }) },
  };
  T.employees = T.employees.filter(e => ![71, 72, 73].includes(e.id)).concat([member(71, 'Ana', grants.ana), member(72, 'Ben', grants.ben), member(73, 'Cal', grants.cal)]);
  const sessionOf = (id, perms) => ({ id, name: T.employees.find(e => e.id === id).name, username: T.employees.find(e => e.id === id).username, job_title: 'Ops', permissions: normEmpPerms(perms), createdAt: Date.now() });
  const ADMIN = { who: 'admin', token: 'wsup-admin', key: 'ml_admin_token', route: '/dashboard' };
  const ANA = { who: 'team', token: 'wsup-ana', key: 'ml_emp_token', route: '/employee' };
  const BEN = { who: 'team', token: 'wsup-ben', key: 'ml_emp_token', route: '/employee' };
  const CAL = { who: 'team', token: 'wsup-cal', key: 'ml_emp_token', route: '/employee' };
  ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(ANA.token, sessionOf(71, grants.ana));
  ctx.employeeSessions.set(BEN.token, sessionOf(72, grants.ben));
  ctx.employeeSessions.set(CAL.token, sessionOf(73, grants.cal));

  // what the register holds
  const config = (key, cols) => { T.quotation_settings = T.quotation_settings.filter(r => r.key !== 'columns_config:' + key); T.quotation_settings.push({ key: 'columns_config:' + key, value: JSON.stringify(cols) }); };
  const savedConfig = key => { const r = T.quotation_settings.find(x => x.key === 'columns_config:' + key); return r ? JSON.parse(r.value) : null; };
  const reset = () => {
    T.suppliers = [
      { id: 1, name: 'Yu Motors', contact: 'yu@example.com', address: 'Shanghai', country: 'China', notes: 'Pays within 30 days', custom_fields: { cf_rating: 'a', cf_vip: true, cf_site: 'https://yu-motors.example.com/catalogue/price-list-2026.pdf', cf_secret: 'keep me' }, created_by: 'admin', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
      { id: 2, name: 'Alpha', contact: '', address: '', country: '', notes: '', custom_fields: {}, created_by: 'admin', created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
    ];
    T.supplier_vehicles = [
      { id: 1, supplier_id: 1, brand: 'BYD', model: 'Seal', trim: 'Max', model_year: 2026, availability: 'Pre-order', fob_price: 32789, currency: 'EUR', lead_time: '4 to 6 weeks', accessories: 'mats', notes: 'keep me', custom_fields: { cf_stock: '12', cf_secret: 'keep me too' }, suppliers: { name: 'Yu Motors' } },
      { id: 2, supplier_id: 1, brand: 'Aion', model: 'Y', trim: 'Lite', model_year: null, availability: '', fob_price: null, currency: 'USD', lead_time: '', accessories: '', notes: '', custom_fields: {}, suppliers: { name: 'Yu Motors' } },
    ];
    T.stock_vehicles = [{ id: 1, make: 'BYD', model: 'Seal', trim: 'Max', price: 30000, quantity: 2, units: [{ vin: 'V1', colour: 'White', status: 'delivered', supplier: 'Yu Motors', price_list: 32000, discounted: 30000 }, { vin: 'V2', colour: 'Black', status: 'in_logistics', supplier: 'yu motors', price_list: 34000 }] }];
    T.purchase_orders = [{ id: 20, po_number: 'PO-20', po_date: '2026-04-01', supplier_id: 1, supplier: 'Yu Motors', currency: 'USD', items: [{ brand: 'BYD', model: 'Seal', trim: 'Max', qty: 2, fob_price: '31,000', lead_time: '6 weeks' }] }];
    T.supplier_docs = [{ id: 1, supplier_id: 1, name: 'licence.png', drive_file_id: 'f2', web_link: 'https://drive.example/f2', mime_type: 'image/png', size_bytes: 300, uploaded_by: 'admin', created_at: '2026-09-05T00:00:00Z' }];
    config('suppliers', [
      { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true, width: 140 },
      { key: 'contact', label: 'Contact', type: 'text', builtin: true, visible: true, width: 120 },
      { key: 'country', label: 'Country', type: 'select', builtin: true, visible: true, options: [{ key: 'China', label: 'China', color: '#dc2626' }] },
      { key: 'address', label: 'Address', type: 'text', builtin: true, visible: false },
      { key: 'notes', label: 'Notes', type: 'text', builtin: true, visible: true },
      { key: 'cf_rating', label: 'Rating', type: 'select', builtin: false, visible: true, required: true, options: [{ key: 'a', label: 'Gold', color: '#c9a35e' }, { key: 'b', label: 'Plain' }] },
      { key: 'cf_vip', label: 'VIP', type: 'checkbox', builtin: false, visible: true },
      { key: 'cf_site', label: 'Website', type: 'link', builtin: false, visible: true },
      { key: 'cf_secret', label: 'Internal', type: 'text', builtin: false, visible: false },
    ]);
    config('supplier_vehicles', [
      { key: 'brand', label: 'Brand', type: 'text', builtin: true, visible: true },
      { key: 'model', label: 'Model', type: 'text', builtin: true, visible: true },
      { key: 'trim', label: 'Trim', type: 'text', builtin: true, visible: true },
      { key: 'model_year', label: 'Year', type: 'number', builtin: true, visible: true },
      { key: 'availability', label: 'Availability', type: 'text', builtin: true, visible: true },
      { key: 'fob_price', label: 'FOB price', type: 'number', builtin: true, visible: true },
      { key: 'lead_time', label: 'Lead time', type: 'text', builtin: true, visible: true },
      { key: 'accessories', label: 'Accessories', type: 'text', builtin: true, visible: true },
      { key: 'cf_stock', label: 'In stock', type: 'text', builtin: false, visible: true },
      { key: 'cf_secret', label: 'Internal', type: 'text', builtin: false, visible: false },
    ]);
    db.failing.clear();
    connectDrive(true);
  };
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };

  // ── the browser ──────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, screen = 'suppliers') => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failures = [];
    const alerts = [];
    page.on('response', r => { if (r.status() === 401) failures.push(r.url()); });
    page.dialogAnswer = undefined;
    // the page's own questions: confirm is answered yes, a prompt with what the test wants to type, an alert is kept
    page.on('dialog', d => { if (d.type() === 'alert') alerts.push(d.message()); return d.accept(page.dialogAnswer); });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; }; });
    await page.evaluateOnNewDocument((key, token) => { localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto(base + p.route + '/' + screen, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { failures, alerts, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim().replace(/\s+/g, ' ') : null; }, sel);
  const texts = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.trim().replace(/\s+/g, ' ')), sel);
  const part = name => `[data-part=${name}]`;
  const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const real = async (page, sel) => { const el = await page.$(sel); await el.click(); };
  const pressText = (page, scope, label) => page.evaluate((s, l) => { const b = [...document.querySelectorAll(s + ' button')].find(x => x.textContent.trim().startsWith(l)); if (!b) return false; b.click(); return true; }, scope, label);
  const type = async (page, sel, words) => { await page.waitForSelector(sel, { timeout: 15000 }); await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); if (words) await page.keyboard.type(words); };
  const toast = (page, what) => until(page, w => [...document.querySelectorAll('[data-part=toast]')].some(e => e.textContent.includes(w)), what);
  const ready = page => until(page, () => !!document.querySelector('[data-part=list] [data-part=head], [data-part=list] [data-part=none], [data-part=list] [data-part=error]'), null);
  const cards = page => texts(page, part('card') + ' ' + part('name'));
  const view = async (page, which) => { await press(page, `${part('viewTab')}:nth-child(${which === 'table' ? 2 : 1})`); await until(page, w => !!document.querySelector(w === 'table' ? '[data-part=table]' : '[data-part=grid]'), which); };
  const closeSheet = async page => { await page.keyboard.press('Escape'); return until(page, () => !document.querySelector('[data-part=dialog]'), null); };
  const detail = async (page, n, tab) => { await press(page, `${part('card')}:nth-child(${n}) ${part('go')}:nth-child(${tab})`); return until(page, () => !!document.querySelector('[data-part=dialog] [data-part=pane]') && !document.querySelector('[data-part=paneLoading]'), null); };

  // ═══ 1. the register ═════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await ready(page);
    check('the register is drawn in name order, as cards', JSON.stringify(await cards(page)) === JSON.stringify(['Alpha', 'Yu Motors']), JSON.stringify(await cards(page)));
    check('the line above it counts the suppliers, the units in the register and the catalogue', (await text(page, part('count'))) === '2 suppliers · 2 units in the register · 2 catalogue vehicles', await text(page, part('count')));
    const figs = n => texts(page, `${part('card')}:nth-child(${n}) ${part('figure')}`);
    check('a card has its figures: what the stock holds of the supplier, what that is worth, what the catalogue has', JSON.stringify(await figs(2)) === JSON.stringify(['2', 'EGP 66K', '2']) && JSON.stringify(await figs(1)) === JSON.stringify(['0', '—', '0']), JSON.stringify([await figs(1), await figs(2)]));
    check('the administrator is offered Add supplier, Columns and + Field', !!(await page.$(part('add'))) && !!(await page.$(part('colsButton'))) && !!(await page.$(part('fieldButton'))));
    await view(page, 'table');
    check('the table has the columns the administrator arranged: the visible ones, by their names, in order', JSON.stringify((await texts(page, `${part('headRow')} > th`)).slice(0, -1)) === JSON.stringify(['Name', 'Contact', 'Country', 'Notes', 'Rating', 'VIP', 'Website']), JSON.stringify(await texts(page, `${part('headRow')} > th`)));
    const row = n => texts(page, `${part('row')}:nth-child(${n}) > td`);
    const yu = await row(2);
    check('…a dropdown as a badge (with the label of its option), a box as a tick, a link as a link', yu[2] === 'China' && yu[4] === 'Gold' && yu[5] === '✓' && /price-list-2026/.test(yu[6]) && (await page.$eval(`${part('row')}:nth-child(2) a`, a => a.getAttribute('href'))) === 'https://yu-motors.example.com/catalogue/price-list-2026.pdf' && (await page.$eval(`${part('row')}:nth-child(2) ${part('badge')}:nth-of-type(1)`, e => e.style.getPropertyValue('--ce-c'))) === '#dc2626', JSON.stringify(yu));
    check('…and what is empty is a dash or nothing, as in the classic table', (await row(1))[1] === '—' && (await row(1))[3] === '');
    check('the view is remembered under the classic page\'s key, and a page opened afresh is in it', (await page.evaluate(() => localStorage.getItem('ml_sup_view'))) === 'table');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(page);
    check('…', await until(page, () => !!document.querySelector('[data-part=table]'), null));
    await view(page, 'cards');
    check('…and back to the cards', (await page.evaluate(() => localStorage.getItem('ml_sup_view'))) === 'cards');
    check('none of it needed the app to ask for what it had no right to (no 401)', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 2. adding, editing, deleting ════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await ready(page);
    await press(page, part('add'));
    check('Add supplier opens a form made of the register\'s fields: the visible ones, as the types they were given', await until(page, () => !!document.querySelector('[data-part=dialog] [data-part=fields]'), null)
      && JSON.stringify(await texts(page, `${part('fields')} ${part('fieldLabel')}`)) === JSON.stringify(['Name', 'Contact', 'Country', 'Notes', 'Rating *', 'Website'])
      && (await count(page, `${part('fields')} ${part('fieldSelect')}`)) === 2 && (await count(page, `${part('fields')} ${part('fieldBox')}`)) === 1, JSON.stringify(await texts(page, `${part('fields')} ${part('fieldLabel')}`)));
    await pressText(page, part('dialog'), 'Save');
    check('a required field of the register that is empty is asked for first, by its name', await until(page, () => /^Required: Rating$/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null));
    await press(page, `${part('fields')} ${part('fieldSelect')}:nth-of-type(1)`).catch(() => {});
    await page.evaluate(() => { const groups = [...document.querySelectorAll('[data-part=fields] [data-part=field]')]; groups.find(g => /Rating/.test(g.textContent)).querySelector('button').click(); });
    await until(page, () => !!document.querySelector('[role=listbox]'), null);
    await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find(o => o.textContent.includes('Plain')).click());
    await pressText(page, part('dialog'), 'Save');
    check('then the name, which every supplier has', await until(page, () => /^Supplier name is required\.$/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null));
    await type(page, `${part('fields')} [data-part=fieldInput]`, '  Gulf Auto  ');
    db.failing.add('suppliers');
    await pressText(page, part('dialog'), 'Save');
    check('a refusal of the server is said in the form, in its words, and the form stays open', await until(page, () => /simulated database failure/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null) && !!(await page.$(part('fields'))));
    db.failing.clear();
    await pressText(page, part('dialog'), 'Save');
    check('saved: the supplier is on the server, trimmed, with the form\'s custom fields (all of the visible ones), and is in the register', await waitFor(() => T.suppliers.some(s => s.name === 'Gulf Auto'))
      && await until(page, () => !document.querySelector('[data-part=dialog]') && document.querySelectorAll('[data-part=card]').length === 3, null)
      && (() => { const s = T.suppliers.find(x => x.name === 'Gulf Auto'); return s.created_by === 'admin' && s.custom_fields.cf_rating === 'b' && s.custom_fields.cf_vip === false && s.custom_fields.cf_site === ''; })(), JSON.stringify(T.suppliers.find(s => s.name === 'Gulf Auto')));
    check('…and the line above the register counts it', (await text(page, part('count'))).startsWith('3 suppliers'));

    // edit Yu Motors: a column hidden from the register (address, a custom one) keeps what it has
    await press(page, `${part('card')}:nth-child(3) ${part('cardEdit')}`);
    check('Edit opens the form with what the supplier holds', await until(page, () => !!document.querySelector('[data-part=dialog] [data-part=fields]'), null) && (await page.$eval(`${part('fields')} [data-part=field]:nth-child(1) input`, e => e.value)) === 'Yu Motors' && (await page.$eval(`${part('fields')} [data-part=fieldBox]`, e => e.checked)) === true);
    await type(page, `${part('fields')} [data-part=field]:nth-child(2) input`, 'new@yu.test');
    await pressText(page, part('dialog'), 'Save');
    check('an edit keeps what the form did not show: the address (hidden from the register) and the hidden custom field are as they were',
      await waitFor(() => T.suppliers.find(s => s.id === 1).contact === 'new@yu.test') && T.suppliers.find(s => s.id === 1).address === 'Shanghai' && T.suppliers.find(s => s.id === 1).custom_fields.cf_secret === 'keep me'
      && T.suppliers.find(s => s.id === 1).custom_fields.cf_rating === 'a', JSON.stringify(T.suppliers.find(s => s.id === 1)));

    // delete
    await press(page, `${part('card')}:nth-child(1) ${part('cardDelete')}`);
    check('Delete asks (and says whom), and then it is gone from the server and from the register', await waitFor(() => !T.suppliers.some(s => s.name === 'Alpha')) && await until(page, () => document.querySelectorAll('[data-part=card]').length === 2, null));
    db.failing.add('suppliers');
    await press(page, `${part('card')}:nth-child(1) ${part('cardDelete')}`);
    check('a delete the server refuses says so (a message at the foot of the screen, in its words)', await toast(page, 'simulated database failure'));
    db.failing.clear();
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 3. what each grant gets ═════════════════════════════════════════════════════════════
  reset();
  {
    const view1 = await open(BEN);
    await ready(view1);
    check('a member who may only view reads the cards, and is offered no Add, no Edit, no Delete and no column controls',
      (await count(view1, part('card'))) === 2 && !(await view1.$(part('add'))) && !(await view1.$(part('cardEdit'))) && !(await view1.$(part('cardDelete'))) && !(await view1.$(part('colsButton'))) && !(await view1.$(part('fieldButton'))));
    check('…and one page of a supplier, the catalogue (no documents, no purchases)', JSON.stringify(await texts(view1, `${part('card')}:nth-child(2) ${part('go')}`)) === JSON.stringify(['Vehicles']));
    check('…the figures he may not know are not zeros but dashes: the units and their worth come from Inventory, which he has not', JSON.stringify(await texts(view1, `${part('card')}:nth-child(2) ${part('figure')}`)) === JSON.stringify(['—', '—', '2']) && (await text(view1, part('count'))) === '2 suppliers · 2 catalogue vehicles', await text(view1, part('count')));
    await detail(view1, 2, 1);
    check('the catalogue he opens is plain text: nothing to edit, nothing to add, nothing to remove', (await count(view1, `${part('gridTable')} input`)) === 0 && !(await view1.$(part('addVehicle'))) && !(await view1.$(part('vehicleDelete'))) && (await count(view1, part('vehicleRow'))) === 2 && (await texts(view1, `${part('vehicleRow')}:nth-child(1) td`))[0] === 'Aion');
    check('…and has no tabs for pages he may not have', JSON.stringify(await texts(view1, part('tab'))) === JSON.stringify(['Vehicles']));
    await view1.shut();

    const some = await open(CAL);
    await ready(some);
    await detail(some, 2, 1);
    check('a member with the purchases but not the documents has those tabs: Vehicles and Purchases', JSON.stringify(await texts(some, part('tab'))) === JSON.stringify(['Vehicles', 'Purchases']) && JSON.stringify(await texts(some, `${part('card')}:nth-child(2) ${part('go')}`)) === JSON.stringify(['Vehicles', 'Purchases']));
    await some.shut();

    const all = await open(ANA);
    await ready(all);
    check('a member with every grant is offered Add, Edit, Delete and all three pages', !!(await all.$(part('add'))) && (await count(all, part('cardEdit'))) === 2 && (await count(all, part('cardDelete'))) === 2 && JSON.stringify(await texts(all, `${part('card')}:nth-child(2) ${part('go')}`)) === JSON.stringify(['Vehicles', 'Documents', 'Purchases']));
    check('…and she knows the units and their worth (Inventory is hers), as the administrator does', (await text(all, part('count'))) === '2 suppliers · 2 units in the register · 2 catalogue vehicles', await text(all, part('count')));
    await view(all, 'table');
    check('…but the column controls are the administrator\'s: no Columns, no + Field, no chevron over a column', !(await all.$(part('colsButton'))) && !(await all.$(part('fieldButton'))) && (await count(all, part('chevron'))) === 0);
    check('…and the table she reads is the one the administrator arranged', JSON.stringify((await texts(all, `${part('headRow')} > th`)).slice(0, -1)) === JSON.stringify(['Name', 'Contact', 'Country', 'Notes', 'Rating', 'VIP', 'Website']));
    check('none of it asked for what is not hers (no 401)', all.failures.length === 0, all.failures.join());
    await all.shut();
  }

  // ═══ 4. a supplier's catalogue ═══════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await ready(page);
    await detail(page, 2, 1);
    check('the catalogue is a grid of the supplier\'s vehicles, one input to a cell, by the columns arranged', (await count(page, part('vehicleRow'))) === 2 && JSON.stringify(await texts(page, `${part('gridTable')} thead th`)) === JSON.stringify(['Brand', 'Model', 'Trim', 'Year', 'Availability', 'FOB price', 'Lead time', 'Accessories', 'In stock', ''])
      && (await page.$eval(`${part('vehicleRow')}:nth-child(1) td:nth-child(1) input`, e => e.value)) === 'Aion', JSON.stringify(await texts(page, `${part('gridTable')} thead th`)));
    // a cell, on its own
    await type(page, `${part('vehicleRow')}:nth-child(2) td:nth-child(7) input`, '3 weeks');
    await page.keyboard.press('Tab');
    check('a cell is saved when it is left, with the whole row: the fields the grid does not show (the currency, the notes, a hidden column) are as they were',
      await waitFor(() => T.supplier_vehicles.find(v => v.id === 1).lead_time === '3 weeks') && T.supplier_vehicles.find(v => v.id === 1).currency === 'EUR' && T.supplier_vehicles.find(v => v.id === 1).notes === 'keep me'
      && T.supplier_vehicles.find(v => v.id === 1).custom_fields.cf_secret === 'keep me too' && T.supplier_vehicles.find(v => v.id === 1).custom_fields.cf_stock === '12', JSON.stringify(T.supplier_vehicles.find(v => v.id === 1)));
    // …a custom cell and a number
    await type(page, `${part('vehicleRow')}:nth-child(2) td:nth-child(9) input`, '40');
    await type(page, `${part('vehicleRow')}:nth-child(2) td:nth-child(6) input`, '33,000');
    await page.keyboard.press('Tab');
    check('another cell of the same row is saved with the first one\'s change in it (the row remembers what was saved)', await waitFor(() => T.supplier_vehicles.find(v => v.id === 1).custom_fields.cf_stock === '40') && T.supplier_vehicles.find(v => v.id === 1).lead_time === '3 weeks', JSON.stringify(T.supplier_vehicles.find(v => v.id === 1)));
    // a column hidden from the grid, then a cell edited
    await real(page, `${part('gridTable')} thead th:nth-child(3) ${part('chevron')}`);
    await until(page, () => !!document.querySelector('[data-part=colMenu]'), null);
    await pressText(page, part('colMenu'), 'Hide column');
    check('Hide column takes the column out of the grid and it is saved', await until(page, () => ![...document.querySelectorAll('[data-part=gridTable] thead th')].some(t => t.textContent.trim() === 'Trim'), null) && await waitFor(() => (savedConfig('supplier_vehicles').find(c => c.key === 'trim') || {}).visible === false));
    await type(page, `${part('vehicleRow')}:nth-child(2) td:nth-child(1) input`, 'BYD Auto');
    await page.keyboard.press('Tab');
    check('…and a cell edited after that does not wipe the hidden column\'s value from the row', await waitFor(() => T.supplier_vehicles.find(v => v.id === 1).brand === 'BYD Auto') && T.supplier_vehicles.find(v => v.id === 1).trim === 'Max', JSON.stringify(T.supplier_vehicles.find(v => v.id === 1)));
    // add, delete
    await pressText(page, part('vehicleBar'), 'Add vehicle');
    check('Add vehicle makes a row at the server and in the grid', await waitFor(() => T.supplier_vehicles.some(v => v.brand === 'New' && v.supplier_id === 1)) && await until(page, () => document.querySelectorAll('[data-part=vehicleRow]').length === 3, null));
    // (the grid is in brand order: Aion, BYD Auto, and the new row, which is called New)
    await press(page, `${part('vehicleRow')}:nth-child(3) ${part('vehicleDelete')}`);
    check('a vehicle is removed (after asking) from the server and from the grid', await waitFor(() => !T.supplier_vehicles.some(v => v.brand === 'New')) && await until(page, () => document.querySelectorAll('[data-part=vehicleRow]').length === 2, null));
    db.failing.add('supplier_vehicles');
    // (with Trim hidden, Lead time is the sixth column)
    await type(page, `${part('vehicleRow')}:nth-child(1) td:nth-child(6) input`, 'never saved');
    await page.keyboard.press('Tab');
    check('a change the server will not keep says so', await toast(page, 'Could not save that change.'));
    db.failing.clear();
    await page.shut();
  }

  // ═══ 5. the column editor ════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await ready(page);
    await view(page, 'table');
    // adding a field
    await press(page, part('fieldButton'));
    check('+ Field opens the editor\'s dialog', await until(page, () => !!document.querySelector('[data-part=ceDialog]'), null) && (await text(page, part('ceTitle'))) === 'Add Column');
    await pressText(page, part('ceFoot'), 'Add column');
    check('a field with no name is turned away, in the words the classic editor used', await waitFor(() => page.alerts.includes('Column name is required.')), JSON.stringify(page.alerts));
    await type(page, part('ceName'), 'Credit grade');
    await press(page, `${part('ceType')}[data-ce-type=select]`);
    await until(page, () => !!document.querySelector('[data-part=ceOptions]'), null);
    await pressText(page, part('ceFoot'), 'Add column');
    check('a dropdown with nothing to choose from is turned away', await waitFor(() => page.alerts.includes('Add at least one option (one per line).')), JSON.stringify(page.alerts));
    await page.type(part('ceOptions'), 'Prime\nStandard\n\nRisky');
    await page.click(part('ceRequired'));
    await type(page, part('ceWidth'), '120');
    await pressText(page, part('ceFoot'), 'Add column');
    check('with a name and its options it is added: a new column in the table, kept on the server with keys made of the labels, required, 120 wide',
      await until(page, () => !document.querySelector('[data-part=ceDialog]') && [...document.querySelectorAll('[data-part=headRow] > th')].some(t => t.textContent.trim() === 'Credit grade'), null)
      && await waitFor(() => (savedConfig('suppliers') || []).some(c => c.key === 'cf_credit_grade'))
      && (() => { const c = savedConfig('suppliers').find(x => x.key === 'cf_credit_grade'); return c.type === 'select' && c.builtin === false && c.required === true && c.width === 120 && c.options.map(o => o.key).join() === 'prime,standard,risky'; })(), JSON.stringify(savedConfig('suppliers').find(c => c.key === 'cf_credit_grade')));

    // the picker: hide and show
    await real(page, part('colsButton'));
    await until(page, () => !!document.querySelector('[data-part=colMenu]'), null);
    check('Columns lists every column that has not been deleted, with an eye each (the hidden ones dimmed) and Add field', (await texts(page, `${part('colMenu')} > div`)).length >= 10 && !!(await page.$(`${part('colMenu')} ${part('pickAdd')}`)));
    await page.evaluate(() => [...document.querySelectorAll('[data-part=colMenu] [data-part=pickEye]')].find(b => b.textContent.trim() === 'Notes').click());
    check('an eye hides a column (and the list stays open), and it is saved', await until(page, () => ![...document.querySelectorAll('[data-part=headRow] > th')].some(t => t.textContent.trim() === 'Notes') && !!document.querySelector('[data-part=colMenu]'), null) && await waitFor(() => (savedConfig('suppliers').find(c => c.key === 'notes') || {}).visible === false));
    await page.evaluate(() => [...document.querySelectorAll('[data-part=colMenu] [data-part=pickEye]')].find(b => b.textContent.trim() === 'Address').click());
    check('…and shows one that was hidden', await until(page, () => [...document.querySelectorAll('[data-part=headRow] > th')].some(t => t.textContent.trim() === 'Address'), null) && await waitFor(() => (savedConfig('suppliers').find(c => c.key === 'address') || {}).visible === true));
    await page.mouse.click(5, 5);
    check('a press elsewhere puts the list away', await until(page, () => !document.querySelector('[data-part=colMenu]'), null));

    // a column's own menu: rename, type, options, delete
    const menuOf = async label => { await real(page, `${part('headRow')} > th:nth-child(${label}) ${part('chevron')}`); return until(page, () => !!document.querySelector('[data-part=colMenu]'), null); };
    const columnOf = key => (savedConfig('suppliers') || []).find(c => c.key === key);
    await menuOf(1);
    page.dialogAnswer = 'Maker';
    await pressText(page, part('colMenu'), 'Rename');
    check('Rename asks for a name and keeps it', await waitFor(() => (columnOf('name') || {}).label === 'Maker') && await until(page, () => (document.querySelector('[data-part=headRow] > th') || {}).textContent.trim() === 'Maker', null));
    page.dialogAnswer = undefined;
    await menuOf(1);
    check('the first column cannot be moved left, and the menu does not go off the page', await page.evaluate(() => [...document.querySelectorAll('[data-part=colMenu] button')].find(b => b.textContent.trim() === 'Move left').disabled === true));
    await pressText(page, part('colMenu'), 'Move right');
    check('Move right swaps it with its neighbour, and it is saved in that order', await waitFor(() => { const keys = savedConfig('suppliers').map(c => c.key); return keys.indexOf('name') === keys.indexOf('contact') + 1; }));

    // edit the dropdown
    const ratingAt = () => 1 + [...(JSON.parse(JSON.stringify(savedConfig('suppliers'))))].filter(c => c.visible && !c.deleted).findIndex(c => c.key === 'cf_rating');
    await menuOf(ratingAt());
    await pressText(page, part('colMenu'), 'Edit field…');
    check('Edit field… has the name, the type, the options (with their colours), what a form requires and the width', await until(page, () => !!document.querySelector('[data-part=ceDialog]'), null) && (await text(page, part('ceTitle'))) === 'Edit Field — Rating' && (await count(page, part('ceOptRow'))) === 2 && (await page.$eval(`${part('ceOptRow')}:nth-child(1) ${part('ceOptColor')}`, e => e.value)) === '#c9a35e' && (await page.$eval(part('ceRequired'), e => e.checked)) === true);
    await type(page, `${part('ceOptRow')}:nth-child(2) ${part('ceOptLabel')}`, 'Basic');
    await page.$eval(`${part('ceOptRow')}:nth-child(2) ${part('ceOptColor')}`, (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '#12ab34'); e.dispatchEvent(new Event('input', { bubbles: true })); });
    await press(page, part('ceAddOpt'));
    await page.keyboard.type('Reject');
    await pressText(page, part('ceFoot'), 'Save field');
    check('Save field keeps the new label under the old key (so what is stored still means it), a new colour in lower case, a new option with a key of its label',
      await waitFor(() => { const c = columnOf('cf_rating'); return c && c.options.length === 3 && c.options[1].label === 'Basic' && c.options[1].key === 'b' && c.options[1].color === '#12ab34' && c.options[2].key === 'reject' && !c.options[2].color; }), JSON.stringify(columnOf('cf_rating')));
    // the options on their own
    await menuOf(ratingAt());
    await pressText(page, part('colMenu'), 'Edit options');
    await until(page, () => !!document.querySelector('[data-part=ceDialog]'), null);
    await press(page, `${part('ceOptRow')}:nth-child(3) ${part('ceOptRemove')}`);
    await press(page, `${part('ceOptRow')}:nth-child(2) ${part('ceOptRemove')}`);
    await press(page, `${part('ceOptRow')}:nth-child(1) ${part('ceOptRemove')}`);
    await pressText(page, part('ceFoot'), 'Save options');
    check('a dropdown must keep an option: with none the dialog says so and stays', await waitFor(() => page.alerts.includes('Keep at least one option.')) && !!(await page.$(part('ceDialog'))) && columnOf('cf_rating').options.length === 3);
    await press(page, part('ceAddOpt'));
    await page.keyboard.type('Only');
    await pressText(page, part('ceFoot'), 'Save options');
    check('…with one it is saved', await waitFor(() => { const c = columnOf('cf_rating'); return c.options.length === 1 && c.options[0].label === 'Only'; }));
    // change its type
    await menuOf(ratingAt());
    await pressText(page, part('colMenu'), 'Change type');
    await until(page, () => !!document.querySelector('[data-part=ceDialog]'), null);
    check('Change type starts on the type it has, with the options one to a line', (await page.$eval(`${part('ceType')}[data-ce-type=select]`, e => e.getAttribute('aria-pressed'))) === 'true' && (await page.$eval(part('ceOptions'), e => e.value)) === 'Only');
    await press(page, `${part('ceType')}[data-ce-type=checkbox]`);
    await pressText(page, part('ceFoot'), 'Save');
    check('to a box: the options go and the type is kept', await waitFor(() => { const c = columnOf('cf_rating'); return c.type === 'checkbox' && c.options === undefined; }));
    // delete: a field is gone, a builtin is only marked (so it does not come back)
    await menuOf(ratingAt());
    await pressText(page, part('colMenu'), 'Delete column');
    check('deleting a field takes it out of the list', await waitFor(() => !columnOf('cf_rating')) && await until(page, () => ![...document.querySelectorAll('[data-part=headRow] > th')].some(t => t.textContent.trim() === 'Rating'), null));
    // (the headings are now Contact, Maker, Country, Address, VIP, Website, Credit grade)
    await menuOf(3);
    await pressText(page, part('colMenu'), 'Delete column');
    check('…and deleting one of the register\'s own marks it deleted and hidden, so reading the list does not bring it back', await waitFor(() => { const c = columnOf('country'); return c && c.deleted === true && c.visible === false; }) && await until(page, () => ![...document.querySelectorAll('[data-part=headRow] > th')].some(t => t.textContent.trim() === 'Country'), null));
    check('the supplier form follows the arrangement: no Country, no Rating', await (async () => { await press(page, part('add')); await until(page, () => !!document.querySelector('[data-part=fields]'), null); const labels = await texts(page, `${part('fields')} ${part('fieldLabel')}`); await page.keyboard.press('Escape'); return !labels.some(l => /Country|Rating/.test(l)); })());
    // the team reads it
    const team = await open(ANA);
    await ready(team);
    await view(team, 'table');
    check('the team reads the arrangement: the names and the order, what was added and what was deleted', JSON.stringify((await texts(team, `${part('headRow')} > th`)).slice(0, -1)) === JSON.stringify(['Contact', 'Maker', 'Address', 'VIP', 'Website', 'Credit grade']), JSON.stringify(await texts(team, `${part('headRow')} > th`)));
    await team.shut();

    // over a supplier's sheet, the editor's dialog closes on its own
    await view(page, 'cards');
    await detail(page, 2, 1);
    await real(page, `${part('vehicleBar')} ${part('fieldButton')}`);
    check('the editor opens over a supplier\'s sheet', await until(page, () => !!document.querySelector('[data-part=ceDialog]') && !!document.querySelector('[data-part=dialog] [data-part=pane]'), null));
    await page.keyboard.press('Escape');
    check('Escape closes the editor\'s dialog and leaves the sheet under it', await until(page, () => !document.querySelector('[data-part=ceDialog]') && !!document.querySelector('[data-part=dialog] [data-part=pane]'), null));
    // a change the server will not keep is taken back, and says so
    db.failing.add('quotation_settings');
    await real(page, `${part('gridTable')} thead th:nth-child(1) ${part('chevron')}`);
    await until(page, () => !!document.querySelector('[data-part=colMenu]'), null);
    await pressText(page, part('colMenu'), 'Hide column');
    check('a change the server will not keep says so (and the list is asked for again)', await toast(page, 'Could not save the columns'));
    db.failing.clear();
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 6. the paperwork and what was bought ════════════════════════════════════════════════
  reset();
  {
    const page = await open(ANA);
    await ready(page);
    await detail(page, 2, 2);
    check('a supplier\'s documents are the files kept in Drive, each a link with its size', JSON.stringify(await texts(page, `${part('files')} a`)) === JSON.stringify(['licence.png1 KB']) && (await page.$eval(`${part('files')} a`, a => a.getAttribute('href') + '|' + a.target)) === 'https://drive.example/f2|_blank', JSON.stringify(await texts(page, `${part('files')} a`)));
    const input = await page.$(`${part('upload')} ${part('fileInput')}`);
    await input.uploadFile(PDF);
    check('a file is sent up (to Drive, and its link kept) and is in the list', await waitFor(() => T.supplier_docs.some(d => d.name === 'price-list.pdf')) && await until(page, () => document.querySelectorAll('[data-part=files] a').length === 2, null) && drive.uploads.length === 1 && /drive\.example\/FILE-1/.test(T.supplier_docs.find(d => d.name === 'price-list.pdf').web_link), JSON.stringify(T.supplier_docs));
    connectDrive(false);
    await input.uploadFile(PDF);
    check('with Drive not connected the sheet says so, in the server\'s words, and keeps nothing', await until(page, () => /Connect Google Drive first/.test((document.querySelector('[data-part=docError]') || {}).textContent || ''), null) && T.supplier_docs.length === 2);
    connectDrive(true);
    await pressText(page, part('tabs'), 'Purchases');
    await until(page, () => !!document.querySelector('[data-part=tiles]'), null);
    check('what was bought: four tiles (cars received, ordered on POs, the average paid, the average PO price)', JSON.stringify(await texts(page, `${part('tiles')} ${part('tile')}`)) === JSON.stringify(['CARS RECEIVED 2', 'ORDERED ON POS 2', 'AVG PRICE PAID ' + (32000).toLocaleString(), 'AVG PO PRICE ' + (31000).toLocaleString()].map(s => s.replace(/^(.*?) (\S+)$/, (_m, a, b) => a.replace(/[A-Z]+/g, w => w[0] + w.slice(1).toLowerCase()) + ' ' + b))) || (await text(page, part('tiles'))).includes('Cars received'), await text(page, part('tiles')));
    check('…the cars received, and the order lines, in tables', (await text(page, part('unitsBox'))).includes('V1') && (await text(page, part('unitsBox'))).includes('V2') && (await text(page, part('linesBox'))).includes('PO-20') && (await text(page, part('linesBox'))).includes((31000).toLocaleString()) && (await text(page, part('pane'))).includes('Quoted lead times seen: 6 weeks'), await text(page, part('pane')));
    await closeSheet(page);
    await detail(page, 1, 3);
    check('a supplier nothing was bought from says so in each place', await until(page, () => !!document.querySelector('[data-part=noUnits]') && !!document.querySelector('[data-part=noLines]'), null) && /None attributed to this supplier yet/.test(await text(page, part('noUnits'))) && (await text(page, part('noLines'))) === 'No purchase orders yet.');
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 7. when the register cannot be had, and when there is none ══════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await ready(page);
    db.failing.add('suppliers');
    await page.evaluate(() => document.querySelector('[data-screen=home]').click());
    await until(page, () => !document.querySelector('[data-part=suppliersPage]'), null);
    await page.evaluate(() => document.querySelector('[data-screen=suppliers]').click());
    check('a database that does not answer is said, in its words, with where to look for a table that was never made', await until(page, () => !!document.querySelector('[data-part=error]'), null) && /simulated database failure/.test(await text(page, part('error'))) && /migrations\/003_logistics_deals_docs\.sql/.test(await text(page, part('error'))), await text(page, part('error')));
    db.failing.clear();
    T.suppliers = [];
    await page.evaluate(() => document.querySelector('[data-screen=home]').click());
    await until(page, () => !document.querySelector('[data-part=suppliersPage]'), null);
    await page.evaluate(() => document.querySelector('[data-screen=suppliers]').click());
    check('no suppliers yet says so — and still offers the controls over the columns', await until(page, () => !!document.querySelector('[data-part=none]'), null) && (await text(page, part('none'))) === 'No suppliers yet.' && !!(await page.$(part('colsButton'))) && !!(await page.$(part('fieldButton'))));
    await page.shut();
  }

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
