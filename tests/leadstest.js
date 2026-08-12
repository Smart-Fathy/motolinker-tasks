// The leads table in the team portal: filters, a usable scrollbar, and a create form
// whose dropdowns agree with the column they write to.
//
// The column options are editable and shared between the portals, so anything that
// hardcodes them is wrong the moment someone renames one. That is the case this
// fixture builds: a renamed status and an extra one, neither of which appears in any
// hardcoded list.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// 'warm' renamed, 'qualified' added, 'blacklist' removed — none of which the hardcoded
// markup knows about.
const STATUS_OPTIONS = [
  { key: 'cold', label: 'Cold' },
  { key: 'warm', label: 'Lukewarm' },
  { key: 'hot', label: 'Hot' },
  { key: 'qualified', label: 'Qualified' },
];
const COLS = [
  { key: 'lead_date', label: 'Date', type: 'date', builtin: true, visible: true },
  { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true },
  { key: 'phone', label: 'Phone', type: 'text', builtin: true, visible: true },
  { key: 'lead_status', label: 'Status', type: 'select', builtin: true, visible: true, options: STATUS_OPTIONS },
  { key: 'source', label: 'Origin', type: 'select', builtin: true, visible: true,
    options: [{ key: 'fb_ad', label: 'FB Ad.' }, { key: 'website', label: 'Website' }] },
  { key: 'car_in_question', label: 'Car', type: 'text', builtin: true, visible: true },
  { key: 'next_action', label: 'Next Action', type: 'select', builtin: true, visible: true,
    options: [{ key: 'closed', label: 'Closed' }, { key: 'no_answer', label: 'No Answer' }] },
  { key: 'owner', label: 'Owner', type: 'text', builtin: true, visible: true },
];
const LEADS = [
  { id: 1, name: 'Ahmed Kamal', phone: '0100', lead_status: 'hot', source: 'fb_ad', car_in_question: 'Tiggo 8', lead_date: '2026-08-01' },
  { id: 2, name: 'Mona Said', phone: '0101', lead_status: 'warm', source: 'website', car_in_question: 'Song Plus', lead_date: '2026-08-02' },
  { id: 3, name: 'Omar Nabil', phone: '0102', lead_status: 'qualified', source: 'fb_ad', car_in_question: 'Seal', lead_date: '2026-08-03' },
];

function api(pathname) {
  if (/leads\/columns$/.test(pathname)) return { columns: COLS };
  if (/employee\/leads$/.test(pathname)) return LEADS;
  if (/employee\/check$/.test(pathname)) return { id: 2, name: 'Sara', permissions: { leads: true } };
  if (/coworkers|employees$/.test(pathname)) return [{ id: 2, name: 'Sara' }];
  if (/followups/.test(pathname)) return [];
  return [];
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
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
    if (u.pathname === '/employee') return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync('public/employee.html', 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('ml_emp_token', 'T');
    localStorage.removeItem('ml_emp_lead_filters');
    window.lucide = { createIcons() {} };
  });
  await page.goto('http://127.0.0.1:' + port + '/employee', { waitUntil: 'domcontentloaded' });
  await sleep(400);
  await page.evaluate(() => {
    window.empInfo = { id: 2, name: 'Sara' };
    // Through applyPermissions, not by assigning empPerms: it is what stamps
    // dataset.permitted on each page, and navigate() refuses a page without it.
    applyPermissions({ leads: true, leadsActions: { view: true, create: true, edit: true } });
    document.getElementById('layout').style.display = 'flex';   // what showApp() sets
  });
  await page.evaluate(() => navigate('leads'));
  await sleep(800);

  // ── 1. The create form's dropdowns come from the column config ──
  await page.evaluate(() => openEmpLeadModal());
  await sleep(300);
  const opts = await page.evaluate(() => {
    const read = id => [...(document.getElementById(id) || { options: [] }).options]
      .map(o => o.value + ':' + o.textContent);
    return { status: read('eml-status'), source: read('eml-source'), next: read('eml-next-action') };
  });
  check('the status dropdown matches the configured options exactly',
    opts.status.join('|') === 'cold:Cold|warm:Lukewarm|hot:Hot|qualified:Qualified',
    JSON.stringify(opts.status));
  check('a renamed option shows its new label, not the hardcoded one',
    opts.status.includes('warm:Lukewarm') && !opts.status.some(o => /Warm$/.test(o)),
    JSON.stringify(opts.status));
  check('an option removed from the config is gone from the form',
    !opts.status.some(o => o.startsWith('blacklist')), JSON.stringify(opts.status));
  check('origin and next action are configured too',
    opts.source.join('|') === ':— Unknown —|fb_ad:FB Ad.|website:Website'
    && opts.next.join('|') === ':— None —|closed:Closed|no_answer:No Answer',
    JSON.stringify({ source: opts.source, next: opts.next }));
  await page.evaluate(() => { const m = document.getElementById('emp-lead-modal'); if (m) m.style.display = 'none'; });

  // ── 2. Filters ──
  const rowCount = () => page.evaluate(() =>
    document.querySelectorAll('#emp-leads-tbody tr').length);
  check('all leads are listed to begin with', await rowCount() === LEADS.length, String(await rowCount()));

  const filtered = await page.evaluate(() => {
    _leadFilters = [{ key: 'lead_status', op: 'is', a: 'hot' }];
    empFilterLeads();
    return [...document.querySelectorAll('#emp-leads-tbody tr')].map(tr => tr.textContent);
  });
  check('a status filter narrows the table', filtered.length === 1 && /Ahmed/.test(filtered[0]),
    JSON.stringify(filtered.map(t => t.slice(0, 30))));

  const renamed = await page.evaluate(() => {
    // The saved filter holds a key; renaming the label must not break the match.
    _leadFilters = [{ key: 'lead_status', op: 'is', a: 'warm' }];
    empFilterLeads();
    return [...document.querySelectorAll('#emp-leads-tbody tr')].map(tr => tr.textContent);
  });
  check('a filter still matches after its option was renamed',
    renamed.length === 1 && /Mona/.test(renamed[0]), JSON.stringify(renamed.map(t => t.slice(0, 30))));

  const notOp = await page.evaluate(() => {
    _leadFilters = [{ key: 'source', op: 'is_not', a: 'fb_ad' }];
    empFilterLeads();
    return document.querySelectorAll('#emp-leads-tbody tr').length;
  });
  check('"is not" excludes rather than includes', notOp === 1, String(notOp));

  const textOp = await page.evaluate(() => {
    _leadFilters = [{ key: 'car_in_question', op: 'contains', a: 'seal' }];
    empFilterLeads();
    return document.querySelectorAll('#emp-leads-tbody tr').length;
  });
  check('a text filter is case-insensitive', textOp === 1, String(textOp));

  const persisted = await page.evaluate(() => {
    _leadFilters = [{ key: 'lead_status', op: 'is', a: 'hot' }];
    saveLeadFilters();
    return localStorage.getItem('ml_emp_lead_filters');
  });
  check('filters are saved under a team-portal key', /lead_status/.test(persisted || ''), String(persisted));

  const cleared = await page.evaluate(() => { clearLeadFilters(); return document.querySelectorAll('#emp-leads-tbody tr').length; });
  check('clearing restores every row', cleared === LEADS.length, String(cleared));

  const chips = await page.evaluate(() => {
    _leadFilters = [{ key: 'lead_status', op: 'is', a: 'qualified' }];
    empFilterLeads();
    const el = document.getElementById('emp-lead-filter-chips');
    return { shown: el && el.style.display !== 'none', text: el ? el.textContent : '' };
  });
  check('an active filter is shown as a chip with its label',
    chips.shown && /Qualified/.test(chips.text), JSON.stringify(chips));
  await page.evaluate(() => clearLeadFilters());

  // ── 3. The table can be scrolled sideways, and the first column stays put ──
  const scroll = await page.evaluate(() => {
    const wrap = document.querySelector('#page-leads .table-scroll');
    if (!wrap) return { err: 'no .table-scroll wrapper' };
    const cs = getComputedStyle(wrap);
    const firstCell = document.querySelector('#emp-leads-tbody tr td');
    const beforeX = firstCell.getBoundingClientRect().left;
    wrap.scrollLeft = 400;
    const afterX = firstCell.getBoundingClientRect().left;
    return {
      overflowX: cs.overflowX,
      scrollbarWidth: cs.scrollbarWidth,
      scrollable: wrap.scrollWidth > wrap.clientWidth,
      scrollW: wrap.scrollWidth, clientW: wrap.clientWidth,
      tableW: (wrap.querySelector('table') || {}).offsetWidth,
      scrolled: wrap.scrollLeft > 0,
      sticky: getComputedStyle(firstCell).position,
      movedBy: Math.round(afterX - beforeX),
    };
  });
  check('the leads table scrolls sideways', scroll.overflowX === 'auto' && scroll.scrollable && scroll.scrolled,
    JSON.stringify(scroll));
  check('and its scrollbar is not hidden by the global rule',
    scroll.scrollbarWidth !== 'none', JSON.stringify(scroll));
  check('the first column is frozen while the rest scrolls',
    scroll.sticky === 'sticky' && Math.abs(scroll.movedBy) <= 1, JSON.stringify(scroll));

  // ── 4. Visiting Deals must not replace the Leads rows ──
  // loadEmpDeals fetches a slim {id,name,phone} list for its lead picker, and used to
  // assign it straight over _empLeads — the same array the table and now the filters
  // read, leaving rows with no status, car or dates behind.
  const afterDeals = await page.evaluate(async () => {
    await loadEmpDeals().catch(() => {});
    return { rows: _empLeads.length, first: _empLeads[0], picker: (_empLeadOptions || []).length };
  });
  check('the leads rows survive a trip to Deals with their fields intact',
    afterDeals.rows === 3 && afterDeals.first && afterDeals.first.lead_status === 'hot',
    JSON.stringify(afterDeals));

  check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));

  await browser.close(); srv.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} leads checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
