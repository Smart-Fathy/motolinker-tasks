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
const chatProfileMap = (...a) => ctx.chatProfileMap(...a);
const isMissingRelation = (...a) => ctx.isMissingRelation(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const { fetchAll } = require('../lib/fetch-all');

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

// A group's picture is an upload, never an address someone typed, so what everyone
// sees is always a file this server stored. Raster images only: an SVG can carry
// script, and opened on its own it would run it.
const GROUP_PICTURE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const GROUP_PICTURE_MAX = 5 * 1024 * 1024;
const groupPictureMulter = multer({ storage: multer.memoryStorage(), limits: { fileSize: GROUP_PICTURE_MAX } }).single('file');
// multer's own errors arrive as an exception page; say what went wrong in JSON instead.
function groupPictureUpload(req, res, next) {
  groupPictureMulter(req, res, err => {
    if (!err) return next();
    const big = err.code === 'LIMIT_FILE_SIZE';
    res.status(big ? 413 : 400).json({ error: big ? 'The picture must be under 5 MB.' : 'Could not read that upload.' });
  });
}
// Where in the chat-files bucket one of our public URLs points; null for anything else.
function chatFilePath(url) {
  const m = /\/storage\/v1\/object\/public\/chat-files\/([^?#]+)$/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : null;
}
// A picture nobody is shown any more — replaced or removed — is deleted from storage,
// which is the free tier's to fill. Best effort: a file left behind costs a few KB.
function chatFileForget(url) {
  const p = chatFilePath(url);
  if (!p) return;
  supabase.storage.from('chat-files').remove([p])
    .then(({ error }) => { if (error) console.warn('[chat] could not delete an old picture:', error.message); })
    .catch(() => {});
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

  // The group's picture — what everyone in it sees in the list, the header and the
  // call. Set or changed by whoever may manage the group; it replaces the emoji icon
  // wherever both exist.
  receiver.router.post(`${base}/rooms/:id/picture`, guard, groupPictureUpload, async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.id);
    if (!(await chatCanManage(roomId, key))) return res.status(403).json({ error: 'Not allowed' });
    const ext = req.file && GROUP_PICTURE_TYPES[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: 'Choose a PNG, JPEG, WebP or GIF picture.' });
    const { data: before } = await supabase.from('chat_rooms').select('avatar_url').eq('id', roomId).maybeSingle();
    const file = `group-avatars/${roomId}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${ext}`;
    const up = await supabase.storage.from('chat-files').upload(file, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (up.error) return res.status(500).json({ error: up.error.message });
    const url = supabase.storage.from('chat-files').getPublicUrl(up.data.path).data.publicUrl;
    const { data, error } = await supabase.from('chat_rooms')
      .update({ avatar_url: url, updated_at: new Date().toISOString() }).eq('id', roomId).select().single();
    if (error) {
      chatFileForget(url);
      const missing = /avatar_url/.test(String(error.message || ''));
      return res.status(missing ? 409 : 500).json({
        error: missing ? 'Group pictures need migrations/024_huddles_and_group_pictures.sql applied first.' : error.message });
    }
    if (before && before.avatar_url && before.avatar_url !== url) chatFileForget(before.avatar_url);
    chatBroadcast(await chatRoomMemberKeys(roomId), 'room', { roomId, room: data });
    res.json(data);
  });
  receiver.router.delete(`${base}/rooms/:id/picture`, guard, async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.id);
    if (!(await chatCanManage(roomId, key))) return res.status(403).json({ error: 'Not allowed' });
    const { data: before } = await supabase.from('chat_rooms').select('avatar_url').eq('id', roomId).maybeSingle();
    const { data, error } = await supabase.from('chat_rooms')
      .update({ avatar_url: '', updated_at: new Date().toISOString() }).eq('id', roomId).select().single();
    if (error) {
      const missing = /avatar_url/.test(String(error.message || ''));
      return res.status(missing ? 409 : 500).json({
        error: missing ? 'Group pictures need migrations/024_huddles_and_group_pictures.sql applied first.' : error.message });
    }
    if (before && before.avatar_url) chatFileForget(before.avatar_url);
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
      // Removed by the host: not offered back to them while it runs.
      if (huddleIsBanned(roomId, key)) continue;
      live.push({ roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
    }
    res.json(live);
  });

  receiver.router.get(`${base}/huddle/ice`, guard, requirePerm('chat', 'huddle'), async (_req, res) => {
    res.json(await huddleIceConfig());
  });

  // ── Meeting threads ──
  // Ahead of /huddle/:roomId, which would otherwise read "threads" as a room.
  // Every huddle this person can read the thread of, newest first: the ones in their
  // conversations, and the ones they were pulled into as a guest. ?room= narrows it
  // to one conversation.
  receiver.router.get(`${base}/huddle/threads`, guard, requirePerm('chat', 'view'), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = req.query.room ? parseInt(req.query.room) : null;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 30));
    try {
      res.json(await huddleThreadSummaries(await huddleThreadsFor(key, roomId, limit), key));
    } catch (e) { huddleThreadsFail(res, e); }
  });
  receiver.router.get(`${base}/huddle/threads/:id`, guard, requirePerm('chat', 'view'), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const acc = await huddleThreadAccess(parseInt(req.params.id), key);
    if (acc.error) return huddleThreadsFail(res, acc.error);
    if (acc.status) return res.status(acc.status).json({ error: acc.status === 404 ? 'Thread not found' : 'Not in this huddle' });
    try { res.json(await huddleThreadPayload(acc.session, key)); }
    catch (e) { huddleThreadsFail(res, e); }
  });
  receiver.router.post(`${base}/huddle/threads/:id/messages`, guard, requirePerm('chat', 'send'), express.json(), async (req, res) => {
    const { key, name } = chatCallerIdentity(req);
    const id = parseInt(req.params.id);
    const body = String(req.body?.body || '').trim().slice(0, HUDDLE_THREAD_MAX);
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    const acc = await huddleThreadAccess(id, key);
    if (acc.error) return huddleThreadsFail(res, acc.error);
    if (acc.status) return res.status(acc.status).json({ error: acc.status === 404 ? 'Thread not found' : 'Not in this huddle' });
    const roomId = acc.session.room_id;
    if (acc.live && huddleIsBanned(roomId, key)) return res.status(403).json({ error: HUDDLE_REMOVED, removed: true });
    const { data: row, error } = await supabase.from('huddle_messages')
      .insert({ session_id: id, room_id: roomId, sender_key: key, sender_name: name, body }).select().single();
    if (error) return huddleThreadsFail(res, error);
    const message = { ...row, sender_avatar: ((await chatProfileMap())[key] || {}).avatar || null };
    // Everyone who may read it hears it at once: the conversation, whoever was in the
    // call, and while it runs whoever is in it as a guest.
    const { data: parts } = await supabase.from('huddle_participants').select('member_key').eq('session_id', id);
    const audience = new Set([...acc.members, ...(parts || []).map(p => p.member_key)]);
    if (acc.live) for (const g of huddleGuests.get(roomId) || []) audience.add(g);
    ctx.huddleSignalSend([...audience], { type: 'thread', roomId, sessionId: id, message });
    res.json(message);
  });
  // The thread of the huddle running in a room — what the panel in the call opens,
  // before it knows which session that is.
  receiver.router.get(`${base}/huddle/:roomId/thread`, guard, requirePerm('chat', 'huddle'), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.roomId);
    if (!huddleMaySignal(roomId, key, await huddleRoomMembers(roomId))) return res.status(403).json({ error: 'Not a member' });
    const live = huddleSession.get(roomId);
    if (!live) return res.status(404).json({ error: 'No huddle is running here.' });
    const id = await live.ready;
    if (!id) return huddleThreadsFail(res, live.error || new Error('The huddle could not be recorded.'));
    const { data: session, error } = await supabase.from('huddle_sessions').select('*').eq('id', id).maybeSingle();
    if (error || !session) return huddleThreadsFail(res, error || new Error('The huddle could not be recorded.'));
    try { res.json(await huddleThreadPayload(session, key)); }
    catch (e) { huddleThreadsFail(res, e); }
  });

  receiver.router.get(`${base}/huddle/:roomId`, guard, requirePerm('chat', 'huddle'), async (req, res) => {
    const { key } = chatCallerIdentity(req);
    const roomId = parseInt(req.params.roomId);
    if (huddleIsBanned(roomId, key)) return res.status(403).json({ error: HUDDLE_REMOVED, removed: true });
    if (!huddleMaySignal(roomId, key, await huddleRoomMembers(roomId))) return res.status(403).json({ error: 'Not a member' });
    res.json({ boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
  });

  receiver.router.post(`${base}/huddle/signal`, guard, requirePerm('chat', 'huddle'), express.json({ limit: '256kb' }), async (req, res) => {
    const { key, name } = chatCallerIdentity(req);
    const roomId = parseInt(req.body?.roomId);
    const type = String(req.body?.type || '');
    if (!roomId || !HUDDLE_TYPES.includes(type)) return res.status(400).json({ error: 'bad signal' });
    // Removed by the host: out until the huddle ends or the host asks them back. Nothing
    // from them reaches the call — no rejoining, no ping that would put them back, no
    // offer that would reconnect a pair behind everyone's back. Ahead of the membership
    // check, because a removed guest has lost their grant and should still be told why.
    if (huddleIsBanned(roomId, key) && type !== 'leave') return res.status(403).json({ error: HUDDLE_REMOVED, removed: true });
    const members = await huddleRoomMembers(roomId);
    if (!huddleMaySignal(roomId, key, members)) return res.status(403).json({ error: 'Not a member' });

    if (type === 'join') {
      const set = huddles.get(roomId) || new Map();
      if (set.size >= HUDDLE_MAX && !set.has(key)) return res.status(409).json({ error: 'Huddle is full', max: HUDDLE_MAX });
      const rawSid = req.body?.data?.sid;
      const sid = typeof rawSid === 'string' && rawSid ? rawSid.slice(0, 40) : null;
      const tag = ctx.notifTokenTag(req);
      const afterRestart = req.body?.data?.afterRestart === true;
      // A page this person has since replaced, by joining from another tab or device,
      // putting itself back — its stream reopened, or it woke up out of the call. The
      // newer one keeps the place: answer as if it had been taken by someone else, which
      // makes the page step aside (a tab on the previous bundle holds it without a sid).
      if (sid && (huddleDisplaced.get(roomId) || new Set()).has(sid)) {
        const participants = huddleRoster(roomId).filter(p => p.key !== key).concat({ key, name, sid: HUDDLE_ELSEWHERE });
        return res.json({ ok: true, superseded: true, boot: HUDDLE_BOOT, participants, started_at: huddleStartedAt(roomId) });
      }
      // The same page putting itself back keeps its place in time. Anything else is
      // someone new behind the key — another page, device or tab — and starts its
      // clocks afresh. A join without a sid always is: the previous bundle refuses to
      // join a call it is already in, so it comes from a different tab.
      const existed = set.has(key);
      const prevSid = existed ? (huddleSids.get(roomId) || new Map()).get(key) || null : null;
      const same = existed && !!sid && sid === prevSid;
      if (existed && !same && prevSid) huddleDisplace(roomId, prevSid);
      // Tabs on the previous bundle keep their connection to whatever was behind this
      // key before — a reloaded page, a closed tab — and, seeing the key still listed,
      // never dial it again: whoever replaced it is never reached. Show them a roster
      // without it first, which makes them drop that connection, then the real one,
      // from which they dial afresh. (Only they read the chat stream's 'huddle'.) Not
      // after a restart: they would read that roster, missing everyone not back yet, as
      // all of them gone — and hang up on the lot, with no full roster to follow.
      if (existed && !same && !afterRestart) {
        const without = [...set.entries()].filter(([k]) => k !== key).map(([k, n]) => ({ key: k, name: n }));
        chatBroadcast(huddleAudience(roomId, members), 'huddle', { type: 'roster', roomId, participants: without, started_at: huddleStartedAt(roomId), left: key });
      }
      // The first one in started it, and is its host (see huddleHostOf).
      const fresh = !set.size;
      set.set(key, name);
      huddles.set(roomId, set);
      if (fresh) huddleOwner.set(roomId, key);
      if (!huddleStarted.has(roomId)) huddleStarted.set(roomId, Date.now());
      huddleEnroll(roomId, key, sid);
      huddleNoteJoin(roomId, key, sid ? null : tag, same);
      if (fresh) huddleSessionOpen(roomId, key, name, afterRestart);
      huddleSessionJoin(roomId, key, name);
      // displaced: the page this join took the place of. A tab on the previous bundle
      // takes it without a sid, which the page's own superseded check can't see.
      const frame = { type: 'roster', roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId), joined: key, ...(existed && !same && prevSid ? { displaced: prevSid } : {}) };
      // A client putting itself back after a restart: the roster is only partly rebuilt.
      // The previous bundle prunes everyone a roster doesn't list, so tabs still on it
      // would hang up on each other — tell only the current bundle, which knows better.
      if (afterRestart) ctx.huddleSignalSend(huddleAudience(roomId, members), frame);
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

    // The host takes someone out of the call. They are told, everyone else's roster
    // drops them at once, and they stay out until the huddle ends or the host invites
    // them back. A member keeps the conversation; only the call is closed to them.
    if (type === 'remove') {
      const target = String(req.body?.to || '');
      if (!inCall || huddleHostOf(roomId) !== key) return res.status(403).json({ error: 'Only the host can remove someone from the huddle.' });
      if (!target || target === key) return res.status(400).json({ error: 'Choose someone else in the call.' });
      if (!huddles.get(roomId).has(target)) return res.status(404).json({ error: 'They are not in the huddle.' });
      if (!huddleBanned.has(roomId)) huddleBanned.set(roomId, new Set());
      huddleBanned.get(roomId).add(target);
      huddleRemove(roomId, target);
      const dropped = huddleDroppedLegacy.get(roomId);
      if (dropped) dropped.delete(target);
      // A guest's grant goes with them.
      const guests = huddleGuests.get(roomId);
      if (guests) guests.delete(target);
      // Told directly, so their page hangs up instead of reading the roster as a network
      // problem and rejoining. Kept for a reconnecting stream, like any other frame.
      ctx.huddleSignalSend([target], { type: 'removed', roomId, from: key, fromName: name });
      huddleEmit(huddleAudience(roomId, members), { type: 'roster', roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId), left: target, removed: true });
      console.log('[huddle]', key, 'removed', target, 'from the huddle in room', roomId);
      return res.json({ ok: true });
    }

    // A reaction, shown to everyone in the call over whoever sent it. Only to people in
    // the call — the rest of the room never hears it — and never replayed late.
    if (type === 'reaction') {
      if (!inCall) return res.status(409).json({ error: 'Join the huddle to react.' });
      const emoji = String((req.body?.data || {}).emoji || '');
      if (!HUDDLE_REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Unknown reaction' });
      if (!huddleReactAllowed(roomId, key)) return res.status(429).json({ error: 'Too many reactions — give it a moment.' });
      const others = [...huddles.get(roomId).keys()].filter(k => k !== key);
      ctx.huddleSignalLive(others, { type: 'reaction', roomId, from: key, fromName: name, emoji });
      return res.json({ ok: true });
    }
    // Who this participant has a working connection to. It is how a participant on
    // the previous bundle, which can't speak for itself, is known to be really there.
    if (type === 'alive' && inCall && Array.isArray(req.body?.data?.connected)) {
      const back = huddleVouch(roomId, req.body.data.connected);
      if (back.length) huddleEmit(huddleAudience(roomId, members), { type: 'roster', roomId, boot: HUDDLE_BOOT, participants: huddleRoster(roomId), started_at: huddleStartedAt(roomId) });
    }
    // The client's 15-second "still here". Answering whether we still count it in the
    // call lets a tab the sweep dropped (asleep, throttled) notice and rejoin — and the
    // sid lets a tab that this person's other device took over notice and step aside.
    // A tab on the previous bundle that took over has none: answer one that can't match.
    if (type === 'alive') return res.json({ ok: true, inCall, boot: HUDDLE_BOOT, sid: (huddleSids.get(roomId) || new Map()).get(key) || (inCall ? HUDDLE_ELSEWHERE : null) });
    // invite/offer/answer/ice/decline/media/restart are point-to-point
    const to = String(req.body?.to || '');
    // Someone the host removed. Only the host can ask them back — an invite from the
    // host lifts the removal; from anyone else it is refused and says why. Nothing
    // else is passed to them while they are out.
    if (huddleIsBanned(roomId, to)) {
      if (type !== 'invite') return res.status(400).json({ error: 'target not in this huddle' });
      if (huddleHostOf(roomId) !== key) return res.status(403).json({ error: 'The host removed them from this huddle.' });
      huddleBanned.get(roomId).delete(to);
    }
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
// 'remove': the host takes someone out of the call. 'reaction': an emoji everyone
// in the call sees.
const HUDDLE_TYPES = ['join', 'leave', 'invite', 'decline', 'offer', 'answer', 'ice', 'media', 'restart', 'alive', 'remove', 'reaction'];
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
// Who started each huddle — its host whenever they are in it (see huddleHostOf).
const huddleOwner = new Map();    // roomId -> memberKey
// Who the host took out of the call. They stay out — no rejoining, no signalling —
// until the huddle ends or the host invites them back.
const huddleBanned = new Map();   // roomId -> Set<memberKey>
// Each participant's recent reactions, for the rate limit (see huddleReactAllowed).
const huddleReacts = new Map();   // roomId -> Map<memberKey, [epoch ms]>
// The huddle_sessions row of each running huddle — the meeting its thread belongs to.
// Written in the background, so `id` arrives after the first join; wait on `ready`.
const huddleSession = new Map();  // roomId -> { id, ready: Promise<id|null>, error, keys: Set }
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
// Each entry says who is the host, so every roster, live list and join answer
// carries it without a field of its own to keep in step.
function huddleRoster(roomId) {
  const set = huddles.get(roomId);
  const sids = huddleSids.get(roomId);
  const host = huddleHostOf(roomId);
  return set ? [...set.entries()].map(([key, name]) => {
    const sid = sids && sids.get(key);
    const p = sid ? { key, name, sid } : { key, name };
    if (key === host) p.host = true;
    return p;
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
// roomId -> Set<sid>: pages that someone else took the place of — the same person
// joining from another tab or device. One that tries to put itself back is told to
// step aside (see the join handler); the newer one keeps the call.
const huddleDisplaced = new Map();
const HUDDLE_DISPLACED_MAX = 50;
// Placeholder sid for "held by a page that isn't you" — a tab on the previous bundle
// has no sid of its own to show.
const HUDDLE_ELSEWHERE = 'elsewhere';
function huddleDisplace(roomId, sid) {
  if (!huddleDisplaced.has(roomId)) huddleDisplaced.set(roomId, new Set());
  const set = huddleDisplaced.get(roomId);
  set.add(sid);
  if (set.size > HUDDLE_DISPLACED_MAX) set.delete(set.values().next().value);
}
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
    if (typeof k !== 'string' || huddleIsBanned(roomId, k)) continue;
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
      // The last one out ends the huddle: its meeting is over, and whoever the host
      // removed may be in the next one.
      huddleSessionClose(roomId);
      for (const m of [huddles, huddleGuests, huddleStarted, huddleDroppedLegacy, huddleDisplaced, huddleOwner, huddleBanned, huddleReacts, ...HUDDLE_PER_KEY]) m.delete(roomId);
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
//     closed. This is how a closed tab normally goes; or
//   • everyone else in the call is on this bundle, one of them has been pinging
//     without a break for 10 minutes, and in all that time nobody has reported a
//     working connection to it (counted from when it joined, or from the last report).
//     This is for a closed tab whose login keeps another old tab open in the same
//     browser: the two can't be told apart by their streams. Slow on purpose: the
//     previous bundle hears signalling only while its Chat page is open, so a live tab
//     looking at another page can't be reached for a while, and is reached as soon as
//     it is back. If it comes back later still, peers on this bundle are still offering
//     (they keep the pair for the readmission window), and its answer puts it back.
// Never while another tab on the previous bundle is in the call: the two may well be
// talking, and nothing here can see that. A lone entry is left alone too — it may be
// a real person waiting. What is left is a closed tab of a login that keeps another old
// tab open, alone in the call or next to another old tab: it stays until those close.
const HUDDLE_LEGACY_VOUCH_MS = 90_000;
const HUDDLE_LEGACY_TAB_MS = 180_000;
const HUDDLE_LEGACY_UNREACHED_MS = 10 * 60_000;
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
  const watchFrom = huddleWatched(roomId, now);
  if (watchFrom === null) return null;
  const sids = huddleSids.get(roomId) || new Map();
  const others = [...(huddles.get(roomId) || new Map()).keys()].filter(k => k !== key);
  if (others.every(k => sids.has(k)) && now - Math.max(joined, heard, watchFrom) > HUDDLE_LEGACY_UNREACHED_MS) return 'nobody has reached it for 10 minutes';
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

// ── The host ──────────────────────────────────────────────────────────────────
// Whoever started the huddle runs it while they are in it. When they are not — they
// left, reloaded, or the sweep dropped them — it is whoever has been in the call the
// longest (the roster keeps join order), and it comes back to them when they return:
// starting a call and stepping out for a minute must not hand it over for good.
function huddleHostOf(roomId) {
  const set = huddles.get(roomId);
  if (!set || !set.size) return null;
  const owner = huddleOwner.get(roomId);
  return owner && set.has(owner) ? owner : set.keys().next().value;
}
function huddleIsBanned(roomId, key) { return !!key && (huddleBanned.get(roomId) || new Set()).has(key); }
const HUDDLE_REMOVED = 'The host removed you from this huddle.';

// ── Reactions ─────────────────────────────────────────────────────────────────
// A fixed set, the same one the call's picker offers: anything else is refused, so
// a reaction can't be made to carry text. Limited per person, so a held-down button
// can't fill everyone's screen.
const HUDDLE_REACTIONS = ['👍', '👏', '❤️', '😂', '🎉', '😮', '🙌', '✋'];
const HUDDLE_REACT_WINDOW_MS = 5000;
const HUDDLE_REACT_MAX = 8;
function huddleReactAllowed(roomId, key, now = Date.now()) {
  if (!huddleReacts.has(roomId)) huddleReacts.set(roomId, new Map());
  const per = huddleReacts.get(roomId);
  const recent = (per.get(key) || []).filter(t => now - t < HUDDLE_REACT_WINDOW_MS);
  const ok = recent.length < HUDDLE_REACT_MAX;
  if (ok) recent.push(now);
  per.set(key, recent);
  return ok;
}

// ── Meeting threads ───────────────────────────────────────────────────────────
// Every huddle is a session — from its first join to its last leave — and carries a
// thread: text the people in the call write to each other, kept after it ends
// (migration 024). Whoever is in the conversation can read and add to it, and so can
// anyone who was in the call; a guest pulled in from outside keeps the thread of the
// meeting they were in, never the room's messages.
const HUDDLE_THREAD_MAX = 4000;   // characters in one thread message
let huddleThreadsWarned = false;
function huddleThreadsMissing(e) {
  if (!e || !isMissingRelation(e)) return false;
  if (!huddleThreadsWarned) {
    huddleThreadsWarned = true;
    console.warn('[huddle] meeting threads are off until migrations/024_huddles_and_group_pictures.sql is applied');
  }
  return true;
}
function huddleThreadsFail(res, e) {
  if (huddleThreadsMissing(e)) {
    return res.status(503).json({ error: 'Meeting threads need migrations/024_huddles_and_group_pictures.sql applied first.', migration: '024' });
  }
  console.warn('[huddle] thread request failed:', e && e.message);
  return res.status(500).json({ error: (e && e.message) || 'Could not read the thread.' });
}

// Sessions this process is closing right now. A huddle started in the same room in
// that moment must not take one for a session a crash left open (see below).
const huddleClosing = new Set();

// The row is written in the background: the first join must not wait on the database,
// and a database without the tables still gets its call.
function huddleSessionOpen(roomId, key, name, afterRestart) {
  const entry = { id: null, error: null, keys: new Set() };
  const startedAt = huddleStartedAt(roomId) || Date.now();
  entry.ready = (async () => {
    try {
      // A restart forgot the call, not the meeting: pick its open session back up, and
      // with it who started it and when.
      if (afterRestart) {
        const { data, error } = await supabase.from('huddle_sessions').select('id,host_key,started_at')
          .eq('room_id', roomId).is('ended_at', null).order('started_at', { ascending: false }).limit(1);
        if (error) throw error;
        const row = data && data[0];
        if (row) {
          entry.id = row.id;
          if (huddleSession.get(roomId) === entry) {
            huddleOwner.set(roomId, row.host_key);
            const t = Date.parse(row.started_at);
            if (!isNaN(t)) huddleStarted.set(roomId, Math.min(t, huddleStarted.get(roomId) || t));
          }
          await huddleSessionsSettle(roomId, row.id);
          return entry.id;
        }
      }
      await huddleSessionsSettle(roomId, null);
      const { data, error } = await supabase.from('huddle_sessions')
        .insert({ room_id: roomId, host_key: key, host_name: name, started_at: new Date(startedAt).toISOString() })
        .select('id').single();
      if (error) throw error;
      entry.id = data.id;
      return entry.id;
    } catch (e) {
      entry.error = e;
      if (!huddleThreadsMissing(e)) console.warn('[huddle] could not record the huddle in room', roomId, '-', e.message);
      return null;
    }
  })();
  huddleSession.set(roomId, entry);
  return entry;
}
// Sessions a crash left open in this room, but the one being carried on. Each is
// ended when it was last written in, or as it started — not now, which would make a
// call that died yesterday look a day long.
async function huddleSessionsSettle(roomId, keepId) {
  const { data, error } = await supabase.from('huddle_sessions').select('id,started_at').eq('room_id', roomId).is('ended_at', null);
  if (error) throw error;
  for (const s of data || []) {
    if (s.id === keepId || huddleClosing.has(s.id)) continue;
    const { data: last } = await supabase.from('huddle_messages').select('created_at')
      .eq('session_id', s.id).order('created_at', { ascending: false }).limit(1);
    await supabase.from('huddle_sessions').update({ ended_at: (last && last[0] && last[0].created_at) || s.started_at }).eq('id', s.id);
  }
}
// Everyone who was ever in the call, once each — the record a guest's access rests on.
function huddleSessionJoin(roomId, key, name) {
  const entry = huddleSession.get(roomId);
  if (!entry || entry.keys.has(key)) return;
  entry.keys.add(key);
  entry.ready.then(async id => {
    if (!id) return;
    const { error } = await supabase.from('huddle_participants')
      .upsert({ session_id: id, member_key: key, member_name: name }, { onConflict: 'session_id,member_key' });
    if (error && !huddleThreadsMissing(error)) console.warn('[huddle] could not record a participant:', error.message);
  }).catch(() => {});
}
function huddleSessionClose(roomId) {
  const entry = huddleSession.get(roomId);
  if (!entry) return;
  huddleSession.delete(roomId);
  const endedAt = new Date().toISOString();
  entry.ready.then(async id => {
    if (!id) return;
    huddleClosing.add(id);
    try {
      const { error } = await supabase.from('huddle_sessions').update({ ended_at: endedAt }).eq('id', id);
      if (error && !huddleThreadsMissing(error)) console.warn('[huddle] could not close the huddle record:', error.message);
    } finally { huddleClosing.delete(id); }
  }).catch(() => {});
}

// May this person read and write a session's thread? { session, members, live } if
// so, { status } if not, { error } when the database could not say.
async function huddleThreadAccess(sessionId, key) {
  if (!sessionId) return { status: 404 };
  const { data: session, error } = await supabase.from('huddle_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error) return { error };
  if (!session) return { status: 404 };
  const members = await huddleRoomMembers(session.room_id);
  const running = huddleSession.get(session.room_id);
  const live = !!(running && running.id === session.id);
  if (members.includes(key) || (live && huddleMaySignal(session.room_id, key, members))) return { session, members, live };
  const { data: was, error: e2 } = await supabase.from('huddle_participants').select('member_key')
    .eq('session_id', session.id).eq('member_key', key).maybeSingle();
  if (e2) return { error: e2 };
  return was ? { session, members, live } : { status: 403 };
}

// The sessions behind the history list: those in this person's conversations, and
// those they were in as a guest.
async function huddleThreadsFor(key, roomId, limit) {
  const [{ data: mine, error: e1 }, { data: took, error: e2 }] = await Promise.all([
    supabase.from('chat_room_members').select('room_id').eq('member_key', key),
    supabase.from('huddle_participants').select('session_id').eq('member_key', key)
      .order('session_id', { ascending: false }).limit(200),
  ]);
  if (e2) throw e2;
  if (e1) throw e1;
  const rooms = (mine || []).map(m => m.room_id).filter(r => !roomId || r === roomId);
  const ids = (took || []).map(p => p.session_id);
  const reads = [];
  if (rooms.length) reads.push(supabase.from('huddle_sessions').select('*').in('room_id', rooms).order('started_at', { ascending: false }).limit(limit));
  if (ids.length) {
    let q = supabase.from('huddle_sessions').select('*').in('id', ids);
    if (roomId) q = q.eq('room_id', roomId);
    reads.push(q.order('started_at', { ascending: false }).limit(limit));
  }
  const byId = new Map();
  for (const { data, error } of await Promise.all(reads)) {
    if (error) throw error;
    for (const s of data || []) byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, limit);
}

// What a conversation is called for this person: a group's name, or the other people
// in a direct one.
function huddleThreadTitle(room, members, key) {
  if (!room) return 'Huddle';
  if (room.type === 'group') return room.name || 'Group';
  const others = members.filter(m => m.member_key !== key).map(m => m.member_name);
  return others.join(' & ') || 'Direct message';
}
async function huddleThreadSummaries(sessions, key) {
  if (!sessions.length) return [];
  const ids = sessions.map(s => s.id);
  const roomIds = [...new Set(sessions.map(s => s.room_id))];
  const [parts, msgs, rooms, mems] = await Promise.all([
    supabase.from('huddle_participants').select('session_id,member_key,member_name').in('session_id', ids),
    fetchAll(() => supabase.from('huddle_messages').select('id,session_id').in('session_id', ids)),
    supabase.from('chat_rooms').select('*').in('id', roomIds),
    supabase.from('chat_room_members').select('room_id,member_key,member_name').in('room_id', roomIds),
  ]);
  for (const r of [parts, msgs]) if (r.error) throw r.error;
  const count = new Map();
  for (const m of msgs.data || []) count.set(m.session_id, (count.get(m.session_id) || 0) + 1);
  const roomOf = new Map((rooms.data || []).map(r => [r.id, r]));
  const membersOf = new Map();
  for (const m of mems.data || []) {
    if (!membersOf.has(m.room_id)) membersOf.set(m.room_id, []);
    membersOf.get(m.room_id).push(m);
  }
  return sessions.map(s => {
    const room = roomOf.get(s.room_id) || null;
    const running = huddleSession.get(s.room_id);
    return {
      id: s.id, room_id: s.room_id,
      title: huddleThreadTitle(room, membersOf.get(s.room_id) || [], key),
      room: room ? { id: room.id, type: room.type, name: room.name || '', avatar_url: room.avatar_url || '', icon: room.icon || '' } : null,
      host_key: s.host_key, host_name: s.host_name || '',
      started_at: s.started_at, ended_at: s.ended_at || null,
      live: !!(running && running.id === s.id),
      participants: (parts.data || []).filter(p => p.session_id === s.id).map(p => ({ key: p.member_key, name: p.member_name })),
      message_count: count.get(s.id) || 0,
    };
  });
}
// One thread, ready to show: the session and its newest 500 messages, oldest first.
async function huddleThreadPayload(session, key) {
  const [[summary], msgs, profiles] = await Promise.all([
    huddleThreadSummaries([session], key),
    supabase.from('huddle_messages').select('*').eq('session_id', session.id).order('created_at', { ascending: false }).limit(500),
    chatProfileMap(),
  ]);
  if (msgs.error) throw msgs.error;
  const messages = (msgs.data || []).reverse().map(m => ({ ...m, sender_avatar: (profiles[m.sender_key] || {}).avatar || null }));
  return { session: summary, messages };
}

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
