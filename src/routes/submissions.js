// Form Submissions
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, logLeadActivity, normalizePhone, receiver, requireAuth, supabase } = ctx.need('express', 'logLeadActivity', 'normalizePhone', 'receiver', 'requireAuth', 'supabase');
// Reassigned at runtime (Drive connect/disconnect, VAPID boot), so these are
// read from the context on use — capturing them here would pin the boot value.

// ─── Form Submissions ─────────────────────────────────────────────────────────
// Public endpoint — no auth required (customers submit from the website).
// Every submission is persisted AND turned into a lead (deduped on normalized phone),
// so inbound inquiries land in the CRM instead of vanishing.
// CORS is open on THIS route only so the marketing website can POST the form
// straight from the browser (any other origin). All other /api routes stay same-origin.
function submissionCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '86400');
}
receiver.router.options('/api/submissions', (_req, res) => { submissionCors(res); res.sendStatus(204); });
receiver.router.post('/api/submissions', express.json(), async (req, res) => {
  submissionCors(res);
  const { name, email, phone, message, car_interest, source } = req.body || {};
  if (!name || (!email && !phone)) return res.status(400).json({ error: 'Name and a phone or email are required' });
  const cleanName = String(name).trim();
  const cleanEmail = email ? String(email).trim() : '';
  const cleanPhone = phone ? String(phone).trim() : '';
  const cleanMsg = message ? String(message).trim() : '';
  const cleanCar = car_interest ? String(car_interest).trim() : '';
  const src = (source ? String(source).trim() : '') || 'website';
  const phone_norm = normalizePhone(cleanPhone);
  try {
    let customerId = null, isNew = false;
    if (phone_norm) {
      const { data: existing } = await supabase.from('customers').select('id').eq('phone_norm', phone_norm).limit(1);
      if (existing && existing.length) customerId = existing[0].id;
    }
    if (customerId) {
      // Known lead re-inquired — fill any blanks, then log it to the timeline (no duplicate lead).
      const patch = {};
      if (cleanEmail) patch.email = cleanEmail;
      if (cleanCar) patch.car_in_question = cleanCar;
      if (Object.keys(patch).length) await supabase.from('customers').update(patch).eq('id', customerId);
      logLeadActivity(customerId, { type: 'system', body: `Re-inquiry via ${src}${cleanMsg ? ' — ' + cleanMsg : ''}`, meta: { source: src }, authorKey: 'system', authorName: 'System' });
    } else {
      const { data: lead } = await supabase.from('customers').insert({
        name: cleanName, phone: cleanPhone, phone_norm, email: cleanEmail,
        source: src, lead_status: 'warm', car_in_question: cleanCar,
        inquiry: cleanMsg, notes: cleanMsg, created_by: 'web_form',
      }).select().single();
      if (lead) {
        customerId = lead.id; isNew = true;
        logLeadActivity(customerId, { type: 'system', body: `Lead created · ${src}`, meta: { source: src }, authorKey: 'system', authorName: 'System' });
      }
    }
    // Persist the raw submission (audit trail), linked to the lead it created/matched.
    const { data: sub } = await supabase.from('form_submissions').insert({
      name: cleanName, email: cleanEmail, phone: cleanPhone, message: cleanMsg,
      car_interest: cleanCar, source: src, customer_id: customerId,
    }).select().single();
    createNotification('admin', {
      type: 'lead',
      title: isNew ? `New website lead: ${cleanName}` : `Re-inquiry: ${cleanName}`,
      body: [cleanPhone && `Phone: ${cleanPhone}`, cleanCar && `Interest: ${cleanCar}`, cleanMsg].filter(Boolean).join(' · ') || 'New website submission',
      url: customerId ? '/dashboard#customers' : '/dashboard#submissions',
    }, 'always').catch(() => {});
    if (sub) runAutomations('submission.created', submissionCtx(sub, customerId));
    res.json({ ok: true, id: sub?.id, customer_id: customerId, lead_created: isNew });
  } catch (e) {
    console.error('[submissions]', e);
    res.status(500).json({ error: e.message });
  }
});

// Admin — list all submissions (with the linked lead name)
receiver.router.get('/api/submissions', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('form_submissions')
    .select('*, customers(name)').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(s => ({ ...s, submitted_at: s.created_at, lead_name: s.customers?.name || '' })));
});

// Admin — delete a submission
receiver.router.delete('/api/submissions/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('form_submissions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

async function sendDueDateReminders() {
  if (!ctx.vapidKeys) return;
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const [{ data: dueTomorrow }, { data: overdue }] = await Promise.all([
    supabase.from('tasks').select('id,title,assignee_id,assignee_ids').eq('due_date', tomorrow).neq('status', 'done'),
    supabase.from('tasks').select('id,title,assignee_id,assignee_ids').lt('due_date', today).neq('status', 'done'),
  ]);
  const remind = async (t, title) => {
    for (const aid of taskAssigneeList(t)) {
      const key = await memberKeyForAssignee(aid);
      if (key) createNotification(key, { type: 'reminder', title, body: t.title, url: '/employee#tasks' }, 'offline');
    }
  };
  for (const t of dueTomorrow || []) await remind(t, 'Task due tomorrow');
  for (const t of overdue || []) await remind(t, 'Overdue task');
}

function scheduleDueDateReminders() {
  const now    = new Date();
  const next9  = new Date(now);
  next9.setHours(9, 0, 0, 0);
  if (next9 <= now) next9.setDate(next9.getDate() + 1);
  setTimeout(() => {
    sendDueDateReminders().catch(console.error);
    setInterval(() => sendDueDateReminders().catch(console.error), 24 * 60 * 60 * 1000);
  }, next9 - now);
}

async function sendHoursLogReminder() {
  const today = new Date().toISOString().split('T')[0];
  const [{ data: allEmps }, { data: logsToday }] = await Promise.all([
    supabase.from('employees').select('id,name'),
    supabase.from('hours_logs').select('employee_id').eq('log_date', today),
  ]);
  const loggedIds = new Set((logsToday || []).map(l => l.employee_id));
  for (const emp of allEmps || []) {
    if (loggedIds.has(emp.id)) continue;
    if (ctx.vapidKeys) createNotification(`employee_${emp.id}`, {
      type: 'hours',
      title: 'Log your hours',
      body: "Please log today's working hours before you leave.",
      url: '/employee#log',
    }, 'offline');
    runAutomations('hours.not_logged', hoursCtx(emp)); // let admins customize what happens
  }
}

function scheduleHoursLogReminder() {
  const hour = parseInt(process.env.HOURS_REMINDER_UTC_HOUR || '15', 10);
  const now  = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(() => {
    sendHoursLogReminder().catch(console.error);
    setInterval(() => sendHoursLogReminder().catch(console.error), 24 * 60 * 60 * 1000);
  }, next - now);
}


module.exports = { scheduleDueDateReminders, scheduleHoursLogReminder };
