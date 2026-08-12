// Pasting a screenshot into chat, and links rendering as links with a preview.
// Driven through the real portal pages, with every /api/ call answered from fixtures.
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const LINK = 'https://example.com/deal';
const ROOMS = me => ([
  { id: 1, type: 'group', name: 'Ops', created_by: 'admin', updated_at: '2026-08-01T09:00:00Z',
    members: [{ member_key: 'admin', member_name: 'Admin' }, { member_key: 'employee_2', member_name: 'Sara' }],
    lastMessage: { body: 'Morning', created_at: '2026-08-01T09:00:00Z' } },
]);
// One message with a link, one trying to inject markup.
const MESSAGES = me => ([
  { id: 11, room_id: 1, sender_key: me === 'admin' ? 'employee_2' : 'admin',
    sender_name: 'Someone', body: `look at ${LINK} please`, created_at: '2026-08-01T09:00:00Z' },
  { id: 12, room_id: 1, sender_key: me === 'admin' ? 'employee_2' : 'admin',
    sender_name: 'Someone', body: '<img src=x onerror=alert(1)> and <script>alert(2)</script>',
    created_at: '2026-08-01T09:01:00Z' },
]);
const PREVIEW = { url: LINK, domain: 'example.com', title: 'The deal page',
                  description: 'Everything about the deal', siteName: 'Example', image: '' };

function apiRoute(me, url, method, body, captured) {
  const u = new URL(url);
  const p = u.pathname;
  if (method !== 'GET') captured.push({ method, path: p, raw: body || '' });
  if (/\/chat\/upload$/.test(p)) return { url: '/icons/icon-192.png', name: 'screenshot-x.png', size: 1234, type: 'image/png' };
  if (/\/link-preview$/.test(p)) return PREVIEW;
  if (/\/chat\/rooms$/.test(p)) return ROOMS(me);
  if (/\/chat\/rooms\/\d+\/messages$/.test(p)) return MESSAGES(me);
  if (/\/chat\/rooms\/\d+\/attachments$/.test(p)) return [];
  if (/\/chat\/people$/.test(p)) return [];
  if (/\/huddle\/ice$/.test(p)) return { iceServers: [], hasTurn: false, max: 6 };
  if (/\/presence/.test(p)) return [];
  if (/\/auth\/check$/.test(p)) return { ok: true };
  if (/\/employee\/check$/.test(p)) return { id: 2, name: 'Sara', username: 'sara', permissions: {} };
  if (/\/notifications$/.test(p)) return [];
  return [];
}

async function runPortal(browser, o) {
  const captured = [];
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (/unpkg\.com|jsdelivr|fonts\.g/.test(url)) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    const u = new URL(url);
    if (u.pathname.startsWith('/api/')) {
      if (u.pathname.endsWith('/events') || u.pathname.endsWith('/stream')) {
        return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      }
      return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify(apiRoute(o.me, url, req.method(), req.postData(), captured)) });
    }
    if (u.pathname === o.route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(o.file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });

  await page.evaluateOnNewDocument(k => { localStorage.setItem(k, 'T'); window.lucide = { createIcons() {} }; }, o.tokenKey);
  await page.goto('http://127.0.0.1:' + o.port + o.route, { waitUntil: 'domcontentloaded' });
  await sleep(400);
  await page.evaluate(o.bootstrap);
  await sleep(600);
  await page.evaluate(fn => window[fn](1), o.openRoomFn);
  await sleep(500);

  const t = (n, ok, x) => check(o.label + ': ' + n, ok, x);

  // ── Links render as links ──
  const link = await page.evaluate(() => {
    const a = document.querySelector('.chat-msg-bubble a.chat-link');
    return a ? { href: a.getAttribute('href'), rel: a.getAttribute('rel'), target: a.getAttribute('target') } : null;
  });
  t('a pasted url renders as a clickable link', !!link && link.href === LINK, JSON.stringify(link));
  t('the link opens safely', !!link && link.target === '_blank' && /noopener/.test(link.rel || ''), JSON.stringify(link));

  // ── and markup in a message never becomes markup ──
  const inject = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.chat-msg-bubble')];
    const b = bubbles.find(x => /onerror/.test(x.textContent));
    return b ? { html: b.innerHTML, imgs: b.querySelectorAll('img').length, scripts: b.querySelectorAll('script').length } : null;
  });
  t('markup in a message stays text', !!inject && inject.imgs === 0 && inject.scripts === 0, JSON.stringify(inject));

  // ── The preview card is fetched and patched in ──
  await sleep(500);
  const card = await page.evaluate(() => {
    const c = document.querySelector('.chat-previews .gcard');
    return c ? { title: (c.querySelector('.gcard-title') || {}).textContent, href: c.getAttribute('href') } : null;
  });
  t('a preview card is fetched and shown', !!card && /The deal page/.test(card.title || ''), JSON.stringify(card));
  t('the preview links to the same url', !!card && card.href === LINK, JSON.stringify(card));
  const previewCalls = captured.filter(c => /link-preview$/.test(c.path));
  t('the preview is requested once, not once per render', previewCalls.length === 1, `calls=${previewCalls.length}`);

  // ── Pasting a screenshot uploads it ──
  // Puppeteer will not hand back a multipart body, so the filename is read from the
  // FormData the page actually builds — which is the thing under test anyway.
  await page.evaluate(() => {
    window.__uploadName = null;
    const real = window.fetch;
    window.fetch = (u, o) => {
      if (o && o.body instanceof FormData) {
        const f = o.body.get('file');
        if (f) window.__uploadName = f.name;
      }
      return real(u, o);
    };
  });
  await page.evaluate(sel => {
    const png = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    const bytes = new Uint8Array(png.length);
    for (let i = 0; i < png.length; i++) bytes[i] = png.charCodeAt(i);
    // A clipboard image arrives with no useful name — exactly the case that used to
    // produce a storage key ending in a bare dot.
    const file = new File([bytes], '', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, o.inputSel);
  await sleep(700);

  const upload = captured.find(c => /chat\/upload$/.test(c.path));
  t('pasting an image uploads it', !!upload, JSON.stringify(captured.map(c => c.path)));
  const sentName = await page.evaluate(() => window.__uploadName);
  t('the nameless clipboard blob is uploaded with a real filename',
    /^screenshot-\d{14}\.png$/.test(sentName || ''), String(sentName));

  const preview = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    return { shown: el && el.style.display !== 'none', thumb: !!(el && el.querySelector('.chat-attach-thumb')) };
  }, o.attachSel);
  t('the attachment strip shows a thumbnail, not just a name', preview.shown && preview.thumb, JSON.stringify(preview));

  t('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await page.close();
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  await runPortal(browser, {
    label: 'admin', me: 'admin', port, route: '/dashboard', file: 'public/dashboard.html',
    tokenKey: 'ml_admin_token', openRoomFn: 'adminChatOpenRoom',
    inputSel: '#admin-chat-input', attachSel: '#admin-attach-preview',
    bootstrap: () => { navigate('chat'); },
  });
  await runPortal(browser, {
    label: 'team', me: 'employee_2', port, route: '/employee', file: 'public/employee.html',
    tokenKey: 'ml_emp_token', openRoomFn: 'chatOpenRoom',
    inputSel: '#chat-input', attachSel: '#chat-attach-preview',
    bootstrap: () => {
      window.empInfo = { id: 2, name: 'Sara' }; window.empPerms = {};
      document.getElementById('layout').style.display = '';
      navigate('chat');
    },
  });

  await browser.close(); srv.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} paste and link checks passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
