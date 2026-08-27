// The three things users reported from production, each driven end to end against
// the real shipped bundles. Every one of them failed here before it was fixed, so
// this file is the record of what "fixed" meant:
//
//   1. The PO PDF button threw on the team portal — renderPoPdf reached for a
//      po-modal that only dashboard.html has:
//        TypeError: Cannot read properties of null (reading 'removeAttribute')
//   2. A request's description was captured, stored and returned, and shown
//      nowhere it could be read — the list clips it to one 200px line and the
//      detail view went straight from the title to the comments.
//   3. On a phone, opening a long dropdown (Owner in the leads pool) focused its
//      search box, which raised the keyboard, which fired a resize, which closed
//      the menu — "it appears, then the keyboard opens, then both disappear".
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const PERMS = { purchaseorders: true, purchaseordersActions: { view: true, create: true, edit: true, export: true },
  requests: true, requestsActions: { view: true, create: true },
  leads: true, leadsActions: { view: true, edit: true }, tasks: true, hours: true };
const POS = [{ id: 1, po_number: 'PO2608-3544', title: 'YU motors', supplier: 'YU motors', currency: 'USD',
  status: 'confirmed', po_date: '2026-08-27',
  items: [{ client: 'A', brand: 'Toyota', model: 'Corolla', units: 1, pi_price: 17734 }] }];
const DESC = 'The 65W one for the Dell in the showroom.\nMine stopped charging on Tuesday.';
const REQS = [{ id: 7, title: 'Need a laptop charger', description: DESC, category: 'Equipment',
  priority: 'high', status: 'pending', created_by: 'sara', assignee_id: 9, created_at: '2026-08-25T09:00:00Z' }];
const REPS = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, name: 'Rep ' + (i + 1) }));

function api(p) {
  if (/employee\/check$/.test(p)) return { ok: true, id: 2, name: 'Sara', username: 'sara', job_title: 'Sales', permissions: PERMS };
  if (/auth\/check$/.test(p)) return { ok: true };
  if (/purchase-orders\/pdf$/.test(p)) return { pdf: Buffer.from('%PDF-1.4 test').toString('base64') };
  if (/purchase-orders\/1$/.test(p)) return POS[0];
  if (/purchase-orders$/.test(p)) return POS;
  if (/requests\/7\/comments$/.test(p)) return [];
  if (/requests$/.test(p)) return REQS;
  if (/coworkers|employees/.test(p)) return REPS;
  if (/nav-config$/.test(p)) return { groups: [] };
  if (/nav-favourites$/.test(p)) return { favourites: [] };
  if (/stats$/.test(p)) return { total: 0, done: 0, inProgress: 0, todo: 0, overdue: 0, highPriority: 0, byStatus: {}, byPriority: {} };
  if (/home\/layout$/.test(p)) return { widgets: [] };
  if (/columns/.test(p)) return { columns: [] };
  return [];
}

async function openPortal(browser, { route, file, tokenKey, port }) {
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};window.Chart=function(){this.destroy=function(){}};window.Chart.register=function(){};' });
    if (u.pathname.startsWith('/api/')) {
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
  await page.evaluateOnNewDocument(k => localStorage.setItem(k, 't'), tokenKey);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  return { page, errs };
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });

  // ── 1. The purchase-order PDF, in BOTH portals ────────────────────────────
  // It is the same shared module either side; only the admin shipped the modal
  // it used to reach for, which is exactly why nobody caught it.
  for (const portal of [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token' },
    { label: 'team',  route: '/employee',  file: 'public/employee.html',  tokenKey: 'ml_emp_token' },
  ]) {
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(() => navigate('purchaseorders'));
    await sleep(700);
    await page.evaluate(() => previewPo(1));
    await sleep(700);
    const pdf = await page.evaluate(() => {
      const m = document.getElementById('doc-modal');
      const f = document.getElementById('doc-preview-frame');
      return { open: !!m && getComputedStyle(m).display !== 'none',
        title: document.getElementById('doc-modal-title')?.textContent || '',
        blob: !!(f && f.src && f.src.startsWith('blob:')) };
    });
    check(`${portal.label}: the PO PDF opens the viewer this portal actually has`,
      pdf.open && pdf.blob, JSON.stringify(pdf));
    check(`${portal.label}: …titled with the PO number`, pdf.title === 'Purchase order PO2608-3544', pdf.title);
    check(`${portal.label}: …and nothing threw on the way`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── 2. The request description ────────────────────────────────────────────
  {
    const { page } = await openPortal(browser, { route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port });
    await page.evaluate(() => navigate('requests'));
    await sleep(800);
    await page.evaluate(() => openEmpReqComments(7));
    await sleep(400);
    const seen = await page.evaluate(() => {
      const d = document.getElementById('empc-desc');
      return { shown: !!d && getComputedStyle(d).display !== 'none', text: d ? d.innerText : '' };
    });
    check('the receiver can read the whole request, not one clipped line',
      seen.shown && seen.text.includes('65W') && seen.text.includes('Tuesday'),
      JSON.stringify(seen.text.replace(/\s+/g, ' ').slice(0, 70)));
    // A task carries its description on the card, so the panel must not linger.
    // Read defensively: on the code this guards, neither the helper nor the panel
    // exists, and a test that throws reports nothing about the checks after it.
    const cleared = await page.evaluate(() => {
      if (typeof empcSetDescription !== 'function') return 'no helper';
      empcSetDescription('');
      const d = document.getElementById('empc-desc');
      return d ? getComputedStyle(d).display === 'none' : 'no panel';
    });
    check('…and it is cleared for anything that is not a request', cleared === true, String(cleared));
    await page.close();
  }

  // ── 3. The dropdown the keyboard used to close ────────────────────────────
  {
    const { page, errs } = await openPortal(browser, { route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port });
    await page.evaluate(() => navigate('leads'));
    await sleep(800);
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find(s => s.options.length > 8) || document.querySelector('select');
      const trig = sel && sel.parentElement.querySelector('.bselect-trigger');
      (trig || sel).click();
    });
    await sleep(300);
    const opened = await page.evaluate(() => {
      const m = document.querySelector('.bselect-menu');
      return { open: !!m && m.classList.contains('open'),
        opts: m ? m.querySelectorAll('.bselect-opt').length : 0,
        searchFocused: document.activeElement === document.querySelector('.bselect-search') };
    });
    check('a long dropdown opens on a phone', opened.open && opened.opts > 8, JSON.stringify(opened));
    check('…without grabbing focus, which is what raises the keyboard',
      opened.searchFocused === false, String(opened.searchFocused));

    // The keyboard: height shrinks, width does not.
    await page.evaluate(() => {
      Object.defineProperty(window, 'innerHeight', { value: Math.round(window.innerHeight * 0.55), configurable: true });
      window.dispatchEvent(new Event('resize'));
    });
    await sleep(250);
    const survived = await page.evaluate(() => {
      const m = document.querySelector('.bselect-menu');
      return !!m && m.classList.contains('open');
    });
    check('…and a height-only resize — a keyboard — leaves it open', survived === true);

    // A rotation changes the width, and should still close it.
    await page.evaluate(() => {
      Object.defineProperty(window, 'innerWidth', { value: 844, configurable: true });
      window.dispatchEvent(new Event('resize'));
    });
    await sleep(250);
    const closedOnRotate = await page.evaluate(() => {
      const m = document.querySelector('.bselect-menu');
      return !(m && m.classList.contains('open'));
    });
    check('…while a real resize still closes it', closedOnRotate === true);
    check('no page errors while doing any of that', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // The dropdown lives in both bundles as a near-verbatim copy. Until it moves to
  // a shared file, the least this can do is refuse to let them drift.
  {
    const grab = f => {
      const s = fs.readFileSync(f, 'utf8');
      const i = s.indexOf('// ── Brand dropdowns');
      return s.slice(i, s.indexOf('function labelFor(sel)', i))
        .replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
    };
    check('both portals carry the same dropdown, comments aside',
      grab('public/assets/dashboard.js') === grab('public/assets/employee.js'));
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
