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
  if (table === 'employees') rows = [{ id: 2, name: 'Sara', avatar_url: null }, { id: 3, name: 'Omar', avatar_url: null },
    ...[4, 5, 6, 7, 8].map(id => ({ id, name: 'Guest ' + id, avatar_url: null }))];
  if (table === 'notifications' && init && init.method === 'POST') rows = [{ id: 1, ...JSON.parse(init.body) }];
  // A login the server has not seen since it started: restoring it is a round trip,
  // slow on purpose here, as Supabase is after a restart.
  if (table === 'sessions' && (!init || !init.method || init.method === 'GET') && url.includes('slow-admin-tok')) {
    await new Promise(r => setTimeout(r, 400));
    rows = [{ kind: 'admin', payload: { username: 'admin', createdAt: Date.now() }, created_at: new Date().toISOString() }];
  }
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
  const saraPath = '/api/employee/notifications/stream?_t=' + emp + '&hd=2';   // Sara is on this bundle
  const adminOldPath = '/api/dashboard/notifications/stream?_t=' + token;      // the admin's tab is not

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

  // A client rejoining after a restart produces a half-rebuilt roster. The previous
  // bundle hangs up on anyone a roster leaves out, so it must not see that one.
  check('the previous bundle sees an ordinary join\'s roster', legacy.frames.some(f => /^event: huddle\n/.test(f) && f.includes('"roster"')));
  legacy.frames.length = 0;
  const nBefore = sigFrames(tabA).length;
  await saraSig({ roomId: 1, type: 'join', data: { sid: 'sara0', afterRestart: true } });
  await wait(100);
  check('…but not one from a rejoin after a restart, which only the current bundle gets',
    !legacy.frames.some(f => f.includes('"roster"')) && sigFrames(tabA).slice(nBefore).some(f => f.json.type === 'roster'),
    JSON.stringify(legacy.frames.map(f => f.slice(0, 60))));

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

  // A participant on the previous bundle (no session id) does not ping. While its
  // tab is open, silence means nothing.
  ctx.chatSseClients.delete('admin');
  const adminOld = await openStream(adminOldPath);
  await adminSig({ roomId: 1, type: 'join' });   // the admin's old tab rejoins, no sid
  saraNotif.frames.length = 0;
  await ctx.huddleSweep(Date.now() + 91_000);
  await wait(100);
  let left = sigFrames(saraNotif).filter(f => f.json.type === 'roster' && f.json.left);
  const roster = left.length ? left[0].json.participants.map(p => p.key).join() : '';
  check('90 s of silence drops the participant who stopped pinging, and says so',
    left.length === 1 && left[0].json.left === 'employee_2', JSON.stringify(left.map(f => f.json)));
  check('but not one on the previous bundle whose tab is still open', roster === 'admin', roster);
  const after = await saraSig({ roomId: 1, type: 'alive' });
  check('the dropped tab learns it on its next ping, so it can rejoin', after.inCall === false, JSON.stringify(after));

  // ── Ringing someone the server can't vouch for ──
  // The admin's entry came from the previous bundle (no sid): it is never swept, so it
  // may be the ghost of a tab closed hours ago. Skipping the invite would ring nobody.
  const ringOld = await saraSig({ roomId: 1, type: 'invite', to: 'admin' });
  check('an entry from the previous bundle is still rung', ringOld.ok === true && !ringOld.skipped, JSON.stringify(ringOld));

  // ── The same person on a second device ──
  await saraSig({ roomId: 1, type: 'join', data: { sid: 'sara-laptop' } });
  await saraSig({ roomId: 1, type: 'join', data: { sid: 'sara-phone' } });   // she moves the call to her phone
  const laptopPing = await saraSig({ roomId: 1, type: 'alive' });
  check('the replaced device learns from its ping that another holds the call',
    laptopPing.inCall === true && laptopPing.sid === 'sara-phone', JSON.stringify(laptopPing));
  const staleLeave = await saraSig({ roomId: 1, type: 'leave', data: { sid: 'sara-laptop' } });
  let still = await fetch(base + '/api/dashboard/chat/huddle/1', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json());
  check("the replaced device's leave does not end the call on the new one",
    staleLeave.ignored === 'superseded' && still.participants.some(p => p.key === 'employee_2' && p.sid === 'sara-phone'), JSON.stringify(still));

  // ── A guest can come back ──
  const omar = 'hdsignal-test-guest';
  ctx.employeeSessions.set(omar, { id: 3, name: 'Omar', username: 'omar', job_title: '', permissions: normEmpPerms({ chat: true }) });
  const omarSig = body => fetch(base + '/api/employee/chat/huddle/signal', {
    method: 'POST', headers: { Authorization: 'Bearer ' + omar, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json().then(j => ({ status: r.status, ...j })));
  await adminSig({ roomId: 1, type: 'invite', to: 'employee_3' });            // pulled in from outside the room
  const g1 = await omarSig({ roomId: 1, type: 'join', data: { sid: 'omar1' } });
  await omarSig({ roomId: 1, type: 'leave', data: { sid: 'omar1' } });        // his tab reloads (pagehide beacon)
  const g2 = await omarSig({ roomId: 1, type: 'join', data: { sid: 'omar2' } });
  check('a guest who reloads can rejoin while the huddle runs', g1.ok === true && g2.status === 200 && g2.ok === true, JSON.stringify([g1.status, g2.status, g2.error]));
  await omarSig({ roomId: 1, type: 'leave', data: { sid: 'omar2' } });

  // ── A closing tab's beacon: no Authorization header, the token in the URL ──
  await saraSig({ roomId: 1, type: 'join', data: { sid: 'sara2' } });
  const beacon = await fetch(base + '/api/employee/chat/huddle/signal?_t=' + emp, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: 1, type: 'leave', data: { sid: 'sara2' } }),
  });
  const live = await fetch(base + '/api/dashboard/chat/huddle/1', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json());
  check('a pagehide beacon takes the closing tab out of the call',
    beacon.status === 200 && !live.participants.some(p => p.key === 'employee_2'), JSON.stringify(live));
  check('the roster read names the server process too', live.boot === j1.boot);

  // ── Tabs on the previous bundle: never ping, never leave on unload ──
  // Their entries used to stay until the next restart, advertising a huddle nobody
  // was in. Each case starts from an empty call. The clock is moved by replacing
  // Date.now for the duration of a request, so the server stamps it as if later.
  await adminSig({ roomId: 1, type: 'leave' });
  adminOld.close();
  const realNow = Date.now;
  const at = async (offset, fn) => { Date.now = () => realNow() + offset; try { return await fn(); } finally { Date.now = realNow; } };
  const sweepAt = offset => ctx.huddleSweep(realNow() + offset);
  const rosterNow = async () => (await fetch(base + '/api/dashboard/chat/huddle/1', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())).participants.map(p => p.key).sort().join();
  // Sara on this bundle, pinging every 15 s like a live tab, reporting who she reaches.
  const pingsBy = sig => async (from, to, connected) => { for (let t = from; t <= to; t += 15_000) await at(t, () => sig({ roomId: 1, type: 'alive', data: { connected } })); };
  const pings = pingsBy(saraSig);
  const emptyCall = async () => {
    for (const k of (await rosterNow()).split(',').filter(Boolean)) {
      if (k === 'admin') await adminSig({ roomId: 1, type: 'leave' });
      if (k === 'employee_2') await saraSig({ roomId: 1, type: 'leave' });
      if (k === 'employee_3') await omarSig({ roomId: 1, type: 'leave' });
    }
  };
  const leftFrames = who => sigFrames(saraNotif).filter(f => f.json.type === 'roster' && f.json.left === who);
  const { token: token2 } = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();
  const omarOldPath = '/api/employee/notifications/stream?_t=' + omar;

  // 1. Its tab closes. Three minutes' grace — the previous bundle's own reconnect
  //    backoff can leave a live tab without a stream for over a minute and a half.
  //    Another login's old tab, and a tab of its own login on this bundle (the
  //    reload), don't keep it.
  {
    const oldA = await openStream(adminOldPath);
    const elsewhere = await openStream('/api/dashboard/notifications/stream?_t=' + token2);
    await at(-600_000, () => adminSig({ roomId: 1, type: 'join' }));   // in the call 10 minutes already
    oldA.close();
    const reloaded = await openStream(adminOldPath + '&hd=2');
    await wait(150);
    saraNotif.frames.length = 0;
    await sweepAt(170_000);
    check('a tab on the previous bundle closes: kept for 3 minutes from the closing, not from its join', (await rosterNow()) === 'admin', await rosterNow());
    await sweepAt(181_000);
    await wait(100);
    check("…then dropped, whatever another login's old tab or its own reloaded one is doing",
      (await rosterNow()) === '' && leftFrames('admin').length === 1 && leftFrames('admin')[0].json.swept === true, await rosterNow());
    elsewhere.close(); reloaded.close();
  }

  // 2. Its tab stays open, and a participant on this bundle never reaches it — a closed
  //    tab whose login keeps another old tab open, or a live one away from its Chat
  //    page, which is all that bundle listens on. Ten minutes, so the live one has time
  //    to come back.
  {
    const oldC = await openStream(adminOldPath);
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w1' } });
    await pings(0, 585_000, []);
    await sweepAt(590_000);
    check('…a participant who has watched for less than 10 minutes is not yet a witness', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(600_000, 600_000, []);
    saraNotif.frames.length = 0;
    await sweepAt(605_000);
    await wait(100);
    check('…after 10 minutes of pings that never report reaching it, it is dropped', (await rosterNow()) === 'employee_2' && leftFrames('admin').length === 1, await rosterNow());
    // Somebody who is not in the call has no say.
    await saraSig({ roomId: 1, type: 'invite', to: 'employee_3' });
    await at(610_000, () => omarSig({ roomId: 1, type: 'alive', data: { connected: ['admin'] } }));
    check('…a report from someone not in the call puts nothing back', (await rosterNow()) === 'employee_2', await rosterNow());
    // It was there after all: a peer reports a working connection to it.
    saraNotif.frames.length = 0;
    await at(615_000, () => saraSig({ roomId: 1, type: 'alive', data: { connected: ['admin'] } }));
    await wait(100);
    check('…a peer reporting a working connection to it puts it back, and says so',
      (await rosterNow()) === 'admin,employee_2' && sigFrames(saraNotif).some(f => f.json.type === 'roster' && f.json.participants.some(p => p.key === 'admin')), await rosterNow());
    // Reached, then quiet for a few minutes: a network dropout or a look at another
    // page looks just the same, and a call that is kept heals when it is back.
    await pings(630_000, 800_000, []);
    await sweepAt(805_000);
    check('…once reached, going quiet for a few minutes is no reason', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    // Its tab closes: three minutes later, it goes.
    await at(810_000, async () => { oldC.close(); await wait(150); });
    await pings(820_000, 985_000, []);
    await sweepAt(988_000);
    check('…its tab closes: still listed 3 minutes on, less a few seconds', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(1_000_000, 1_000_000, []);
    await sweepAt(1_000_000);
    check('…and gone once they are up', (await rosterNow()) === 'employee_2', await rosterNow());
    await emptyCall();
  }

  // 3. A long call of old tabs only, and one of them reloads onto this bundle.
  {
    const oldD = await openStream(adminOldPath);
    const omarOld = await openStream(omarOldPath);
    const saraOld = await openStream('/api/employee/notifications/stream?_t=' + emp);
    const adminChat = { frames: [], write(s) { this.frames.push(s); } };   // the admin's old tab, on its Chat page
    ctx.chatSseClients.set('admin', adminChat);
    await adminSig({ roomId: 1, type: 'invite', to: 'employee_3' });
    await at(-1_200_000, () => adminSig({ roomId: 1, type: 'join' }));
    await at(-1_200_000, () => omarSig({ roomId: 1, type: 'join' }));
    await at(-1_200_000, () => saraSig({ roomId: 1, type: 'join' }));   // Sara too, on an old tab
    await sweepAt(0);
    check('a call of old tabs only, 20 minutes in, is left alone', (await rosterNow()) === 'admin,employee_2,employee_3', await rosterNow());
    saraOld.close();                                                   // Sara reloads onto this bundle…
    adminChat.frames.length = 0;
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'reloaded' } });   // …and takes her old place
    // The admin's old tab still holds its connection to Sara's old page and would never
    // dial her new one. It is shown a roster without her first, then the real one.
    const legacyRosters = adminChat.frames.filter(f => /^event: huddle\n/.test(f) && f.includes('"roster"'))
      .map(f => JSON.parse(f.slice(f.indexOf('data: ') + 6)));
    check('…the old tabs are shown a roster without the reloaded person, then with them',
      legacyRosters.length === 2 && legacyRosters[0].left === 'employee_2' && !legacyRosters[0].participants.some(p => p.key === 'employee_2')
        && legacyRosters[1].participants.some(p => p.key === 'employee_2'), JSON.stringify(legacyRosters.map(r => [r.left, r.joined, r.participants.map(p => p.key)])));
    await pings(0, 0, []);
    await sweepAt(5_000);
    check('…the reloaded page is not a witness against the others straight away', (await rosterNow()) === 'admin,employee_2,employee_3', await rosterNow());
    await pings(15_000, 700_000, []);
    await sweepAt(705_000);
    check('…nor ever, while two old tabs that may be talking to each other are in the call',
      (await rosterNow()) === 'admin,employee_2,employee_3', await rosterNow());
    ctx.chatSseClients.delete('admin');
    await emptyCall();
    oldD.close(); omarOld.close();
  }

  // 4. Alone in the call with its tab open: may be a real person waiting. Kept.
  {
    const oldE = await openStream(adminOldPath);
    await at(-3_600_000, () => adminSig({ roomId: 1, type: 'join' }));
    await sweepAt(0);
    check('an old tab alone in the call, its tab open, is kept however long', (await rosterNow()) === 'admin', await rosterNow());
    await emptyCall();
    oldE.close();
  }

  // 5. The same person joins again from another old tab while their first entry is
  //    still listed — another device, or another tab of the same browser: someone
  //    new behind the key, so a fresh 10 minutes before anyone's silence counts.
  {
    const oldF = await openStream(adminOldPath);
    const oldG = await openStream('/api/dashboard/notifications/stream?_t=' + token2);
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w5' } });
    await pings(0, 585_000, []);
    await at(590_000, () => fetch(base + '/api/dashboard/chat/huddle/signal', { method: 'POST',
      headers: { Authorization: 'Bearer ' + token2, 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: 1, type: 'join' }) }));
    await pings(600_000, 600_000, []);
    await sweepAt(610_000);
    check('a rejoin from another old device starts its own 10 minutes', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await emptyCall();
    oldF.close(); oldG.close();
  }
  {
    const t1 = await openStream(adminOldPath), t2 = await openStream(adminOldPath);   // two tabs, one browser
    await adminSig({ roomId: 1, type: 'join' });                                     // from the first
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w5b' } });
    await pings(0, 30_000, ['admin']);                                              // Sara reaches it
    await at(35_000, async () => { t1.close(); await wait(150); });                 // the first tab closes
    await pings(45_000, 585_000, []);
    await at(590_000, () => adminSig({ roomId: 1, type: 'join' }));                // the second tab joins
    await pings(600_000, 600_000, []);
    await sweepAt(610_000);
    check('…likewise from another old tab of the same login, whose first was reached', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(615_000, 1_185_000, []);
    await sweepAt(1_188_000);
    check('…which is not a witness against it before its own 10 minutes are up', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(1_200_000, 1_200_000, []);
    await sweepAt(1_200_000);
    check('…and if nobody reaches it in them, it goes', (await rosterNow()) === 'employee_2', await rosterNow());
    await emptyCall();
    t2.close();
  }

  // 6. A working connection reported keeps it, even with no old tab on its login — its
  //    stream may have come back under a new login after the person signed in again.
  {
    await adminSig({ roomId: 1, type: 'join' });   // no stream of the previous bundle on this login
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w6' } });
    await pings(0, 210_000, ['admin']);
    await sweepAt(215_000);
    check('a peer reporting a working connection keeps it, whatever its streams', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(225_000, 300_000, []);
    await sweepAt(305_000);
    check('…and once nobody has for 90 s, with no tab on its login, it goes', (await rosterNow()) === 'employee_2', await rosterNow());
    await emptyCall();
  }

  // 6b. Its tab open, reached for five minutes and then not: the ten minutes run from
  //     the last report, not from when it joined.
  {
    const oldJ = await openStream(adminOldPath);
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w6b' } });
    await pings(0, 300_000, ['admin']);
    await pings(315_000, 885_000, []);
    await sweepAt(890_000);
    check('reached for five minutes, then not: kept for 10 minutes from the last report', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(900_000, 915_000, []);
    await sweepAt(915_000);
    check('…and gone once they are up', (await rosterNow()) === 'employee_2', await rosterNow());
    await emptyCall();
    oldJ.close();
  }

  // 7. The countdown runs from whoever has watched longest: a newcomer doesn't restart it.
  {
    const oldH = await openStream(adminOldPath);
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w7' } });
    await saraSig({ roomId: 1, type: 'invite', to: 'employee_3' });
    await pings(0, 540_000, []);
    await at(550_000, () => omarSig({ roomId: 1, type: 'join', data: { sid: 'o7' } }));   // Omar, on this bundle
    await pings(555_000, 600_000, []);
    await at(585_000, () => omarSig({ roomId: 1, type: 'alive', data: { connected: [] } }));
    await sweepAt(605_000);
    check('a newcomer does not restart the countdown', (await rosterNow()) === 'employee_2,employee_3', await rosterNow());
    await emptyCall();
    oldH.close();
  }

  // 8. A witness back from a silence of its own (its network dropped, its lid shut)
  //    starts watching afresh: its gap is no evidence against anyone.
  {
    const oldK = await openStream(adminOldPath);
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w8' } });
    await pings(0, 540_000, []);
    await pings(625_000, 625_000, []);                    // 85 s without a ping, then back
    await sweepAt(630_000);
    check('a peer back from a silence is not a witness until it has watched 10 minutes again', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(640_000, 1_215_000, []);
    await sweepAt(1_220_000);
    check('…nor a few seconds before', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(1_230_000, 1_230_000, []);
    await sweepAt(1_230_000);
    check('…and once it has, it is', (await rosterNow()) === 'employee_2', await rosterNow());
    await emptyCall();
    oldK.close();
  }

  // 9. Reached once, then its tab closed while another old tab on the same login stays
  //    open: the streams can't tell the two apart. Someone who joins later and never
  //    reaches it is a witness all the same — the old report counts for nothing then.
  {
    const omarPings = pingsBy(omarSig);
    const t1 = await openStream(adminOldPath), t2 = await openStream(adminOldPath);
    await adminSig({ roomId: 1, type: 'join' });                                     // from t1
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w9' } });
    await pings(0, 60_000, ['admin']);                                              // Sara reaches it
    await at(65_000, async () => { t1.close(); await wait(150); });                 // t1 closes, t2 stays
    await pings(75_000, 120_000, []);
    await at(125_000, () => saraSig({ roomId: 1, type: 'leave', data: { sid: 'w9' } }));
    await sweepAt(130_000);
    check('reached, then closed with a twin tab open: alone in the call, it is left alone', (await rosterNow()) === 'admin', await rosterNow());
    await adminSig({ roomId: 1, type: 'invite', to: 'employee_3' });
    await at(200_000, () => omarSig({ roomId: 1, type: 'join', data: { sid: 'o9' } }));
    await omarPings(205_000, 790_000, []);
    await sweepAt(795_000);
    check('…a newcomer who never reaches it is a witness after 10 minutes, not before', (await rosterNow()) === 'admin,employee_3', await rosterNow());
    await omarPings(805_000, 805_000, []);
    await sweepAt(805_000);
    check('…and then it goes', (await rosterNow()) === 'employee_3', await rosterNow());
    await omarSig({ roomId: 1, type: 'leave', data: { sid: 'o9' } });
    await emptyCall();
    t2.close();
  }

  // 10. A participant on this bundle reloads: the new page has watched nothing yet,
  //     whatever the old one had.
  {
    const oldM = await openStream(adminOldPath);
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w10a' } });
    await pings(0, 540_000, []);
    await at(545_000, () => saraSig({ roomId: 1, type: 'join', data: { sid: 'w10b' } }));   // her page reloads
    await pings(555_000, 630_000, []);
    await sweepAt(635_000);
    check('a reloaded page is a witness only once it has watched 10 minutes itself', (await rosterNow()) === 'admin,employee_2', await rosterNow());
    await pings(645_000, 1_150_000, []);
    await sweepAt(1_150_000);
    check('…which it then is', (await rosterNow()) === 'employee_2', await rosterNow());
    await emptyCall();
    oldM.close();
  }

  // 11. A report of a working connection puts a dropped old tab back only into a call
  //     with room for it.
  {
    const oldP = await openStream(adminOldPath);
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w11' } });
    await pings(0, 600_000, []);
    await sweepAt(605_000);
    const guests = [4, 5, 6, 7, 8].map(id => {
      const tok = 'hdsignal-test-guest-' + id;
      ctx.employeeSessions.set(tok, { id, name: 'Guest ' + id, username: 'g' + id, job_title: '', permissions: normEmpPerms({ chat: true }) });
      return body => fetch(base + '/api/employee/chat/huddle/signal', { method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    });
    for (const [i, g] of guests.entries()) {
      await saraSig({ roomId: 1, type: 'invite', to: 'employee_' + (4 + i) });
      await at(606_000, () => g({ roomId: 1, type: 'join', data: { sid: 'g11-' + i } }));
    }
    await at(610_000, () => saraSig({ roomId: 1, type: 'alive', data: { connected: ['admin'] } }));
    const full = (await rosterNow()).split(',');
    check('a dropped old tab is not put back into a full call', full.length === 6 && !full.includes('admin'), full.join());
    await at(612_000, () => guests[4]({ roomId: 1, type: 'leave', data: { sid: 'g11-4' } }));
    await at(615_000, () => saraSig({ roomId: 1, type: 'alive', data: { connected: ['admin'] } }));
    check('…and is once there is room', (await rosterNow()).split(',').includes('admin'), await rosterNow());
    for (const g of guests) await g({ roomId: 1, type: 'leave' });
    await emptyCall();
    oldP.close();
  }

  // 12. Old tabs are shown a roster without someone only when a new page takes their
  //     place: not when the same page puts itself back, nor on a rejoin after a restart.
  {
    const adminChat = { frames: [], write(s) { this.frames.push(s); } };   // the admin's old tab, on its Chat page
    ctx.chatSseClients.set('admin', adminChat);
    const oldQ = await openStream(adminOldPath);
    const legacyRosters = () => adminChat.frames.filter(f => /^event: huddle\n/.test(f) && f.includes('"roster"'))
      .map(f => JSON.parse(f.slice(f.indexOf('data: ') + 6)));
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w12' } });
    adminChat.frames.length = 0;
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w12' } });
    check('the same page putting itself back shows old tabs no roster without it',
      legacyRosters().length === 1 && !legacyRosters()[0].left, JSON.stringify(legacyRosters().map(r => [r.left, r.joined])));
    adminChat.frames.length = 0;
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'w12-laptop', afterRestart: true } });
    check('…nor does another of her pages rejoining after a restart (a partial roster would hang them up)',
      legacyRosters().length === 0, JSON.stringify(legacyRosters().map(r => [r.left, r.joined])));
    ctx.chatSseClients.delete('admin');
    await emptyCall();
    oldQ.close();
  }

  // 13. Someone moves their call from a page on this bundle to a tab still on the
  //     previous one, which takes the place without a sid. The page must step aside —
  //     and not take the place back when its stream reopens, which would turn the old
  //     tabs in the call away from where the person now is.
  {
    const adminChat = { frames: [], write(s) { this.frames.push(s); } };
    ctx.chatSseClients.set('admin', adminChat);
    const oldR = await openStream(adminOldPath);
    const rosterRead = async () => (await fetch(base + '/api/dashboard/chat/huddle/1', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())).participants;
    await adminSig({ roomId: 1, type: 'join' });
    await saraSig({ roomId: 1, type: 'join', data: { sid: 'phone' } });   // Sara, on her phone
    saraNotif.frames.length = 0;
    await saraSig({ roomId: 1, type: 'join' });                            // then from her laptop's old tab
    await wait(100);
    const jf = sigFrames(saraNotif).filter(f => f.json.type === 'roster' && f.json.joined === 'employee_2').slice(-1)[0];
    check('a tab on the previous bundle taking a page\'s place names the page it took it from',
      !!jf && jf.json.displaced === 'phone', JSON.stringify(jf && jf.json));
    const ping = await saraSig({ roomId: 1, type: 'alive', data: { connected: [] } });
    check('…and the page\'s ping is answered with a sid that is not its own',
      ping.inCall === true && typeof ping.sid === 'string' && ping.sid !== 'phone', JSON.stringify(ping));
    adminChat.frames.length = 0;
    saraNotif.frames.length = 0;
    const back = await saraSig({ roomId: 1, type: 'join', data: { sid: 'phone' } });   // its stream reopened: it tries to rejoin
    await wait(100);
    const me = (back.participants || []).find(p => p.key === 'employee_2');
    const held = (await rosterRead()).find(p => p.key === 'employee_2');
    check('…its rejoin is told to step aside, and changes nothing',
      back.superseded === true && !!me && !!me.sid && me.sid !== 'phone' && !!held && !held.sid
        && adminChat.frames.length === 0 && sigFrames(saraNotif).length === 0, JSON.stringify({ back, held, old: adminChat.frames.length }));
    const fresh = await saraSig({ roomId: 1, type: 'join', data: { sid: 'phone2' } });   // she joins again on her phone
    check('…while a fresh page of hers takes it back as usual',
      fresh.ok === true && !fresh.superseded && (await rosterRead()).some(p => p.key === 'employee_2' && p.sid === 'phone2'), JSON.stringify(fresh));
    ctx.chatSseClients.delete('admin');
    await emptyCall();
    oldR.close();
  }

  // Each stream is counted once, however often it is added or removed.
  {
    const tagX = 'test-idempotence';
    const r1 = { hdLegacy: true, hdTag: tagX, write() {} }, r2 = { hdLegacy: true, hdTag: tagX, write() {} };
    ctx.notifAdd('employee_9', r1); ctx.notifAdd('employee_9', r1); ctx.notifAdd('employee_9', r2);
    const both = ctx.notifLegacyState(tagX).open;
    ctx.notifRemove('employee_9', r1); ctx.notifRemove('employee_9', r1);
    check('a stream is counted once, however often it is added or removed',
      both === 2 && ctx.notifLegacyState(tagX).open === 1, JSON.stringify([both, ctx.notifLegacyState(tagX)]));
    ctx.notifRemove('employee_9', r2);
    // Its closing time is kept as long as the sweep can need it, then forgotten.
    ctx.notifLegacyPrune(Date.now() + 9 * 60_000);
    const kept = ctx.notifLegacyState(tagX).closedAt > 0;
    ctx.notifLegacyPrune(Date.now() + 11 * 60_000);
    check("a login's last-closed time is forgotten once no sweep can need it",
      kept && ctx.notifLegacyState(tagX).closedAt === 0, JSON.stringify(ctx.notifLegacyState(tagX)));
  }

  // ── A stream abandoned while its login was being checked ──
  // After a restart, checking a login is a Supabase round trip. A tab closed in that
  // window had its 'close' fire before the stream was registered; registered anyway,
  // it would count as an open old tab for that login until the next restart.
  const slowTag = require('crypto').createHash('sha256').update('slow-admin-tok').digest('hex').slice(0, 16);
  await new Promise(resolve => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/api/dashboard/notifications/stream?_t=slow-admin-tok' }, () => {});
    r.on('error', () => {});
    setTimeout(() => { r.destroy(); resolve(); }, 100);
  });
  await wait(700);
  check('a stream whose tab went during the login check is not left counted as open',
    ctx.notifLegacyState(slowTag).open === 0, JSON.stringify(ctx.notifLegacyState(slowTag)));
  saraNotif.close();

  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} huddle signalling checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}, 1500);
