// Who may put the portals' pages in a frame: this site, and nobody else (src/http/frame-guard.js).
//
// A page that any website can frame is a page any website can dress up (clickjacking), so the pages go out with
// `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`. Held here, in three layers, because
// the headers are only half of it:
//   1. which paths are pages: the pure part, with the spellings the server answers that nobody would write by hand;
//   2. the real server: every way of writing a portal's address that opens it carries both headers (the classic pages, the new
//      app's page, and the bare .html files the static server answers to spellings the routes do not match), nothing that is
//      not a page does (the API, the new app's files, the manifests, scripts and icons), and a page nobody listed is found;
//   3. a real browser, the only thing that can say what the headers DO: a page of this site can frame a portal (the new app
//      does, at /legacy/<portal>?embed=1: tests/webframe.js and tests/embed.js hold that side whole), a page of any other origin is
//      refused, and the portal's own frames (the previews of generated documents, the e-mail viewer) still open on a page that
//      carries the policy.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { chromePath } = require('./helpers/browser');
const { makeFrameGuard, isPage } = require('../src/http/frame-guard');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// What browsers are told is a contract with them, so it is written out here and not read from the module under test.
const CSP = "frame-ancestors 'self'", XFO = 'SAMEORIGIN';

// ── 1. Which paths are pages ─────────────────────────────────────────────────────────────────────
{
  const roots = ['/dashboard', '/employee', '/legacy'];
  const pages = [
    '/dashboard', '/employee', '/dashboard.html', '/employee.html', '/dashboard/', '/dashboard/anything/at/all', '/employee/x',
    '/legacy/dashboard', '/legacy/employee', '/some/page/added/later.html',
    // spellings: routes ignore case and a trailing slash; the file server decodes %-escapes and settles `//`, `/./` and `/../`
    '/Dashboard', '/DASHBOARD.HTML', '/legacy/Employee', '/dashboard//x', '//dashboard.html', '/%64ashboard.html', '/dashboard%2Ehtml',
    '/dashboard%2ehtml', '/x/../dashboard.html', '/dashboard.html/.', '/./employee.html', '/a/%2e%2e/dashboard.html', '/%2e/dashboard.html',
    '/%E0%A4%A',      // not valid %-encoding: nothing serves it, and it is called a page anyway (when in doubt, protect)
  ];
  const notPages = [
    '/', '/api/v1/health', '/api/dashboard/tasks', '/api/submissions', '/ui/assets/index-1a2b3c4d.js', '/ui/assets/index-1a2b3c4d.css',
    '/assets/dashboard.js', '/assets/employee.css', '/icons/favicon.png', '/manifest-dashboard.json', '/sw-employee.js', '/help-docs.js',
    '/dashboardx', '/dashboard-old.js', '/employees', '/legacyx',    // a root ends at a "/": these only begin like one
  ];
  const wrong = [...pages.filter(p => !isPage(roots, p)).map(p => 'page not covered: ' + p), ...notPages.filter(p => isPage(roots, p)).map(p => 'not a page, covered: ' + p)];
  check('the pages are the roots, what is inside them and any .html file, in whatever spelling; nothing else is', wrong.length === 0, wrong.join(' | '));
  const refuses = pages => { try { makeFrameGuard({ pages }); return false; } catch (_) { return true; } };
  check('a list of pages that covers nothing, or is not roots, stops the boot instead of leaving a portal open',
    refuses([]) && refuses(['dashboard']) && refuses(['/dashboard/']) && refuses(['/']) && refuses(['']) && !refuses(['/Dashboard', '/employee']));
}

(async () => {
  createFakeSupabase({ employees: [], sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [], presence: [] }).install();

  // The new app's files, stood in for by a folder of this suite's own: its page is the real template (so the server really dresses
  // it for the browser that asked for it) and its other files are named the way the build names them.
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-framing-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.copyFileSync(path.join(ROOT, 'apps', 'web', 'index.html'), path.join(dist, 'index.html'));
  fs.writeFileSync(path.join(dist, 'assets', 'index-1a2b3c4d.js'), 'console.log(1);');
  fs.writeFileSync(path.join(dist, 'assets', 'index-1a2b3c4d.css'), 'body{margin:0}');
  const port = Number(process.env.PORT) || 3983;
  const base = await bootApp({ port, env: { ML_WEB_DIST: dist } });
  const receiver = require(path.join(ROOT, 'index.js'));

  // The address goes out exactly as written: fetch() would tidy `//x`, `/./` and `%2e` away before it was sent.
  const get = (p, headers = {}) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p, headers }, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', d => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject));
  const follow = async (p, headers = {}) => { const r = await fetch(base + p, { headers }); return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() }; };
  const framed = r => r.headers['content-security-policy'] === CSP && r.headers['x-frame-options'] === XFO;
  const bare = r => !('content-security-policy' in r.headers) && !('x-frame-options' in r.headers);
  const opensPortal = r => r.status === 200 && /<title[^>]*>[^<]*(Admin Dashboard|Team Portal)/.test(r.body);
  const asked = async paths => Promise.all(paths.map(async p => [p, await get(p)]));
  const names = (rs, bad) => rs.filter(([, r]) => bad(r)).map(([p]) => p).join(' ');

  // ── 2. The real server ─────────────────────────────────────────────────────────────────────────
  // The routes' own spellings: case, a trailing slash, a query.
  const OPENS = [
    '/dashboard', '/dashboard/', '/Dashboard', '/DASHBOARD', '/dashboard.html', '/DASHBOARD.HTML', '/dashboard.html/', '/dashboard?safe=1',
    '/employee', '/employee.html', '/EMPLOYEE.html', '/legacy/dashboard', '/legacy/Dashboard', '/legacy/dashboard/', '/legacy/dashboard?embed=1',
    '/legacy/employee', '/legacy/employee?embed=1',
  ];
  // The bare files in public/, which no route matches in these spellings: the static server decodes and settles them and sends the page
  // as it is on disk. Found by trying them on the server before the guard existed (each was answered 200 with the portal in it); a check
  // on the path as written would have missed every one.
  const BARE = [
    '//dashboard.html', '//employee.html', '/%64ashboard.html', '/dashboard%2Ehtml', '/dashboard%2ehtml', '/x/../dashboard.html',
    '/dashboard.html/.', '/./dashboard.html', '/%2e/dashboard.html', '/a/%2e%2e/dashboard.html',
  ];
  for (const [what, list] of [['the portals\' pages, in the spellings the routes answer to', OPENS], ['the bare .html files, in the spellings only the static server answers to', BARE]]) {
    const rs = await asked(list);
    check(`${what}: each opens a portal (so the list means something)`, names(rs, r => !opensPortal(r)) === '', names(rs, r => !opensPortal(r)));
    check(`…and each carries both headers, exactly`, names(rs, r => !framed(r)) === '', names(rs, r => !framed(r)));
  }

  const inside = await Promise.all(['/dashboard/anything', '/employee/anything'].map(async p => [p, await follow(p)]));
  check('what is inside a portal (/dashboard/*, /employee/*) lands on a classic page that carries them', names(inside, r => !opensPortal(r) || !framed(r)) === '', names(inside, r => !opensPortal(r) || !framed(r)));
  check('…and the redirect on the way says it too', (await Promise.all(['/dashboard/anything', '/employee/anything'].map(p => get(p)))).every(r => r.status === 302 && framed(r)));

  // The new app's page is at the same addresses, for a browser that asked for it.
  const NEXT = { Cookie: 'ml_ui=next' };
  const spa = await Promise.all(['/dashboard', '/employee'].map(async p => [p, await get(p, NEXT)]));
  check('the new app\'s page, sent to a browser that asked for it, carries them too',
    names(spa, r => r.status !== 200 || !r.body.includes('"ui":"next"')) === '' && names(spa, r => !framed(r)) === '', names(spa, r => r.status !== 200 || !r.body.includes('"ui":"next"') || !framed(r)));

  // Not pages: no header, so nothing about them changes.
  const NOT = [
    '/api/v1/health', '/api/workspace', '/manifest-dashboard.json', '/manifest-employee.json', '/sw-dashboard.js', '/sw-employee.js',
    '/assets/dashboard.js', '/assets/dashboard.css', '/icons/favicon.png', '/help-docs.js', '/ui/assets/index-1a2b3c4d.js', '/ui/assets/index-1a2b3c4d.css',
  ];
  const others = await asked(NOT);
  check('the API (JSON), the new app\'s files, manifests, scripts, sheets and icons are answered, and without either header',
    names(others, r => r.status !== 200) === '' && names(others, r => !bare(r)) === '', names(others, r => r.status !== 200 || !bare(r)));
  check('the API\'s only cross-origin door is untouched: /api/submissions still answers its preflight for the website',
    await (async () => { const r = await fetch(base + '/api/submissions', { method: 'OPTIONS' }); return r.status === 204 && r.headers.get('access-control-allow-origin') === '*' && !r.headers.has('content-security-policy') && !r.headers.has('x-frame-options'); })());

  // Every page the server has, found rather than listed: each GET route outside /api is asked for, and whatever answers with HTML
  // must be framed by this site only. A page added tomorrow that the guard does not cover fails here; one that is MEANT to be framed
  // by other sites goes in FRAMEABLE, with its reason, and in src/http/frame-guard.js.
  const FRAMEABLE = [];
  const routes = receiver.app._router.stack.filter(l => l.route && l.route.methods.get && !l.route.path.startsWith('/api/')).map(l => l.route.path.replace(/\*/g, 'x'));
  for (const [who, headers] of [['a browser that has chosen nothing', {}], ['a browser that asked for the new app', NEXT]]) {
    const answered = await Promise.all(routes.map(async p => [p, await follow(p, headers)]));
    const html = answered.filter(([p, r]) => r.status === 200 && /text\/html/.test(r.headers['content-type'] || '') && !FRAMEABLE.includes(p));
    check(`every page the server registers answers ${who} with the policy (${html.length} of ${routes.length} routes are pages)`, html.length >= 6 && names(html, r => !framed(r)) === '', names(html, r => !framed(r)));
  }

  // ── 3. A real browser ──────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
  const HOST = src => `<!doctype html><meta charset="utf-8"><iframe id="f" src="${src}" style="width:900px;height:600px;border:0"></iframe>`;

  // Two pages that frame what they are asked to. This site's is never served by the server (the browser is handed it at an address
  // of this site's origin, which the server has no route for). The other origin's is a server of its own on another port, which is
  // another origin — a real one, on the same machine, because a page the browser has no address for counts as "public" to it, and
  // Chrome refuses such a page's request for a loopback address (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS) before it reaches
  // the server: a refusal that has nothing to do with the headers, and would pass this check with no header at all.
  const elsewhere = 'http://127.0.0.1:' + (port + 1);
  const other = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(HOST(new URL(req.url, elsewhere).searchParams.get('frame'))); });
  await new Promise(r => other.listen(port + 1, '127.0.0.1', r));

  // What became of the frame: it opened (and what is in it), or the browser refused it. With it, what the browser was told and what it
  // did about it — the server's answer for the framed address, how the load ended, and what the browser said about it in the console —
  // so that a frame refused for any other reason than the policy does not pass for one that was refused by it.
  const frameIn = async (parent, src) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const answers = [], failed = [], said = [];
    const framedUrl = new URL(src, parent).href;
    await page.setRequestInterception(true);
    page.on('request', r => {
      const url = r.url();
      if (url === base + '/__host') return r.respond({ status: 200, contentType: 'text/html', body: HOST(src) });
      if (url.startsWith(base) || url.startsWith(elsewhere)) return r.continue();
      return r.respond({ status: 200, contentType: 'text/plain', body: '' });    // the CDNs the portals draw from: nothing leaves this machine
    });
    page.on('response', r => { if (r.url() === framedUrl) answers.push({ status: r.status(), csp: r.headers()['content-security-policy'] }); });
    page.on('requestfailed', r => { if (r.url() === framedUrl) failed.push(r.failure() && r.failure().errorText); });
    page.on('console', m => said.push(m.text()));
    await page.setBypassServiceWorker(true);
    await page.goto(parent, { waitUntil: 'domcontentloaded' });
    let outcome = null;
    for (let i = 0; i < 150 && !outcome; i++) {
      const f = page.frames().find(x => x !== page.mainFrame());
      if (f && f.url().startsWith('chrome-error:')) outcome = { refused: true };
      else if (f && f.url().startsWith(base)) {
        const title = await f.evaluate(() => (document.readyState === 'complete' ? document.title : '')).catch(() => '');
        if (title) outcome = { refused: false, title, url: f.url() };
      }
      if (!outcome) await sleep(100);     // (a slow page gets its 15 s, not the few hundred milliseconds it takes to ask 150 times)
    }
    await page.close(); await context.close();
    return { ...(outcome || { refused: null }), answers, failed, said: said.filter(s => /frame-ancestors|Framing|Refused/.test(s)).map(s => s.trim().slice(0, 160)) };
  };

  for (const [src, title] of [['/legacy/dashboard?embed=1', /Admin Dashboard/], ['/legacy/employee?embed=1', /Team Portal/], ['/dashboard', /Admin Dashboard/]]) {
    const r = await frameIn(base + '/__host', src);
    check(`a page of this site can frame ${src}: it opens, and the browser said nothing against it`,
      r.refused === false && title.test(r.title) && r.url === base + src && r.failed.length === 0 && r.said.length === 0, JSON.stringify(r));
  }
  for (const src of ['/legacy/dashboard?embed=1', '/legacy/employee?embed=1', '/dashboard']) {
    const r = await frameIn(elsewhere + '/?frame=' + encodeURIComponent(base + src), base + src);
    check(`a page of any other origin cannot frame ${src}: the server answers it, the browser reads "frame-ancestors 'self'" and blocks it`,
      r.refused === true && r.answers.length === 1 && r.answers[0].status === 200 && r.answers[0].csp === CSP
      && r.failed.length === 1 && r.failed[0] === 'net::ERR_BLOCKED_BY_RESPONSE' && r.said.some(s => s.includes("frame-ancestors 'self'")), JSON.stringify(r));
  }

  // The portals' own frames, on a page that carries the policy: the previews of generated documents (a PDF the page turns into a blob: URL),
  // the e-mail viewer (srcdoc) and an HTML blob. They are documents the page makes for itself, which the policy has no business refusing.
  // (A refused frame still fires `load`, so what is looked at is where each frame ended up: blob: or an error page.)
  {
    const PDF = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setRequestInterception(true);
    page.on('request', r => (r.url().startsWith(base) || /^(blob|data):/.test(r.url()) ? r.continue() : r.respond({ status: 200, contentType: 'text/plain', body: '' })));
    await page.setBypassServiceWorker(true);
    const res = await page.goto(base + '/legacy/dashboard', { waitUntil: 'domcontentloaded' });
    const made = await page.evaluate(async pdf => {
      const open = attrs => new Promise(resolve => {
        const f = Object.assign(document.createElement('iframe'), attrs);
        f.addEventListener('load', () => resolve(f)); setTimeout(() => resolve(f), 8000); document.body.appendChild(f);
      });
      await open({ src: URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' })) });
      const mail = await open({ srcdoc: '<p id="m">hello</p>' });
      const html = await open({ src: URL.createObjectURL(new Blob(['<p id="m">blob</p>'], { type: 'text/html' })) });
      const text = f => { try { return f.contentDocument.getElementById('m').textContent; } catch (_) { return null; } };
      return { mail: text(mail), html: text(html) };
    }, PDF);
    await sleep(1000);
    const urls = page.frames().slice(1).map(f => f.url());
    check('the portal\'s own frames still open on a page that carries the policy: a PDF preview, the e-mail viewer and an HTML blob',
      res.headers()['content-security-policy'] === CSP && made.mail === 'hello' && made.html === 'blob' && urls.filter(u => u.startsWith('blob:')).length === 2 && !urls.some(u => u.startsWith('chrome-error:')), JSON.stringify({ made, urls: urls.map(u => u.slice(0, 30)) }));
    await page.close(); await context.close();
  }

  await browser.close();
  other.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
