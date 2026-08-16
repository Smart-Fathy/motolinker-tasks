// Home dashboards
// src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase, taskAssigneeList } = ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase', 'taskAssigneeList');
// Registered on the context by modules that load after this one, so these are
// resolved when called rather than when required.
const empReportScope = (...a) => ctx.empReportScope(...a);
const empCan = (...a) => ctx.empCan(...a);

// ─── Home dashboards ──────────────────────────────────────────────────────────
// Per-user widget layouts live in the same quotation_settings KV as nav_config —
// one row per owner, so no new table.

// ── The catalogue ─────────────────────────────────────────────────────────────
// One definition of what a widget is, who may see it and what it reads. This used
// to be split: the client had the permission rule and the server had none, so the
// server answered every widget to every employee and the UI hid the ones they were
// not allowed — which meant a rep could read the company's pipeline straight off
// the endpoint. The rule lives here now and the client is told the answer.
//
//   gate  null                      everyone
//         '<section>'               that section's master permission
//         {section, action}         a specific granted action
//         'admin'                   the admin dashboard only
//   src   which queries the widget needs; [] means the client builds it itself
const HOME_WIDGETS = {
  // Tasks
  my_tasks:            { gate: 'tasks',     src: ['tasks'] },
  task_status:         { gate: 'tasks',     src: ['tasks'] },
  overdue_tasks:       { gate: 'tasks',     src: ['tasks'] },
  // Leads
  leads_status:        { gate: 'leads',     src: ['customers'] },
  recent_leads:        { gate: 'leads',     src: ['customers'] },
  followups:           { gate: 'leads',     src: ['followups'] },
  // Deals
  pipeline:            { gate: 'deals',     src: ['deals'] },
  won_month:           { gate: 'deals',     src: ['deals'] },
  // Hours
  hours_week:          { gate: { section: 'hours', action: 'view' }, src: ['hours'] },
  // Inventory
  stock_summary:       { gate: 'stock',     src: ['stock'] },
  stock_models:        { gate: 'stock',     src: ['stock'] },
  // Requests and approvals
  my_requests:         { gate: 'requests',  src: ['requests'] },
  approvals:           { gate: 'admin',     src: ['deletions'] },
  // Quotation, contracts, sales
  quotation_recent:    { gate: 'quotation', src: ['quotations'] },
  contracts_recent:    { gate: 'contracts', src: ['contracts'] },
  sales_month:         { gate: { section: 'reports', action: 'sales' }, src: ['sales'] },
  // Purchasing
  suppliers_top:       { gate: 'suppliers', src: ['purchases', 'suppliers'] },
  rfq_open:            { gate: 'rfq',       src: ['rfqs'] },
  po_status:           { gate: 'purchaseorders', src: ['purchases'] },
  // Company
  submissions_recent:  { gate: 'submissions', src: ['submissions'] },
  automations_active:  { gate: 'admin',     src: ['automations'] },
  team_roster:         { gate: 'admin',     src: ['employees', 'presence'] },
  whatsapp_recent:     { gate: 'admin',     src: ['whatsapp'] },
  issues_open:         { gate: { section: 'issues', action: 'view' }, src: ['issues'] },
  // Built by the client from what it already holds or from an endpoint of its own
  quick_actions:       { gate: null,        src: [] },
  unread_chat:         { gate: 'chat',      src: [] },
  notifications:       { gate: null,        src: [] },
  calendar:            { gate: 'calendar',  src: [] },
  meet_quick:          { gate: 'meet',      src: [] },
  team_availability:   { gate: 'availability', src: [] },
  drive_recent:        { gate: 'drive',     src: [] },
  sheets_recent:       { gate: 'sheets',    src: [] },
  email_unread:        { gate: 'email',     src: [] },
};

const HOME_WIDGET_IDS = Object.keys(HOME_WIDGETS);

// What a fresh Home shows. Also what the summary computes for someone who has never
// arranged theirs, so a first load is not a scan of every table in the catalogue.
const HOME_DEFAULT_IDS = ['my_tasks', 'task_status', 'overdue_tasks', 'pipeline', 'recent_leads', 'quick_actions'];

const HOME_W = [3, 4, 6, 12];
const HOME_H = [1, 2];
// Ceiling on rows pulled per table for the summary. Well above today's volumes (806
// customers), low enough that Home cannot become an unbounded table scan later.
const HOME_SCAN_CAP = 2000;

// `employee` is null for the admin, who sees every section.
function widgetAllowed(id, employee) {
  const gate = HOME_WIDGETS[id] ? HOME_WIDGETS[id].gate : undefined;
  if (gate === undefined) return false;               // not a widget we know
  if (gate === null) return true;
  if (gate === 'admin') return !employee;
  if (!employee) return true;
  if (typeof gate === 'string') return (employee.permissions || {})[gate] === true;
  return empCan(employee, gate.section, gate.action);
}

function homeAllowed(employee) {
  return HOME_WIDGET_IDS.filter(id => widgetAllowed(id, employee));
}

function homeLayoutKey(ownerKey) { return `home_layout:${ownerKey}`; }

// Permission is enforced here as well as in the catalogue the client is offered,
// because a hand-written PUT does not go through the client's Add-widget list.
function sanitizeHomeLayout(body, employee) {
  const seen = new Set();
  return (Array.isArray(body && body.widgets) ? body.widgets : [])
    .map(w => ({
      id: String((w && w.id) || ''),
      w: HOME_W.includes(Number(w && w.w)) ? Number(w.w) : 4,
      h: HOME_H.includes(Number(w && w.h)) ? Number(w.h) : 1,
    }))
    .filter(w => widgetAllowed(w.id, employee) && !seen.has(w.id) && seen.add(w.id))
    .slice(0, 24);
}

async function readHomeLayout(ownerKey, employee) {
  try {
    const { data } = await supabase.from('quotation_settings').select('value')
      .eq('key', homeLayoutKey(ownerKey)).single();
    const parsed = data && data.value ? JSON.parse(data.value) : null;
    return { widgets: sanitizeHomeLayout(parsed, employee) };
  } catch (_) { return { widgets: [] }; }
}

async function writeHomeLayout(ownerKey, body, employee) {
  const clean = { widgets: sanitizeHomeLayout(body, employee) };
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: homeLayoutKey(ownerKey), value: JSON.stringify(clean) }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return clean;
}

// ── The summary ───────────────────────────────────────────────────────────────
// Only the widgets actually on someone's Home are computed. With a catalogue this
// size, answering all of them on every load would mean a dozen table scans to render
// six tiles. `scope` is the same predicate pair the reports use, so an employee sees
// their own numbers and never company-wide totals.
async function buildHomeSummary({ employee, scope, want }) {
  const iso = d => d.toISOString();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = iso(now).slice(0, 10);
  const cap = HOME_SCAN_CAP;

  // Every source is capped and explicitly ordered, so what gets dropped is the oldest
  // rather than whatever the planner happened to return.
  const SOURCES = {
    tasks:       () => supabase.from('tasks').select('id,title,status,priority,due_date,assignee_id,assignee_ids,created_at').order('created_at', { ascending: false }).limit(cap),
    customers:   () => supabase.from('customers').select('id,name,lead_status,assigned_to,created_at').order('created_at', { ascending: false }).limit(cap),
    deals:       () => supabase.from('deals').select('id,stage,budget_egp,assigned_to,closed_at,created_at,customers(assigned_to,lead_status)').order('created_at', { ascending: false }).limit(cap),
    hours:       () => supabase.from('hours_logs').select('employee_id,hours,log_date').gte('log_date', iso(weekAgo).slice(0, 10)).limit(cap),
    stock:       () => supabase.from('stock_vehicles').select('id,make,model,quantity,colors,units').order('id', { ascending: false }).limit(cap),
    followups:   () => supabase.from('lead_followups').select('id,customer_id,due_at,status,note,assigned_to').neq('status', 'done').order('due_at', { ascending: true }).limit(200),
    requests:    () => supabase.from('requests').select('id,title,status,priority,created_by,assigned_to,created_at').order('created_at', { ascending: false }).limit(200),
    deletions:   () => supabase.from('deletion_requests').select('id,entity_type,entity_label,requested_by,status,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
    quotations:  () => supabase.from('quotations').select('id,quote_id,title,created_by,created_at').order('created_at', { ascending: false }).limit(50),
    contracts:   () => supabase.from('contracts').select('id,contract_no,title,status,created_at').order('created_at', { ascending: false }).limit(50),
    sales:       () => supabase.from('sales').select('id,client,brand,model,status,discounted,price_list,reservation_date,created_at').order('created_at', { ascending: false }).limit(cap),
    purchases:   () => supabase.from('purchase_orders').select('id,po_number,supplier,supplier_id,status,po_date,created_at').order('created_at', { ascending: false }).limit(cap),
    suppliers:   () => supabase.from('suppliers').select('id,name').limit(cap),
    rfqs:        () => supabase.from('rfqs').select('id,rfq_no,title,supplier_name,status,rfq_date,created_at').order('created_at', { ascending: false }).limit(50),
    submissions: () => supabase.from('form_submissions').select('id,name,car_interest,source,created_at').order('created_at', { ascending: false }).limit(50),
    automations: () => supabase.from('automation_rules').select('id,name,enabled,trigger_type').limit(100),
    employees:   () => supabase.from('employees').select('id,name,job_title,avatar_url').limit(cap),
    presence:    () => supabase.from('presence').select('member_key,last_seen').limit(cap),
    whatsapp:    () => supabase.from('whatsapp_messages').select('id,direction,body,ts,created_at').order('created_at', { ascending: false }).limit(20),
    issues:      () => supabase.from('issues').select('id,title,status,reporter_name,created_at').order('created_at', { ascending: false }).limit(50),
  };

  const need = new Set();
  for (const id of want) for (const s of (HOME_WIDGETS[id] || {}).src || []) need.add(s);

  const keys = [...need];
  const settled = await Promise.all(keys.map(k => SOURCES[k]()));
  const R = {};
  keys.forEach((k, i) => { R[k] = (settled[i] && settled[i].data) || []; });
  const rows = k => R[k] || [];

  // Tables where the cap bit, so the totals below are a floor rather than a count.
  const partial = ['tasks', 'customers', 'deals', 'stock', 'sales', 'purchases']
    .filter(k => need.has(k) && rows(k).length >= cap)
    .map(k => (k === 'customers' ? 'leads' : k));

  // ── Per-employee filtering ──
  const myTask = t => !employee || taskAssigneeList(t).includes(String(employee.id));
  const tasks  = rows('tasks').filter(myTask);
  const leads  = scope && scope.scopeLeads ? rows('customers').filter(scope.scopeLeads) : rows('customers');
  const deals  = scope && scope.scopeDeals ? rows('deals').filter(scope.scopeDeals) : rows('deals');
  const hours  = rows('hours').filter(h => !employee || String(h.employee_id) === String(employee.id));
  const follows = rows('followups').filter(f => !employee || String(f.assigned_to || '') === String(employee.id));
  const myKey  = employee ? `employee_${employee.id}` : 'admin';
  const myRequests = rows('requests').filter(r => !employee
    || String(r.created_by || '') === String(employee.id) || String(r.created_by || '') === myKey
    || String(r.assigned_to || '') === String(employee.id) || String(r.assigned_to || '') === myKey);

  const countBy = (list, key) => {
    const m = {};
    for (const r of list) { const k = String(r[key] || 'unknown'); m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };
  const num = v => (typeof v === 'number' ? v : parseFloat(v) || 0);
  const stockUnits = v => (Array.isArray(v.units) && v.units.length) ? v.units.length
    : (Array.isArray(v.colors) ? v.colors.reduce((s, c) => s + (parseInt(c && c.qty) || 0), 0) : 0) || (v.quantity || 0);
  const dateDesc = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));

  // ── One producer per widget. Only the wanted ones are called. ──
  const BUILD = {
    my_tasks: () => tasks.filter(t => t.status !== 'done')
      .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
      .slice(0, 8).map(t => ({ id: t.id, title: t.title, due_date: t.due_date, priority: t.priority })),
    task_status: () => countBy(tasks, 'status'),
    overdue_tasks: () => tasks.filter(t => t.status !== 'done' && t.due_date && String(t.due_date).slice(0, 10) < today).length,

    leads_status: () => countBy(leads, 'lead_status'),
    recent_leads: () => [...leads].sort(dateDesc).slice(0, 8)
      .map(c => ({ id: c.id, name: c.name, lead_status: c.lead_status, created_at: c.created_at })),
    followups: () => follows.slice(0, 8).map(f => ({ id: f.id, customer_id: f.customer_id, due_at: f.due_at, note: f.note })),

    pipeline: () => {
      const by = {};
      for (const d of deals) {
        const k = String(d.stage || 'unknown');
        if (!by[k]) by[k] = { label: k, count: 0, value: 0 };
        by[k].count++; by[k].value += num(d.budget_egp);
      }
      return Object.values(by).sort((a, b) => b.value - a.value);
    },
    won_month: () => deals.filter(d => String(d.stage || '').toLowerCase() === 'won'
      && d.closed_at && new Date(d.closed_at) >= monthStart).reduce((s, d) => s + num(d.budget_egp), 0),

    hours_week: () => Math.round(hours.reduce((s, h) => s + num(h.hours), 0) * 10) / 10,

    stock_summary: () => ({ models: rows('stock').length, units: rows('stock').reduce((s, v) => s + stockUnits(v), 0) }),
    stock_models: () => rows('stock').slice(0, 8)
      .map(v => ({ id: v.id, label: [v.make, v.model].filter(Boolean).join(' ') || 'Unnamed', count: stockUnits(v) })),

    my_requests: () => countBy(myRequests, 'status'),
    approvals: () => rows('deletions').slice(0, 8)
      .map(d => ({ id: d.id, label: d.entity_label || d.entity_type, by: d.requested_by, created_at: d.created_at })),

    quotation_recent: () => rows('quotations').slice(0, 8)
      .map(q => ({ id: q.id, label: q.title || q.quote_id || ('#' + q.id), created_at: q.created_at })),
    contracts_recent: () => rows('contracts').slice(0, 8)
      .map(c => ({ id: c.id, label: c.title || c.contract_no || ('#' + c.id), status: c.status, created_at: c.created_at })),
    sales_month: () => {
      const mine = rows('sales').filter(s => s.created_at && new Date(s.created_at) >= monthStart);
      return { count: mine.length, value: mine.reduce((s, r) => s + (num(r.discounted) || num(r.price_list)), 0) };
    },

    suppliers_top: () => {
      const names = new Map(rows('suppliers').map(s => [String(s.id), s.name]));
      const by = {};
      for (const p of rows('purchases')) {
        const label = names.get(String(p.supplier_id)) || p.supplier || 'Unassigned';
        by[label] = (by[label] || 0) + 1;
      }
      return Object.entries(by).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6);
    },
    po_status: () => countBy(rows('purchases'), 'status'),
    rfq_open: () => rows('rfqs').filter(r => String(r.status || '').toLowerCase() !== 'closed').slice(0, 8)
      .map(r => ({ id: r.id, label: r.title || r.rfq_no || ('#' + r.id), sub: r.supplier_name, created_at: r.created_at })),

    submissions_recent: () => rows('submissions').slice(0, 8)
      .map(s => ({ id: s.id, label: s.name || 'Someone', sub: s.car_interest || s.source, created_at: s.created_at })),
    automations_active: () => ({ active: rows('automations').filter(a => a.enabled).length, total: rows('automations').length }),
    team_roster: () => {
      const cutoff = Date.now() - 2 * 60 * 1000;
      const online = new Set(rows('presence')
        .filter(p => p.last_seen && new Date(p.last_seen).getTime() > cutoff)
        .map(p => String(p.member_key)));
      return rows('employees').slice(0, 12).map(e => ({
        id: e.id, name: e.name, job_title: e.job_title || '', avatar: e.avatar_url || null,
        online: online.has('employee_' + e.id),
      }));
    },
    whatsapp_recent: () => rows('whatsapp').slice(0, 6)
      .map(m => ({ id: m.id, label: (m.body || '').slice(0, 60) || 'Media', sub: m.direction, created_at: m.ts || m.created_at })),
    issues_open: () => rows('issues').filter(i => String(i.status || 'open') !== 'resolved').slice(0, 8)
      .map(i => ({ id: i.id, label: i.title, sub: i.reporter_name, created_at: i.created_at })),
  };

  const out = { partial, generated_at: iso(now) };
  for (const id of want) if (BUILD[id]) out[id] = BUILD[id]();
  return out;
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// Home is the landing page: every login and every refresh calls this, and the
// queries behind it do not change meaningfully within a minute. Cached the same way
// and for the same reason as chatProfileMap in src/routes/notifications.js.
//
// Keyed by owner, never shared. An employee's Home is filtered to their own rows, so
// a cache hit crossing owners would show a rep the company's numbers — the entry is
// keyed by ownerKey and the key is never derived from anything the caller sends. A
// permission change takes up to a minute to be reflected, which is the same trade
// the rest of the app already makes.
const HOME_TTL = 60000;
const _homeCache = new Map();   // ownerKey → { at, data }

async function homeSummaryCached(args) {
  const hit = _homeCache.get(args.ownerKey);
  if (hit && Date.now() - hit.at < HOME_TTL) return hit.data;
  const data = await buildHomeSummary(args);
  _homeCache.set(args.ownerKey, { at: Date.now(), data });
  // Bounded so a large roster cannot grow this without limit; entries are cheap to rebuild.
  if (_homeCache.size > 200) {
    for (const [k, v] of _homeCache) if (Date.now() - v.at >= HOME_TTL) _homeCache.delete(k);
  }
  return data;
}

// ── Calendar ──────────────────────────────────────────────────────────────────
// Deliberately its own endpoint rather than part of the summary: an outbound Google
// call inside the cached summary would make every Home load wait on a third party
// and fail as a unit. The existing calendar.events scope already permits reading, so
// nobody has to reconnect for this.
const _calCache = new Map();    // ownerKey → { at, data }

async function homeCalendar(ownerKey, token) {
  const hit = _calCache.get(ownerKey);
  if (hit && Date.now() - hit.at < HOME_TTL) return hit.data;
  if (!token) return { connected: false, events: [] };
  let data = { connected: true, events: [] };
  try {
    const params = new URLSearchParams({
      timeMin: new Date().toISOString(), maxResults: '8',
      singleEvents: 'true', orderBy: 'startTime',
    });
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'Calendar refused the request');
    data.events = (j.items || []).map(e => ({
      id: e.id,
      title: e.summary || '(no title)',
      start: (e.start && (e.start.dateTime || e.start.date)) || null,
      allDay: !!(e.start && e.start.date && !e.start.dateTime),
      link: e.htmlLink || '',
    }));
  } catch (e) {
    // A lapsed token should read as "reconnect", not as a broken Home.
    data = { connected: false, events: [], error: e.message };
  }
  _calCache.set(ownerKey, { at: Date.now(), data });
  return data;
}

function mountHomeRoutes(base, guard, resolve) {
  receiver.router.get(`${base}/home/layout`, guard, async (req, res) => {
    try {
      const { ownerKey, employee } = resolve(req);
      res.json(await readHomeLayout(ownerKey, employee));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  receiver.router.put(`${base}/home/layout`, guard, express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const { ownerKey, employee } = resolve(req);
      res.json(await writeHomeLayout(ownerKey, req.body, employee));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  receiver.router.get(`${base}/home/summary`, guard, async (req, res) => {
    try {
      const { ownerKey, employee } = resolve(req);
      const allowed = homeAllowed(employee);
      const saved = (await readHomeLayout(ownerKey, employee)).widgets.map(w => w.id);
      const want = (saved.length ? saved : HOME_DEFAULT_IDS).filter(id => allowed.includes(id));
      const scope = employee ? await empReportScope(employee) : null;
      const data = await homeSummaryCached({ ownerKey, employee, scope, want });
      // `allowed` is the client's only source for what may be added, so it never has
      // to carry a second copy of the permission rule.
      res.json({ ...data, allowed });
    } catch (e) { console.error('[home]', e); res.status(500).json({ error: e.message }); }
  });
  receiver.router.get(`${base}/home/calendar`, guard, async (req, res) => {
    try {
      const { ownerKey, employee } = resolve(req);
      const token = employee
        ? await ctx.getEmployeeCalendarToken(employee.id)
        : await ctx.getCalendarToken();
      res.json(await homeCalendar(ownerKey, token));
    } catch (e) { res.json({ connected: false, events: [], error: e.message }); }
  });
}

mountHomeRoutes('/api/dashboard', requireAuth, () => ({ ownerKey: 'admin', employee: null }));
mountHomeRoutes('/api/employee', requireEmployeeAuth,
  req => ({ ownerKey: `employee_${req.employee.id}`, employee: req.employee }));


module.exports = { HOME_WIDGETS, homeAllowed, widgetAllowed };
