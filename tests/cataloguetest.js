// RFQ and purchase-order lines can be pulled from the supplier catalogue.
//
// The endpoint existed for a while with no caller — the plan said the pickers
// would read from supplier_vehicles and only the back half was built. This drives
// the real page and asserts a line actually gets filled in.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const CATALOGUE = [
  { id: 1, supplier_id: 7, supplier_name: 'Yu Motors', brand: 'BYD', model: 'Seal', trim: 'Max',
    model_year: 2026, availability: 'Pre-order', fob_price: 32789, currency: 'USD',
    lead_time: '4 to 6 weeks', accessories: 'mats, charger' },
  { id: 2, supplier_id: 9, supplier_name: 'Uniland', brand: 'Geely', model: 'Starray', trim: '',
    model_year: 2026, fob_price: 21000, currency: 'USD', lead_time: '8 weeks', accessories: '' },
];
let fetched = 0;
function api(p) {
  if (/supplier-vehicles$/.test(p)) { fetched++; return CATALOGUE; }
  if (/auth\/check$/.test(p)) return { ok: true };
  if (/purchase-orders\/new\/defaults$/.test(p)) return { po_number: 'PO-1', currency: 'USD', items: [] };
  if (/rfqs\/new\/defaults$/.test(p)) return { rfq_no: 'RFQ-1', items: [] };
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
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname)) });
    }
    if (u.pathname === '/dashboard') return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync('public/dashboard.html', 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
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

  // ── Purchase order ──
  await page.evaluate(() => navigate('purchaseorders'));
  await sleep(500);
  await page.evaluate(() => openPoForm());
  await sleep(500);
  const hasBtn = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(b => /From supplier catalogue/i.test(b.textContent)));
  check('the PO editor offers the catalogue', hasBtn);

  const poFilled = await page.evaluate(async () => {
    document.querySelectorAll('.po-row').forEach(r => r.remove());
    await openCataloguePicker('po');
    await new Promise(r => setTimeout(r, 250));
    document.querySelectorAll('.supcat-cb').forEach(c => { if (c.value === '1') c.checked = true; });
    cataloguePick('po');
    const row = document.querySelector('.po-row');
    const get = k => (row.querySelector(`.po-f[data-k="${k}"]`) || {}).value;
    return { rows: document.querySelectorAll('.po-row').length,
             brand: get('brand'), model: get('model'), trim: get('trim'),
             year: get('year'), price: get('pi_price'), units: get('units'),
             accessories: get('accessories') };
  });
  check('picking a vehicle fills a purchase-order line',
    poFilled.rows === 1 && poFilled.brand === 'BYD' && poFilled.model === 'Seal'
    && poFilled.trim === 'Max' && poFilled.year === '2026' && poFilled.price === '32789'
    && poFilled.units === '1' && /mats/.test(poFilled.accessories), JSON.stringify(poFilled));

  // ── RFQ ──
  await page.evaluate(() => { hdSheetClose(); navigate('rfqs'); });
  await sleep(500);
  await page.evaluate(() => openRfqForm());
  await sleep(500);
  const rfqFilled = await page.evaluate(async () => {
    document.querySelectorAll('.rfq-row').forEach(r => r.remove());
    await openCataloguePicker('rfq');
    await new Promise(r => setTimeout(r, 250));
    document.querySelectorAll('.supcat-cb').forEach(c => { c.checked = true; });   // both
    cataloguePick('rfq');
    const rows = [...document.querySelectorAll('.rfq-row')];
    const get = (r, k) => (r.querySelector(`.rfq-f[data-k="${k}"]`) || {}).value;
    return { n: rows.length,
             first: { brand: get(rows[0], 'brand'), lead: get(rows[0], 'lead_time'), fob: get(rows[0], 'fob_price') },
             second: { brand: get(rows[1], 'brand'), fob: get(rows[1], 'fob_price') } };
  });
  check('picking two vehicles adds two RFQ lines with lead time and FOB',
    rfqFilled.n === 2 && rfqFilled.first.brand === 'BYD' && rfqFilled.first.lead === '4 to 6 weeks'
    && rfqFilled.first.fob === '32789' && rfqFilled.second.brand === 'Geely'
    && rfqFilled.second.fob === '21000', JSON.stringify(rfqFilled));

  const cached = await page.evaluate(async () => { const before = window.__f; await supCatalogue(); return true; });
  check('the catalogue is fetched once and reused', fetched === 1, 'fetches=' + fetched);

  const searchable = await page.evaluate(async () => {
    await openCataloguePicker('rfq');
    await new Promise(r => setTimeout(r, 200));
    supCatFilter('uniland');
    const n = document.querySelectorAll('.supcat-cb').length;
    supCatFilter('');
    return { filtered: n, all: document.querySelectorAll('.supcat-cb').length };
  });
  check('it can be searched by supplier as well as model',
    searchable.filtered === 1 && searchable.all === 2, JSON.stringify(searchable));

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
