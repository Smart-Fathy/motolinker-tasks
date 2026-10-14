// Notification Center ─
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const crypto = require('crypto');
const ctx = require('../ctx');
const { chatBroadcast, chatSseClients, receiver, requireAuth, requireEmployeeAuth, sendPushAlways, sendPushToOfflineMembers, supabase } = ctx.need('chatBroadcast', 'chatSseClients', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'sendPushAlways', 'sendPushToOfflineMembers', 'supabase');

// ─── Notification Center ────────────────────────────────────────────────────
// Persistent notification SSE, kept open the whole time a portal is loaded — on
// every page, unlike the chat stream, which only the chat page opens.
// Late-resolved: defined in index.js, which requires this module.
const requirePerm = (...a) => ctx.requirePerm(...a);

// member key ('admin' | 'employee_<id>') -> Set of open streams. A Set, because a
// person with two tabs or a phone and a laptop has one stream each, and a single
// slot meant the newest tab silently took over everything the others should have
// received — including the huddle signalling that now rides this stream.
const notifSseClients = new Map();
// Streams opened by the previous bundle, per login: how many are open now, and when
// the last one closed. That bundle never says it has left a huddle and never pings,
// so an open stream is the only sign of life one of its tabs gives — closing the tab
// or reloading it (into this bundle) closes it. The huddle sweep reads this.
// The current bundle marks its streams (?hd=2) and is not counted.
//
// Per login, not per member: every dashboard login is the member 'admin', and one
// person's phone must not keep alive the ghost of a tab closed on their laptop. Two
// tabs of one browser share a login, and can't be told apart.
const legacyOpen = new Map();       // login tag -> open legacy streams
const legacyClosedAt = new Map();   // login tag -> when the last one closed
// The login a request is made with — the bearer token, or the ?_t= a stream or a
// beacon carries — as a short hash, so the token itself is never held twice.
function notifTokenTag(req) {
  const auth = String((req.headers && req.headers.authorization) || '');
  const tok = auth.startsWith('Bearer ') ? auth.slice(7) : String((req.query && req.query._t) || '');
  return tok ? crypto.createHash('sha256').update(tok).digest('hex').slice(0, 16) : '';
}
function notifAdd(key, res) {
  if (!notifSseClients.has(key)) notifSseClients.set(key, new Set());
  const set = notifSseClients.get(key);
  if (set.has(res)) return;
  set.add(res);
  if (res.hdLegacy && res.hdTag) legacyOpen.set(res.hdTag, (legacyOpen.get(res.hdTag) || 0) + 1);
}
function notifRemove(key, res) {
  const set = notifSseClients.get(key);
  if (!set || !set.delete(res)) return;
  if (!set.size) notifSseClients.delete(key);
  if (res.hdLegacy && res.hdTag) {
    const n = (legacyOpen.get(res.hdTag) || 1) - 1;
    if (n > 0) legacyOpen.set(res.hdTag, n); else legacyOpen.delete(res.hdTag);
    legacyClosedAt.set(res.hdTag, Date.now());
  }
}
function notifLegacyState(tag) {
  return { open: legacyOpen.get(tag) || 0, closedAt: legacyClosedAt.get(tag) || 0 };
}
// A closing time only matters for the 3 minutes after it (the huddle sweep's window);
// forget it well after, or every login that ever had an old tab stays here for good.
const LEGACY_CLOSED_KEEP_MS = 10 * 60_000;
function notifLegacyPrune(now = Date.now()) {
  for (const [tag, at] of legacyClosedAt) if (!legacyOpen.has(tag) && now - at > LEGACY_CLOSED_KEEP_MS) legacyClosedAt.delete(tag);
}
setInterval(() => notifLegacyPrune(), 5 * 60_000).unref();
// Write one SSE chunk to every stream the member has open. True if any was open.
function notifWrite(key, chunk) {
  const set = notifSseClients.get(key);
  if (!set || !set.size) return false;
  for (const res of set) { try { res.write(chunk); } catch (_) { /* its close handler removes it */ } }
  return true;
}

// ── Huddle signalling ────────────────────────────────────────────────────────
// Offers, answers, ICE candidates and roster changes for huddles travel on this
// always-open stream as 'huddle-signal' events. They used to ride the chat stream,
// which the portals close the moment someone leaves the chat page — mid-call, that
// silently cut the person off from every later signal, and their tiles sat on
// "connecting" for good.
//
// Every stream is also cut and reopened at least every 15 minutes (Railway's edge
// ends long requests at 900 s), and a frame written during that gap used to be lost.
// So each frame carries an id, recent frames are kept per member, and a stream that
// reconnects says the last id it saw (the browser's own Last-Event-ID header, or ?hs=
// when the portal rebuilds the stream) and is sent whatever it missed.
const SIGNAL_BOOT = Date.now().toString(36);   // ids from before a restart are not comparable
const SIGNAL_KEEP_MS = 60_000;
const SIGNAL_KEEP_MAX = 300;
let signalSeq = 0;
const signalBuffers = new Map();   // member key -> [{ seq, at, chunk }]
function pruneSignals(buf, now) {
  while (buf.length && (buf.length > SIGNAL_KEEP_MAX || now - buf[0].at > SIGNAL_KEEP_MS)) buf.shift();
}
function huddleSignalSend(keys, payload) {
  const now = Date.now();
  const data = JSON.stringify(payload);
  for (const key of new Set(keys)) {
    const seq = ++signalSeq;
    const chunk = `id: ${SIGNAL_BOOT}.${seq}\nevent: huddle-signal\ndata: ${data}\n\n`;
    let buf = signalBuffers.get(key);
    if (!buf) signalBuffers.set(key, buf = []);
    buf.push({ seq, at: now, chunk });
    pruneSignals(buf, now);
    notifWrite(key, chunk);
  }
  // Members who never reconnect would otherwise keep their last minute forever.
  if (signalSeq % 200 === 0) {
    for (const [key, buf] of signalBuffers) { pruneSignals(buf, now); if (!buf.length) signalBuffers.delete(key); }
  }
}
// Replay what a reconnecting stream missed. No last id means a fresh page, which
// learns the live huddles from /huddle/live instead of from replayed offers.
function huddleSignalReplay(key, res, lastId) {
  if (!lastId) return 0;
  const [boot, n] = String(lastId).split('.');
  const since = boot === SIGNAL_BOOT ? (Number(n) || 0) : 0;   // after a restart, all we hold is new
  const buf = signalBuffers.get(key);
  if (!buf) return 0;
  const now = Date.now();
  let sent = 0;
  for (const f of buf) {
    if (f.seq > since && now - f.at <= SIGNAL_KEEP_MS) { try { res.write(f.chunk); sent++; } catch (_) {} }
  }
  return sent;
}

// Create a notification: persist (best-effort), push it live over SSE, and fire push.
// pushMode: 'always' (ignore online filter) | 'offline' (skip if connected) | false (none)
async function createNotification(memberKey, { type = 'general', title, body = '', url = '' }, pushMode = 'offline') {
  if (!memberKey || !title) return null;
  const defaultUrl = url || (memberKey === 'admin' ? '/dashboard' : '/employee');
  let row = { member_key: memberKey, type, title, body, url: defaultUrl, read: false, created_at: new Date().toISOString() };
  try {
    const { data } = await supabase.from('notifications')
      .insert({ member_key: memberKey, type, title, body, url: defaultUrl })
      .select().single();
    if (data) row = data;
  } catch (e) { console.warn('[notif] persist failed:', e.message); }
  // If persistence failed, give the live-only row a synthetic id so the client can still mark it read locally
  if (!row.id) row.id = 'tmp-' + Date.now();
  // Live SSE to every open portal tab
  const live = notifWrite(memberKey, `event: notification\ndata: ${JSON.stringify(row)}\n\n`);
  console.log('[notif]', memberKey, type, 'sse=' + live);
  // OS push — unique tag per notification so multiple pushes don't collapse in the tray
  const payload = { title, body, url: defaultUrl, tag: 'notif-' + (row.id || Date.now()) };
  if (pushMode === 'always') sendPushAlways([memberKey], payload);
  else if (pushMode === 'offline') sendPushToOfflineMembers([memberKey], payload);
  return row;
}

// Resolve an assignee_id (numeric employee id OR legacy Slack user id) to the
// canonical notification member key `employee_<id>` used by push subs + SSE.
async function memberKeyForAssignee(assigneeId) {
  if (assigneeId == null || assigneeId === '') return null;
  const isNumeric = /^\d+$/.test(String(assigneeId));
  const filter = isNumeric
    ? `id.eq.${assigneeId},slack_user_id.eq.${assigneeId}`
    : `slack_user_id.eq.${assigneeId}`;
  try {
    const { data } = await supabase.from('employees').select('id').or(filter).limit(1);
    if (data && data[0]) return `employee_${data[0].id}`;
  } catch (_) {}
  return `employee_${assigneeId}`;
}

// Notify every assignee of a task (multi-assignee aware; falls back to assignee_id)
async function notifyEmployeeTaskAssigned(task) {
  const list = Array.isArray(task?.assignee_ids) && task.assignee_ids.length ? task.assignee_ids : (task?.assignee_id ? [task.assignee_id] : []);
  for (const aid of [...new Set(list.map(String))]) {
    const key = await memberKeyForAssignee(aid);
    if (!key) continue;
    createNotification(key, {
      type: 'task',
      title: 'New task assigned',
      // When a recurring task's due date moved off a day the assignee marked
      // off, say so — a date that changed itself is otherwise a mystery.
      body: `${task.title} · due ${task.due_date}${task.due_shifted_from
        ? ` (moved from ${task.due_shifted_from} — you were off)` : ''} · ${task.priority} priority`,
      url: '/employee#tasks',
    }, 'always');
  }
}

async function chatListRooms(callerKey) {
  const { data: membership } = await supabase.from('chat_room_members').select('room_id').eq('member_key', callerKey);
  if (!membership?.length) return [];
  const roomIds = membership.map(m => m.room_id);
  const [{ data: rooms }, { data: allMembers }, { data: recentMsgs }] = await Promise.all([
    supabase.from('chat_rooms').select('*').in('id', roomIds).order('updated_at', { ascending: false }),
    supabase.from('chat_room_members').select('*').in('room_id', roomIds),
    supabase.from('chat_messages').select('*').in('room_id', roomIds).order('created_at', { ascending: false }).limit(roomIds.length * 3),
  ]);
  const membersByRoom = {};
  (allMembers || []).forEach(m => {
    if (!membersByRoom[m.room_id]) membersByRoom[m.room_id] = [];
    membersByRoom[m.room_id].push(m);
  });
  const lastMsgByRoom = {};
  (recentMsgs || []).forEach(m => { if (!lastMsgByRoom[m.room_id]) lastMsgByRoom[m.room_id] = m; });
  // Attach profile pictures so the room list can show the peer's avatar
  const profiles = await chatProfileMap();
  // This caller's own row decides what they see: archived moves the conversation
  // to its own section, hidden takes it off the list until somebody says
  // something new. Both are per member — the other side is untouched.
  const mine = {};
  (allMembers || []).forEach(m => { if (m.member_key === callerKey) mine[m.room_id] = m; });
  return (rooms || []).map(r => ({
    ...r,
    members: (membersByRoom[r.id] || []).map(m => {
      const p = profiles[m.member_key] || {};
      return { ...m, member_avatar: p.avatar || null, member_status: p.statusText || '', member_status_emoji: p.statusEmoji || '' };
    }),
    lastMessage: lastMsgByRoom[r.id] || null,
    archived: !!(mine[r.id] && mine[r.id].archived_at),
    hidden_at: (mine[r.id] && mine[r.id].hidden_at) || null,
  })).filter(r => {
    if (!r.hidden_at) return true;
    // A newer message un-hides it — "delete" in a chat has always meant "until
    // they write again", and silently swallowing the next message would be worse.
    return !!(r.lastMessage && new Date(r.lastMessage.created_at) > new Date(r.hidden_at));
  });
}

async function chatCreateOrGetDirect(callerKey, callerName, targetKey, targetName) {
  const { data: callerRooms } = await supabase.from('chat_room_members').select('room_id').eq('member_key', callerKey);
  if (callerRooms?.length) {
    const callerRoomIds = callerRooms.map(r => r.room_id);
    const { data: shared } = await supabase.from('chat_room_members').select('room_id').eq('member_key', targetKey).in('room_id', callerRoomIds);
    if (shared?.length) {
      for (const s of shared) {
        const { data: room } = await supabase.from('chat_rooms').select('*').eq('id', s.room_id).eq('type', 'direct').single();
        if (room) return room;
      }
    }
  }
  const { data: room, error: roomErr } = await supabase.from('chat_rooms').insert({ type: 'direct', name: '', created_by: callerKey }).select().single();
  if (roomErr) throw new Error(roomErr.message);
  await supabase.from('chat_room_members').insert([
    { room_id: room.id, member_key: callerKey, member_name: callerName },
    { room_id: room.id, member_key: targetKey, member_name: targetName },
  ]);
  return room;
}

// ── Chat avatars ──────────────────────────────────────────────────────────────
// Messages only store sender_key/sender_name, so resolve the profile picture from
// the employee roster ("employee_<id>" keys; the admin account has none). Cached
// for a minute — chat is polled/streamed constantly and the roster rarely changes.
let _chatAvatars = { at: 0, map: {} };
const chatAi = require('../lib/chat-ai');
// Avatar + status per member key, so everyone sees everyone's status — not just
// their own. Cached for a minute; chat polls constantly and this rarely changes.
async function chatProfileMap() {
  if (Date.now() - _chatAvatars.at < 60000) return _chatAvatars.map;
  const map = {};
  try {
    const { data } = await supabase.from('employees').select('id,avatar_url,status_text,status_emoji');
    for (const e of data || []) {
      map['employee_' + e.id] = {
        avatar: e.avatar_url || null,
        statusText: e.status_text || '',
        statusEmoji: e.status_emoji || '',
      };
    }
  } catch (e) { console.warn('[chat] profile map failed:', e.message); }
  // The assistant answers in rooms as a sender of its own; its avatar is the brain.
  map[chatAi.ASSISTANT_KEY] = { avatar: chatAi.ASSISTANT_AVATAR, statusText: '', statusEmoji: '' };
  _chatAvatars = { at: Date.now(), map };
  return map;
}
function chatAvatarMap() { return chatProfileMap(); }   // legacy name
function withSenderAvatars(rows, map) {
  return (rows || []).map(m => {
    const p = map[m.sender_key] || {};
    return { ...m, sender_avatar: p.avatar || null, sender_status: p.statusText || '', sender_status_emoji: p.statusEmoji || '' };
  });
}

async function chatGetMessages(req, res, callerKey) {
  const roomId = parseInt(req.params.roomId);
  const { data: member } = await supabase.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('member_key', callerKey).single();
  if (!member) return res.status(403).json({ error: 'Not a member of this room' });
  const before = req.query.before;
  let query = supabase.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(50);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(withSenderAvatars((data || []).reverse(), await chatAvatarMap()));
}

async function chatSendMessage(req, res, callerKey, callerName) {
  const roomId = parseInt(req.params.roomId);
  const { body, file_url, file_name, file_size, file_type, reply_to_id, reply_to_sender, reply_to_body, voice_duration } = req.body || {};
  if (!body?.trim() && !file_url) return res.status(400).json({ error: 'Message body or file required' });
  const { data: member } = await supabase.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('member_key', callerKey).single();
  if (!member) return res.status(403).json({ error: 'Not a member of this room' });
  const insert = { room_id: roomId, sender_key: callerKey, sender_name: callerName, body: body?.trim() || '' };
  if (file_url)  { insert.file_url = file_url; insert.file_name = file_name || ''; insert.file_size = file_size || null; insert.file_type = file_type || ''; }
  if (reply_to_id) { insert.reply_to_id = reply_to_id; insert.reply_to_sender = reply_to_sender || ''; insert.reply_to_body = (reply_to_body || '').slice(0, 200); }
  if (voice_duration) insert.voice_duration = parseInt(voice_duration);
  const { data: inserted, error } = await supabase.from('chat_messages').insert(insert).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const prof = (await chatProfileMap())[callerKey] || {};
  const msg = { ...inserted, sender_avatar: prof.avatar || null, sender_status: prof.statusText || '', sender_status_emoji: prof.statusEmoji || '' };
  const { data: members } = await supabase.from('chat_room_members').select('member_key').eq('room_id', roomId);
  const recipientKeys = (members || []).map(m => m.member_key).filter(k => k !== callerKey);
  // Exclude sender from broadcast — sender already has the message from the HTTP response
  chatBroadcast(recipientKeys, 'message', { roomId, message: msg });
  // Push to members not connected via SSE (app closed / backgrounded)
  sendPushToOfflineMembers(recipientKeys, {
    type: 'chat_message', roomId,
    senderName: callerName,
    body: (msg.file_url && !msg.body) ? '📎 Attachment' : (msg.body || '').slice(0, 80),
  });
  res.json(msg);
  // "@AI …" — the assistant answers in the room, after the message is out.
  if (chatAi.mentionsAssistant(msg.body) && typeof ctx.chatAssistantReply === 'function') {
    ctx.chatAssistantReply({ roomId, message: msg, callerKey, callerName }).catch(e => console.warn('[chat] assistant reply failed:', e.message));
  }
}

async function chatEditMsg(req, res, callerKey) {
  const roomId = parseInt(req.params.roomId);
  const msgId  = parseInt(req.params.msgId);
  const { body } = req.body || {};
  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });
  const { data: msg } = await supabase.from('chat_messages').select('*').eq('id', msgId).eq('room_id', roomId).single();
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_key !== callerKey) return res.status(403).json({ error: 'Not your message' });
  const { data: updated, error } = await supabase.from('chat_messages').update({ body: body.trim(), edited_at: new Date().toISOString() }).eq('id', msgId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const { data: members } = await supabase.from('chat_room_members').select('member_key').eq('room_id', roomId);
  chatBroadcast((members || []).map(m => m.member_key), 'edit', { roomId, message: updated });
  res.json(updated);
}

async function chatDeleteMsg(req, res, callerKey) {
  const roomId = parseInt(req.params.roomId);
  const msgId  = parseInt(req.params.msgId);
  const { data: msg } = await supabase.from('chat_messages').select('*').eq('id', msgId).eq('room_id', roomId).single();
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_key !== callerKey) return res.status(403).json({ error: 'Not your message' });
  const ageMins = (Date.now() - new Date(msg.created_at).getTime()) / 60000;
  if (ageMins > 5) return res.status(403).json({ error: 'Cannot delete messages older than 5 minutes' });
  const { error } = await supabase.from('chat_messages').delete().eq('id', msgId);
  if (error) return res.status(500).json({ error: error.message });
  const { data: members } = await supabase.from('chat_room_members').select('member_key').eq('room_id', roomId);
  chatBroadcast((members || []).map(m => m.member_key), 'delete', { roomId, msgId });
  res.json({ ok: true });
}

// SSE — Admin
receiver.router.get('/api/dashboard/chat/events', requireAuth, (req, res) => {
  res.set(ctx.SSE_HEADERS);
  res.flushHeaders();
  res.write(':ok\n\n');
  chatSseClients.set('admin', res);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ka); if (chatSseClients.get('admin') === res) chatSseClients.delete('admin'); });
});

// SSE — Employee chat
receiver.router.get('/api/employee/chat/events', requireEmployeeAuth, requirePerm('chat', 'view'), (req, res) => {
  const key = `employee_${req.employee.id}`;
  res.set(ctx.SSE_HEADERS);
  res.flushHeaders();
  res.write(':ok\n\n');
  chatSseClients.set(key, res);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ka); if (chatSseClients.get(key) === res) chatSseClients.delete(key); });
});


module.exports = { chatCreateOrGetDirect, chatDeleteMsg, chatEditMsg, chatGetMessages, chatListRooms, chatSendMessage, createNotification, huddleSignalReplay, huddleSignalSend, memberKeyForAssignee, notifAdd, notifLegacyPrune, notifLegacyState, notifRemove, notifTokenTag, notifSseClients, notifWrite, notifyEmployeeTaskAssigned };
