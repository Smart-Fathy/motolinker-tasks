// Form Submissions
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { createSubmissionsService } = require('../modules/submissions');
const { createLimiter } = require('../lib/rate-limit');
const { clientIp } = require('../lib/request-info');
const { express, logLeadActivity, normalizePhone, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'logLeadActivity', 'normalizePhone', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// automation.js builds the automation payloads; resolved through the context
// because feature modules do not have a fixed load order between them.
const hoursCtx = (...a) => ctx.hoursCtx(...a);
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const createNotification = (...a) => ctx.createNotification(...a);
const memberKeyForAssignee = (...a) => ctx.memberKeyForAssignee(...a);
const runAutomations = (...a) => ctx.runAutomations(...a);
const submissionCtx = (...a) => ctx.submissionCtx(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const taskAssigneeList = (...a) => ctx.taskAssigneeList(...a);
const tooMany = (...a) => ctx.tooMany(...a);
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
// Every post costs something real — a lead, a submission row, a push to the admin's
// phone, the automation rules — so each address gets ten a quarter-hour; a person
// sends this once or twice. The website forwards each lead from its Cloudflare Worker
// (src/lib/crm/forwardLead.ts in Smart-Fathy/motolinkers). Sent to an origin outside
// Cloudflare, as Railway is, that request carries the visitor's address in
// CF-Connecting-IP, so this counts visitors, not the website. Put this app behind a
// Cloudflare-proxied domain and every lead would carry the same Worker address instead,
// making the ten the whole site's. The header is also the caller's word (see
// request-info.js): this stops a script hammering the form, not someone forging a new
// address on every post.
const submissionLimiter = createLimiter({ max: 10, windowMs: 15 * 60_000 });
// Longer than any real answer to the form, short enough that one post cannot fill a
// lead, its timeline and the admin's notifications with pages of text.
const SUBMISSION_FIELD_MAX = { name: 120, email: 200, phone: 40, car_interest: 120, message: 4000, source: 60 };
// Trimmed, then cut to `max`. A cut that would split an emoji's surrogate pair stops one
// short: half a pair is not text, and Postgres refuses the whole row over it.
function clip(v, max) {
  const s = v ? String(v).trim() : '';
  if (s.length <= max) return s;
  return s.slice(0, /[\uD800-\uDBFF]/.test(s[max - 1]) ? max - 1 : max).trim();
}
const isBlank = v => v == null || String(v).trim() === '';

receiver.router.options('/api/submissions', (_req, res) => { submissionCors(res); res.sendStatus(204); });
// Ahead of the body parser, so a flood is turned away before its bodies are read; and
// after the CORS headers, so a browser can read the 429.
function submissionGate(req, res, next) {
  submissionCors(res);
  const ip = clientIp(req);
  const wait = submissionLimiter.retryAfter(ip);
  if (wait) return tooMany(res, wait);
  submissionLimiter.fail(ip);   // every post counts, not just bad ones
  next();
}
receiver.router.post('/api/submissions', submissionGate, express.json({ limit: '16kb' }), async (req, res) => {
  const { name, email, phone, message, car_interest, source } = req.body || {};
  if (!name || (!email && !phone)) return res.status(400).json({ error: 'Name and a phone or email are required' });
  const cleanName = clip(name, SUBMISSION_FIELD_MAX.name);
  const cleanEmail = clip(email, SUBMISSION_FIELD_MAX.email);
  const cleanPhone = clip(phone, SUBMISSION_FIELD_MAX.phone);
  const cleanMsg = clip(message, SUBMISSION_FIELD_MAX.message);
  const cleanCar = clip(car_interest, SUBMISSION_FIELD_MAX.car_interest);
  const src = clip(source, SUBMISSION_FIELD_MAX.source) || 'website';
  const phone_norm = normalizePhone(cleanPhone);
  try {
    let customerId = null, known = null, isNew = false;
    if (phone_norm) {
      const { data: existing } = await supabase.from('customers').select('id,email,car_in_question').eq('phone_norm', phone_norm).limit(1);
      if (existing && existing.length) { known = existing[0]; customerId = known.id; }
    }
    if (customerId) {
      // Known lead re-inquired — fill any blanks, then log it to the timeline (no duplicate lead).
      // Blanks only: anyone who knows a customer's phone number can post this form, and
      // staff send quotations and contracts to the email on file. What was submitted is
      // still kept, in form_submissions below.
      const patch = {};
      if (cleanEmail && isBlank(known.email)) patch.email = cleanEmail;
      if (cleanCar && isBlank(known.car_in_question)) patch.car_in_question = cleanCar;
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
    // Success and nothing else. Echoing the customer id and whether a lead was created
    // told anyone holding a phone number whether its owner is a customer. The website
    // reads only the status.
    res.json({ ok: true });
  } catch (e) {
    console.error('[submissions]', e);
    res.status(500).json({ error: e.message });
  }
});

// Reading and clearing what the website sent us. Mounted for both portals over one
// set of handlers — see contracts.js for why. POST /api/submissions above stays
// where it is: that one is the public website form and has no session at all.
//
// There is no create or edit action, because nobody here writes a submission —
// the website does, and the only thing a person does to one is read it or bin it.
// The list and the delete are one piece of code for both portals and for /api/v1 (src/modules/submissions); these adapt it to
// what the classic pages have always been told: the rows with `submitted_at` and `lead_name` added, and a database's own
// words when it cannot be asked.
const submissions = createSubmissionsService({ supabase });

function mountSubmissionRoutes(base, guard) {
  receiver.router.get(base, guard, requirePerm('submissions', 'view'), async (_req, res) => {
    try {
      const rows = await submissions.list();
      res.json(rows.map(s => ({ ...s, submitted_at: s.created_at, lead_name: s.customers?.name || '' })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  receiver.router.delete(`${base}/:id`, guard, requirePerm('submissions', 'delete'), async (req, res) => {
    try {
      await submissions.remove(req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
mountSubmissionRoutes('/api/submissions', requireAuth);
mountSubmissionRoutes('/api/employee/submissions', requireEmployeeAuth);

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
