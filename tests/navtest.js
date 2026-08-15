// Two user-reported production bugs, reproduced against the real bundles.
//
// 1. Leads select-all: with a filter active, the header checkbox selected every
//    lead in the database — and the only bulk action is Delete.
// 2. Nav leaking: the shared nav_config let an admin rename ("MRK & REACH") and
//    the admin's own grouping bleed into the team portal, so employees with the
//    same permissions saw different sidebars depending on unrelated grants.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const LEADS = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: i < 3 ? `Hot Lead ${i + 1}` : `Cold Lead ${i + 1}`,
  phone: '010' + i, lead_status: i < 3 ? 'hot' : 'cold',
  source: 'fb_ad', car_in_question: 'Seal', lead_date: '2026-08-0' + ((i % 8) + 1),
}));

// The admin's arrangement: chat group renamed to the marketing label and carrying
// WhatsApp (which the portal doesn't have); contracts filed under the
// quotation-gated tools group; the requests item hidden by the admin.
const NAV_CFG = { groups: [
  { key: 'management', label: '', items: [
    { id: 'nav-home' }, { id: 'nav-tasks' }, { id: 'nav-requests', hidden: true }, { id: 'nav-hours' }, { id: 'nav-log' },
  ] },
  { key: 'integrations', label: 'Tools', items: [
    { id: 'nav-quotation' }, { id: 'nav-contracts' }, { id: 'nav-rfqs' }, { id: 'nav-purchaseorders' },
  ] },
  { key: 'chat', label: 'MRK & REACH', items: [{ id: 'nav-chat' }, { id: 'nav-whatsapp' }] },
] };

function api(pathname) {
  if (/nav-config$/.test(pathname)) return NAV_CFG;
  if (/leads\/columns$/.test(pathname)) return { columns: [
    { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
    { key: 'phone', label: 'Phone', type: 'text', builtin: true, visible: true },
    { key: 'lead_status', label: 'Status', type: 'select', builtin: true, visible: true,
      options: [{ key: 'cold', label: 'Cold' }, { key: 'hot', label: 'Hot' }] },
  ] };
  if (/dashboard\/customers$/.test(pathname)) return LEADS;
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { ok: true, id: 2, name: 'Sara', username: 'sara', permissions: {} };
  return [];
}

async function openPortal(browser, { route, file, tokenKey, port }) {
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
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(k => localStorage.setItem(k, 'test-token'), tokenKey);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' });
  await sleep(600);
  return { page, errs };
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  // ── Select-all under a filter selects the filter, not the database ──────────
  {
    const { page, errs } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    await page.evaluate(() => navigate('customers'));
    await sleep(500);
    const picked = await page.evaluate(async () => {
      document.getElementById('customer-search').value = 'Hot';
      filterCustomers();
      await new Promise(r => setTimeout(r, 100));
      const cb = document.getElementById('select-all-leads');
      cb.checked = true;
      toggleSelectAllLeads(cb);
      return { selected: [..._selectedLeads].sort((a, b) => a - b), all: _allCustomers.length,
               bar: document.getElementById('leads-bulk-count')?.textContent || '' };
    });
    check('select-all under a filter selects only the filtered leads',
      picked.selected.length === 3 && picked.all === 8, JSON.stringify(picked));
    check('…and the bulk bar says what it is out of', /of 3 filtered/.test(picked.bar), picked.bar);
    const cleared = await page.evaluate(async () => {
      const cb = document.getElementById('select-all-leads');
      cb.checked = false;
      toggleSelectAllLeads(cb);
      return _selectedLeads.size;
    });
    check('unticking clears the same scope', cleared === 0, String(cleared));
    check('admin: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── The shared nav config cannot leak admin structure into the portal ──────
  {
    const { page, errs } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port });
    await sleep(400);   // loadNavConfig is fire-and-forget inside applyPermissions
    const nav = await page.evaluate(() => {
      const g = [...document.querySelectorAll('#sidebar .nav-group')];
      const groupOf = id => document.getElementById(id)?.closest('.nav-group')?.dataset.group || null;
      const label = key => {
        const el = g.find(x => x.dataset.group === key);
        return el ? (el.querySelector('.nav-group-label')?.textContent || '').trim() : null;
      };
      return {
        chatLabel: label('chat'),
        contractsGroup: groupOf('nav-contracts'),
        poGroup: groupOf('nav-purchaseorders'),
        requestsHidden: getComputedStyle(document.getElementById('nav-requests')).display === 'none',
        whatsappExists: !!document.getElementById('nav-whatsapp'),
      };
    });
    check("the admin's marketing rename does not retitle the portal's Chat group",
      nav.chatLabel === 'Chat', String(nav.chatLabel));
    check('contracts stays in the Operations group, not the quotation-gated Tools',
      nav.contractsGroup === 'operations', String(nav.contractsGroup));
    check('purchase orders likewise', nav.poGroup === 'operations', String(nav.poGroup));
    check('an item the admin hid is hidden here too', nav.requestsHidden === true, String(nav.requestsHidden));
    check('and no WhatsApp item was invented', nav.whatsappExists === false);

    // The narrowing rule: hidden flags may hide, but an UNhidden config entry
    // must never resurrect a section the employee has no permission for.
    const resurrect = await page.evaluate(() => {
      const el = document.getElementById('nav-leads');
      return el ? getComputedStyle(el).display : 'missing';
    });
    check('a section without permission stays hidden regardless of the config',
      resurrect === 'none', resurrect);
    check('team: no page errors', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
