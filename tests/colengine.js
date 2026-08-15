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
];
const SALES = [{ id: 4, client: 'Mona', status: 'delivered', custom_fields: { cf_bank: 'cib' } }];
const SUPPLIERS = [{ id: 7, name: 'Yu Motors', contact: '', country: 'CN', address: '', notes: '', custom_fields: { cf_rating: 'a' } }];

let savedPuts = [];
let savedWrites = [];
function api(pathname, method, body) {
  if (method === 'PUT' && /columns\/leads$|leads\/columns$/.test(pathname)) {
    savedPuts.push({ pathname, body: JSON.parse(body) });
    return { ok: true };
  }
  if ((method === 'POST' || method === 'PUT') && /\/sales(\/\d+)?$|\/suppliers(\/\d+)?$/.test(pathname)) {
    savedWrites.push({ pathname, method, body: JSON.parse(body || '{}') });
    return { ok: true, id: 99 };
  }
  if (/columns\/sales$/.test(pathname)) return { columns: SALES_COLS_CFG };
  if (/columns\/suppliers$/.test(pathname)) return { columns: SUP_COLS_CFG };
  if (/columns\/po_items$/.test(pathname)) return { columns: PO_COLS_CFG };
  if (/columns\/rfq_items$/.test(pathname)) return { columns: null };
  if (/\/sales$/.test(pathname)) return SALES;
  if (/\/suppliers$/.test(pathname)) return SUPPLIERS;
  if (/suppliers\/\d+\/(vehicles|docs)$/.test(pathname)) return [];
  if (/purchase-orders\/new\/defaults$/.test(pathname)) return { po_number: 'PO-1', po_date: '2026-08-15', currency: 'USD', items: [{}] };
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
    check('adoption: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
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
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
