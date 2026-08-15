// Boot resilience: whatever goes wrong during init, the user must SEE something.
//
// The production report was "blank page until I refresh several times". Both
// #app and #auth-screen start display:none in dashboard.html, so any unhandled
// throw during the init IIFE — or a checkAuth that can't reach the server —
// used to leave literally nothing visible. These are the four ways in, each
// asserted to land on a visible surface now.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// What is actually visible? Blank means: no auth screen, no app, no retry floor.
const VISIBLE = `(() => {
  const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
  return { auth: vis('auth-screen') || vis('auth-wrap'), app: vis('app') || vis('layout'), retry: vis('boot-retry'),
           text: (document.body.innerText || '').trim().slice(0, 60) };
})()`;

async function openPage(browser, { route, file, port, tokenKey, token, api }) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) return api(req, u);
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  if (token) await page.evaluateOnNewDocument((k, t) => localStorage.setItem(k, t), tokenKey, token);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' }).catch(() => {});
  await sleep(600);
  return { page, errs };
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  // 1. Token present, API completely unreachable (server restarting) — the exact
  //    production situation. Must show the retry floor, never a blank page.
  {
    const { page } = await openPage(browser, {
      route: '/dashboard', file: 'public/dashboard.html', port,
      tokenKey: 'ml_admin_token', token: 'stale-token',
      api: req => req.abort('connectionrefused'),
    });
    const v = await page.evaluate(VISIBLE);
    check('admin: dead API shows the retry floor, not a blank page', v.retry && !v.app, JSON.stringify(v));
    const floorText = await page.evaluate(() => (document.getElementById('boot-retry')?.innerText || ''));
    check('…and it says so in words', /can.t reach/i.test(floorText), floorText.slice(0, 60));
    await page.close();
  }

  // 2. Token stale (server restarted, session gone) — 401 everywhere. Must land
  //    on the login screen in BOTH portals.
  {
    const deny = req => req.respond({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
    const a = await openPage(browser, { route: '/dashboard', file: 'public/dashboard.html', port,
      tokenKey: 'ml_admin_token', token: 'stale', api: deny });
    const va = await a.page.evaluate(VISIBLE);
    check('admin: a stale session lands on login', va.auth && !va.app, JSON.stringify(va));
    await a.page.close();

    const e = await openPage(browser, { route: '/employee', file: 'public/employee.html', port,
      tokenKey: 'ml_emp_token', token: 'stale', api: deny });
    const ve = await e.page.evaluate(VISIBLE);
    check('team: a stale session lands on login, not "not configured"', ve.auth && !ve.app, JSON.stringify(ve));
    // The stale token must be gone, or every future load repeats the dance.
    const cleared = await e.page.evaluate(() => localStorage.getItem('ml_emp_token'));
    check('team: the dead token is discarded', cleared === null, String(cleared));
    await e.page.close();
  }

  // 2b. Session dies MID-SESSION (server restarted while the portal was open).
  //     checkAuth already passed, so only the central 401 handling in ef() can
  //     notice — the per-page callers parse the 401 body as data and invent
  //     explanations like "not configured" instead of bouncing to login.
  {
    let dead = false;
    const api = (req, u) => {
      if (dead) return req.respond({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json', body: /check$/.test(u.pathname) ? '{"ok":true,"name":"S","username":"s","permissions":{}}' : '[]' });
    };
    const { page } = await openPage(browser, { route: '/employee', file: 'public/employee.html', port,
      tokenKey: 'ml_emp_token', token: 'good-until-restart', api });
    const before = await page.evaluate(VISIBLE);
    dead = true;
    await page.evaluate(() => navigate('requests'));
    await sleep(400);
    const after = await page.evaluate(VISIBLE);
    check('team: a session dying mid-use bounces to login',
      before.app && after.auth && !after.app, JSON.stringify({ before, after }));
    await page.close();
  }

  // 3. Healthy API but a poisoned last-page hash — navigate() must fall back to
  //    home instead of throwing out of the init IIFE.
  {
    const okApi = (req, u) => {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json', body: /check$/.test(u.pathname) ? '{"ok":true}' : '[]' });
    };
    const { page, errs } = await openPage(browser, {
      route: '/dashboard', file: 'public/dashboard.html', port,
      tokenKey: 'ml_admin_token', token: 'good', api: okApi });
    await page.evaluate(() => { localStorage.setItem('ml_page', 'no-such-page'); });
    // Simulate the mid-deploy case directly: a page id the HTML doesn't have.
    await page.evaluate(() => navigate('page-that-does-not-exist'));
    const v = await page.evaluate(`(() => {
      const active = document.querySelector('.page.active');
      return { active: active ? active.id : null, appShown: getComputedStyle(document.getElementById('app')).display !== 'none' };
    })()`);
    check('admin: navigating to a missing page falls back to home', v.active === 'page-home', JSON.stringify(v));
    check('admin: no page errors on the poisoned navigate', !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
