// The huddle's host controls, reactions and meeting thread, in a real browser: the
// shipped module lifted out of public/assets/huddle.js, run as three clients in one
// page against a stand-in for the server that keeps the same rules (tests/hdmeeting.js
// pins the server's own behaviour).
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer');

const SRC = fs.readFileSync('public/assets/huddle.js', 'utf8');
const CSSSRC = fs.readFileSync('public/assets/dashboard.css', 'utf8');
const start = SRC.indexOf('// Mesh topology: every participant holds one RTCPeerConnection');
const end = SRC.indexOf('\n}', SRC.indexOf('function statusEmojiOnly(emoji, text) {')) + 2;
if (start < 0 || end < 2) throw new Error('could not slice the huddle module');
const MODULE = SRC.slice(start, end);
for (const fn of ['hdRemovePeer', 'huddleReact', 'hdThreadOpen', 'hdThreadHistory', 'chatRoomFaceHtml']) {
  if (!new RegExp('function ' + fn + '\\(').test(MODULE)) throw new Error('module slice is missing ' + fn);
}
// The real stylesheet: where a reaction floats from and what is hidden when depends on it.
const cssFrom = CSSSRC.indexOf('/* ── Huddles, group panel & status chips ── */');
const mqAt = CSSSRC.indexOf('@media (max-width:640px) {', cssFrom);
let depth = 0, cssEnd = mqAt;
for (; cssEnd < CSSSRC.length; cssEnd++) {
  if (CSSSRC[cssEnd] === '{') depth++;
  else if (CSSSRC[cssEnd] === '}') { depth--; if (!depth) { cssEnd++; break; } }
}
const CSS = CSSSRC.slice(cssFrom, cssEnd);
if (!/\.hd-react-layer/.test(CSS) || !/#hd-thread/.test(CSS)) throw new Error('css slice is missing the new rules');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--bg:#0c0c0e;--surface:#141416;--border:rgba(255,255,255,.09);--text:#f3efe7;--muted:#8d897f;--primary:#c9a35e;--danger:#c97d6e}
body{margin:0;background:var(--bg);color:var(--text);font-family:sans-serif}
${CSS}
</style></head><body>
<div id="hd-bar"></div><div id="hd-toast"></div><div id="hd-join-chip"></div>
<div id="hd-incoming"></div><div id="hd-sheet"></div>
<script>
function esc(s){ if(s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
window.confirm = () => true;
function makeClient(HDCFG) {
${MODULE}
  return { huddleStart, huddleJoinExisting, huddleLeave, huddleInvite, huddleOnSignal, hdRenderBar, hdAlive,
           hdRemovePeer, huddleReact, hdReactToggle, hdShowReaction, hdThreadOpen, hdThreadOpenSession,
           hdThreadHistory, hdThreadClose, chatGroupPanel, chatRoomFaceHtml, hdIsHost, hdWidgetAct,
           state: () => _hd, peers: () => _hd.peers, thread: () => _hdThread };
}
const NAMES = { A: 'Ann', B: 'Bob', C: 'Cid' };
const ROOM = { id: 1, type: 'group', name: 'Test', created_by: 'A', avatar_url: '', icon: '',
  members: Object.keys(NAMES).map(k => ({ member_key: k, member_name: NAMES[k] })) };

// The server, as far as these features go: a roster in join order whose host is
// whoever started it while they are in it, else whoever has been in longest; a list
// of the removed that the host's 'remove' fills and the host's 'invite' empties;
// reactions passed to the rest of the call; and one thread.
const bus = { order: [], sids: {}, owner: null, banned: new Set(), inbox: {}, signals: [], boot: 'b1',
              thread: [], nextMsg: 1, threadFails: false, mute: new Set(['C']) };
const SESSION = () => ({ id: 7, room_id: 1, title: 'Test', live: bus.order.length > 0,
  started_at: new Date(Date.now() - 60000).toISOString(), ended_at: null, host_key: bus.owner,
  participants: Object.keys(NAMES).map(k => ({ key: k, name: NAMES[k] })), message_count: bus.thread.length });
const host = () => bus.order.includes(bus.owner) ? bus.owner : (bus.order[0] || null);
const roster = () => bus.order.map(k => ({ key: k, name: NAMES[k], sid: bus.sids[k], ...(k === host() ? { host: true } : {}) }));
// Each real client has a page of its own; here they share one, so a client that is
// not part of a scenario is kept off the bus (mute) rather than drawing into it.
const send = (to, frame) => setTimeout(() => !bus.mute.has(to) && bus.inbox[to] && bus.inbox[to](frame), 0);
const toAll = frame => Object.keys(NAMES).forEach(k => send(k, frame));
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

function makeFetch(key) {
  return async (url, opts) => {
    const path = url.replace('/api/x/chat', '');
    const method = (opts && opts.method) || 'GET';
    if (path === '/huddle/ice') return reply(200, { iceServers: [], hasTurn: false, ttl: 7200 });
    if (path === '/huddle/live' || path === '/people' || path === '/rooms/1/attachments') return reply(200, []);
    if (path === '/huddle/1') {
      if (bus.banned.has(key)) return reply(403, { error: 'The host removed you from this huddle.', removed: true });
      return reply(200, { boot: bus.boot, participants: roster() });
    }
    if (path === '/huddle/1/thread') {
      if (bus.threadFails) return reply(503, { error: 'Meeting threads need migrations/024_huddles_and_group_pictures.sql applied first.', migration: '024' });
      return reply(200, { session: SESSION(), messages: bus.thread.slice() });
    }
    if (path.startsWith('/huddle/threads?')) {
      window.__historyQuery = path;
      return reply(200, [SESSION(), { ...SESSION(), id: 6, live: false, message_count: 3,
        started_at: new Date(Date.now() - 86400000).toISOString(), ended_at: new Date(Date.now() - 86400000 + 25 * 60000).toISOString() }]);
    }
    if (path === '/huddle/threads/6') return reply(200, { session: { ...SESSION(), id: 6, live: false, ended_at: new Date().toISOString() },
      messages: [{ id: 60, session_id: 6, sender_key: 'C', sender_name: 'Cid', body: 'From yesterday', created_at: new Date(Date.now() - 86000000).toISOString() }] });
    if (path === '/huddle/threads/7') return reply(200, { session: SESSION(), messages: bus.thread.slice() });
    if (path === '/huddle/threads/7/messages' && method === 'POST') {
      const m = { id: bus.nextMsg++, session_id: 7, room_id: 1, sender_key: key, sender_name: NAMES[key],
                  body: JSON.parse(opts.body).body, created_at: new Date().toISOString() };
      bus.thread.push(m);
      toAll({ type: 'thread', roomId: 1, sessionId: 7, message: m });   // the sender's own tabs hear it too
      return reply(200, m);
    }
    if (path !== '/huddle/signal') return reply(404, { error: 'no route ' + path });
    const body = JSON.parse(opts.body);
    bus.signals.push({ from: key, ...body });
    if (bus.banned.has(key) && body.type !== 'leave') return reply(403, { error: 'The host removed you from this huddle.', removed: true });
    const rid = body.roomId;
    if (body.type === 'join') {
      if (!bus.order.length) bus.owner = key;
      if (!bus.order.includes(key)) bus.order.push(key);
      bus.sids[key] = body.data && body.data.sid;
      toAll({ type: 'roster', roomId: rid, boot: bus.boot, participants: roster(), joined: key });
      return reply(200, { ok: true, boot: bus.boot, participants: roster() });
    }
    if (body.type === 'leave') {
      bus.order = bus.order.filter(k => k !== key);
      if (!bus.order.length) { bus.owner = null; bus.banned.clear(); }
      toAll({ type: 'roster', roomId: rid, boot: bus.boot, participants: roster(), left: key });
      return reply(200, { ok: true });
    }
    if (body.type === 'alive') return reply(200, { ok: true, inCall: bus.order.includes(key), boot: bus.boot, sid: bus.sids[key] || null });
    if (body.type === 'remove') {
      if (host() !== key) return reply(403, { error: 'Only the host can remove someone from the huddle.' });
      bus.banned.add(body.to);
      bus.order = bus.order.filter(k => k !== body.to);
      send(body.to, { type: 'removed', roomId: rid, from: key, fromName: NAMES[key] });
      toAll({ type: 'roster', roomId: rid, boot: bus.boot, participants: roster(), left: body.to, removed: true });
      return reply(200, { ok: true });
    }
    if (body.type === 'reaction') {
      bus.order.filter(k => k !== key).forEach(k => send(k, { type: 'reaction', roomId: rid, from: key, fromName: NAMES[key], emoji: body.data.emoji }));
      return reply(200, { ok: true });
    }
    if (body.type === 'invite' && bus.banned.has(body.to)) {
      if (host() !== key) return reply(403, { error: 'The host removed them from this huddle.' });
      bus.banned.delete(body.to);
    }
    if (bus.banned.has(body.to)) return reply(400, { error: 'target not in this huddle' });
    send(body.to, { type: body.type, roomId: rid, from: key, fromName: NAMES[key], data: body.data });
    return reply(200, { ok: true });
  };
}
function cfg(key) {
  return { base: '/api/x/chat', me: () => key, fetch: makeFetch(key), token: () => 'tok-' + key,
           rooms: () => [ROOM], activeRoom: () => 1, openRoom: () => {}, refreshRooms: async () => {} };
}
for (const k of Object.keys(NAMES)) { window[k] = makeClient(cfg(k)); bus.inbox[k] = m => window[k].huddleOnSignal(m); }
window.__bus = bus;
<\/script></body></html>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: require('./helpers/browser').chromePath(), headless: 'new',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  // getUserMedia needs a secure context; http://127.0.0.1 is one.
  const server = http.createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'domcontentloaded' });

  const results = [];
  const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + name + (extra ? '  ' + extra : '')); };
  const toast = () => page.evaluate(() => document.getElementById('hd-toast').textContent);
  const connected = (a, b) => page.waitForFunction((a, b) => {
    const p = window[a].peers().get(b);
    return p && p.pc.connectionState === 'connected';
  }, { timeout: 20000 }, a, b).then(() => true).catch(() => false);

  // ── 1. The host's controls ──────────────────────────────────────────────────
  await page.evaluate(() => window.A.huddleStart(1, false));
  await page.evaluate(() => window.B.huddleJoinExisting(1));
  check('two people in a call', await connected('A', 'B') && await connected('B', 'A'));
  await sleep(300);
  // Every client draws into the one #hd-bar of this page, so each look renders first.
  const tilesAs = who => page.evaluate(who => {
    window[who].hdRenderBar();
    const out = {};
    for (const t of document.querySelectorAll('#hd-bar [data-tile]')) {
      out[t.getAttribute('data-tile')] = { label: t.querySelector('.hd-tile-name').textContent, kick: t.querySelector('.hd-kick').style.display };
    }
    return { host: window[who].state().host, isHost: window[who].hdIsHost(), tiles: out };
  }, who);
  let ui = await tilesAs('A');
  check('whoever started the call knows they are its host, and their tile says so',
    ui.host === 'A' && ui.isHost && /^You · host/.test(ui.tiles.__self.label), JSON.stringify(ui));
  check('the host has a remove button on everyone else\'s tile', ui.tiles.B && ui.tiles.B.kick === 'flex', JSON.stringify(ui));
  check('…never on their own', ui.tiles.__self.kick === 'none', JSON.stringify(ui));
  ui = await tilesAs('B');
  check('someone else sees who the host is', !ui.isHost && /^Ann · host/.test(ui.tiles.A.label), JSON.stringify(ui));
  check('…and has no remove button', ui.tiles.A.kick === 'none', JSON.stringify(ui));

  // ── 2. Removing someone ─────────────────────────────────────────────────────
  await page.evaluate(() => { window.A.hdRenderBar(); document.querySelector('#hd-bar [data-tile="B"] .hd-kick').click(); });
  await sleep(400);
  let st = await page.evaluate(() => ({
    bobIn: window.B.state().roomId, annHasBob: window.A.peers().has('B'),
    sent: window.__bus.signals.filter(s => s.type === 'remove').map(s => s.from + '>' + s.to),
    bobLeft: window.__bus.signals.filter(s => s.from === 'B' && s.type === 'leave').length,
  }));
  check('the button asks the server to remove them', st.sent.join() === 'A>B', JSON.stringify(st));
  check('…their page hangs up', st.bobIn === null, JSON.stringify(st));
  check('…without sending a leave of its own — the server already has them out', st.bobLeft === 0, JSON.stringify(st));
  check('…and the host\'s connection to them goes at once', st.annHasBob === false, JSON.stringify(st));
  check('they are told who removed them', /Ann removed you from the huddle/.test(await toast()), await toast());
  // The roster the others get reaches Bob's page too, now as someone outside the call.
  await page.evaluate(() => window.B.huddleOnSignal({ type: 'roster', roomId: 1, boot: 'b1', started_at: Date.now(),
    participants: [{ key: 'A', name: 'Ann', sid: 'x', host: true }] }));
  check('the call they were removed from is not offered back to them',
    await page.evaluate(() => document.getElementById('hd-join-chip').style.display) !== 'flex');
  await page.evaluate(() => window.B.huddleJoinExisting(1));
  await sleep(250);
  check('joining anyway is refused, and says why', await page.evaluate(() => window.B.state().roomId) === null
    && /host removed you/i.test(await toast()), await toast());
  check('the refused attempt took no microphone with it', await page.evaluate(() => !window.B.state().local));

  // The host asks him back: the ring arrives, the offer to rejoin returns, he joins.
  await page.evaluate(() => { document.getElementById('hd-incoming').style.display = 'none'; window.A.huddleInvite('B'); });
  await sleep(250);
  check('the host\'s invite rings them again', await page.evaluate(() => document.getElementById('hd-incoming').style.display) === 'block');
  await page.evaluate(() => window.B.huddleOnSignal({ type: 'roster', roomId: 1, boot: 'b1', started_at: Date.now(),
    participants: [{ key: 'A', name: 'Ann', sid: 'x', host: true }] }));
  check('…and the call is offered to them again', await page.evaluate(() => document.getElementById('hd-join-chip').style.display) === 'flex');
  await page.evaluate(() => window.B.huddleJoinExisting(1));
  check('…and they are back in', await connected('A', 'B'));

  // ── 3. The role passes on, and comes back ───────────────────────────────────
  await page.evaluate(() => window.A.huddleLeave());
  await sleep(250);
  check('when the host leaves, the next in line is told they are the host now',
    await page.evaluate(() => window.B.hdIsHost()) && /You are the host now/.test(await toast()), await toast());
  await page.evaluate(() => window.A.huddleJoinExisting(1));
  await sleep(300);
  check('…and when whoever started it comes back, it is theirs again', await page.evaluate(() => window.B.state().host) === 'A'
    && await page.evaluate(() => window.A.hdIsHost()));
  await connected('A', 'B');

  // A removal whose frame never arrived: the next ping finds out, and says so.
  await page.evaluate(() => { const b = window.__bus; b.banned.add('B'); b.order = b.order.filter(k => k !== 'B'); });
  await page.evaluate(() => window.B.hdAlive());
  await sleep(150);
  check('a removal missed in a stream gap is found by the next ping, which says what happened',
    await page.evaluate(() => window.B.state().roomId) === null && /The host removed you from this huddle/.test(await toast()), await toast());
  await page.evaluate(() => window.A.huddleInvite('B'));
  await sleep(150);
  await page.evaluate(() => window.B.huddleJoinExisting(1));
  check('(back in for what follows)', await connected('A', 'B'));
  await sleep(200);

  // ── 4. Reactions ────────────────────────────────────────────────────────────
  // The widget's own listeners belong to whichever client built it; build it as Ann's.
  await page.evaluate(() => { document.getElementById('hd-bar').innerHTML = ''; window.A.hdRenderBar(); window.A.hdReactToggle(); });
  st = await page.evaluate(() => ({
    pop: document.querySelector('#hd-bar .hd-react-pop').style.display,
    picks: [...document.querySelectorAll('#hd-bar .hd-react-pick')].map(b => b.dataset.emoji).join(''),
    on: document.querySelector('#hd-bar .hd-react-btn').classList.contains('on'),
  }));
  check('the reaction button opens a picker of the reactions on offer', st.pop === 'flex' && st.on && st.picks === '👍👏❤️😂🎉😮🙌✋', JSON.stringify(st));
  await page.evaluate(() => document.querySelector('#hd-bar .hd-react-pick[data-emoji="🎉"]').click());
  await sleep(120);
  st = await page.evaluate(() => {
    const bar = document.getElementById('hd-bar').getBoundingClientRect();
    const self = document.querySelector('#hd-bar [data-tile="__self"]').getBoundingClientRect();
    const r = [...document.querySelectorAll('#hd-bar .hd-react')].map(el => ({
      emo: el.querySelector('.hd-react-emo').textContent, who: el.querySelector('.hd-react-who').textContent,
      x: parseFloat(el.style.left), anim: getComputedStyle(el).animationName }));
    return { r, selfLeft: self.left - bar.left, selfRight: self.right - bar.left,
             sent: window.__bus.signals.filter(s => s.type === 'reaction').map(s => s.from + ':' + s.data.emoji) };
  });
  const mineR = st.r.find(x => x.who === 'You');
  check('picking one shows it on your own screen at once, over your tile', mineR && mineR.emo === '🎉' && mineR.x >= st.selfLeft - 20 && mineR.x <= st.selfRight + 20,
    JSON.stringify(st));
  check('…floating up', mineR && mineR.anim === 'hd-react-rise', JSON.stringify(mineR));
  check('…and sends it once', st.sent.join() === 'A:🎉', JSON.stringify(st.sent));
  check('everyone else in the call sees it too, with the sender\'s name', st.r.some(x => x.who === 'Ann' && x.emo === '🎉'), JSON.stringify(st.r));
  await sleep(3500);
  check('…and then it is gone', await page.evaluate(() => document.querySelectorAll('#hd-bar .hd-react').length) === 0);
  st = await page.evaluate(() => {
    window.B.hdShowReaction('A', '<img src=x onerror=alert(1)>', 'Ann');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.B.hdShowReaction('A', '👍', 'Ann');
    delete document.hidden;
    return document.querySelectorAll('#hd-bar .hd-react').length;
  });
  check('anything but a reaction on offer is ignored, and a hidden tab piles none up', st === 0, String(st));
  await sleep(1600);   // past the five seconds the first reaction counts against
  st = await page.evaluate(async () => {
    window.__bus.signals.length = 0;
    for (let i = 0; i < 9; i++) window.A.huddleReact('👏');
    await new Promise(r => setTimeout(r, 100));
    return window.__bus.signals.filter(s => s.type === 'reaction').length;
  });
  check('a burst is held to eight, and the ninth is told to wait', st === 8 && /Give it a moment/.test(await toast()), String(st));
  await page.evaluate(() => { window.A.hdRenderBar(); window.A.hdWidgetAct('min'); window.A.hdShowReaction('B', '❤️', 'Bob'); });
  st = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#hd-bar .hd-react')].find(e => e.querySelector('.hd-react-who').textContent === 'Bob');
    return { shown: !!el, top: el ? parseFloat(el.style.top) : null, pop: getComputedStyle(document.querySelector('#hd-bar .hd-react-pop')).display };
  });
  check('a minimised call still shows reactions, rising from its head', st.shown && st.top <= 20, JSON.stringify(st));
  check('…with the picker out of the way', st.pop === 'none', JSON.stringify(st));
  await page.evaluate(() => window.A.hdWidgetAct('min'));

  // ── 5. The meeting thread ───────────────────────────────────────────────────
  await page.evaluate(() => window.A.hdThreadOpen());
  await sleep(200);
  st = await page.evaluate(() => {
    const el = document.getElementById('hd-thread');
    return { shown: el && getComputedStyle(el).display === 'flex', title: el.querySelector('.hd-th-title').textContent,
             sub: el.querySelector('.hd-th-sub').textContent, who: el.querySelector('.hd-th-who').textContent,
             empty: el.querySelector('.hd-th-empty') && el.querySelector('.hd-th-empty').textContent,
             disabled: el.querySelector('.hd-th-input').disabled, ph: el.querySelector('.hd-th-input').placeholder };
  });
  check('the thread opens from the call, live', st.shown && st.title === 'Huddle · Test' && /^Live — you are in the call/.test(st.sub), JSON.stringify(st));
  check('…saying who it is with and that what is written stays', /With you, Bob, Cid/.test(st.who) && /stay with this huddle after it ends/.test(st.empty), JSON.stringify(st));
  check('…ready to write in', !st.disabled && /everyone in the huddle/.test(st.ph), JSON.stringify(st));
  await page.evaluate(() => {
    const input = document.querySelector('#hd-thread .hd-th-input');
    input.value = 'Agenda: pricing';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(200);
  await page.evaluate(() => {
    const input = document.querySelector('#hd-thread .hd-th-input');
    input.value = '<b>and</b> margins';
    document.querySelector('#hd-thread .hd-th-send').click();
  });
  await sleep(250);
  st = await page.evaluate(() => ({
    msgs: [...document.querySelectorAll('#hd-thread .hd-th-msg')].map(m => ({ name: (m.querySelector('.hd-th-name') || {}).textContent || '', body: m.querySelector('.hd-th-body').textContent, grouped: m.classList.contains('grouped') })),
    bold: !!document.querySelector('#hd-thread .hd-th-body b'),
    input: document.querySelector('#hd-thread .hd-th-input').value,
    stored: window.__bus.thread.map(m => m.body),
  }));
  check('Enter sends, and it shows once — the echo from the server is not a second copy',
    st.msgs.length === 2 && st.msgs[0].name === 'You' && st.msgs[0].body === 'Agenda: pricing' && st.stored.length === 2, JSON.stringify(st));
  check('…a run of one person\'s messages carries one name', st.msgs[1].grouped === true, JSON.stringify(st.msgs));
  check('…and what is written is text, never markup', !st.bold && st.msgs[1].body === '<b>and</b> margins', JSON.stringify(st));
  check('…and the box is cleared', st.input === '', JSON.stringify(st));
  st = await page.evaluate(() => {
    window.B.hdRenderBar();
    return { unread: window.B.state().threadUnread, badge: document.querySelector('#hd-bar .hd-badge').textContent,
             badgeShown: document.querySelector('#hd-bar .hd-badge').style.display !== 'none',
             head: document.querySelector('#hd-bar .hd-head-thread').textContent };
  });
  check('someone in the call with the thread closed is shown how much is new', st.unread === 2 && st.badge === '2' && st.badgeShown && /💬 2/.test(st.head), JSON.stringify(st));
  // The panel's listeners belong to whoever made it: give Bob his own.
  await page.evaluate(() => { document.getElementById('hd-thread').remove(); return window.B.hdThreadOpen(); });
  await sleep(200);
  st = await page.evaluate(() => ({
    unread: window.B.state().threadUnread,
    names: [...document.querySelectorAll('#hd-thread .hd-th-name')].map(n => n.textContent),
    msgs: document.querySelectorAll('#hd-thread .hd-th-msg').length,
  }));
  check('opening it clears the count and shows what was written, by whom', st.unread === 0 && st.msgs === 2 && st.names.join() === 'Ann', JSON.stringify(st));
  await page.evaluate(() => window.C.huddleOnSignal({ type: 'thread', roomId: 1, sessionId: 7,
    message: { id: 99, session_id: 7, sender_key: 'C', sender_name: 'Cid', body: 'late note', created_at: new Date().toISOString() } }));
  check('a message for a call you are not in, with no thread open, changes nothing', await page.evaluate(() => window.C.state().threadUnread) === 0);

  // Leaving keeps the thread open — it is kept after the call.
  await page.evaluate(() => window.B.huddleLeave());
  await sleep(200);
  st = await page.evaluate(() => {
    const el = document.getElementById('hd-thread');
    return { shown: getComputedStyle(el).display, sub: el.querySelector('.hd-th-sub').textContent, ph: el.querySelector('.hd-th-input').placeholder };
  });
  check('leaving the call leaves its thread open, to go on writing in', st.shown === 'flex' && !/you are in the call/.test(st.sub) && /Add to this huddle/.test(st.ph), JSON.stringify(st));
  await page.evaluate(() => window.A.huddleLeave());
  await sleep(200);
  st = await page.evaluate(() => document.querySelector('#hd-thread .hd-th-sub').textContent);
  check('…and when the huddle ends it says so', !/^Live/.test(st), st);

  // The history.
  await page.evaluate(() => window.B.hdThreadHistory());
  await sleep(200);
  st = await page.evaluate(() => ({
    title: document.querySelector('#hd-sheet .hd-sheet-title').textContent,
    rows: [...document.querySelectorAll('#hd-sheet .hd-hist-row')].map(r => ({ t: r.querySelector('.hd-hist-title').textContent.trim(), sub: r.querySelector('.hd-hist-sub').textContent, n: r.querySelector('.hd-hist-n').textContent })),
    q: window.__historyQuery,
  }));
  check('the history lists past huddles with when, how long, who and how much was written',
    st.title === 'Huddle threads' && st.rows.length === 2 && /25 min/.test(st.rows[1].sub) && /Ann, you, Cid|you/.test(st.rows[1].sub) && st.rows[1].n === '💬 3', JSON.stringify(st));
  // The rows call the global the portals define; here it is Bob's.
  await page.evaluate(() => { window.hdThreadOpenSession = id => window.B.hdThreadOpenSession(id); document.querySelectorAll('#hd-sheet .hd-hist-row')[1].click(); });
  await sleep(250);
  st = await page.evaluate(() => ({
    sheet: document.getElementById('hd-sheet').style.display,
    body: [...document.querySelectorAll('#hd-thread .hd-th-body')].map(b => b.textContent),
    sub: document.querySelector('#hd-thread .hd-th-sub').textContent,
  }));
  check('…and opens any of them', st.sheet === 'none' && st.body.join() === 'From yesterday' && !/Live/.test(st.sub), JSON.stringify(st));
  await page.evaluate(() => document.querySelector('#hd-thread .hd-th-x').click());
  check('closing it closes it', await page.evaluate(() => getComputedStyle(document.getElementById('hd-thread')).display === 'none' && window.B.thread() === null));

  // A server without the migration says so, and nothing can be typed into nothing.
  await page.evaluate(() => { window.__bus.threadFails = true; return window.C.huddleStart(1, false); });
  await page.evaluate(() => window.C.hdThreadOpen());
  await sleep(200);
  st = await page.evaluate(() => ({ text: document.querySelector('#hd-thread .hd-th-list').textContent, disabled: document.querySelector('#hd-thread .hd-th-input').disabled }));
  check('without the migration the thread says which one is needed', /024_huddles_and_group_pictures/.test(st.text) && st.disabled, JSON.stringify(st));
  await page.evaluate(() => { window.C.hdThreadClose(); window.C.huddleLeave(); window.__bus.threadFails = false; });

  // ── 6. The conversation's panel: its picture and its huddles ─────────────────
  await page.evaluate(() => window.A.chatGroupPanel(1));
  await sleep(250);
  st = await page.evaluate(() => ({
    pic: !!document.querySelector('#hd-sheet .cg-pic'),
    btn: (document.querySelector('#hd-sheet .cg-pic-acts button') || {}).textContent,
    huddles: document.querySelectorAll('#hd-sheet #cg-huddles .hd-hist-row').length,
    more: !!document.querySelector('#hd-sheet #cg-huddles .hd-link'),
    q: window.__historyQuery,
  }));
  check('a manager sees the group\'s picture and can add one', st.pic && /Add a picture/.test(st.btn), JSON.stringify(st));
  check('the panel lists the conversation\'s huddles, and leads to all of them', st.huddles === 2 && st.more && /room=1/.test(st.q) && /limit=5/.test(st.q), JSON.stringify(st));
  st = await page.evaluate(() => {
    const f = window.A.chatRoomFaceHtml;
    return {
      pic: f({ type: 'group', avatar_url: 'https://x/p.png', icon: '🚚' }, null, 'TG'),
      icon: f({ type: 'group', avatar_url: '', icon: '🚚' }, null, 'TG'),
      ini: f({ type: 'group', avatar_url: '', icon: '' }, null, 'TG'),
      dm: f({ type: 'direct' }, { member_avatar: 'https://x/face.png' }, 'SA'),
      dmIni: f({ type: 'direct' }, {}, 'SA'),
      evil: f({ type: 'group', avatar_url: '"><script>x</script>' }, null, ''),
    };
  });
  check('a group shows its picture, before its icon, before its initials',
    st.pic === '<img src="https://x/p.png" alt="">' && st.icon === '🚚' && st.ini === 'TG', JSON.stringify(st));
  check('a direct conversation shows the other person\'s photo, else their initials', st.dm === '<img src="https://x/face.png" alt="">' && st.dmIni === 'SA', JSON.stringify(st));
  check('a picture address cannot break out of its attribute', !/<script>/.test(st.evil), st.evil);

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  server.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
