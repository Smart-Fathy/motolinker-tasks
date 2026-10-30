// Notifications on the server: the list and the "mark as read" that the bell and the Notification Center use, on both
// portals' routes and on /api/v1.
//
// The two portals' routes were already one piece of code (a member key in, rows out); this holds what they do — which rows,
// in which order, for whom, what a failing database answers — so that moving that code into src/modules/notifications and
// putting /api/v1/notifications beside it changes nothing for the classic pages, and so that the new routes are held to
// the same facts plus the ones the classic ones never had to be: strict about what they are sent, honest about what went
// wrong, and the same rows the live stream carries.
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const BASE_TIME = Date.parse('2026-10-01T09:00:00Z');
  const at = i => new Date(BASE_TIME + i * 1000).toISOString();
  const row = (id, member, over = {}) => ({ id, member_key: member, type: 'task', title: `Title ${id}`, body: `Body ${id}`, url: '/dashboard#tasks', read: false, created_at: at(id), ...over });
  const seed = () => {
    const rows = [
      // the admin's: oldest read, the two newer unread
      row(1, 'admin', { read: true }), row(2, 'admin', { type: 'request' }), row(3, 'admin', { type: 'lead' }),
      // Bo's two
      row(200, 'employee_52', { read: true }), row(201, 'employee_52', { type: 'reminder' }),
    ];
    // Ana's sixty: the oldest twenty read, the newer forty unread — only the newest fifty are ever listed
    for (let id = 100; id < 160; id++) rows.push(row(id, 'employee_51', { read: id < 120 }));
    return rows;
  };
  const employees = [
    { id: 51, name: 'Ana', username: 'ana', email: '', password_hash: 'x', job_title: 'Sales', permissions: {}, avatar_url: '', status_text: '', status_emoji: '' },
    { id: 52, name: 'Bo', username: 'bo', email: '', password_hash: 'x', job_title: 'Ops', permissions: {}, avatar_url: '', status_text: '', status_emoji: '' },
  ];
  const db = createFakeSupabase({ employees, sessions: [], quotation_settings: [], google_tokens: [], push_subscriptions: [], notifications: seed(), presence: [] }, { defaults: { notifications: () => ({ read: false }) } });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3995 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const reset = () => { db.tables.notifications.splice(0, db.tables.notifications.length, ...seed()); db.log.length = 0; };

  ctx.sessions.set('nt-admin', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const [token, e] of [['nt-ana', employees[0]], ['nt-bo', employees[1]]]) {
    ctx.employeeSessions.set(token, { id: e.id, name: e.name, username: e.username, job_title: e.job_title, permissions: normEmpPerms({}), createdAt: Date.now() });
  }
  const call = async (method, path, token, body) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    let json = null; try { json = await r.json(); } catch (_) { /* not JSON */ }
    return { status: r.status, body: json };
  };
  const ids = list => list.items.map(n => n.id);
  const rowOf = id => db.tables.notifications.find(n => n.id === id);
  const queries = (method, table = 'notifications') => db.log.filter(l => l.method === method && l.table === table).map(l => l.query);

  // The portals' own routes, as the classic pages call them.
  const LEGACY = [
    { who: 'the admin', token: 'nt-admin', member: 'admin', path: '/api/dashboard/notifications', read: '/api/dashboard/notifications/read', other: 'nt-ana', wrongPortal: 'nt-ana' },
    { who: 'Ana (team)', token: 'nt-ana', member: 'employee_51', path: '/api/employee/notifications', read: '/api/employee/notifications/read', other: 'nt-bo', wrongPortal: 'nt-admin' },
  ];

  // ═══ 1. The classic routes: what they do today ═══════════════════════════════════════════════
  {
    const admin = await call('GET', LEGACY[0].path, 'nt-admin');
    check('the admin\'s list is the admin\'s rows, newest first, with how many are unread', admin.status === 200 && JSON.stringify(ids(admin.body)) === '[3,2,1]' && admin.body.unread === 2 && admin.body.items.every(n => n.member_key === 'admin'), JSON.stringify(admin.body).slice(0, 120));
    check('…asked of the database as: this member, newest first, fifty at most', queries('GET')[0] === '?select=*&member_key=eq.admin&order=created_at.desc&limit=50', queries('GET')[0]);

    const ana = await call('GET', LEGACY[1].path, 'nt-ana');
    const expected = Array.from({ length: 50 }, (_, i) => 159 - i);
    check('a team member\'s list is theirs alone: the newest fifty of sixty', ana.status === 200 && JSON.stringify(ids(ana.body)) === JSON.stringify(expected) && ana.body.items.every(n => n.member_key === 'employee_51'));
    check('…and "unread" counts those fifty (the ten oldest of the fifty are read: 120..159 are unread, 110..119 are not)', ana.body.unread === 40, String(ana.body.unread));

    const bo = await call('GET', LEGACY[1].path, 'nt-bo');
    check('nobody sees another member\'s notifications', JSON.stringify(ids(bo.body)) === '[201,200]' && bo.body.unread === 1);
  }

  // ── marking read ──
  reset();
  {
    const one = await call('POST', LEGACY[0].read, 'nt-admin', { id: 2 });
    check('marking one read marks that one, for that member', one.status === 200 && one.body.ok === true && rowOf(2).read === true && rowOf(3).read === false && rowOf(1).read === true);
    check('…as a single update: this member, this row', queries('PATCH').join() === '?member_key=eq.admin&id=eq.2', queries('PATCH').join());

    reset();
    const notMine = await call('POST', LEGACY[1].read, 'nt-ana', { id: 200 });
    check('a member cannot mark another member\'s notification (it answers ok and changes nothing)', notMine.status === 200 && rowOf(200).read === true && rowOf(201).read === false && db.tables.notifications.filter(n => n.member_key === 'employee_52' && !n.read).length === 1);
    const notMineTwo = await call('POST', LEGACY[1].read, 'nt-ana', { id: 201 });
    check('…not even an unread one', notMineTwo.status === 200 && rowOf(201).read === false);

    reset();
    const all = await call('POST', LEGACY[1].read, 'nt-ana', { all: true });
    const anaRows = db.tables.notifications.filter(n => n.member_key === 'employee_51');
    check('marking all read marks every unread row of that member — those beyond the newest fifty too — and nobody else\'s', all.status === 200 && anaRows.every(n => n.read) && rowOf(201).read === false && rowOf(3).read === false);
    check('…as a single update: this member, the unread ones', queries('PATCH').join() === '?member_key=eq.employee_51&read=eq.false', queries('PATCH').join());

    reset();
    await call('POST', LEGACY[1].read, 'nt-bo', {});
    check('a body that names no row marks everything (the classic pages always send one or the other)', rowOf(201).read === true && rowOf(3).read === false);
    reset();
    await call('POST', LEGACY[0].read, 'nt-admin');
    check('…and so does no body at all', rowOf(2).read === true && rowOf(3).read === true && rowOf(100).read === true && rowOf(150).read === false);
  }

  // ── who may ask ──
  reset();
  {
    const wrong = [];
    for (const l of LEGACY) {
      for (const [label, token] of [['nobody', null], ['a token nobody issued', 'nt-nobody'], ['the other portal\'s login', l.wrongPortal]]) {
        for (const [method, path, body] of [['GET', l.path], ['POST', l.read, { all: true }]]) {
          const got = (await call(method, path, token, body)).status;
          if (got !== 401) wrong.push(`${method} ${path} as ${label}: ${got}`);
        }
      }
    }
    check('both portals\' routes refuse nobody, a token nobody issued, and the other portal\'s login', wrong.length === 0, wrong.join('; '));
    check('…and a refused request changes nothing', db.tables.notifications.filter(n => !n.read).length === seed().filter(n => !n.read).length);
  }

  // ── a database that is down ──
  reset();
  {
    db.failing.add('notifications');
    const results_ = [];
    for (const l of LEGACY) {
      const list = await call('GET', l.path, l.token);
      const read = await call('POST', l.read, l.token, { all: true });
      results_.push(list.status === 200 && JSON.stringify(list.body) === '{"items":[],"unread":0}' && read.status === 200 && read.body.ok === true);
    }
    db.failing.delete('notifications');
    check('while the database is down the classic routes answer an empty list and ok — the bell shows nothing rather than an error', results_.every(Boolean));
    db.missing.add('notifications');
    const gone = await call('GET', LEGACY[0].path, 'nt-admin');
    db.missing.delete('notifications');
    check('…and the same for a table that was never migrated', gone.status === 200 && JSON.stringify(gone.body) === '{"items":[],"unread":0}');
    check('…and nothing was changed on the way', db.tables.notifications.filter(n => !n.read).length === seed().filter(n => !n.read).length);
  }

  // ═══ 2. /api/v1/notifications ═══════════════════════════════════════════════════════════════
  const C = require('../packages/contracts');
  const { toNotification } = require('../src/modules/notifications');
  const V1 = '/api/v1/notifications', V1_READ = '/api/v1/notifications/read';
  const people = [['the admin', 'nt-admin', 'admin', LEGACY[0]], ['Ana', 'nt-ana', 'employee_51', LEGACY[1]], ['Bo', 'nt-bo', 'employee_52', { path: '/api/employee/notifications', read: '/api/employee/notifications/read' }]];

  reset();
  {
    const bad = [];
    for (const [who, token, member, legacy] of people) {
      const v1 = await call('GET', V1, token);
      const old = await call('GET', legacy.path, token);
      const parsed = C.schemas.NotificationList.safeParse(v1.body);
      if (v1.status !== 200 || !parsed.success) bad.push(`${who}: ${v1.status} ${parsed.success ? '' : 'not the contract'}`);
      else if (JSON.stringify(ids(v1.body)) !== JSON.stringify(ids(old.body)) || v1.body.unread !== old.body.unread) bad.push(`${who}: not the rows the classic route lists`);
      else if (JSON.stringify(v1.body).includes('member_key') || old.body.items.some(n => n.member_key !== member)) bad.push(`${who}: member_key`);
    }
    check('/api/v1 lists, for the admin and for each team member, the rows the classic route lists, in the contract\'s shape and without the owner', bad.length === 0, bad.join('; '));
    const ana = await call('GET', V1, 'nt-ana');
    check('…the newest fifty, newest first, and the unread among them', ana.body.items.length === 50 && ana.body.items[0].id === 159 && ana.body.items[49].id === 110 && ana.body.unread === 40);
    check('…asked of the database exactly as the classic route asks (one service)', queries('GET').filter(q => q.includes('member_key=eq.employee_51')).every(q => q === '?select=*&member_key=eq.employee_51&order=created_at.desc&limit=50'));
  }

  // rows the table allows that the contract does not: nothing null reaches the app
  reset();
  {
    db.tables.notifications.push({ id: 300, member_key: 'employee_52', type: null, title: 'Only a title', body: null, url: null, read: null, created_at: at(300) });
    const bo = await call('GET', V1, 'nt-bo');
    const odd = bo.body.items.find(n => n.id === 300);
    check('a row with empty columns is listed with empty words, "general" for its type and unread — never null', JSON.stringify(odd) === JSON.stringify({ id: 300, type: 'general', title: 'Only a title', body: '', url: '', read: false, created_at: at(300) }), JSON.stringify(odd));
    check('…and counts as unread', bo.body.unread === 2, String(bo.body.unread));
    check('toNotification, alone, keeps what is there and drops the owner', JSON.stringify(toNotification(row(5, 'admin', { body: 'Hi', read: true }))) === JSON.stringify({ id: 5, type: 'task', title: 'Title 5', body: 'Hi', url: '/dashboard#tasks', read: true, created_at: at(5) }));
    const bare = toNotification({ id: 9, member_key: 'admin', type: null, title: null, body: null, url: null, read: null, created_at: null });
    check('…and a row with nothing in it still fits the contract (no row can make the whole list fail)', C.schemas.Notification.safeParse(bare).success && bare.title === '' && bare.created_at === '', JSON.stringify(bare));
    reset();
  }

  // who may ask
  {
    const wrong = [];
    for (const [method, path, body] of [['GET', V1], ['POST', V1_READ, { all: true }]]) {
      for (const [label, token] of [['nobody', null], ['a token nobody issued', 'nt-nobody']]) {
        const got = await call(method, path, token, body);
        if (got.status !== 401) wrong.push(`${method} ${path} as ${label}: ${got.status}`);
      }
    }
    check('/api/v1 refuses nobody, and a token nobody issued', wrong.length === 0, wrong.join('; '));
    check('…and a refused request changes nothing', db.tables.notifications.filter(n => !n.read).length === seed().filter(n => !n.read).length);
  }

  // marking read
  reset();
  {
    const one = await call('POST', V1_READ, 'nt-admin', { id: 2 });
    check('/api/v1 marks one read — that member\'s, that row — and says ok in the contract\'s words', one.status === 200 && C.schemas.NotificationReadResult.safeParse(one.body).success && rowOf(2).read && !rowOf(3).read && queries('PATCH').join() === '?member_key=eq.admin&id=eq.2', queries('PATCH').join());
    reset();
    const mine = await call('POST', V1_READ, 'nt-ana', { id: 200 });
    check('…never another member\'s', mine.status === 200 && rowOf(200).read === true && rowOf(201).read === false);
    reset();
    const all = await call('POST', V1_READ, 'nt-ana', { all: true });
    check('…or all of a member\'s unread, and nobody else\'s', all.status === 200 && db.tables.notifications.filter(n => n.member_key === 'employee_51').every(n => n.read) && !rowOf(201).read && queries('PATCH').join() === '?member_key=eq.employee_51&read=eq.false', queries('PATCH').join());
    const after = await call('GET', LEGACY[1].path, 'nt-ana');
    check('…which the classic route then lists as read (it is the same table)', after.body.unread === 0);
    reset();
    db.log.length = 0;
    const live = await call('POST', V1_READ, 'nt-admin', { id: 'tmp-1700000000000' });
    check('a live-only notification has a string id; asking to mark it is not an error (nothing is stored under it)', live.status === 200 && live.body.ok === true && db.tables.notifications.every(n => n.read === seed().find(x => x.id === n.id).read));
    check('…and the database is not asked about it: its id is a number, so "tmp-…" would be an error from it, not an answer', queries('PATCH').length === 0, queries('PATCH').join());
    const odd = [];
    for (const id of ['', '-5', '1e3', '12abc', '99999999999999999999', 1e21, -5]) {
      db.log.length = 0;
      const r = await call('POST', V1_READ, 'nt-admin', { id });
      if (r.status === 200 && queries('PATCH').length) odd.push(`${JSON.stringify(id)} asked the database`);
      else if (r.status !== 200 && r.status !== 400) odd.push(`${JSON.stringify(id)}: ${r.status}`);
    }
    check('…nor is it asked about anything that cannot be an id (negative, with letters, too long for a bigint): either a 400 or nothing to do', odd.length === 0, odd.join('; '));
    db.log.length = 0;
    await call('POST', V1_READ, 'nt-admin', { id: '2' });
    check('…but a numeric id sent as text, as the classic pages send them, is one', queries('PATCH').join() === '?member_key=eq.admin&id=eq.2' && rowOf(2).read === true, queries('PATCH').join());
  }

  // what it will not accept
  reset();
  {
    const invalid = [
      ['no body', undefined], ['an empty object', {}], ['both', { id: 2, all: true }], ['all: false', { all: false }], ['all: "yes"', { all: 'yes' }],
      ['an empty id', { id: '' }], ['a fractional id', { id: 1.5 }], ['a null id', { id: null }], ['an id and a stray field', { id: 2, read: false }], ['an array', [{ id: 2 }]],
    ];
    const wrong = [];
    for (const [label, body] of invalid) {
      const r = await call('POST', V1_READ, 'nt-admin', body);
      const shape = C.schemas.ApiError.safeParse(r.body);
      if (r.status !== 400 || !shape.success || r.body.code !== 'invalid' || !(r.body.issues || []).length) wrong.push(`${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
    }
    check('/api/v1 is strict about what it is asked: anything but one id or all:true is a 400 that says what was wrong', wrong.length === 0, wrong.join('; '));
    const { issuesOf } = require('../src/http/errors');
    check('…and a problem deeper in a body is filed under a dotted path', JSON.stringify(issuesOf({ issues: [{ path: ['items', 2, 'id'], message: 'bad' }] })) === JSON.stringify([{ path: 'items.2.id', message: 'bad' }]));
    const emptyId = await call('POST', V1_READ, 'nt-admin', { id: '' });
    check('…and where: the problem with an id is filed under "id"', (emptyId.body.issues || [])[0]?.path === 'id', JSON.stringify(emptyId.body));
    const empty = await call('POST', V1_READ, 'nt-admin', {});
    check('…and says, in words, what it wants', /all: true/.test((empty.body.issues || [])[0]?.message || '') && /\{ id \}/.test((empty.body.issues || [])[0]?.message || ''), JSON.stringify(empty.body));
    const charset = await fetch(base + V1_READ, { method: 'POST', headers: { Authorization: 'Bearer nt-admin', 'Content-Type': 'application/json; charset=iso-8859-1' }, body: '{"all":true}' });
    check('…a charset it cannot read is Express\'s own 415, not mistaken for malformed JSON', charset.status === 415 && (await charset.text()).indexOf('"code":"invalid"') < 0, String(charset.status));
    const bare = await call('POST', V1_READ, 'nt-admin', 7);
    check('…a bare number, which is JSON but not a body, is the same 400 in the contract\'s shape', bare.status === 400 && bare.body.code === 'invalid' && C.schemas.ApiError.safeParse(bare.body).success, JSON.stringify(bare.body));
    const notJson = await fetch(base + V1_READ, { method: 'POST', headers: { Authorization: 'Bearer nt-admin', 'Content-Type': 'application/json' }, body: '{"id": ' });
    const notJsonBody = await notJson.json().catch(() => null);
    check('…a body that is not JSON is a 400 in the same shape, saying so, not a stack trace', notJson.status === 400 && notJsonBody && notJsonBody.code === 'invalid' && /JSON/.test(notJsonBody.error) && C.schemas.ApiError.safeParse(notJsonBody).success, JSON.stringify(notJsonBody));
    const huge = await fetch(base + V1_READ, { method: 'POST', headers: { Authorization: 'Bearer nt-admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x'.repeat(300000) }) });
    const hugeBody = await huge.json().catch(() => null);
    check('…and a body that is far too large is refused as such', huge.status === 413 && hugeBody && hugeBody.code === 'too_large', `${huge.status} ${JSON.stringify(hugeBody)}`);
    check('…and none of it changed anything', db.tables.notifications.filter(n => !n.read).length === seed().filter(n => !n.read).length);
  }

  // a database that is down: /api/v1 says so
  reset();
  {
    db.failing.add('notifications');
    const list = await call('GET', V1, 'nt-ana');
    const read = await call('POST', V1_READ, 'nt-ana', { all: true });
    db.failing.delete('notifications');
    const leaked = JSON.stringify([list.body, read.body]).includes('simulated');
    check('while the database is down /api/v1 says "unavailable" (a 503 in the contract\'s shape) — an empty list would look like no news', list.status === 503 && read.status === 503 && list.body.code === 'unavailable' && C.schemas.ApiError.safeParse(list.body).success && C.schemas.ApiError.safeParse(read.body).success);
    check('…without the database\'s own words', !leaked);
    db.missing.add('notifications');
    const gone = await call('GET', V1, 'nt-admin');
    db.missing.delete('notifications');
    check('…also for a table that was never migrated', gone.status === 503 && gone.body.code === 'unavailable');
    check('…and nothing was changed on the way', db.tables.notifications.filter(n => !n.read).length === seed().filter(n => !n.read).length);
  }

  // the routes with the service replaced: what is not the database's fault is ours, and says nothing about itself
  {
    const { mountNotifications, NotificationsUnavailable } = require('../src/modules/notifications');
    const run = async (service, which, req) => {
      const handlers = {}; const warn = console.warn; console.warn = () => {};
      mountNotifications({ v1: (spec, ...h) => { handlers[spec.method + ' ' + spec.path] = h[h.length - 1]; }, service, json: (_q, _s, n) => n() });
      const res = { code: 200, body: undefined, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      try { await handlers[which](req, res); } finally { console.warn = warn; }
      return res;
    };
    const boom = { list: async () => { throw new Error('connection string postgres://secret@host'); }, markRead: async () => { throw new Error('connection string postgres://secret@host'); } };
    const down = { list: async () => { throw new NotificationsUnavailable('relation "notifications" does not exist'); }, markRead: async () => { throw new NotificationsUnavailable('relation "notifications" does not exist'); } };
    const asAdmin = { actor: { key: 'admin' }, body: { all: true } };
    const a = await run(boom, 'get /api/v1/notifications', asAdmin), b = await run(boom, 'post /api/v1/notifications/read', asAdmin);
    check('an error nobody expected is a 500 "internal" in the contract\'s shape, for the list and for marking', a.code === 500 && b.code === 500 && a.body.code === 'internal' && b.body.code === 'internal' && C.schemas.ApiError.safeParse(a.body).success);
    check('…and says nothing of what went wrong', !JSON.stringify([a.body, b.body]).includes('secret'));
    const c = await run(down, 'get /api/v1/notifications', asAdmin), d = await run(down, 'post /api/v1/notifications/read', asAdmin);
    check('a service that says it is unavailable is a 503 "unavailable", without its reason', c.code === 503 && d.code === 503 && c.body.code === 'unavailable' && !JSON.stringify([c.body, d.body]).includes('relation'));
  }

  // the live stream carries rows the app can read with the same contract
  reset();
  {
    const ctl = new AbortController();
    const res = await fetch(base + '/api/employee/notifications/stream?hd=2', { headers: { Authorization: 'Bearer nt-ana' }, signal: ctl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    const pump = (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); } } catch (_) { /* closed */ } })();
    for (let i = 0; i < 40 && !ctx.notifSseClients.has('employee_51'); i++) await sleep(50);
    await ctx.createNotification('employee_51', { type: 'request', title: 'A request', body: 'Was approved', url: '/employee#requests' }, false);
    for (let i = 0; i < 40 && !/event: notification/.test(text); i++) await sleep(50);
    ctl.abort(); await pump;
    const frame = (text.match(/event: notification\ndata: (.*)\n/) || [])[1];
    const live = frame ? JSON.parse(frame) : null;
    const parsed = live && C.schemas.Notification.safeParse(live);
    check('a notification created for a member reaches their open stream as a row the contract reads', !!parsed && parsed.success && live.member_key === 'employee_51' && live.read === false && live.title === 'A request', frame);
    const after = await call('GET', V1, 'nt-ana');
    check('…and is the first thing /api/v1 then lists, with the id the stream gave it', after.body.items[0].id === live.id && after.body.items[0].title === 'A request');
  }

  // ═══ done ═════════════════════════════════════════════════════════════════════════════════════
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
