// Group administration + huddles
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { chatBroadcast, chatCallerIdentity, crypto, express, multer, path, receiver, requireAuth, requireEmployeeAuth, supabase, upload } = ctx.need('chatBroadcast', 'chatCallerIdentity', 'crypto', 'express', 'multer', 'path', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase', 'upload');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const chatDeleteMsg = (...a) => ctx.chatDeleteMsg(...a);
const chatEditMsg = (...a) => ctx.chatEditMsg(...a);
const chatGetMessages = (...a) => ctx.chatGetMessages(...a);
const chatPeopleKeys = (...a) => ctx.chatPeopleKeys(...a);
const chatSendMessage = (...a) => ctx.chatSendMessage(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);

// ─── Group administration + huddles ───────────────────────────────────────────
// Admin may manage any group; an employee may manage groups they created.
// Direct rooms are never manageable.
async function chatCanManage(roomId, callerKey) {
  const { data: room } = await supabase.from('chat_rooms').select('id,type,created_by').eq('id', roomId).single();
  if (!room || room.type !== 'group') return null;
  if (callerKey !== 'admin' && room.created_by !== callerKey) return null;
  return room;
}
async function chatRoomMemberKeys(roomId) {
  const { data } = await supabase.from('chat_room_members').select('member_key').eq('room_id', roomId);
  return (data || []).map(m => m.member_key);
}

// Huddle signalling checks membership on every frame, and one call is dozens of
// frames — each ICE candidate is its own POST — so a Supabase round trip apiece
// (300–700 ms in production) held every candidate back. It reads from a short cache
// instead; every membership change in this module drops the room's entry first.
const HUDDLE_MEMBERS_TTL = 30_000;
const huddleMemberCache = new Map();   // roomId -> { keys, at }
async function huddleRoomMembers(roomId) {
  const hit = huddleMemberCache.get(roomId);
  if (hit && Date.now() - hit.at < HUDDLE_MEMBERS_TTL) return hit.keys;
  const keys = await chatRoomMemberKeys(roomId);
  if (keys.length) huddleMemberCache.set(roomId, { keys, at: Date.now() });   // never cache "nobody"
  return keys;
}
function huddleMembersChanged(roomId) { huddleMemberCache.delete(roomId); }

// One huddle frame to these members, sent two ways for now. This bundle listens on
// the notification stream ('huddle-signal'), which is open on every page and replays
// what a reconnect missed. Tabs still running the previous bundle listen on the chat
// stream ('huddle') — staff keep tabs open all day, and a call between an old tab and
// a new one must still connect. Each side hears exactly one of the two. Drop the chat
// copy once the old bundle is gone.
function huddleEmit(keys, payload) {
  ctx.huddleSignalSend(keys, payload);
  chatBroadcast(keys, 'huddle', payload);
}

function mountChatAdminRoutes(base, guard) {
  // Rename a group
  receiver.router.put(`${base}/rooms/:id`, guard, express.json(), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.id);
    if (!(await chatCanManage(roomId, key))) return res.status(403).json({ error: 'Not allowed' });
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('chat_rooms').update({ name, updated_at: new Date().toISOString() }).eq('id', roomId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    chatBroadcast(await chatRoomMemberKeys(roomId), 'room', { roomId, room: data });
    res.json(data);
  });

  // Put a conversation away, or take it off my list. Per MEMBER — the other side
  // keeps the conversation exactly as it was, which is the point of asking.
  // Hiding is not deleting: the messages stay, and a newer one brings it back.
  receiver.router.post(`${base}/rooms/:id/state`, guard, express.json(), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.id);
    const members = await chatRoomMemberKeys(roomId);
    if (!members.includes(key)) return res.status(403).json({ error: 'Not a member' });
    const patch = {};
    const now = new Date().toISOString();
    if ('archived' in (req.body || {})) patch.archived_at = req.body.archived ? now : null;
    if ('hidden' in (req.body || {}))   patch.hidden_at   = req.body.hidden ? now : null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'archived or hidden required' });
    const { error } = await supabase.from('chat_room_members')
      .update(patch).eq('room_id', roomId).eq('member_key', key);
    // The columns arrive with migration 015; say so rather than 500-ing.
    if (error) {
      const missing = /archived_at|hidden_at/.test(String(error.message || ''));
      return res.status(missing ? 409 : 500).json({
        error: missing ? 'Archiving needs migrations/015_chat_room_state.sql applied first.' : error.message });
    }
    res.json({ ok: true, ...patch });
  });

  // The group's icon — an emoji everyone in it sees. Set, changed or cleared by
  // whoever may manage the group.
  receiver.router.put(`${base}/rooms/:id/icon`, guard, express.json(), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.id);
    if (!(await chatCanManage(roomId, key))) return res.status(403).json({ error: 'Not allowed' });
    // Two characters of emoji at most: this is a badge, not a nickname.
    const icon = [...String(req.body?.icon || '').trim()].slice(0, 2).join('');
    const { data, error } = await supabase.from('chat_rooms')
      .update({ icon, updated_at: new Date().toISOString() }).eq('id', roomId).select().single();
    if (error) {
      const missing = /icon/.test(String(error.message || ''));
      return res.status(missing ? 409 : 500).json({
        error: missing ? 'Group icons need migrations/015_chat_room_state.sql applied first.' : error.message });
    }
    chatBroadcast(await chatRoomMemberKeys(roomId), 'room', { roomId, room: data });
    res.json(data);
  });

  // Add members
  receiver.router.post(`${base}/rooms/:id/members`, guard, express.json(), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.id);
    if (!(await chatCanManage(roomId, key))) return res.status(403).json({ error: 'Not allowed' });
    const keys = (Array.isArray(req.body?.memberKeys) ? req.body.memberKeys : []).map(String).filter(Boolean);
    if (!keys.length) return res.status(400).json({ error: 'memberKeys[] required' });
    const existing = new Set(await chatRoomMemberKeys(roomId));
    const empIds = keys.filter(k => k.startsWith('employee_')).map(k => parseInt(k.slice(9))).filter(n => !isNaN(n));
    const { data: emps } = await supabase.from('employees').select('id,name').in('id', empIds);
    const nameOf = k => k === 'admin' ? 'Admin'
      : ((emps || []).find(e => e.id === parseInt(k.slice(9))) || {}).name || k;
    const rows = keys.filter(k => !existing.has(k)).map(k => ({ room_id: roomId, member_key: k, member_name: nameOf(k) }));
    if (rows.length) {
      const { error } = await supabase.from('chat_room_members').insert(rows);
      if (error) return res.status(500).json({ error: error.message });
      huddleMembersChanged(roomId);
    }
    chatBroadcast(await chatRoomMemberKeys(roomId), 'room', { roomId });
    res.json({ ok: true, added: rows.length });
  });

  // Remove a member
  receiver.router.delete(`${base}/rooms/:id/members/:memberKey`, guard, async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.id);
    if (!(await chatCanManage(roomId, key))) return res.status(403).json({ error: 'Not allowed' });
    const target = String(req.params.memberKey);
    const before = await chatRoomMemberKeys(roomId);
    if (before.length <= 1) return res.status(400).json({ error: 'A group needs at least one member' });
    const { error } = await supabase.from('chat_room_members').delete().eq('room_id', roomId).eq('member_key', target);
    if (error) return res.status(500).json({ error: error.message });
    huddleMembersChanged(roomId);
    chatBroadcast(before, 'room', { roomId });   // tell the removed member too
    res.json({ ok: true });
  });

  // Everything shared in this room
  receiver.router.get(`${base}/rooms/:id/attachments`, guard, async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.id);
    const member = (await chatRoomMemberKeys(roomId)).includes(key);
    if (!member) return res.status(403).json({ error: 'Not a member of this room' });
    const { data, error } = await supabase.from('chat_messages')
      .select('id,sender_name,file_url,file_name,file_size,file_type,created_at')
      .eq('room_id', roomId).not('file_url', 'is', null)
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // ── Huddles ──────────────────────────────────────────────────────────────
  // WebRTC signalling is relayed peer to peer over the notification stream (see
  // huddleEmit). Roster is in-memory: a restart forgets it, and the clients, whose
  // calls carry on peer to peer, notice the new HUDDLE_BOOT and rejoin.
  // A refresh drops you out of the call without telling anybody's page. This is
  // how a freshly-loaded portal finds the huddle it was just in and offers it
  // back, instead of leaving people to guess whether one is still running.
  receiver.router.get(`${base}/huddle/live`, guard, requirePerm('chat', 'huddle'), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const live = [];
    for (const roomId of huddles.keys()) {
      const members = await huddleRoomMembers(roomId);
      if (!huddleMaySignal(roomId, key, members)) continue;
      live.push({ roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
    }
    res.json(live);
  });

  receiver.router.get(`${base}/huddle/ice`, guard, requirePerm('chat', 'huddle'), async (_req, res) => {
    res.json(await huddleIceConfig());
  });

  receiver.router.get(`${base}/huddle/:roomId`, guard, requirePerm('chat', 'huddle'), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.roomId);
    if (!huddleMaySignal(roomId, key, await huddleRoomMembers(roomId))) return res.status(403).json({ error: 'Not a member' });
    res.json({ boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
  });

  receiver.router.post(`${base}/huddle/signal`, guard, requirePerm('chat', 'huddle'), express.json({ limit: '256kb' }), async (req, res) => {
    const { key, name } = chatCallerIdentity(req);
    const roomId = parseInt(req.body?.roomId);
    const type = String(req.body?.type || '');
    if (!roomId || !HUDDLE_TYPES.includes(type)) return res.status(400).json({ error: 'bad signal' });
    const members = await huddleRoomMembers(roomId);
    if (!huddleMaySignal(roomId, key, members)) return res.status(403).json({ error: 'Not a member' });

    if (type === 'join') {
      const set = huddles.get(roomId) || new Map();
      if (set.size >= HUDDLE_MAX && !set.has(key)) return res.status(409).json({ error: 'Huddle is full', max: HUDDLE_MAX });
      const rawSid = req.body?.data?.sid;
      const sid = typeof rawSid === 'string' && rawSid ? rawSid.slice(0, 40) : null;
      const tag = ctx.notifTokenTag(req);
      // The same page putting itself back keeps its place in time. Anything else is
      // someone new behind the key — another page, device or tab — and starts its
      // clocks afresh. A join without a sid always is: the previous bundle refuses to
      // join a call it is already in, so it comes from a different tab.
      const existed = set.has(key);
      const same = existed && !!sid && sid === (huddleSids.get(roomId) || new Map()).get(key);
      // Tabs on the previous bundle keep their connection to whatever was behind this
      // key before — a reloaded page, a closed tab — and, seeing the key still listed,
      // never dial it again: whoever replaced it is never reached. Show them a roster
      // without it first, which makes them drop that connection, then the real one,
      // from which they dial afresh. (Only they read the chat stream's 'huddle'.)
      if (existed && !same) {
        const without = [...set.entries()].filter(([k]) => k !== key).map(([k, n]) => ({ key: k, name: n }));
        chatBroadcast(huddleAudience(roomId, members), 'huddle', { type: 'roster', roomId, participants: without, started_at: huddleStartedAt(roomId), left: key });
      }
      set.set(key, name);
      huddles.set(roomId, set);
      if (!huddleStarted.has(roomId)) huddleStarted.set(roomId, Date.now());
      huddleEnroll(roomId, key, sid);
      huddleNoteJoin(roomId, key, sid ? null : tag, same);
      const frame = { type: 'roster', roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId), joined: key };
      // A client putting itself back after a restart: the roster is only partly rebuilt.
      // The previous bundle prunes everyone a roster doesn't list, so tabs still on it
      // would hang up on each other — tell only the current bundle, which knows better.
      if (req.body?.data?.afterRestart === true) ctx.huddleSignalSend(huddleAudience(roomId, members), frame);
      else huddleEmit(huddleAudience(roomId, members), frame);
      return res.json({ ok: true, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
    }
    if (type === 'leave') {
      // From a page that has since been replaced by this person's other tab or
      // device (its pagehide beacon, say): that page is not in the call any more,
      // and removing the key would hang up the one that is.
      const lsid = req.body?.data?.sid;
      const cur = (huddleSids.get(roomId) || new Map()).get(key);
      if (typeof lsid === 'string' && lsid && cur && lsid !== cur) return res.json({ ok: true, ignored: 'superseded' });
      huddleRemove(roomId, key);
      huddleEmit(huddleAudience(roomId, members), { type: 'roster', roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId), left: key });
      return res.json({ ok: true });
    }
    const inCall = (huddles.get(roomId) || new Map()).has(key);
    if (inCall) huddleTouch(roomId, key);
    // Who this participant has a working connection to. It is how a participant on
    // the previous bundle, which can't speak for itself, is known to be really there.
    if (type === 'alive' && inCall && Array.isArray(req.body?.data?.connected)) {
      const back = huddleVouch(roomId, req.body.data.connected);
      if (back.length) huddleEmit(huddleAudience(roomId, members), { type: 'roster', roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
    }
    // The client's 15-second "still here". Answering whether we still count it in the
    // call lets a tab the sweep dropped (asleep, throttled) notice and rejoin — and the
    // sid lets a tab that this person's other device took over notice and step aside.
    if (type === 'alive') return res.json({ ok: true, inCall, boot: HUDDLE_BOOT, sid: (huddleSids.get(roomId) || new Map()).get(key) || null });
    // invite/offer/answer/ice/decline/media/restart are point-to-point
    const to = String(req.body?.to || '');
    // Nobody already in the call needs ringing — it used to push them a "started a
    // huddle" notification every time anyone joined or rejoined. Only someone known to
    // be there, though: an entry from the previous bundle has no sid, is never swept,
    // and may be the ghost of a tab closed long ago. Ring those as before.
    if (type === 'invite' && (huddleSids.get(roomId) || new Map()).has(to)) return res.json({ ok: true, skipped: 'already in the huddle' });
    if (type === 'invite' && !members.includes(to)) {
      // Pulling in someone from the wider workspace: grant them this huddle only
      const people = await chatPeopleKeys();
      if (!people.includes(to)) return res.status(400).json({ error: 'unknown person' });
      if (!huddleGuests.has(roomId)) huddleGuests.set(roomId, new Set());
      huddleGuests.get(roomId).add(to);
    } else if (!huddleMaySignal(roomId, to, members)) {
      return res.status(400).json({ error: 'target not in this huddle' });
    }
    huddleEmit([to], { type, roomId, from: key, fromName: name, data: req.body?.data ?? null });

    // An invite also has to reach someone who is offline: createNotification persists
    // it and pushes it. The previous bundle rang from a plain 'huddle' event on the
    // notification stream, so that goes out too until those tabs are gone.
    if (type === 'invite') {
      ctx.notifWrite(to, `event: huddle\ndata: ${JSON.stringify({ type, roomId, from: key, fromName: name, data: null })}\n\n`);
      const portal = to === 'admin' ? '/dashboard' : '/employee';
      ctx.createNotification(to, {
        type: 'huddle',
        title: `${name} started a huddle`,
        body: 'Tap to join the call.',
        url: `${portal}#chat`,
      }, 'always').catch(e => console.warn('[huddle] invite notification failed:', e.message));
    }
    res.json({ ok: true });
  });
}

// ── ICE configuration ─────────────────────────────────────────────────────────
// Served per request rather than baked into the HTML, so relay credentials never
// reach a browser that isn't in a huddle and can rotate without a deploy.
// Two providers, tried in this order:
//   • Cloudflare — CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_TOKEN. Cloudflare
//     refuses to mint long-lived credentials, so we ask for a short-lived pair
//     and reuse it until shortly before it expires.
//   • Static — TURN_URL / TURN_USERNAME / TURN_CREDENTIAL, for self-hosted coturn.
// With neither configured huddles still work over STUN on ordinary networks, and
// the client says a relay is needed when a call can't find a path.
const TURN_TTL = 7200;          // 2h — the client refreshes well before this
const TURN_RENEW_BEFORE = 900;  // re-mint with 15 min left so nothing expires mid-call
let _cfTurn = { at: 0, servers: null };

function iceHasRelay(servers) {
  return (servers || []).some(s => [].concat(s.urls || []).some(u => /^turns?:/i.test(String(u))));
}

async function cloudflareIceServers() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_TOKEN;
  if (!keyId || !token) return null;
  if (_cfTurn.servers && Date.now() - _cfTurn.at < (TURN_TTL - TURN_RENEW_BEFORE) * 1000) return _cfTurn.servers;
  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL }) });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
    const body = await r.json();
    // Cloudflare returns an array of entries; tolerate a bare object just in case.
    const servers = Array.isArray(body?.iceServers) ? body.iceServers : body?.iceServers ? [body.iceServers] : null;
    if (!iceHasRelay(servers)) throw new Error('response carried no turn: entry');
    _cfTurn = { at: Date.now(), servers };
    return servers;
  } catch (e) {
    console.warn('[huddle] Cloudflare TURN credentials failed:', e.message);
    // Keep serving the last good set rather than silently dropping to STUN
    return _cfTurn.servers || null;
  }
}

function staticIceServers() {
  if (!process.env.TURN_URL) return null;
  const urls = process.env.TURN_URL.split(',').map(u => u.trim()).filter(Boolean);
  if (!urls.length) return null;
  return [{
    urls,
    username: process.env.TURN_USERNAME || undefined,
    credential: process.env.TURN_CREDENTIAL || undefined,
  }];
}

async function huddleIceConfig() {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  let relay = await cloudflareIceServers();
  let provider = relay ? 'cloudflare' : 'none';
  if (!relay) {
    relay = staticIceServers();
    if (relay) provider = 'static';
  }
  if (relay) iceServers.push(...relay);
  return { iceServers, hasTurn: iceHasRelay(relay), provider, ttl: TURN_TTL, max: HUDDLE_MAX };
}

const HUDDLE_MAX = 6;   // mesh topology: every peer connects to every other
// 'restart': the answering side asks the offering side to restart ICE (only the
// lexicographically smaller key ever offers — the glare rule in huddle.js).
// 'alive': a participant's periodic "still here" (see huddleSweep).
const HUDDLE_TYPES = ['join', 'leave', 'invite', 'decline', 'offer', 'answer', 'ice', 'media', 'restart', 'alive'];
// Which server process this is. A restart forgets every roster while the calls
// themselves, peer to peer, carry on. A client that sees a different boot rejoins
// instead of reading the empty roster as "everyone left" and hanging up on them.
const HUDDLE_BOOT = Date.now().toString(36);
const huddles = new Map();   // roomId -> Map<memberKey, name>
// When each huddle began. The timer must not count from "when I joined" — three
// people in one call would read three different durations — and a page that
// reloads has to be able to say how long the thing it is offering to rejoin has
// been going. Cleared with the roster.
const huddleStarted = new Map();   // roomId -> epoch ms
// Anyone in the workspace can be pulled into a call by someone already in it.
// The grant lives only as long as the huddle and never touches chat_room_members,
// so a guest joins the call without gaining the room's message history.
const huddleGuests = new Map();   // roomId -> Set<memberKey>
function huddleAudience(roomId, members) {
  return [...new Set([...members, ...(huddleGuests.get(roomId) || [])])];
}
function huddleMaySignal(roomId, key, members) {
  return members.includes(key) || (huddleGuests.get(roomId) || new Set()).has(key);
}
function huddleRoster(roomId) {
  const set = huddles.get(roomId);
  const sids = huddleSids.get(roomId);
  return set ? [...set.entries()].map(([key, name]) => {
    const sid = sids && sids.get(key);
    return sid ? { key, name, sid } : { key, name };
  }) : [];
}
function huddleStartedAt(roomId) { return huddleStarted.get(roomId) || null; }

mountChatAdminRoutes('/api/dashboard/chat', requireAuth);
mountChatAdminRoutes('/api/employee/chat', requireEmployeeAuth);

// Leaving used to need the Leave button. A closed tab, a refresh, a laptop lid or a
// killed phone app left its owner in the roster for good — the room kept advertising
// a huddle, and the next "new" huddle there dialled the ghost and waited on it.
// Every participant now says 'alive' every 15 s (any signal counts), and anyone
// silent for 90 s is dropped and everyone told. 90 s rides out a throttled
// background tab; a closed tab usually leaves at once through its pagehide beacon.
//
// Only a client that joined with a session id is swept: that is the one that
// pings. The previous bundle, still open in tabs that haven't reloaded, never
// says 'alive' and would be cut out of a perfectly good call after 90 s.
const HUDDLE_SILENT_MS = 90_000;
const huddleSeen = new Map();   // roomId -> Map<memberKey, epoch ms>; swept keys only
// roomId -> Map<memberKey, epoch ms>: when each pinging participant's current unbroken
// run of pings began. How long someone has really been watching (see huddleLegacyGone).
const huddleStreak = new Map();
const HUDDLE_STREAK_GAP_MS = 40_000;   // pings come every 15 s; a gap this long breaks the run
// roomId -> Map<memberKey, sid>. A sid is minted per join, so a roster entry whose
// sid changed is a new page — a reload, a crash — and the connection peers still
// hold to the old one is dead whatever its state says.
const huddleSids = new Map();
function huddleEnroll(roomId, key, sid) {
  for (const m of [huddleSids, huddleSeen, huddleStreak]) if (!m.has(roomId)) m.set(roomId, new Map());
  if (sid) {
    huddleSids.get(roomId).set(key, sid);
    huddleSeen.get(roomId).set(key, Date.now());
    if (!huddleStreak.get(roomId).has(key)) huddleStreak.get(roomId).set(key, Date.now());
  } else {
    for (const m of [huddleSids, huddleSeen, huddleStreak]) m.get(roomId).delete(key);
  }
}
// When each participant joined; when a participant on this bundle last reported a
// working connection to each one; which login each previous-bundle tab joined with.
const huddleJoinedAt = new Map();   // roomId -> Map<memberKey, epoch ms>
const huddleHeard = new Map();      // roomId -> Map<memberKey, epoch ms>
const huddleLegacyTag = new Map();  // roomId -> Map<memberKey, login tag> (previous bundle only)
// Previous-bundle entries the sweep dropped lately, kept so that a peer reporting a
// working connection to one can put it back (see huddleVouch).
const huddleDroppedLegacy = new Map();   // roomId -> Map<memberKey, { name, tag, at }>
const HUDDLE_READMIT_MS = 10 * 60_000;
function huddleNoteJoin(roomId, key, legacyTag, same) {
  for (const m of [huddleJoinedAt, huddleHeard, huddleLegacyTag]) if (!m.has(roomId)) m.set(roomId, new Map());
  if (!same) {
    huddleJoinedAt.get(roomId).set(key, Date.now());
    huddleHeard.get(roomId).delete(key);
    const streak = huddleStreak.get(roomId);
    if (streak && huddleSids.get(roomId).has(key)) streak.set(key, Date.now());
  }
  if (legacyTag !== null) huddleLegacyTag.get(roomId).set(key, legacyTag);
  else huddleLegacyTag.get(roomId).delete(key);
  const dropped = huddleDroppedLegacy.get(roomId);
  if (dropped) dropped.delete(key);
}
// A participant's report of who it has a working connection to. Only keys in the call
// are recorded — and one the sweep dropped lately comes back: it was there after all.
// Returns the keys put back.
function huddleVouch(roomId, keys) {
  const set = huddles.get(roomId);
  if (!set) return [];
  if (!huddleHeard.has(roomId)) huddleHeard.set(roomId, new Map());
  const now = Date.now(), back = [];
  const dropped = huddleDroppedLegacy.get(roomId) || new Map();
  for (const k of keys.slice(0, HUDDLE_MAX)) {
    if (typeof k !== 'string') continue;
    const d = dropped.get(k);
    if (!set.has(k) && d && now - d.at <= HUDDLE_READMIT_MS && set.size < HUDDLE_MAX) {
      set.set(k, d.name);
      huddleNoteJoin(roomId, k, d.tag, false);
      back.push(k);
      console.log('[huddle] put back participant on the previous bundle', k, 'in room', roomId, '- a peer is connected to it');
    }
    if (set.has(k)) huddleHeard.get(roomId).set(k, now);
  }
  return back;
}
function huddleTouch(roomId, key) {
  const seen = huddleSeen.get(roomId);
  if (!seen || !seen.has(key)) return;
  const now = Date.now();
  const streak = huddleStreak.get(roomId);
  if (streak && (!streak.has(key) || now - seen.get(key) > HUDDLE_STREAK_GAP_MS)) streak.set(key, now);
  seen.set(key, now);
}
// A guest's grant outlives their own leaving and lasts as long as the huddle: a
// guest who reloads, or is swept while their laptop sleeps, has to be able to come
// back the way a member can.
const HUDDLE_PER_KEY = [huddleSeen, huddleStreak, huddleSids, huddleJoinedAt, huddleHeard, huddleLegacyTag];
function huddleRemove(roomId, key) {
  const set = huddles.get(roomId);
  if (set) {
    set.delete(key);
    if (!set.size) {
      for (const m of [huddles, huddleGuests, huddleStarted, huddleDroppedLegacy, ...HUDDLE_PER_KEY]) m.delete(roomId);
      return;
    }
  }
  for (const m of HUDDLE_PER_KEY) { const r = m.get(roomId); if (r) r.delete(key); }
}

// A participant on the previous bundle (no sid) never pings and never leaves: close
// its tab and it used to stay in the roster until the next restart, advertising a
// huddle nobody was in. A working connection reported by a peer on this bundle in
// the last 90 s keeps it, whatever else. Otherwise it is gone when:
//   • no tab on the previous bundle has been open on the login it joined with for
//     3 minutes. Closing or reloading the tab closes its stream (a reload comes back
//     on this bundle, whose streams don't count); 3 minutes outlasts that bundle's own
//     reconnect backoff, so a live tab riding out an outage is not mistaken for one
//     closed; or
//   • nobody has ever reached it since it joined, everyone else in the call is on this
//     bundle, and one of them has been pinging without a break for 90 s — since it
//     joined or since it came back — without reporting a working connection to it.
// Never for having gone quiet once reached: that is a network dropout as often as a
// closed tab, and the previous bundle can't rejoin a call it was dropped from, while
// a call that is kept heals when the network returns. A closed tab still goes, by the
// first rule. Nor because someone can't reach it while another tab on the previous
// bundle is in the call: the two may well be talking. A lone entry is left alone too
// — it may be a real person waiting — and the next one to join will see.
// What is left is a closed tab whose login keeps another old tab open in the same
// browser (the two can't be told apart): it stays until that tab closes too, or until
// someone joins the call and can't reach it.
const HUDDLE_LEGACY_VOUCH_MS = 90_000;
const HUDDLE_LEGACY_TAB_MS = 180_000;
const HUDDLE_LEGACY_UNREACHED_MS = 90_000;
// How long the longest-watching participant still pinging has been at it (0: nobody).
function huddleWatched(roomId, now) {
  const seen = huddleSeen.get(roomId) || new Map(), streak = huddleStreak.get(roomId) || new Map();
  let from = Infinity;
  for (const [k, at] of seen) if (now - at <= HUDDLE_STREAK_GAP_MS && streak.has(k)) from = Math.min(from, streak.get(k));
  return from === Infinity ? null : from;
}
function huddleLegacyGone(roomId, key, now) {
  const joined = (huddleJoinedAt.get(roomId) || new Map()).get(key) || now;
  const heard = (huddleHeard.get(roomId) || new Map()).get(key) || 0;
  if (now - heard <= HUDDLE_LEGACY_VOUCH_MS) return null;
  const tabs = ctx.notifLegacyState((huddleLegacyTag.get(roomId) || new Map()).get(key) || '');
  if (!tabs.open && now - Math.max(joined, tabs.closedAt) > HUDDLE_LEGACY_TAB_MS) return 'its tab is closed';
  if (heard) return null;
  const watchFrom = huddleWatched(roomId, now);
  if (watchFrom === null) return null;
  const sids = huddleSids.get(roomId) || new Map();
  const others = [...(huddles.get(roomId) || new Map()).keys()].filter(k => k !== key);
  if (others.every(k => sids.has(k)) && now - Math.max(joined, watchFrom) > HUDDLE_LEGACY_UNREACHED_MS) return 'nobody has reached it';
  return null;
}
async function huddleSweep(now = Date.now()) {
  for (const [roomId, set] of huddles) {
    const sids = huddleSids.get(roomId) || new Map();
    for (const key of [...set.keys()]) {
      if (sids.has(key)) continue;
      const why = huddleLegacyGone(roomId, key, now);
      if (!why) continue;
      const members = await huddleRoomMembers(roomId);
      // It may have been vouched for, rejoined with a sid, or left meanwhile.
      if (!(huddles.get(roomId) || new Map()).has(key) || (huddleSids.get(roomId) || new Map()).has(key) || !huddleLegacyGone(roomId, key, now)) continue;
      const name = huddles.get(roomId).get(key), tag = (huddleLegacyTag.get(roomId) || new Map()).get(key) || '';
      huddleRemove(roomId, key);
      if (huddles.has(roomId)) {
        if (!huddleDroppedLegacy.has(roomId)) huddleDroppedLegacy.set(roomId, new Map());
        huddleDroppedLegacy.get(roomId).set(key, { name, tag, at: now });
      }
      console.log('[huddle] dropped participant on the previous bundle', key, 'from room', roomId, '-', why);
      huddleEmit(huddleAudience(roomId, members), { type: 'roster', roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId), left: key, swept: true });
    }
  }
  for (const [roomId, dropped] of huddleDroppedLegacy) {
    for (const [key, d] of dropped) if (now - d.at > HUDDLE_READMIT_MS) dropped.delete(key);
    if (!dropped.size) huddleDroppedLegacy.delete(roomId);
  }
  for (const [roomId, seen] of huddleSeen) {
    for (const [key, at] of seen) {
      if (now - at <= HUDDLE_SILENT_MS) continue;
      const members = await huddleRoomMembers(roomId);
      // It may have pinged, or left, while the member list was being read.
      if (seen.get(key) !== at || !(huddles.get(roomId) || new Map()).has(key)) continue;
      huddleRemove(roomId, key);
      console.log('[huddle] dropped silent participant', key, 'from room', roomId);
      // 'swept', not left: peers keep a connection that is still working — the tab
      // is probably only asleep, and rejoins on its next ping.
      huddleEmit(huddleAudience(roomId, members), { type: 'roster', roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId), left: key, swept: true });
    }
  }
}
setInterval(() => { huddleSweep().catch(e => console.warn('[huddle] sweep failed:', e.message)); }, 15_000).unref();
ctx.huddleSweep = huddleSweep;   // tests drive it with a clock of their own

// Rooms — group (admin only)
// Delete a group for everyone. Direct conversations are never deleted this way —
// one person cannot erase another's history; they hide their own copy instead.
receiver.router.delete('/api/dashboard/chat/rooms/:id', requireAuth, async (req, res) => {
  const roomId = parseInt(req.params.id);
  const { data: room } = await supabase.from('chat_rooms').select('id,type').eq('id', roomId).single();
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.type !== 'group') return res.status(400).json({ error: 'Only groups can be deleted. Hide a direct chat instead.' });
  const members = await chatRoomMemberKeys(roomId);
  await supabase.from('chat_messages').delete().eq('room_id', roomId);
  await supabase.from('chat_room_members').delete().eq('room_id', roomId);
  huddleMembersChanged(roomId);
  const { error } = await supabase.from('chat_rooms').delete().eq('id', roomId);
  if (error) return res.status(500).json({ error: error.message });
  chatBroadcast(members, 'room', { roomId, deleted: true });
  res.json({ ok: true });
});

receiver.router.post('/api/dashboard/chat/rooms/group', requireAuth, express.json(), async (req, res) => {
  const { name, memberKeys } = req.body || {};
  if (!name || !Array.isArray(memberKeys) || !memberKeys.length) return res.status(400).json({ error: 'name and memberKeys[] required' });
  try {
    const { data: room, error: roomErr } = await supabase.from('chat_rooms').insert({ type: 'group', name, created_by: 'admin' }).select().single();
    if (roomErr) throw new Error(roomErr.message);
    const empIds = memberKeys.filter(k => k.startsWith('employee_')).map(k => parseInt(k.slice(9)));
    const { data: emps } = await supabase.from('employees').select('id, name').in('id', empIds);
    const empNameMap = {};
    (emps || []).forEach(e => { empNameMap[e.id] = e.name; });
    const insertMembers = [
      { room_id: room.id, member_key: 'admin', member_name: 'Admin' },
      ...memberKeys.filter(k => k !== 'admin').map(k => ({
        room_id: room.id,
        member_key: k,
        member_name: k.startsWith('employee_') ? (empNameMap[parseInt(k.slice(9))] || k) : k,
      })),
    ];
    await supabase.from('chat_room_members').insert(insertMembers);
    res.json(room);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Messages
receiver.router.get('/api/dashboard/chat/rooms/:roomId/messages', requireAuth, (req, res) => chatGetMessages(req, res, 'admin'));
receiver.router.get('/api/employee/chat/rooms/:roomId/messages', requireEmployeeAuth, requirePerm('chat', 'view'), (req, res) => chatGetMessages(req, res, `employee_${req.employee.id}`));
receiver.router.post('/api/dashboard/chat/rooms/:roomId/messages', requireAuth, express.json(), (req, res) => chatSendMessage(req, res, 'admin', 'Admin'));
receiver.router.post('/api/employee/chat/rooms/:roomId/messages', requireEmployeeAuth, requirePerm('chat', 'send'), express.json(), (req, res) => chatSendMessage(req, res, `employee_${req.employee.id}`, req.employee.name));
// Edit
receiver.router.patch('/api/dashboard/chat/rooms/:roomId/messages/:msgId', requireAuth, express.json(), (req, res) => chatEditMsg(req, res, 'admin'));
receiver.router.patch('/api/employee/chat/rooms/:roomId/messages/:msgId', requireEmployeeAuth, requirePerm('chat', 'edit'), express.json(), (req, res) => chatEditMsg(req, res, `employee_${req.employee.id}`));
// Delete
receiver.router.delete('/api/dashboard/chat/rooms/:roomId/messages/:msgId', requireAuth, (req, res) => chatDeleteMsg(req, res, 'admin'));
receiver.router.delete('/api/employee/chat/rooms/:roomId/messages/:msgId', requireEmployeeAuth, requirePerm('chat', 'delete'), (req, res) => chatDeleteMsg(req, res, `employee_${req.employee.id}`));

// File upload
const chatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// A pasted screenshot arrives with no usable filename, so the extension cannot come
// from originalname alone — that produced a key ending in a bare dot and an object
// the browser then refused to render. The client names what it pastes; this is the
// second line of defence for anything that reaches here without one.
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
};
function chatUploadExt(file) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(file.originalname || '');
  if (m) return m[1].toLowerCase();
  if (MIME_EXT[file.mimetype]) return MIME_EXT[file.mimetype];
  const sub = String(file.mimetype || '').split('/')[1] || '';
  return sub.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
}

async function handleChatUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const ext  = chatUploadExt(req.file);
  const path = `chat/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const { data, error } = await supabase.storage.from('chat-files').upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (error) return res.status(500).json({ error: error.message });
  const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(data.path);
  res.json({ url: urlData.publicUrl, name: req.file.originalname || `attachment.${ext}`,
             size: req.file.size, type: req.file.mimetype });
}

receiver.router.post('/api/dashboard/chat/upload', requireAuth, chatUpload.single('file'), handleChatUpload);
receiver.router.post('/api/employee/chat/upload',  requireEmployeeAuth, requirePerm('chat', 'upload'), chatUpload.single('file'), handleChatUpload);

// Task attachments take the same handler, the same bucket and the same 10MB
// limit — only the guard differs. Routing them through the chat upload would
// have meant someone allowed to create a task but not to post in chat could not
// attach a file to their own task.
receiver.router.post('/api/dashboard/tasks/upload', requireAuth, chatUpload.single('file'), handleChatUpload);
receiver.router.post('/api/employee/tasks/upload',  requireEmployeeAuth, requirePerm('tasks', 'create'), chatUpload.single('file'), handleChatUpload);


module.exports = {};
