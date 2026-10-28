// Attachment links: whatever an employee posts as a file link must never run.
//
// A chat message or a comment carries file_url, and every reader's screen draws it
// as a link and an image. The server stored whatever the client sent, and the
// renderers put it into window.open('…') inside an onclick and into href with no
// scheme check — so a hand-written POST with file_url "x');…//" or "javascript:…"
// ran script in the session of whoever opened the thread, the admin included.
//
// Both ends are asserted: the server now keeps only an https link (what the upload
// route hands back), and the real renderers in both portals draw only http(s) links
// and never put a URL inside a handler.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3957';

// The stub database answers every query with nothing, as in the other suites —
// and records what would have been written.
const inserted = [];
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  if (init && init.method === 'POST' && init.body) inserted.push({ url, body: String(init.body) });
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  const one = accept.includes('pgrst.object');
  // A task, a request and a room membership must exist for the handlers to go on.
  const row = /\/(tasks|requests|chat_room_members)\?/.test(url) ? { id: 1, title: 'Row', room_id: 1 } : {};
  return new Response(one ? JSON.stringify(row) : '[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const STORAGE = 'https://stub.supabase.co/storage/v1/object/public/chat-files/chat/1/photo.png';
const HOSTILE = ["javascript:alert(document.domain)", "x');window.__pwned=1;//", 'https://evil.test/a"onerror="window.__pwned=1'];

(async () => {
  // ── The server keeps only an https link ──
  const { safeFileUrl } = require(process.cwd() + '/src/lib/constants.js');
  check('an uploaded file link is kept as it is', safeFileUrl(STORAGE) === STORAGE);
  check('javascript:, data:, http: and quoted links are refused',
    ['javascript:alert(1)', 'data:text/html,<b>', 'http://plain.test/x', HOSTILE[1], HOSTILE[2], 'https://a.test/x y']
      .every(u => safeFileUrl(u) === ''));

  require(process.cwd() + '/index.js');
  const base = 'http://127.0.0.1:' + process.env.PORT;
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/api/push/vapid-public-key'); break; }
    catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  const { token } = await (await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();
  check('signed in, so the routes below are really exercised', !!token);
  const post = (p, body) => fetch(base + p, { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  for (const [label, p] of [['a chat message', '/api/dashboard/chat/rooms/1/messages'],
                            ['a task comment', '/api/dashboard/tasks/1/comments'],
                            ['a request comment', '/api/dashboard/requests/1/comments']]) {
    inserted.length = 0;
    const bad = await Promise.all(HOSTILE.map(u => post(p, { body: 'see attached', file_url: u, file_type: 'image/png', file_name: 'a.png' }).then(r => r.status)));
    check(`${label} with a hand-written file link is refused`, bad.every(s => s === 400), bad.join(','));
    check(`…and nothing of it is written`, !inserted.some(x => HOSTILE.some(u => x.body.includes(JSON.stringify(u).slice(1, -1)))));
    const good = await post(p, { body: '', file_url: STORAGE, file_type: 'image/png', file_name: 'photo.png' });
    check(`${label} with an uploaded file goes through`, good.status !== 400 && inserted.some(x => x.body.includes(STORAGE)), String(good.status));
  }

  // ── The renderers draw only web links, never inside a handler ──
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });
  async function open(route, file, tokenKey) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
      if (u.pathname.startsWith('/api/')) {
        if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
        const body = /auth\/check$/.test(u.pathname) ? { ok: true }
          : /employee\/check$/.test(u.pathname) ? { ok: true, id: 2, name: 'Sara', username: 'sara', permissions: {} } : [];
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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
    await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' }).catch(() => {});
    return page;
  }
  // Render, insert into a detached container, and report what a click could reach.
  const inspect = (page, fnSrc, payloads) => page.evaluate((fnSrc, payloads, ok) => {
    const render = new Function('u', 'type', fnSrc);
    return [...payloads, ok].map(u => ['image/png', 'application/pdf'].map(type => {
      const box = document.createElement('div');
      box.innerHTML = render(u, type);
      const handlers = [...box.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name)).map(a => a.value));
      return {
        u, type,
        urlInHandler: handlers.some(h => /window\.open|evil|javascript|__pwned/.test(h)),
        badHref: [...box.querySelectorAll('[href],[src]')].some(el => !/^https?:/i.test(el.getAttribute('href') || el.getAttribute('src') || 'https:')),
        extraAttr: [...box.querySelectorAll('*')].some(el => el.hasAttribute('onerror')),
        drawn: !!box.querySelector('a[href^="https://"]'),
      };
    })).flat();
  }, fnSrc, payloads, STORAGE);

  const PORTALS = [
    ['admin', '/dashboard', 'public/dashboard.html', 'ml_admin_token', [
      ['commentAttachHtml', "return commentAttachHtml({ file_url: u, file_type: type, file_name: 'a.png' });"],
      ['adminChatMsgHTML', "return adminChatMsgHTML({ id: 9, sender_key: 'employee_2', sender_name: 'Eve', body: '', file_url: u, file_type: type, file_name: 'a.png', created_at: '2026-10-20T10:00:00Z' }, false);"],
    ]],
    ['team', '/employee', 'public/employee.html', 'ml_emp_token', [
      ['commentAttachHtml', "return commentAttachHtml({ file_url: u, file_type: type, file_name: 'a.png' });"],
      ['chatMsgHTML', "return chatMsgHTML({ id: 9, sender_key: 'employee_3', sender_name: 'Eve', body: '', file_url: u, file_type: type, file_name: 'a.png', created_at: '2026-10-20T10:00:00Z' }, 'employee_2');"],
    ]],
  ];
  for (const [portal, route, file, tokenKey, fns] of PORTALS) {
    const page = await open(route, file, tokenKey);
    for (const [name, src] of fns) {
      const rows = await inspect(page, src, HOSTILE);
      const hostile = rows.filter(r => r.u !== STORAGE), good = rows.filter(r => r.u === STORAGE);
      check(`${portal} ${name}: no file link inside a handler`, rows.every(r => !r.urlInHandler), JSON.stringify(rows.filter(r => r.urlInHandler).map(r => r.u)));
      check(`${portal} ${name}: no javascript: or other non-web link, no injected attribute`,
        hostile.every(r => !r.badHref && !r.extraAttr), JSON.stringify(hostile.filter(r => r.badHref || r.extraAttr).map(r => r.u)));
      check(`${portal} ${name}: a real upload is still drawn as a link`, good.every(r => r.drawn), JSON.stringify(good));
    }
    await page.close();
  }
  await browser.close(); srv.close();

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} attachment link checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
