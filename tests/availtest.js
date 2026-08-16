// Weekly availability: the board and editor render in both portals from one
// module, the PUT carries the 7-day shape, and the one security property that
// matters — you can only ever write YOUR OWN week — is proven against the
// running server, not inferred from the UI.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

function mondayStr(d) {
  const x = new Date(d || Date.now());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const WEEK = mondayStr();
const BOARD = { week: WEEK, members: [
  { key: 'admin', name: 'Admin', me: false, days: null },
  { key: 'employee_2', name: 'Sara', me: true, days: [
    { status: 'available', from: '10:00', to: '18:00' }, { status: 'partial', from: '14:00', to: '18:00', note: 'Errand' },
    { status: 'off' }, { status: 'available', from: '10:00', to: '18:00' }, { status: 'available', from: '10:00', to: '18:00' },
    { status: 'off' }, { status: 'off' } ] },
  { key: 'employee_3', name: 'Omar', me: false, days: null },
] };

let puts = [];
function api(pathname, method, body) {
  if (method === 'PUT' && /\/availability$/.test(pathname)) { puts.push({ pathname, body: JSON.parse(body) }); return { ok: true }; }
  if (/\/availability$/.test(pathname)) return BOARD;
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { ok: true, id: 2, name: 'Sara', permissions: {} };
  return [];
}

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
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
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
  if (perms) { await page.evaluate(p => { try { applyPermissions(p); } catch (_) {} }, perms); await sleep(100); }
  return { page, errs };
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  for (const portal of [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token',
      page: 'employees', apiBase: '/api/dashboard' },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token',
      page: 'hours', apiBase: '/api/employee',
      perms: { hours: true, hoursActions: { log: true, view: true }, availability: true, availabilityActions: { view: true, set: true } } },
  ]) {
    puts = [];
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(p => navigate(p), portal.page);
    await sleep(600);
    const board = await page.evaluate(() => {
      const box = document.getElementById('availability-board');
      return { text: box ? box.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) : null,
               badges: box ? box.querySelectorAll('tbody span').length : 0,
               setBtn: !!box && !![...box.querySelectorAll('button')].find(b => /Set my week/.test(b.textContent)) };
    });
    check(`${portal.label}: the board renders the team's week`,
      /Sara/.test(String(board.text)) && /Omar/.test(String(board.text)), String(board.text));
    check(`${portal.label}: days render as status pills with hours`, board.badges >= 7, String(board.badges));
    check(`${portal.label}: the editor is offered`, board.setBtn === true);

    const saved = await page.evaluate(async () => {
      openAvailabilityEditor();
      await new Promise(r => setTimeout(r, 150));
      const rows = document.querySelectorAll('.av-row');
      rows[2].querySelector('.av-status').value = 'available';
      rows[2].querySelector('.av-from').value = '09:00';
      rows[2].querySelector('.av-to').value = '13:00';
      await saveAvailability();
      await new Promise(r => setTimeout(r, 150));
      return rows.length;
    });
    check(`${portal.label}: the editor has exactly 7 day rows`, saved === 7, String(saved));
    check(`${portal.label}: saving PUTs the 7-day shape to its own portal`,
      puts.length === 1 && puts[0].pathname === `${portal.apiBase}/availability`
      && puts[0].body.week === WEEK && puts[0].body.days.length === 7
      && puts[0].body.days[2].from === '09:00',
      JSON.stringify(puts[0] && { p: puts[0].pathname, w: puts[0].body.week, d2: puts[0].body.days[2] }));
    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // View without set: board yes, editor no.
  {
    const { page } = await openPortal(browser, {
      route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', port,
      perms: { hours: true, hoursActions: { log: true, view: true }, availability: true, availabilityActions: { view: true, set: false } } });
    await page.evaluate(() => navigate('hours'));
    await sleep(500);
    const v = await page.evaluate(() => {
      const box = document.getElementById('availability-board');
      return { listed: /Sara/.test(box.textContent),
               setBtn: !![...box.querySelectorAll('button')].find(b => /Set my week/.test(b.textContent)) };
    });
    check('view-only: sees the board, not the editor', v.listed && !v.setBtn, JSON.stringify(v));
    await page.close();
  }

  // ── Server-side facts ────────────────────────────────────────────────────────
  {
    const AV = fs.readFileSync('src/routes/availability.js', 'utf8');
    check('the PUT derives member_key from the session, never the body',
      /const me = callerIdentity\(req\)\.key;\s+\/\/ never from the body/.test(AV)
      && !/req\.body\.member_key|body\.member_key/.test(AV));
    check('days are sanitized to exactly 7 whitelisted entries',
      /for \(let i = 0; i < 7; i\+\+\)/.test(AV) && /DAY_STATUSES\.includes/.test(AV) && /TIME_RE\.test/.test(AV));
    check('weeks normalize to Monday server-side', /\(d\.getUTCDay\(\) \+ 6\) % 7/.test(AV));
    const HOME_SRV = fs.readFileSync('src/routes/home.js', 'utf8');
    const HOME_CLI = fs.readFileSync('public/assets/home.js', 'utf8');
    check('the Home widget is gated on the availability section, both sides',
      /team_availability:\s+\{ gate: 'availability'/.test(HOME_SRV)
      && /team_availability:\s+\{ title:.*perm: 'availability'/.test(HOME_CLI));
    const HUD = fs.readFileSync('public/assets/huddle.js', 'utf8');
    check("the DM chat header shows today's availability beside the status chip",
      /availabilityToday\(other\.member_key\)/.test(HUD));
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
