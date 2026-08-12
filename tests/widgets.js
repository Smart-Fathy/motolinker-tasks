// Every Home widget, rendered for real in both portals.
//
// The catalogue covers every section of the app now, and each widget is five pieces
// spread over two files: a catalogue entry, a body, a permission gate, a source list
// and a producer. Miss one and the tile renders the default em dash without anyone
// noticing — which is indistinguishable from "no data yet". So: place all of them,
// render them, and require each to say something.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// The widget ids the server knows, read from the server module so this cannot drift.
const SERVER_SRC = fs.readFileSync('src/routes/home.js', 'utf8');
const SERVER_IDS = (SERVER_SRC.match(/^  ([a-z_]+):\s+\{ gate:/gm) || [])
  .map(l => l.trim().split(':')[0]);

// One fixture covering every server-produced widget. Values are deliberately
// distinctive so an empty render is obvious.
const SUMMARY = {
  my_tasks: [{ id: 1, title: 'Call the supplier', due_date: '2026-09-01' }],
  task_status: [{ label: 'todo', count: 4 }, { label: 'done', count: 7 }],
  overdue_tasks: 3,
  leads_status: [{ label: 'hot', count: 5 }],
  recent_leads: [{ id: 1, name: 'Ahmed Kamal', lead_status: 'hot' }],
  followups: [{ id: 1, note: 'Ring back', due_at: '2026-08-20T09:00:00Z' }],
  pipeline: [{ label: 'won', count: 2, value: 900000 }],
  won_month: 900000,
  hours_week: 37.5,
  stock_summary: { models: 4, units: 11 },
  stock_models: [{ id: 1, label: 'BYD Song', count: 6 }],
  my_requests: [{ label: 'open', count: 2 }],
  approvals: [{ id: 1, label: 'Lead: Mona', by: 'employee_2' }],
  quotation_recent: [{ id: 1, label: 'Q-1042', created_at: '2026-08-01' }],
  contracts_recent: [{ id: 1, label: 'C-88', status: 'signed', created_at: '2026-08-02' }],
  sales_month: { count: 3, value: 2400000 },
  suppliers_top: [{ label: 'Abo Hetta', count: 4 }],
  rfq_open: [{ id: 1, label: 'RFQ-7', sub: 'Chery', created_at: '2026-08-03' }],
  po_status: [{ label: 'issued', count: 2 }],
  submissions_recent: [{ id: 1, label: 'Website form', sub: 'Tiggo 8', created_at: '2026-08-04' }],
  automations_active: { active: 3, total: 5 },
  team_roster: [{ id: 2, name: 'Sara Nabil', job_title: 'Sales', avatar: null, online: true }],
  whatsapp_recent: [{ id: 1, label: 'Is the car available?', sub: 'in', created_at: '2026-08-05' }],
  issues_open: [{ id: 1, label: 'PDF export fails', sub: 'Sara', created_at: '2026-08-06' }],
};
const CALENDAR = { connected: true, events: [{ id: 'e1', title: 'Supplier call', start: '2026-08-20T10:00:00Z', allDay: false }] };
const DRIVE = [{ id: 'f1', name: 'Passport scan.pdf', webViewLink: 'https://drive.google.com/x', modifiedTime: '2026-08-01T00:00:00Z' }];
const EMAIL = [{ id: 'm1', subject: 'Shipping update', from: 'Ops <ops@x.com>', unread: true }];

let savedLayout = null;

function api(pathname, method, body, allowed) {
  if (/home\/layout$/.test(pathname)) {
    if (method === 'PUT') { savedLayout = JSON.parse(body); return savedLayout; }
    return savedLayout || { widgets: [] };
  }
  if (/home\/summary$/.test(pathname))  return { ...SUMMARY, allowed, partial: [] };
  if (/home\/calendar$/.test(pathname)) return CALENDAR;
  if (/drive\/(files|sheets)$/.test(pathname)) return DRIVE;
  if (/email\/messages$/.test(pathname)) return EMAIL;
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { id: 2, name: 'Sara', permissions: { leads: true } };
  return [];
}

async function openPortal(browser, o, allowed) {
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
        body: JSON.stringify(api(u.pathname, req.method(), req.postData(), allowed)) });
    }
    if (u.pathname === o.route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(o.file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(k => {
    localStorage.setItem(k, 'T');
    window.lucide = { createIcons() {} };
  }, o.tokenKey);
  return { page, errs };
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  const PORTALS = [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token',
      bootstrap: () => {} },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token',
      bootstrap: () => { window.empInfo = { id: 2, name: 'Sara' }; window.empPerms = { leads: true };
                         document.getElementById('layout').style.display = ''; } },
  ];

  for (const o of PORTALS) {
    // Everything the client knows about, so every body is exercised in both portals.
    const { page, errs } = await openPortal(browser, o, null);
    await page.goto('http://127.0.0.1:' + port + o.route, { waitUntil: 'domcontentloaded' });
    await sleep(350);
    await page.evaluate(o.bootstrap);
    await sleep(500);

    const t = (n, ok, x) => check(o.label + ': ' + n, ok, x);

    // The two catalogues have to agree, or a widget is addable and never filled in.
    const clientIds = await page.evaluate(() => Object.keys(HOME_WIDGETS));
    const missingOnClient = SERVER_IDS.filter(id => !clientIds.includes(id));
    const missingOnServer = clientIds.filter(id => !SERVER_IDS.includes(id));
    t('every server widget has a client definition', !missingOnClient.length, missingOnClient.join(', '));
    t('every client widget is known to the server', !missingOnServer.length, missingOnServer.join(', '));

    // Navigate first — arriving on Home runs loadHome, which replaces the layout with
    // whatever the server returned. Place every widget after that, then render.
    await page.evaluate(() => navigate('home'));
    await sleep(500);
    await page.evaluate(() => {
      // Two widgets read live page state rather than the summary. Seed it, so their
      // bodies are exercised too instead of honestly reporting nothing.
      notifItems = [{ id: 1, title: 'Task assigned', body: 'Ship VIN 442', read: false }];
      _home.allowed = Object.keys(HOME_WIDGETS);
      _home.widgets = Object.keys(HOME_WIDGETS).map(id => ({ id, w: 4, h: 2 }));
      homeRender();
      return homeLoadAsync();
    });
    await sleep(700);

    const rendered = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#home-grid .home-w').forEach((sec, i) => {
        const title = sec.querySelector('.home-w-title').textContent;
        out[_home.widgets[i].id] = { title, body: sec.querySelector('.home-w-body').textContent.trim() };
      });
      return out;
    });

    const placed = Object.keys(rendered);
    t('every widget produced a tile', placed.length === clientIds.length,
      `${placed.length}/${clientIds.length}`);

    const blank = placed.filter(id => rendered[id].body === '—' || rendered[id].body === '');
    t('no widget fell through to the default body', !blank.length, blank.join(', '));

    const empty = placed.filter(id => /^Nothing yet$/.test(rendered[id].body));
    t('every widget with fixture data rendered it', !empty.length, empty.join(', '));

    const untitled = placed.filter(id => !rendered[id].title);
    t('every widget has a title', !untitled.length, untitled.join(', '));

    // A couple of specific bodies, so "not blank" cannot pass on placeholder text.
    t('the calendar widget shows the event', /Supplier call/.test(rendered.calendar.body), rendered.calendar.body);
    t('notifications come from the live bell state', /Task assigned/.test(rendered.notifications.body), rendered.notifications.body);
    t('the team widget shows the person', /Sara/.test(rendered.team_roster.body), rendered.team_roster.body);
    t('Drive shows the file', /Passport scan/.test(rendered.drive_recent.body), rendered.drive_recent.body);
    t('unread email is filtered to unread', /Shipping update/.test(rendered.email_unread.body), rendered.email_unread.body);

    t('no page errors while rendering the whole catalogue', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ── The Add list follows the server, not the client's own guess ──
  {
    const o = PORTALS[1];
    const allowed = ['my_tasks', 'task_status', 'calendar'];
    const { page } = await openPortal(browser, o, allowed);
    await page.goto('http://127.0.0.1:' + port + o.route, { waitUntil: 'domcontentloaded' });
    await sleep(350);
    // Deliberately generous client-side permissions: if the client were still the
    // authority this would offer pipeline, which the server did not allow.
    await page.evaluate(() => { window.empPerms = { leads: true, deals: true, quotation: true };
                                document.getElementById('layout').style.display = ''; });
    await page.evaluate(() => navigate('home'));
    await sleep(700);

    const cat = await page.evaluate(() => homeAvailable().map(w => w.id));
    check('team: the Add list is exactly what the server allowed',
      cat.length === allowed.length && allowed.every(id => cat.includes(id)), JSON.stringify(cat));
    check('team: a widget the server withheld is not offered even when the client would allow it',
      !cat.includes('pipeline'), JSON.stringify(cat));
    await page.close();
  }

  await browser.close(); srv.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} widget checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
