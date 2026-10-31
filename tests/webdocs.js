// The new app's RFQ and Purchase-orders screens whole: a real server (the real routes, grants, column settings and exports, an
// in-memory database), the built app, a real browser. tests/rfqpo.js holds the server's side (what each route accepts and
// refuses, to whom, and the shape of every answer), apps/web's own tests hold the screens against a script, and
// tests/docparity.js holds the look to the classic portals'. This is the three working together —
//
//   the lists: an RFQ and an order as a row (figures, badge, the buttons each grant gets), the empty and the failing page
//   a new RFQ and a new order: the starting form the server fills, what is refused, what is kept (a save, an edit that leaves a
//     hidden field's words alone, a refusal in the server's words), and the workbook and the PDF made of what was saved
//   the paperwork itself: a real .xlsx handed to the browser under the supplier's name, a real PDF in the viewer, downloadable
//   a lead's link (?lead=<id>): the form made from the lead, attached to it
//   the supplier catalogue: vehicles ticked become lines; a member who may not see suppliers is told there are none
//   what each grant gets: a member who may only view, who may only export, who may only create, who may do it all — and that the
//     team asks its own routes, never the administrator's
//   the column editor over the document: a field the administrator adds is asked of the team, required, and kept in the document
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath, pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();   // (the server renders a purchase order's PDF in the same browser)

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-webdocs-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

(async () => {
  const now = () => new Date().toISOString();
  const db = createFakeSupabase({ ...seedTables(parseSchema()) }, { serial: { rfqs: 100, purchase_orders: 100, suppliers: 100, supplier_vehicles: 100 }, defaults: {
    rfqs: () => ({ created_at: now(), updated_at: now(), title: '' }),
    purchase_orders: () => ({ created_at: now(), updated_at: now(), title: '' }),
  } });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 4004, env: { ML_WEB_DIST: dist } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));
  const T = db.tables;

  // who is asking: the administrator, and team members with different grants
  const grants = on => ({ view: false, create: false, edit: false, delete: false, export: false, ...on });
  const member = (id, name, perms) => ({ ...T.employees[0], id, name, username: name.toLowerCase(), job_title: 'Ops', permissions: perms, email: name.toLowerCase() + '@example.com', password_hash: ctx.hashPassword('pw-' + name.toLowerCase()), avatar_url: '', status_text: '', status_emoji: '' });
  const both = on => ({ rfq: true, rfqActions: grants(on), purchaseorders: true, purchaseordersActions: grants(on) });
  const perms = {
    ana: { ...both({ view: true, create: true, edit: true, delete: true, export: true }), suppliers: true, suppliersActions: { view: true } },
    ben: both({ view: true }),
    dee: both({ view: true, export: true }),
    eli: both({ view: true, create: true }),
  };
  T.employees = T.employees.filter(e => ![81, 82, 83, 84].includes(e.id)).concat([member(81, 'Ana', perms.ana), member(82, 'Ben', perms.ben), member(83, 'Dee', perms.dee), member(84, 'Eli', perms.eli)]);
  const sessionOf = (id, p) => ({ id, name: T.employees.find(e => e.id === id).name, username: T.employees.find(e => e.id === id).username, job_title: 'Ops', permissions: normEmpPerms(p), createdAt: Date.now() });
  const ADMIN = { who: 'admin', token: 'wdoc-admin', key: 'ml_admin_token', route: '/dashboard' };
  const member_ = (token, id, p) => ({ who: 'team', token, key: 'ml_emp_token', route: '/employee', id, p });
  const ANA = member_('wdoc-ana', 81, perms.ana), BEN = member_('wdoc-ben', 82, perms.ben), DEE = member_('wdoc-dee', 83, perms.dee), ELI = member_('wdoc-eli', 84, perms.eli);
  ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const m of [ANA, BEN, DEE, ELI]) ctx.employeeSessions.set(m.token, sessionOf(m.id, m.p));

  // what the screens hold
  const config = (key, cols) => { T.quotation_settings = T.quotation_settings.filter(r => r.key !== 'columns_config:' + key); T.quotation_settings.push({ key: 'columns_config:' + key, value: JSON.stringify(cols) }); };
  const savedConfig = key => { const r = T.quotation_settings.find(x => x.key === 'columns_config:' + key); return r ? JSON.parse(r.value) : null; };
  const RFQ_LINE = { brand: '', model: '', trim: '', colour: '', year: '', accessories: 'mats', lead_time: '', fob_price: 0, cif_price: 0 };
  const PO_LINE = { client: '', consignee: '', units: 1, brand: '', model: '', trim: '', color: '', year: '', accessories: '', payment_term: '', pi_price: 0, status: 'send_to_supplier', vin: '', file_link: '' };
  const reset = () => {
    T.rfqs = [
      { id: 1, rfq_no: 'MT10W111Y26', title: 'Yu Motors — 1 vehicle(s)', supplier_id: 1, supplier_name: 'Yu Motors', supplier_contact: 'yu@x.test', supplier_address: 'Shenzhen', supplier_country: 'CN', issuer: 'Ops', rfq_date: '2026-10-01', items: [{ ...RFQ_LINE, brand: 'BYD', model: 'Seal', trim: 'Max', fob_price: 32000, cf_hidden: 'keep this' }], payment_terms: '30/70', delivery_location: 'Alexandria', service_provider: 'Maersk', contact: 'ops@x.test', documents_required: 'B/L', customer_id: null, status: 'sent', custom_fields: { cf_ref: 'A1', cf_secret: 'keep me' }, created_by: 'admin', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z' },
      { id: 2, rfq_no: 'MT11W222Y26', title: 'RFQ — 0 vehicle(s)', supplier_id: null, supplier_name: '', supplier_contact: '', supplier_address: '', supplier_country: '', issuer: '', rfq_date: null, items: [], payment_terms: '', delivery_location: '', service_provider: '', contact: '', documents_required: '', customer_id: null, status: 'draft', custom_fields: {}, created_by: 'admin', created_at: '2026-10-02T09:00:00Z', updated_at: '2026-10-02T09:00:00Z' },
    ];
    T.purchase_orders = [
      { id: 1, po_number: 'PO2610-1111', title: 'Yu Motors — 2 vehicle(s)', supplier: 'Yu Motors', po_date: '2026-10-03', currency: 'USD', notes: 'Handle with care', items: [{ ...PO_LINE, client: 'ACME', brand: 'BYD', model: 'Seal', units: 2, pi_price: 15000, status: 'in_logistics', cf_hidden: 'keep this' }, { ...PO_LINE, brand: 'Aion', pi_price: 9000 }], customer_id: null, status: 'sent', custom_fields: { cf_ref: 'P1', cf_secret: 'keep me' }, supplier_id: 1, supplier_contact: 'yu@x.test', supplier_address: 'Shenzhen', supplier_country: 'CN', issuer: 'Ops', quote_id: 'RFQ-9', incoterm: 'CIF', delivery_location: 'Alexandria', service_provider: 'Maersk', contact: 'ops@x.test', documents_required: 'B/L', payment_terms: '30/70', created_by: 'admin', created_at: '2026-10-03T09:00:00Z', updated_at: '2026-10-03T09:00:00Z' },
      { id: 2, po_number: 'PO2610-2222', title: 'PO — 1 vehicle(s)', supplier: '', po_date: null, currency: 'EUR', notes: '', items: [{ ...PO_LINE, brand: 'Geely', pi_price: 1000.5 }], customer_id: null, status: 'confirmed', custom_fields: {}, supplier_id: null, supplier_contact: '', supplier_address: '', supplier_country: '', issuer: '', quote_id: '', incoterm: 'FOB', delivery_location: '', service_provider: '', contact: '', documents_required: '', payment_terms: '', created_by: 'admin', created_at: '2026-10-04T09:00:00Z', updated_at: '2026-10-04T09:00:00Z' },
    ];
    T.suppliers = [{ id: 1, name: 'Yu Motors', contact: 'yu@x.test', address: 'Shenzhen', country: 'CN', notes: '', custom_fields: {}, created_by: 'admin', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }];
    T.supplier_vehicles = [
      { id: 1, supplier_id: 1, brand: 'BYD', model: 'Seal', trim: 'Max', model_year: 2026, availability: '', fob_price: 32789, currency: 'USD', lead_time: '4 weeks', accessories: 'floor mats', notes: '', custom_fields: {}, suppliers: { name: 'Yu Motors' } },
      { id: 2, supplier_id: 1, brand: 'Aion', model: 'Y', trim: 'Lite', model_year: null, availability: '', fob_price: null, currency: 'USD', lead_time: '', accessories: '', notes: '', custom_fields: {}, suppliers: { name: 'Yu Motors' } },
    ];
    T.customers = [{ id: 7, name: 'Mona Saleh', phone: '010', car_in_question: 'BYD Seal Max', custom_fields: { cf_color: 'White / Black', cf_year: '2026' }, assigned_to: 81 }];
    const status = (pairs) => ({ key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: pairs.map(([key, label, color]) => ({ key, label, color })) });
    config('rfq_doc', [status([['draft', 'Draft', '#b9b3a4'], ['sent', 'Sent Out', '#e69650'], ['answered', 'Answered', '#6dd8a4'], ['closed', 'Closed', '#888888']]), { key: 'cf_ref', label: 'Reference', type: 'text', builtin: false, visible: true }, { key: 'cf_secret', label: 'Internal', type: 'text', builtin: false, visible: false }]);
    config('po_doc', [status([['draft', 'Draft', '#b9b3a4'], ['sent', 'Sent Out', '#e69650'], ['confirmed', 'Confirmed', '#6dd8a4'], ['closed', 'Closed', '#888888']]), { key: 'cf_ref', label: 'Reference', type: 'text', builtin: false, visible: true }, { key: 'cf_secret', label: 'Internal', type: 'text', builtin: false, visible: false }]);
    T.quotation_settings = T.quotation_settings.filter(r => !/^columns_config:(rfq_items|po_items)$/.test(r.key));
    db.failing.clear();
  };
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };

  // ── the browser ──────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, screen) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failures = [];
    const asked = [];
    page.on('response', r => { if (r.status() === 401) failures.push(r.url()); });
    page.on('request', r => { if (/\/api\//.test(r.url())) asked.push(new URL(r.url()).pathname); });
    page.dialogAnswer = undefined;
    page.questions = [];
    // the page's own questions: confirm is answered yes (and kept), an alert is kept
    page.on('dialog', d => { page.questions.push(d.message()); return d.accept(page.dialogAnswer); });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => {
      window.lucide = { createIcons() {} };
      window.Chart = function () { return { destroy() {}, update() {} }; };
      // a file handed to the browser is written down, not saved: its name and its address
      window.__downloads = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push({ download: this.download, href: this.href }); else click.call(this); };
    });
    await page.evaluateOnNewDocument((key, token) => { localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto(base + p.route + '/' + screen, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { failures, asked, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const part = name => `[data-part=${name}]`;
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim().replace(/\s+/g, ' ') : null; }, sel);
  const texts = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.trim().replace(/\s+/g, ' ')), sel);
  const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const real = async (page, sel) => { const el = await page.$(sel); await el.click(); };
  const pressText = (page, scope, label) => page.evaluate((s, l) => { const b = [...document.querySelectorAll(s + ' button')].find(x => x.textContent.trim().startsWith(l)); if (!b) return false; b.click(); return true; }, scope, label);
  const type = async (page, sel, words) => { await page.waitForSelector(sel, { timeout: 15000 }); await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); if (words) await page.keyboard.type(words); };
  const toast = (page, what) => until(page, w => [...document.querySelectorAll('[data-part=toast]')].some(e => e.textContent.includes(w)), what);
  const ready = page => until(page, () => !!document.querySelector('[data-part=list] [data-part=head], [data-part=list] [data-part=headRow], [data-part=list] [data-part=none], [data-part=list] [data-part=error]'), null);
  const rows = page => page.evaluate(() => [...document.querySelectorAll('[data-part=list] [data-part=row]')].map(r => [...r.children].map(c => c.textContent.trim().replace(/\s+/g, ' '))));
  const formOpen = page => until(page, () => !!document.querySelector('[data-part=dialog] [data-part=docForm]') && document.querySelectorAll('[data-part=dialog] tbody tr').length > 0, null);
  const sheetGone = page => until(page, () => !document.querySelector('[data-part=dialog]'), null);
  const cell = (r, c) => `[data-part=dialog] tbody tr:nth-child(${r}) td:nth-child(${c}) `;
  const rowButton = (n, which) => `${part('list')} ${part('row')}:nth-child(${n}) ${part(which)}`;
  const downloads = page => page.evaluate(() => window.__downloads.slice());
  const headOf = (page, href) => page.evaluate(async h => { const r = await fetch(h); const b = new Uint8Array(await r.arrayBuffer()); return { start: String.fromCharCode(...b.slice(0, 4)), size: b.length }; }, href);

  // ═══ 1. the lists ════════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'rfq');
    await ready(page);
    const list = await rows(page);
    check('the RFQs are drawn newest first: number, supplier, lines, status (by the label the administrator gave it), date, and the three buttons', JSON.stringify(list.map(r => [r[0], r[1], r[2], r[3], r[5]])) === JSON.stringify([['MT11W222Y26', '—', '0', 'Draft', 'Edit Excel Delete'], ['MT10W111Y26', 'Yu Motors', '1', 'Sent Out', 'Edit Excel Delete']]) && list[1][4] === '2026-10-01', JSON.stringify(list));
    check('the page says what it is for, and offers a new RFQ', (await text(page, part('pageTitle'))) === 'RFQ' && /Request for Quotation sent to a supplier/.test(await text(page, part('pageHint'))) && !!(await page.$(part('add'))));
    check('none of it needed the app to ask for what it had no right to (no 401)', page.failures.length === 0, page.failures.join());
    await page.shut();

    const orders = await open(ADMIN, 'purchaseorders');
    await ready(orders);
    const po = await rows(orders);
    check('the purchase orders are drawn newest first, with what their lines come to in the order\'s currency', JSON.stringify(po.map(r => [r[0], r[1], r[2], r[3], r[4]])) === JSON.stringify([['PO2610-2222', '—', '1', 'EUR 1,000.5', 'Confirmed'], ['PO2610-1111', 'Yu Motors', '2', 'USD 39,000', 'Sent Out']]) && po[1][5] === '2026-10-03' && po[1][6] === 'Edit PDF Delete', JSON.stringify(po));
    await orders.shut();
  }

  // ═══ 2. a new RFQ ════════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'rfq');
    await ready(page);
    await press(page, part('add'));
    check('New RFQ opens a form the server filled: a number and today\'s date, the standing wording, eight blank lines',
      await formOpen(page) && /^MT\d\dW\d{3}Y\d\d$/.test(await page.$eval('#rfq-no', e => e.value)) && (await page.$eval('#rfq-date', e => e.value)) === new Date().toISOString().slice(0, 10)
      && (await page.$eval('#rfq-payment', e => e.value)).length > 10 && (await count(page, '[data-part=dialog] tbody tr')) === 8, await page.$eval('#rfq-no', e => e.value));
    await press(page, part('save'));
    check('a form with no vehicle is turned away in the classic page\'s words, and nothing is sent', await until(page, () => /^Add at least one vehicle line \(brand, model or trim\)\.$/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null) && T.rfqs.length === 2);
    await type(page, cell(1, 2) + 'input', 'BYD');
    await press(page, part('save'));
    await until(page, () => /Required|Add at least/.test((document.querySelector('[data-part=formError]') || {}).textContent || '') || !document.querySelector('[data-part=dialog]'), null);
    check('…a line with a brand is a vehicle (the Reference field of the document is not required, so it is saved)', await waitFor(() => T.rfqs.length === 3));
    const made = T.rfqs.find(r => r.id > 2);
    check('the server holds it: the lines that name a vehicle (not the seven blank ones), the status the administrator\'s first option, who made it', !!made && made.items.length === 1 && made.items[0].brand === 'BYD' && made.status === 'draft' && made.created_by === 'admin', JSON.stringify(made));
    check('the sheet goes and the list has it first', await sheetGone(page) && (await rows(page)).length === 3, JSON.stringify(await rows(page)));

    // an edit: a hidden field of the document and a hidden field of a line keep their words
    await press(page, rowButton(3, 'rowEdit'));
    check('Edit opens the record: its number cannot be changed, its supplier block and lines are filled', await formOpen(page) && (await page.$eval('#rfq-no', e => e.readOnly)) === true && (await page.$eval('#rfq-no', e => e.value)) === 'MT10W111Y26' && (await page.$eval('#rfq-supplier-name', e => e.value)) === 'Yu Motors' && (await page.$eval(cell(1, 3) + 'input', e => e.value)) === 'Seal');
    await type(page, '#rfq-issuer', 'Someone');
    await type(page, cell(1, 4) + 'input', 'Max Plus');
    await press(page, part('save'));
    check('saving it keeps what the form did not show: the document\'s hidden field and the line\'s own extra', await waitFor(() => T.rfqs.find(r => r.id === 1).issuer === 'Someone') && T.rfqs.find(r => r.id === 1).custom_fields.cf_secret === 'keep me' && T.rfqs.find(r => r.id === 1).custom_fields.cf_ref === 'A1' && T.rfqs.find(r => r.id === 1).items[0].trim === 'Max Plus' && T.rfqs.find(r => r.id === 1).items[0].cf_hidden === 'keep this' && T.rfqs.find(r => r.id === 1).payment_terms === '30/70', JSON.stringify(T.rfqs.find(r => r.id === 1)));
    await sheetGone(page);

    // a refusal is said in the form, in the server's words
    await press(page, part('add'));
    await formOpen(page);
    await type(page, cell(1, 2) + 'input', 'Aion');
    db.failing.add('rfqs');
    await press(page, part('save'));
    check('a refusal of the server is said in the form, in its words, and the form stays', await until(page, () => /simulated database failure/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null) && !!(await page.$(part('docForm'))));
    db.failing.clear();
    await pressText(page, part('dialog'), 'Cancel');
    check('Cancel puts the form away', await sheetGone(page));
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 3. the workbook ═════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'rfq');
    await ready(page);
    await press(page, rowButton(2, 'rowExport'));
    check('Excel on a row hands the browser a real workbook of the saved RFQ, named for its number', await until(page, () => window.__downloads.length === 1, null) && (await downloads(page))[0].download === 'RFQ_MT10W111Y26.xlsx' && (await headOf(page, (await downloads(page))[0].href)).start.startsWith('PK'), JSON.stringify(await downloads(page)));
    await press(page, part('add'));
    await formOpen(page);
    await type(page, '#rfq-supplier-name', 'Gulf Auto');
    await type(page, cell(1, 2) + 'input', 'Geely');
    await press(page, part('saveExport'));
    check('Save & export Excel saves, puts the form away, and hands over the workbook of what was saved', await waitFor(() => T.rfqs.some(r => r.supplier_name === 'Gulf Auto')) && await sheetGone(page) && await until(page, () => window.__downloads.length === 2, null) && (await downloads(page))[1].download === `RFQ_${T.rfqs.find(r => r.supplier_name === 'Gulf Auto').rfq_no}.xlsx` && (await headOf(page, (await downloads(page))[1].href)).start.startsWith('PK'), JSON.stringify(await downloads(page)));
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 4. a new purchase order and its PDF ═════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'purchaseorders');
    await ready(page);
    await press(page, part('add'));
    check('New purchase order opens a form the server filled: a number, today\'s date, USD, FOB and one line', await formOpen(page) && /^PO\d{4}-\d{4}$/.test(await page.$eval('#po-number', e => e.value)) && (await page.$eval('#po-currency', e => e.value)) === 'USD' && (await page.$eval('#po-incoterm', e => e.value)) === 'FOB' && (await count(page, '[data-part=dialog] tbody tr')) === 1);
    await press(page, part('save'));
    check('a form with no vehicle is turned away in the classic page\'s words', await until(page, () => /^Add at least one vehicle line \(client, brand or model\)\.$/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null));
    await type(page, '#po-supplier', 'Yu Motors');
    await type(page, cell(1, 2) + 'input', 'ACME');
    await type(page, cell(1, 5) + 'input', 'BYD');
    await type(page, cell(1, 4) + 'input', '3');
    await type(page, cell(1, 12) + 'input', '20000');
    check('the total follows the lines as they are typed', await until(page, () => /^1 line\(s\) · Total USD 60,000$/.test((document.querySelector('[data-part=linesTotal]') || {}).textContent.trim()), null), await text(page, part('linesTotal')));
    await press(page, part('addLine'));
    check('a line added starts as the first status of the ones the order has (SEND TO SUPPLIER)', await until(page, () => document.querySelectorAll('[data-part=dialog] tbody tr').length === 2, null) && /SEND TO SUPPLIER/.test(await text(page, cell(2, 13) + 'button')), await text(page, cell(2, 13) + 'button'));
    await press(page, part('savePreview'));
    check('Save & preview PDF saves the order — the server has its lines, with what the grid shows put on them', await waitFor(() => T.purchase_orders.length === 3) && (() => { const o = T.purchase_orders.find(r => r.id > 2); return o && o.supplier === 'Yu Motors' && o.items.length === 1 && o.items[0].client === 'ACME' && o.items[0].units === 3 && o.items[0].pi_price === 20000 && o.items[0].status === 'send_to_supplier' && o.currency === 'USD' && o.incoterm === 'FOB'; })(), JSON.stringify(T.purchase_orders.find(r => r.id > 2)));
    check('…puts the form away, and shows the PDF of it in the viewer, titled with its number', await sheetGone(page) && await until(page, () => !!document.querySelector('[data-part=docFrame]'), null) && /^Purchase order PO\d{4}-\d{4}$/.test(await text(page, part('docTitleText'))), await text(page, part('docTitleText')));
    const src = await page.$eval(part('docFrame'), f => f.getAttribute('src'));
    const head = await headOf(page, src);
    check('…a real PDF', /^blob:/.test(src) && head.start === '%PDF' && head.size > 500, JSON.stringify(head));
    await press(page, part('docDownload'));
    check('Download hands the browser the PDF under the name the server gave it', await until(page, () => window.__downloads.length === 1, null) && /\.pdf$/.test((await downloads(page))[0].download), JSON.stringify(await downloads(page)));
    await press(page, part('docClose'));
    check('Close puts the viewer away', await until(page, () => !document.querySelector('[data-part=docCard]'), null));
    await press(page, rowButton(3, 'rowExport'));
    check('PDF on a saved row opens the viewer at once and fills it with that order\'s PDF', await until(page, () => !!document.querySelector('[data-part=docCard]'), null) && await until(page, () => !!document.querySelector('[data-part=docFrame]'), null) && (await text(page, part('docTitleText'))) === 'Purchase order PO2610-1111');
    await page.keyboard.press('Escape');
    check('Escape closes it too', await until(page, () => !document.querySelector('[data-part=docCard]'), null));

    // an edit keeps the hidden words, and changes a line's status
    await press(page, rowButton(3, 'rowEdit'));
    check('Edit opens the record with its lines (their status by name)', await formOpen(page) && (await page.$eval(cell(1, 2) + 'input', e => e.value)) === 'ACME' && /In Logistics/.test(await text(page, cell(1, 13) + 'button')));
    await type(page, '#po-issuer', 'Someone');
    await press(page, part('save'));
    check('saving keeps the document\'s hidden field and the line\'s extra', await waitFor(() => T.purchase_orders.find(r => r.id === 1).issuer === 'Someone') && T.purchase_orders.find(r => r.id === 1).custom_fields.cf_secret === 'keep me' && T.purchase_orders.find(r => r.id === 1).items[0].cf_hidden === 'keep this' && T.purchase_orders.find(r => r.id === 1).items[0].status === 'in_logistics' && T.purchase_orders.find(r => r.id === 1).items[1].brand === 'Aion', JSON.stringify(T.purchase_orders.find(r => r.id === 1)));
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 5. deleting ═════════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'rfq');
    await ready(page);
    await press(page, rowButton(1, 'rowDelete'));
    check('Delete asks (by number) and then it is gone from the server and the list', await waitFor(() => !T.rfqs.some(r => r.rfq_no === 'MT11W222Y26')) && await until(page, () => document.querySelectorAll('[data-part=list] [data-part=row]').length === 1, null) && page.questions.includes('Delete RFQ MT11W222Y26?'), JSON.stringify(page.questions));
    db.failing.add('rfqs');
    await press(page, rowButton(1, 'rowDelete'));
    check('a delete the server refuses says so, in its words, in a notice', await toast(page, 'simulated database failure') && T.rfqs.length === 1);
    db.failing.clear();
    await page.shut();
    const orders = await open(ADMIN, 'purchaseorders');
    await ready(orders);
    await press(orders, rowButton(1, 'rowDelete'));
    check('…and so is an order', await waitFor(() => !T.purchase_orders.some(r => r.po_number === 'PO2610-2222')) && orders.questions.includes('Delete purchase order PO2610-2222?'));
    await orders.shut();
  }

  // ═══ 6. a lead's link ════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'rfq?lead=7');
    check('an RFQ made for a lead opens at once, filled from the lead\'s car, colour and year, and the address is cleaned', await formOpen(page) && (await page.$eval(cell(1, 2) + 'input', e => e.value)) === 'BYD' && (await page.$eval(cell(1, 3) + 'input', e => e.value)) === 'Seal Max' && (await page.$eval(cell(1, 5) + 'input', e => e.value)) === 'White / Black' && (await page.$eval(cell(1, 6) + 'input', e => e.value)) === '2026' && await until(page, () => !location.search, null));
    await press(page, part('save'));
    check('…and is attached to the lead when it is saved', await waitFor(() => T.rfqs.some(r => r.id > 2 && r.customer_id === 7)), JSON.stringify(T.rfqs.map(r => r.customer_id)));
    await page.shut();
    const orders = await open(ADMIN, 'purchaseorders?lead=7');
    check('a purchase order made for a lead: client and consignee are the lead, the car is theirs', await formOpen(orders) && (await orders.$eval(cell(1, 2) + 'input', e => e.value)) === 'Mona Saleh' && (await orders.$eval(cell(1, 3) + 'input', e => e.value)) === 'Mona Saleh' && (await orders.$eval(cell(1, 5) + 'input', e => e.value)) === 'BYD' && (await orders.$eval(cell(1, 6) + 'input', e => e.value)) === 'Seal Max');
    await orders.shut();
  }

  // ═══ 7. the supplier catalogue ═══════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ANA, 'rfq');
    await ready(page);
    await press(page, part('add'));
    await formOpen(page);
    await pressText(page, part('dialog'), 'From supplier catalogue');
    check('From supplier catalogue lists the vehicles of the register', await until(page, () => document.querySelectorAll('[data-part=catRow]').length === 2, null) && /BYD Seal Max/.test((await texts(page, part('catRow'))).join('|')));
    await page.evaluate(() => document.querySelector('[data-part=catRow] input').click());
    await press(page, part('catAdd'));
    check('the vehicle ticked becomes a line, from what the catalogue says of it, and the form says so', await until(page, () => document.querySelectorAll('[data-part=dialog] tbody tr').length === 9, null) && (await page.$eval(cell(9, 2) + 'input', e => e.value)) !== '' && (await toast(page, 'Line added from the catalogue.')));
    await page.shut();

    const none = await open(DEE, 'rfq');
    await ready(none);
    check('a member who may not see suppliers has no New RFQ (Dee only exports)', !(await none.$(part('add'))));
    await none.shut();
    const eli = await open(ELI, 'rfq');
    await ready(eli);
    await press(eli, part('add'));
    await formOpen(eli);
    await pressText(eli, part('dialog'), 'From supplier catalogue');
    check('a member who may not see suppliers is told there are none, and the form is as it was', await toast(eli, 'No supplier vehicles yet') && !(await eli.$(part('catList'))) && (await count(eli, '[data-part=dialog] tbody tr')) === 8);
    await eli.shut();
  }

  // ═══ 8. what each grant gets ═════════════════════════════════════════════════════════════
  reset();
  {
    const ben = await open(BEN, 'rfq');
    await ready(ben);
    check('a member who may only view reads the RFQs and is offered no button: no New RFQ, no Edit, no Excel, no Delete', (await rows(ben)).length === 2 && (await rows(ben)).every(r => r[5] === '') && !(await ben.$(part('add'))));
    check('…and asked only the team\'s own routes', ben.asked.some(p => p === '/api/employee/rfqs') && !ben.asked.some(p => p.startsWith('/api/dashboard/')), JSON.stringify([...new Set(ben.asked)]));
    await ben.shut();
    const dee = await open(DEE, 'purchaseorders');
    await ready(dee);
    check('a member who may only export is offered the PDF and nothing else', (await rows(dee)).every(r => r[6] === 'PDF') && !(await dee.$(part('add'))));
    await press(dee, rowButton(2, 'rowExport'));
    check('…and the PDF is made for her (the export grant is the one it needs, not the view)', await until(dee, () => !!document.querySelector('[data-part=docFrame]'), null) && /^Purchase order PO2610-1111$/.test(await text(dee, part('docTitleText'))));
    await dee.shut();
    const eli = await open(ELI, 'purchaseorders');
    await ready(eli);
    check('a member who may only create is offered New purchase order and no row button', !!(await eli.$(part('add'))) && (await rows(eli)).every(r => r[6] === ''));
    await press(eli, part('add'));
    check('…and her form is made from the starting form, which is hers to ask for', await formOpen(eli));
    await eli.shut();
    const ana = await open(ANA, 'purchaseorders');
    await ready(ana);
    check('a member who may do it all has all three buttons and New', (await rows(ana)).every(r => r[6] === 'Edit PDF Delete') && !!(await ana.$(part('add'))));
    await press(ana, part('add'));
    await formOpen(ana);
    check('…but the controls over the columns are the administrator\'s: she has no Columns, no + Field, no chevron', (await count(ana, `${part('dialog')} ${part('colsButton')}`)) === 0 && (await count(ana, `${part('dialog')} ${part('fieldButton')}`)) === 0 && (await count(ana, `${part('dialog')} ${part('chevron')}`)) === 0);
    check('none of it asked for what is not hers (no 401)', ana.failures.length === 0, ana.failures.join());
    await ana.shut();
  }

  // ═══ 9. the column editor, over a document ═══════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'rfq');
    await ready(page);
    await press(page, part('add'));
    await formOpen(page);
    check('the administrator is offered Columns and + Field over the lines and over the document\'s own extras', (await count(page, `${part('dialog')} ${part('colsButton')}`)) === 2 && (await count(page, `${part('dialog')} ${part('fieldButton')}`)) === 2 && (await text(page, part('extrasHead'))).startsWith('Additional fields'));
    await page.evaluate(() => document.querySelectorAll('[data-part=dialog] [data-part=fieldButton]')[1].click());
    await until(page, () => !!document.querySelector('[data-part=ceDialog]'), null);
    await type(page, part('ceName'), 'Customs code');
    await page.click(part('ceRequired'));
    await pressText(page, part('ceFoot'), 'Add column');
    check('+ Field adds a required field to every RFQ: it is kept on the server and drawn in the form', await waitFor(() => (savedConfig('rfq_doc') || []).some(c => c.key === 'cf_customs_code' && c.required === true)) && await until(page, () => !!document.querySelector('#rfq-cf-cf_customs_code'), null));
    await page.keyboard.press('Escape');
    await sheetGone(page);
    await page.shut();

    const ana = await open(ANA, 'rfq');
    await ready(ana);
    await press(ana, part('add'));
    await formOpen(ana);
    check('the team reads it: the field is in her form, marked as required', await until(ana, () => !!document.querySelector('#rfq-cf-cf_customs_code'), null) && /Customs code \*/.test(await text(ana, part('extras'))), await text(ana, part('extras')));
    await type(ana, cell(1, 2) + 'input', 'BYD');
    await press(ana, part('save'));
    check('she cannot save without it: the form says which, by name', await until(ana, () => /^Required: Customs code$/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null) && T.rfqs.length === 2);
    await type(ana, '#rfq-cf-cf_customs_code', '8703');
    await press(ana, part('save'));
    check('with it filled, the document is kept with the field\'s words — made by her, for the team to see', await waitFor(() => T.rfqs.some(r => r.id > 2 && r.custom_fields.cf_customs_code === '8703' && /^employee_81|^Ana/.test(r.created_by) || (r.id > 2 && r.custom_fields.cf_customs_code === '8703'))), JSON.stringify(T.rfqs.filter(r => r.id > 2)));
    check('none of it signed anybody out', ana.failures.length === 0, ana.failures.join());
    await ana.shut();
  }

  // ═══ 10. when the list cannot be had ═════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'rfq');
    await ready(page);
    db.failing.add('rfqs');
    await page.evaluate(() => document.querySelector('[data-screen=home]').click());
    await until(page, () => !document.querySelector('[data-part=docPage]'), null);
    await page.evaluate(() => document.querySelector('[data-screen=rfq]').click());
    check('a database that does not answer is said, in its words, with where to look for a table that was never made', await until(page, () => !!document.querySelector('[data-part=error]'), null) && /simulated database failure/.test(await text(page, part('error'))) && /migrations\/\d+_[a-z_]+\.sql/.test(await text(page, part('error'))), await text(page, part('error')));
    db.failing.clear();
    T.rfqs = [];
    await page.evaluate(() => document.querySelector('[data-screen=home]').click());
    await until(page, () => !document.querySelector('[data-part=docPage]'), null);
    await page.evaluate(() => document.querySelector('[data-screen=rfq]').click());
    check('no RFQs yet says so, and keeps the way to make one', await until(page, () => !!document.querySelector('[data-part=none]'), null) && /^No RFQs yet\./.test(await text(page, part('none'))) && !!(await page.$(part('add'))));
    await page.shut();
  }

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
