// The workspace's name and picture, in a real browser against the real app: the admin
// changes them in one portal and a team member's page, open in another, follows at
// once — over the notification stream, without a reload. Also the signed-out sign-in
// page (which reads them before anyone signs in), the copy remembered for the next
// load, and a group given its picture as it is created.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = createFakeSupabase({
  employees: [{ id: 2, name: 'Sara', username: 'sara', email: '', password_hash: 'x', permissions: { chat: true }, job_title: 'Sales', avatar_url: '', status_text: '', status_emoji: '' }],
  sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [], presence: [],
  chat_rooms: [], chat_room_members: [], chat_messages: [],
});
db.install();

// A real picture to hand the file inputs: 300×200, so the crop to a square shows.
const PNG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-ws-'));
const PNG = path.join(PNG_DIR, 'logo.png');

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3977 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const ADMIN = 'wsui-admin', SARA = 'wsui-sara';
  ctx.sessions.set(ADMIN, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(SARA, { id: 2, name: 'Sara', username: 'sara', job_title: 'Sales', permissions: normEmpPerms({ chat: true }), createdAt: Date.now() });

  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  async function open(route, token, ctxOpts) {
    const context = ctxOpts && ctxOpts.fresh ? await browser.createBrowserContext() : browser.defaultBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setBypassServiceWorker(true);
    page.on('pageerror', e => errors.push(route + ': ' + String(e)));
    page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
      if (ctxOpts && ctxOpts.workspaceDown && req.url().endsWith('/api/workspace')) return req.respond({ status: 500, contentType: 'application/json', body: '{}' });
      // The stored picture's address is on the stand-in database's host; serve it.
      if (req.url().includes('stub.supabase.co/storage/')) return req.respond({ status: 200, contentType: 'image/png', body: fs.readFileSync(PNG) });
      req.continue();
    });
    await page.evaluateOnNewDocument((route, token) => {
      window.lucide = { createIcons() {} };
      window.Chart = function () { return { destroy() {}, update() {} }; };
      if (token) localStorage.setItem(route === '/dashboard' ? 'ml_admin_token' : 'ml_emp_token', token);
    }, route, token);
    await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    return page;
  }
  const brand = page => page.evaluate(() => {
    const css = sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).backgroundImage : ''; };
    return {
      names: [...document.querySelectorAll('[data-ws-name]')].map(e => e.textContent),
      title: document.title,
      logoVar: document.documentElement.style.getPropertyValue('--ws-logo'),
      favicon: document.querySelector('link[rel="icon"]').getAttribute('href'),
      mark: css('.sidebar-logo-icon') || css('.sidebar-icon'),
      cached: localStorage.getItem('ml_workspace'),
    };
  });
  // Polled on a timer: a page in a background tab runs no animation frames, and
  // waitForFunction polls on those by default.
  // A stored PNG's own width and height, from its header.
  const pngSize = b => (b && b.length > 24 && b.toString('ascii', 12, 16) === 'IHDR') ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : '?';
  const until = async (page, fn, arg, ms = 6000) => page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg).then(() => true, () => false);

  // Make the fixture picture with the browser's own canvas.
  {
    const p = await browser.newPage();
    const b64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      const g = c.getContext('2d'); g.fillStyle = '#2a6'; g.fillRect(0, 0, 300, 200); return c.toDataURL('image/png').split(',')[1]; });
    fs.writeFileSync(PNG, Buffer.from(b64, 'base64'));
    await p.close();
  }

  const admin = await open('/dashboard', ADMIN);
  const sara = await open('/employee', SARA);
  check('both portals load', await until(admin, () => document.getElementById('app').style.display === 'block')
    && await until(sara, () => !!document.querySelector('.sidebar-brand-name')));
  await sleep(800);
  let a = await brand(admin), s = await brand(sara);
  check('with nothing set, the workspace is called what it always was', a.names.every(n => n === 'MotoLinker') && a.names.length >= 2
    && a.title === 'MotoLinker · Admin Dashboard' && s.title === 'MotoLinker — Team Portal', JSON.stringify({ a, s }).slice(0, 300));
  check('…with its usual mark', /images\.motolinkers\.com/.test(a.mark) && /images\.motolinkers\.com/.test(s.mark), JSON.stringify([a.mark, s.mark]));
  check('the admin has a Workspace entry; the team portal has none',
    await admin.evaluate(() => [...document.querySelectorAll('.sidebar-footer .logout-btn')].some(b => /Workspace/.test(b.textContent)))
    && !(await sara.evaluate(() => typeof openWorkspaceSettings === 'function')));

  // ── The admin renames it ─────────────────────────────────────────────────────
  await admin.evaluate(() => openWorkspaceSettings());
  await sleep(200);
  check('the editor shows the current name', await admin.evaluate(() => document.getElementById('ws-name').value) === 'MotoLinker');
  await admin.evaluate(() => { document.getElementById('ws-name').value = 'Acme Motors'; document.getElementById('ws-save-btn').click(); });
  check('the admin\'s page shows the new name everywhere it showed the old',
    await until(admin, () => document.title === 'Acme Motors · Admin Dashboard'
      && [...document.querySelectorAll('[data-ws-name]')].every(e => e.textContent === 'Acme Motors')), JSON.stringify(await brand(admin)).slice(0, 200));
  check('a team member\'s open page follows at once, without a reload',
    await until(sara, () => document.title === 'Acme Motors — Team Portal'
      && [...document.querySelectorAll('[data-ws-name]')].every(e => e.textContent === 'Acme Motors')), JSON.stringify(await brand(sara)).slice(0, 200));
  check('…and it is stored', JSON.parse((db.tables.quotation_settings.find(r => r.key === 'workspace_profile') || {}).value || '{}').name === 'Acme Motors');

  // ── …and gives it a picture ──────────────────────────────────────────────────
  const input = await admin.$('#ws-logo-input');
  await input.uploadFile(PNG);
  check('the picture goes up from the editor', await until(admin, () => !!document.documentElement.style.getPropertyValue('--ws-logo')));
  const stored = [...db.storage.entries()].find(([k]) => k.startsWith('chat-files/workspace/'));
  check('…cropped to its middle square on the way (300×200 in, 200×200 stored)', !!stored && stored[1].contentType === 'image/png' && pngSize(stored[1].bytes) === '200x200',
    stored ? pngSize(stored[1].bytes) : 'nothing stored');
  check('the team member\'s page shows it too, in the mark and the tab',
    await until(sara, () => /workspace\/logo_/.test(document.documentElement.style.getPropertyValue('--ws-logo'))
      && /workspace\/logo_/.test(document.querySelector('link[rel="icon"]').getAttribute('href'))
      && /workspace\/logo_/.test(getComputedStyle(document.querySelector('.sidebar-icon')).backgroundImage)), JSON.stringify(await brand(sara)).slice(0, 300));
  a = await brand(admin);
  check('…as does the admin\'s', /workspace\/logo_/.test(a.mark) && /workspace\/logo_/.test(a.favicon), JSON.stringify(a).slice(0, 300));

  // ── The next load, and the sign-in page ──────────────────────────────────────
  const offline = await open('/employee', SARA, { workspaceDown: true });
  await sleep(800);
  const o = await brand(offline);
  check('the next load shows the remembered name even before (or without) the server', o.names.every(n => n === 'Acme Motors') && o.title === 'Acme Motors — Team Portal', JSON.stringify(o).slice(0, 200));
  await offline.close();
  const signedOut = await open('/employee', null, { fresh: true });
  await sleep(1000);
  const so = await brand(signedOut);
  check('the sign-in page reads the workspace before anyone signs in',
    so.names.includes('Acme Motors') && /Acme Motors/.test(await signedOut.evaluate(() => document.querySelector('.auth-logo p').textContent))
    && /workspace\/logo_/.test(await signedOut.evaluate(() => getComputedStyle(document.querySelector('.auth-logo-icon')).backgroundImage)),
    JSON.stringify(so).slice(0, 200));
  await signedOut.close();

  // ── Back to the default picture ──────────────────────────────────────────────
  await admin.evaluate(() => openWorkspaceSettings());
  await sleep(150);
  await admin.evaluate(() => wsRemoveLogo());
  check('removing the picture brings the default mark back, everywhere',
    await until(sara, () => !document.documentElement.style.getPropertyValue('--ws-logo')
      && document.querySelector('link[rel="icon"]').getAttribute('href') === '/icons/favicon.png'
      && /images\.motolinkers\.com/.test(getComputedStyle(document.querySelector('.sidebar-icon')).backgroundImage)), JSON.stringify(await brand(sara)).slice(0, 300));
  check('…and the file goes from storage', ![...db.storage.keys()].some(k => k.startsWith('chat-files/workspace/')), JSON.stringify([...db.storage.keys()]));
  s = await brand(sara);
  check('…keeping the name', s.names.every(n => n === 'Acme Motors'), JSON.stringify(s.names));

  // ── A group made with its picture ────────────────────────────────────────────
  await admin.evaluate(() => navigate('chat'));
  await sleep(600);
  await admin.evaluate(() => adminShowGroupModal());
  await sleep(300);
  await admin.evaluate(() => {
    document.getElementById('admin-group-name').value = 'Showroom';
    [...document.getElementById('admin-group-members').options].forEach(o => { o.selected = o.value === 'employee_2'; });
  });
  await (await admin.$('#admin-group-picture')).uploadFile(PNG);
  await admin.evaluate(() => adminCreateGroup());
  const made = await until(admin, () => !!document.querySelector('#admin-chat-room-list .chat-room-avatar img'), null, 8000);
  const room = db.tables.chat_rooms.find(r => r.name === 'Showroom');
  check('a group can be given its picture as it is made', made && room && /group-avatars\/\d+_/.test(room.avatar_url || ''), JSON.stringify(room));
  const header = await admin.evaluate(() => { const i = document.querySelector('#admin-chat-main .chat-header-avatar img'); return i ? i.getAttribute('src') : ''; });
  check('…shown in the list and the conversation\'s header', /group-avatars\//.test(header), header);
  const forSara = await sara.evaluate(async () => (await (await ef('/api/employee/chat/rooms')).json()).find(r => r.name === 'Showroom'));
  check('…and to everyone in it', forSara && forSara.avatar_url === room.avatar_url, JSON.stringify(forSara).slice(0, 200));
  const pic = [...db.storage.entries()].find(([k]) => k.startsWith('chat-files/group-avatars/'));
  check('…cropped square before it was sent', !!pic && pngSize(pic[1].bytes) === '200x200', pic ? pngSize(pic[1].bytes) : 'nothing stored');

  const mine = errors.filter(e => /ws|workspace|Workspace|chatRoomFace|chatSquarePicture|chatRoomPicture|hdThread/.test(e));
  check('no page errors from any of this', mine.length === 0, mine.slice(0, 3).join(' | '));
  await browser.close();
  fs.rmSync(PNG_DIR, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
