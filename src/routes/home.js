// Home dashboards
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase, taskAssigneeList } = ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase', 'taskAssigneeList');
// Registered on the context by a module that loads after this one, so these
// are resolved when called rather than when required.
const empReportScope = (...a) => ctx.empReportScope(...a);

// ─── Home dashboards ──────────────────────────────────────────────────────────
// Per-user widget layouts live in the same quotation_settings KV as nav_config —
// one row per owner, so no new table. The summary is a single call returning every
// widget's data: a Home with ten widgets is one round trip, not ten.

const HOME_WIDGET_IDS = [
  'my_tasks', 'task_status', 'overdue_tasks', 'leads_status', 'recent_leads',
  'followups', 'pipeline', 'won_month', 'hours_week', 'stock_summary',
  'unread_chat', 'notifications', 'quick_actions',
];
const HOME_W = [3, 4, 6, 12];
const HOME_H = [1, 2];

function homeLayoutKey(ownerKey) { return `home_layout:${ownerKey}`; }

function sanitizeHomeLayout(body) {
  const seen = new Set();
  return (Array.isArray(body?.widgets) ? body.widgets : [])
    .map(w => ({
      id: String(w?.id || ''),
      w: HOME_W.includes(Number(w?.w)) ? Number(w.w) : 4,
      h: HOME_H.includes(Number(w?.h)) ? Number(w.h) : 1,
    }))
    .filter(w => HOME_WIDGET_IDS.includes(w.id) && !seen.has(w.id) && seen.add(w.id))
    .slice(0, 24);
}

async function readHomeLayout(ownerKey) {
  try {
    const { data } = await supabase.from('quotation_settings').select('value')
      .eq('key', homeLayoutKey(ownerKey)).single();
    const parsed = data?.value ? JSON.parse(data.value) : null;
    return { widgets: sanitizeHomeLayout(parsed) };
  } catch (_) { return { widgets: [] }; }
}

async function writeHomeLayout(ownerKey, body) {
  const clean = { widgets: sanitizeHomeLayout(body) };
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: homeLayoutKey(ownerKey), value: JSON.stringify(clean) }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return clean;
}

// Everything Home needs, in one shot. `scope` is the same predicate pair the
// reports use, so an employee sees their own numbers and never company-wide totals.
async function buildHomeSummary({ ownerKey, employee, scope }) {
  const iso = d => d.toISOString();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = iso(now).slice(0, 10);

  const [tasksR, leadsR, dealsR, hoursR, stockR, followR] = await Promise.all([
    supabase.from('tasks').select('id,title,status,priority,due_date,assignee_id,assignee_ids,created_at'),
    supabase.from('customers').select('id,name,lead_status,assigned_to,created_at'),
    supabase.from('deals').select('id,stage,budget_egp,assigned_to,closed_at,created_at,customers(assigned_to,lead_status)'),
    supabase.from('hours_logs').select('employee_id,hours,log_date').gte('log_date', iso(weekAgo).slice(0, 10)),
    supabase.from('stock_vehicles').select('id,make,model,quantity,colors,units'),
    supabase.from('lead_followups').select('id,customer_id,due_at,status,note,assigned_to')
      .neq('status', 'done').order('due_at', { ascending: true }).limit(200),
  ]);

  // A task can have several assignees; taskAssigneeList handles the legacy single column
  const myTask = t => !employee || taskAssigneeList(t).includes(String(employee.id));
  const tasks = (tasksR.data || []).filter(myTask);
  const leads = scope?.scopeLeads ? (leadsR.data || []).filter(scope.scopeLeads) : (leadsR.data || []);
  const deals = scope?.scopeDeals ? (dealsR.data || []).filter(scope.scopeDeals) : (dealsR.data || []);
  const hours = (hoursR.data || []).filter(h => !employee || String(h.employee_id) === String(employee.id));
  const follows = (followR.data || []).filter(f => !employee || String(f.assigned_to || '') === String(employee.id));

  const countBy = (rows, key) => {
    const m = {};
    for (const r of rows) { const k = String(r[key] || 'unknown'); m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };
  const num = v => (typeof v === 'number' ? v : parseFloat(v) || 0);
  const stockUnits = v => (Array.isArray(v.units) && v.units.length) ? v.units.length
    : (Array.isArray(v.colors) ? v.colors.reduce((s, c) => s + (parseInt(c?.qty) || 0), 0) : 0) || (v.quantity || 0);

  const pipeline = {};
  for (const d of deals) {
    const k = String(d.stage || 'unknown');
    if (!pipeline[k]) pipeline[k] = { label: k, count: 0, value: 0 };
    pipeline[k].count++; pipeline[k].value += num(d.budget_egp);
  }

  return {
    my_tasks: tasks.filter(t => t.status !== 'done')
      .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
      .slice(0, 8).map(t => ({ id: t.id, title: t.title, due_date: t.due_date, priority: t.priority })),
    task_status: countBy(tasks, 'status'),
    overdue_tasks: tasks.filter(t => t.status !== 'done' && t.due_date && String(t.due_date).slice(0, 10) < today).length,
    leads_status: countBy(leads, 'lead_status'),
    recent_leads: [...leads].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 8).map(c => ({ id: c.id, name: c.name, lead_status: c.lead_status, created_at: c.created_at })),
    followups: follows.slice(0, 8).map(f => ({ id: f.id, customer_id: f.customer_id, due_at: f.due_at, note: f.note })),
    pipeline: Object.values(pipeline).sort((a, b) => b.value - a.value),
    won_month: deals.filter(d => String(d.stage || '').toLowerCase() === 'won'
      && d.closed_at && new Date(d.closed_at) >= monthStart)
      .reduce((s, d) => s + num(d.budget_egp), 0),
    hours_week: Math.round(hours.reduce((s, h) => s + num(h.hours), 0) * 10) / 10,
    stock_summary: (() => {
      const rows = stockR.data || [];
      return { models: rows.length, units: rows.reduce((s, v) => s + stockUnits(v), 0) };
    })(),
    unread_chat: 0,          // the client already tracks this live over SSE
    notifications: 0,        // ditto
    generated_at: iso(now),
  };
}

function mountHomeRoutes(base, guard, resolve) {
  receiver.router.get(`${base}/home/layout`, guard, async (req, res) => {
    try { res.json(await readHomeLayout(resolve(req).ownerKey)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  receiver.router.put(`${base}/home/layout`, guard, express.json({ limit: '64kb' }), async (req, res) => {
    try { res.json(await writeHomeLayout(resolve(req).ownerKey, req.body)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  receiver.router.get(`${base}/home/summary`, guard, async (req, res) => {
    try {
      const { ownerKey, employee } = resolve(req);
      const scope = employee ? await empReportScope(employee) : null;
      res.json(await buildHomeSummary({ ownerKey, employee, scope }));
    } catch (e) { console.error('[home]', e); res.status(500).json({ error: e.message }); }
  });
}

mountHomeRoutes('/api/dashboard', requireAuth, () => ({ ownerKey: 'admin', employee: null }));
mountHomeRoutes('/api/employee', requireEmployeeAuth,
  req => ({ ownerKey: `employee_${req.employee.id}`, employee: req.employee }));


module.exports = {};
