// The look, in a real browser against the real app. The server writes the workspace's look into
// the page before it is sent, so a page opens already in it and nothing flashes; when the admin
// changes it, a team member's page, open in another tab, follows at once over the notification
// stream; each person's own dark / light / automatic is applied, remembered, kept on the server
// and followed across devices — unless the workspace says people may not choose; and a page
// opened with ?safe=1 stays in the original look whatever is saved.
const puppeteer = require('puppeteer');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const T = require('../public/assets/theme-core.js');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = createFakeSupabase({
  employees: [{ id: 2, name: 'Sara', username: 'sara', email: '', password_hash: 'x', permissions: { chat: true }, job_title: 'Sales', avatar_url: '', status_text: '', status_emoji: '' }],
  sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [], presence: [],
  chat_rooms: [], chat_room_members: [], chat_messages: [],
});
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3978 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const ADMIN = 'thui-admin', SARA = 'thui-sara';
  ctx.sessions.set(ADMIN, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(SARA, { id: 2, name: 'Sara', username: 'sara', job_title: 'Sales', permissions: normEmpPerms({ chat: true }), createdAt: Date.now() });
  const A = { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' };
  const save = body => fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: A, body: JSON.stringify(body) });
  // (what people chose for themselves is kept on the server: each section starts from nobody having chosen)
  const forgetPrefs = () => { const t = db.tables.quotation_settings; for (let i = t.length - 1; i >= 0; i--) if (String(t[i].key).startsWith('ui_prefs:')) t.splice(i, 1); };
  const reset = async () => { forgetPrefs(); return save({ reset: true }); };

  const browser = await puppeteer.launch({ executablePath: require('./helpers/browser').chromePath(), headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  // A page in a context of its own (so its storage is its own), signed in or not, with whatever
  // the browser had stored before the page ran.
  async function open(route, { token, stored = {}, query = '', media, chart } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setBypassServiceWorker(true);
    page.on('pageerror', e => errors.push(route + ': ' + String(e)));
    await page.setRequestInterception(true);
    page.on('request', req => { if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' }); req.continue(); });
    if (media) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: media }]);
    await page.evaluateOnNewDocument((route, token, stored, chart) => {
      window.lucide = { createIcons() {} };
      window.Chart = chart ? Object.assign(function () { return { destroy() {}, update() {} }; }, { defaults: { color: '#666', borderColor: 'rgba(0,0,0,0.1)' }, instances: {} }) : function () { return { destroy() {}, update() {} }; };
      if (token) localStorage.setItem(route === '/dashboard' ? 'ml_admin_token' : 'ml_emp_token', token);
      for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
      // What the page looked like the moment it could first be drawn: the server's work, before any script of the page's own.
      document.addEventListener('DOMContentLoaded', () => {
        const root = document.documentElement;
        window.__first = { mode: root.getAttribute('data-mode'), body: getComputedStyle(document.body).backgroundColor, primary: getComputedStyle(root).getPropertyValue('--primary').trim() };
      });
    }, route, token, stored, !!chart);
    await page.goto(base + route + query, { waitUntil: 'domcontentloaded' });
    return page;
  }
  const until = async (page, fn, arg, ms = 6000) => page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg).then(() => true, () => false);
  const state = page => page.evaluate(() => {
    const root = document.documentElement, cs = getComputedStyle(root);
    const st = document.getElementById('ws-theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    const t = document.getElementById('ml-mode-toggle');
    return {
      mode: root.getAttribute('data-mode'), stored: localStorage.getItem('ml_mode'),
      primary: cs.getPropertyValue('--primary').trim(), bg: cs.getPropertyValue('--bg').trim(), body: getComputedStyle(document.body).backgroundColor,
      css: st ? st.textContent : null, meta: meta ? meta.getAttribute('content') : null,
      toggle: t ? { shown: getComputedStyle(t).display !== 'none', pref: t.getAttribute('data-mode-pref'), label: t.getAttribute('aria-label') } : null,
      font: (document.querySelector('link[href^="https://fonts.googleapis.com/css2?"]') || {}).href || null,
      first: window.__first,
    };
  });

  await reset();

  // ── The original look: nothing changes for a workspace that has chosen nothing ────────
  {
    const p = await open('/dashboard', { token: ADMIN });
    check('the dashboard opens', await until(p, () => document.getElementById('app').style.display === 'block'));
    const s = await state(p);
    check('a workspace that has chosen nothing opens dark, in the original colours', s.mode === 'dark' && s.first.mode === 'dark' && s.first.body === 'rgb(12, 12, 14)' && s.first.primary === '#c9a35e', JSON.stringify(s.first));
    check('…and has the colour-mode button, showing what it is set to', s.toggle && s.toggle.shown && s.toggle.pref === 'dark' && /Dark/.test(s.toggle.label), JSON.stringify(s.toggle));
    await p.close();
  }

  // ── A saved look is on the page before anything is drawn ─────────────────────────────
  {
    await save({ theme: { preset: 'moto' } });   // Moto Palette opens light
    const p = await open('/dashboard', { token: ADMIN });
    await until(p, () => !!window.__first);
    const s = await state(p);
    check('a look that opens light is light at the first paint, in its own colours', s.first.mode === 'light' && s.first.body === 'rgb(245, 249, 243)' && s.first.primary === '#328008', JSON.stringify(s.first));
    check('the browser bar takes the page\'s colour', s.meta === '#f5f9f3', s.meta);
    await p.close();
  }

  // ── The admin changes the look; a team member's open page follows ────────────────────
  {
    await reset();
    const sara = await open('/employee', { token: SARA });
    check('the team portal opens', await until(sara, () => !!document.querySelector('.sidebar-brand-name') && !!window.__first));
    await sleep(900);   // its stream is open
    let s = await state(sara);
    check('…in the original look', s.mode === 'dark' && s.primary === '#c9a35e');
    await save({ theme: { preset: 'cyberpunk' }, typography: { heading: 'orbitron' } });
    check('saving a look re-themes the open page, no reload', await until(sara, () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#00e5ff'));
    s = await state(sara);
    check('…the colours, and the fonts the same save chose', /#00e5ff/.test(s.css) && /Orbitron/.test(s.font), s.font);
    await save({ theme: { preset: 'moto' } });
    check('and a look that is light by default turns the open page light', await until(sara, () => document.documentElement.getAttribute('data-mode') === 'light'));
    s = await state(sara);
    check('…with the browser bar following', s.meta === '#f5f9f3', s.meta);
    await reset();
    check('putting everything back puts the page back', await until(sara, () => document.documentElement.getAttribute('data-mode') === 'dark' && getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#c9a35e'));
    s = await state(sara);
    check('…including the fonts it started with', s.font === T.fontsHref({}), s.font);
    await sara.close();
  }

  // ── A person's own choice ─────────────────────────────────────────────────────────────
  {
    await reset();
    const p = await open('/dashboard', { token: ADMIN });
    await until(p, () => document.getElementById('app').style.display === 'block');
    await sleep(500);
    await p.click('#ml-mode-toggle');
    await sleep(200);
    let s = await state(p);
    check('the button moves a page from dark to light, at once', s.mode === 'light' && s.stored === 'light' && s.toggle.pref === 'light', JSON.stringify(s.toggle));
    check('…and a light page paints in the light tokens (the original look\'s light is a look of its own)', s.body === 'rgb(247, 244, 238)', s.body);
    await p.click('#ml-mode-toggle');
    await sleep(200);
    s = await state(p);
    check('the next press is automatic', s.stored === 'auto' && s.toggle.pref === 'auto' && /Automatic/.test(s.toggle.label));
    await p.click('#ml-mode-toggle');
    await sleep(200);
    s = await state(p);
    check('and the next is dark again', s.stored === 'dark' && s.mode === 'dark');
    await p.click('#ml-mode-toggle');   // light
    await sleep(600);
    const saved = await (await fetch(base + '/api/dashboard/ui-prefs', { headers: A })).json();
    check('the choice is kept on the server, for another device', saved.mode === 'light', JSON.stringify(saved));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await until(p, () => !!window.__first);
    s = await state(p);
    check('a reload opens in the chosen mode at the first paint', s.first.mode === 'light' && s.mode === 'light', JSON.stringify(s.first));
    await p.close();
  }

  // ── Automatic follows the device, while the page is open ─────────────────────────────
  {
    await reset();
    const p = await open('/dashboard', { token: ADMIN, stored: { ml_mode: 'auto' }, media: 'light' });
    await until(p, () => document.getElementById('app').style.display === 'block');
    let s = await state(p);
    check('automatic under a light system opens light', s.mode === 'light' && s.first.mode === 'light', JSON.stringify(s.first));
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    check('…and follows the system when it changes, without a reload', await until(p, () => document.documentElement.getAttribute('data-mode') === 'dark'));
    await p.close();
    const q = await open('/dashboard', { token: ADMIN, stored: { ml_mode: 'auto' }, media: 'dark' });
    await until(q, () => document.getElementById('app').style.display === 'block');
    check('automatic under a dark system opens dark', (await state(q)).mode === 'dark');
    await q.close();
  }

  // ── Another device ────────────────────────────────────────────────────────────────────
  {
    await reset();
    await fetch(base + '/api/dashboard/ui-prefs', { method: 'PUT', headers: A, body: JSON.stringify({ mode: 'light' }) });
    const p = await open('/dashboard', { token: ADMIN });   // this browser has chosen nothing
    check('what the person chose on another device is adopted once they are signed in', await until(p, () => document.documentElement.getAttribute('data-mode') === 'light' && localStorage.getItem('ml_mode') === 'light'));
    await p.close();
    // …and a browser that has a choice the server does not tells the server.
    await fetch(base + '/api/dashboard/ui-prefs', { method: 'PUT', headers: A, body: JSON.stringify({ mode: 'dark' }) });
    const q = await open('/dashboard', { token: ADMIN, stored: { ml_mode: 'auto' } });
    await until(q, () => document.getElementById('app').style.display === 'block');
    await sleep(800);
    const now = await (await fetch(base + '/api/dashboard/ui-prefs', { headers: A })).json();
    check('a choice this browser made is sent to the server, not overwritten by it', now.mode === 'auto' && (await state(q)).stored === 'auto', JSON.stringify(now));
    await q.close();
  }

  // ── When the workspace says people may not choose ─────────────────────────────────────
  {
    await reset();
    await save({ theme: { allow_user_mode: false, default_mode: 'dark' } });
    const p = await open('/employee', { token: SARA, stored: { ml_mode: 'light' } });
    await until(p, () => !!document.querySelector('.sidebar-brand-name'));
    await sleep(500);
    const s = await state(p);
    check('the workspace\'s mode wins over a stored choice…', s.mode === 'dark' && s.first.mode === 'dark', JSON.stringify(s.first));
    check('…and the colour-mode button is not there to press', s.toggle && s.toggle.shown === false);
    await save({ theme: { allow_user_mode: true, default_mode: 'dark' } });
    check('letting people choose again gives it back, live', await until(p, () => document.documentElement.getAttribute('data-mode') === 'light' && getComputedStyle(document.getElementById('ml-mode-toggle')).display !== 'none'));
    await p.close();
  }

  // ── Safe mode ─────────────────────────────────────────────────────────────────────────
  {
    forgetPrefs();
    await save({ theme: { preset: 'cyberpunk', default_mode: 'dark' } });
    const p = await open('/dashboard', { token: ADMIN, query: '?safe=1' });
    await until(p, () => document.getElementById('app').style.display === 'block');
    await sleep(700);
    let s = await state(p);
    check('?safe=1 opens the original look whatever is saved', s.primary === '#c9a35e' && s.body === 'rgb(12, 12, 14)', JSON.stringify([s.primary, s.body]));
    await save({ theme: { preset: 'ember' } });
    await sleep(1200);
    s = await state(p);
    check('…and a change pushed to it does not take it out of the original look', s.primary === '#c9a35e', s.primary);
    await p.close();
    const q = await open('/dashboard', { token: ADMIN });
    await until(q, () => document.getElementById('app').style.display === 'block');
    check('the same saved look is on the page without it', (await state(q)).primary === '#ff6a3d');
    await q.close();
  }

  // ── An older profile never overwrites a newer one ─────────────────────────────────────
  {
    await reset();
    await save({ theme: { preset: 'deep-ocean' } });
    const p = await open('/dashboard', { token: ADMIN });
    await until(p, () => document.getElementById('app').style.display === 'block');
    const before = (await state(p)).primary;
    await p.evaluate(() => wsApply({ name: 'Old', logo_url: '', updated_at: '2001-01-01T00:00:00.000Z', theme: { preset: 'ember' }, typography: {}, shape: {}, texts: {} }));
    const s = await state(p);
    check('a profile older than the one being worn is ignored', before === '#38bdf8' && s.primary === '#38bdf8' && !/Old/.test(await p.evaluate(() => document.title)), JSON.stringify([before, s.primary]));
    await p.close();
    // A copy kept in the browser is older than the page the server just wrote: it does not win.
    const old = { name: 'MotoLinker', logo_url: '', updated_at: '2001-01-01T00:00:00.000Z', theme: { preset: 'ember' }, typography: {}, shape: {}, texts: {} };
    const q = await open('/dashboard', { token: ADMIN, stored: { ml_workspace: JSON.stringify(old) } });
    await until(q, () => document.getElementById('app').style.display === 'block');
    await sleep(600);
    check('a stale copy kept in the browser does not repaint the page the server wrote', (await state(q)).primary === '#38bdf8');
    await q.close();
    // …and a newer one (made while offline, say) does.
    const newer = { name: 'MotoLinker', logo_url: '', updated_at: '2999-01-01T00:00:00.000Z', theme: { preset: 'matrix' }, typography: {}, shape: {}, texts: {} };
    const r = await open('/dashboard', { token: ADMIN, stored: { ml_workspace: JSON.stringify(newer) } });
    await until(r, () => document.getElementById('app').style.display === 'block');
    check('a newer one is worn at once (the server\'s answer is older than it)', (await state(r)).primary === '#00ff6a');
    await r.close();
  }

  // ── The charts read the page's colours where Chart.js's own would be wrong ───────────
  {
    await reset();
    let p = await open('/dashboard', { token: ADMIN, chart: true });
    await until(p, () => document.getElementById('app').style.display === 'block');
    await sleep(500);
    let d = await p.evaluate(() => ({ c: Chart.defaults.color, b: Chart.defaults.borderColor }));
    check('in the original look the charts keep Chart.js\'s defaults', d.c === '#666' && d.b === 'rgba(0,0,0,0.1)', JSON.stringify(d));
    await p.click('#ml-mode-toggle');   // light
    await sleep(300);
    d = await p.evaluate(() => ({ c: Chart.defaults.color, b: Chart.defaults.borderColor, muted: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() }));
    check('on a light page they read the page\'s secondary text and hairline', d.c === d.muted && d.c !== '#666' && d.b !== 'rgba(0,0,0,0.1)', JSON.stringify(d));
    await p.click('#ml-mode-toggle'); await p.click('#ml-mode-toggle');   // auto, dark
    await sleep(300);
    d = await p.evaluate(() => ({ c: Chart.defaults.color, b: Chart.defaults.borderColor }));
    check('…and put back when the page goes dark again', d.c === '#666' && d.b === 'rgba(0,0,0,0.1)', JSON.stringify(d));
    await p.close();
  }

  await reset();
  await browser.close();
  check('no page raised an error', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
