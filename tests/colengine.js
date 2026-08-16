// The column engine, rendered for real in both portals off one fixture.
//
// The leads column editor used to exist twice — ~420 lines in dashboard.js and a
// near-verbatim copy in employee.js. It is one shared engine now (columns.js),
// and it gained the two ClickUp powers the user asked for: per-option COLORS
// (badges for any select column, not just the hardcoded status) and REQUIRED
// fields. These checks would have caught every way the extraction could have
// gone half-way: one portal on the engine and one on the corpse, colors read
// from the deleted maps, an editor the other portal cannot open.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// A config with a RENAMED builtin option carrying a custom color, plus a custom
// select column with its own colored options and a required text column.
const COLS = [
  { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
  { key: 'lead_status', label: 'Status', type: 'select', builtin: true, visible: true, options: [
    { key: 'cold', label: 'Chilly', color: '#3b82f6' },   // renamed + recolored
    { key: 'hot', label: 'Hot', color: '#f87171' },
  ] },
  { key: 'cf_priority', label: 'Priority', type: 'select', builtin: false, visible: true, options: [
    { key: 'p1', label: 'Critical', color: '#dc2626' },
    { key: 'p2', label: 'Normal' },                        // colorless → plain text
  ] },
  { key: 'cf_passport', label: 'Passport no.', type: 'text', builtin: false, visible: true, required: true },
];
const LEADS = [
  { id: 1, name: 'Ahmed', lead_status: 'cold', custom_fields: { cf_priority: 'p1', cf_passport: 'A1' } },
  { id: 2, name: 'Mona', lead_status: 'hot', custom_fields: { cf_priority: 'p2' } },
];

const SALES_COLS_CFG = [
  { key: 'client', label: 'Client', type: 'text', builtin: true, visible: true },
  { key: 'status', label: 'Status', type: 'select', builtin: true, visible: true },
  { key: 'cf_bank', label: 'Bank', type: 'select', builtin: false, visible: true,
    options: [{ key: 'cib', label: 'CIB', color: '#3b82f6' }, { key: 'cash', label: 'Cash' }] },
];
const SUP_COLS_CFG = [
  { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
  { key: 'cf_rating', label: 'Rating', type: 'select', builtin: false, visible: true,
    options: [{ key: 'a', label: 'Grade A', color: '#22c55e' }] },
];
const PO_COLS_CFG = [
  { key: 'brand', label: 'MARQUE', type: 'text', builtin: true, visible: true },   // renamed
  { key: 'model', label: 'MODEL', type: 'text', builtin: true, visible: true },
  { key: 'cf_port', label: 'PORT', type: 'text', builtin: false, visible: true },
  // A custom DROPDOWN on a line grid: the sheets used to draw every custom
  // column as a text box no matter what type it was configured with.
  { key: 'cf_ship', label: 'SHIPPING', type: 'select', builtin: false, visible: true,
    options: [{ key: 'roro', label: 'RoRo', color: '#22c55e' }, { key: 'container', label: 'Container' }] },
];
const RFQ_COLS_CFG = [
  { key: 'brand', label: 'BRAND', type: 'text', builtin: true, visible: true },
  { key: 'cf_urgency', label: 'URGENCY', type: 'select', builtin: false, visible: true,
    options: [{ key: 'rush', label: 'Rush', color: '#f87171' }, { key: 'normal', label: 'Normal' }] },
];
// A DOCUMENT's own fields: the Status at the top of an RFQ — renamed and
// recolored here — plus an extra field this company wants on every document.
const DOC_CFG = [
  { key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: [
    { key: 'draft', label: 'Not sent yet', color: '#b9b3a4' },
    { key: 'sent', label: 'With supplier', color: '#e69650' },
    { key: 'awarded', label: 'Awarded', color: '#6dd8a4' } ] },
  { key: 'cf_agent', label: 'Shipping agent', type: 'text', builtin: false, visible: true },
];
const CONTRACT_CFG = [
  { key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: [
    { key: 'draft', label: 'Unsigned', color: '#b9b3a4' }, { key: 'signed', label: 'Signed', color: '#6dd8a4' } ] },
  { key: 'cf_notary', label: 'Notary', type: 'select', builtin: false, visible: true, required: true,
    options: [{ key: 'cairo', label: 'Cairo office' }, { key: 'giza', label: 'Giza office' }] },
];
// Inventory: the per-car unit rows are a line grid too, and they live in the
// vehicle's own JSONB — so a field added here needs no column anywhere.
const STOCK_CFG = [
  { key: 'vin', label: 'VIN', type: 'text', builtin: true, visible: true },
  { key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: [
    { key: 'in_yard', label: 'In the yard', color: '#6dd8a4' }, { key: 'reserved', label: 'Reserved' } ] },
  { key: 'cf_plate', label: 'Plate', type: 'text', builtin: false, visible: true },
];
const STOCK = [{ id: 3, make: 'BYD', model: 'Seal', trim: 'Design', price: 2000000, colors: [],
  units: [{ vin: 'X1', status: 'in_yard', cf_plate: 'ق ط ر 123' }] }];
const SALES = [{ id: 4, client: 'Mona', status: 'delivered', custom_fields: { cf_bank: 'cib' } }];
const SUPPLIERS = [{ id: 7, name: 'Yu Motors', contact: '', country: 'CN', address: '', notes: '', custom_fields: { cf_rating: 'a' } }];

let savedPuts = [];
let savedWrites = [];
function api(pathname, method, body) {
  if (method === 'PUT' && /columns\/[a-z_]+$|leads\/columns$/.test(pathname)) {
    savedPuts.push({ pathname, body: JSON.parse(body) });
    return { ok: true };
  }
  if ((method === 'POST' || method === 'PUT') && /\/(rfqs|purchase-orders|contracts|stock)(\/\d+)?$/.test(pathname)) {
    savedWrites.push({ pathname, method, body: JSON.parse(body || '{}') });
    return { ok: true, id: 5, rfq_no: 'RFQ-1', contract_no: 'CT-1' };
  }
  if ((method === 'POST' || method === 'PUT') && /\/sales(\/\d+)?$|\/suppliers(\/\d+)?$/.test(pathname)) {
    savedWrites.push({ pathname, method, body: JSON.parse(body || '{}') });
    return { ok: true, id: 99 };
  }
  if (/columns\/sales$/.test(pathname)) return { columns: SALES_COLS_CFG };
  if (/columns\/suppliers$/.test(pathname)) return { columns: SUP_COLS_CFG };
  if (/columns\/po_items$/.test(pathname)) return { columns: PO_COLS_CFG };
  if (/columns\/rfq_items$/.test(pathname)) return { columns: RFQ_COLS_CFG };
  if (/columns\/rfq_doc$/.test(pathname)) return { columns: DOC_CFG };
  if (/columns\/po_doc$/.test(pathname)) return { columns: DOC_CFG };
  if (/columns\/contracts$/.test(pathname)) return { columns: CONTRACT_CFG };
  if (/columns\/stock$/.test(pathname)) return { columns: STOCK_CFG };
  if (/\/stock$/.test(pathname)) return STOCK;
  if (/contracts\/new\/defaults$/.test(pathname)) return { contract_no: 'CT-1', data: {} };
  if (/\/sales$/.test(pathname)) return SALES;
  if (/\/suppliers$/.test(pathname)) return SUPPLIERS;
  if (/suppliers\/\d+\/(vehicles|docs)$/.test(pathname)) return [];
  if (/purchase-orders\/new\/defaults$/.test(pathname)) return { po_number: 'PO-1', po_date: '2026-08-15', currency: 'USD', items: [{}] };
  if (/rfqs\/new\/defaults$/.test(pathname)) return { rfq_no: 'RFQ-1', rfq_date: '2026-08-15', status: 'draft', items: [{}] };
  if (/columns\/leads$|leads\/columns$/.test(pathname)) return { columns: COLS };
  if (/customers$|employee\/leads$/.test(pathname)) return LEADS;
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { ok: true, id: 2, name: 'Sara', permissions: {} };
  return [];
}

async function openPortal(browser, { route, file, tokenKey, port, perms }) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
    }
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(k => localStorage.setItem(k, 't'), tokenKey);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' });
  await sleep(500);
  if (perms) { await page.evaluate(p => { try { applyPermissions(p); } catch (_) {} }, perms); await sleep(100); }
  return { page, errs };
}

// What the leads table shows for a given cell, as { text, bg, color }.
const CELL = sel => `(() => {
  const el = document.querySelector('${sel}');
  if (!el) return null;
  const pill = el.querySelector('span') || el;
  const cs = getComputedStyle(pill);
  return { text: pill.textContent.trim(), bg: cs.backgroundColor, color: cs.color };
})()`;

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  for (const portal of [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token',
      leadsPage: 'customers', body: '#customers-tbody' },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token',
      leadsPage: 'leads', body: '#emp-leads-tbody',
      perms: { leads: true, leadsActions: { view: true, create: true, edit: true, delete: true, import: true, export: true } } },
  ]) {
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(p => navigate(p), portal.leadsPage);
    await sleep(600);

    const rows = await page.evaluate(sel => {
      const tb = document.querySelector(sel);
      return tb ? tb.querySelectorAll('tr').length : -1;
    }, portal.body);
    check(`${portal.label}: the leads table renders from the engine config`, rows >= 2, String(rows));

    // Badges: the renamed+recolored builtin option, and the CUSTOM colored option —
    // the power the hardcoded status maps could never give a custom column.
    const badges = await page.evaluate(sel => {
      const cells = [...document.querySelectorAll(sel + ' tr td')];
      const find = txt => {
        const el = cells.flatMap(td => [...td.querySelectorAll('span')]).find(s => s.textContent.trim() === txt);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, color: cs.color };
      };
      return { chilly: find('Chilly'), critical: find('Critical'), normalPlain: !find('Normal') };
    }, portal.body);
    check(`${portal.label}: a recolored builtin option renders its configured color`,
      !!badges.chilly && /59, 130, 246/.test(badges.chilly.color), JSON.stringify(badges.chilly));
    check(`${portal.label}: a CUSTOM select column gets colored badges too`,
      !!badges.critical && /220, 38, 38/.test(badges.critical.color), JSON.stringify(badges.critical));
    check(`${portal.label}: a colorless option stays plain text`, badges.normalPlain === true);

    // The editor: open the options modal for the custom column, add an option,
    // save — the PUT must carry it, with colors preserved on the untouched rows.
    savedPuts = [];
    const edited = await page.evaluate(async () => {
      CE('leads').openOptsModal('cf_priority');
      await new Promise(r => setTimeout(r, 100));
      CE('leads').addOptRow();
      const rows = document.querySelectorAll('#ce-opts-list .lo-row');
      rows[rows.length - 1].querySelector('input').value = 'Low';
      CE('leads').saveOpts();
      await new Promise(r => setTimeout(r, 150));
      const col = CE('leads').col('cf_priority');
      return { opts: col.options.map(o => o.key + (o.color ? ':' + o.color : '')) };
    });
    check(`${portal.label}: the options editor adds an option and keeps colors`,
      edited.opts.join(' ') === 'p1:#dc2626 p2 low', edited.opts.join(' '));
    check(`${portal.label}: the change was PUT to this portal's own API`,
      savedPuts.length === 1 && savedPuts[0].pathname.startsWith(portal.route === '/dashboard' ? '/api/dashboard' : '/api/employee'),
      JSON.stringify(savedPuts.map(p => p.pathname)));

    // Required: the engine reports the missing field by label.
    const req = await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = CE('leads').inputHtml(CE('leads').col('cf_passport'), '');
      document.body.appendChild(host);
      const missing = CE('leads').validateRequired(host);
      host.remove();
      return missing;
    });
    check(`${portal.label}: a required field with no value is reported by label`,
      req.length === 1 && req[0] === 'Passport no.', JSON.stringify(req));

    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── A rep without leads.edit gets no editing affordances ────────────────────
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { leads: true, leadsActions: { view: true } } });
    await page.evaluate(() => navigate('leads'));
    await sleep(500);
    const menu = await page.evaluate(async () => {
      const th = document.querySelector('th.lead-col');
      CE('leads').openMenu({ stopPropagation() {}, clientX: 50, clientY: 50 }, 'lead_status');
      await new Promise(r => setTimeout(r, 100));
      const m = document.querySelector('.lead-menu');
      return { canEdit: CE('leads').cfg.canEdit(), buttons: m ? [...m.querySelectorAll('button')].map(b => b.textContent.trim()) : [] };
    });
    check('a view-only rep sees sort in the column menu but no mutations',
      menu.canEdit === false && menu.buttons.some(b => /Sort/.test(b)) && !menu.buttons.some(b => /Rename|Delete|Hide/.test(b)),
      JSON.stringify(menu));
    await page.close();
  }

  // ── Adoption: sales, suppliers and the PO grid read the same engine ─────────
  {
    const { page, errs } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    // Sales tab
    await page.evaluate(() => { navigate('deals'); dealsTab('sales'); });
    await sleep(600);
    const sales = await page.evaluate(() => {
      const box = document.getElementById('deals-sales-table');
      const heads = [...box.querySelectorAll('thead th')].map(t => t.textContent.trim());
      const badge = [...box.querySelectorAll('tbody span')].find(x => x.textContent.trim() === 'CIB');
      return { heads, cib: badge ? getComputedStyle(badge).color : null };
    });
    check('sales: the table renders the configured columns including a custom one',
      sales.heads.includes('Bank') && sales.heads.includes('Client'), JSON.stringify(sales.heads));
    check('sales: the custom select renders a colored badge',
      !!sales.cib && /59, 130, 246/.test(sales.cib), String(sales.cib));
    // The form carries the custom field and the save carries custom_fields.
    savedWrites.length = 0;
    const saved = await page.evaluate(async () => {
      openSaleForm(4);
      await new Promise(r => setTimeout(r, 150));
      const sel = document.querySelector('#modal-body [data-cek="cf_bank"]');
      if (sel) sel.value = 'cash';
      await saveSale(4);
      await new Promise(r => setTimeout(r, 200));
      return { hadInput: !!sel };
    });
    check('sales: the form includes the custom field', saved.hadInput === true);
    check('sales: saving sends custom_fields to the server',
      savedWrites.length === 1 && savedWrites[0].body.custom_fields && savedWrites[0].body.custom_fields.cf_bank === 'cash',
      JSON.stringify(savedWrites[0] && savedWrites[0].body.custom_fields));

    // Suppliers register
    await page.evaluate(() => navigate('suppliers'));
    await sleep(600);
    const sup = await page.evaluate(() => {
      const box = document.getElementById('suppliers-list');
      return { heads: [...box.querySelectorAll('thead th')].map(t => t.textContent.trim()),
               gradeA: !![...box.querySelectorAll('tbody span')].find(x => x.textContent.trim() === 'Grade A') };
    });
    check('suppliers: the register renders configured + custom columns',
      sup.heads.includes('Rating') && sup.gradeA, JSON.stringify(sup));

    // PO sheet grid: renamed builtin + custom column, honored in the grid.
    const po = await page.evaluate(async () => {
      await openPoForm(null);
      await new Promise(r => setTimeout(r, 250));
      const heads = [...document.querySelectorAll('#po-grid thead th')].map(t => t.textContent.trim());
      const cf = document.querySelector('#po-rows .po-f[data-k="cf_port"]');
      if (cf) cf.value = 'Alexandria';
      const items = poCollectItems();
      PROCFG.closeModal();
      return { heads, collected: items[0] && items[0].cf_port };
    });
    check('PO grid: a renamed builtin shows its configured label', po.heads.includes('MARQUE'), JSON.stringify(po.heads.slice(0, 6)));
    check('PO grid: a custom column exists and collects into the items JSON',
      po.collected === 'Alexandria', String(po.collected));

    // ── Reaching the editor from a table that is not the leads pool ───────────
    // The complaint: "I still cannot edit the fields type or options in the
    // RFQs, POs, Suppliers, contract". These tables offered show/hide and
    // "+ Field" only — nothing that opened an EXISTING field.
    const reach = await page.evaluate(async () => {
      await openPoForm(null);
      await new Promise(r => setTimeout(r, 250));
      const chevs = document.querySelectorAll('#po-grid thead .col-chev-btn').length;
      CE('po_items').openPicker({ stopPropagation() {}, clientX: 40, clientY: 40 });
      await new Promise(r => setTimeout(r, 80));
      const menu = document.querySelector('.lead-menu');
      const pencils = menu.querySelectorAll('.lead-col-edit').length;
      const addField = [...menu.querySelectorAll('button')].some(b => /Add field/.test(b.textContent));
      // …and the header chevron opens the per-field menu with the editor on it.
      CE('po_items').openMenu({ stopPropagation() {}, clientX: 40, clientY: 40 }, 'cf_ship');
      await new Promise(r => setTimeout(r, 80));
      const items = [...document.querySelectorAll('.lead-menu button')].map(b => b.textContent.trim());
      return { chevs, pencils, addField, items };
    });
    check('PO grid: every header carries the field menu chevron',
      reach.chevs >= 4, String(reach.chevs));
    check('the Columns picker opens the field editor and can add a field',
      reach.pencils >= 4 && reach.addField === true, JSON.stringify({ p: reach.pencils, a: reach.addField }));
    check('the field menu offers type and options for a non-leads entity',
      reach.items.some(t => /Edit field/.test(t)) && reach.items.some(t => /Change type/.test(t))
      && reach.items.some(t => /Edit options/.test(t)), JSON.stringify(reach.items));

    // One modal edits name + type + options + required, and PUTs to this entity.
    savedPuts = [];
    const fieldEdit = await page.evaluate(async () => {
      CE('po_items').openFieldModal('cf_ship');
      await new Promise(r => setTimeout(r, 120));
      document.getElementById('ce-name').value = 'Shipping mode';
      document.getElementById('ce-required').checked = true;
      const rowsBefore = document.querySelectorAll('#ce-opts-list .lo-row').length;
      CE('po_items').addOptRow();
      const rows = document.querySelectorAll('#ce-opts-list .lo-row');
      rows[rows.length - 1].querySelector('input').value = 'Air freight';
      rows[rows.length - 1].querySelector('input[type=color]').value = '#3b82f6';
      CE('po_items').saveField();
      await new Promise(r => setTimeout(r, 150));
      const col = CE('po_items').col('cf_ship');
      return { rowsBefore, label: col.label, required: col.required === true,
               opts: col.options.map(o => o.key + (o.color ? ':' + o.color : '')) };
    });
    check('the field editor loads the existing options into one modal',
      fieldEdit.rowsBefore === 2, String(fieldEdit.rowsBefore));
    check('one save applies rename + a new colored option + required',
      fieldEdit.label === 'Shipping mode' && fieldEdit.required
      && fieldEdit.opts.join(' ') === 'roro:#22c55e container air_freight:#3b82f6',
      JSON.stringify(fieldEdit));
    check('the edit is PUT to the entity that owns the field',
      savedPuts.length === 1 && /\/columns\/po_items$/.test(savedPuts[0].pathname),
      JSON.stringify(savedPuts.map(p => p.pathname)));

    // A dropdown column must DRAW as a dropdown in the sheet, and collect its key.
    const grid = await page.evaluate(async () => {
      PROCFG.closeModal();
      await openPoForm(null);
      await new Promise(r => setTimeout(r, 250));
      const el = document.querySelector('#po-rows [data-k="cf_ship"]');
      const tag = el ? el.tagName : null;
      const opts = el && el.tagName === 'SELECT' ? [...el.options].map(o => o.textContent) : [];
      if (el && el.tagName === 'SELECT') el.value = 'container';
      const items = poCollectItems();
      PROCFG.closeModal();
      return { tag, opts, collected: items[0] && items[0].cf_ship };
    });
    check('PO grid: a dropdown field renders as a dropdown, not a text box',
      grid.tag === 'SELECT', String(grid.tag));
    check('PO grid: it offers the configured options and collects the chosen key',
      grid.opts.includes('RoRo') && grid.opts.includes('Air freight') && grid.collected === 'container',
      JSON.stringify(grid));

    // The RFQ sheet — the screen in the report — gets the same treatment.
    const rfq = await page.evaluate(async () => {
      await openRfqForm(null);
      await new Promise(r => setTimeout(r, 300));
      const chevs = document.querySelectorAll('#rfq-rows') ? document.querySelectorAll('.po-th .col-chev-btn').length : 0;
      const el = document.querySelector('#rfq-rows [data-k="cf_urgency"]');
      const tag = el ? el.tagName : null;
      if (el) el.value = 'rush';
      const collected = rfqCollect().items[0].cf_urgency;
      PROCFG.closeModal();
      return { chevs, tag, collected };
    });
    check('RFQ sheet: headers carry the field menu and a dropdown field is a dropdown',
      rfq.chevs >= 4 && rfq.tag === 'SELECT', JSON.stringify(rfq));
    check('RFQ sheet: the chosen option is collected into the line', rfq.collected === 'rush', String(rfq.collected));

    check('adoption: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── Configured options drive what the tables draw ───────────────────────────
  // Sales rendered its badges from a frozen SALE_STATUS_OPTS const, so editing
  // the Status options changed nothing on screen.
  {
    const { page, errs } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    await page.evaluate(() => { navigate('deals'); dealsTab('sales'); });
    await sleep(600);
    const st = await page.evaluate(async () => {
      const col = CE('sales').col('status');
      col.options = [{ key: 'delivered', label: 'Handed over', color: '#22c55e' }];
      CE('sales').cfg.onChange();
      await new Promise(r => setTimeout(r, 400));
      const badge = [...document.querySelectorAll('#deals-sales-table tbody span')]
        .find(s => s.textContent.trim() === 'Handed over');
      openSaleForm(4);
      await new Promise(r => setTimeout(r, 200));
      const sel = document.getElementById('sale-status');
      const formOpts = sel ? [...sel.options].map(o => o.textContent) : [];
      PROCFG.closeModal();
      return { badge: badge ? getComputedStyle(badge).color : null, formOpts };
    });
    check('sales: a renamed status option renames the badge in the table',
      !!st.badge && /34, 197, 94/.test(st.badge), String(st.badge));
    check('sales: the form dropdown offers the configured options',
      st.formOpts.length === 1 && st.formOpts[0] === 'Handed over', JSON.stringify(st.formOpts));
    check('configured options: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── The document's OWN fields ────────────────────────────────────────────────
  // The screenshot in the report had the RFQ's Status dropdown open — a document
  // field, not a line-item column, and the one part of the form the engine did
  // not reach. Status options, their colors, and extra document fields are
  // configurable now, and the extras save with the record.
  {
    const { page, errs } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    await page.evaluate(() => navigate('rfqs'));
    await sleep(500);
    savedWrites.length = 0;
    const rfqDoc = await page.evaluate(async () => {
      await openRfqForm(null);
      await new Promise(r => setTimeout(r, 350));
      const sel = document.getElementById('rfq-status');
      const opts = sel ? [...sel.options].map(o => o.textContent.trim()) : [];
      const extra = document.querySelector('[data-doc-extras="rfq_doc"] [data-cek="cf_agent"]');
      const fieldsBtn = [...document.querySelectorAll('#modal-body button')]
        .some(b => /\+ Field/.test(b.textContent));
      if (extra) extra.value = 'Nile Freight';
      if (sel) sel.value = 'awarded';
      const brand = document.querySelector('#rfq-rows [data-k="brand"]');
      if (brand) brand.value = 'Toyota';
      await saveRfq(false);
      await new Promise(r => setTimeout(r, 250));
      return { opts, hadExtra: !!extra, fieldsBtn };
    });
    check('RFQ document: Status offers the CONFIGURED options, not the frozen map',
      rfqDoc.opts.join('|') === 'Not sent yet|With supplier|Awarded', JSON.stringify(rfqDoc.opts));
    check('RFQ document: an admin-added document field appears on the form',
      rfqDoc.hadExtra === true && rfqDoc.fieldsBtn === true, JSON.stringify(rfqDoc));
    check('RFQ document: the extra field and the status save with the record',
      savedWrites.length === 1 && savedWrites[0].body.status === 'awarded'
      && savedWrites[0].body.custom_fields && savedWrites[0].body.custom_fields.cf_agent === 'Nile Freight',
      JSON.stringify(savedWrites[0] && { s: savedWrites[0].body.status, cf: savedWrites[0].body.custom_fields }));

    // Contracts had no engine at all. Their extras ride in the data payload the
    // table already has, so this one needs no migration to work.
    savedWrites.length = 0;
    await page.evaluate(() => navigate('contracts'));
    await sleep(400);
    const ct = await page.evaluate(async () => {
      await openContractForm(null);
      await new Promise(r => setTimeout(r, 400));
      const sel = document.getElementById('ct-status');
      const opts = sel ? [...sel.options].map(o => o.textContent.trim()) : [];
      const notary = document.querySelector('[data-doc-extras="contracts"] [data-cek="cf_notary"]');
      const buyer = document.querySelector('.ct-f[data-path="buyer.name"]');
      if (buyer) buyer.value = 'Ahmed';
      // Required, and left empty on purpose: the save must refuse and name it.
      await saveContract(false);
      await new Promise(r => setTimeout(r, 120));
      const refusal = document.getElementById('ct-err').textContent;
      if (notary) notary.value = 'giza';
      await saveContract(false);
      await new Promise(r => setTimeout(r, 200));
      return { opts, isSelect: !!notary && notary.tagName === 'SELECT', refusal, hadBuyer: !!buyer };
    });
    check('contracts: a required document field blocks the save and is named',
      /Notary/.test(ct.refusal) && ct.hadBuyer === true, JSON.stringify(ct.refusal));
    check('contracts: Status reads its configured options', ct.opts.join('|') === 'Unsigned|Signed', JSON.stringify(ct.opts));
    check('contracts: a document dropdown field renders as a dropdown', ct.isSelect === true);
    check('contracts: the extra field saves inside the contract data payload',
      savedWrites.length >= 1 && savedWrites[savedWrites.length - 1].body.data
      && savedWrites[savedWrites.length - 1].body.data.custom_fields
      && savedWrites[savedWrites.length - 1].body.data.custom_fields.cf_notary === 'giza',
      JSON.stringify(savedWrites.length && savedWrites[savedWrites.length - 1].body.data
        ? savedWrites[savedWrites.length - 1].body.data.custom_fields : null));
    check('document fields: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── Inventory ────────────────────────────────────────────────────────────────
  {
    const { page, errs } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    await page.evaluate(() => navigate('stock'));
    await sleep(600);
    savedWrites.length = 0;
    const stock = await page.evaluate(async () => {
      const card = document.querySelector('.stock-units');
      const cardHeads = card ? [...card.querySelectorAll('thead th')].map(t => t.textContent.trim()) : [];
      const cardBadge = card ? [...card.querySelectorAll('tbody span')].map(x => x.textContent.trim()) : [];
      await openStockForm(3);
      await new Promise(r => setTimeout(r, 300));
      const chevs = document.querySelectorAll('#modal-body .po-th .col-chev-btn').length;
      const plate = document.querySelector('.stk-unit-row [data-k="cf_plate"]');
      const status = document.querySelector('.stk-unit-row [data-k="status"]');
      const statusOpts = status && status.tagName === 'SELECT' ? [...status.options].map(o => o.textContent) : [];
      if (plate) plate.value = 'ABC 987';
      await saveStock(3);
      await new Promise(r => setTimeout(r, 250));
      return { cardHeads, cardBadge, chevs, hadPlate: !!plate, statusOpts };
    });
    check('inventory: the unit table renders the configured columns',
      stock.cardHeads.includes('Plate') && stock.cardHeads.includes('VIN'), JSON.stringify(stock.cardHeads));
    check('inventory: a unit status shows its configured badge',
      stock.cardBadge.includes('In the yard'), JSON.stringify(stock.cardBadge));
    check('inventory: the unit editor carries the field menu and the custom field',
      stock.chevs >= 3 && stock.hadPlate === true && stock.statusOpts.includes('In the yard'),
      JSON.stringify({ c: stock.chevs, p: stock.hadPlate, o: stock.statusOpts }));
    check('inventory: the custom unit field saves inside the vehicle',
      savedWrites.length === 1 && savedWrites[0].body.units && savedWrites[0].body.units[0].cf_plate === 'ABC 987',
      JSON.stringify(savedWrites[0] && savedWrites[0].body.units));
    check('inventory: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── One engine, no corpses ───────────────────────────────────────────────────
  {
    const dash = fs.readFileSync('public/assets/dashboard.js', 'utf8');
    const emp = fs.readFileSync('public/assets/employee.js', 'utf8');
    check('neither bundle keeps a copy of the editor',
      !/function openLeadOptsModal/.test(dash) && !/function openLeadOptsModal/.test(emp)
      && !/function mergeLeadCols/.test(dash) && !/function mergeLeadCols/.test(emp));
    check('the hardcoded status color maps are gone from both bundles',
      !/LEAD_STATUS_COLORS/.test(dash) && !/LEAD_STATUS_COLORS/.test(emp));
    check('the static column modals are gone from both pages',
      !/lead-col-modal|lead-type-modal|lead-opts-modal/.test(fs.readFileSync('public/dashboard.html', 'utf8'))
      && !/lead-col-modal|lead-type-modal|lead-opts-modal/.test(fs.readFileSync('public/employee.html', 'utf8')));
    const srvCols = fs.readFileSync('src/routes/columns.js', 'utf8');
    check('the server has one sanitizer and an entity registry',
      /function sanitizeColumns/.test(srvCols) && /ENTITY_COLUMNS = \{/.test(srvCols)
      && /leads_columns_config/.test(srvCols));
    check('employee column WRITES stay leads-only on the generic route',
      /ent\.empEdit \|\| !empCan\(req\.employee, ent\.perm, ent\.empEdit\)/.test(srvCols));
    check('the registry covers the documents, not just their line items',
      ['rfq_doc', 'po_doc', 'contracts', 'quote_doc', 'stock'].every(e => new RegExp(`\\b${e}:\\s+\\{`).test(srvCols)));
    // The custom_fields columns arrive with migration 012, which is applied by
    // hand — a deploy that lands first must not start losing RFQs and POs.
    const rfqSrv = fs.readFileSync('src/routes/rfq.js', 'utf8');
    const poSrv = fs.readFileSync('src/routes/purchase-orders.js', 'utf8');
    check('documents persist their custom fields tolerantly of the pending migration',
      /custom_fields/.test(rfqSrv) && /custom_fields/.test(poSrv)
      && /ctx\.writeOptional\([\s\S]{0,200}custom_fields/.test(rfqSrv)
      && /ctx\.writeOptional\([\s\S]{0,200}custom_fields/.test(poSrv));
    check('writeOptional drops only the named column and retries',
      /dropped\.forEach\(k => \{ delete rest\[k\]; \}\)/.test(fs.readFileSync('src/ctx.js', 'utf8')));
    check('migration 012 adds the two columns the documents need',
      /rfqs\s+ADD COLUMN IF NOT EXISTS custom_fields/.test(fs.readFileSync('migrations/012_document_custom_fields.sql', 'utf8'))
      && /purchase_orders ADD COLUMN IF NOT EXISTS custom_fields/.test(fs.readFileSync('migrations/012_document_custom_fields.sql', 'utf8')));
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
