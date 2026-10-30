// Notification Center streams
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { createNotificationsService } = require('../modules/notifications');
const { chatCallerIdentity, express, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('chatCallerIdentity', 'express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const chatCreateOrGetDirect = (...a) => ctx.chatCreateOrGetDirect(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const chatListRooms = (...a) => ctx.chatListRooms(...a);

// ─── Notification Center streams + REST (both portals) ────────────────────────
function openNotifStream(key, res, reqObj) {
  // The tab may have gone while its login was being checked (after a restart that is
  // a Supabase round trip). Its 'close' has already fired and won't fire again, so a
  // stream registered now would stay registered — and counted as an open tab — for good.
  if (reqObj.destroyed || res.destroyed || (res.socket && res.socket.destroyed)) return;
  res.set(ctx.SSE_HEADERS);
  res.flushHeaders();
  // Reconnect after a second, not the browser's default three: huddle signalling
  // rides this stream now, and a dropped frame waits out the gap.
  res.write('retry: 1000\n:ok\n\n');
  // Every tab keeps its own stream (see notifAdd), and closing one removes only
  // that one — a reconnect racing the old socket's close can't evict the new.
  // A stream without ?hd=2 comes from a tab still on the previous bundle.
  res.hdLegacy = reqObj.query.hd !== '2';
  res.hdTag = ctx.notifTokenTag(reqObj);
  ctx.notifAdd(key, res);
  // A reconnect names the last huddle frame it saw; send it whatever it missed.
  const replayed = ctx.huddleSignalReplay(key, res, reqObj.headers['last-event-id'] || reqObj.query.hs);
  console.log('[notif-sse] connected', key, replayed ? `(replayed ${replayed} huddle frame(s))` : '');
  let ka = null;
  const done = () => { clearInterval(ka); ctx.notifRemove(key, res); };
  // A ping that can't be written is a stream that is gone, 'close' or not.
  ka = setInterval(() => { try { res.write(':ping\n\n', err => { if (err) done(); }); } catch (_) { done(); } }, 25000);
  reqObj.on('close', done);
}

// The list and "mark read" are one piece of code for both portals and for /api/v1 (src/modules/notifications); these two
// adapt it to what the classic pages have always been told. They answer an empty list and ok when the database cannot be asked.
const notifications = createNotificationsService({ supabase });

async function listNotifications(actor, res) {
  try {
    const { rows, unread } = await notifications.list(actor);
    res.json({ items: rows, unread });
  } catch (_) { res.json({ items: [], unread: 0 }); }
}

async function markNotificationsRead(actor, body, res) {
  try { await notifications.markRead(actor, body?.id ? { id: body.id } : { all: true }); } catch (_) { /* the bell does not mind */ }
  res.json({ ok: true });
}

// Employee
receiver.router.get('/api/employee/notifications/stream', requireEmployeeAuth, (req, res) =>
  openNotifStream(`employee_${req.employee.id}`, res, req));
receiver.router.get('/api/employee/notifications', requireEmployeeAuth, (req, res) =>
  listNotifications(req.actor, res));
receiver.router.post('/api/employee/notifications/read', requireEmployeeAuth, express.json(), (req, res) =>
  markNotificationsRead(req.actor, req.body, res));

// Admin
receiver.router.get('/api/dashboard/notifications/stream', requireAuth, (req, res) =>
  openNotifStream('admin', res, req));
receiver.router.get('/api/dashboard/notifications', requireAuth, (req, res) =>
  listNotifications(req.actor, res));
receiver.router.post('/api/dashboard/notifications/read', requireAuth, express.json(), (req, res) =>
  markNotificationsRead(req.actor, req.body, res));

// Everyone who can be reached in this workspace — used to validate a huddle guest
async function chatPeopleKeys() {
  const { data } = await supabase.from('employees').select('id');
  return ['admin', ...(data || []).map(e => `employee_${e.id}`)];
}

// People lists
receiver.router.get('/api/dashboard/chat/people', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('employees').select('id, name').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(e => ({ key: `employee_${e.id}`, name: e.name, role: 'Employee' })));
});

receiver.router.get('/api/employee/chat/people', requireEmployeeAuth, requirePerm('chat', 'view'), async (req, res) => {
  const { data, error } = await supabase.from('employees').select('id, name').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json([
    { key: 'admin', name: 'Admin', role: 'Admin' },
    ...(data || []).filter(e => e.id !== req.employee.id).map(e => ({ key: `employee_${e.id}`, name: e.name, role: 'Employee' })),
  ]);
});

// Rooms — list
receiver.router.get('/api/dashboard/chat/rooms', requireAuth, async (_req, res) => {
  try { res.json(await chatListRooms('admin')); } catch (e) { res.status(500).json({ error: e.message }); }
});
receiver.router.get('/api/employee/chat/rooms', requireEmployeeAuth, requirePerm('chat', 'view'), async (req, res) => {
  try { res.json(await chatListRooms(`employee_${req.employee.id}`)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rooms — direct
receiver.router.post('/api/dashboard/chat/rooms/direct', requireAuth, express.json(), async (req, res) => {
  const { targetKey, targetName } = req.body || {};
  if (!targetKey || !targetName) return res.status(400).json({ error: 'targetKey and targetName required' });
  try { res.json(await chatCreateOrGetDirect('admin', 'Admin', targetKey, targetName)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
receiver.router.post('/api/employee/chat/rooms/direct', requireEmployeeAuth, requirePerm('chat', 'send'), express.json(), async (req, res) => {
  const { targetKey, targetName } = req.body || {};
  if (!targetKey || !targetName) return res.status(400).json({ error: 'targetKey and targetName required' });
  const { key, name } = chatCallerIdentity(req);
  try { res.json(await chatCreateOrGetDirect(key, name, targetKey, targetName)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});


module.exports = { chatPeopleKeys };
