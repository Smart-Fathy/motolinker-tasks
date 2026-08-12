// Group administration + status visibility, driven through the real portal pages
// with every /api/ call intercepted and answered from fixtures.
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, extra) => { results.push({ n, ok }); console.log((ok ? '  ok  ' : ' FAIL ') + n + (extra ? '  ' + extra : '')); };

const ROOMS = me => ([
  { id: 1, type: 'group', name: 'Ops', created_by: 'admin', updated_at: '2026-08-01T09:00:00Z',
    members: [
      { member_key: 'admin', member_name: 'Admin' },
      { member_key: 'employee_2', member_name: 'Sara', member_status_emoji: '🌴', member_status: 'On leave' },
      ...(me === 'employee_2' ? [] : []),
    ],
    lastMessage: { body: 'Morning', created_at: '2026-08-01T09:00:00Z' } },
  { id: 2, type: 'direct', name: '', created_by: 'admin', updated_at: '2026-08-01T08:00:00Z',
    members: [
      { member_key: me, member_name: me === 'admin' ? 'Admin' : 'Sara' },
      { member_key: 'employee_3', member_name: 'Omar', member_status_emoji: '🚗', member_status: 'On the road' },
    ],
    lastMessage: { body: 'ok', created_at: '2026-08-01T08:00:00Z' } },
  { id: 3, type: 'group', name: 'Sara Squad', created_by: 'employee_2', updated_at: '2026-07-01T08:00:00Z',
    members: [
      { member_key: 'employee_2', member_name: 'Sara' },
      { member_key: 'employee_3', member_name: 'Omar', member_status_emoji: '🚗', member_status: 'On the road' },
    ],
    lastMessage: null },
]);
// The sender line only renders for messages you did not send, so pick someone else.
const MESSAGES = me => ([{ id: 11, room_id: 1, sender_key: me === 'admin' ? 'employee_2' : 'admin',
                    sender_name: me === 'admin' ? 'Sara' : 'Admin', body: 'Morning',
                    created_at: '2026-08-01T09:00:00Z', sender_status_emoji: '🌴', sender_status: 'On leave' }]);
const PEOPLE = [{ key: 'employee_2', name: 'Sara', role: 'Sales' }, { key: 'employee_3', name: 'Omar', role: 'Ops' },
                { key: 'employee_4', name: 'Lina', role: 'Ops' }];
const FILES = [{ id: 5, sender_name: 'Sara', file_url: '/icons/icon-192.png', file_name: 'spec.pdf',
                 file_size: 20480, file_type: 'application/pdf', created_at: '2026-08-01T09:00:00Z' }];

function apiRoute(me, url, method, body, captured) {
  const u = new URL(url);
  const p = u.pathname;
  if (method !== 'GET') captured.push({ method, path: p, body: body ? JSON.parse(body) : null });
  if (/\/chat\/rooms$/.test(p)) return ROOMS(me);
  if (/\/chat\/rooms\/\d+\/messages$/.test(p)) return MESSAGES(me);
  if (/\/chat\/rooms\/\d+\/attachments$/.test(p)) return FILES;
  if (/\/chat\/people$/.test(p)) return PEOPLE;
  if (/\/chat\/rooms\/\d+\/members/.test(p)) return { ok: true };
  if (/\/chat\/rooms\/\d+$/.test(p) && method === 'PUT') return { id: 1, name: (JSON.parse(body) || {}).name };
  if (/\/huddle\/ice$/.test(p)) return { iceServers: [], hasTurn: false, max: 6 };
  if (/\/presence/.test(p)) return [];
  if (/\/auth\/check$/.test(p)) return { ok: true };
  if (/\/employee\/check$/.test(p)) return { id: 2, name: 'Sara', username: 'sara', role: 'Sales', permissions: {} };
  if (/\/notifications$/.test(p)) return [];
  return [];
}

async function runPortal(browser, opts) {
  const { label, me, route, tokenKey, token, bootstrap } = opts;
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
        body: JSON.stringify(apiRoute(me, url, req.method(), req.postData(), captured)) });
    }
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: opts.html });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      // The portals now load their CSS and JS from /assets, and Chrome is fussy
      // about script MIME types — serve them properly typed.
      const ct = f.endsWith('.js') ? 'application/javascript'
               : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });

  await page.evaluateOnNewDocument((k, v) => { localStorage.setItem(k, v); }, tokenKey, token);
  await page.goto('http://127.0.0.1:' + opts.port + route, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { window.confirm = () => true; window.lucide = window.lucide || { createIcons() {} }; });
  await sleep(400);
  await page.evaluate(bootstrap);
  await sleep(700);

  const t = (n, ok, x) => check(label + ': ' + n, ok, x);

  // ── Status is visible to everyone ──
  const listHtml = await page.evaluate(sel => (document.querySelector(sel) || {}).innerHTML || '', opts.roomListSel);
  t('room list shows the other person\'s status emoji', listHtml.includes('🚗'), listHtml.includes('status-emo') ? '' : 'no .status-emo found');

  await page.evaluate(fn => window[fn](2), opts.openRoomFn);
  await sleep(400);
  const dm = await page.evaluate(sel => {
    const root = document.querySelector(sel);
    return {
      header: (root.querySelector('.chat-header-name') || {}).innerHTML || '',
      tip: (root.querySelector('.chat-header .status-chip') || {}).title || '',
      actions: [...root.querySelectorAll('.chat-head-actions .hd-head-btn')].length,
    };
  }, opts.mainSel);
  t('DM header shows the peer status', dm.header.includes('🚗') && dm.tip === 'On the road', JSON.stringify(dm));
  t('header carries huddle + info buttons', dm.actions === 3, 'buttons=' + dm.actions);

  await page.evaluate(fn => window[fn](1), opts.openRoomFn);
  await sleep(400);
  const msgHtml = await page.evaluate(sel => (document.querySelector(sel).querySelector('.chat-msg-sender') || {}).innerHTML || '', opts.mainSel);
  t('message sender line shows their status', msgHtml.includes('🌴'), msgHtml);

  // ── Group panel ──
  await page.evaluate(() => chatGroupPanel(1));
  await sleep(500);
  const panel = await page.evaluate(() => {
    const el = document.getElementById('hd-sheet');
    return {
      open: el.style.display === 'flex',
      title: (el.querySelector('.hd-sheet-title') || {}).textContent || '',
      canRename: !!el.querySelector('#cg-name'),
      nameVal: (el.querySelector('#cg-name') || {}).value || '',
      members: [...el.querySelectorAll('#cg-members .hd-row')].map(r => r.textContent.trim()),
      removeBtns: el.querySelectorAll('#cg-members .hd-sheet-x').length,
      candidates: [...el.querySelectorAll('.cg-add-cb')].map(c => c.value),
      files: [...el.querySelectorAll('.hd-file-name')].map(f => f.textContent),
    };
  });
  t('group panel opens with name, members and files', panel.open && panel.title === 'Ops' && panel.files.join() === 'spec.pdf',
    JSON.stringify({ open: panel.open, title: panel.title, files: panel.files }));
  t('member statuses appear in the panel', (panel.members.join(' ')).includes('🌴'), JSON.stringify(panel.members));
  if (opts.canManage) {
    t('add-people list excludes existing members',
      panel.candidates.sort().join() === 'employee_3,employee_4', JSON.stringify(panel.candidates));
    t('rename field is offered to a manager', panel.canRename && panel.nameVal === 'Ops');
    t('remove buttons offered for other members', panel.removeBtns === 1, 'count=' + panel.removeBtns);

    captured.length = 0;
    await page.evaluate(() => { document.getElementById('cg-name').value = 'Ops Team'; chatRenameRoom(1); });
    await sleep(500);
    const put = captured.find(c => c.method === 'PUT');
    t('rename PUTs the new name', !!put && put.body.name === 'Ops Team', JSON.stringify(put));

    await page.evaluate(() => chatGroupPanel(1));
    await sleep(500);
    captured.length = 0;
    await page.evaluate(() => {
      document.querySelectorAll('.cg-add-cb').forEach(c => { if (c.value === 'employee_4') c.checked = true; });
      chatAddMembers(1);
    });
    await sleep(500);
    const post = captured.find(c => c.method === 'POST');
    t('adding a member POSTs memberKeys', !!post && JSON.stringify(post.body.memberKeys) === '["employee_4"]', JSON.stringify(post));

    await page.evaluate(() => chatGroupPanel(1));
    await sleep(500);
    captured.length = 0;
    await page.evaluate(() => chatRemoveMember(1, 'employee_2'));
    await sleep(500);
    const del = captured.find(c => c.method === 'DELETE');
    t('removing a member DELETEs that member key', !!del && del.path.endsWith('/rooms/1/members/employee_2'), JSON.stringify(del));
  } else {
    t('a non-manager gets no rename field', !panel.canRename);
    t('a non-manager gets no remove buttons', panel.removeBtns === 0, 'count=' + panel.removeBtns);
    t('a non-manager still sees the shared files', panel.files.join() === 'spec.pdf');

    // …but a group they created themselves is manageable
    await page.evaluate(() => chatGroupPanel(3));
    await sleep(500);
    const own = await page.evaluate(() => {
      const el = document.getElementById('hd-sheet');
      return { canRename: !!el.querySelector('#cg-name'), removeBtns: el.querySelectorAll('#cg-members .hd-sheet-x').length };
    });
    t('their own group IS manageable', own.canRename && own.removeBtns === 1, JSON.stringify(own));
  }

  t('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

(async () => {
  const server = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await puppeteer.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'],
  });

  await runPortal(browser, {
    label: 'admin', me: 'admin', port, route: '/dashboard',
    html: fs.readFileSync('public/dashboard.html', 'utf8'),
    tokenKey: 'ml_token', token: 'T',
    bootstrap: () => { document.getElementById('app').style.display = 'block'; return loadAdminChat(); },
    roomListSel: '#admin-chat-room-list', mainSel: '#admin-chat-main', openRoomFn: 'adminChatOpenRoom',
    canManage: true,
  });

  await runPortal(browser, {
    label: 'team', me: 'employee_2', port, route: '/employee',
    html: fs.readFileSync('public/employee.html', 'utf8'),
    tokenKey: 'ml_emp_token', token: 'T',
    bootstrap: async () => { window.empInfo = { id: 2, name: 'Sara' }; return loadChat(); },
    roomListSel: '#chat-room-list', mainSel: '#chat-main', openRoomFn: 'chatOpenRoom',
    canManage: false,
  });

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})();
