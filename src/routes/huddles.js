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
  // WebRTC signalling rides the existing chat SSE: each payload is relayed to one
  // peer. Roster is in-memory and ephemeral — a restart simply ends the call.
  // A refresh drops you out of the call without telling anybody's page. This is
  // how a freshly-loaded portal finds the huddle it was just in and offers it
  // back, instead of leaving people to guess whether one is still running.
  receiver.router.get(`${base}/huddle/live`, guard, requirePerm('chat', 'huddle'), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const live = [];
    for (const roomId of huddles.keys()) {
      const members = await chatRoomMemberKeys(roomId);
      if (!huddleMaySignal(roomId, key, members)) continue;
      live.push({ roomId, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
    }
    res.json(live);
  });

  receiver.router.get(`${base}/huddle/ice`, guard, requirePerm('chat', 'huddle'), async (_req, res) => {
    res.json(await huddleIceConfig());
  });

  receiver.router.get(`${base}/huddle/:roomId`, guard, requirePerm('chat', 'huddle'), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.roomId);
    if (!huddleMaySignal(roomId, key, await chatRoomMemberKeys(roomId))) return res.status(403).json({ error: 'Not a member' });
    res.json({ participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
  });

  receiver.router.post(`${base}/huddle/signal`, guard, requirePerm('chat', 'huddle'), express.json({ limit: '256kb' }), async (req, res) => {
    const { key, name } = chatCallerIdentity(req);
    const roomId = parseInt(req.body?.roomId);
    const type = String(req.body?.type || '');
    if (!roomId || !HUDDLE_TYPES.includes(type)) return res.status(400).json({ error: 'bad signal' });
    const members = await chatRoomMemberKeys(roomId);
    if (!huddleMaySignal(roomId, key, members)) return res.status(403).json({ error: 'Not a member' });

    if (type === 'join') {
      const set = huddles.get(roomId) || new Map();
      if (set.size >= HUDDLE_MAX && !set.has(key)) return res.status(409).json({ error: 'Huddle is full', max: HUDDLE_MAX });
      set.set(key, name);
      huddles.set(roomId, set);
      if (!huddleStarted.has(roomId)) huddleStarted.set(roomId, Date.now());
      chatBroadcast(huddleAudience(roomId, members), 'huddle', { type: 'roster', roomId, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId), joined: key });
      return res.json({ ok: true, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
    }
    if (type === 'leave') {
      const set = huddles.get(roomId);
      if (set) { set.delete(key); if (!set.size) { huddles.delete(roomId); huddleGuests.delete(roomId); huddleStarted.delete(roomId); } }
      const g = huddleGuests.get(roomId); if (g) g.delete(key);
      chatBroadcast(huddleAudience(roomId, members), 'huddle', { type: 'roster', roomId, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId), left: key });
      return res.json({ ok: true });
    }
    // invite/offer/answer/ice/decline/media are point-to-point
    const to = String(req.body?.to || '');
    if (type === 'invite' && !members.includes(to)) {
      // Pulling in someone from the wider workspace: grant them this huddle only
      const people = await chatPeopleKeys();
      if (!people.includes(to)) return res.status(400).json({ error: 'unknown person' });
      if (!huddleGuests.has(roomId)) huddleGuests.set(roomId, new Set());
      huddleGuests.get(roomId).add(to);
    } else if (!huddleMaySignal(roomId, to, members)) {
      return res.status(400).json({ error: 'target not in this huddle' });
    }
    chatBroadcast([to], 'huddle', { type, roomId, from: key, fromName: name, data: req.body?.data ?? null });

    // An invite has to reach someone who is not sitting on the chat page. chatBroadcast
    // writes to chatSseClients, and that stream is opened by the chat page loader and
    // torn down on navigating away — so anywhere else in the app the invite was simply
    // dropped, with no ring, no bell and no push. It now also goes out over the
    // always-on notification stream, and createNotification persists it and pushes to
    // anyone who is offline entirely.
    //
    // Only the invite. offer/answer/ice/media stay on the chat stream: duplicating
    // signalling across two transports is a correctness hazard, not a feature.
    if (type === 'invite') {
      const sse = ctx.notifSseClients && ctx.notifSseClients.get(to);
      if (sse) {
        try {
          sse.write(`event: huddle\ndata: ${JSON.stringify({ type, roomId, from: key, fromName: name, data: null })}\n\n`);
        } catch (_) { /* a dead stream is cleaned up by its own close handler */ }
      }
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
const HUDDLE_TYPES = ['join', 'leave', 'invite', 'decline', 'offer', 'answer', 'ice', 'media'];
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
  return set ? [...set.entries()].map(([key, name]) => ({ key, name })) : [];
}
function huddleStartedAt(roomId) { return huddleStarted.get(roomId) || null; }

mountChatAdminRoutes('/api/dashboard/chat', requireAuth);
mountChatAdminRoutes('/api/employee/chat', requireEmployeeAuth);

// Rooms — group (admin only)
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


module.exports = {};
