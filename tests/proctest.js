// The five operations pages, rendered for real in BOTH portals from one module.
//
// procurement.js used to be 1,100 lines inside dashboard.js. The whole point of
// moving it is that the team portal runs the same code, so the assertions that
// matter are the ones that would catch it running only half-way there:
//
//   - every page renders its records in both portals, not just the admin's
//   - the portal's calls go to /api/employee, not to the /api/dashboard paths the
//     code is literally written with — a mapping that lives in one function
//   - a button for an action the employee was not granted is not drawn
//
// The last one is belt-and-braces: permlive.js proves the server refuses it. This
// proves the portal does not offer it in the first place.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// Distinctive values, so a page that renders nothing is obvious from the text.
const SUPPLIERS = [{ id: 7, name: 'Yu Motors Trading', contact: 'a@b.c', country: 'CN', address: 'Shenzhen', notes: '' }];
const RFQS = [{ id: 3, rfq_no: 'RFQ-2026-11', title: 'Seal pre-order', supplier_name: 'Yu Motors Trading',
                issuer: 'Ops', rfq_date: '2026-08-01', status: 'sent', items: [{ brand: 'BYD', model: 'Seal' }] }];
const POS = [{ id: 5, po_number: 'PO2608-1191', title: 'August order', supplier: 'Yu Motors Trading',
               po_date: '2026-08-02', currency: 'USD', status: 'confirmed',
               items: [{ brand: 'BYD', model: 'Seal', units: 2, pi_price: 31000, status: 'in_production' }] }];
const CONTRACTS = [{ id: 9, contract_no: 'CT-2026-004', title: 'Ahmed Kamal — BYD Seal',
                     status: 'draft', customer_id: 1, created_at: '2026-08-03' }];
const SUBMISSIONS = [{ id: 2, name: 'Mona Saleh', email: 'm@x.com', phone: '01000', message: 'Is the Seal available?',
                       submitted_at: '2026-08-04T09:00:00Z', lead_name: 'Mona Saleh' }];

// Every API path the pages touch, answered the same way for both portals — so any
// difference in what renders is the code, not the fixture.
function api(p) {
  if (/\/suppliers$/.test(p))                 return SUPPLIERS;
  if (/\/suppliers\/\d+\/(vehicles|docs)$/.test(p)) return [];
  if (/\/suppliers\/\d+\/purchases$/.test(p)) return { units: [], poLines: [], totals: {} };
  if (/\/supplier-vehicles$/.test(p))         return [];
  if (/\/rfqs$/.test(p))                      return RFQS;
  if (/\/purchase-orders$/.test(p))           return POS;
  if (/\/contracts$/.test(p))                 return CONTRACTS;
  if (/\/submissions$/.test(p))               return SUBMISSIONS;
  if (/auth\/check$|employee\/check$/.test(p)) return { ok: true, id: 2, name: 'Sara', username: 'sara', job_title: 'Ops' };
  if (/home\/(layout|summary)$/.test(p))      return {};
  if (/nav-config$/.test(p))                  return {};
  return [];
}

// What each page must show once it has rendered, and which container it fills.
const PAGES = [
  { page: 'suppliers',      sel: '#suppliers-list',              text: 'Yu Motors Trading' },
  { page: 'rfq',            sel: '#rfqs-list',                   text: 'RFQ-2026-11', adminPage: 'rfqs' },
  { page: 'purchaseorders', sel: '#po-list',                     text: 'PO2608-1191' },
  { page: 'contracts',      sel: '#contracts-list',              text: 'CT-2026-004' },
  { page: 'submissions',    sel: '#submissions-table-container', text: 'Mona Saleh' },
];

async function openPortal(browser, { route, file, tokenKey, port, permissions }) {
  const page = await browser.newPage();
  const errs = [], apiCalls = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      apiCalls.push(u.pathname);
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname)) });
    }
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument((k, perms) => {
    localStorage.setItem(k, 'test-token');
    if (perms) window.__testPerms = perms;
  }, tokenKey, permissions || null);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' });
  await sleep(500);
  if (permissions) {
    await page.evaluate(p => { try { applyPermissions(p); } catch (_) {} }, permissions);
    await sleep(150);
  }
  return { page, errs, apiCalls };
}

const ALL_ON = (() => {
  const p = { suppliers: true, rfq: true, purchaseorders: true, contracts: true, submissions: true };
  for (const [s, acts] of Object.entries({
    suppliers: ['view', 'create', 'edit', 'delete', 'catalogue', 'docs'],
    rfq: ['view', 'create', 'edit', 'delete', 'export'],
    purchaseorders: ['view', 'create', 'edit', 'delete', 'export'],
    contracts: ['view', 'create', 'edit', 'delete', 'export'],
    submissions: ['view', 'delete'],
  })) p[s + 'Actions'] = Object.fromEntries(acts.map(a => [a, true]));
  return p;
})();

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  // ── The team portal ─────────────────────────────────────────────────────────
  {
    const { page, errs, apiCalls } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port, permissions: ALL_ON });

    check('the portal loads the shared operations module',
      await page.evaluate(() => typeof loadSuppliers === 'function' && typeof viewDocPdf === 'function'));
    check('…and binds it with its own PROCFG',
      await page.evaluate(() => PROCFG && PROCFG.base === '/api/employee'));

    for (const { page: p, sel, text } of PAGES) {
      await page.evaluate(x => navigate(x), p);
      await sleep(450);
      const got = await page.evaluate(s => {
        const el = document.querySelector(s);
        return { there: !!el, html: el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : '' };
      }, sel);
      check(`team: ${p} renders its records`, got.there && got.html.includes(text),
        got.there ? got.html.slice(0, 90) : 'container missing');
    }

    // The mapping is the one thing that would silently break the portal: the module
    // is written with /api/dashboard paths and rewrites them through PROCFG.base.
    const wrong = apiCalls.filter(u => u.startsWith('/api/dashboard'));
    check('team: nothing reached for a /api/dashboard path', wrong.length === 0, [...new Set(wrong)].join(', '));
    const hitOps = ['/api/employee/suppliers', '/api/employee/rfqs', '/api/employee/purchase-orders',
                    '/api/employee/contracts', '/api/employee/submissions'].filter(u => apiCalls.includes(u));
    check('team: all five endpoints were actually called', hitOps.length === 5,
      hitOps.length + '/5: ' + hitOps.join(' '));
    check('team: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── A rep who may read but not write ────────────────────────────────────────
  {
    const readOnly = {
      suppliers: true, rfq: true, purchaseorders: true, contracts: true, submissions: true,
      suppliersActions: { view: true }, rfqActions: { view: true },
      purchaseordersActions: { view: true }, contractsActions: { view: true },
      submissionsActions: { view: true },
    };
    const { page, errs } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port, permissions: readOnly });
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll('[data-perm]')]
        .filter(el => /^(suppliers|rfq|purchaseorders|contracts)\.(create|edit|delete)$/.test(el.dataset.perm))
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.dataset.perm));
    check('a read-only rep is offered no create button', shown.length === 0, shown.join(', '));

    // The row buttons are drawn by the module, not by the page, so data-perm never
    // reaches them — they ask procCan as they render. A rep who cannot delete a
    // purchase order should not be shown a Delete on every line of the table.
    const offered = [];
    for (const { page: pg, sel } of PAGES) {
      await page.evaluate(x => navigate(x), pg);
      await sleep(400);
      const labels = await page.evaluate(s => {
        const el = document.querySelector(s);
        return el ? [...el.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
      }, sel);
      for (const l of labels) if (/^(Edit|Delete)$/.test(l)) offered.push(`${pg}:${l}`);
    }
    check('…nor an Edit or Delete on any row', offered.length === 0, offered.join(', '));

    // …and the pages they may read still work.
    await page.evaluate(() => navigate('contracts'));
    await sleep(400);
    const txt = await page.evaluate(() => document.querySelector('#contracts-list').textContent);
    check('…and can still read the records', txt.includes('CT-2026-004'), txt.replace(/\s+/g, ' ').slice(0, 80));
    check('read-only: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── Nothing granted: the section is not in the nav at all ───────────────────
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port, permissions: {} });
    const visible = await page.evaluate(() =>
      ['suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions']
        .filter(id => { const el = document.getElementById('nav-' + id); return el && getComputedStyle(el).display !== 'none'; }));
    check('an employee with none of them sees none of them', visible.length === 0, visible.join(', '));
    // These five used to share one portal-only "Operations" heading. They sit
    // where the admin keeps them now — Tools, Logistics & Shipping, CRM — so
    // every one of those headings has to disappear with them.
    const heads = await page.evaluate(() =>
      ['nav-label-tools', 'nav-label-logistics', 'nav-label-crm']
        .map(id => { const el = document.getElementById(id); return id + '=' + (el ? getComputedStyle(el).display : 'missing'); }));
    check('…and every heading they sit under goes with them',
      heads.every(h => h.endsWith('=none')), heads.join(', '));
    await page.close();
  }

  // ── The admin, unchanged ────────────────────────────────────────────────────
  // The same module now drives the dashboard. If the extraction broke anything,
  // this is where it shows: same fixture, same five pages, same expectations.
  {
    const { page, errs, apiCalls } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    check('the dashboard binds PROCFG to its own base',
      await page.evaluate(() => PROCFG && PROCFG.base === '/api/dashboard'));
    for (const { page: p, adminPage, sel, text } of PAGES) {
      await page.evaluate(x => navigate(x), adminPage || p);
      await sleep(450);
      const got = await page.evaluate(s => {
        const el = document.querySelector(s);
        return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : null;
      }, sel);
      check(`admin: ${p} still renders after the move`, !!got && got.includes(text),
        got === null ? 'container missing' : got.slice(0, 90));
    }
    const wrong = apiCalls.filter(u => u.startsWith('/api/employee'));
    check('admin: nothing reached for an /api/employee path', wrong.length === 0, [...new Set(wrong)].join(', '));
    check('admin: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
