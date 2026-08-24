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

// 60 rows: enough to exercise the 50-row default page and Load more; the three
// "Hot" ones are the filtered set the select-all case works with.
const LEADS = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  name: i < 3 ? `Hot Lead ${i + 1}` : `Cold Lead ${i + 1}`,
  phone: '010' + i, lead_status: i < 3 ? 'hot' : 'cold',
  source: 'fb_ad', car_in_question: 'Seal', lead_date: '2026-08-' + String((i % 28) + 1).padStart(2, '0'),
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
  if (/(leads\/columns|columns\/leads)$/.test(pathname)) return { columns: [
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
      picked.selected.length === 3 && picked.all === 60, JSON.stringify(picked));
    check('…and the bulk bar says what it is out of', /of 3 filtered/.test(picked.bar), picked.bar);
    const cleared = await page.evaluate(async () => {
      const cb = document.getElementById('select-all-leads');
      cb.checked = false;
      toggleSelectAllLeads(cb);
      return _selectedLeads.size;
    });
    check('unticking clears the same scope', cleared === 0, String(cleared));
    // ── Page size: a cap on RENDERING only ──────────────────────────────────
    const paging = await page.evaluate(async () => {
      localStorage.removeItem('ml_leads_pagesize');
      document.getElementById('customer-search').value = '';
      filterCustomers();
      await new Promise(r => setTimeout(r, 100));
      const rows = () => document.querySelectorAll('#customers-tbody tr[data-id], #customers-tbody tr').length;
      const out = { def: document.querySelectorAll('#customers-tbody tr').length };
      setLeadsPageSize('25');
      out.at25 = document.querySelectorAll('#customers-tbody tr').length;
      out.stored = localStorage.getItem('ml_leads_pagesize');
      setLeadsPageSize('1000');
      out.at1000 = document.querySelectorAll('#customers-tbody tr').length;
      // Search must still see rows beyond the render cap.
      setLeadsPageSize('25');
      document.getElementById('customer-search').value = 'Cold Lead 59';
      filterCustomers();
      await new Promise(r => setTimeout(r, 100));
      out.found = document.querySelectorAll('#customers-tbody tr').length;
      out.foundName = (document.querySelector('#customers-tbody tr td') || {}).textContent || document.querySelector('#customers-tbody tr')?.textContent || '';
      document.getElementById('customer-search').value = '';
      // A re-filter must respect the chosen size, not snap back to the default —
      // this is the line every search and chip toggle goes through.
      filterCustomers();
      await new Promise(r => setTimeout(r, 100));
      out.afterRefilter = document.querySelectorAll('#customers-tbody tr').length;
      return out;
    });
    // Rendered rows = page + the "Load more" footer row when the list overflows.
    check('the default page renders 50 rows of 60', paging.def === 51, JSON.stringify(paging));
    check('25 renders 25', paging.at25 === 26, String(paging.at25));
    check('1000 renders all 60, no footer', paging.at1000 === 60, String(paging.at1000));
    check('the choice persists', paging.stored === '25', String(paging.stored));
    check('re-filtering keeps the chosen size', paging.afterRefilter === 26, String(paging.afterRefilter));
    check('search still reaches a lead beyond the render cap',
      paging.found === 1 && /Cold Lead 59/.test(paging.foundName), JSON.stringify({ n: paging.found, name: paging.foundName.slice(0, 30) }));
    check('the selector exists in both portals',
      /id="leads-pagesize"/.test(fs.readFileSync('public/dashboard.html', 'utf8'))
      && /id="leads-pagesize"/.test(fs.readFileSync('public/employee.html', 'utf8')));

    // ── Top scrollbar: a live proxy above the table ─────────────────────────
    const bar = await page.evaluate(() => {
      const wrap = document.getElementById('leads-scroll');
      const bar = wrap && wrap._mlTopBar;
      if (!wrap || !bar) return { missing: true };
      const before = wrap.scrollLeft;
      bar.scrollLeft = 120;
      bar.dispatchEvent(new Event('scroll'));
      return {
        above: bar.nextElementSibling === wrap,
        ghostWide: bar.firstChild.offsetWidth === wrap.scrollWidth,
        mirrored: wrap.scrollLeft !== before && Math.abs(wrap.scrollLeft - bar.scrollLeft) <= 1,
      };
    });
    check('a scrollbar proxy sits directly ABOVE the leads table', bar.above === true, JSON.stringify(bar));
    check('…sized to the table', bar.ghostWide === true, JSON.stringify(bar));
    check('…and dragging it scrolls the table', bar.mirrored === true, JSON.stringify(bar));

    // ── The client-file upload names its destination ────────────────────────
    // The sales UI lives in the shared procurement.js now (the Sales tab became
    // a permission and both portals render it).
    const procSrc = fs.readFileSync('public/assets/procurement.js', 'utf8');
    check('the upload hint names the Drive folder',
      /MotoLinker \/ Client Files<\/strong> · up to 25 MB/.test(procSrc));
    check('…and the success message links the uploaded file',
      /Saved to Drive → MotoLinker \/ Client Files/.test(procSrc) && /meta\.name \|\| 'open the file'/.test(procSrc));

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
        suppliersGroup: groupOf('nav-suppliers'),
        submissionsGroup: groupOf('nav-submissions'),
        rfqGroup: groupOf('nav-rfq'),
        groups: [...document.querySelectorAll('#sidebar .nav-group')].map(x => x.dataset.group),
        requestsHidden: getComputedStyle(document.getElementById('nav-requests')).display === 'none',
        whatsappExists: !!document.getElementById('nav-whatsapp'),
      };
    });
    check("the admin's marketing rename does not retitle the portal's Chat group",
      nav.chatLabel === 'Chat', String(nav.chatLabel));
    // The portal used to keep a section of its own, "Operations", because Tools
    // was gated on quotation alone and contracts would have hidden under a
    // heading its owner could not see. The gate covers all four now, so the
    // portal files them where the admin does — and the shared nav-config, which
    // matches groups BY KEY, finally reaches every section instead of leaving a
    // portal-only one behind.
    // Order here is the CONFIG's, not the shipped one — that is the point of the
    // config. What matters is the set: no section of the portal's own invention
    // is left behind for the arrangement to miss.
    check('every section the portal ships is one the admin ships too',
      [...nav.groups].sort().join(',') === 'chat,crm,google,integrations,logistics,management,system',
      nav.groups.join(','));
    check('RFQ still lands in Tools although the config names the admin\'s id',
      nav.rfqGroup === 'integrations', String(nav.rfqGroup));
    check('contracts and purchase orders sit under Tools, as they do for the admin',
      nav.contractsGroup === 'integrations' && nav.poGroup === 'integrations',
      `${nav.contractsGroup}/${nav.poGroup}`);
    check('suppliers under Logistics & Shipping, submissions under CRM — likewise',
      nav.suppliersGroup === 'logistics' && nav.submissionsGroup === 'crm',
      `${nav.suppliersGroup}/${nav.submissionsGroup}`);
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
