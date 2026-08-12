// Phase 2: page persistence, header help button, Home widgets, help docs.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// Identical fixture for both portals; the employee's must come back scoped smaller.
const ADMIN_SUMMARY = {
  my_tasks: [{ id: 1, title: 'Call supplier', due_date: '2026-08-20' }, { id: 2, title: 'Ship VIN 442', due_date: '2026-08-22' }],
  task_status: [{ label: 'todo', count: 6 }, { label: 'done', count: 9 }],
  overdue_tasks: 4, leads_status: [{ label: 'hot', count: 12 }],
  recent_leads: [{ id: 9, name: 'Ahmed', lead_status: 'hot' }],
  followups: [{ id: 1, note: 'Ring back', due_at: '2026-08-12T09:00:00Z' }],
  pipeline: [{ label: 'won', count: 5, value: 1250000 }], won_month: 1250000,
  hours_week: 41, stock_summary: { models: 9, units: 26 },
};
const EMP_SUMMARY = { ...ADMIN_SUMMARY, overdue_tasks: 1, won_month: 100000, hours_week: 7,
  task_status: [{ label: 'todo', count: 2 }], pipeline: [{ label: 'won', count: 1, value: 100000 }] };

let putLayout = null, summaryCalls = 0;
function api(me, p, method, body) {
  if (/home\/layout$/.test(p)) {
    if (method === 'PUT') { putLayout = JSON.parse(body); return putLayout; }
    return putLayout || { widgets: [] };
  }
  if (/home\/summary$/.test(p)) { summaryCalls++; return me === 'admin' ? ADMIN_SUMMARY : EMP_SUMMARY; }
  if (/auth\/check$/.test(p)) return { ok: true };
  if (/employee\/check$/.test(p)) return { id: 2, name: 'Sara', permissions: { leads: true } };
  return [];
}

async function openPortal(browser, o) {
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
        body: JSON.stringify(api(o.me, u.pathname, req.method(), req.postData())) });
    }
    if (u.pathname === o.route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(o.file, 'utf8') });
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
  await page.evaluateOnNewDocument(k => {
    localStorage.setItem(k, 'T');
    window.lucide = { createIcons() {} };     // the CDN is blocked here; startup calls it immediately
  }, o.tokenKey);
  return { page, errs };
}
async function boot(page, o) {
  await page.goto('http://127.0.0.1:' + o.port + o.route, { waitUntil: 'domcontentloaded' });
  await sleep(350);
  await page.evaluate(o.bootstrap);
  await sleep(800);
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  const PORTALS = [
    { label: 'admin', me: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port,
      sections: ['tasks', 'customers', 'deals', 'stock'],
      bootstrap: () => {} },
    { label: 'team', me: 'employee_2', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      sections: ['tasks', 'hours', 'leads'],
      bootstrap: () => { window.empInfo = { id: 2, name: 'Sara' }; window.empPerms = { leads: true };
                         document.getElementById('layout').style.display = ''; } },
  ];

  for (const o of PORTALS) {
    const { page, errs } = await openPortal(browser, o);
    const t = (n, ok, x) => check(o.label + ': ' + n, ok, x);
    await boot(page, o);

    // ── 10. the section survives a refresh ──
    await page.evaluate(() => navigate('home'));
    await sleep(300);
    t('Home is the landing page', await page.evaluate(() => location.hash) === '#home',
      await page.evaluate(() => location.hash));

    for (const sec of o.sections) {
      await page.evaluate(s => navigate(s), sec);
      await sleep(200);
      const hash = await page.evaluate(() => location.hash);
      await boot(page, o);
      const landed = await page.evaluate(() => (document.querySelector('.page.active') || {}).id);
      t(`reload on ${sec} lands back on ${sec}`, landed === 'page-' + sec, `hash=${hash} landed=${landed}`);
    }

    const histLen = await page.evaluate(async () => {
      const before = history.length;
      ['home', 'tasks', 'home', 'tasks'].forEach(p => navigate(p));
      return history.length - before;
    });
    t('navigating does not pile up history entries', histLen === 0, 'grew by ' + histLen);

    // ── 11. help button beside the bell ──
    const hdr = await page.evaluate(() => {
      const h = document.getElementById('help-btn'), b = document.getElementById('notif-bell');
      if (!h || !b) return { ok: false };
      const hr = h.getBoundingClientRect(), br = b.getBoundingClientRect();
      return { ok: true, sameRow: Math.abs(hr.top - br.top) < 6, gap: Math.round(br.left - hr.right),
               fixedFabGone: !document.querySelector('.hb-fab') };
    });
    t('help sits in the header next to the bell',
      hdr.ok && hdr.sameRow && hdr.gap >= 0 && hdr.gap < 40, JSON.stringify(hdr));
    t('the floating help button is gone', hdr.fixedFabGone);

    // ── 8/9. Home widgets ──
    summaryCalls = 0; putLayout = null;
    await page.evaluate(() => navigate('home'));
    await sleep(700);
    const first = await page.evaluate(() => [...document.querySelectorAll('#home-grid .home-w')].map(w => w.dataset.i));
    t('Home renders the default widgets', first.length >= 4, 'count=' + first.length);
    t('summary is fetched once, not once per widget', summaryCalls === 1, 'calls=' + summaryCalls);

    const edited = await page.evaluate(async () => {
      homeToggleEdit();
      homeSetSize(0, 12);
      const h0 = _home.widgets[0].h;
      homeSetHeight(0);
      const h1 = _home.widgets[0].h;
      homeSetHeight(0);
      const h2 = _home.widgets[0].h;
      const before = _home.widgets.length;
      homeRemove(1);
      return { w: _home.widgets[0].w, h0, h1, h2, removed: before - _home.widgets.length,
               editing: _home.editing, span: document.querySelector('#home-grid .home-w').style.gridColumn };
    });
    t('resize, height and remove all take effect',
      edited.w === 12 && edited.h1 !== edited.h0 && edited.h2 === edited.h0
      && edited.removed === 1 && edited.span === 'span 12', JSON.stringify(edited));

    const saved = await page.evaluate(async () => { homeToggleEdit(); await new Promise(r => setTimeout(r, 300)); return _home.widgets.length; });
    t('leaving edit mode saves the layout', putLayout && putLayout.widgets.length === saved, JSON.stringify(putLayout && putLayout.widgets.length));

    await boot(page, o);
    await page.evaluate(() => navigate('home'));
    await sleep(700);
    const after = await page.evaluate(() => ({ n: document.querySelectorAll('#home-grid .home-w').length,
      span: (document.querySelector('#home-grid .home-w') || {}).style?.gridColumn }));
    t('the layout survives a reload', after.n === saved && after.span === 'span 12', JSON.stringify(after));

    // ── 14. help docs ──
    const docs = await page.evaluate(async () => {
      helpOpen();
      await new Promise(r => setTimeout(r, 200));
      const tabOpen = document.getElementById('hb-docs').classList.contains('open');
      const all = document.querySelectorAll('#hb-doc-list .hb-doc').length;
      helpDocSearch('huddle');
      const hits = [...document.querySelectorAll('#hb-doc-list .hb-doc .hb-doc-t')].map(e => e.textContent);
      helpDocOpen('chat-huddles');
      const art = document.querySelector('#hb-doc-view .hb-art');
      const en = { title: art.querySelector('h3').textContent, dir: art.getAttribute('dir'),
                   heads: art.querySelectorAll('h3').length, bullets: art.querySelectorAll('li').length };
      document.getElementById('hb-lang').value = 'ar';
      helpDocOpen('permissions');
      const art2 = document.querySelector('#hb-doc-view .hb-art');
      const ar = { title: art2.querySelector('h3').textContent, dir: art2.getAttribute('dir') };
      document.getElementById('hb-lang').value = 'en';
      helpTab('ask');
      const askOpen = document.getElementById('hb-body').style.display !== 'none';
      return { tabOpen, all, hits, en, ar, askOpen };
    });
    t('docs open by default with every article listed', docs.tabOpen && docs.all >= 8, JSON.stringify({ tabOpen: docs.tabOpen, all: docs.all }));
    t('search finds an article by its body text',
      docs.hits.length >= 1 && docs.hits.some(h => /Chat and huddles/.test(h)), JSON.stringify(docs.hits));
    t('an article renders headings and bullets',
      docs.en.heads > 1 && docs.en.bullets > 0 && docs.en.dir === 'ltr', JSON.stringify(docs.en));
    t('Arabic switches the text and the direction',
      docs.ar.dir === 'rtl' && docs.ar.title !== docs.en.title && /[؀-ۿ]/.test(docs.ar.title), JSON.stringify(docs.ar));
    t('the Ask tab still reaches the bot', docs.askOpen);

    t('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ── employee widgets must be scoped and permission-filtered ──
  {
    const o = PORTALS[1];
    const { page } = await openPortal(browser, { ...o });
    await boot(page, o);
    await page.evaluate(() => navigate('home'));
    await sleep(700);
    const emp = await page.evaluate(() => ({
      catalogue: homeAvailable().map(w => w.id),
      overdue: (_home.data || {}).overdue_tasks,
    }));
    check('team: an employee sees their own numbers, not the company total',
      emp.overdue === EMP_SUMMARY.overdue_tasks && emp.overdue !== ADMIN_SUMMARY.overdue_tasks,
      `emp=${emp.overdue} admin=${ADMIN_SUMMARY.overdue_tasks}`);
    check('team: the catalogue omits sections they cannot open',
      emp.catalogue.includes('leads_status') && !emp.catalogue.includes('pipeline'),
      JSON.stringify(emp.catalogue));
    await page.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
