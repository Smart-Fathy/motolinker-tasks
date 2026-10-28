// Huddle hosts, reactions and meeting threads; group pictures; the workspace's name
// and picture — against the real server and an in-memory database.
//
// What has to hold:
//   • only the host can take someone out of a call, and whoever is taken out stays
//     out — no rejoining, no pinging back in, no offers reaching anyone — until the
//     host asks them back or the huddle ends;
//   • a reaction reaches everyone in the call but the sender, nobody outside it, and
//     is never replayed to a stream that reconnects later;
//   • every huddle is a session whose thread outlives it: readable and writable by the
//     conversation and by whoever was in the call (a guest included), by nobody else;
//     a restart carries the session on, and a session a crash left open is closed;
//   • a group's picture is an upload only its managers can make, stored by us;
//   • the workspace's name and picture are the admin's to change, everyone's to read,
//     and every open page is told.
const http = require('http');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = ms => new Date(ms).toISOString();

const db = createFakeSupabase({
  employees: [2, 3, 4, 5, 6].map(id => ({ id, name: ['', '', 'Sara', 'Omar', 'Lina', 'Nour', 'Karim'][id], username: 'u' + id, email: '', password_hash: 'x', permissions: null, job_title: '' })),
  sessions: [], push_subscriptions: [], notifications: [], quotation_settings: [], google_tokens: [], presence: [],
  chat_rooms: [
    { id: 1, type: 'group', name: 'Ops', created_by: 'admin', icon: '', avatar_url: '' },
    { id: 2, type: 'group', name: 'Sara Squad', created_by: 'employee_2', icon: '', avatar_url: '' },
    { id: 3, type: 'direct', name: '', created_by: 'admin', icon: '', avatar_url: '' },
    { id: 4, type: 'group', name: 'Yard', created_by: 'admin', icon: '', avatar_url: '' },
  ],
  chat_room_members: [
    ['admin', 'Admin'], ['employee_2', 'Sara'], ['employee_3', 'Omar'],
  ].map(([k, n]) => ({ room_id: 1, member_key: k, member_name: n }))
    .concat([{ room_id: 2, member_key: 'employee_2', member_name: 'Sara' }, { room_id: 2, member_key: 'employee_3', member_name: 'Omar' }])
    .concat([{ room_id: 3, member_key: 'admin', member_name: 'Admin' }, { room_id: 3, member_key: 'employee_2', member_name: 'Sara' }])
    .concat([{ room_id: 4, member_key: 'admin', member_name: 'Admin' }, { room_id: 4, member_key: 'employee_2', member_name: 'Sara' }]),
  chat_messages: [],
  huddle_sessions: [], huddle_participants: [], huddle_messages: [],
});
db.install();

// A real notification stream over HTTP, parsed into frames as a browser would.
function openStream(base, path) {
  const st = { frames: [], raw: '' };
  return new Promise(resolve => {
    st.req = http.get(base + path, res => {
      res.on('data', d => {
        st.raw += d.toString();
        let i;
        while ((i = st.raw.indexOf('\n\n')) >= 0) {
          const block = st.raw.slice(0, i); st.raw = st.raw.slice(i + 2);
          const f = {};
          for (const line of block.split('\n')) { const m = /^(\w+): ?(.*)$/.exec(line); if (m) f[m[1]] = m[2]; }
          if (f.event) { try { f.json = JSON.parse(f.data); } catch (_) {} st.frames.push(f); }
        }
        if (!st.ready) { st.ready = true; resolve(st); }
      });
    });
    st.close = () => { try { st.req.destroy(); } catch (_) {} };
  });
}
const sig = (st, type) => st.frames.filter(f => f.event === 'huddle-signal' && f.json && (!type || f.json.type === type));

(async () => {
  const base = await bootApp({ port: process.env.PORT || 3979 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const T = db.tables;

  const ADMIN = 'hdm-admin';
  ctx.sessions.set(ADMIN, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const tok = {};
  for (const [id, name] of [[2, 'Sara'], [3, 'Omar'], [4, 'Lina'], [5, 'Nour']]) {
    tok[id] = 'hdm-emp-' + id;
    ctx.employeeSessions.set(tok[id], { id, name, username: 'u' + id, job_title: '', permissions: normEmpPerms({ chat: true }), createdAt: Date.now() });
  }
  const A = 'admin', S = 'employee_2', O = 'employee_3', L = 'employee_4', N = 'employee_5';
  const who = { [A]: ADMIN, [S]: tok[2], [O]: tok[3], [L]: tok[4], [N]: tok[5] };
  const api = (key, path, opts = {}) => fetch(base + (key === A ? '/api/dashboard' : '/api/employee') + path, {
    ...opts, headers: { Authorization: 'Bearer ' + who[key], ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
  const json = async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) });
  const signal = async (key, body) => json(await api(key, '/chat/huddle/signal', { method: 'POST', body: JSON.stringify(body) }));
  const roster = async () => (await json(await api(A, '/chat/huddle/1'))).participants || [];

  const stream = {};
  for (const k of [A, S, O, L, N]) {
    stream[k] = await openStream(base, (k === A ? '/api/dashboard' : '/api/employee') + '/notifications/stream?hd=2&_t=' + who[k]);
  }
  const clear = () => Object.values(stream).forEach(s => { s.frames.length = 0; });

  // ── The host ───────────────────────────────────────────────────────────────
  const j1 = await signal(A, { roomId: 1, type: 'join', data: { sid: 'a1' } });
  c('whoever starts a huddle is its host', (j1.participants || []).some(p => p.key === A && p.host === true), JSON.stringify(j1.participants));
  await signal(S, { roomId: 1, type: 'join', data: { sid: 's1' } });
  await signal(O, { roomId: 1, type: 'join', data: { sid: 'o1' } });
  await sleep(100);
  const lastRoster = sig(stream[S], 'roster').slice(-1)[0];
  c('every roster says who the host is, and only one', lastRoster && lastRoster.json.participants.filter(p => p.host).map(p => p.key).join() === A,
    JSON.stringify(lastRoster && lastRoster.json.participants));

  let r = await signal(S, { roomId: 1, type: 'remove', to: O });
  c('someone who is not the host cannot remove anyone', r.status === 403 && /host/i.test(r.error), JSON.stringify(r));
  r = await signal(A, { roomId: 1, type: 'remove', to: A });
  c('the host cannot remove themselves', r.status === 400, JSON.stringify(r));
  r = await signal(A, { roomId: 1, type: 'remove', to: L });
  c('nor someone who is not in the call', r.status === 404, JSON.stringify(r));

  clear();
  r = await signal(A, { roomId: 1, type: 'remove', to: O });
  await sleep(120);
  c('the host removes someone', r.status === 200 && r.ok === true, JSON.stringify(r));
  const removedFrame = sig(stream[O], 'removed')[0];
  c('…who is told, and by whom', removedFrame && removedFrame.json.roomId === 1 && removedFrame.json.from === A && removedFrame.json.fromName === 'Admin',
    JSON.stringify(sig(stream[O]).map(f => f.json.type)));
  const dropRoster = sig(stream[S], 'roster').slice(-1)[0];
  c('…and everyone else\'s roster drops them at once, marked as removed',
    dropRoster && dropRoster.json.left === O && dropRoster.json.removed === true && !dropRoster.json.participants.some(p => p.key === O),
    JSON.stringify(dropRoster && dropRoster.json));
  r = await signal(O, { roomId: 1, type: 'join', data: { sid: 'o2' } });
  c('a removed person cannot rejoin, and is told why', r.status === 403 && r.removed === true && /host removed you/i.test(r.error), JSON.stringify(r));
  r = await signal(O, { roomId: 1, type: 'alive' });
  c('…nor ping their way back in', r.status === 403 && r.removed === true, JSON.stringify(r));
  clear();
  r = await signal(O, { roomId: 1, type: 'offer', to: S, data: { type: 'offer', sdp: 'v=0' } });
  await sleep(80);
  c('…nor reach anyone in the call with an offer', r.status === 403 && !sig(stream[S], 'offer').length, JSON.stringify(r));
  r = await signal(S, { roomId: 1, type: 'offer', to: O, data: { type: 'offer', sdp: 'v=0' } });
  c('…nor be reached by one', r.status === 400 && !sig(stream[O], 'offer').length, JSON.stringify(r));
  const liveList = await (await api(O, '/chat/huddle/live')).json();
  c('the running huddle is not offered back to them', Array.isArray(liveList) && !liveList.some(x => x.roomId === 1), JSON.stringify(liveList));
  r = await json(await api(O, '/chat/huddle/1'));
  c('…and reading its roster says they were removed', r.status === 403 && r.removed === true, JSON.stringify(r));
  r = await signal(S, { roomId: 1, type: 'invite', to: O });
  c('only the host can ask them back — anyone else is told why not', r.status === 403 && /host removed them/i.test(r.error), JSON.stringify(r));
  clear();
  r = await signal(A, { roomId: 1, type: 'invite', to: O });
  await sleep(80);
  c('the host can, which rings them', r.status === 200 && sig(stream[O], 'invite').length === 1, JSON.stringify(r));
  r = await signal(O, { roomId: 1, type: 'join', data: { sid: 'o3' } });
  c('…and lets them back in', r.status === 200 && r.ok === true, JSON.stringify(r));

  // The role passes on and comes back.
  await signal(A, { roomId: 1, type: 'leave', data: { sid: 'a1' } });
  let ps = await roster();
  c('when the host leaves, whoever has been in longest is host', ps.find(p => p.host) && ps.find(p => p.host).key === S, JSON.stringify(ps));
  r = await signal(S, { roomId: 1, type: 'remove', to: O });
  c('…with the host\'s powers', r.status === 200, JSON.stringify(r));
  await signal(A, { roomId: 1, type: 'invite', to: O });   // the admin is not in the call, and not the host
  r = await signal(O, { roomId: 1, type: 'join', data: { sid: 'o4' } });
  c('…and an invite from someone outside the call does not lift it', r.status === 403 && r.removed === true, JSON.stringify(r));
  await signal(A, { roomId: 1, type: 'join', data: { sid: 'a2' } });
  ps = await roster();
  c('whoever started it is host again when they come back', ps.find(p => p.host) && ps.find(p => p.host).key === A, JSON.stringify(ps));

  // A guest removed: their grant goes, and they are still told why.
  await signal(A, { roomId: 1, type: 'invite', to: L });
  r = await signal(L, { roomId: 1, type: 'join', data: { sid: 'l1' } });
  c('a guest pulled in from outside the room joins', r.status === 200, JSON.stringify(r));
  await signal(A, { roomId: 1, type: 'remove', to: L });
  r = await signal(L, { roomId: 1, type: 'join', data: { sid: 'l2' } });
  c('a removed guest is told they were removed, not that they are a stranger', r.status === 403 && r.removed === true, JSON.stringify(r));
  r = await signal(L, { roomId: 1, type: 'ice', to: S, data: { candidate: 'x' } });
  c('…and can signal nobody', r.status === 403, JSON.stringify(r));

  // ── Reactions ──────────────────────────────────────────────────────────────
  clear();
  r = await signal(S, { roomId: 1, type: 'reaction', data: { emoji: '🎉' } });
  await sleep(100);
  const got = sig(stream[A], 'reaction');
  c('a reaction reaches the others in the call, saying who sent it', r.status === 200 && got.length === 1 && got[0].json.emoji === '🎉' && got[0].json.from === S && got[0].json.fromName === 'Sara',
    JSON.stringify(got.map(f => f.json)));
  c('…not the sender, who shows their own', !sig(stream[S], 'reaction').length);
  c('…nor anyone in the room who is not in the call', !sig(stream[O], 'reaction').length);
  c('…and it carries no id: a stream that reconnects is never sent it late', got.length && !got[0].id, JSON.stringify(got[0]));
  r = await signal(S, { roomId: 1, type: 'reaction', data: { emoji: 'lol' } });
  c('only the reactions on offer are accepted', r.status === 400, JSON.stringify(r));
  r = await signal(N, { roomId: 1, type: 'reaction', data: { emoji: '👍' } });
  c('a stranger to the room cannot react', r.status === 403, JSON.stringify(r));
  await signal(O, { roomId: 1, type: 'leave' });
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await signal(A, { roomId: 1, type: 'reaction', data: { emoji: '👏' } })).status);
  c('a burst is limited — eight in five seconds, then a polite no', codes.slice(0, 8).every(x => x === 200) && codes[8] === 429, codes.join());

  // ── Meeting threads ────────────────────────────────────────────────────────
  await sleep(100);
  const sess = T.huddle_sessions.filter(s => s.room_id === 1);
  c('the huddle is recorded as a session, open while it runs', sess.length === 1 && sess[0].host_key === A && !sess[0].ended_at, JSON.stringify(sess));
  const sid1 = sess[0] && sess[0].id;
  const parts = T.huddle_participants.filter(p => p.session_id === sid1).map(p => p.member_key).sort().join();
  c('…with everyone who was ever in it, once each — the guest too', parts === [A, S, O, L].sort().join(), parts);

  let th = await json(await api(S, '/chat/huddle/1/thread'));
  c('the call\'s thread opens by room, empty', th.status === 200 && th.session && th.session.id === sid1 && th.session.live === true && Array.isArray(th.messages) && !th.messages.length,
    JSON.stringify(th).slice(0, 200));
  clear();
  r = await json(await api(S, `/chat/huddle/threads/${sid1}/messages`, { method: 'POST', body: JSON.stringify({ body: '  Agenda: pricing\nhttps://example.com/sheet  ' }) }));
  await sleep(100);
  c('someone in the call writes in it', r.status === 200 && r.body === 'Agenda: pricing\nhttps://example.com/sheet' && r.sender_key === S, JSON.stringify(r));
  c('…and it is kept', T.huddle_messages.length === 1 && T.huddle_messages[0].session_id === sid1);
  const heard = k => sig(stream[k], 'thread').some(f => f.json.sessionId === sid1 && f.json.message.body.startsWith('Agenda'));
  c('everyone who may read it hears it at once — the room, and the guest who was in the call', heard(A) && heard(O) && heard(L) && heard(S),
    JSON.stringify({ A: heard(A), O: heard(O), L: heard(L), S: heard(S) }));
  c('…and nobody else', !heard(N));
  r = await json(await api(L, `/chat/huddle/threads/${sid1}/messages`, { method: 'POST', body: JSON.stringify({ body: 'let me back' }) }));
  c('someone the host removed cannot write in the running call\'s thread', r.status === 403 && r.removed === true, JSON.stringify(r));
  r = await json(await api(S, `/chat/huddle/threads/${sid1}/messages`, { method: 'POST', body: JSON.stringify({ body: '   ' }) }));
  c('an empty message is refused', r.status === 400, JSON.stringify(r));
  r = await json(await api(N, `/chat/huddle/threads/${sid1}`));
  c('a stranger to the room and the call cannot read it', r.status === 403, JSON.stringify(r));
  r = await json(await api(N, `/chat/huddle/threads/${sid1}/messages`, { method: 'POST', body: JSON.stringify({ body: 'hi' }) }));
  c('…nor write in it', r.status === 403, JSON.stringify(r));

  // The call ends; the thread does not.
  for (const k of [A, S]) await signal(k, { roomId: 1, type: 'leave' });
  await sleep(150);
  const ended = T.huddle_sessions.find(s => s.id === sid1);
  c('the last one out ends the session', ended && !!ended.ended_at, JSON.stringify(ended));
  const rows = await (await api(S, '/chat/huddle/threads')).json();
  const mine = rows.find(x => x.id === sid1);
  c('after the call it is in the history, with its count, people and title',
    mine && mine.live === false && mine.message_count === 1 && mine.title === 'Ops' && mine.participants.length === 4 && mine.host_key === A,
    JSON.stringify(mine));
  th = await json(await api(O, `/chat/huddle/threads/${sid1}`));
  c('anyone in the conversation can read it afterwards', th.status === 200 && th.messages.length === 1 && th.messages[0].body.startsWith('Agenda'), JSON.stringify(th).slice(0, 160));
  const guestRows = await (await api(L, '/chat/huddle/threads')).json();
  c('a guest who was in the call finds it in their history, though not in the room', Array.isArray(guestRows) && guestRows.some(x => x.id === sid1 && x.title === 'Ops'), JSON.stringify(guestRows).slice(0, 200));
  th = await json(await api(L, `/chat/huddle/threads/${sid1}`));
  c('…and can read it', th.status === 200 && th.messages.length === 1, JSON.stringify(th).slice(0, 120));
  r = await json(await api(L, `/chat/huddle/threads/${sid1}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Notes from me' }) }));
  c('…and, the call over, add to it', r.status === 200, JSON.stringify(r));
  const strangerRows = await (await api(N, '/chat/huddle/threads')).json();
  c('a stranger\'s history does not have it', Array.isArray(strangerRows) && !strangerRows.some(x => x.id === sid1), JSON.stringify(strangerRows));
  const roomRows = await (await api(S, '/chat/huddle/threads?room=2')).json();
  c('?room= narrows the history to one conversation', Array.isArray(roomRows) && !roomRows.some(x => x.id === sid1), JSON.stringify(roomRows));
  r = await json(await api(S, '/chat/huddle/1/thread'));
  c('with no huddle running, the room has no live thread', r.status === 404, JSON.stringify(r));

  // A new huddle in the same room is a new session — and a new host.
  await signal(S, { roomId: 1, type: 'join', data: { sid: 's9' } });
  await sleep(100);
  const second = T.huddle_sessions.filter(s => s.room_id === 1 && s.id !== sid1);
  c('the next huddle in the room is its own session, started by its own host', second.length === 1 && second[0].host_key === S && !second[0].ended_at, JSON.stringify(second));
  await signal(S, { roomId: 1, type: 'leave' });

  // ── A restart carries the session on ───────────────────────────────────────
  T.huddle_sessions.push({ id: 900, room_id: 3, host_key: S, host_name: 'Sara', started_at: iso(Date.now() - 600_000), ended_at: null });
  T.huddle_messages.push({ id: 901, session_id: 900, room_id: 3, sender_key: S, sender_name: 'Sara', body: 'before the deploy', created_at: iso(Date.now() - 300_000) });
  await signal(A, { roomId: 3, type: 'join', data: { sid: 'ar', afterRestart: true } });
  await sleep(150);
  th = await json(await api(A, '/chat/huddle/3/thread'));
  c('after a restart the call picks its open session back up', th.status === 200 && th.session && th.session.id === 900 && th.messages.length === 1, JSON.stringify(th).slice(0, 200));
  c('…rather than starting another', T.huddle_sessions.filter(s => s.room_id === 3).length === 1);
  await signal(S, { roomId: 3, type: 'join', data: { sid: 'sr', afterRestart: true } });
  const ps3 = (await json(await api(A, '/chat/huddle/3'))).participants || [];
  c('…and whoever started it is its host again once back', ps3.find(p => p.host) && ps3.find(p => p.host).key === S, JSON.stringify(ps3));
  c('…and its clock still counts from when it began', (await json(await api(A, '/chat/huddle/3'))).started_at <= Date.now() - 590_000);
  for (const k of [A, S]) await signal(k, { roomId: 3, type: 'leave' });

  // ── A session a crash left open is closed, as of its last word ───────────────
  const lastWord = iso(Date.now() - 3_600_000);
  T.huddle_sessions.push({ id: 950, room_id: 4, host_key: A, host_name: 'Admin', started_at: iso(Date.now() - 7_200_000), ended_at: null });
  T.huddle_messages.push({ id: 951, session_id: 950, room_id: 4, sender_key: A, sender_name: 'Admin', body: 'last word', created_at: lastWord });
  await signal(A, { roomId: 4, type: 'join', data: { sid: 'a4' } });
  await sleep(150);
  const stale = T.huddle_sessions.find(s => s.id === 950);
  c('a session a crash left open is closed when the next huddle starts there', stale && stale.ended_at === lastWord, JSON.stringify(stale));
  c('…as of its last message, not now', T.huddle_sessions.filter(s => s.room_id === 4 && !s.ended_at).length === 1);
  await signal(A, { roomId: 4, type: 'leave' });

  // ── Without migration 024 the call still connects ───────────────────────────
  for (const t of ['huddle_sessions', 'huddle_participants', 'huddle_messages']) db.missing.add(t);
  r = await signal(A, { roomId: 4, type: 'join', data: { sid: 'a5' } });
  c('without the tables a huddle still starts', r.status === 200 && r.ok === true, JSON.stringify(r));
  th = await json(await api(A, '/chat/huddle/4/thread'));
  c('…and its thread says which migration it needs', th.status === 503 && th.migration === '024' && /024_huddles_and_group_pictures/.test(th.error), JSON.stringify(th));
  r = await json(await api(A, '/chat/huddle/threads'));
  c('…as does the history', r.status === 503 && r.migration === '024', JSON.stringify(r));
  await signal(A, { roomId: 4, type: 'leave' });
  for (const t of ['huddle_sessions', 'huddle_participants', 'huddle_messages']) db.missing.delete(t);

  // ── Group pictures ─────────────────────────────────────────────────────────
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const form = (bytes, type, name) => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type }), name); return fd; };
  r = await json(await api(A, '/chat/rooms/1/picture', { method: 'POST', body: form(PNG, 'image/png', 'ops.png') }));
  const room1 = T.chat_rooms.find(x => x.id === 1);
  const firstPic = room1.avatar_url;
  c('the admin sets a group\'s picture', r.status === 200 && /\/storage\/v1\/object\/public\/chat-files\/group-avatars\/1_\d+_[0-9a-f]+\.png$/.test(r.avatar_url) && firstPic === r.avatar_url,
    JSON.stringify(r).slice(0, 200));
  const stored = [...db.storage.entries()].find(([k]) => k.startsWith('chat-files/group-avatars/1_'));
  c('…stored by the server, with its type', stored && stored[1].contentType === 'image/png' && stored[1].size === PNG.length, JSON.stringify(stored));
  const rooms = await (await api(S, '/chat/rooms')).json();
  c('everyone in the group gets it with the room', rooms.find(x => x.id === 1) && rooms.find(x => x.id === 1).avatar_url === firstPic);
  r = await json(await api(A, '/chat/rooms/1/picture', { method: 'POST', body: form(PNG, 'image/jpeg', 'ops2.jpg') }));
  await sleep(80);
  c('changing it stores the new one and deletes the old', r.status === 200 && r.avatar_url !== firstPic && [...db.storage.keys()].filter(k => k.startsWith('chat-files/group-avatars/1_')).length === 1,
    JSON.stringify([...db.storage.keys()]));
  r = await json(await api(S, '/chat/rooms/1/picture', { method: 'POST', body: form(PNG, 'image/png', 'x.png') }));
  c('someone who may not manage the group cannot', r.status === 403, JSON.stringify(r));
  r = await json(await api(S, '/chat/rooms/2/picture', { method: 'POST', body: form(PNG, 'image/png', 'squad.png') }));
  c('…but a group they created, they can', r.status === 200 && /group-avatars\/2_/.test(r.avatar_url), JSON.stringify(r).slice(0, 160));
  r = await json(await api(A, '/chat/rooms/1/picture', { method: 'POST', body: form('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml', 'x.svg') }));
  c('an SVG is refused — it could carry script', r.status === 400, JSON.stringify(r));
  r = await json(await api(A, '/chat/rooms/1/picture', { method: 'POST', body: form(Buffer.alloc(5 * 1024 * 1024 + 10), 'image/png', 'big.png') }));
  c('so is anything over 5 MB', r.status === 413 && /5 MB/.test(r.error), JSON.stringify(r));
  r = await json(await api(A, '/chat/rooms/1/picture', { method: 'POST', body: JSON.stringify({ url: 'https://evil.example/x.png' }) }));
  c('an address in place of an upload is not a picture', r.status === 400 && T.chat_rooms.find(x => x.id === 1).avatar_url !== 'https://evil.example/x.png', JSON.stringify(r));
  r = await json(await api(A, '/chat/rooms/3/picture', { method: 'POST', body: form(PNG, 'image/png', 'dm.png') }));
  c('a direct conversation has no group picture to set', r.status === 403, JSON.stringify(r));
  r = await json(await api(A, '/chat/rooms/1/picture', { method: 'DELETE' }));
  await sleep(80);
  c('removing it clears it and deletes the file', r.status === 200 && r.avatar_url === '' && ![...db.storage.keys()].some(k => k.startsWith('chat-files/group-avatars/1_')),
    JSON.stringify([...db.storage.keys()]));

  // ── The workspace ──────────────────────────────────────────────────────────
  let ws = await (await fetch(base + '/api/workspace')).json();
  c('anyone can read the workspace\'s name and picture, signed in or not', ws.name === 'MotoLinker' && ws.logo_url === '', JSON.stringify(ws));
  r = await json(await fetch(base + '/api/dashboard/workspace', { method: 'PUT', headers: { Authorization: 'Bearer ' + tok[2], 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Hijack' }) }));
  c('only the admin can change them', r.status === 401, JSON.stringify(r));
  clear();
  r = await json(await api(A, '/workspace', { method: 'PUT', body: JSON.stringify({ name: '  Moto   Linkers\n HQ  ' }) }));
  await sleep(100);
  c('the admin renames the workspace, tidied to one line', r.status === 200 && r.name === 'Moto Linkers HQ', JSON.stringify(r));
  const kv = T.quotation_settings.find(x => x.key === 'workspace_profile');
  c('…kept with the other org-wide settings', kv && JSON.parse(kv.value).name === 'Moto Linkers HQ', JSON.stringify(kv));
  const told = f => f.event === 'workspace' && f.json && f.json.name === 'Moto Linkers HQ';
  c('every open page is told at once, in both portals', stream[S].frames.some(told) && stream[A].frames.some(told) && stream[N].frames.some(told));
  ws = await (await fetch(base + '/api/workspace')).json();
  c('and everyone reads the new name', ws.name === 'Moto Linkers HQ');
  r = await json(await api(A, '/workspace', { method: 'PUT', body: JSON.stringify({ name: '   ' }) }));
  c('a blank name is refused', r.status === 400, JSON.stringify(r));
  r = await json(await api(A, '/workspace', { method: 'PUT', body: JSON.stringify({ name: 'x'.repeat(61) }) }));
  c('so is one too long to be a name', r.status === 400, JSON.stringify(r));
  r = await json(await api(A, '/workspace/logo', { method: 'POST', body: form(PNG, 'image/png', 'logo.png') }));
  const logo1 = r.logo_url;
  c('the admin sets the workspace\'s picture', r.status === 200 && /\/storage\/v1\/object\/public\/chat-files\/workspace\/logo_\d+_[0-9a-f]+\.png$/.test(logo1) && r.name === 'Moto Linkers HQ',
    JSON.stringify(r).slice(0, 200));
  ws = await (await fetch(base + '/api/workspace')).json();
  c('…which everyone reads', ws.logo_url === logo1);
  r = await json(await api(A, '/workspace/logo', { method: 'POST', body: form(PNG, 'image/webp', 'logo2.webp') }));
  await sleep(80);
  c('a new picture replaces the old, whose file is deleted', r.status === 200 && r.logo_url !== logo1 && [...db.storage.keys()].filter(k => k.startsWith('chat-files/workspace/')).length === 1,
    JSON.stringify([...db.storage.keys()]));
  r = await json(await fetch(base + '/api/dashboard/workspace/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + tok[2] }, body: form(PNG, 'image/png', 'x.png') }));
  c('an employee cannot set it', r.status === 401, JSON.stringify(r));
  r = await json(await api(A, '/workspace/logo', { method: 'POST', body: form('<svg/>', 'image/svg+xml', 'x.svg') }));
  c('nor can anyone set an SVG', r.status === 400, JSON.stringify(r));
  r = await json(await api(A, '/workspace/logo', { method: 'DELETE' }));
  await sleep(80);
  c('back to the default picture, the file gone, the name kept', r.status === 200 && r.logo_url === '' && r.name === 'Moto Linkers HQ'
    && ![...db.storage.keys()].some(k => k.startsWith('chat-files/workspace/')), JSON.stringify(r));

  Object.values(stream).forEach(s => s.close());
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
