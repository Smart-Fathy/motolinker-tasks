// Four production reports, each one a place where a feature stopped at the
// dashboard's edge and the team portal — or an empty table — was left holding
// nothing.
//
//   1. The quotation PDF button in the team portal hit an /api/employee route
//      that was never mounted. The 404 fell through to the SPA's HTML and the
//      client tried to parse it: "Unexpected token '<'".
//   2. stock.view was grantable for as long as the permission model has existed,
//      and the team portal has never had an Inventory page to show for it.
//   3. An empty supplier register skipped loading its column config, so "Add
//      supplier" opened a modal with no fields in it and no Columns button.
//   4. The lead 360 card's info grid is built from the leads column config, which
//      only the leads PAGE loads — so opening a lead from the sales pipeline
//      showed a card with the whole grid missing.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const LEAD = { id: 9, name: 'Monier Samaha', phone: '+201003409262', lead_status: 'cold',
  source: 'messenger', car_in_question: 'Changan Nevo Q05', budget_lead: 1000000,
  lead_date: '2026-08-13', custom_fields: {} };
const COLS = [
  { key: 'lead_date', label: 'Date', type: 'date', builtin: true, visible: true },
  { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
  { key: 'phone', label: 'Phone', type: 'text', builtin: true, visible: true },
  { key: 'lead_status', label: 'Status', type: 'select', builtin: true, visible: true,
    options: [{ key: 'cold', label: 'Cold' }] },
  { key: 'source', label: 'Origin', type: 'select', builtin: true, visible: true,
    options: [{ key: 'messenger', label: 'Mess. (organic)' }] },
  { key: 'car_in_question', label: 'Vehicle Requested', type: 'text', builtin: true, visible: true },
  { key: 'budget_lead', label: 'Budget', type: 'number', builtin: true, visible: true },
];
const STOCK = [
  { id: 1, make: 'BYD', model: 'Seal', trim: 'Design', price: 2000000,
    colors: [{ name: 'White' }, { name: 'Black' }], units: [{ vin: 'A' }, { vin: 'B' }] },
  { id: 2, make: 'Changan', model: 'Q05', trim: 'Max', price: 1500000, colors: [], units: [] },
];
const DEALS = [{ id: 4, title: 'Monier Samaha', stage: 'lead', customer_id: 9, budget_egp: 1000000,
  created_at: '2026-08-13', customer_name: 'Monier Samaha' }];

// The routes the SERVER actually mounts, read from the inventory snapshot. A stub
// that answers whatever it is asked cannot catch "this portal has no such route" —
// which is precisely the bug. Anything not on this list 404s to the SPA's HTML,
// exactly as production does.
const MOUNTED = fs.readFileSync('tools/routes.snapshot.txt', 'utf8').split('\n')
  .map(l => l.trim()).filter(Boolean)
  .map(l => { const [m, p] = l.split(/\s+/); return { method: m, re: new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$') }; });
const isMounted = (pathname, method) =>
  MOUNTED.some(r => r.method === (method || 'GET') && r.re.test(pathname));

let pdfPosts = [], stockWrites = [];
function api(pathname, method, body) {
  if ((method === 'POST' || method === 'PUT') && /\/stock(\/\d+)?$/.test(pathname)) {
    stockWrites.push({ pathname, method, body: JSON.parse(body || '{}') });
    return { ok: true, id: 7 };
  }
  if (/columns\/stock$/.test(pathname)) return { columns: null };
  // The team portal's PDF button must reach a route that EXISTS. Anything the
  // stub does not know answers with the SPA's HTML, exactly like production.
  if (/quotations\/\d+\/pdf$/.test(pathname)) {
    pdfPosts.push(pathname);
    return { pdf: Buffer.from('%PDF-1.4 fake').toString('base64'), name: 'MT33W64Y26' };
  }
  if (/\/stock$/.test(pathname)) return STOCK;
  if (/customers\/\d+\/profile$|leads\/\d+\/profile$/.test(pathname)) {
    return { customer: LEAD, activities: [], followups: [], quotations: [], deals: [], contracts: [], purchaseOrders: [] };
  }
  if (/\/folder$/.test(pathname)) return { exists: false, viewers: [], documents: 0 };
  if (/columns\/suppliers$/.test(pathname)) return { columns: [
    { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
    { key: 'contact', label: 'Contact', type: 'text', builtin: true, visible: true },
    { key: 'country', label: 'Country', type: 'text', builtin: true, visible: true },
    { key: 'address', label: 'Address', type: 'text', builtin: true, visible: true },
    { key: 'notes', label: 'Notes', type: 'text', builtin: true, visible: true },
    { key: 'cf_rating', label: 'Rating', type: 'text', builtin: false, visible: true } ] };
  if (/\/suppliers$/.test(pathname)) return [];                        // the empty register
  if (/(leads\/columns|columns\/leads)$/.test(pathname)) return { columns: COLS };
  if (/\/deals$/.test(pathname)) return DEALS;
  if (/quotations$/.test(pathname)) return [{ id: 3, quote_id: 'MT33W64Y26', title: 'Avatr 11 Ultra — test',
    created_by: 'dashboard', created_at: '2026-08-16' }];
  if (/customers$|employee\/leads$/.test(pathname)) return [LEAD];
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { ok: true, id: 2, name: 'Sara', permissions: {} };
  return [];
}

// Unknown /api paths answer with the SPA shell, the way a 404 does in production.
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
      if (!isMounted(u.pathname, req.method())) {
        return req.respond({ status: 404, contentType: 'text/html', body: '<!DOCTYPE html><html></html>' });
      }
      const body = api(u.pathname, req.method(), req.postData());
      if (body === undefined) return req.respond({ status: 404, contentType: 'text/html', body: '<!DOCTYPE html><html></html>' });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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
  if (perms) { await page.evaluate(p => { try { applyPermissions(p); } catch (_) {} }, perms); await sleep(150); }
  return { page, errs };
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  // ── 1. The quotation PDF, from the TEAM portal ──────────────────────────────
  {
    pdfPosts = [];
    const { page, errs } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { quotation: true, quotationActions: { draft: true, history: true } } });
    const pdf = await page.evaluate(async () => {
      await viewDocPdf('quotation', 3, 'MT33W64Y26');
      await new Promise(r => setTimeout(r, 400));
      const load = document.getElementById('doc-modal-loading');
      const frame = document.getElementById('doc-preview-frame');
      return { err: load.textContent.replace(/\s+/g, ' ').trim(), shown: frame.style.display };
    });
    check('team portal: the quotation PDF asks its OWN portal for the render',
      pdfPosts.length === 1 && pdfPosts[0] === '/api/employee/quotations/3/pdf', JSON.stringify(pdfPosts));
    check('team portal: the document renders instead of "Unexpected token \'<\'"',
      pdf.shown === 'block' && !/Unexpected token/.test(pdf.err), JSON.stringify(pdf));
    check('the route is mounted for both portals from one handler',
      /mountQuotationPdfRoute\('\/api\/dashboard', requireAuth\)/.test(fs.readFileSync('src/routes/quotations.js', 'utf8'))
      && /mountQuotationPdfRoute\('\/api\/employee', requireEmployeeAuth\)/.test(fs.readFileSync('src/routes/quotations.js', 'utf8')));
    check('PDF: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── 2. Inventory in the team portal ─────────────────────────────────────────
  {
    const { page, errs } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { stock: true, stockActions: { view: true, browse: true } } });
    const inv = await page.evaluate(async () => {
      const nav = document.getElementById('nav-stock');
      const navShown = !!nav && nav.style.display !== 'none';
      navigate('stock');
      await new Promise(r => setTimeout(r, 550));
      const box = document.getElementById('page-stock');
      return { navShown, text: box ? box.textContent.replace(/\s+/g, ' ').trim() : null,
               cards: box ? box.querySelectorAll('.stock-card').length : 0 };
    });
    check('a granted rep gets an Inventory item in the nav', inv.navShown === true);
    check('…and the page lists the stock the dashboard holds',
      inv.cards === 2 && /BYD Seal/.test(inv.text), JSON.stringify(inv.text && inv.text.slice(0, 90)));
    const search = await page.evaluate(async () => {
      document.getElementById('stock-search').value = 'changan';
      renderStock();
      return document.querySelectorAll('#page-stock .stock-card').length;
    });
    check('…and can be searched', search === 1, String(search));
    check('Inventory: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { stock: true, stockActions: { view: true, browse: false }, leads: true, leadsActions: { view: true } } });
    const hidden = await page.evaluate(() => {
      const nav = document.getElementById('nav-stock');
      return { nav: !nav || nav.style.display === 'none',
               page: document.getElementById('page-stock').dataset.permitted };
    });
    check('a rep with the picker but NOT the page sees no Inventory', hidden.nav === true && hidden.page === '0',
      JSON.stringify(hidden));
    await page.close();
  }

  // ── 2b. A rep who may ADD a vehicle ─────────────────────────────────────────
  // Reading the register was the whole of the first Inventory build; a team that
  // keeps the stock could not touch it.
  {
    stockWrites = [];
    const { page, errs } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { stock: true, stockActions: { view: true, browse: true, create: true, edit: true } } });
    const add = await page.evaluate(async () => {
      navigate('stock');
      await new Promise(r => setTimeout(r, 500));
      const btn = [...document.querySelectorAll('#page-stock button')].find(b => /Add vehicle/.test(b.textContent));
      const shown = !!btn && btn.style.display !== 'none';
      const cardText = document.getElementById('page-stock').textContent.replace(/\s+/g, ' ');
      const chips = document.querySelectorAll('#page-stock .color-chip').length;
      await openStockForm(null);
      await new Promise(r => setTimeout(r, 300));
      const fields = ['stk-make', 'stk-model', 'stk-price'].every(id => !!document.getElementById(id));
      const colours = !!document.getElementById('stk-colors');
      const colourBtn = [...document.querySelectorAll('#modal-body button')].some(b => /Add colour/.test(b.textContent));
      document.getElementById('stk-make').value = 'BYD';
      document.getElementById('stk-model').value = 'Dolphin';
      await saveStock(null);
      await new Promise(r => setTimeout(r, 250));
      return { shown, fields, colours, colourBtn, cardText, chips,
               cards: document.querySelectorAll('#page-stock .stock-card').length };
    });
    check('team portal: the register renders the same cards the dashboard shows',
      add.cards === 2, String(add.cards));
    // Each CAR still carries its colour — that is the unit column. What is gone
    // is the model-level "colours offered" list, which said the same thing twice
    // and disagreed the moment a car arrived in a colour nobody had listed.
    check('…without a colours-offered block, though each unit keeps its colour',
      !/Available colours|No colours recorded/i.test(add.cardText)
      && add.chips === 0 && /Colour EXT \/ INT/.test(add.cardText),
      JSON.stringify({ chips: add.chips }));
    check('a rep with stock.create is offered Add vehicle, with the real form',
      add.shown === true && add.fields === true, JSON.stringify(add));
    check('the form no longer asks for a list of colours offered',
      add.colours === false && add.colourBtn === false, JSON.stringify(add));
    check('…and the save goes to their OWN portal',
      stockWrites.length === 1 && stockWrites[0].pathname === '/api/employee/stock'
      && stockWrites[0].body.make === 'BYD', JSON.stringify(stockWrites));
    check('Inventory write: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { stock: true, stockActions: { view: true, browse: true, create: false, edit: false } } });
    const ro = await page.evaluate(async () => {
      navigate('stock');
      await new Promise(r => setTimeout(r, 500));
      const btn = [...document.querySelectorAll('#page-stock button')].find(b => /Add vehicle/.test(b.textContent));
      return { add: !!btn && btn.style.display !== 'none',
               edit: [...document.querySelectorAll('#page-stock .stock-actions button')].length };
    });
    check('a rep without the write grants gets no Add and no Edit',
      ro.add === false && ro.edit === 0, JSON.stringify(ro));
    await page.close();
  }

  // ── 3. The supplier form on an empty register ───────────────────────────────
  {
    const { page, errs } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    const sup = await page.evaluate(async () => {
      navigate('suppliers');
      await new Promise(r => setTimeout(r, 500));
      const listText = document.getElementById('suppliers-list').textContent;
      const colsBtn = [...document.querySelectorAll('#suppliers-list button')].some(b => /Columns/.test(b.textContent));
      await openSupplierForm(null);
      await new Promise(r => setTimeout(r, 250));
      const body = document.getElementById('modal-body');
      return { empty: /No suppliers yet/.test(listText), colsBtn,
               fields: body.querySelectorAll('input,select,textarea').length,
               labels: [...body.querySelectorAll('.form-label')].map(l => l.textContent.trim()) };
    });
    check('an empty register still offers the Columns controls',
      sup.empty === true && sup.colsBtn === true, JSON.stringify(sup));
    check('…and "Add supplier" has its fields, including the custom one',
      sup.fields >= 6 && sup.labels.includes('Name') && sup.labels.includes('Rating'),
      JSON.stringify(sup.labels));
    check('suppliers: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── 4. The lead 360 card, opened from the sales pipeline ────────────────────
  {
    const { page, errs } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    // Straight to Deals — the leads page, which is what loads the column config,
    // is never visited in this run. That is the whole bug.
    const card = await page.evaluate(async () => {
      navigate('deals');
      await new Promise(r => setTimeout(r, 500));
      await openLeadProfile(9);
      await new Promise(r => setTimeout(r, 600));
      const grid = document.querySelector('#lead-drawer-body .ld-info-grid');
      return { items: grid ? grid.querySelectorAll('.ld-info-item').length : 0,
               text: grid ? grid.textContent.replace(/\s+/g, ' ').trim() : '' };
    });
    check('the 360 card fills its info grid even from the pipeline',
      card.items >= 5, String(card.items));
    check('…with the lead\'s actual details in it',
      /Vehicle Requested/.test(card.text) && /Changan Nevo Q05/.test(card.text)
      && /Mess\. \(organic\)/.test(card.text), JSON.stringify(card.text.slice(0, 140)));
    check('lead card: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
