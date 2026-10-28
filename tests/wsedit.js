// The Workspace page, in a real browser against the real app: a draft that follows every
// control into a live preview and touches nothing real until it is saved; "try it on this
// page"; the guard that refuses a look nobody could read; saving (and a team member's open
// page following it); the sign-in wording; the person's switch being allowed or not; sharing a
// look as text; and the original look coming back.
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
  const base = await bootApp({ port: process.env.PORT || 3980 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const ADMIN = 'wsed-admin', SARA = 'wsed-sara';
  ctx.sessions.set(ADMIN, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(SARA, { id: 2, name: 'Sara', username: 'sara', job_title: 'Sales', permissions: normEmpPerms({ chat: true }), createdAt: Date.now() });
  const A = { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' };
  const stored = () => { const r = db.tables.quotation_settings.find(x => x.key === 'workspace_profile'); return r ? JSON.parse(r.value) : {}; };

  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  async function open(route, token) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1360, height: 1000 });
    await page.setBypassServiceWorker(true);
    page.on('pageerror', e => errors.push(route + ': ' + String(e)));
    page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    page.on('request', req => { if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' }); req.continue(); });
    await page.evaluateOnNewDocument((route, token) => {
      window.lucide = { createIcons() {} };
      window.Chart = function () { return { destroy() {}, update() {} }; };
      if (token) localStorage.setItem(route === '/dashboard' ? 'ml_admin_token' : 'ml_emp_token', token);
    }, route, token);
    await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    return page;
  }
  const until = async (page, fn, arg, ms = 6000) => page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg).then(() => true, () => false);
  const pv = (page, name) => page.evaluate(n => getComputedStyle(document.getElementById('wsa-pv-root')).getPropertyValue(n).trim(), name);
  const page_ = (page, name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const type = async (page, sel, value) => page.evaluate((s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, sel, value);
  const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  // The newest toast (they are plain fixed-position divs on <body>).
  const toast = page => page.evaluate(() => { const t = [...document.body.children].filter(e => e.style && e.style.position === 'fixed' && e.style.zIndex === '9999'); return t.length ? t[t.length - 1].textContent : ''; });

  const admin = await open('/dashboard', ADMIN);
  const sara = await open('/employee', SARA);
  check('both portals open', await until(admin, () => document.getElementById('app').style.display === 'block') && await until(sara, () => !!document.querySelector('.sidebar-brand-name')));
  await sleep(900);

  // ── The page ──────────────────────────────────────────────────────────────────────────
  check('the admin has Workspace in the System group and in the sidebar footer; the team portal has neither',
    await admin.evaluate(() => !!document.querySelector('#nav-workspace') && [...document.querySelectorAll('.sidebar-footer .logout-btn')].some(b => /Workspace/.test(b.textContent)))
    && await sara.evaluate(() => !document.querySelector('#nav-workspace') && typeof wsAdminLoad === 'undefined'));
  await admin.evaluate(() => navigate('workspace'));
  await sleep(300);
  check('it opens on Identity, with the name, the picture and the wording',
    await admin.evaluate(() => document.getElementById('ws-name').value === 'MotoLinker' && !!document.getElementById('ws-logo-input') && document.querySelectorAll('.wsa-text').length === 7));
  check('the wording fields show what the pages say as their placeholders', await admin.evaluate(() => [...document.querySelectorAll('.wsa-text')].every(i => i.placeholder.length > 3)));
  check('…and the preview is drawn, wearing the original look', (await pv(admin, '--primary')) === '#c9a35e' && (await pv(admin, '--bg')) === '#0c0c0e');
  check('nothing is changed, so there is nothing to discard', await admin.evaluate(() => document.getElementById('wsa-discard-btn').disabled));

  // ── A draft touches nothing real ──────────────────────────────────────────────────────
  await click(admin, '.wsa-tab[data-id="colours"]');
  check('Colours has the eight presets, one of them chosen', await admin.evaluate(() => document.querySelectorAll('.wsa-preset').length === 8 && document.querySelectorAll('.wsa-preset.on').length === 1));
  await click(admin, '.wsa-preset[data-id="moto"]');
  check('choosing a preset moves the preview to it, in the mode being previewed', (await pv(admin, '--primary')) === '#7ec842' && (await pv(admin, '--bg')) === '#04140e', await pv(admin, '--primary'));
  await click(admin, '#wsa-pv-modes button[data-id="light"]');
  check('…and the preview can be switched to light', (await pv(admin, '--bg')) === '#f5f9f3' && (await pv(admin, '--primary')) === '#328008');
  check('the real page has not changed, and nothing is stored', (await page_(admin, '--primary')) === '#c9a35e' && !(stored().theme && stored().theme.preset));
  check('…and the draft can be thrown away', await admin.evaluate(() => !document.getElementById('wsa-discard-btn').disabled));
  await type(admin, 'input.wsa-hexin[data-path="theme.accent"]', 'ff00aa');
  check('an accent typed in as hex is the preview\'s accent', (await pv(admin, '--primary')) === '#ff00aa', await pv(admin, '--primary'));
  check('a hex that is not a colour is marked and ignored', await (async () => {
    await type(admin, 'input.wsa-hexin[data-path="theme.accent"]', 'zzz');
    return admin.evaluate(() => document.querySelector('input.wsa-hexin[data-path="theme.accent"]').classList.contains('bad'));
  })());
  await click(admin, '.wsa-x[data-path="theme.accent"]');
  check('the arrow puts the preset\'s own accent back', await admin.evaluate(() => document.querySelector('input.wsa-hexin[data-path="theme.accent"]').value === ''));

  // ── Try it on this page ───────────────────────────────────────────────────────────────
  await click(admin, '#wsa-try-btn');
  await sleep(200);
  check('"try it on this page" puts the draft on the real screen, with a way back', await admin.evaluate(() => !!document.getElementById('ws-theme-draft') && !!document.getElementById('wsa-try-bar') && document.getElementById('wsa-try-left') != null));
  check('…the page is wearing it', (await page_(admin, '--primary')) !== '#c9a35e', await page_(admin, '--primary'));
  await click(admin, '#wsa-try-drop');
  check('"put it back" takes it off at once', await admin.evaluate(() => !document.getElementById('ws-theme-draft') && !document.getElementById('wsa-try-bar')) && (await page_(admin, '--primary')) === '#c9a35e');
  check('and nobody else saw any of it', (await page_(sara, '--primary')) === '#c9a35e');

  // ── The guard ─────────────────────────────────────────────────────────────────────────
  await click(admin, '.wsa-adv summary');
  await click(admin, '#wsa-adv-modes button[data-id="dark"]');
  await type(admin, 'input.wsa-hexin[data-path="theme.neutrals.dark.text"]', '2a2a2c');
  await sleep(150);
  check('text nobody could read on its background is named, and Save is withheld', await admin.evaluate(() => document.getElementById('ws-save-btn').disabled && /can't be saved yet/.test(document.getElementById('wsa-problems').textContent)),
    await admin.evaluate(() => document.getElementById('wsa-problems').textContent.slice(0, 160)));
  check('…in the readability table too', await admin.evaluate(() => document.querySelectorAll('.wsa-ct-row.error').length > 0 && document.querySelectorAll('.wsa-ct-row').length >= 16));
  await click(admin, '.wsa-x[data-path="theme.neutrals.dark.text"]');
  await sleep(150);
  check('putting it back lets it save again', await admin.evaluate(() => !document.getElementById('ws-save-btn').disabled && document.getElementById('wsa-problems').textContent === ''));

  // ── Wording, then save ────────────────────────────────────────────────────────────────
  await click(admin, '.wsa-tab[data-id="identity"]');
  await type(admin, '#wsa-text-team_title', 'Crew Portal');
  await type(admin, '#wsa-text-admin_badge', 'Back Office');
  check('the wording shows in the preview as it is typed', await admin.evaluate(() => /Crew Portal/.test(document.getElementById('wsa-pv').textContent) && /Back Office/.test(document.getElementById('wsa-pv').textContent)));
  await click(admin, '#ws-save-btn');
  check('saving stores the look…', await until(admin, () => true) && await (async () => { for (let i = 0; i < 30; i++) { const s = stored(); if (s.theme && s.theme.preset === 'moto') return true; await sleep(150); } return false; })(), JSON.stringify(stored().theme));
  const s1 = stored();
  check('…the preset, its suggested mode, and the wording', s1.theme.preset === 'moto' && s1.theme.default_mode === 'light' && s1.texts.team_title === 'Crew Portal' && s1.texts.admin_badge === 'Back Office', JSON.stringify([s1.theme, s1.texts]));
  check('a team member\'s open page re-themes at once, with the new wording', await until(sara, () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#328008' && document.documentElement.getAttribute('data-mode') === 'light' && document.querySelector('[data-ws-text="team_title"]').textContent === 'Crew Portal'));
  check('the admin\'s own page too, and its header badge says what it was told', await until(admin, () => document.documentElement.getAttribute('data-mode') === 'light' && document.querySelector('.header-badge').textContent === 'Back Office'));
  check('saved, there is nothing left to discard', await admin.evaluate(() => document.getElementById('wsa-discard-btn').disabled));
  const sign = await open('/employee', null);
  await sleep(400);
  check('a sign-in page opens with the new wording already in it (written by the server, not painted over)', await sign.evaluate(() => document.querySelector('[data-ws-text="team_title"]').textContent === 'Crew Portal'));
  await sign.close();

  // ── Who may switch ────────────────────────────────────────────────────────────────────
  await click(admin, '.wsa-tab[data-id="behaviour"]');
  await admin.evaluate(() => { const c = document.getElementById('wsa-allow'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(admin, '#ws-save-btn');
  check('turning "let people switch" off hides the button on a team member\'s page, live', await until(sara, () => getComputedStyle(document.getElementById('ml-mode-toggle')).display === 'none'));
  check('…and is stored', await (async () => { for (let i = 0; i < 20; i++) { if (stored().theme && stored().theme.allow_user_mode === false) return true; await sleep(150); } return false; })());

  // ── Sharing a look as text ────────────────────────────────────────────────────────────
  check('the look is there as text, to copy or keep', await admin.evaluate(() => { const j = JSON.parse(document.getElementById('wsa-json').value); return j.format === 'motolinker-look' && j.theme.preset === 'moto' && j.texts.team_title === 'Crew Portal'; }));
  await admin.evaluate(() => { const t = document.getElementById('wsa-json'); const j = JSON.parse(t.value); j.theme = { preset: 'matrix', allow_user_mode: true }; j.texts = {}; t.value = JSON.stringify(j); });
  await click(admin, '[data-act="import"]');
  await sleep(200);
  check('loading another look puts it in the editor, not on the screens', (await pv(admin, '--bg')) !== '' && await admin.evaluate(() => !document.getElementById('wsa-discard-btn').disabled) && stored().theme.preset === 'moto');
  await admin.evaluate(() => { document.getElementById('wsa-json').value = '{"theme":{"preset":"not-a-preset","accent":"red;}body{display:none}"}}'; });
  await click(admin, '[data-act="import"]');
  await sleep(150);
  check('a look with something that is not a colour or a preset is refused, whatever it says', /Not loaded/.test(await toast(admin)) && (await pv(admin, '--primary')) !== '' && stored().theme.preset === 'moto', await toast(admin));
  await admin.evaluate(() => { document.getElementById('wsa-json').value = '{nope'; });
  await click(admin, '[data-act="import"]');
  check('and so is text that is not JSON', /not valid JSON/.test(await toast(admin)) && stored().theme.preset === 'moto', await toast(admin));
  await click(admin, '[data-act="discard"]');
  await sleep(150);

  // ── The draft survives going elsewhere ───────────────────────────────────────────────
  await click(admin, '.wsa-tab[data-id="type"]');
  await admin.evaluate(() => { const s = document.getElementById('wsa-font-head'); s.value = 'playfair'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await admin.evaluate(() => { const r = document.getElementById('wsa-radius'); r.value = '4'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  check('the preview takes the face and the roundness', (await pv(admin, '--font-head')).includes('Playfair') && (await pv(admin, '--r-k')) === '2');
  await admin.evaluate(() => navigate('home'));
  await sleep(200);
  check('leaving the page takes any "try it" off it', await admin.evaluate(() => !document.getElementById('ws-theme-draft')));
  await admin.evaluate(() => navigate('workspace'));
  await sleep(300);
  check('coming back, the unsaved draft is still there', await admin.evaluate(() => !document.getElementById('wsa-discard-btn').disabled) && (await pv(admin, '--r-k')) === '2');
  await click(admin, '[data-act="discard"]');

  // ── The original look comes back ─────────────────────────────────────────────────────
  await click(admin, '.wsa-tab[data-id="behaviour"]');
  await click(admin, '[data-act="reset"]');
  check('"put the original look back" does, everywhere', await until(sara, () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#c9a35e' && document.documentElement.getAttribute('data-mode') === 'dark' && document.querySelector('[data-ws-text="team_title"]').textContent === 'Team Portal'));
  const s2 = stored();
  check('…stored as nothing chosen', Object.keys(s2.theme || {}).length === 0 && Object.keys(s2.texts || {}).length === 0 && Object.keys(s2.typography || {}).length === 0, JSON.stringify(s2));
  check('the safe-mode link is on the page', await admin.evaluate(() => [...document.querySelectorAll('.wsa-card a')].some(a => /safe=1/.test(a.getAttribute('href')))));

  // ── The page's text defaults are what the pages say ──────────────────────────────────
  {
    const fs = require('fs');
    const html = { admin: fs.readFileSync('public/dashboard.html', 'utf8'), team: fs.readFileSync('public/employee.html', 'utf8') };
    const said = {};
    for (const [who, text] of Object.entries(html)) for (const m of text.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-ws-text="(\w+)"[^>]*>([^<]*)<\/\1>/gi)) said[m[2]] = m[3].replace(/&amp;/g, '&');
    const want = {};
    for (const [k, v] of Object.entries(T.TEXT_DEFAULTS)) want[k] = v.replace(/\{ws\}/g, 'MotoLinker');
    check('every line the editor can replace is on a page, saying what the editor says it says', Object.keys(T.TEXT_KEYS).every(k => said[k] === want[k]), JSON.stringify(Object.keys(T.TEXT_KEYS).filter(k => said[k] !== want[k]).map(k => [k, said[k], want[k]])));
  }

  await browser.close();
  check('no page raised an error', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
