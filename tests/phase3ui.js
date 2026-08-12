// Phase 3 UI: the stock modal no longer takes a typed total, legacy rows say so,
// and the supplier detail tabs work.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const STOCK = [
  { id: 1, make: 'BYD', model: 'Seal', trim: 'Max', price: 900000, quantity: 0, legacy_count: 3,
    colors: [{ name: 'White', qty: 0 }], units: [], specs: {} },
  { id: 2, make: 'BYD', model: 'Han', trim: '', price: 800000, quantity: 2, legacy_count: null,
    colors: [{ name: 'Black', qty: 0 }],
    units: [{ vin: 'V1', colour: 'Black', status: 'delivered' }, { vin: '', colour: 'Black', status: 'in_customs' }], specs: {} },
];
const SUPPLIERS = [{ id: 7, name: 'Yu Motors', contact: 'a@b.c', country: 'CN', address: '' }];
const SUP_VEHICLES = [{ id: 1, supplier_id: 7, brand: 'BYD', model: 'Seal', trim: 'Max',
  model_year: 2026, availability: 'Pre-order', fob_price: 32789, lead_time: '4 to 6 weeks', accessories: 'mats' }];
const SUP_DOCS = [{ id: 1, supplier_id: 7, name: 'contract.pdf', web_link: 'https://drive/x', size_bytes: 20480 }];
const PURCHASES = { units: [{ make: 'BYD', model: 'Seal', vin: 'V1', colour: 'White', price: 30000 }],
  poLines: [{ po_number: 'PO-1', brand: 'BYD', model: 'Seal', qty: 2, price: 31000, lead_time: '6 weeks' }],
  totals: { vehicles: 1, ordered: 2, avg_unit_price: 30000, avg_po_price: 31000, lead_times: ['6 weeks'] } };

let posted = [];
function api(p, method, body) {
  if (method !== 'GET') posted.push({ method, p, body: body ? JSON.parse(body) : null });
  if (/\/stock$/.test(p)) return STOCK;
  if (/\/suppliers$/.test(p)) return SUPPLIERS;
  if (/\/suppliers\/\d+\/vehicles$/.test(p)) return SUP_VEHICLES;
  if (/\/suppliers\/\d+\/docs$/.test(p)) return SUP_DOCS;
  if (/\/suppliers\/\d+\/purchases$/.test(p)) return PURCHASES;
  if (/auth\/check$/.test(p)) return { ok: true };
  if (/home\/(layout|summary)$/.test(p)) return {};
  return [];
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });
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
    if (u.pathname === '/dashboard') return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync('public/dashboard.html', 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      // The portals now load their CSS and JS from /assets, and Chrome is fussy
      // about script MIME types — serve them properly typed.
      const ct = f.endsWith('.js') ? 'application/javascript'
               : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('ml_admin_token', 'T');
    window.lucide = { createIcons() {} };
  });
  await page.goto('http://127.0.0.1:' + port + '/dashboard', { waitUntil: 'domcontentloaded' });
  await sleep(900);

  // ── Stock cards ──
  await page.evaluate(() => navigate('stock'));
  await sleep(700);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.stock-card')].map(c => ({
    title: c.querySelector('.stock-title').textContent.trim(),
    qty: c.querySelector('.stock-qty').textContent.trim(),
    warn: [...c.querySelectorAll('.stk-legacy')].map(w => w.textContent.replace(/\s+/g, ' ').trim()),
  })));
  const seal = cards.find(c => /Seal/.test(c.title)), han = cards.find(c => /Han/.test(c.title));
  check('a model with no cars reads 0 in stock', seal.qty === '0 in stock', JSON.stringify(seal));
  check('and says how many were recorded before VIN tracking',
    seal.warn.some(w => /3 cars were recorded here before VIN tracking/.test(w)), JSON.stringify(seal.warn));
  check('a model with cars counts the cars', han.qty === '2 in stock', JSON.stringify(han));
  check('and flags the one still missing a VIN',
    han.warn.some(w => /1 car has no VIN yet/.test(w)), JSON.stringify(han.warn));
  check('a model with cars shows no legacy warning',
    !han.warn.some(w => /before VIN tracking/.test(w)), JSON.stringify(han.warn));

  // ── Stock modal ──
  await page.evaluate(() => openStockForm(1));
  await sleep(400);
  const modal = await page.evaluate(() => ({
    hasQtyInput: !!document.getElementById('stk-qty'),
    hasColourQty: !!document.querySelector('.stk-color-qty'),
    legacyNote: (document.querySelector('#modal-body .stk-legacy') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
  }));
  check('the typed-in total is gone from the form', !modal.hasQtyInput);
  check('per-colour counts are gone too', !modal.hasColourQty);
  check('the form repeats the prompt for missing cars',
    /3 cars were recorded here/.test(modal.legacyNote), modal.legacyNote.slice(0, 60));

  const payload = await page.evaluate(() => {
    stkAddUnitRow({ vin: 'NEW1', colour: 'White' });
    const colors = [...document.querySelectorAll('.stk-color-row')].map(r => ({
      name: r.querySelector('.stk-color-name').value, qty: 0 }));
    return { colors, hasQty: 'quantity' in (() => { const o = {}; return o; })() };
  });
  check('colours still collect a name for the spec card', payload.colors[0].name === 'White', JSON.stringify(payload.colors));

  // ── Supplier detail ──
  await page.evaluate(() => navigate('suppliers'));
  await sleep(600);
  await page.evaluate(() => openSupplierDetail(7));
  await sleep(700);
  const veh = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.sup-tab')].map(t => t.textContent),
    rows: document.querySelectorAll('#sup-v-body tr').length,
    firstBrand: (document.querySelector('#sup-v-body .sup-v[data-k="brand"]') || {}).value,
    lead: (document.querySelector('#sup-v-body .sup-v[data-k="lead_time"]') || {}).value,
  }));
  check('the supplier sheet has all three tabs',
    veh.tabs.join() === 'Vehicles,Documents,Purchases', JSON.stringify(veh.tabs));
  check('the catalogue lists what the supplier offers',
    veh.rows === 1 && veh.firstBrand === 'BYD' && /4 to 6 weeks/.test(veh.lead), JSON.stringify(veh));

  await page.evaluate(() => supTab('docs'));
  await sleep(500);
  const docs = await page.evaluate(() => ({
    files: [...document.querySelectorAll('.hd-file-name')].map(e => e.textContent),
    note: (document.querySelector('#sup-pane span') || {}).textContent || '',
  }));
  check('documents list, and say where they live',
    docs.files.join() === 'contract.pdf' && /Google Drive/.test(docs.note), JSON.stringify(docs));

  await page.evaluate(() => supTab('purchases'));
  await sleep(500);
  const buy = await page.evaluate(() => ({
    tiles: [...document.querySelectorAll('#sup-pane .home-big')].map(e => e.textContent.trim()),
    labels: [...document.querySelectorAll('#sup-pane .home-w-title')].map(e => e.textContent.trim()),
  }));
  check('purchases show what was actually received and paid',
    buy.labels.join() === 'Cars received,Ordered on POs,Avg price paid,Avg PO price'
    && buy.tiles.join() === '1,2,30,000,31,000', JSON.stringify(buy));

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
