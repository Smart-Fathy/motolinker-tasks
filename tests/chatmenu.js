// Three reports: a conversation you can put away, a supplier grid whose columns
// were frozen, and a field editor whose type popup painted behind the dialog.
//
// The first is the one with teeth. Archiving and hiding are ONE PERSON'S view —
// the other side must keep the conversation exactly as it was — so most of what
// follows checks the server's shape rather than the menu's wording.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const ROOMS = [
  { id: 1, type: 'direct', name: '', icon: '', archived: false,
    members: [{ member_key: 'admin', member_name: 'Admin' }, { member_key: 'employee_2', member_name: 'Sara' }],
    lastMessage: { body: 'Morning', created_at: '2026-08-18T08:00:00Z' } },
  { id: 2, type: 'group', name: 'Procurement', icon: '🚚', archived: false,
    members: [{ member_key: 'admin', member_name: 'Admin' }, { member_key: 'employee_2', member_name: 'Sara' }],
    lastMessage: null },
  { id: 3, type: 'group', name: 'Old project', icon: '', archived: true,
    members: [{ member_key: 'admin', member_name: 'Admin' }], lastMessage: null },
];
let stateCalls = [], iconCalls = [], deleteCalls = [];

function api(pathname, method, body) {
  if (/\/rooms\/\d+\/state$/.test(pathname)) { stateCalls.push({ pathname, body: JSON.parse(body || '{}') }); return { ok: true }; }
  if (/\/rooms\/\d+\/icon$/.test(pathname)) { iconCalls.push({ pathname, body: JSON.parse(body || '{}') }); return { ok: true, id: 2 }; }
  if (method === 'DELETE' && /\/chat\/rooms\/\d+$/.test(pathname)) { deleteCalls.push(pathname); return { ok: true }; }
  if (/chat\/rooms$/.test(pathname)) return ROOMS;
  if (/huddle\/live$/.test(pathname)) return [];
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
      return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
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
  if (perms) { await page.evaluate(p => { try { applyPermissions(p); } catch (_) {} }, perms); await sleep(150); }
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
      page: 'chat', apiBase: '/api/dashboard', admin: true },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token',
      page: 'chat', apiBase: '/api/employee', admin: false,
      perms: { chat: true, chatActions: { view: true, send: true, huddle: true } } },
  ]) {
    stateCalls = []; iconCalls = []; deleteCalls = [];
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(p => navigate(p), portal.page);
    await sleep(700);

    const list = await page.evaluate(() => {
      const el = document.querySelector('#admin-chat-room-list, #chat-room-list');
      return { rows: el.querySelectorAll('.chat-room-item').length,
               dots: el.querySelectorAll('.chat-room-dots').length,
               archHead: (el.querySelector('.chat-arch-head') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
               archHidden: (el.querySelector('.chat-arch-list') || {}).style?.display === 'none',
               icon: [...el.querySelectorAll('.chat-room-avatar')].map(a => a.textContent.trim()) };
    });
    check(`${portal.label}: every conversation has a ⋯`, list.dots >= 2 && list.dots === list.rows,
      JSON.stringify({ rows: list.rows, dots: list.dots }));
    check(`${portal.label}: archived conversations sit in their own collapsed shelf`,
      /Archived \(1\)/.test(list.archHead) && list.archHidden === true, JSON.stringify(list.archHead));
    check(`${portal.label}: a group icon is shown where the initials were`,
      list.icon.includes('🚚'), JSON.stringify(list.icon));

    const menu = await page.evaluate(async () => {
      chatRoomMenu({ stopPropagation() {}, clientX: 60, clientY: 60 }, 2);
      await new Promise(r => setTimeout(r, 80));
      const items = [...document.querySelectorAll('.lead-menu.open button')].map(b => b.textContent.trim());
      return items;
    });
    check(`${portal.label}: the menu offers archive and delete-for-me`,
      menu.some(t => /Archive for me/.test(t)) && menu.some(t => /Delete for me/.test(t)), JSON.stringify(menu));
    check(`${portal.label}: group management is the admin's alone`,
      portal.admin
        ? (menu.some(t => /Rename group/.test(t)) && menu.some(t => /Group icon/.test(t))
           && menu.some(t => /Delete group for everyone/.test(t)))
        : !menu.some(t => /Rename group|Group icon|Delete group/.test(t)),
      JSON.stringify(menu));

    const acted = await page.evaluate(async () => {
      chatRoomArchive(1, true);
      await new Promise(r => setTimeout(r, 200));
      window.confirm = () => true;
      chatRoomHide(1);
      await new Promise(r => setTimeout(r, 200));
      return true;
    });
    check(`${portal.label}: archiving posts to its own portal, for this member only`,
      stateCalls.length === 2 && stateCalls[0].pathname === `${portal.apiBase}/chat/rooms/1/state`
      && stateCalls[0].body.archived === true && stateCalls[1].body.hidden === true,
      JSON.stringify(stateCalls));
    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // The admin's group tools reach the routes only the admin has.
  {
    stateCalls = []; iconCalls = []; deleteCalls = [];
    const { page } = await openPortal(browser, {
      route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', port });
    await page.evaluate(() => navigate('chat'));
    await sleep(600);
    await page.evaluate(async () => {
      window.prompt = () => '🚀';
      window.confirm = () => true;
      await chatRoomIcon(2);
      await new Promise(r => setTimeout(r, 200));
      await chatRoomDelete(2);
      await new Promise(r => setTimeout(r, 200));
    });
    check('setting a group icon PUTs it', iconCalls.length === 1
      && iconCalls[0].pathname === '/api/dashboard/chat/rooms/2/icon' && iconCalls[0].body.icon === '🚀',
      JSON.stringify(iconCalls));
    check('deleting a group DELETEs the room', deleteCalls.length === 1
      && deleteCalls[0] === '/api/dashboard/chat/rooms/2', JSON.stringify(deleteCalls));
    await page.close();
  }

  await browser.close();
  srv.close();

  // ── The server's own rules ──────────────────────────────────────────────────
  {
    const HUD = fs.readFileSync('src/routes/huddles.js', 'utf8');
    const NOTIF = fs.readFileSync('src/routes/notifications.js', 'utf8');
    check('archiving and hiding are stored on the MEMBER row, not the room',
      /chat_room_members'\)\s*\n?\s*\.update\(patch\)\.eq\('room_id', roomId\)\.eq\('member_key', key\)/.test(HUD),
      'per-member update');
    check('…and only a member of the room may set them',
      /if \(!members\.includes\(key\)\) return res\.status\(403\)/.test(HUD));
    check('the list applies MY row, so the other side is untouched',
      /archived: !!\(mine\[r\.id\] && mine\[r\.id\]\.archived_at\)/.test(NOTIF)
      && /m\.member_key === callerKey/.test(NOTIF));
    check('a hidden conversation comes back when they write again',
      /new Date\(r\.lastMessage\.created_at\) > new Date\(r\.hidden_at\)/.test(NOTIF));
    check('deleting for everyone is a GROUP thing, and the admin\'s',
      /router\.delete\('\/api\/dashboard\/chat\/rooms\/:id', requireAuth/.test(HUD)
      && /Only groups can be deleted/.test(HUD)
      && !/employee[\s\S]{0,120}delete\('\/api\/employee\/chat\/rooms\/:id'/.test(HUD));
    check('the icon is whoever may manage the group, both portals',
      /rooms\/:id\/icon`, guard[\s\S]{0,260}chatCanManage/.test(HUD)
      && /mountChatAdminRoutes\('\/api\/dashboard\/chat', requireAuth\)/.test(HUD)
      && /mountChatAdminRoutes\('\/api\/employee\/chat', requireEmployeeAuth\)/.test(HUD));
    check('a database without migration 015 says so rather than 500-ing',
      /015_chat_room_state\.sql/.test(HUD));
    const MIG = fs.readFileSync('migrations/015_chat_room_state.sql', 'utf8');
    check('migration 015 adds the three columns, idempotently',
      /chat_room_members ADD COLUMN IF NOT EXISTS archived_at/.test(MIG)
      && /chat_room_members ADD COLUMN IF NOT EXISTS hidden_at/.test(MIG)
      && /chat_rooms\s+ADD COLUMN IF NOT EXISTS icon/.test(MIG));

    // ── The supplier catalogue's columns ──────────────────────────────────────
    const PROC = fs.readFileSync('public/assets/procurement.js', 'utf8');
    check('the supplier vehicles grid reads the shared engine',
      /procColsEngine\('supplier_vehicles'/.test(PROC) && /procTh\('supplier_vehicles'/.test(PROC)
      && /procColsBtn\('supplier_vehicles'\)/.test(PROC) && /procGridInput\(eng, c, value\(c\), 'sup-v'\)/.test(PROC));
    check('…its added fields ride in custom_fields, its own columns do not',
      /if \(col && col\.builtin === false\) o\.custom_fields\[k\] = val; else o\[k\] = val;/.test(PROC));
    const SRV = fs.readFileSync('src/routes/supplier-catalogue.js', 'utf8');
    check('…and the server stores them, tolerantly of the pending migration',
      /custom_fields: b\.custom_fields/.test(SRV) && (SRV.match(/ctx\.writeOptional/g) || []).length >= 2);
    check('the entity is in the registry, gated with suppliers',
      /supplier_vehicles: \{ kvKey: 'columns_config:supplier_vehicles', perm: 'suppliers' \}/
        .test(fs.readFileSync('src/routes/columns.js', 'utf8')));
  }

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
