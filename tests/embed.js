// A classic page shown inside the new app's frame (/legacy/<portal>?embed=1), against the real server and a real browser.
//
// The new app shows a screen it has not rebuilt as the classic page itself, in an <iframe>. For that to work the page has to
// do three things differently, and ONLY when it is framed: show its content and none of its own chrome (the app draws the
// rail and the bars), leave to the app what the app owns on every screen (the live notification stream, presence, push, the
// service worker, the sign-in screen, the assistant), and talk to the app (the page it is on, a dead session, a new look).
// This holds all of that — for the admin's page and the team's — and holds the other side just as hard: a classic page that is
// not embedded, or is opened by itself with ?embed=1, is exactly the page it was; and only the window that framed it, from its
// own origin, can steer it or hear it (a window of another origin is not given the frame at all: section 6).
//
// (The frame here is a minimal page of this suite's own, served from the same origin; the app's side of the conversation is
// tests/webframe.js.)
const path = require('path');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath } = require('./helpers/browser');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const db = createFakeSupabase(seedTables(parseSchema()));
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3976 });
  const hostBase = 'http://127.0.0.1:' + (Number(process.env.HOST_PORT) || 3972);     // a page on another origin, for the last check
  const ours = url => url.startsWith(base) || url.startsWith(hostBase);
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));

  // ── the people, one per portal ────────────────────────────────────────────────────────────
  const SARA = { id: 21, name: 'Sara', title: 'Sales', raw: { leads: true, leadsActions: { view: true, edit: true }, deals: true, dealsActions: { view: true } } };
  db.tables.employees = db.tables.employees.filter(e => e.id !== SARA.id).concat([{ ...db.tables.employees[0], id: SARA.id, name: SARA.name, username: 'sara', job_title: SARA.title, permissions: SARA.raw, email: 'sara@example.com' }]);
  const PORTALS = [
    {
      name: 'admin', token: 'embed-admin', key: 'ml_admin_token', classic: '/legacy/dashboard', api: '/api/dashboard', check: '/api/auth/check', call: 'apiFetch',
      start: 'customers', other: 'deals', sessions: ctx.sessions, js: 'dashboard.js', stamp: '153', chrome: ['.sidebar', '.header'],
      session: { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() },
    },
    {
      name: 'team', token: 'embed-sara', key: 'ml_emp_token', classic: '/legacy/employee', api: '/api/employee', check: '/api/employee/check', call: 'ef',
      start: 'leads', other: 'deals', sessions: ctx.employeeSessions, js: 'employee.js', stamp: '133', chrome: ['.sidebar', '.topbar'],
      session: { id: SARA.id, name: SARA.name, username: 'sara', job_title: SARA.title, permissions: normEmpPerms(SARA.raw), createdAt: Date.now() },
    },
  ];
  for (const p of PORTALS) p.sessions.set(p.token, p.session);
  const only = process.env.EMBED_ONLY;         // 'admin' or 'team': a mutation run needs only the portal whose file it changed

  // ── the browser ───────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });

  // The page that frames: it keeps every message it is sent, and says who sent it.
  const HOST = (src, width = 1000) => `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="f" src="${src}" style="width:${width}px;height:700px;border:0"></iframe>
<script>window.__msgs = []; addEventListener('message', function (e) { __msgs.push({ data: e.data, origin: e.origin, fromFrame: e.source === document.getElementById('f').contentWindow }); });</script>`;

  // `src`: the classic page; `framed`: it is inside the host page's frame (otherwise it is the page itself), which is
  // `frameWidth` wide; `parent`: where the host page comes from (this server, or another origin); `width`: the window's.
  const open = async (p, { src, framed = true, parent = base, installed = false, width = 1100, frameWidth = 1000, token = p.token } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.asked = [];
    page.navs = [];       // every time a window was sent somewhere, and whether it was the outer one
    await page.setRequestInterception(true);
    page.on('request', r => {
      const url = r.url(), u = new URL(url);
      if (ours(url)) page.asked.push(u.pathname + u.search);
      if (r.isNavigationRequest()) page.navs.push({ path: u.pathname, top: r.frame() === page.mainFrame() });
      if (u.pathname === '/__host' && url.startsWith(base)) return r.respond({ status: 200, contentType: 'text/html', body: HOST(base + src, frameWidth) });
      if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(url)) return r.respond({ status: 200, contentType: 'text/plain', body: '' });
      if (/^https?:/.test(url) && !ours(url)) return r.abort('internetdisconnected');
      r.continue();
    });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument((key, token, installed) => {
      // (the classic pages draw their icons with lucide and their charts with Chart.js, both from a CDN)
      window.lucide = { createIcons() {} };
      window.Chart = function () { return { destroy() {}, update() {} }; };
      if (token) { try { localStorage.setItem(key, token); } catch (_) {} }
      // what the page would register with: recorded, not done — the question is whether it asks
      window.__swCalls = [];
      // (it answers with a registration that can subscribe, so a page that goes on to ask for push is seen to)
      const registration = scope => ({ scope, pushManager: { getSubscription: async () => null, subscribe: async () => ({ toJSON: () => ({ endpoint: 'https://push.example/' + Math.random(), keys: {} }) }) } });
      if (navigator.serviceWorker) {
        navigator.serviceWorker.register = (...a) => { window.__swCalls.push(String(a[0])); return Promise.resolve(registration(String((a[1] || {}).scope || ''))); };
        Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(registration('/')) });
      }
      if (installed) {   // an installed app: the page adds a class for it
        const real = window.matchMedia.bind(window);
        window.matchMedia = q => /display-mode: *standalone/.test(q)
          ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
          : real(q);
      }
    }, p.key, token, installed);
    await page.setViewport({ width, height: 800 });
    await page.goto(framed ? parent + '/__host' : base + src, { waitUntil: 'domcontentloaded' });
    page.inside = () => page.frames().find(f => f !== page.mainFrame());
    page.msgs = () => page.evaluate(() => window.__msgs.map(m => ({ ...m.data, origin: m.origin, fromFrame: m.fromFrame })));
    page.shut = async () => { await page.close(); await context.close(); };
    return page;
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg).then(() => true, () => false);
  const heard = (page, type) => until(page, t => window.__msgs.some(m => m.data && m.data.type === t), type);
  const count = (page, re) => page.asked.filter(u => re.test(u)).length;
  const asked = async (page, re, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (count(page, re)) return true; await sleep(100); } return false; };
  const html = async (p, query = '') => { const r = await fetch(base + p.classic + query); return { status: r.status, text: await r.text(), headers: r.headers }; };
  const say = (page, target, msg) => page.evaluate((m, to) => document.getElementById('f').contentWindow.postMessage(m, to), msg, target);
  const STREAM = /\/notifications\/stream/, PRESENCE = /\/presence\/heartbeat/, PUSH = /\/push\/subscribe|\/api\/push\/vapid-public-key/, HUDDLE = /\/huddle\/live/;
  const shown = f => f.evaluate(() => [...document.querySelectorAll('.page.active')].map(e => e.id).join());

  for (const p of PORTALS.filter(p => !only || p.name === only)) {
    const tag = `${p.name}:`;

    // ═══ 1. The page the server sends ═══════════════════════════════════════════════════════
    const plain = await html(p), framedHtml = await html(p, '?embed=1'), framedAgain = await html(p, '?embed=1'), plainAgain = await html(p);
    const stamp = (/\/assets\/(?:dashboard|employee)\.css\?v=(\d+)/.exec(plain.text) || [])[1];
    check(`${tag} a page asked for with ?embed=1 is marked, loads the bridge before anything else, and the sheet before the workspace's look`,
      /<html\b[^>]*\bdata-embed="1"/.test(framedHtml.text)
      && framedHtml.text.indexOf('/assets/embed.js') > framedHtml.text.indexOf('<meta charset')
      && framedHtml.text.indexOf('/assets/embed.js') < framedHtml.text.indexOf(`/assets/${p.js}`)
      && framedHtml.text.indexOf('/assets/embed.css') < framedHtml.text.indexOf('<style id="ws-theme">'));
    check(`${tag} …its assets carry the page's own deploy stamp (v${p.stamp}), so a deploy reaches a browser that kept the old ones`,
      stamp === p.stamp && framedHtml.text.includes(`/assets/embed.js?v=${stamp}`) && framedHtml.text.includes(`/assets/embed.css?v=${stamp}`), `page v${stamp}`);
    check(`${tag} a page asked for without it has no trace of any of that, and the two kinds never answer for each other`,
      !/data-embed|embed\.js|embed\.css/.test(plain.text) && plainAgain.text === plain.text && framedAgain.text === framedHtml.text);
    const safeEmbed = await html(p, '?embed=1&safe=1');
    check(`${tag} safe mode and embedding go together: the original look, in the frame`, /data-embed="1"/.test(safeEmbed.text) && !/data-ws-stamp/.test(safeEmbed.text));
    check(`${tag} the page says which UI it is, which the new app's worker needs`, plain.headers.get('x-ml-ui') === 'legacy' && framedHtml.headers.get('x-ml-ui') === 'legacy');

    // ═══ 2. Inside the app's frame ══════════════════════════════════════════════════════════
    let page = await open(p, { src: `${p.classic}?embed=1#${p.start}` });
    check(`${tag} the framed page opens on the page it was asked for and tells the app so`, await heard(page, 'ready'));
    const msgs = await page.msgs();
    const ready = msgs.find(m => m.type === 'ready');
    check(`${tag} …once, first, in the protocol's words, from the frame, from this origin`,
      ready && ready.page === p.start && ready.ml === 'embed' && ready.v === 1 && ready.fromFrame && ready.origin === base && msgs.filter(m => m.type === 'ready').length === 1 && msgs[0].type === 'ready', JSON.stringify(msgs[0]));
    const f = page.inside();
    await sleep(2500);     // the rest of the boot, so what it did not start has had time to start
    const inside = await f.evaluate(chrome => ({
      marked: document.documentElement.hasAttribute('data-embed'), bridge: typeof window.mlEmbed,
      shown: [...document.querySelectorAll('.page.active')].map(e => e.id),
      chrome: chrome.map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'absent'; }),
      margin: getComputedStyle(document.querySelector('.app-content, .content')).marginLeft,
      wide: document.querySelector('.app-content, .content').getBoundingClientRect().width === document.documentElement.clientWidth,
      auth: ['#auth-screen', '#auth-wrap'].map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'absent'; }),
      assistant: typeof window.aiOnNavigate, aiButton: document.getElementById('ai-btn') ? getComputedStyle(document.getElementById('ai-btn')).display : 'absent',
      sw: window.__swCalls,
    }), p.chrome);
    check(`${tag} it shows the page and none of its own chrome: no rail, no bars, no room kept for them`,
      inside.marked && inside.bridge === 'object' && inside.shown.join() === 'page-' + p.start && inside.chrome.every(d => d === 'none') && inside.margin === '0px' && inside.wide, JSON.stringify(inside));
    check(`${tag} …and no sign-in screen of its own`, inside.auth.every(d => d === 'none' || d === 'absent'), inside.auth.join());
    check(`${tag} it does not register a service worker (the app's own owns the scope)`, inside.sw.length === 0, inside.sw.join());
    check(`${tag} it does not open the live notification stream, send presence, subscribe for push, or look for a huddle to rejoin: the app does`,
      !count(page, STREAM) && !count(page, PRESENCE) && !count(page, PUSH) && !count(page, HUDDLE), page.asked.filter(u => STREAM.test(u) || PRESENCE.test(u) || PUSH.test(u) || HUDDLE.test(u)).join(' '));
    await f.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));      // the tab comes back to the front
    await sleep(700);
    check(`${tag} …and coming back to the tab does not start presence either`, !count(page, PRESENCE));
    check(`${tag} …but it still reads what its own pages need (the notification list, once, and its page's data)`, count(page, /\/notifications(\?|$)/) >= 1 && page.asked.filter(u => u.startsWith(p.api)).length > 3);
    check(`${tag} it leaves the assistant to the app: no button, nothing running`, inside.assistant === 'undefined' && (inside.aiButton === 'absent' || inside.aiButton === 'none'));

    // the app tells the page where to go
    await say(page, base, { ml: 'embed', v: 1, type: 'navigate', page: p.other });
    check(`${tag} told to go to another page it shows it, without reloading, and says so`,
      await until(page, o => window.__msgs.some(m => m.data.type === 'navigated' && m.data.page === o), p.other) && await shown(f) === 'page-' + p.other);
    const countBefore = (await page.msgs()).length;
    await say(page, base, { ml: 'embed', v: 1, type: 'navigate', page: p.other });
    await sleep(400);
    check(`${tag} …and does not repeat itself when asked for the page it is already on`, (await page.msgs()).length === countBefore);

    // what is not the protocol is not obeyed
    const before = await shown(f);
    for (const bad of [
      { ml: 'embed', v: 1, type: 'navigate', page: '../../etc' }, { ml: 'embed', v: 1, type: 'navigate', page: 'nosuchpage' }, { ml: 'embed', v: 1, type: 'navigate', page: ['home'] },
      { ml: 'embed', v: 2, type: 'navigate', page: p.start }, { ml: 'other', v: 1, type: 'navigate', page: p.start }, { v: 1, type: 'navigate', page: p.start }, 'navigate ' + p.start, null,
    ]) await say(page, base, bad);
    await sleep(500);
    check(`${tag} a message with the wrong version, name, shape or page does nothing`, await shown(f) === before);
    // a window that is not the frame's parent cannot steer it: this one is a sibling, from the same origin
    await page.evaluate(start => {
      const s = document.createElement('iframe');
      s.srcdoc = '<script>parent.frames[0].postMessage({ ml: "embed", v: 1, type: "navigate", page: "' + start + '" }, "*")<\/script>';
      document.body.appendChild(s);
    }, p.start);
    await sleep(700);
    check(`${tag} …and neither does a window that is not its parent (a sibling frame, same origin)`, await shown(f) === before);

    // the app tells the page the workspace's look changed
    await say(page, base, { ml: 'embed', v: 1, type: 'look', profile: { name: 'Acme Motors', updated_at: '2999-01-01T00:00:00.000Z' } });
    check(`${tag} a new look reaches the framed page at once (its name, in the page's title)`, await until(f, () => document.title.startsWith('Acme Motors')));
    await say(page, base, { ml: 'embed', v: 1, type: 'look', profile: 'not a profile' });
    await sleep(300);
    check(`${tag} …and something that is not a look is not worn`, await f.evaluate(() => document.title.startsWith('Acme Motors')));

    // a session that is gone
    p.sessions.delete(p.token);
    await f.evaluate((call, path) => window[call](path), p.call, p.check);
    check(`${tag} a session the server no longer knows is told to the app`, await heard(page, 'unauthorized'));
    await f.evaluate((call, path) => window[call](path), p.call, p.check);
    await f.evaluate((call, path) => window[call](path), p.call, p.check);
    await sleep(500);
    check(`${tag} …once, however many calls fail`, (await page.msgs()).filter(m => m.type === 'unauthorized').length === 1);
    const after = await f.evaluate(() => ({ token: Object.keys(localStorage).filter(k => /token/.test(k)).map(k => localStorage.getItem(k)), auth: ['#auth-screen', '#auth-wrap'].map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'absent'; }) }));
    check(`${tag} …and the frame neither signs the person out nor shows a sign-in form: that is the app's to decide`, after.token.includes(p.token) && after.auth.every(d => d === 'none' || d === 'absent'), JSON.stringify(after));
    p.sessions.set(p.token, p.session);
    await page.shut();

    // ═══ 2b. Leaving for Google ═════════════════════════════════════════════════════════════════
    // A Google connect (Drive, Email, Calendar, Chat) sends the window to Google's consent screen, which refuses to be drawn in a
    // frame. From inside the app's frame it is the app's own window that goes; from a page on its own, that page's.
    for (const framed of [true, false]) {
      page = await open(p, { src: framed ? `${p.classic}?embed=1#${p.start}` : `${p.classic}#${p.start}`, framed });
      await until(page, () => document.querySelector('.page.active') || window.__msgs);
      await sleep(framed ? 500 : 1200);
      const guest = framed ? page.inside() : page;
      const insideUrl = guest.url();
      guest.evaluate(code => { try { (0, eval)(code); } catch (_) {} }, p.name === 'admin' ? 'connectDrive()' : "empConnectNav('/api/drive/connect')").catch(() => {});
      let left = null;
      for (let i = 0; i < 80 && !left; i++) { left = page.navs.find(n => /\/api\/drive\/connect$/.test(n.path)); if (!left) await sleep(100); }
      check(`${tag} ${framed ? 'a Google connect started in the frame sends the app\'s window, and the frame stays where it is' : 'a Google connect started by a page on its own sends that page, as it always did'}`,
        !!left && left.top === true && page.navs.filter(n => /\/api\/drive\/connect$/.test(n.path) && !n.top).length === 0 && (!framed || insideUrl.includes('embed=1')), JSON.stringify(page.navs.filter(n => /connect/.test(n.path))));
      await page.shut();
    }

    // ═══ 3. An installed app on a phone: two things the page does for itself, and not in a frame ═
    const phoneOf = () => ({ bottomNav: document.querySelector('.bottom-nav') ? getComputedStyle(document.querySelector('.bottom-nav')).display : 'absent', room: getComputedStyle(document.querySelector('.app-content, .content')).paddingBottom, installed: document.body.classList.contains('standalone') });
    page = await open(p, { src: `${p.classic}?embed=1#${p.start}`, installed: true, frameWidth: 390 });
    await heard(page, 'ready');
    await sleep(800);
    const phone = await page.inside().evaluate(phoneOf);
    check(`${tag} on a phone, in an installed app, the framed page has no bottom bar, no room kept for one, and no installed look (the app around it has all three)`, phone.bottomNav === 'none' && phone.room === '0px' && phone.installed === false, JSON.stringify(phone));
    await page.shut();
    page = await open(p, { src: `${p.classic}#${p.start}`, framed: false, installed: true, width: 390 });
    await until(page, () => document.querySelector('.page.active'));
    await sleep(800);
    const phoneAlone = await page.evaluate(phoneOf);
    check(`${tag} …all of which the ordinary page has on a phone, so the check above can tell`, phoneAlone.bottomNav !== 'none' && phoneAlone.bottomNav !== 'absent' && phoneAlone.room !== '0px' && phoneAlone.installed === true, JSON.stringify(phoneAlone));
    await page.shut();

    // ═══ 3b. Opened without a session the server knows ═════════════════════════════════════
    for (const [what, token] of [['a session the server does not know', 'embed-unknown'], ['no session at all', null]]) {
      page = await open(p, { src: `${p.classic}?embed=1#${p.start}`, token });
      const told = await heard(page, 'unauthorized');
      await sleep(800);
      const gone = await page.inside().evaluate(key => ({ token: localStorage.getItem(key), auth: ['#auth-screen', '#auth-wrap'].map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'absent'; }) }), p.key);
      const said = (await page.msgs()).map(m => m.type);
      check(`${tag} opened with ${what}, the framed page tells the app, shows no sign-in form, and leaves the token as it found it`,
        told && !said.includes('ready') && gone.auth.every(d => d === 'none' || d === 'absent') && gone.token === token, JSON.stringify({ said, gone }));
      await page.shut();
    }

    // ═══ 4. Not in a frame: the ordinary page ═══════════════════════════════════════════════
    page = await open(p, { src: `${p.classic}?embed=1#${p.start}`, framed: false });
    await until(page, () => document.querySelector('.page.active'));
    await asked(page, STREAM); await asked(page, PRESENCE); await asked(page, PUSH); await asked(page, HUDDLE);     // (it takes a moment to start them)
    const alone = await page.evaluate(chrome => ({ marked: document.documentElement.hasAttribute('data-embed'), bridge: typeof window.mlEmbed, sw: window.__swCalls }), p.chrome);
    const aloneChrome = await page.evaluate(sels => sels.map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'absent'; }), p.chrome);
    check(`${tag} opened by itself with ?embed=1 (a pasted link) the page is the ordinary page: chrome, worker, stream, presence, push and huddle check`,
      !alone.marked && alone.bridge === 'undefined' && aloneChrome.every(d => d !== 'none' && d !== 'absent') && alone.sw.length === 1 && count(page, STREAM) >= 1 && count(page, PRESENCE) >= 1 && count(page, PUSH) >= 1 && count(page, HUDDLE) >= 1,
      JSON.stringify({ alone, aloneChrome, streams: count(page, STREAM), presence: count(page, PRESENCE), push: count(page, PUSH), huddle: count(page, HUDDLE) }));
    await page.shut();

    // ═══ 5. Not embedded at all: unchanged ══════════════════════════════════════════════════
    page = await open(p, { src: `${p.classic}#${p.start}`, framed: false });
    await until(page, () => document.querySelector('.page.active'));
    await asked(page, STREAM); await asked(page, PUSH); await asked(page, HUDDLE);
    const plainPage = await page.evaluate(() => ({ marked: document.documentElement.hasAttribute('data-embed'), assistant: typeof window.aiOnNavigate, sw: window.__swCalls }));
    const plainChrome = await page.evaluate(sels => sels.map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'absent'; }), p.chrome);
    check(`${tag} the ordinary page keeps its chrome, its assistant, its worker, and starts the stream, presence, push and huddle check`,
      !plainPage.marked && plainChrome.every(d => d !== 'none' && d !== 'absent') && plainPage.assistant === 'function' && plainPage.sw.length === 1 && count(page, STREAM) >= 1 && count(page, PRESENCE) >= 1 && count(page, PUSH) >= 1 && count(page, HUDDLE) >= 1,
      JSON.stringify({ plainPage, plainChrome }));
    await page.shut();
  }

  // ═══ 6. A parent on another origin gets no frame at all ═══════════════════════════════════
  // This used to hold the page to speaking only to its own origin while it sat inside a foreign frame. The server now tells browsers
  // who may frame its pages (frame-ancestors 'self': src/http/frame-guard.js, held by tests/framing.js), so the page never sits in one:
  // the browser refuses the frame, and there is nothing to hear from and nothing to steer. The bridge's origin checks stay as the
  // second line (the sibling frame above, which IS the same origin, still shows them working).
  if (!only || only === 'admin') {
    const p = PORTALS[0];
    const http = require('http');
    const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(HOST(base + p.classic + '?embed=1#' + p.start)); }).listen(Number(new URL(hostBase).port), '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const page = await open(p, { src: `${p.classic}?embed=1#${p.start}`, parent: hostBase });
    const f = await (async () => { for (let i = 0; i < 100; i++) { const x = page.inside(); if (x && /^chrome-error:/.test(x.url())) return x; await sleep(100); } return null; })();
    await sleep(1500);
    const heardAny = await page.msgs();
    check('a page that frames it from another origin gets no frame: the browser refuses it (frame-ancestors)', !!f, f ? f.url() : 'the frame never became an error page');
    check('…so there is nothing it can hear from the page, and nothing of the page for it to steer', !!f && heardAny.length === 0, JSON.stringify(heardAny));
    await page.shut();
    server.close();
  }

  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
