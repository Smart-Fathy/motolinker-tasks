// Notification Center ─
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { chatBroadcast, chatSseClients, receiver, requireAuth, requireEmployeeAuth, sendPushAlways, sendPushToOfflineMembers, supabase } = ctx.need('chatBroadcast', 'chatSseClients', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'sendPushAlways', 'sendPushToOfflineMembers', 'supabase');

// ─── Notification Center ────────────────────────────────────────────────────
// Persistent notification SSE: one per logged-in member ('admin' | 'employee_<id>'),
// kept open the whole time the portal is loaded.
const notifSseClients = new Map();

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
  // Live SSE to an open portal
  const sseRes = notifSseClients.get(memberKey);
  console.log('[notif]', memberKey, type, 'sse=' + !!sseRes);
  if (sseRes) { try { sseRes.write(`event: notification\ndata: ${JSON.stringify(row)}\n\n`); } catch (_) {} }
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
      body: `${task.title} · due ${task.due_date} · ${task.priority} priority`,
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
  return (rooms || []).map(r => ({
    ...r,
    members: (membersByRoom[r.id] || []).map(m => {
      const p = profiles[m.member_key] || {};
      return { ...m, member_avatar: p.avatar || null, member_status: p.statusText || '', member_status_emoji: p.statusEmoji || '' };
    }),
    lastMessage: lastMsgByRoom[r.id] || null,
  }));
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
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(':ok\n\n');
  chatSseClients.set('admin', res);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ka); chatSseClients.delete('admin'); });
});

// SSE — Employee chat
receiver.router.get('/api/employee/chat/events', requireEmployeeAuth, (req, res) => {
  const key = `employee_${req.employee.id}`;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(':ok\n\n');
  chatSseClients.set(key, res);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ka); chatSseClients.delete(key); });
});


module.exports = { chatCreateOrGetDirect, chatDeleteMsg, chatEditMsg, chatGetMessages, chatListRooms, chatSendMessage, createNotification, memberKeyForAssignee, notifSseClients, notifyEmployeeTaskAssigned };
