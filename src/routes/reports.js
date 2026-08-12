// Sales & revenue analytics
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { GOOGLE_CLIENT_ID, crypto, express, getCalendarToken, getDriveToken, getEmployeeCalendarToken, multer, parseCSV, receiver, requireAuth, supabase, syncTaskToCalendar, upload } = ctx.need('GOOGLE_CLIENT_ID', 'crypto', 'express', 'getCalendarToken', 'getDriveToken', 'getEmployeeCalendarToken', 'multer', 'parseCSV', 'receiver', 'requireAuth', 'supabase', 'syncTaskToCalendar', 'upload');
// Reassigned at runtime (Drive connect/disconnect, VAPID boot), so these are
// read from the context on use — capturing them here would pin the boot value.
// Registered on the context by a module that loads after this one, so these
// are resolved when called rather than when required.
const loadLeadsColsConfig = (...a) => ctx.loadLeadsColsConfig(...a);
const parseBudget = (...a) => ctx.parseBudget(...a);
const notifyEmployeeTaskAssigned = (...a) => ctx.notifyEmployeeTaskAssigned(...a);

// ─── Sales & revenue analytics (read-only aggregation over deals/quotations/hours) ───
const DEFAULT_STAGE_PROB = { lead: 10, inquiry: 25, quoted: 50, negotiating: 75, won: 100, lost: 0 };
const DEAL_STAGES = ['lead', 'inquiry', 'quoted', 'negotiating', 'won', 'lost'];

// Parse ?from&to (YYYY-MM-DD) into an inclusive [startISO, endISO] window; defaults to last 90 days.
function reportRange(q) {
  const to = q.to ? new Date(q.to + 'T23:59:59.999Z') : new Date();
  const from = q.from ? new Date(q.from + 'T00:00:00.000Z') : new Date(to.getTime() - 90 * 86400000);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

async function buildSalesReport(q) {
  const { fromISO, toISO } = reportRange(q);
  const sourceFilter = q.source ? String(q.source) : '';
  // Stage probabilities (weighted pipeline)
  let prob = { ...DEFAULT_STAGE_PROB };
  try {
    const { data: row } = await supabase.from('quotation_settings').select('value').eq('key', 'stage_probabilities').single();
    if (row?.value) prob = { ...prob, ...JSON.parse(row.value) };
  } catch (_) {}
  // Deals joined to their lead's source (for by-source conversion)
  const { data: deals } = await supabase.from('deals').select('id,stage,budget_egp,assigned_to,closed_at,created_at,customer_id,customers(source)');
  // Same scoping contract as buildLeadsReport: employees only aggregate their own.
  const scopedDeals = typeof q.scopeDeals === 'function' ? (deals || []).filter(q.scopeDeals) : (deals || []);
  const inRange = (iso) => iso && iso >= fromISO && iso <= toISO;
  const rows = scopedDeals.filter(d => {
    if (sourceFilter && (d.customers?.source || '') !== sourceFilter) return false;
    // A deal counts for the window if it was created in it, or closed in it.
    return inRange(d.created_at) || inRange(d.closed_at);
  });
  const num = (v) => Number(v) || 0;
  const pipelineByStage = DEAL_STAGES.map(stage => {
    const ds = rows.filter(d => d.stage === stage);
    return { stage, count: ds.length, value: ds.reduce((s, d) => s + num(d.budget_egp), 0) };
  });
  const openStages = ['lead', 'inquiry', 'quoted', 'negotiating'];
  const totalPipeline = pipelineByStage.filter(p => openStages.includes(p.stage)).reduce((s, p) => s + p.value, 0);
  const weightedPipeline = rows.filter(d => openStages.includes(d.stage))
    .reduce((s, d) => s + num(d.budget_egp) * (num(prob[d.stage]) / 100), 0);
  const wonRows = rows.filter(d => d.stage === 'won');
  const lostCount = rows.filter(d => d.stage === 'lost').length;
  const revenueWon = wonRows.reduce((s, d) => s + num(d.budget_egp), 0);
  const winRate = (wonRows.length + lostCount) ? Math.round((wonRows.length / (wonRows.length + lostCount)) * 100) : 0;
  // Funnel: cumulative reach of each stage (a won deal also passed through lead/contacted/…)
  const order = ['lead', 'inquiry', 'quoted', 'negotiating', 'won'];
  const idx = (st) => order.indexOf(st);
  const funnel = order.map(stage => ({
    stage,
    count: rows.filter(d => d.stage !== 'lost' && idx(d.stage) >= idx(stage)).length,
  }));
  // Revenue won by month (from closed_at)
  const byMonth = {};
  wonRows.forEach(d => { if (d.closed_at) { const m = d.closed_at.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + num(d.budget_egp); } });
  const revenueByMonth = Object.keys(byMonth).sort().map(m => ({ month: m, value: byMonth[m] }));
  // Conversion by source
  const srcMap = {};
  rows.forEach(d => {
    const s = d.customers?.source || '(unknown)';
    if (!srcMap[s]) srcMap[s] = { source: s, deals: 0, won: 0, value: 0 };
    srcMap[s].deals++;
    if (d.stage === 'won') { srcMap[s].won++; srcMap[s].value += num(d.budget_egp); }
  });
  const bySource = Object.values(srcMap).sort((a, b) => b.deals - a.deals);
  // Rep leaderboard (won count + value by assigned_to)
  const { data: emps } = await supabase.from('employees').select('id,name');
  const empName = (id) => (emps || []).find(e => String(e.id) === String(id))?.name || (id ? '#' + id : 'Unassigned');
  const repMap = {};
  rows.forEach(d => {
    const key = d.assigned_to || '';
    if (!repMap[key]) repMap[key] = { rep: empName(key), deals: 0, won: 0, value: 0 };
    repMap[key].deals++;
    if (d.stage === 'won') { repMap[key].won++; repMap[key].value += num(d.budget_egp); }
  });
  const byRep = Object.values(repMap).sort((a, b) => b.value - a.value);
  // Quotations generated in range
  const { count: quotesCount } = await supabase.from('quotations').select('id', { count: 'exact', head: true }).gte('created_at', fromISO).lte('created_at', toISO);
  // Hours logged by employee in range
  const { data: hours } = await supabase.from('hours_logs').select('employee_id,hours,log_date').gte('log_date', fromISO.slice(0, 10)).lte('log_date', toISO.slice(0, 10));
  const hoursMap = {};
  (hours || []).forEach(h => { const k = h.employee_id || ''; hoursMap[k] = (hoursMap[k] || 0) + num(h.hours); });
  const hoursByEmployee = Object.keys(hoursMap).map(k => ({ employee: empName(k), hours: Math.round(hoursMap[k] * 10) / 10 })).sort((a, b) => b.hours - a.hours);
  const wonCount = wonRows.length;
  return {
    range: { from: fromISO.slice(0, 10), to: toISO.slice(0, 10) }, source: sourceFilter,
    pipelineByStage, totalPipeline, weightedPipeline: Math.round(weightedPipeline),
    winRate, revenueWon, wonCount, avgDeal: wonCount ? Math.round(revenueWon / wonCount) : 0,
    funnel, revenueByMonth, bySource, byRep, quotesCount: quotesCount || 0, hoursByEmployee, stageProb: prob,
  };
}

receiver.router.get('/api/dashboard/reports/summary', requireAuth, async (req, res) => {
  try { res.json(await buildSalesReport(req.query)); }
  catch (e) { console.error('[reports]', e); res.status(500).json({ error: e.message }); }
});

// Serialize an array of flat objects to RFC-4180 CSV.
function csvSerialize(rows, columns) {
  const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(','));
  return lines.join('\r\n');
}

// ── Customizable Leads report ─────────────────────────────────────────────────
// Group leads by any dimension (status, origin, budget range, owner, month,
// vehicle, or a custom column) and measure by count or budget. Powers the
// "Custom Leads Report" builder in the Reports page.
function fmtShortNum(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}
function parseBudgetBuckets(str) {
  const def = [500000, 1000000, 1500000, 2000000, 3000000];
  if (!str) return def;
  const nums = [];
  for (const raw of String(str).split(/[,\s]+/)) {
    let t = raw.trim().toLowerCase(); if (!t) continue;
    let mult = 1;
    if (/k$/.test(t)) { mult = 1e3; t = t.slice(0, -1); }
    else if (/m$/.test(t)) { mult = 1e6; t = t.slice(0, -1); }
    const n = parseFloat(t.replace(/[^\d.]/g, ''));
    if (isFinite(n) && n > 0) nums.push(Math.round(n * mult));
  }
  const arr = [...new Set(nums)].sort((a, b) => a - b);
  return arr.length ? arr : def;
}
// Returns [sortKey, label] for a budget value against ascending thresholds.
function budgetBucketOf(v, buckets) {
  if (v == null || v === '' || isNaN(Number(v))) return ['b999', 'No budget'];
  const n = Number(v);
  for (let i = 0; i < buckets.length; i++) {
    if (n < buckets[i]) return ['b' + String(i).padStart(3, '0'), i === 0 ? ('< ' + fmtShortNum(buckets[0])) : (fmtShortNum(buckets[i - 1]) + '–' + fmtShortNum(buckets[i]))];
  }
  return ['b' + String(buckets.length).padStart(3, '0'), fmtShortNum(buckets[buckets.length - 1]) + '+'];
}
function enumLabelMap(field) {
  const m = {};
  (LEADS_ENUM_DEFAULTS[field] || []).forEach(([k, l]) => { m[k] = l; });
  return m;
}
async function buildLeadsReport(q) {
  const GROUPS = ['lead_status', 'source', 'budget', 'next_action', 'been_contacted', 'owner', 'month', 'car_in_question'];
  const validDim = d => GROUPS.includes(d) || (typeof d === 'string' && d.startsWith('cf_'));
  let groupBy = String(q.groupBy || 'lead_status');
  if (!validDim(groupBy)) groupBy = 'lead_status';
  let splitBy = String(q.splitBy || '');
  if (!validDim(splitBy) || splitBy === groupBy) splitBy = '';   // optional 2nd dimension (cross-tab)
  const measure = ['count', 'budget_sum', 'budget_avg'].includes(q.measure) ? q.measure : 'count';
  // Values may be stored as raw labels ("Hot", "Whatsapp") rather than canonical
  // keys, so every enum comparison/grouping normalizes first (autoNorm: lowercase,
  // spaces→_). This is what makes the Hot count and status/origin filters correct.
  const statusFilter = q.status ? autoNorm(q.status) : '';
  const sourceFilter = q.source ? autoNorm(q.source) : '';
  const buckets = parseBudgetBuckets(q.buckets);
  // ALL-TIME by default so totals match the Leads table exactly; the date filter
  // applies only when the user supplies a range.
  const fromDay = q.from ? String(q.from).slice(0, 10) : null;
  const toDay = q.to ? String(q.to).slice(0, 10) : null;

  const { data: all } = await supabase.from('customers')
    .select('id,lead_status,source,budget_lead,budget_max,next_action,been_contacted,assigned_to,car_in_question,lead_date,created_at,custom_fields')
    .limit(50000);
  // Employee reports pass a predicate so totals never include leads outside the
  // caller's data scope. Admin reports pass nothing and see everything.
  const scoped = typeof q.scopeLeads === 'function' ? (all || []).filter(q.scopeLeads) : (all || []);
  const effDay = c => c.lead_date || (c.created_at || '').slice(0, 10);
  let leads = scoped.filter(c => {
    if (!fromDay && !toDay) return true;               // no range → every lead (incl. dateless)
    const d = effDay(c); if (!d) return false;
    if (fromDay && d < fromDay) return false;
    if (toDay && d > toDay) return false;
    return true;
  });
  if (statusFilter) leads = leads.filter(c => autoNorm(c.lead_status || 'cold') === statusFilter);
  if (sourceFilter) leads = leads.filter(c => autoNorm(c.source || '') === sourceFilter);

  // Budget can live in the built-in budget_lead OR a custom "Budget" column
  // (some configs deleted the built-in and use cf_budget). Fall back per lead.
  const colsCfg = await loadLeadsColsConfig();
  const budgetCf = (Array.isArray(colsCfg) ? colsCfg : []).find(c => c && typeof c.key === 'string' && c.key.startsWith('cf_') && !c.deleted && autoNorm(c.label || '') === 'budget')?.key || 'cf_budget';
  const effBudget = c => {
    if (c.budget_lead != null && c.budget_lead !== '' && isFinite(Number(c.budget_lead))) return Number(c.budget_lead);
    const raw = (c.custom_fields || {})[budgetCf];
    if (raw == null || raw === '') return null;
    const b = parseBudget(raw);
    return b && b.min != null ? Number(b.min) : null;
  };

  const { data: emps } = await supabase.from('employees').select('id,name');
  const empName = id => (emps || []).find(e => String(e.id) === String(id))?.name || (id ? '#' + id : 'Unassigned');
  // Label enum values the way the LEADS TABLE does: the user's saved column
  // options win (they may have renamed/replaced options); defaults are only a
  // fallback. Indexed by autoNorm of both option key and label so raws stored
  // either way resolve to the same display name.
  const cfgLabels = (colKey, defaults) => {
    const m = { ...defaults };
    const col = (Array.isArray(colsCfg) ? colsCfg : []).find(c => c && c.key === colKey && !c.deleted);
    (col && Array.isArray(col.options) ? col.options : []).forEach(o => {
      if (!o || o.label == null) return;
      m[autoNorm(o.key)] = o.label;
      m[autoNorm(o.label)] = o.label;
    });
    return m;
  };
  const statusLabels = cfgLabels('lead_status', enumLabelMap('status'));
  const originLabels = cfgLabels('source', enumLabelMap('source'));
  const naLabels = cfgLabels('next_action', enumLabelMap('next_action'));
  const isTrue = v => v === true || v === 'true' || v === 1 || v === '1';

  // [key,label] for ANY dimension — reused for group-by AND split-by. Group
  // identity is the DISPLAYED label (normalized) so a value stored as an option
  // key and the same value stored as its label always land together.
  function dimKeyLabel(dim, c) {
    if (dim.startsWith('cf_')) { const v = (c.custom_fields || {})[dim]; const s = (v == null ? '' : String(v)).trim(); return [s ? autoNorm(s) : '~none', s || '(none)']; }
    switch (dim) {
      case 'lead_status': { const raw = c.lead_status || 'cold'; const label = statusLabels[autoNorm(raw)] || raw; return [autoNorm(label), label]; }
      case 'source': { const raw = c.source || ''; if (!raw) return ['~none', '(no origin)']; const label = originLabels[autoNorm(raw)] || raw; return [autoNorm(label), label]; }
      case 'next_action': { const raw = c.next_action || ''; if (!raw) return ['~none', '(none)']; const label = naLabels[autoNorm(raw)] || raw; return [autoNorm(label), label]; }
      case 'been_contacted': { const b = isTrue(c.been_contacted); return [b ? 'a_yes' : 'b_no', b ? 'Contacted' : 'Not contacted']; }
      case 'owner': { const k = c.assigned_to; return [String(k || '~unassigned'), empName(k)]; }
      case 'month': { const m = (effDay(c) || '').slice(0, 7); return [m || 'zzzz', m || '(no date)']; }
      case 'car_in_question': { const k = (c.car_in_question || '').trim(); return [k ? autoNorm(k) : '~none', k || '(none)']; }
      case 'budget': return budgetBucketOf(effBudget(c), buckets);
      default: { const raw = c.lead_status || 'cold'; const label = statusLabels[autoNorm(raw)] || raw; return [autoNorm(label), label]; }
    }
  }
  const measureVal = (count, budget) => measure === 'count' ? count : measure === 'budget_avg' ? Math.round(budget / (count || 1)) : Math.round(budget);
  const orderEntries = (obj, dim) => {
    const arr = Object.values(obj);
    if (dim === 'budget' || dim === 'month') arr.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    else arr.sort((a, b) => measure === 'count' ? b.count - a.count : b.budget - a.budget);
    return arr;
  };

  let totalCount = 0, totalBudget = 0, hotCount = 0;
  const tally = c => { const b = effBudget(c) || 0; totalCount++; totalBudget += b; if (autoNorm(c.lead_status || 'cold') === 'hot') hotCount++; return b; };
  const totalsOut = () => ({ count: totalCount, budget: Math.round(totalBudget), avg: totalCount ? Math.round(totalBudget / totalCount) : 0 });
  const rangeOut = { from: fromDay || '', to: toDay || '' };

  if (splitBy) {
    // Cross-tab: primary group rows × split-by category columns.
    const map = {};      // primKey -> {key,label,count,budget,sub:{splitKey:{count,budget}}}
    const splitAgg = {}; // splitKey -> {key,label,count,budget}
    for (const c of leads) {
      const b = tally(c);
      const [pk, pl] = dimKeyLabel(groupBy, c);
      const [sk, sl] = dimKeyLabel(splitBy, c);
      if (!map[pk]) map[pk] = { key: pk, label: pl, count: 0, budget: 0, sub: {} };
      map[pk].count++; map[pk].budget += b;
      if (!map[pk].sub[sk]) map[pk].sub[sk] = { count: 0, budget: 0 };
      map[pk].sub[sk].count++; map[pk].sub[sk].budget += b;
      if (!splitAgg[sk]) splitAgg[sk] = { key: sk, label: sl, count: 0, budget: 0 };
      splitAgg[sk].count++; splitAgg[sk].budget += b;
    }
    const splitCats = orderEntries(splitAgg, splitBy).map(s => ({ key: s.key, label: s.label }));
    const rows = orderEntries(map, groupBy).map(r => ({
      label: r.label, count: r.count, value: measureVal(r.count, r.budget),
      cells: splitCats.reduce((o, s) => { const cell = r.sub[s.key]; o[s.key] = cell ? measureVal(cell.count, cell.budget) : 0; return o; }, {}),
    }));
    return { groupBy, splitBy, measure, splitCats, rows, totals: totalsOut(), hotCount, range: rangeOut };
  }

  // Single dimension (unchanged output shape)
  const map = {};
  for (const c of leads) {
    const b = tally(c);
    const [k, label] = dimKeyLabel(groupBy, c);
    if (!map[k]) map[k] = { key: k, label, count: 0, budget: 0 };
    map[k].count++; map[k].budget += b;
  }
  const rows = orderEntries(map, groupBy).map(r => ({ label: r.label, count: r.count, value: measureVal(r.count, r.budget) }));
  return { groupBy, splitBy: '', measure, rows, totals: totalsOut(), hotCount, range: rangeOut };
}
receiver.router.get('/api/dashboard/reports/leads', requireAuth, async (req, res) => {
  try { res.json(await buildLeadsReport(req.query)); }
  catch (e) { console.error('[reports-leads]', e); res.status(500).json({ error: e.message }); }
});

receiver.router.get('/api/dashboard/reports/export.csv', requireAuth, async (req, res) => {
  try {
    const rep = await buildSalesReport(req.query);
    const which = String(req.query.report || 'pipeline');
    let rows = [], cols = null, fname = which;
    if (which === 'pipeline') { rows = rep.pipelineByStage; cols = ['stage', 'count', 'value']; }
    else if (which === 'by_source') { rows = rep.bySource; cols = ['source', 'deals', 'won', 'value']; }
    else if (which === 'by_rep') { rows = rep.byRep; cols = ['rep', 'deals', 'won', 'value']; }
    else if (which === 'revenue_by_month') { rows = rep.revenueByMonth; cols = ['month', 'value']; }
    else if (which === 'hours') { rows = rep.hoursByEmployee; cols = ['employee', 'hours']; }
    else if (which === 'summary') {
      rows = [
        { metric: 'Date range', value: `${rep.range.from} → ${rep.range.to}` },
        { metric: 'Open pipeline (EGP)', value: rep.totalPipeline },
        { metric: 'Weighted pipeline (EGP)', value: rep.weightedPipeline },
        { metric: 'Win rate (%)', value: rep.winRate },
        { metric: 'Revenue won (EGP)', value: rep.revenueWon },
        { metric: 'Deals won', value: rep.wonCount },
        { metric: 'Avg deal (EGP)', value: rep.avgDeal },
        { metric: 'Quotes generated', value: rep.quotesCount },
      ];
      cols = ['metric', 'value'];
    } else { return res.status(400).json({ error: 'Unknown report' }); }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="motolinker-${fname}-${rep.range.from}_${rep.range.to}.csv"`);
    res.send(csvSerialize(rows, cols));
  } catch (e) { console.error('[reports-csv]', e); res.status(500).json({ error: e.message }); }
});


// Normalize the assignee input: accepts assignee_ids (array) and/or assignee_id.
// Returns { primary, list } where primary keeps the legacy single column populated.
function normalizeAssignees(body) {
  let list = Array.isArray(body.assignee_ids) ? body.assignee_ids.map(String).filter(Boolean) : [];
  if (!list.length && body.assignee_id) list = [String(body.assignee_id)];
  list = [...new Set(list)];
  return { primary: list[0] || null, list };
}
function taskAssigneeList(task) {
  const list = Array.isArray(task?.assignee_ids) && task.assignee_ids.length ? task.assignee_ids.map(String) : (task?.assignee_id ? [String(task.assignee_id)] : []);
  return [...new Set(list)];
}

receiver.router.post('/api/dashboard/tasks', requireAuth, express.json(), async (req, res) => {
  const { title, description, due_date, priority, milestone } = req.body;
  const { primary, list } = normalizeAssignees(req.body);
  if (!title || !primary || !due_date || !priority)
    return res.status(400).json({ error: 'Missing required fields: title, assignee(s), due_date, priority' });
  const { data: task, error } = await supabase.from('tasks')
    .insert({ title, description: description || '', channel_id: '', channel_name: '', assignee_id: primary, assignee_ids: list, due_date, priority, milestone: milestone || '', created_by: 'dashboard', status: 'todo' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Notify every assignee via SSE (if portal is open) and push (always)
  notifyEmployeeTaskAssigned(task);
  syncTaskToCalendar(task);   // best-effort Google Calendar event for the assignees
  runAutomations('task.created', taskCtx(task));
  res.json(task);
});

receiver.router.put('/api/dashboard/tasks/:id', requireAuth, express.json(), async (req, res) => {
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  if (updates.status === 'done' && !updates.completed_at) updates.completed_at = new Date().toISOString();
  if (updates.status && updates.status !== 'done') updates.completed_at = null;
  if (updates.assignee_ids !== undefined || updates.assignee_id !== undefined) {
    const { primary, list } = normalizeAssignees(updates);
    updates.assignee_id = primary;
    updates.assignee_ids = list;
  }
  // Capture prior assignees + status to detect (re)assignment and completion
  const { data: prev } = await supabase.from('tasks').select('assignee_id, assignee_ids, status').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('tasks').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Notify only newly-added assignees
  const before = new Set(taskAssigneeList(prev));
  const added = taskAssigneeList(data).filter(id => !before.has(id));
  if (added.length) notifyEmployeeTaskAssigned({ ...data, assignee_ids: added });
  // Keep calendars in step with due-date / title / assignee edits. Removals matter
  // too — the event has to come off the ex-assignee's calendar.
  const removed = taskAssigneeList(prev).filter(id => !taskAssigneeList(data).includes(id));
  if (added.length || removed.length || updates.due_date !== undefined || updates.title !== undefined) syncTaskToCalendar(data);
  if (data.status === 'done' && prev?.status !== 'done') runAutomations('task.completed', taskCtx(data));
  res.json(data);
});

receiver.router.delete('/api/dashboard/tasks/:id', requireAuth, async (req, res) => {
  // Grab the event ids before the row goes, so the calendars can be cleaned up.
  const { data: doomed } = await supabase.from('tasks').select('id,calendar_events,calendar_event_id').eq('id', req.params.id).single();
  const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
  deleteTaskCalendarEvents(doomed);
});

// Remove every calendar event a task created (personal + the company invite).
async function deleteTaskCalendarEvents(task) {
  if (!task) return;
  const map = (task.calendar_events && typeof task.calendar_events === 'object') ? { ...task.calendar_events } : {};
  if (task.calendar_event_id && !map.company) map.company = task.calendar_event_id;
  for (const [key, eventId] of Object.entries(map)) {
    try {
      const token = key === 'company' ? await getCalendarToken() : await getEmployeeCalendarToken(Number(key));
      if (!token) continue;
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}${key === 'company' ? '?sendUpdates=all' : ''}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    } catch (e) { console.warn('[calendar] delete failed for', key, e.message); }
  }
}

// ── Recurring Tasks (templates that auto-generate tasks) ──────────────────────
// Date helpers work on YYYY-MM-DD strings in UTC, matching how the rest of the
// app computes "today" (new Date().toISOString().split('T')[0]).
function rtToday() { return new Date().toISOString().split('T')[0]; }
function rtAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}
function rtWeekday(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay(); } // 0=Sun..6=Sat
function rtCleanWeekdays(v) {
  const arr = Array.isArray(v) ? v : [];
  return [...new Set(arr.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
}
// Smallest date >= base whose weekday is in the set (base itself counts).
function rtNextWeeklyOnOrAfter(baseStr, weekdays) {
  const wd = rtCleanWeekdays(weekdays);
  if (!wd.length) return null;
  for (let i = 0; i < 7; i++) { const d = rtAddDays(baseStr, i); if (wd.includes(rtWeekday(d))) return d; }
  return null;
}
// Smallest date strictly after `afterStr` whose weekday is in the set.
function rtNextWeeklyAfter(afterStr, weekdays) {
  return rtNextWeeklyOnOrAfter(rtAddDays(afterStr, 1), weekdays);
}
// First run date for a template (on/after start_date, else today).
function rtComputeInitialNextRun(rt) {
  const today = rtToday();
  let base = rt.start_date && rt.start_date > today ? rt.start_date : today;
  if (rt.recurrence_type === 'weekly') return rtNextWeeklyOnOrAfter(base, rt.weekdays);
  return base; // interval: fire on the start date (or today)
}
// Next run date after an instance was generated on `ranOn`.
function rtComputeNextAfterRun(rt, ranOn) {
  if (rt.recurrence_type === 'weekly') return rtNextWeeklyAfter(ranOn, rt.weekdays);
  const step = Math.max(1, parseInt(rt.interval_days, 10) || 1);
  return rtAddDays(ranOn, step);
}
// Validate + normalize a recurring-task body. Returns { row, error }.
function rtBuildRow(body) {
  const title = String(body.title || '').trim();
  const { primary, list } = normalizeAssignees(body);
  const recurrence_type = body.recurrence_type === 'weekly' ? 'weekly' : (body.recurrence_type === 'interval' ? 'interval' : null);
  if (!title) return { error: 'Title is required' };
  if (!primary) return { error: 'At least one assignee is required' };
  if (!recurrence_type) return { error: 'Recurrence type must be "interval" or "weekly"' };
  const priority = ['high', 'medium', 'low'].includes(body.priority) ? body.priority : 'medium';
  let interval_days = null, weekdays = null;
  if (recurrence_type === 'interval') {
    interval_days = parseInt(body.interval_days, 10);
    if (!Number.isInteger(interval_days) || interval_days < 1) return { error: 'Enter a valid number of days (1 or more)' };
  } else {
    weekdays = rtCleanWeekdays(body.weekdays);
    if (!weekdays.length) return { error: 'Pick at least one weekday' };
  }
  const due_offset_days = Math.max(0, parseInt(body.due_offset_days, 10) || 0);
  const start_date = body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date) ? body.start_date : null;
  return { row: {
    title, description: String(body.description || '').trim(),
    assignee_id: primary, assignee_ids: list,
    priority, milestone: String(body.milestone || '').trim(),
    recurrence_type, interval_days, weekdays, due_offset_days, start_date,
  } };
}

receiver.router.get('/api/dashboard/recurring-tasks', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('recurring_tasks').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/recurring-tasks', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = rtBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  row.next_run_date = rtComputeInitialNextRun(row);
  row.created_by = 'dashboard';
  const { data, error } = await supabase.from('recurring_tasks').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.put('/api/dashboard/recurring-tasks/:id', requireAuth, express.json(), async (req, res) => {
  // Active-only toggle: don't require the full recurrence payload.
  if (Object.keys(req.body).length === 1 && typeof req.body.active === 'boolean') {
    const { data, error } = await supabase.from('recurring_tasks').update({ active: req.body.active, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const { row, error: verr } = rtBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  if (typeof req.body.active === 'boolean') row.active = req.body.active;
  row.next_run_date = rtComputeInitialNextRun(row); // recompute schedule from the edited recurrence
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('recurring_tasks').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/recurring-tasks/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('recurring_tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Generate one task instance from a template now (manual trigger).
receiver.router.post('/api/dashboard/recurring-tasks/:id/run-now', requireAuth, async (req, res) => {
  const { data: rt, error } = await supabase.from('recurring_tasks').select('*').eq('id', req.params.id).single();
  if (error || !rt) return res.status(404).json({ error: 'Recurring task not found' });
  const task = await generateRecurringInstance(rt, rtToday(), true);
  if (!task) return res.status(500).json({ error: 'Could not create the task' });
  res.json(task);
});

// Create a task row from a template for a given run date. `force` bypasses the
// once-per-day guard (used by Run now). Advances the template's schedule.
async function generateRecurringInstance(rt, runDate, force) {
  if (!force && rt.last_run_date === runDate) return null; // already generated today
  const list = taskAssigneeList(rt);
  const due_date = rtAddDays(runDate, Math.max(0, rt.due_offset_days || 0));
  const { data: task, error } = await supabase.from('tasks').insert({
    title: rt.title, description: rt.description || '', channel_id: '', channel_name: '',
    assignee_id: rt.assignee_id || (list[0] || null), assignee_ids: list,
    due_date, priority: rt.priority || 'medium', milestone: rt.milestone || '',
    created_by: 'recurring', status: 'todo', recurring_id: rt.id,
  }).select().single();
  if (error) { console.warn('[recurring] task insert failed:', error.message); return null; }
  notifyEmployeeTaskAssigned(task);
  syncTaskToCalendar(task);   // best-effort Google Calendar event for the assignees
  await supabase.from('recurring_tasks').update({
    last_run_date: runDate,
    next_run_date: rtComputeNextAfterRun(rt, runDate),
    updated_at: new Date().toISOString(),
  }).eq('id', rt.id);
  console.log('[recurring] generated task', task.id, 'from template', rt.id);
  return task;
}

// Scheduler tick: generate instances for every active template due on/before today.
async function runRecurringTasks() {
  const today = rtToday();
  const { data: due, error } = await supabase.from('recurring_tasks')
    .select('*').eq('active', true).not('next_run_date', 'is', null).lte('next_run_date', today);
  if (error) { console.warn('[recurring] sweep failed:', error.message); return; }
  for (const rt of due || []) {
    try { await generateRecurringInstance(rt, today, false); }
    catch (e) { console.warn('[recurring] instance error for', rt.id, e.message); }
  }
}
function scheduleRecurringTasks() {
  setTimeout(() => runRecurringTasks().catch(console.error), 35 * 1000); // catch-up shortly after boot
  setInterval(() => runRecurringTasks().catch(console.error), 60 * 60 * 1000); // hourly (guarded once/day)
}

// Car Stock (immediate-delivery inventory)  → src/routes/stock.js
Object.assign(ctx, { express, parseCSV, receiver, requireAuth, supabase, upload });
require('./stock');
// Suppliers (Logistics & Shipping)  → src/routes/suppliers.js
Object.assign(ctx, { GOOGLE_CLIENT_ID, crypto, express, getDriveToken, multer, receiver, requireAuth, supabase, upload });
require('./suppliers');

module.exports = { DEAL_STAGES, buildLeadsReport, buildSalesReport, csvSerialize, scheduleRecurringTasks, taskAssigneeList };
