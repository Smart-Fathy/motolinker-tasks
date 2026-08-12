// No-code automation engine
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, logLeadActivity, normalizePhone, parseBudget, path, receiver, requireAuth, supabase } = ctx.need('express', 'logLeadActivity', 'normalizePhone', 'parseBudget', 'path', 'receiver', 'requireAuth', 'supabase');
// Registered on the context by a module that loads later, so these are looked
// up when called rather than when required.
const createNotification = (...a) => ctx.createNotification(...a);
const memberKeyForAssignee = (...a) => ctx.memberKeyForAssignee(...a);
// ─── No-code automation engine ──────────────────────────────────────────────────
// Config-driven trigger -> conditions -> actions rules (automation_rules table),
// fired best-effort from the lead/deal/quote mutation seams and an hourly sweep.
// Never throws into a request path.
function leadCtx(c) {
  return {
    entityType: 'lead', entityId: c.id, customerId: c.id, ownerId: c.assigned_to || null,
    fields: { name: c.name, phone: c.phone, source: c.source, lead_status: c.lead_status,
      car_in_question: c.car_in_question, budget_lead: c.budget_lead, been_contacted: c.been_contacted, assigned_to: c.assigned_to },
  };
}
function dealCtx(d) {
  return {
    entityType: 'deal', entityId: d.id, customerId: d.customer_id || null, ownerId: d.assigned_to || null,
    fields: { title: d.title, stage: d.stage, car_model: d.car_model, budget_egp: d.budget_egp,
      assigned_to: d.assigned_to, name: d.customers?.name, phone: d.customers?.phone, car_in_question: d.customers?.car_in_question, budget_lead: d.customers?.budget_lead },
  };
}
// ── Non-CRM automation contexts ──────────────────────────────────────────────
function taskCtx(t) {
  const primary = (Array.isArray(t.assignee_ids) && t.assignee_ids.length ? t.assignee_ids[0] : t.assignee_id) || null;
  return { entityType: 'task', entityId: t.id, customerId: null, ownerId: primary,
    fields: { title: t.title, priority: t.priority, status: t.status, milestone: t.milestone || '', assigned_to: primary, due_date: t.due_date } };
}
function requestCtx(r) {
  return { entityType: 'request', entityId: r.id, customerId: null, ownerId: r.assignee_id || null,
    fields: { title: r.title, priority: r.priority, status: r.status, category: r.category || '', assigned_to: r.assignee_id || null } };
}
function submissionCtx(s, customerId) {
  // The public form already creates/matches the lead (customerId), so lead-scoped
  // actions (assign, follow-up, …) work when it's linked.
  return { entityType: 'submission', entityId: s.id, customerId: customerId || null, ownerId: null,
    fields: { name: s.name, phone: s.phone, email: s.email, car_in_question: s.car_interest, source: s.source, message: s.message } };
}
function hoursCtx(emp) {
  return { entityType: 'hours', entityId: emp.id, customerId: null, ownerId: emp.id, fields: { name: emp.name } };
}
// Deep-link a notification to the right admin page for the entity that fired.
function autoNotifUrl(ctx) {
  switch (ctx.entityType) {
    case 'deal': return '/dashboard#deals';
    case 'task': return '/dashboard#tasks';
    case 'request': return '/dashboard#requests';
    case 'submission': return '/dashboard#submissions';
    case 'hours': return '/dashboard#hours';
    default: return '/dashboard#customers';
  }
}
function autoTmpl(str, ctx) {
  const f = ctx.fields || {};
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (f[k] != null ? String(f[k]) : ''));
}
function autoTarget(a, ctx) {
  const to = a.to || 'admin';
  if (to === 'owner') return ctx.ownerId ? `employee_${ctx.ownerId}` : 'admin';
  if (to === 'employee') return a.employee_id ? `employee_${a.employee_id}` : 'admin';
  return 'admin';
}
// Normalize a value for equality checks so a human-typed condition value matches the
// stored canonical key: "Quoted"→quoted, "Immediate Delivery"→immediate_delivery, "true"→true.
function autoNorm(s) { return String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function automationMatches(rule, ctx) {
  const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
  const vals = { ...(ctx.fields || {}), from: ctx.from, to: ctx.to };
  return conds.every(c => {
    const cur = vals[c.field], v = c.value;
    switch (c.op) {
      case 'equals': return autoNorm(cur) === autoNorm(v);
      case 'not_equals': return autoNorm(cur) !== autoNorm(v);
      case 'contains': return String(cur ?? '').toLowerCase().includes(String(v ?? '').toLowerCase());
      case 'changed_to': return autoNorm(ctx.to) === autoNorm(v);
      case 'gt': return Number(cur) > Number(v);
      case 'lt': return Number(cur) < Number(v);
      case 'is_empty': return !cur;
      case 'not_empty': return !!cur;
      default: return true;
    }
  });
}
async function autoRoundRobin() {
  const { data: emps } = await supabase.from('employees').select('id').order('id', { ascending: true });
  if (!emps || !emps.length) return null;
  let cursor = 0;
  try { const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'automation_rr_cursor').single(); cursor = parseInt(data?.value || '0', 10) || 0; } catch (_) {}
  const pick = emps[cursor % emps.length].id;
  await supabase.from('quotation_settings').upsert({ key: 'automation_rr_cursor', value: String((cursor + 1) % 1000000) }, { onConflict: 'key' }).then(() => {}).catch(() => {});
  return pick;
}
// Destructive automations don't delete directly — they file a pending deletion_request
// for an admin to approve (same flow as an employee-requested deletion). Returns true if a
// new request was created (false if one is already pending or the entity is gone).
async function autoRequestDeletion(entity_type, entity_id, ruleName) {
  let label = '';
  if (entity_type === 'lead') {
    const { data } = await supabase.from('customers').select('name,phone').eq('id', entity_id).single();
    if (!data) return false;
    label = data.name + (data.phone ? ' · ' + data.phone : '');
  } else {
    const { data } = await supabase.from('deals').select('title, customers(name)').eq('id', entity_id).single();
    if (!data) return false;
    label = data.title + (data.customers?.name ? ' · ' + data.customers.name : '');
  }
  const { data: existing } = await supabase.from('deletion_requests').select('id').eq('entity_type', entity_type).eq('entity_id', entity_id).eq('status', 'pending').limit(1);
  if (existing && existing.length) return false; // already awaiting approval
  await supabase.from('deletion_requests').insert({ entity_type, entity_id, entity_label: label, requested_by: 'automation', reason: `Automation: ${ruleName || 'rule'}`, status: 'pending' });
  return true;
}
async function runAutomationAction(a, ctx, ruleName) {
  switch (a.type) {
    case 'notify': {
      await createNotification(autoTarget(a, ctx), {
        type: 'automation', title: autoTmpl(a.title, ctx) || 'Automation',
        body: autoTmpl(a.body, ctx), url: autoNotifUrl(ctx),
      }, 'always');
      break;
    }
    case 'notify_all': {
      const { data: emps } = await supabase.from('employees').select('id');
      for (const e of (emps || [])) {
        await createNotification(`employee_${e.id}`, {
          type: 'automation', title: autoTmpl(a.title, ctx) || 'Announcement',
          body: autoTmpl(a.body, ctx), url: autoNotifUrl(ctx),
        }, 'always');
      }
      return `notify_all → ${(emps || []).length} employee(s)`;
    }
    case 'create_followup': {
      if (!ctx.customerId) return 'create_followup skipped — not linked to a lead';
      const days = Number(a.days) || 1;
      const assigned = a.assign_to === 'owner' ? (ctx.ownerId || null) : a.assign_to === 'employee' ? (a.employee_id || null) : null;
      await supabase.from('lead_followups').insert({ customer_id: ctx.customerId, due_at: new Date(Date.now() + days * 86400000).toISOString(), note: autoTmpl(a.note, ctx) || 'Automated follow-up', assigned_to: assigned, created_by: 'automation' });
      logLeadActivity(ctx.customerId, { type: 'follow_up', body: `Follow-up scheduled by automation (in ${days}d)`, authorKey: 'system', authorName: 'Automation' });
      break;
    }
    case 'create_task': {
      const days = Number(a.due_days) || 1;
      const aid = a.assignee_id ? String(a.assignee_id) : (a.assign_to === 'owner' && ctx.ownerId ? String(ctx.ownerId) : null);
      const ins = { title: autoTmpl(a.title, ctx) || 'Automated task', priority: a.priority || 'medium', due_date: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10), status: 'todo', created_by: 'automation', channel_id: '', channel_name: '' };
      if (aid) { ins.assignee_id = aid; ins.assignee_ids = [aid]; }
      const { data: t } = await supabase.from('tasks').insert(ins).select().single();
      if (aid && t) { const mk = await memberKeyForAssignee(aid); if (mk) createNotification(mk, { type: 'task', title: 'New task assigned', body: t.title, url: '/employee#tasks' }, 'always'); }
      break;
    }
    case 'create_deal': {
      if (!ctx.customerId) return 'create_deal skipped — not linked to a lead';
      const { data: existing } = await supabase.from('deals').select('id').eq('customer_id', ctx.customerId).limit(1);
      if (!existing?.length) {
        await supabase.from('deals').insert({ customer_id: ctx.customerId, title: autoTmpl(a.title, ctx) || ctx.fields?.name || 'Deal', stage: a.stage || 'lead', car_model: ctx.fields?.car_in_question || '', budget_egp: ctx.fields?.budget_lead || null, notes: 'Created by automation', created_by: 'automation' });
        logLeadActivity(ctx.customerId, { type: 'deal', body: 'Deal created by automation', authorKey: 'system', authorName: 'Automation' });
      }
      break;
    }
    case 'set_lead_status': {
      if (!ctx.customerId || !a.status) return 'set_lead_status skipped — not linked to a lead';
      // Direct update (bypasses the PUT handler) so this never re-triggers automations.
      await supabase.from('customers').update({ lead_status: a.status, updated_at: new Date().toISOString() }).eq('id', ctx.customerId);
      logLeadActivity(ctx.customerId, { type: 'status_change', body: 'Status set by automation', meta: { to: a.status }, authorKey: 'system', authorName: 'Automation' });
      break;
    }
    case 'assign_lead': {
      if (!ctx.customerId) return 'assign_lead skipped — not linked to a lead';
      const empId = a.mode === 'specific' ? (a.employee_id || null) : await autoRoundRobin();
      if (empId) {
        await supabase.from('customers').update({ assigned_to: empId, updated_at: new Date().toISOString() }).eq('id', ctx.customerId);
        logLeadActivity(ctx.customerId, { type: 'system', body: 'Lead assigned by automation', authorKey: 'system', authorName: 'Automation' });
        createNotification(`employee_${empId}`, { type: 'lead', title: 'Lead assigned to you', body: autoTmpl('{{name}} — {{phone}}', ctx), url: '/employee#leads' }, 'always');
      }
      break;
    }
    case 'edit_lead': {
      // Set one or more fields on the lead. Direct update (bypasses the PUT handler) so it never re-triggers automations.
      if (!ctx.customerId) return 'edit_lead skipped — not linked to a lead';
      const updates = Array.isArray(a.updates) ? a.updates : [];
      const patch = { updated_at: new Date().toISOString() };
      for (const u of updates) {
        if (!u || !u.field) continue;
        if (u.field === 'budget_lead') { const b = parseBudget(u.value); patch.budget_lead = b.min; patch.budget_max = b.max; continue; }
        if (u.field === 'been_contacted') { patch.been_contacted = (u.value === true || u.value === 'true' || u.value === '1'); continue; }
        if (u.field === 'assigned_to') { patch.assigned_to = u.value ? parseInt(u.value) : null; continue; }
        if (u.field === 'phone') { patch.phone = u.value || ''; patch.phone_norm = normalizePhone(u.value); continue; }
        patch[u.field] = u.value;
      }
      if (Object.keys(patch).length <= 1) return 'edit_lead skipped — no fields to set';
      await supabase.from('customers').update(patch).eq('id', ctx.customerId);
      logLeadActivity(ctx.customerId, { type: 'system', body: 'Lead profile updated by automation', authorKey: 'system', authorName: 'Automation' });
      break;
    }
    case 'delete_deals': {
      // Files a deletion request per linked deal for admin approval (does not delete directly).
      if (!ctx.customerId) return 'delete_deals skipped — not linked to a lead';
      const { data: deals } = await supabase.from('deals').select('id').eq('customer_id', ctx.customerId);
      let n = 0;
      for (const d of (deals || [])) { if (await autoRequestDeletion('deal', d.id, ruleName)) n++; }
      if (n) {
        createNotification('admin', { type: 'request', title: 'Deletion request — deals', body: `Automation "${ruleName || 'rule'}" asked to remove ${n} deal(s) for ${ctx.fields?.name || 'a lead'} — approval needed`, url: '/dashboard#deletions' }, 'always');
        logLeadActivity(ctx.customerId, { type: 'deal', body: `Deal removal requested by automation — awaiting admin approval`, authorKey: 'system', authorName: 'Automation' });
      }
      return n ? `delete_deals → ${n} deletion request(s) pending approval` : 'delete_deals skipped — no deals or already pending';
    }
    case 'delete_lead': {
      // Files a deletion request for admin approval (does not delete directly).
      if (!ctx.customerId) return 'delete_lead skipped — not linked to a lead';
      const ok = await autoRequestDeletion('lead', ctx.customerId, ruleName);
      if (ok) {
        createNotification('admin', { type: 'request', title: 'Deletion request — lead', body: `Automation "${ruleName || 'rule'}" asked to delete ${ctx.fields?.name || 'a lead'} — approval needed`, url: '/dashboard#deletions' }, 'always');
        logLeadActivity(ctx.customerId, { type: 'system', body: 'Lead deletion requested by automation — awaiting admin approval', authorKey: 'system', authorName: 'Automation' });
      }
      return ok ? 'delete_lead → deletion request pending approval' : 'delete_lead skipped — already pending';
    }
  }
}
async function runAutomationActions(rule, ctx, eventName) {
  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  const done = [];
  for (const a of actions) { const note = await runAutomationAction(a, ctx, rule.name); done.push(note || a.type); }
  await supabase.from('automation_runs').insert({ rule_id: rule.id, event: eventName, entity_type: ctx.entityType, entity_id: ctx.entityId, status: 'ok', detail: done.join(',') }).then(() => {}).catch(() => {});
}
async function runAutomations(eventName, ctx) {
  try {
    const { data: rules } = await supabase.from('automation_rules').select('*').eq('enabled', true).eq('trigger_type', eventName);
    for (const rule of rules || []) {
      try {
        if (!automationMatches(rule, ctx)) continue;
        await runAutomationActions(rule, ctx, eventName);
      } catch (e) {
        console.warn('[automations] rule', rule.id, 'failed:', e.message);
        await supabase.from('automation_runs').insert({ rule_id: rule.id, event: eventName, entity_type: ctx.entityType, entity_id: ctx.entityId, status: 'error', detail: e.message }).then(() => {}).catch(() => {});
      }
    }
  } catch (e) { console.warn('[automations] run failed:', e.message); }
}
// Scheduled trigger: leads with no activity for N days (once per lead per window).
async function runNoActivitySweep() {
  try {
    const { data: rules } = await supabase.from('automation_rules').select('*').eq('enabled', true).eq('trigger_type', 'no_activity_days');
    if (!rules || !rules.length) return;
    const { data: leadsAll } = await supabase.from('customers').select('id,name,phone,source,lead_status,assigned_to,car_in_question,budget_lead').limit(1000);
    const leads = (leadsAll || []).filter(c => !['blacklist', 'not_interested'].includes(c.lead_status));
    for (const rule of rules) {
      const days = Number(rule.trigger_config?.days) || 3;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      for (const c of leads) {
        const { data: la } = await supabase.from('lead_activities').select('created_at').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(1);
        if (la?.[0]?.created_at && la[0].created_at > cutoff) continue;       // recent activity → skip
        const { data: fired } = await supabase.from('automation_runs').select('id').eq('rule_id', rule.id).eq('entity_id', c.id).gte('created_at', cutoff).limit(1);
        if (fired?.length) continue;                                          // already fired this window
        const ctx = leadCtx(c);
        if (!automationMatches(rule, ctx)) continue;
        await runAutomationActions(rule, ctx, 'no_activity_days');
      }
    }
  } catch (e) { console.warn('[automations] no-activity sweep failed:', e.message); }
}
// Scheduled trigger: tasks past their due date and still open (once per task).
async function runTaskOverdueSweep() {
  try {
    const { data: rules } = await supabase.from('automation_rules').select('*').eq('enabled', true).eq('trigger_type', 'task.overdue');
    if (!rules || !rules.length) return;
    const today = new Date().toISOString().split('T')[0];
    const { data: tasks } = await supabase.from('tasks').select('*').lt('due_date', today).neq('status', 'done').limit(2000);
    for (const rule of rules) {
      for (const t of (tasks || [])) {
        const { data: fired } = await supabase.from('automation_runs').select('id').eq('rule_id', rule.id).eq('entity_id', t.id).limit(1);
        if (fired?.length) continue;                       // already fired for this task
        const ctx = taskCtx(t);
        if (!automationMatches(rule, ctx)) continue;
        await runAutomationActions(rule, ctx, 'task.overdue');
      }
    }
  } catch (e) { console.warn('[automations] task-overdue sweep failed:', e.message); }
}
function scheduleAutomationSweep() {
  const sweep = () => { runNoActivitySweep().catch(console.error); runTaskOverdueSweep().catch(console.error); };
  setTimeout(sweep, 60 * 1000);
  setInterval(sweep, 60 * 60 * 1000);
}

// Automation rules CRUD
receiver.router.get('/api/dashboard/automations', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('automation_rules').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
receiver.router.post('/api/dashboard/automations', requireAuth, express.json(), async (req, res) => {
  const { name, trigger_type, trigger_config, conditions, actions, enabled } = req.body || {};
  if (!name || !trigger_type) return res.status(400).json({ error: 'name and trigger_type are required' });
  const { data, error } = await supabase.from('automation_rules').insert({
    name, trigger_type, trigger_config: trigger_config || {}, conditions: conditions || [], actions: actions || [],
    enabled: !!enabled, created_by: 'admin',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.put('/api/dashboard/automations/:id', requireAuth, express.json(), async (req, res) => {
  const patch = { ...req.body, updated_at: new Date().toISOString() };
  delete patch.id; delete patch.created_at;
  const { data, error } = await supabase.from('automation_rules').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.delete('/api/dashboard/automations/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('automation_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
receiver.router.get('/api/dashboard/automations/:id/runs', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('automation_runs').select('*').eq('rule_id', req.params.id).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


module.exports = { autoNorm, createNotification, dealCtx, hoursCtx, leadCtx, memberKeyForAssignee, requestCtx, runAutomations, scheduleAutomationSweep, submissionCtx, taskCtx };
