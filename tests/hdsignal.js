// Huddle signalling transport and liveness, against the real server.
//
// The reported problem: "errors and connectivity issues when I open a new huddle
// with people — it happens a lot". The causes this pins down:
//   • signalling rode the chat stream, which only exists while the Chat page is
//     open — join from the chip, the calendar or Meet, or look at another page
//     mid-call, and offers, answers and candidates were dropped on the floor;
//   • one stream per person, so a second tab or device silently took them all;
//   • nothing was kept for a stream that was reconnecting (the host cuts every
//     stream at 15 minutes), so a frame sent in that gap was simply lost;
//   • a closed tab stayed in the roster for good, and the next "new" huddle in
//     that room dialled the ghost and waited on it;
//   • every joiner rang the whole room again, people already in the call included.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3989';
const http = require('http');

const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const MEMBERS = [{ room_id: 1, member_key: 'admin' }, { room_id: 1, member_key: 'employee_2' }];
let memberQueries = 0;
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const table = (url.match(/\/rest\/v1\/([^?/]+)/) || [])[1] || '?';
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || ''));
  let rows = [];
  if (table === 'chat_room_members') { memberQueries++; rows = MEMBERS; }
  if (table === 'employees') rows = [{ id: 2, name: 'Sara', avatar_url: null }];
  if (table === 'notifications' && init && init.method === 'POST') rows = [{ id: 1, ...JSON.parse(init.body) }];
  const body = accept.includes('pgrst.object') ? JSON.stringify(rows[0] || {}) : JSON.stringify(rows);
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
const PORT = Number(process.env.PORT);
const base = 'http://127.0.0.1:' + PORT;
const wait = ms => new Promise(r => setTimeout(r, ms));

// A real notification stream over HTTP, parsed into frames as a browser would.
function openStream(path, headers) {
  const st = { frames: [], raw: '', open: false, req: null };
  return new Promise(resolve => {
    st.req = http.get({ host: '127.0.0.1', port: PORT, path, headers: headers || {} }, res => {
      st.status = res.statusCode;
      res.on('data', d => {
        st.raw += d.toString();
        let i;
        while ((i = st.raw.indexOf('\n\n')) >= 0) {
          const block = st.raw.slice(0, i); st.raw = st.raw.slice(i + 2);
          const f = {};
          for (const line of block.split('\n')) {
            const m = /^(\w+): ?(.*)$/.exec(line);
            if (m) f[m[1]] = m[2];
          }
          if (block.startsWith(':ok') || /\n:ok|^retry/.test(block)) st.open = true;
          if (f.event) { f.json = f.data ? JSON.parse(f.data) : null; st.frames.push(f); }
          if ('retry' in f) st.retry = f.retry;
        }
        if (st.open && !st.resolved) { st.resolved = true; resolve(st); }
      });
    });
    st.close = () => { try { st.req.destroy(); } catch (_) {} };
  });
}
const sigFrames = st => st.frames.filter(f => f.event === 'huddle-signal');

setTimeout(async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/api/push/vapid-public-key'); break; }
    catch (_) { await wait(100); }
  }
  const { token } = await (await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();
  const emp = 'hdsignal-test-employee';
  ctx.employeeSessions.set(emp, { id: 2, name: 'Sara', username: 'sara', job_title: '', permissions: normEmpPerms({ chat: true }) });

  const adminSig = body => fetch(base + '/api/dashboard/chat/huddle/signal', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json());
  const saraSig = body => fetch(base + '/api/employee/chat/huddle/signal', {
    method: 'POST', headers: { Authorization: 'Bearer ' + emp, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json());
  const saraPath = '/api/employee/notifications/stream?_t=' + emp;

  // ── Off the Chat page, on two devices ──
  const tabA = await openStream(saraPath);
  const tabB = await openStream(saraPath);
  check('the stream tells the browser to reconnect after a second', tabA.retry === '1000', String(tabA.retry));
  check('Sara has no chat stream open — she is on another page',
    !ctx.chatSseClients.has('employee_2'));

  const legacy = { frames: [], write(s) { this.frames.push(s); } };
  ctx.chatSseClients.set('admin', legacy);   // the admin's tab still runs the previous bundle

  memberQueries = 0;
  const j1 = await adminSig({ roomId: 1, type: 'join', data: { sid: 'adm1' } });
  check('the join answer names this server process', typeof j1.boot === 'string' && j1.boot.length > 3, JSON.stringify(j1));
  check('and lists the joiner with their session id',
    Array.isArray(j1.participants) && j1.participants.some(p => p.key === 'admin' && p.sid === 'adm1'), JSON.stringify(j1.participants));
  await adminSig({ roomId: 1, type: 'offer', to: 'employee_2', data: { type: 'offer', sdp: 'v=0' } });
  await adminSig({ roomId: 1, type: 'ice', to: 'employee_2', data: { candidate: 'c1' } });
  await adminSig({ roomId: 1, type: 'restart', to: 'employee_2' });
  await wait(150);
  const typesA = sigFrames(tabA).map(f => f.json.type).join();
  check('roster, offer, candidate and restart reach her without a chat stream',
    typesA === 'roster,offer,ice,restart', typesA);
  check('every one of her open tabs gets them, not only the newest',
    sigFrames(tabB).map(f => f.json.type).join() === typesA, sigFrames(tabB).map(f => f.json.type).join());
  check('each frame carries an id to resume from', sigFrames(tabA).every(f => /^[0-9a-z]+\.\d+$/.test(f.id || '')),
    sigFrames(tabA).map(f => f.id).join());
  check('the roster frame names the server process', sigFrames(tabA)[0].json.boot === j1.boot);
  check('room members are read once, not on every candidate', memberQueries === 1, `${memberQueries} queries`);

  // The previous bundle, still open somewhere, keeps working through the rollout.
  const sara0 = await saraSig({ roomId: 1, type: 'answer', to: 'admin', data: { type: 'answer', sdp: 'v=0' } });
  await wait(100);
  check('a tab on the previous bundle still gets signalling on its chat stream',
    sara0.ok === true && legacy.frames.some(f => /^event: huddle\n/.test(f) && f.includes('"answer"')), JSON.stringify(sara0));

  // ── A reconnect is sent what it missed ──
  const lastId = sigFrames(tabA).slice(-1)[0].id;
  tabA.close(); tabB.close();
  await wait(100);
  await adminSig({ roomId: 1, type: 'ice', to: 'employee_2', data: { candidate: 'gap1' } });
  await adminSig({ roomId: 1, type: 'ice', to: 'employee_2', data: { candidate: 'gap2' } });
  await wait(50);
  const back = await openStream(saraPath, { 'Last-Event-ID': lastId });
  await wait(100);
  const replayed = sigFrames(back).map(f => f.json.data && f.json.data.candidate).join();
  check('the browser\'s own reconnect (Last-Event-ID) gets exactly the frames in the gap', replayed === 'gap1,gap2', replayed);
  back.close();
  const rebuilt = await openStream(saraPath + '&hs=' + encodeURIComponent(lastId));
  await wait(100);
  check('so does a rebuilt stream, which passes it in the URL',
    sigFrames(rebuilt).map(f => f.json.data && f.json.data.candidate).join() === 'gap1,gap2');
  rebuilt.close();
  const fresh = await openStream(saraPath);
  await wait(100);
  check('a brand-new stream is not replayed anything', sigFrames(fresh).length === 0, String(sigFrames(fresh).length));
  fresh.close();
  const otherBoot = await openStream(saraPath + '&hs=zzzz.999999');
  await wait(100);
  check('an id from before a restart gets everything the new process holds',
    sigFrames(otherBoot).length >= 6, String(sigFrames(otherBoot).length));
  otherBoot.close();

  // ── Ringing ──
  const saraNotif = await openStream(saraPath);
  const sj = await saraSig({ roomId: 1, type: 'join', data: { sid: 'sara1' } });
  check('Sara joins', sj.ok === true, JSON.stringify(sj));
  const ring = await adminSig({ roomId: 1, type: 'invite', to: 'employee_2' });
  await wait(150);
  check('nobody already in the call is rung again', ring.skipped && !sigFrames(saraNotif).some(f => f.json.type === 'invite'),
    JSON.stringify(ring));

  // ── Liveness ──
  const alive = await saraSig({ roomId: 1, type: 'alive' });
  check('a participant\'s ping is answered "still in the call"', alive.inCall === true && alive.boot === j1.boot, JSON.stringify(alive));
  await wait(50);
  check('and is not relayed to anyone', !sigFrames(saraNotif).some(f => f.json.type === 'alive'));

  // A legacy participant (no session id) must never be swept: it does not ping.
  ctx.chatSseClients.delete('admin');
  await adminSig({ roomId: 1, type: 'join' });   // the admin's old tab rejoins, no sid
  saraNotif.frames.length = 0;
  await ctx.huddleSweep(Date.now() + 91_000);
  await wait(100);
  let left = sigFrames(saraNotif).filter(f => f.json.type === 'roster' && f.json.left);
  const roster = left.length ? left[0].json.participants.map(p => p.key).join() : '';
  check('90 s of silence drops the participant who stopped pinging, and says so',
    left.length === 1 && left[0].json.left === 'employee_2', JSON.stringify(left.map(f => f.json)));
  check('but never one on the previous bundle, which never pings', roster === 'admin', roster);
  const after = await saraSig({ roomId: 1, type: 'alive' });
  check('the dropped tab learns it on its next ping, so it can rejoin', after.inCall === false, JSON.stringify(after));

  // ── A closing tab's beacon: no Authorization header, the token in the URL ──
  await saraSig({ roomId: 1, type: 'join', data: { sid: 'sara2' } });
  const beacon = await fetch(base + '/api/employee/chat/huddle/signal?_t=' + emp, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: 1, type: 'leave' }),
  });
  const live = await fetch(base + '/api/dashboard/chat/huddle/1', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json());
  check('a pagehide beacon takes the closing tab out of the call',
    beacon.status === 200 && !live.participants.some(p => p.key === 'employee_2'), JSON.stringify(live));
  check('the roster read names the server process too', live.boot === j1.boot);
  saraNotif.close();

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} huddle signalling checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}, 1500);
