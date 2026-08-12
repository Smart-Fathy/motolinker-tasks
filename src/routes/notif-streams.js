// Notification Center streams
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { chatCallerIdentity, express, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('chatCallerIdentity', 'express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const chatCreateOrGetDirect = (...a) => ctx.chatCreateOrGetDirect(...a);
const chatListRooms = (...a) => ctx.chatListRooms(...a);

// ─── Notification Center streams + REST (both portals) ────────────────────────
function openNotifStream(key, res, reqObj) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(':ok\n\n');
  ctx.notifSseClients.set(key, res);
  console.log('[notif-sse] connected', key);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  reqObj.on('close', () => { clearInterval(ka); ctx.notifSseClients.delete(key); });
}

async function listNotifications(memberKey, res) {
  try {
    const { data } = await supabase.from('notifications')
      .select('*').eq('member_key', memberKey).order('created_at', { ascending: false }).limit(50);
    const items = data || [];
    res.json({ items, unread: items.filter(n => !n.read).length });
  } catch (_) { res.json({ items: [], unread: 0 }); }
}

async function markNotificationsRead(memberKey, body, res) {
  try {
    let q = supabase.from('notifications').update({ read: true }).eq('member_key', memberKey);
    if (body?.id) q = q.eq('id', body.id);
    else q = q.eq('read', false);
    await q;
    res.json({ ok: true });
  } catch (_) { res.json({ ok: true }); }
}

// Employee
receiver.router.get('/api/employee/notifications/stream', requireEmployeeAuth, (req, res) =>
  openNotifStream(`employee_${req.employee.id}`, res, req));
receiver.router.get('/api/employee/notifications', requireEmployeeAuth, (req, res) =>
  listNotifications(`employee_${req.employee.id}`, res));
receiver.router.post('/api/employee/notifications/read', requireEmployeeAuth, express.json(), (req, res) =>
  markNotificationsRead(`employee_${req.employee.id}`, req.body, res));

// Admin
receiver.router.get('/api/dashboard/notifications/stream', requireAuth, (req, res) =>
  openNotifStream('admin', res, req));
receiver.router.get('/api/dashboard/notifications', requireAuth, (req, res) =>
  listNotifications('admin', res));
receiver.router.post('/api/dashboard/notifications/read', requireAuth, express.json(), (req, res) =>
  markNotificationsRead('admin', req.body, res));

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

receiver.router.get('/api/employee/chat/people', requireEmployeeAuth, async (req, res) => {
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
receiver.router.get('/api/employee/chat/rooms', requireEmployeeAuth, async (req, res) => {
  try { res.json(await chatListRooms(`employee_${req.employee.id}`)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rooms — direct
receiver.router.post('/api/dashboard/chat/rooms/direct', requireAuth, express.json(), async (req, res) => {
  const { targetKey, targetName } = req.body || {};
  if (!targetKey || !targetName) return res.status(400).json({ error: 'targetKey and targetName required' });
  try { res.json(await chatCreateOrGetDirect('admin', 'Admin', targetKey, targetName)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
receiver.router.post('/api/employee/chat/rooms/direct', requireEmployeeAuth, express.json(), async (req, res) => {
  const { targetKey, targetName } = req.body || {};
  if (!targetKey || !targetName) return res.status(400).json({ error: 'targetKey and targetName required' });
  const { key, name } = chatCallerIdentity(req);
  try { res.json(await chatCreateOrGetDirect(key, name, targetKey, targetName)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});


module.exports = { chatPeopleKeys };
