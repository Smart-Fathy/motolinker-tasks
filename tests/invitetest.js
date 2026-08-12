// A huddle invite has to reach someone who is not looking at the chat page.
//
// It used to be delivered only by chatBroadcast, which writes to chatSseClients — a
// map populated by the chat page loader and emptied again the moment you navigate
// away. Anywhere else in the app the invite was dropped server-side: no ring, no
// notification row, no push, no trace. This asserts the new path, and asserts just as
// hard that the WebRTC signalling did NOT follow it onto the notification stream.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3987';

const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// Sara and the admin share room 1. Sara is the one who will not be on the chat page.
const MEMBERS = [{ room_id: 1, member_key: 'admin' }, { room_id: 1, member_key: 'employee_2' }];
const inserted = [];

const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const table = (url.match(/\/rest\/v1\/([^?/]+)/) || [])[1] || '?';
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || ''));
  if (init && init.method === 'POST' && table === 'notifications') {
    inserted.push(JSON.parse(init.body));
    const row = { id: inserted.length, ...inserted[inserted.length - 1] };
    return new Response(JSON.stringify(accept.includes('pgrst.object') ? row : [row]),
      { status: 201, headers: { 'Content-Type': 'application/json' } });
  }
  let rows = [];
  if (table === 'chat_room_members') rows = MEMBERS;
  if (table === 'employees') rows = [{ id: 2, name: 'Sara', avatar_url: null }];
  const body = accept.includes('pgrst.object') ? JSON.stringify(rows[0] || {}) : JSON.stringify(rows);
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');

const base = 'http://127.0.0.1:' + process.env.PORT;

// Stand-in for a connected stream: records everything written to it.
function fakeStream() {
  const frames = [];
  return { frames, write(s) { frames.push(s); }, end() {}, setHeader() {}, flushHeaders() {}, on() {} };
}
const parseFrames = st => st.frames.map(f => {
  const ev = (f.match(/^event: (\S+)/m) || [])[1];
  const data = (f.match(/^data: (.*)$/m) || [])[1];
  return { ev, data: data ? JSON.parse(data) : null };
});

setTimeout(async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/api/push/vapid-public-key'); break; }
    catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  const { token } = await (await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();

  const empToken = 'invite-test-employee';
  ctx.employeeSessions.set(empToken, {
    id: 2, name: 'Sara', username: 'sara', job_title: '', permissions: normEmpPerms({}),
  });

  // Sara is signed in and her notification stream is open — but she is on Home, so she
  // has no chat stream at all. This is precisely the case that used to lose invites.
  const saraNotif = fakeStream();
  ctx.notifSseClients.set('employee_2', saraNotif);
  check('the person being invited has no chat stream',
    !ctx.chatSseClients || !ctx.chatSseClients.has('employee_2'));

  const signal = (body, tok) => fetch(base + '/api/dashboard/chat/huddle/signal', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (tok || token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

  // The admin starts a huddle and invites Sara.
  await signal({ roomId: 1, type: 'join' });
  const inv = await signal({ roomId: 1, type: 'invite', to: 'employee_2' });
  check('the invite is accepted', inv && inv.ok === true, JSON.stringify(inv));

  await new Promise(r => setTimeout(r, 200));

  const frames = parseFrames(saraNotif);
  const huddleFrames = frames.filter(f => f.ev === 'huddle');
  check('the invite reaches her notification stream', huddleFrames.length === 1,
    JSON.stringify(frames.map(f => f.ev)));
  check('and it carries who is calling and which room',
    huddleFrames[0] && huddleFrames[0].data.type === 'invite'
      && huddleFrames[0].data.roomId === 1 && !!huddleFrames[0].data.fromName,
    JSON.stringify(huddleFrames[0] && huddleFrames[0].data));

  const notifFrames = frames.filter(f => f.ev === 'notification');
  check('a notification is raised so the bell shows it', notifFrames.length === 1,
    JSON.stringify(frames.map(f => f.ev)));
  check('the notification is typed as a huddle',
    notifFrames[0] && notifFrames[0].data.type === 'huddle', JSON.stringify(notifFrames[0] && notifFrames[0].data));
  check('it deep-links to the chat page so it can be joined',
    notifFrames[0] && /#chat$/.test(notifFrames[0].data.url || ''), JSON.stringify(notifFrames[0] && notifFrames[0].data));
  check('it is persisted, not only pushed live', inserted.length === 1, JSON.stringify(inserted));

  // ── The signalling must NOT follow it ──
  // Duplicating offer/answer/ice across two transports would be a correctness hazard;
  // the notification stream carries invites and nothing else.
  saraNotif.frames.length = 0;
  for (const type of ['offer', 'answer', 'ice', 'media']) {
    await signal({ roomId: 1, type, to: 'employee_2', data: { sdp: 'x' } });
  }
  await new Promise(r => setTimeout(r, 200));
  const leaked = parseFrames(saraNotif).filter(f => f.ev === 'huddle');
  check('offer, answer, ice and media do not leak onto the notification stream',
    leaked.length === 0, JSON.stringify(leaked.map(f => f.data && f.data.type)));

  // ── An invite still works normally for someone who IS on the chat page ──
  const saraChat = fakeStream();
  ctx.chatSseClients.set('employee_2', saraChat);
  saraNotif.frames.length = 0;
  await signal({ roomId: 1, type: 'invite', to: 'employee_2' });
  await new Promise(r => setTimeout(r, 200));
  check('someone on the chat page still gets it there',
    parseFrames(saraChat).some(f => f.ev === 'huddle'), JSON.stringify(parseFrames(saraChat).map(f => f.ev)));
  check('and also on the notification stream, which the client de-duplicates',
    parseFrames(saraNotif).some(f => f.ev === 'huddle'));

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} invite checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}, 1500);
