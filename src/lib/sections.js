// What the assistant knows about each section of the app.
//
// One entry per section: how to turn that section's rows into a pack of figures
// the model is handed, the named queries it may run against those rows, the
// suggestion chips the drawer offers, the insight task for the page card, and
// which confirmed actions make sense there. Pure on purpose — no database, no
// context object — so tests/assisttest.js can feed fixtures and assert the
// numbers, and so every figure the assistant quotes comes from code here.
//
// The rows arrive already scoped (src/routes/assistant.js applies each
// section's permission and the employee's data scope before building), so a
// pack never carries more than the person could see on the page itself.
const { LEADS_ENUM_DEFAULTS, PAYMENT_KINDS, PAYMENT_KIND_KEYS, PAYMENT_METHODS, CURRENCIES, EXPENSE_CATEGORY_KEYS } = require('./constants');

const num = v => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const str = (v, max) => String(v ?? '').trim().slice(0, max || 200);
const arr = v => (Array.isArray(v) ? v : []);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = v => { const s = String(v || '').slice(0, 10); return DATE_RE.test(s) ? s : ''; };
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => { const x = Date.parse(dayOf(a) + 'T00:00:00Z'), y = Date.parse(dayOf(b) + 'T00:00:00Z'); return (Number.isFinite(x) && Number.isFinite(y)) ? Math.round((y - x) / 864e5) : null; };
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const lower = v => String(v || '').toLowerCase();
const has = (hay, q) => lower(hay).includes(lower(q));
const limitOf = (a, def, max) => Math.max(1, Math.min(max || 50, Math.floor(num(a && a.limit)) || def || 10));
const countBy = (rows, key, label) => {
  const m = {};
  for (const r of rows) { const k = String((typeof key === 'function' ? key(r) : r[key]) || '') || '(none)'; m[k] = (m[k] || 0) + 1; }
  return Object.entries(m).map(([k, n]) => ({ [label || 'key']: k, count: n })).sort((a, b) => b.count - a.count);
};
const nameOf = (employees, id) => { const e = arr(employees).find(x => String(x.id) === String(id)); return e ? e.name : (id ? '#' + id : 'Unassigned'); };
const LEAD_STATUSES = LEADS_ENUM_DEFAULTS.status.map(([k, l]) => ({ key: k, label: l }));
const DEAL_STAGES = ['lead', 'inquiry', 'quoted', 'negotiating', 'won', 'lost'];
const OPEN_STAGES = ['lead', 'inquiry', 'quoted', 'negotiating'];

// ── Leads ───────────────────────────────────────────────────────────────────
function leadRow(c, lastAt, today) {
  const last = dayOf(lastAt) || dayOf(c.created_at) || dayOf(c.lead_date);
  return {
    id: c.id, name: str(c.name, 80), phone: str(c.phone, 30), status: str(c.lead_status, 30) || 'cold', source: str(c.source, 30),
    car: str(c.car_in_question, 60), budget: num(c.budget_lead), assigned_to: c.assigned_to || null, contacted: c.been_contacted === true,
    created_at: dayOf(c.created_at) || dayOf(c.lead_date) || null, last_activity_at: last || null,
    days_silent: last ? Math.max(0, daysBetween(last, today) ?? 0) : null, next_action: str(c.next_action, 40),
  };
}
function buildLeadsPack(data, opts) {
  const d = data || {}, t = dayOf(opts && opts.today) || todayStr();
  const customers = arr(d.customers), activities = arr(d.activities), followups = arr(d.followups), employees = arr(d.employees);
  const lastByCustomer = {};
  for (const a of activities) { const k = String(a.customer_id); const day = dayOf(a.created_at); if (day && (!lastByCustomer[k] || day > lastByCustomer[k])) lastByCustomer[k] = day; }
  const rows = customers.map(c => leadRow(c, lastByCustomer[String(c.id)], t));
  const week = addDays(t, -7), month = addDays(t, -30);
  const active = rows.filter(r => ['warm', 'hot', 'immediate_delivery'].includes(r.status));
  const stale = active.filter(r => r.days_silent != null && r.days_silent >= 14).sort((a, b) => b.days_silent - a.days_silent);
  const fu = followups.map(f => ({ id: f.id, customer_id: f.customer_id, client: (customers.find(c => String(c.id) === String(f.customer_id)) || {}).name || '',
    due_at: f.due_at, due_day: dayOf(f.due_at), note: str(f.note, 200), assigned_to: f.assigned_to || null, status: f.status || 'pending' }));
  const pending = fu.filter(f => f.status === 'pending');
  const overdue = pending.filter(f => f.due_day && f.due_day < t), dueToday = pending.filter(f => f.due_day === t), dueWeek = pending.filter(f => f.due_day > t && f.due_day <= addDays(t, 7));
  const repMap = {};
  for (const r of rows) { const k = r.assigned_to || ''; repMap[k] = repMap[k] || { employee_id: r.assigned_to, name: nameOf(employees, r.assigned_to), leads: 0, hot: 0 }; repMap[k].leads++; if (r.status === 'hot') repMap[k].hot++; }
  return {
    today: t,
    counts: { total: rows.length, by_status: countBy(rows, 'status', 'status'), by_source: countBy(rows, 'source', 'source'),
      new_7d: rows.filter(r => r.created_at && r.created_at >= week).length, new_30d: rows.filter(r => r.created_at && r.created_at >= month).length,
      unassigned: rows.filter(r => !r.assigned_to).length, contacted_pct: rows.length ? Math.round(rows.filter(r => r.contacted).length / rows.length * 100) : 0,
      hot: rows.filter(r => r.status === 'hot').length, warm: rows.filter(r => r.status === 'warm').length },
    followups: { pending: pending.length, overdue: overdue.length, today: dueToday.length, week: dueWeek.length,
      rows: [...overdue, ...dueToday].sort((a, b) => String(a.due_at).localeCompare(String(b.due_at))).slice(0, 15) },
    stale: { count: stale.length, rows: stale.slice(0, 20) },
    recent: rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 10),
    activity_7d: { total: activities.filter(a => dayOf(a.created_at) >= week).length, by_type: countBy(activities.filter(a => dayOf(a.created_at) >= week), 'type', 'type') },
    by_rep: Object.values(repMap).sort((a, b) => b.leads - a.leads),
    statuses: LEAD_STATUSES,
    _rows: rows, _followups: fu, _activities: activities,
  };
}
const LEADS_QUERIES = {
  leads_by_status: (p, a) => ({ status: a.status || 'any', rows: p._rows.filter(r => !a.status || r.status === a.status).slice(0, limitOf(a, 15)) }),
  leads_by_source: (p) => ({ rows: p.counts.by_source }),
  stale_leads: (p, a) => { const days = Math.max(1, Math.floor(num(a.days)) || 14); const rows = p._rows.filter(r => r.days_silent != null && r.days_silent >= days && (!a.status || r.status === a.status)).sort((x, y) => y.days_silent - x.days_silent); return { days, count: rows.length, rows: rows.slice(0, limitOf(a, 15)) }; },
  find_lead: (p, a) => { const q = str(a.q, 60); if (!q) return { error: 'Give part of a name, phone or car' }; const rows = p._rows.filter(r => has(r.name, q) || has(r.phone, q) || has(r.car, q)); return { q, count: rows.length, rows: rows.slice(0, limitOf(a, 10)) }; },
  lead_detail: (p, a) => { const id = num(a.customer_id); const r = p._rows.find(x => Number(x.id) === id); if (!r) return { error: 'No lead with that id in your scope' };
    return { lead: r, followups: p._followups.filter(f => Number(f.customer_id) === id).slice(0, 10), activity: p._activities.filter(x => Number(x.customer_id) === id).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, 10).map(x => ({ type: x.type, body: str(x.body, 200), at: x.created_at })) }; },
  followups: (p, a) => { const when = a.when || 'overdue'; const rows = p._followups.filter(f => f.status === 'pending').filter(f => when === 'overdue' ? f.due_day < p.today : when === 'today' ? f.due_day === p.today : when === 'week' ? (f.due_day >= p.today && f.due_day <= addDays(p.today, 7)) : true); return { when, count: rows.length, rows: rows.slice(0, limitOf(a, 15)) }; },
  recent_activity: (p, a) => { const days = Math.max(1, Math.floor(num(a.days)) || 7); const since = addDays(p.today, -days); const rows = p._activities.filter(x => dayOf(x.created_at) >= since).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, limitOf(a, 20)).map(x => ({ customer_id: x.customer_id, type: x.type, body: str(x.body, 160), at: x.created_at })); return { days, rows }; },
};

// ── Deals ───────────────────────────────────────────────────────────────────
function buildDealsPack(data, opts) {
  const d = data || {}, t = dayOf(opts && opts.today) || todayStr();
  const deals = arr(d.deals), sales = arr(d.sales), employees = arr(d.employees);
  const prob = { lead: 10, inquiry: 25, quoted: 50, negotiating: 75, won: 100, lost: 0, ...(d.stageProb || {}) };
  const rows = deals.map(x => ({ id: x.id, title: str(x.title, 100), stage: str(x.stage, 20) || 'lead', value: num(x.budget_egp), customer_id: x.customer_id || null,
    customer: str(x.customers && x.customers.name, 80), car: str(x.car_model, 60), assigned_to: x.assigned_to || null, rep: nameOf(employees, x.assigned_to),
    created_at: dayOf(x.created_at), closed_at: dayOf(x.closed_at) || null, days_open: dayOf(x.created_at) ? Math.max(0, daysBetween(x.created_at, t) ?? 0) : null }));
  const open = rows.filter(r => OPEN_STAGES.includes(r.stage));
  const month = t.slice(0, 7);
  const wonMonth = rows.filter(r => r.stage === 'won' && (r.closed_at || '').startsWith(month)), lostMonth = rows.filter(r => r.stage === 'lost' && (r.closed_at || '').startsWith(month));
  const won = rows.filter(r => r.stage === 'won').length, lost = rows.filter(r => r.stage === 'lost').length;
  const salesRows = sales.map(s => { const price = num(s.discounted) > 0 ? num(s.discounted) : num(s.price_list); const rem = num(s.remaining) > 0 ? num(s.remaining) : Math.max(0, price - num(s.down_payment));
    return { id: s.id, client: str(s.client, 80), vehicle: [s.brand, s.model].filter(Boolean).join(' '), status: str(s.status, 30), price, remaining: round2(rem), due: dayOf(s.remaining_due) || null, delivery: dayOf(s.delivery_date) || null }; });
  const repMap = {};
  for (const r of open) { const k = r.assigned_to || ''; repMap[k] = repMap[k] || { rep: r.rep, open: 0, value: 0 }; repMap[k].open++; repMap[k].value = round2(repMap[k].value + r.value); }
  return {
    today: t,
    pipeline: DEAL_STAGES.map(stage => { const ds = rows.filter(r => r.stage === stage); return { stage, count: ds.length, value: round2(ds.reduce((s, r) => s + r.value, 0)) }; }),
    open: { count: open.length, value: round2(open.reduce((s, r) => s + r.value, 0)), weighted: Math.round(open.reduce((s, r) => s + r.value * (num(prob[r.stage]) / 100), 0)) },
    this_month: { won: wonMonth.length, won_value: round2(wonMonth.reduce((s, r) => s + r.value, 0)), lost: lostMonth.length },
    win_rate: (won + lost) ? Math.round(won / (won + lost) * 100) : 0,
    stuck: { days: 30, count: open.filter(r => r.days_open >= 30).length, rows: open.filter(r => r.days_open >= 30).sort((a, b) => b.days_open - a.days_open).slice(0, 15) },
    top_open: open.slice().sort((a, b) => b.value - a.value).slice(0, 15),
    by_rep: Object.values(repMap).sort((a, b) => b.value - a.value),
    sales: { count: salesRows.length, open: salesRows.filter(s => s.remaining > 0).length, settled: salesRows.filter(s => s.remaining <= 0 && s.price > 0).length,
      outstanding: round2(salesRows.reduce((s, r) => s + r.remaining, 0)), rows: salesRows.filter(s => s.remaining > 0).sort((a, b) => b.remaining - a.remaining).slice(0, 10) },
    stages: DEAL_STAGES, stage_probabilities: prob,
    _rows: rows, _sales: salesRows,
  };
}
const DEALS_QUERIES = {
  pipeline: (p) => ({ pipeline: p.pipeline, open: p.open, win_rate: p.win_rate }),
  deals_by_stage: (p, a) => { if (a.stage && !DEAL_STAGES.includes(a.stage)) return { error: 'stage must be one of ' + DEAL_STAGES.join(', ') }; const rows = p._rows.filter(r => !a.stage || r.stage === a.stage); return { stage: a.stage || 'any', count: rows.length, rows: rows.slice(0, limitOf(a, 15)) }; },
  find_deal: (p, a) => { const q = str(a.q, 60); if (!q) return { error: 'Give part of a title, customer or car' }; const rows = p._rows.filter(r => has(r.title, q) || has(r.customer, q) || has(r.car, q)); return { q, count: rows.length, rows: rows.slice(0, limitOf(a, 10)) }; },
  stuck_deals: (p, a) => { const days = Math.max(1, Math.floor(num(a.days)) || 30); const rows = p._rows.filter(r => OPEN_STAGES.includes(r.stage) && r.days_open >= days).sort((x, y) => y.days_open - x.days_open); return { days, count: rows.length, rows: rows.slice(0, limitOf(a, 15)) }; },
  won_recent: (p, a) => { const days = Math.max(1, Math.floor(num(a.days)) || 30); const since = addDays(p.today, -days); const rows = p._rows.filter(r => r.stage === 'won' && r.closed_at && r.closed_at >= since); return { days, count: rows.length, value: round2(rows.reduce((s, r) => s + r.value, 0)), rows: rows.slice(0, limitOf(a, 15)) }; },
  sales_open: (p, a) => ({ count: p.sales.open, outstanding: p.sales.outstanding, rows: p._sales.filter(s => s.remaining > 0).sort((x, y) => y.remaining - x.remaining).slice(0, limitOf(a, 15)) }),
};

// ── Documents: quotations, contracts, RFQs, purchase orders ─────────────────
function quoteTotal(data) {
  const q = data && typeof data === 'object' ? data : {};
  const items = arr(q.items).reduce((s, it) => s + num(it.priceUsd) * (num(it.unit) || num(it.units) || num(it.qty) || 1), 0);
  const logistics = arr(q.logistics).reduce((s, it) => s + num(it.priceUsd), 0);
  return round2(items + logistics);
}
function buildQuotationPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const rows = arr((data || {}).quotations).map(q => { const d = q.data && typeof q.data === 'object' ? q.data : {}; return { id: q.id, quote_id: str(q.quote_id, 40), title: str(q.title, 100), customer: str(d.name, 80), vehicle: str(d.vehicleModel, 80),
    usd_total_indicative: quoteTotal(d), exchange: num(d.exchange), customer_id: q.customer_id || null, deal_id: q.deal_id || null, created_at: dayOf(q.created_at), created_by: str(q.created_by, 40) }; });
  const month = t.slice(0, 7);
  return { today: t, total: rows.length, this_month: rows.filter(r => (r.created_at || '').startsWith(month)).length, by_month: countBy(rows, r => (r.created_at || '').slice(0, 7), 'month').slice(0, 6),
    by_vehicle: countBy(rows, 'vehicle', 'vehicle').slice(0, 8), recent: rows.slice(0, 15), definitions: ['usd_total_indicative = Σ items.priceUsd × units + Σ logistics.priceUsd, as saved in the quotation'], _rows: rows };
}
const QUOTATION_QUERIES = {
  recent_quotes: (p, a) => ({ rows: p._rows.slice(0, limitOf(a, 15)) }),
  find_quote: (p, a) => { const q = str(a.q, 60); if (!q) return { error: 'Give part of a customer, vehicle or quote id' }; const rows = p._rows.filter(r => has(r.customer, q) || has(r.vehicle, q) || has(r.quote_id, q) || has(r.title, q)); return { q, count: rows.length, rows: rows.slice(0, limitOf(a, 10)) }; },
  quotes_by_month: (p) => ({ rows: p.by_month }),
};
function buildContractsPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const rows = arr((data || {}).contracts).map(c => ({ id: c.id, contract_no: str(c.contract_no, 40), title: str(c.title, 100), status: str(c.status, 20) || 'draft', customer_id: c.customer_id || null, deal_id: c.deal_id || null, created_at: dayOf(c.created_at), created_by: str(c.created_by, 40) }));
  const month = t.slice(0, 7);
  return { today: t, total: rows.length, by_status: countBy(rows, 'status', 'status'), this_month: rows.filter(r => (r.created_at || '').startsWith(month)).length,
    unsigned_old: rows.filter(r => r.status === 'draft' && r.created_at && daysBetween(r.created_at, t) >= 14).slice(0, 10), recent: rows.slice(0, 15), _rows: rows };
}
const CONTRACTS_QUERIES = {
  contracts_by_status: (p, a) => ({ status: a.status || 'any', rows: p._rows.filter(r => !a.status || r.status === a.status).slice(0, limitOf(a, 15)) }),
  find_contract: (p, a) => { const q = str(a.q, 60); if (!q) return { error: 'Give part of a title or contract number' }; const rows = p._rows.filter(r => has(r.title, q) || has(r.contract_no, q)); return { q, count: rows.length, rows: rows.slice(0, limitOf(a, 10)) }; },
};
function buildRfqPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const rows = arr((data || {}).rfqs).map(r => ({ id: r.id, rfq_no: str(r.rfq_no, 40), title: str(r.title, 100), supplier: str(r.supplier_name, 80), supplier_id: r.supplier_id || null, status: str(r.status, 20) || 'draft',
    rfq_date: dayOf(r.rfq_date) || dayOf(r.created_at), lines: arr(r.items).length, models: [...new Set(arr(r.items).map(it => str(it.model || it.name || it.spec, 60)).filter(Boolean))].slice(0, 6), customer_id: r.customer_id || null }));
  return { today: t, total: rows.length, by_status: countBy(rows, 'status', 'status'), by_supplier: countBy(rows, 'supplier', 'supplier').slice(0, 10),
    awaiting: rows.filter(r => r.status === 'sent').map(r => ({ ...r, days_waiting: r.rfq_date ? Math.max(0, daysBetween(r.rfq_date, t) ?? 0) : null })).sort((a, b) => (b.days_waiting || 0) - (a.days_waiting || 0)).slice(0, 10),
    recent: rows.slice(0, 15), _rows: rows };
}
const RFQ_QUERIES = {
  rfqs_by_status: (p, a) => ({ status: a.status || 'any', rows: p._rows.filter(r => !a.status || r.status === a.status).slice(0, limitOf(a, 15)) }),
  rfqs_by_supplier: (p, a) => { const q = str(a.supplier, 60); return { supplier: q || 'any', rows: p._rows.filter(r => !q || has(r.supplier, q)).slice(0, limitOf(a, 15)) }; },
  find_rfq: (p, a) => { const q = str(a.q, 60); if (!q) return { error: 'Give part of a title, number, supplier or model' }; const rows = p._rows.filter(r => has(r.title, q) || has(r.rfq_no, q) || has(r.supplier, q) || r.models.some(m => has(m, q))); return { q, count: rows.length, rows: rows.slice(0, limitOf(a, 10)) }; },
};
function poRow(po, t) {
  const items = arr(po.items);
  return { id: po.id, po_number: str(po.po_number, 40), title: str(po.title, 100), supplier: str(po.supplier, 80), supplier_id: po.supplier_id || null, status: str(po.status, 20) || 'draft', currency: str(po.currency, 8) || 'USD',
    po_date: dayOf(po.po_date) || dayOf(po.created_at), pi_total: round2(items.reduce((s, it) => s + num(it.pi_price) * (num(it.units) || 1), 0)), units: items.reduce((s, it) => s + (num(it.units) || 1), 0),
    // A line saved without a status is where every PO line starts: sent to the supplier.
    lines: items.length, line_status: countBy(items, it => it.status || 'send_to_supplier', 'status'), clients: [...new Set(items.map(it => str(it.client, 60)).filter(Boolean))].slice(0, 6), incoterm: str(po.incoterm, 20), payment_terms: str(po.payment_terms, 120),
    days_open: (po.status !== 'closed' && dayOf(po.po_date || po.created_at)) ? Math.max(0, daysBetween(po.po_date || po.created_at, t) ?? 0) : null };
}
function buildPurchaseOrdersPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const rows = arr((data || {}).purchase_orders).map(po => poRow(po, t));
  const byCcy = {}; for (const r of rows) if (r.status !== 'closed') byCcy[r.currency] = round2((byCcy[r.currency] || 0) + r.pi_total);
  const supMap = {}; for (const r of rows) { const k = r.supplier || '(no supplier)'; supMap[k] = supMap[k] || { supplier: k, orders: 0, units: 0, pi_total_by_currency: {} }; supMap[k].orders++; supMap[k].units += r.units; supMap[k].pi_total_by_currency[r.currency] = round2((supMap[k].pi_total_by_currency[r.currency] || 0) + r.pi_total); }
  const lineStatus = {}; for (const r of rows) for (const ls of r.line_status) lineStatus[ls.status] = (lineStatus[ls.status] || 0) + ls.count;
  return { today: t, total: rows.length, by_status: countBy(rows, 'status', 'status'), open_pi_total_by_currency: byCcy, units_total: rows.reduce((s, r) => s + r.units, 0),
    line_status: Object.entries(lineStatus).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count), by_supplier: Object.values(supMap).sort((a, b) => b.orders - a.orders).slice(0, 10),
    oldest_open: rows.filter(r => r.status !== 'closed' && r.days_open != null).sort((a, b) => b.days_open - a.days_open).slice(0, 10), recent: rows.slice(0, 15),
    definitions: ['pi_total = Σ pi_price × units of the lines, in the PO currency', 'line_status counts every vehicle line by its own status (send to supplier, in preparation, in logistics, delivered)'], _rows: rows };
}
const PO_QUERIES = {
  pos_by_status: (p, a) => ({ status: a.status || 'any', rows: p._rows.filter(r => !a.status || r.status === a.status).slice(0, limitOf(a, 15)) }),
  pos_by_supplier: (p, a) => { const q = str(a.supplier, 60); return { supplier: q || 'any', rows: p._rows.filter(r => !q || has(r.supplier, q)).slice(0, limitOf(a, 15)) }; },
  po_detail: (p, a) => { const q = str(a.po_number, 40); const r = p._rows.find(x => x.po_number === q || Number(x.id) === num(a.po_number)); return r ? { po: r } : { error: 'No purchase order with that number' }; },
  line_status_summary: (p) => ({ rows: p.line_status }),
};

// ── Suppliers ───────────────────────────────────────────────────────────────
function buildSuppliersPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const d = data || {};
  const suppliers = arr(d.suppliers), catalogue = arr(d.supplier_vehicles), pos = arr(d.purchase_orders).map(po => poRow(po, t));
  const offers = catalogue.map(v => ({ supplier_id: v.supplier_id || null, supplier: str(v.supplier_name || (suppliers.find(s => String(s.id) === String(v.supplier_id)) || {}).name, 80), brand: str(v.brand, 40), model: str(v.model, 60), trim: str(v.trim, 60), year: v.model_year || null,
    fob_price: num(v.fob_price), currency: str(v.currency, 8) || 'USD', lead_time: str(v.lead_time, 40), availability: str(v.availability, 40) }));
  const rows = suppliers.map(s => { const mine = pos.filter(p => (p.supplier_id && String(p.supplier_id) === String(s.id)) || (p.supplier && lower(p.supplier) === lower(s.name))); const byCcy = {}; for (const p of mine) byCcy[p.currency] = round2((byCcy[p.currency] || 0) + p.pi_total);
    const off = offers.filter(o => (o.supplier_id && String(o.supplier_id) === String(s.id)) || lower(o.supplier) === lower(s.name));
    return { id: s.id, name: str(s.name, 80), country: str(s.country, 40), contact: str(s.contact, 80), orders: mine.length, units: mine.reduce((x, p) => x + p.units, 0), pi_total_by_currency: byCcy, open_orders: mine.filter(p => p.status !== 'closed').length,
      catalogue: off.length, models: [...new Set(off.map(o => [o.brand, o.model].filter(Boolean).join(' ')))].slice(0, 8) }; });
  const cheapest = {}; for (const o of offers) { const k = [o.brand, o.model].filter(Boolean).join(' ').toLowerCase(); if (!k || !(o.fob_price > 0)) continue; if (!cheapest[k] || o.fob_price < cheapest[k].fob_price) cheapest[k] = o; }
  return { today: t, total: suppliers.length, rows: rows.sort((a, b) => b.orders - a.orders), catalogue: { offers: offers.length, models: Object.keys(cheapest).length, cheapest_per_model: Object.values(cheapest).slice(0, 20) },
    definitions: ['pi_total_by_currency sums the PI totals of that supplier\'s purchase orders', 'fob_price is what the supplier quoted in the catalogue, not what was paid'], _rows: rows, _offers: offers };
}
const SUPPLIERS_QUERIES = {
  supplier_detail: (p, a) => { const q = str(a.name, 60); const r = p._rows.find(x => has(x.name, q)); return r ? { supplier: r, offers: p._offers.filter(o => (o.supplier_id && String(o.supplier_id) === String(r.id)) || lower(o.supplier) === lower(r.name)).slice(0, 20) } : { error: 'No supplier matches' }; },
  catalogue: (p, a) => { const q = str(a.q || a.model || a.brand || a.supplier, 60); const rows = p._offers.filter(o => !q || has(o.model, q) || has(o.brand, q) || has(o.supplier, q) || has(o.trim, q)); return { q: q || 'all', count: rows.length, rows: rows.sort((x, y) => (x.fob_price || 1e12) - (y.fob_price || 1e12)).slice(0, limitOf(a, 15)) }; },
  cheapest_offer: (p, a) => { const q = str(a.model, 60); if (!q) return { error: 'Name a model' }; const rows = p._offers.filter(o => (has(o.model, q) || has(o.brand + ' ' + o.model, q)) && o.fob_price > 0).sort((x, y) => x.fob_price - y.fob_price); return { model: q, count: rows.length, rows: rows.slice(0, limitOf(a, 5)) }; },
};

// ── Inventory: stock and containers ─────────────────────────────────────────
function buildStockPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const d = data || {};
  const models = arr(d.stock_vehicles).map(m => { const units = arr(m.units); return { id: m.id, make: str(m.make, 40), model: str(m.model, 60), trim: str(m.trim, 60), price: num(m.price), units: units.length,
    by_status: countBy(units, 'status', 'status'), by_colour: countBy(units, 'colour', 'colour').slice(0, 6), unassigned: units.filter(u => !str(u.consignee, 10)).length,
    list_value: round2(units.reduce((s, u) => s + (num(u.price_list) || num(m.price)), 0)), vins: units.map(u => str(u.vin, 20)).filter(Boolean).slice(0, 40) }; });
  const allUnits = arr(d.stock_vehicles).flatMap(m => arr(m.units).map(u => ({ model: [m.make, m.model, m.trim].filter(Boolean).join(' '), vin: str(u.vin, 20), colour: str(u.colour, 30), status: str(u.status, 30), consignee: str(u.consignee, 80), supplier: str(u.supplier, 80), logistics: str(u.logistics, 80), price_list: num(u.price_list) || num(m.price) })));
  const containers = arr(d.containers).map(c => ({ id: c.id, container_no: str(c.container_no, 20), status: str(c.status, 20), carrier: str(c.carrier, 40), vessel: str(c.vessel_name, 60), latest_move: str(c.latest_move, 120), pod_eta: dayOf(c.pod_eta) || dayOf(c.eta) || null, pol: str(c.pol_name, 60), pod: str(c.pod_name, 60), supplier: str(c.supplier, 80), vins: arr(c.units).map(u => str(u.vin || u, 20)).filter(Boolean).slice(0, 20),
    days_to_eta: (dayOf(c.pod_eta) || dayOf(c.eta)) ? daysBetween(t, dayOf(c.pod_eta) || dayOf(c.eta)) : null }));
  return { today: t, models: models.sort((a, b) => b.units - a.units), totals: { models: models.length, units: allUnits.length, list_value: round2(allUnits.reduce((s, u) => s + u.price_list, 0)), unassigned: allUnits.filter(u => !u.consignee).length, by_status: countBy(allUnits, 'status', 'status') },
    containers: { total: containers.length, by_status: countBy(containers, 'status', 'status'), in_transit: containers.filter(c => c.status === 'in_transit').slice(0, 15), arriving_7d: containers.filter(c => c.days_to_eta != null && c.days_to_eta >= 0 && c.days_to_eta <= 7).slice(0, 10) },
    definitions: ['units are the physical cars listed under each model; list_value uses the unit price where set, else the model price', 'containers appear only when tracking is permitted'], _units: allUnits, _containers: containers };
}
const STOCK_QUERIES = {
  stock_by_model: (p, a) => ({ rows: p.models.filter(m => !a.q || has([m.make, m.model, m.trim].join(' '), a.q)).slice(0, limitOf(a, 20)) }),
  units_by_status: (p, a) => ({ status: a.status || 'any', rows: p._units.filter(u => !a.status || u.status === a.status).slice(0, limitOf(a, 20)) }),
  available_units: (p, a) => { const q = str(a.model, 60); const rows = p._units.filter(u => !u.consignee && (!q || has(u.model, q))); return { model: q || 'any', count: rows.length, rows: rows.slice(0, limitOf(a, 20)) }; },
  find_vin: (p, a) => { const q = str(a.vin, 20).toUpperCase(); if (!q) return { error: 'Give part of a VIN' }; const rows = p._units.filter(u => u.vin.includes(q)); const boxes = p._containers.filter(c => c.vins.some(v => v.includes(q))); return { q, units: rows.slice(0, 10), containers: boxes.slice(0, 5) }; },
  containers: (p, a) => ({ status: a.status || 'any', rows: p._containers.filter(c => !a.status || c.status === a.status).slice(0, limitOf(a, 15)) }),
  container_detail: (p, a) => { const q = str(a.container_no || a.q, 20).toUpperCase(); const c = p._containers.find(x => x.container_no.toUpperCase() === q || x.container_no.toUpperCase().includes(q)); return c ? { container: c } : { error: 'No container matches' }; },
};

// ── Submissions ─────────────────────────────────────────────────────────────
function buildSubmissionsPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const rows = arr((data || {}).submissions).map(s => ({ id: s.id, name: str(s.name, 80), phone: str(s.phone, 30), email: str(s.email, 80), car: str(s.car_interest, 60), source: str(s.source, 30), message: str(s.message, 200), linked: !!s.customer_id, lead_name: str(s.lead_name, 80), created_at: dayOf(s.created_at) }));
  return { today: t, total: rows.length, last_7d: rows.filter(r => r.created_at >= addDays(t, -7)).length, unlinked: rows.filter(r => !r.linked).length, by_source: countBy(rows, 'source', 'source'), by_car: countBy(rows, 'car', 'car').slice(0, 8), recent: rows.slice(0, 15), _rows: rows };
}
const SUBMISSIONS_QUERIES = {
  recent_submissions: (p, a) => ({ rows: p._rows.slice(0, limitOf(a, 15)) }),
  unlinked_submissions: (p, a) => ({ rows: p._rows.filter(r => !r.linked).slice(0, limitOf(a, 15)) }),
  submissions_by_source: (p) => ({ rows: p.by_source }),
};

// ── Tasks, hours, requests, meetings, issues ────────────────────────────────
function taskRow(x, employees, t) {
  const ids = Array.isArray(x.assignee_ids) && x.assignee_ids.length ? x.assignee_ids.map(String) : (x.assignee_id ? [String(x.assignee_id)] : []);
  const due = dayOf(x.due_date);
  return { id: x.id, title: str(x.title, 120), status: str(x.status, 20) || 'todo', priority: str(x.priority, 10) || 'medium', due_date: due || null, milestone: str(x.milestone, 60),
    assignees: ids.map(id => nameOf(employees, id)), assignee_ids: ids, days_overdue: (due && x.status !== 'done' && due < t) ? daysBetween(due, t) : 0, created_at: dayOf(x.created_at) };
}
function buildTasksPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const d = data || {};
  const rows = arr(d.tasks).map(x => taskRow(x, d.employees, t));
  const open = rows.filter(r => r.status !== 'done');
  const week = addDays(t, 7);
  const byAssignee = {}; for (const r of open) for (const n of (r.assignees.length ? r.assignees : ['Unassigned'])) { byAssignee[n] = byAssignee[n] || { assignee: n, open: 0, overdue: 0 }; byAssignee[n].open++; if (r.days_overdue > 0) byAssignee[n].overdue++; }
  return { today: t, total: rows.length, by_status: countBy(rows, 'status', 'status'), by_priority: countBy(open, 'priority', 'priority'),
    overdue: { count: open.filter(r => r.days_overdue > 0).length, rows: open.filter(r => r.days_overdue > 0).sort((a, b) => b.days_overdue - a.days_overdue).slice(0, 15) },
    due_today: open.filter(r => r.due_date === t).slice(0, 15), due_week: open.filter(r => r.due_date > t && r.due_date <= week).slice(0, 15),
    completed_7d: rows.filter(r => r.status === 'done' && (dayOf(d.completedAtOf && d.completedAtOf(r.id)) || '') >= addDays(t, -7)).length,
    by_assignee: Object.values(byAssignee).sort((a, b) => b.open - a.open), _rows: rows };
}
const TASKS_QUERIES = {
  tasks: (p, a) => { let rows = p._rows; if (a.status) rows = rows.filter(r => r.status === a.status); if (a.priority) rows = rows.filter(r => r.priority === a.priority); if (a.overdue) rows = rows.filter(r => r.days_overdue > 0); if (a.due === 'today') rows = rows.filter(r => r.due_date === p.today); if (a.due === 'week') rows = rows.filter(r => r.due_date >= p.today && r.due_date <= addDays(p.today, 7)); if (a.assignee) rows = rows.filter(r => r.assignees.some(n => has(n, a.assignee))); return { count: rows.length, rows: rows.slice(0, limitOf(a, 15)) }; },
  find_task: (p, a) => { const q = str(a.q, 60); if (!q) return { error: 'Give part of a title' }; const rows = p._rows.filter(r => has(r.title, q) || has(r.milestone, q)); return { q, count: rows.length, rows: rows.slice(0, limitOf(a, 10)) }; },
};
function buildHoursPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const d = data || {};
  const rows = arr(d.hours).map(h => ({ id: h.id, day: dayOf(h.log_date) || dayOf(h.logged_at), hours: num(h.hours), employee_id: h.employee_id || null, employee: nameOf(d.employees, h.employee_id), task: str(h.task_description || (h.tasks && h.tasks.title) || h.description, 100) }));
  const since7 = addDays(t, -7), since30 = addDays(t, -30);
  const byDay = {}; for (const r of rows) if (r.day >= addDays(t, -14)) byDay[r.day] = round2((byDay[r.day] || 0) + r.hours);
  const byEmp = {}; for (const r of rows) if (r.day >= since7) { byEmp[r.employee] = byEmp[r.employee] || { employee: r.employee, hours_7d: 0 }; byEmp[r.employee].hours_7d = round2(byEmp[r.employee].hours_7d + r.hours); }
  return { today: t, total_7d: round2(rows.filter(r => r.day >= since7).reduce((s, r) => s + r.hours, 0)), total_30d: round2(rows.filter(r => r.day >= since30).reduce((s, r) => s + r.hours, 0)),
    by_day: Object.entries(byDay).sort().map(([day, hours]) => ({ day, hours })), by_employee: Object.values(byEmp).sort((a, b) => b.hours_7d - a.hours_7d), recent: rows.slice(0, 15), _rows: rows };
}
const HOURS_QUERIES = {
  hours: (p, a) => { const from = dayOf(a.from) || addDays(p.today, -7), to = dayOf(a.to) || p.today; const rows = p._rows.filter(r => r.day >= from && r.day <= to && (!a.employee || has(r.employee, a.employee))); return { from, to, total: round2(rows.reduce((s, r) => s + r.hours, 0)), count: rows.length, rows: rows.slice(0, limitOf(a, 20)) }; },
  hours_by_employee: (p) => ({ rows: p.by_employee }),
};
function buildRequestsPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const rows = arr((data || {}).requests).map(r => ({ id: r.id, title: str(r.title, 120), category: str(r.category, 40), status: str(r.status, 20) || 'pending', priority: str(r.priority, 10), created_by: str(r.created_by, 40), assignee_id: r.assignee_id || null, created_at: dayOf(r.created_at), age_days: dayOf(r.created_at) ? Math.max(0, daysBetween(r.created_at, t) ?? 0) : null }));
  const pending = rows.filter(r => r.status === 'pending' || r.status === 'in_review');
  return { today: t, total: rows.length, by_status: countBy(rows, 'status', 'status'), by_category: countBy(rows, 'category', 'category'), pending: { count: pending.length, oldest: pending.sort((a, b) => (b.age_days || 0) - (a.age_days || 0)).slice(0, 10) }, recent: rows.slice(0, 15), _rows: rows };
}
const REQUESTS_QUERIES = {
  requests: (p, a) => ({ rows: p._rows.filter(r => (!a.status || r.status === a.status) && (!a.category || has(r.category, a.category))).slice(0, limitOf(a, 15)) }),
  find_request: (p, a) => { const q = str(a.q, 60); if (!q) return { error: 'Give part of a title' }; const rows = p._rows.filter(r => has(r.title, q)); return { q, count: rows.length, rows: rows.slice(0, limitOf(a, 10)) }; },
};
function buildMeetPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const d = data || {};
  const rows = arr(d.meetings).map(m => ({ id: m.id, title: str(m.title, 120), starts_at: m.starts_at, day: dayOf(m.starts_at), duration_min: num(m.duration_min), attendees: arr(m.attendee_ids).map(id => nameOf(d.employees, id)), link: str(m.meet_link, 200), created_by: str(m.created_by, 40) }));
  return { today: t, today_rows: rows.filter(r => r.day === t), next_7d: rows.filter(r => r.day > t && r.day <= addDays(t, 7)), this_week_count: rows.filter(r => r.day >= t && r.day <= addDays(t, 7)).length, upcoming: rows.filter(r => r.day >= t).slice(0, 15), _rows: rows };
}
const MEET_QUERIES = { meetings: (p, a) => { const when = a.when || 'week'; const rows = p._rows.filter(r => when === 'today' ? r.day === p.today : when === 'week' ? (r.day >= p.today && r.day <= addDays(p.today, 7)) : r.day >= p.today); return { when, count: rows.length, rows: rows.slice(0, limitOf(a, 15)) }; } };
function buildIssuesPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const rows = arr((data || {}).issues).map(i => ({ id: i.id, title: str(i.title, 120), status: str(i.status, 20) || 'open', reporter: str(i.reporter_name, 60), created_at: dayOf(i.created_at), age_days: dayOf(i.created_at) ? Math.max(0, daysBetween(i.created_at, t) ?? 0) : null, resolved_at: dayOf(i.resolved_at) || null }));
  const open = rows.filter(r => r.status === 'open');
  return { today: t, total: rows.length, open: open.length, resolved_7d: rows.filter(r => r.resolved_at && r.resolved_at >= addDays(t, -7)).length, oldest_open: open.sort((a, b) => (b.age_days || 0) - (a.age_days || 0)).slice(0, 10), by_reporter: countBy(open, 'reporter', 'reporter').slice(0, 8), recent: rows.slice(0, 15), _rows: rows };
}
const ISSUES_QUERIES = { issues: (p, a) => ({ rows: p._rows.filter(r => !a.status || r.status === a.status).slice(0, limitOf(a, 15)) }) };

// ── Admin only: employees, automations ──────────────────────────────────────
function buildEmployeesPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const d = data || {};
  const tasks = arr(d.tasks).map(x => taskRow(x, d.employees, t)), hours = arr(d.hours), leads = arr(d.customers);
  const rows = arr(d.employees).map(e => { const id = String(e.id); const mine = tasks.filter(x => x.assignee_ids.includes(id) && x.status !== 'done'); const myLeads = leads.filter(c => String(c.assigned_to) === id);
    return { id: e.id, name: str(e.name, 80), job_title: str(e.job_title, 60), username: str(e.username, 40), open_tasks: mine.length, overdue_tasks: mine.filter(x => x.days_overdue > 0).length,
      hours_7d: round2(hours.filter(h => String(h.employee_id) === id && (dayOf(h.log_date) || dayOf(h.logged_at)) >= addDays(t, -7)).reduce((s, h) => s + num(h.hours), 0)), leads: myLeads.length, hot_leads: myLeads.filter(c => c.lead_status === 'hot').length }; });
  return { today: t, total: rows.length, rows: rows.sort((a, b) => b.open_tasks - a.open_tasks), definitions: ['hours_7d = hours logged in the last 7 days', 'leads = customers assigned to the employee'], _rows: rows };
}
const EMPLOYEES_QUERIES = { employee_detail: (p, a) => { const q = str(a.name, 60); const r = p._rows.find(x => has(x.name, q) || has(x.username, q)); return r ? { employee: r } : { error: 'No employee matches' }; }, team_load: (p) => ({ rows: p.rows }) };
function buildAutomationsPack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const d = data || {};
  const runs = arr(d.runs);
  const rows = arr(d.rules).map(r => ({ id: r.id, name: str(r.name, 100), active: r.active === true || r.enabled === true, trigger: str(r.trigger || r.trigger_event || (r.config && r.config.trigger), 60), actions: arr(r.actions || (r.config && r.config.actions)).length,
    runs_7d: runs.filter(x => String(x.rule_id) === String(r.id) && dayOf(x.created_at || x.ran_at) >= addDays(t, -7)).length, last_run_at: runs.filter(x => String(x.rule_id) === String(r.id)).map(x => x.created_at || x.ran_at).sort().slice(-1)[0] || null }));
  return { today: t, total: rows.length, active: rows.filter(r => r.active).length, runs_7d: runs.filter(x => dayOf(x.created_at || x.ran_at) >= addDays(t, -7)).length, rows, _rows: rows };
}
const AUTOMATIONS_QUERIES = { rules: (p, a) => ({ rows: p._rows.filter(r => a.active === undefined || a.active === null || a.active === '' || r.active === (a.active === true || a.active === 'true')).slice(0, limitOf(a, 20)) }) };

// ── Home: a light cross-section overview ────────────────────────────────────
function buildHomePack(data, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  const d = data || {};
  const tasks = arr(d.tasks).map(x => taskRow(x, d.employees, t)).filter(x => x.status !== 'done');
  const fus = arr(d.followups).filter(f => (f.status || 'pending') === 'pending').map(f => ({ id: f.id, customer_id: f.customer_id, due_day: dayOf(f.due_at), note: str(f.note, 120) }));
  const deals = arr(d.deals).filter(x => OPEN_STAGES.includes(x.stage));
  const leads = arr(d.customers);
  const meetings = arr(d.meetings).filter(m => dayOf(m.starts_at) === t).map(m => ({ title: str(m.title, 100), starts_at: m.starts_at }));
  return { today: t,
    tasks: { open: tasks.length, overdue: tasks.filter(x => x.days_overdue > 0).length, due_today: tasks.filter(x => x.due_date === t).length, rows: tasks.filter(x => x.days_overdue > 0 || x.due_date === t).slice(0, 10) },
    followups: { overdue: fus.filter(f => f.due_day && f.due_day < t).length, today: fus.filter(f => f.due_day === t).length, rows: fus.filter(f => f.due_day && f.due_day <= t).slice(0, 10) },
    deals: { open: deals.length, value: round2(deals.reduce((s, x) => s + num(x.budget_egp), 0)) },
    leads: { total: leads.length, new_7d: leads.filter(c => dayOf(c.created_at) >= addDays(t, -7)).length, hot: leads.filter(c => c.lead_status === 'hot').length },
    requests_pending: arr(d.requests).filter(r => r.status === 'pending' || r.status === 'in_review').length,
    meetings_today: meetings,
  };
}
const HOME_QUERIES = { overview: (p) => { const { _rows, ...rest } = p; return rest; } };

// ── Size guard ──────────────────────────────────────────────────────────────
// The model has a fixed window (24k tokens on the default Workers AI model),
// and a pack, a 360 view or a tool result can each outgrow it on a busy book.
// This shrinks a value to fit: the largest array loses its tail, again and
// again, then long strings are cut; a marker says how much was left out, so
// the model can ask for a narrower query instead of guessing.
const jsonSize = v => { try { return JSON.stringify(v).length; } catch (_) { return 0; } };
function capJson(value, maxChars) {
  let v; try { v = JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch (_) { return null; }
  const max = Math.max(200, Math.floor(Number(maxChars)) || 20000);
  const isMarker = x => (x && typeof x === 'object' && x._more != null) || (typeof x === 'string' && x.startsWith('…+'));
  for (let guard = 0; guard < 120 && jsonSize(v) > max; guard++) {
    // The biggest single thing in the value: an array with more than one real
    // row, or a long string. Whichever is larger loses half (or its tail).
    let bigArr = null, bigStr = null;
    (function walk(node, parent, key) {
      if (Array.isArray(node)) {
        const real = node.filter(x => !isMarker(x));
        if (real.length > 1) { const size = jsonSize(node); if (!bigArr || size > bigArr.size) bigArr = { parent, key, node, real, size }; }
        node.forEach((x, i) => walk(x, node, i));
      } else if (typeof node === 'string') {
        if (node.length > 120 && !node.startsWith('…+') && (!bigStr || node.length > bigStr.size)) bigStr = { parent, key, size: node.length };
      } else if (node && typeof node === 'object') for (const k of Object.keys(node)) walk(node[k], node, k);
    })(v, null, null);
    if (bigArr && bigArr.parent && (!bigStr || bigArr.size >= bigStr.size)) {
      const prior = bigArr.node.find(isMarker);
      const already = prior ? (typeof prior === 'string' ? Number(prior.slice(2)) || 0 : Number(prior._more) || 0) : 0;
      const keep = Math.max(1, Math.floor(bigArr.real.length / 2));
      const cut = bigArr.real.slice(0, keep);
      const dropped = bigArr.real.length - keep + already;
      cut.push(cut.some(x => x && typeof x === 'object') ? { _more: dropped } : `…+${dropped}`);
      bigArr.parent[bigArr.key] = cut;
      continue;
    }
    if (bigStr && bigStr.parent) { bigStr.parent[bigStr.key] = bigStr.parent[bigStr.key].slice(0, 100) + '…'; continue; }
    return JSON.stringify(v).slice(0, max - 1) + '…';
  }
  return v;
}

// ── 360 views: one record followed across every section ─────────────────────
// The routes load the rows (each slice under its own permission, so a slice the
// person may not see simply arrives empty) and these shape them. Every list is
// capped here as well as by capJson, because a lead with three years of
// activity should still leave room for the answer.
const evAt = v => String(v || '').slice(0, 16).replace('T', ' ');
function activityRows(activities, limit) {
  return arr(activities).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit || 25)
    .map(a => ({ type: str(a.type, 20), body: str(a.body, 200), by: str(a.author_name, 40), at: evAt(a.created_at), ...(a.meta && (a.meta.from || a.meta.to) ? { from: str(a.meta.from, 30), to: str(a.meta.to, 30) } : {}) }));
}
function saleRows(sales, payments, opts) {
  const t = dayOf(opts && opts.today) || todayStr();
  return arr(sales).map(s => {
    const mine = arr(payments).filter(p => String(p.sale_id) === String(s.id));
    const price = num(s.discounted) > 0 ? num(s.discounted) : num(s.price_list);
    const received = round2(mine.filter(p => p.direction === 'in' && p.kind !== 'refund').reduce((x, p) => x + num(p.amount_base), 0));
    const refunded = round2(mine.filter(p => p.direction === 'out' && p.kind === 'refund').reduce((x, p) => x + num(p.amount_base), 0));
    const legacy = !mine.length;
    const outstanding = legacy ? (num(s.remaining) > 0 ? num(s.remaining) : Math.max(0, price - num(s.down_payment))) : Math.max(0, round2(price - received + refunded));
    const due = dayOf(s.remaining_due) || null;
    return { id: s.id, deal_id: s.deal_id || null, client: str(s.client, 80), vehicle: [s.brand, s.model, s.trim].filter(Boolean).join(' '), vin: str(s.vin, 20), status: str(s.status, 30), price,
      received: legacy ? num(s.down_payment) : received, refunded, outstanding: round2(outstanding), due, days_overdue: (due && outstanding > 0 && due < t) ? daysBetween(due, t) : 0, delivery: dayOf(s.delivery_date) || null, payments: mine.length };
  });
}
function paymentRows(payments, limit) {
  return arr(payments).slice().sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on))).slice(0, limit || 15)
    .map(p => ({ id: p.id, sale_id: p.sale_id || null, direction: str(p.direction, 4), kind: str(p.kind, 20), amount: num(p.amount), currency: str(p.currency, 8) || 'EGP', amount_egp: num(p.amount_base), paid_on: dayOf(p.paid_on), method: str(p.method, 20), reference: str(p.reference, 40) }));
}
function quoteRows(quotations, limit) {
  return arr(quotations).slice(0, limit || 8).map(q => { const d = q.data && typeof q.data === 'object' ? q.data : {}; return { id: q.id, quote_id: str(q.quote_id, 40), title: str(q.title, 100), vehicle: str(d.vehicleModel, 80), usd_total_indicative: quoteTotal(d), exchange: num(d.exchange), valid_to: str(d.validTo, 20), created_at: dayOf(q.created_at), created_by: str(q.created_by, 40) }; });
}
function dealRows(deals, employees, t) {
  return arr(deals).map(x => ({ id: x.id, title: str(x.title, 100), stage: str(x.stage, 20) || 'lead', value: num(x.budget_egp), car: str(x.car_model, 60), rep: nameOf(employees, x.assigned_to), assigned_to: x.assigned_to || null,
    notes: str(x.notes, 300), created_at: dayOf(x.created_at), closed_at: dayOf(x.closed_at) || null, days_open: dayOf(x.created_at) ? Math.max(0, daysBetween(x.created_at, t) ?? 0) : null }));
}
function buildLead360(data, opts) {
  const d = data || {}, t = dayOf(opts && opts.today) || todayStr();
  const c = d.customer || {};
  const activities = arr(d.activities), employees = arr(d.employees);
  const last = activities.map(a => dayOf(a.created_at)).filter(Boolean).sort().slice(-1)[0] || '';
  const lead = { ...leadRow(c, last, t), email: str(c.email, 80), budget_max: num(c.budget_max), notes: str(c.notes, 300), sales_feedback: str(c.sales_feedback, 200), inquiry: str(c.inquiry, 200), assigned_name: nameOf(employees, c.assigned_to), created_by: str(c.created_by, 40) };
  const deals = dealRows(d.deals, employees, t);
  const sales = saleRows(d.sales, d.payments, { today: t });
  const payments = paymentRows(d.payments, 15);
  const followups = arr(d.followups).map(f => ({ id: f.id, due_day: dayOf(f.due_at), note: str(f.note, 200), status: f.status || 'pending', assigned_to: f.assigned_to || null, completed_at: dayOf(f.completed_at) || null }));
  const quotations = quoteRows(d.quotations, 8);
  const contracts = arr(d.contracts).slice(0, 5).map(x => ({ id: x.id, contract_no: str(x.contract_no, 40), title: str(x.title, 100), status: str(x.status, 20), deal_id: x.deal_id || null, created_at: dayOf(x.created_at) }));
  const purchase_orders = arr(d.purchase_orders).slice(0, 5).map(po => poRow(po, t));
  const rfqs = arr(d.rfqs).slice(0, 5).map(r => ({ id: r.id, rfq_no: str(r.rfq_no, 40), title: str(r.title, 100), supplier: str(r.supplier_name, 80), status: str(r.status, 20), rfq_date: dayOf(r.rfq_date) || dayOf(r.created_at) }));
  const submissions = arr(d.submissions).slice(0, 5).map(s => ({ id: s.id, car: str(s.car_interest, 60), source: str(s.source, 30), message: str(s.message, 160), created_at: dayOf(s.created_at) }));
  const tasks = arr(d.tasks).slice(0, 5).map(x => taskRow(x, employees, t));
  const open = deals.filter(x => OPEN_STAGES.includes(x.stage));
  const timeline = [
    ...activities.map(a => ({ at: evAt(a.created_at), kind: str(a.type, 20), text: str(a.body, 120) })),
    ...followups.map(f => ({ at: f.due_day, kind: 'follow_up_' + f.status, text: f.note || 'Follow-up' })),
    ...quotations.map(q => ({ at: q.created_at, kind: 'quotation', text: `${q.quote_id || q.title} ${q.vehicle}`.trim() })),
    ...deals.flatMap(x => [{ at: x.created_at, kind: 'deal_opened', text: x.title }, ...(x.closed_at ? [{ at: x.closed_at, kind: 'deal_' + x.stage, text: x.title }] : [])]),
    ...payments.map(p => ({ at: p.paid_on, kind: 'payment_' + p.direction, text: `${p.kind} ${p.currency} ${p.amount.toLocaleString('en-US')}` })),
    ...contracts.map(x => ({ at: x.created_at, kind: 'contract_' + x.status, text: x.contract_no || x.title })),
  ].filter(e => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20);
  return { kind: 'lead', today: t, lead, totals: {
      deals: deals.length, deals_open: open.length, deals_open_value: round2(open.reduce((s, x) => s + x.value, 0)), won: deals.filter(x => x.stage === 'won').length,
      quotations: quotations.length, contracts: contracts.length, paid_in_egp: round2(payments.filter(p => p.direction === 'in').reduce((s, p) => s + p.amount_egp, 0)),
      outstanding_egp: round2(sales.reduce((s, x) => s + x.outstanding, 0)), pending_followups: followups.filter(f => f.status === 'pending').length, last_activity_at: last || null, days_silent: lead.days_silent },
    activities: activityRows(activities, 25), followups: followups.slice(0, 15), deals: deals.slice(0, 10), quotations, contracts, sales: sales.slice(0, 5), payments, purchase_orders, rfqs, submissions, tasks, timeline,
    definitions: ['outstanding = agreed price − payments in + refunds, per sale; legacy sales without payment rows use their own remaining column', 'days_silent counts days since the last logged activity'] };
}
function buildDeal360(data, opts) {
  const d = data || {}, t = dayOf(opts && opts.today) || todayStr();
  const employees = arr(d.employees);
  const deal = dealRows([d.deal || {}], employees, t)[0];
  const c = d.customer || (d.deal && d.deal.customers) || {};
  const activities = arr(d.activities);
  const last = activities.map(a => dayOf(a.created_at)).filter(Boolean).sort().slice(-1)[0] || '';
  const sales = saleRows(d.sales, d.payments, { today: t });
  const contract = arr(d.contracts).find(x => String(x.deal_id) === String(deal.id)) || arr(d.contracts)[0] || null;
  return { kind: 'deal', today: t, deal, customer: c.id ? { ...leadRow(c, last, t), email: str(c.email, 80), assigned_name: nameOf(employees, c.assigned_to) } : null,
    stage_history: activityRows(activities.filter(a => a.type === 'deal' || a.type === 'status_change'), 10),
    activities: activityRows(activities, 15),
    followups: arr(d.followups).map(f => ({ id: f.id, due_day: dayOf(f.due_at), note: str(f.note, 200), status: f.status || 'pending' })).slice(0, 10),
    quotations: quoteRows(d.quotations, 5),
    contract: contract ? { id: contract.id, contract_no: str(contract.contract_no, 40), status: str(contract.status, 20), created_at: dayOf(contract.created_at) } : null,
    sales: sales.slice(0, 3), payments: paymentRows(d.payments, 15),
    other_deals: dealRows(arr(d.other_deals).filter(x => String(x.id) !== String(deal.id)), employees, t).slice(0, 5),
    totals: { paid_in_egp: round2(paymentRows(d.payments, 500).filter(p => p.direction === 'in').reduce((s, p) => s + p.amount_egp, 0)), outstanding_egp: round2(sales.reduce((s, x) => s + x.outstanding, 0)), days_open: deal.days_open, last_activity_at: last || null },
    stages: DEAL_STAGES };
}
function buildSupplier360(data, opts) {
  const d = data || {}, t = dayOf(opts && opts.today) || todayStr();
  const s = d.supplier || {};
  const pos = arr(d.purchase_orders).map(po => poRow(po, t));
  const byCcy = {}; for (const p of pos) byCcy[p.currency] = round2((byCcy[p.currency] || 0) + p.pi_total);
  const offers = arr(d.supplier_vehicles).map(v => ({ brand: str(v.brand, 40), model: str(v.model, 60), trim: str(v.trim, 60), year: v.model_year || null, fob_price: num(v.fob_price), currency: str(v.currency, 8) || 'USD', lead_time: str(v.lead_time, 40), availability: str(v.availability, 40) }));
  const units = arr(d.stock_units).slice(0, 15).map(u => ({ model: str(u.model, 80), vin: str(u.vin, 20), colour: str(u.colour, 30), status: str(u.status, 30), consignee: str(u.consignee, 80), logistics: str(u.logistics, 80) }));
  const containers = arr(d.containers).slice(0, 8).map(c => ({ container_no: str(c.container_no, 20), status: str(c.status, 20), vessel: str(c.vessel_name, 60), pod: str(c.pod_name, 60), pod_eta: dayOf(c.pod_eta) || dayOf(c.eta) || null, latest_move: str(c.latest_move, 120) }));
  return { kind: 'supplier', today: t,
    supplier: { id: s.id, name: str(s.name, 80), country: str(s.country, 40), contact: str(s.contact, 80), address: str(s.address, 120), notes: str(s.notes, 300), docs: num(d.docs_count) },
    totals: { orders: pos.length, open_orders: pos.filter(p => p.status !== 'closed').length, units: pos.reduce((x, p) => x + p.units, 0), pi_total_by_currency: byCcy, catalogue_offers: offers.length, rfqs: arr(d.rfqs).length, stock_units: arr(d.stock_units).length },
    purchase_orders: pos.slice(0, 10), rfqs: arr(d.rfqs).slice(0, 8).map(r => ({ id: r.id, rfq_no: str(r.rfq_no, 40), title: str(r.title, 100), status: str(r.status, 20), rfq_date: dayOf(r.rfq_date) || dayOf(r.created_at), lines: arr(r.items).length })),
    catalogue: offers.sort((a, b) => (a.fob_price || 1e12) - (b.fob_price || 1e12)).slice(0, 20), stock_units: units, containers,
    definitions: ['pi_total_by_currency sums the PI totals of this supplier\'s purchase orders', 'fob_price is what the supplier quoted, not what was paid'] };
}
function buildVehicle360(data, opts) {
  const d = data || {}, t = dayOf(opts && opts.today) || todayStr();
  const stock = d.stock ? { model: [d.stock.row && d.stock.row.make, d.stock.row && d.stock.row.model, d.stock.row && d.stock.row.trim].filter(Boolean).join(' '), stock_id: d.stock.row && d.stock.row.id,
    colour: str(d.stock.unit && d.stock.unit.colour, 30), status: str(d.stock.unit && d.stock.unit.status, 30), consignee: str(d.stock.unit && d.stock.unit.consignee, 80), supplier: str(d.stock.unit && d.stock.unit.supplier, 80),
    logistics: str(d.stock.unit && d.stock.unit.logistics, 80), price_list: num(d.stock.unit && d.stock.unit.price_list) || num(d.stock.row && d.stock.row.price) } : null;
  const c = d.container || null;
  const sale = arr(d.sales)[0] || null;
  const sales = saleRows(sale ? [sale] : [], d.payments, { today: t });
  const po = d.purchase_order || null;
  const line = po ? arr(po.items).find(it => normVinLite(it.vin) === normVinLite(d.vin)) : null;
  return { kind: 'vehicle', today: t, vin: str(d.vin, 20).toUpperCase(),
    stock, container: c ? { container_no: str(c.container_no, 20), status: str(c.status, 20), carrier: str(c.carrier, 40), vessel: str(c.vessel_name, 60), pol: str(c.pol_name, 60), pod: str(c.pod_name, 60), latest_move: str(c.latest_move, 120), pod_eta: dayOf(c.pod_eta) || dayOf(c.eta) || null, days_to_eta: (dayOf(c.pod_eta) || dayOf(c.eta)) ? daysBetween(t, dayOf(c.pod_eta) || dayOf(c.eta)) : null } : null,
    purchase_order: po ? { id: po.id, po_number: str(po.po_number, 40), supplier: str(po.supplier, 80), status: str(po.status, 20), po_date: dayOf(po.po_date) || dayOf(po.created_at), line: line ? { client: str(line.client, 60), consignee: str(line.consignee, 60), model: [line.brand, line.model, line.trim].filter(Boolean).join(' '), color: str(line.color, 30), units: num(line.units) || 1, pi_price: num(line.pi_price), status: str(line.status, 30) || 'send_to_supplier' } : null } : null,
    sale: sales[0] || null, payments: paymentRows(d.payments, 10),
    customer: d.customer && d.customer.id ? { id: d.customer.id, name: str(d.customer.name, 80), phone: str(d.customer.phone, 30), status: str(d.customer.lead_status, 30) } : null,
    deal: d.deal ? dealRows([d.deal], d.employees, t)[0] : null };
}
const normVinLite = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ── Search across everything the person may see ─────────────────────────────
// The route runs one query per table (each behind its own permission) and
// hands the raw rows here; this shapes them into short labelled hits and tells
// the model which lookup gives the full picture.
function buildSearch(data, q, opts) {
  const d = data || {}, t = dayOf(opts && opts.today) || todayStr();
  const lim = 5;
  const group = (rows, map) => { const list = arr(rows); return { total: list.length, rows: list.slice(0, lim).map(map) }; };
  const out = { q: str(q, 80), today: t, groups: {} };
  const g = out.groups;
  if (d.customers) g.leads = group(d.customers, c => ({ customer_id: c.id, name: str(c.name, 80), phone: str(c.phone, 30), status: str(c.lead_status, 30), car: str(c.car_in_question, 60), assigned_to: c.assigned_to || null }));
  if (d.deals) g.deals = group(d.deals, x => ({ deal_id: x.id, title: str(x.title, 100), stage: str(x.stage, 20), value: num(x.budget_egp), customer_id: x.customer_id || null }));
  if (d.quotations) g.quotations = group(d.quotations, x => ({ id: x.id, quote_id: str(x.quote_id, 40), title: str(x.title, 100), customer_id: x.customer_id || null, created_at: dayOf(x.created_at) }));
  if (d.contracts) g.contracts = group(d.contracts, x => ({ id: x.id, contract_no: str(x.contract_no, 40), title: str(x.title, 100), status: str(x.status, 20), customer_id: x.customer_id || null }));
  if (d.rfqs) g.rfqs = group(d.rfqs, x => ({ id: x.id, rfq_no: str(x.rfq_no, 40), title: str(x.title, 100), supplier: str(x.supplier_name, 80), status: str(x.status, 20) }));
  if (d.purchase_orders) g.purchase_orders = group(d.purchase_orders, x => ({ id: x.id, po_number: str(x.po_number, 40), title: str(x.title, 100), supplier: str(x.supplier, 80), status: str(x.status, 20) }));
  if (d.suppliers) g.suppliers = group(d.suppliers, x => ({ supplier_id: x.id, name: str(x.name, 80), country: str(x.country, 40) }));
  if (d.stock_units) g.stock = group(d.stock_units, u => ({ model: str(u.model, 80), vin: str(u.vin, 20), colour: str(u.colour, 30), status: str(u.status, 30), consignee: str(u.consignee, 80) }));
  if (d.containers) g.containers = group(d.containers, c => ({ container_no: str(c.container_no, 20), status: str(c.status, 20), pod_eta: dayOf(c.pod_eta) || dayOf(c.eta) || null }));
  if (d.tasks) g.tasks = group(d.tasks, x => ({ task_id: x.id, title: str(x.title, 100), status: str(x.status, 20), due_date: dayOf(x.due_date) || null }));
  if (d.requests) g.requests = group(d.requests, x => ({ request_id: x.id, title: str(x.title, 100), status: str(x.status, 20), category: str(x.category, 40) }));
  if (d.issues) g.issues = group(d.issues, x => ({ issue_id: x.id, title: str(x.title, 100), status: str(x.status, 20) }));
  if (d.meetings) g.meetings = group(d.meetings, x => ({ meeting_id: x.id, title: str(x.title, 100), starts_at: evAt(x.starts_at) }));
  if (d.employees) g.employees = group(d.employees, e => ({ employee_id: e.id, name: str(e.name, 80), job_title: str(e.job_title, 60) }));
  if (d.submissions) g.submissions = group(d.submissions, s => ({ submission_id: s.id, name: str(s.name, 80), phone: str(s.phone, 30), car: str(s.car_interest, 60), customer_id: s.customer_id || null }));
  out.total = Object.values(g).reduce((s, x) => s + x.total, 0);
  out.hint = 'For the full picture of a hit use lookup: kind lead + customer_id, kind deal + deal_id, kind supplier + supplier_id, kind vehicle + vin.';
  return out;
}

// ── The registry ────────────────────────────────────────────────────────────
// gate: the read permission the section's own page needs (null = everyone).
// admin: true means the section exists only in the admin dashboard.
const SECTIONS = {
  home: { label: 'Home', gate: null, build: buildHomePack, queries: HOME_QUERIES, actions: ['create_task', 'create_followup', 'notify', 'update_task', 'complete_followup', 'create_request'],
    chips: { en: ['What needs my attention today?', 'Which follow-ups are overdue?', 'Plan my day'], ar: ['ما الذي يحتاج انتباهي اليوم؟', 'ما المتابعات المتأخرة؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each, about what needs attention today: overdue tasks and follow-ups, meetings, new and hot leads, open pipeline, pending requests.' },
  leads: { label: 'Leads', gate: { section: 'leads', action: 'view' }, build: buildLeadsPack, queries: LEADS_QUERIES, actions: ['create_followup', 'set_lead_status', 'log_activity', 'assign_lead', 'create_deal', 'create_task', 'edit_lead', 'complete_followup', 'set_deal_stage', 'add_deal_note', 'record_payment'],
    chips: { en: ['Which hot leads have gone quiet?', 'Who should I call first today?', 'Draft a WhatsApp follow-up for a stale lead', 'Which sources bring the most hot leads?'], ar: ['أي العملاء الساخنين لم يتم التواصل معهم؟', 'بمن أتصل أولاً اليوم؟', 'اكتب رسالة متابعة واتساب'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…],"call_list":[{"customer_id":0,"name":"","why":""}]} — up to 4 short sentences each, quoting figures from the pack (counts by status and source, new leads, follow-ups overdue/today, stale hot and warm leads, unassigned). call_list: up to 6 leads to contact first, most urgent first (overdue follow-ups, then stale hot leads), each "why" one sentence.' },
  deals: { label: 'Deals', gate: { section: 'deals', action: 'view' }, build: buildDealsPack, queries: DEALS_QUERIES, actions: ['create_followup', 'create_task', 'log_activity', 'notify', 'set_deal_stage', 'edit_deal', 'add_deal_note', 'record_payment', 'set_lead_status', 'edit_lead'],
    chips: { en: ['Which deals are stuck?', 'What is the weighted pipeline?', 'What did we win this month?', 'Which sales still owe money?'], ar: ['أي الصفقات متوقفة؟', 'ما قيمة خط الأنابيب المرجّح؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each, quoting figures from the pack (pipeline by stage, weighted value, win rate, this month, stuck deals, open sales balances).' },
  quotation: { label: 'Quotation', gate: { section: 'quotation', action: 'history' }, build: buildQuotationPack, queries: QUOTATION_QUERIES, actions: ['create_task', 'notify', 'create_followup', 'create_deal', 'set_deal_stage'],
    chips: { en: ['How many quotes went out this month?', 'Which vehicles are quoted most?', 'Find the latest quote for a customer'], ar: ['كم عرض سعر صدر هذا الشهر؟', 'أكثر السيارات المعروضة؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about quotation volume, the vehicles quoted most and anything worth following up.' },
  contracts: { label: 'Contracts', gate: { section: 'contracts', action: 'view' }, build: buildContractsPack, queries: CONTRACTS_QUERIES, actions: ['create_task', 'notify', 'create_followup', 'record_payment'],
    chips: { en: ['Which contracts are still unsigned?', 'How many contracts this month?'], ar: ['ما العقود غير الموقعة؟', 'كم عقداً هذا الشهر؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about contracts by status, old unsigned drafts and this month\'s volume.' },
  rfq: { label: 'RFQ', gate: { section: 'rfq', action: 'view' }, build: buildRfqPack, queries: RFQ_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['Which RFQs are waiting on a supplier?', 'Draft a chaser email to a supplier', 'Which supplier gets most RFQs?'], ar: ['أي طلبات عروض تنتظر رد المورد؟', 'اكتب رسالة متابعة لمورد'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about RFQs by status, the ones waiting longest on a supplier, and suppliers asked most.' },
  purchaseorders: { label: 'Purchase Orders', gate: { section: 'purchaseorders', action: 'view' }, build: buildPurchaseOrdersPack, queries: PO_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['Which POs are still open and how old are they?', 'How many cars are in preparation vs in logistics?', 'Total PI value of open orders'], ar: ['ما أوامر الشراء المفتوحة وكم عمرها؟', 'كم سيارة قيد التجهيز وكم في الشحن؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about POs by status, line statuses (cars in preparation, in logistics, delivered), open PI value by currency and the oldest open orders.' },
  suppliers: { label: 'Suppliers', gate: { section: 'suppliers', action: 'view' }, build: buildSuppliersPack, queries: SUPPLIERS_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['Who is our biggest supplier?', 'Cheapest catalogue offer for a model', 'Which suppliers have open orders?'], ar: ['من أكبر مورد لدينا؟', 'أرخص عرض في الكتالوج لموديل'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about suppliers by orders and PI value, catalogue coverage and price spread per model, and concentration risk.' },
  stock: { label: 'Inventory', gate: { section: 'stock', action: 'browse' }, build: buildStockPack, queries: STOCK_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['What is in stock and unassigned?', 'Which containers arrive this week?', 'Where is a VIN?'], ar: ['ما السيارات المتاحة غير المخصصة؟', 'أي الحاويات تصل هذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about units by model and status, unassigned cars, list value, and containers in transit or arriving within 7 days.' },
  submissions: { label: 'Submissions', gate: { section: 'submissions', action: 'view' }, build: buildSubmissionsPack, queries: SUBMISSIONS_QUERIES, actions: ['create_task', 'notify', 'link_submission', 'create_followup', 'set_lead_status'],
    chips: { en: ['Which website submissions are not linked to a lead?', 'What are people asking for this week?'], ar: ['أي طلبات الموقع غير مرتبطة بعميل؟', 'ماذا يطلب الناس هذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about submission volume, sources, cars asked for and submissions not yet linked to a lead.' },
  tasks: { label: 'Tasks', gate: { section: 'tasks', action: 'view' }, build: buildTasksPack, queries: TASKS_QUERIES, actions: ['create_task', 'notify', 'update_task', 'comment_task', 'log_hours'],
    chips: { en: ['What is overdue?', 'What is due this week?', 'Who is overloaded?'], ar: ['ما المهام المتأخرة؟', 'ما المستحق هذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about open tasks by status and priority, overdue, due today and this week, and load per assignee.' },
  hours: { label: 'Hours', gate: { section: 'hours', action: 'view' }, build: buildHoursPack, queries: HOURS_QUERIES, actions: ['notify', 'log_hours'],
    chips: { en: ['Hours logged this week', 'Which days had no hours logged?'], ar: ['الساعات المسجلة هذا الأسبوع', 'أي الأيام بلا ساعات؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about hours in the last 7 and 30 days, by day and by employee.' },
  requests: { label: 'Requests', gate: { section: 'requests', action: 'view' }, build: buildRequestsPack, queries: REQUESTS_QUERIES, actions: ['create_task', 'notify', 'create_request'],
    chips: { en: ['Which requests are waiting longest?', 'Requests by category'], ar: ['أي الطلبات تنتظر أطول؟', 'الطلبات حسب الفئة'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about requests by status and category and the oldest pending ones.' },
  meet: { label: 'Meetings', gate: { section: 'meet', action: 'view' }, build: buildMeetPack, queries: MEET_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['What meetings do I have today?', 'What is on this week?'], ar: ['ما اجتماعات اليوم؟', 'ما المخطط لهذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about today\'s and this week\'s meetings.' },
  issues: { label: 'Issues', gate: { section: 'issues', action: 'view' }, build: buildIssuesPack, queries: ISSUES_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['Which issues have been open longest?', 'What was resolved this week?'], ar: ['أي المشكلات مفتوحة منذ أطول وقت؟', 'ما الذي حُل هذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about open issues, their age, reporters and what was resolved this week.' },
  employees: { label: 'Employees', gate: null, admin: true, build: buildEmployeesPack, queries: EMPLOYEES_QUERIES, actions: ['create_task', 'notify', 'update_task', 'assign_lead'],
    chips: { en: ['Who has the most overdue tasks?', 'Who logged no hours this week?', 'Which rep holds the most hot leads?'], ar: ['من لديه أكثر المهام المتأخرة؟', 'من لم يسجّل ساعات هذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about team load: open and overdue tasks, hours logged this week, leads and hot leads per employee.' },
  automations: { label: 'Automations', gate: null, admin: true, build: buildAutomationsPack, queries: AUTOMATIONS_QUERIES, actions: ['notify'],
    chips: { en: ['Which rules ran this week?', 'Which rules never fire?'], ar: ['أي القواعد عملت هذا الأسبوع؟', 'أي القواعد لا تعمل أبداً؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about active rules, runs this week and rules that never fire.' },
};
// Pages that have no pack of their own read the Home overview; the accounting
// page keeps its own finance assistant.
const PAGE_TO_SECTION = { customers: 'leads', leads: 'leads', rfqs: 'rfq', rfq: 'rfq', calendar: 'meet', deletions: 'home', notif: 'home', chat: 'home', whatsapp: 'home', gchat: 'home', email: 'home', drive: 'home', sheets: 'home', reports: 'deals', availability: 'meet' };
function sectionForPage(page) {
  const p = String(page || '').toLowerCase();
  if (p === 'accounting') return 'accounting';
  if (SECTIONS[p]) return p;
  return PAGE_TO_SECTION[p] || 'home';
}

function buildPack(section, data, opts) {
  const s = SECTIONS[section];
  if (!s) return null;
  const pack = s.build(data, opts);
  pack.section = section; pack.label = s.label;
  return pack;
}
// The pack the model is handed: private row caches stripped.
function trimSectionPack(pack) {
  const out = {};
  for (const [k, v] of Object.entries(pack || {})) if (!k.startsWith('_')) out[k] = v;
  return JSON.parse(JSON.stringify(out));
}
function sectionQuery(section, pack, name, args) {
  const s = SECTIONS[section];
  if (!s) return { error: 'Unknown section' };
  const q = s.queries[name];
  if (!q) return { error: `Unknown query "${name}". Choose one of: ${Object.keys(s.queries).join(', ')}` };
  try { return q(pack, args || {}); } catch (e) { return { error: e.message }; }
}

// ── Confirmed actions: what the model may propose, and the shape each takes ─
// Execution lives in src/routes/assistant.js (it needs the database); this is
// the vocabulary and the argument checks, so a proposal is validated the same
// way whether it came from the model or from a hand-written request.
const ACTIVITY_TYPES = ['note', 'call', 'whatsapp', 'meeting'];
const PRIORITIES = ['low', 'medium', 'high'];
const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const ACTIONS = {
  create_followup: { label: 'Schedule a follow-up', perm: { section: 'leads', action: 'edit' }, needsCustomer: true,
    describe: a => `Follow-up for lead #${a.customer_id} on ${a.due_at}${a.note ? ' — ' + a.note : ''}`,
    validate: a => { const customer_id = num(a.customer_id); if (!(customer_id > 0)) return { error: 'customer_id is required' };
      let due = dayOf(a.due_at) || (num(a.days) > 0 ? addDays(todayStr(), Math.floor(num(a.days))) : ''); if (!due) return { error: 'Give due_at (YYYY-MM-DD) or days from today' };
      return { args: { customer_id, due_at: due, note: str(a.note, 500), assigned_to: num(a.assigned_to) > 0 ? num(a.assigned_to) : null } }; } },
  create_task: { label: 'Create a task', perm: { section: 'tasks', action: 'create' },
    describe: a => `Task "${a.title}" due ${a.due_date} (${a.priority})`,
    validate: a => { const title = str(a.title, 200); if (!title) return { error: 'title is required' }; const due_date = dayOf(a.due_date) || (num(a.days) > 0 ? addDays(todayStr(), Math.floor(num(a.days))) : ''); if (!due_date) return { error: 'Give due_date (YYYY-MM-DD) or days from today' };
      return { args: { title, description: str(a.description || a.body, 2000), due_date, priority: PRIORITIES.includes(a.priority) ? a.priority : 'medium', assignee_ids: arr(a.assignee_ids).map(x => String(num(x))).filter(x => x !== '0').slice(0, 10), assignee_id: num(a.assignee_id) > 0 ? String(num(a.assignee_id)) : '' } }; } },
  set_lead_status: { label: 'Change a lead\'s status', perm: { section: 'leads', action: 'edit' }, needsCustomer: true,
    describe: a => `Set lead #${a.customer_id} to "${a.status}"`,
    validate: a => { const customer_id = num(a.customer_id); const status = str(a.status, 40).toLowerCase().replace(/\s+/g, '_'); if (!(customer_id > 0)) return { error: 'customer_id is required' }; if (!status) return { error: 'status is required' }; return { args: { customer_id, status } }; } },
  log_activity: { label: 'Log an activity on a lead', perm: { section: 'leads', action: 'edit' }, needsCustomer: true,
    describe: a => `Log a ${a.type} on lead #${a.customer_id}: ${str(a.body, 80)}`,
    validate: a => { const customer_id = num(a.customer_id); const type = ACTIVITY_TYPES.includes(a.type || a.activity_type) ? (a.type || a.activity_type) : 'note'; const body = str(a.body, 2000); if (!(customer_id > 0)) return { error: 'customer_id is required' }; if (!body) return { error: 'body is required' }; return { args: { customer_id, type, body } }; } },
  assign_lead: { label: 'Assign a lead to an employee', perm: { section: 'leads', action: 'edit' }, needsCustomer: true,
    describe: a => `Assign lead #${a.customer_id} to employee #${a.employee_id}`,
    validate: a => { const customer_id = num(a.customer_id), employee_id = num(a.employee_id); if (!(customer_id > 0)) return { error: 'customer_id is required' }; if (!(employee_id > 0)) return { error: 'employee_id is required' }; return { args: { customer_id, employee_id } }; } },
  create_deal: { label: 'Open a deal for a lead', perm: { section: 'deals', action: 'create' }, needsCustomer: true,
    describe: a => `Deal "${a.title}" for lead #${a.customer_id}${a.budget_egp ? ' at EGP ' + a.budget_egp : ''}`,
    validate: a => { const customer_id = num(a.customer_id); const title = str(a.title, 200); if (!(customer_id > 0)) return { error: 'customer_id is required' }; if (!title) return { error: 'title is required' };
      return { args: { customer_id, title, stage: DEAL_STAGES.includes(a.stage) && a.stage !== 'won' && a.stage !== 'lost' ? a.stage : 'lead', car_model: str(a.car_model || a.car, 100), budget_egp: num(a.budget_egp) > 0 ? num(a.budget_egp) : null } }; } },
  notify: { label: 'Send a notification', perm: null,
    describe: a => `Notify ${a.to === 'admin' ? 'the admin' : a.to === 'me' ? 'me' : 'employee #' + a.to}: ${str(a.title, 80)}`,
    validate: a => { const title = str(a.title, 120); if (!title) return { error: 'title is required' }; const to = String(a.to || 'me'); if (!(to === 'me' || to === 'admin' || num(to) > 0)) return { error: 'to must be me, admin or an employee id' }; return { args: { to: num(to) > 0 ? String(num(to)) : to, title, body: str(a.body, 1000) } }; } },

  // ── The second wave: edits and records, each the manual route's twin ──
  edit_lead: { label: 'Update a lead\'s details', perm: { section: 'leads', action: 'edit' }, needsCustomer: true,
    describe: a => `Update lead #${a.customer_id}: ` + Object.entries(a.fields).map(([k, v]) => `${k} = ${typeof v === 'string' ? str(v, 60) : v}`).join(', '),
    validate: a => { const customer_id = num(a.customer_id); if (!(customer_id > 0)) return { error: 'customer_id is required' };
      const src = { ...(a.fields && typeof a.fields === 'object' ? a.fields : {}), ...a }; delete src.fields; delete src.type; delete src.customer_id;
      const f = {};
      const key = v => str(v, 40).toLowerCase().replace(/[\s-]+/g, '_');
      if (src.name != null && str(src.name, 120)) f.name = str(src.name, 120);
      if (src.phone != null) f.phone = str(src.phone, 30);
      if (src.email != null) f.email = str(src.email, 120);
      if (src.source != null) f.source = key(src.source);
      if (src.car_in_question != null || src.car != null || src.car_model != null) f.car_in_question = str(src.car_in_question ?? src.car ?? src.car_model, 120);
      if (src.budget_lead != null || src.budget != null || src.budget_egp != null) f.budget_lead = num(src.budget_lead ?? src.budget ?? src.budget_egp);
      if (src.budget_max != null) f.budget_max = num(src.budget_max);
      if (src.next_action != null) f.next_action = key(src.next_action);
      if (src.notes != null || src.note != null) f.notes = str(src.notes ?? src.note, 2000);
      if (src.sales_feedback != null) f.sales_feedback = str(src.sales_feedback, 1000);
      if (src.inquiry != null) f.inquiry = str(src.inquiry, 1000);
      if (src.been_contacted != null) f.been_contacted = src.been_contacted === true || src.been_contacted === 'true';
      if (src.status != null || src.lead_status != null) return { error: 'Use set_lead_status to change the status' };
      if (!Object.keys(f).length) return { error: 'Give at least one field: name, phone, email, source, car_in_question, budget_lead, budget_max, next_action, notes, been_contacted, sales_feedback, inquiry' };
      return { args: { customer_id, fields: f } }; } },
  complete_followup: { label: 'Close a follow-up', perm: { section: 'leads', action: 'edit' },
    describe: a => `Mark follow-up #${a.followup_id} ${a.status}`,
    validate: a => { const followup_id = num(a.followup_id); if (!(followup_id > 0)) return { error: 'followup_id is required' }; const status = a.status === 'cancelled' ? 'cancelled' : 'done'; return { args: { followup_id, status } }; } },
  set_deal_stage: { label: 'Move a deal to another stage', perm: { section: 'deals', action: 'move' },
    describe: a => `Move deal #${a.deal_id} to "${a.stage}"`,
    validate: a => { const deal_id = num(a.deal_id); const stage = str(a.stage, 20).toLowerCase(); if (!(deal_id > 0)) return { error: 'deal_id is required' }; if (!DEAL_STAGES.includes(stage)) return { error: 'stage must be one of ' + DEAL_STAGES.join(', ') }; return { args: { deal_id, stage } }; } },
  edit_deal: { label: 'Update a deal', perm: { section: 'deals', action: 'edit' },
    describe: a => `Update deal #${a.deal_id}: ` + Object.entries(a.fields).map(([k, v]) => `${k} = ${typeof v === 'string' ? str(v, 60) : v}`).join(', '),
    validate: a => { const deal_id = num(a.deal_id); if (!(deal_id > 0)) return { error: 'deal_id is required' };
      const src = { ...(a.fields && typeof a.fields === 'object' ? a.fields : {}), ...a }; const f = {};
      if (src.title != null && str(src.title, 200)) f.title = str(src.title, 200);
      if (src.car_model != null || src.car != null) f.car_model = str(src.car_model ?? src.car, 100);
      if (src.budget_egp != null || src.budget != null) f.budget_egp = num(src.budget_egp ?? src.budget);
      if (src.est_value != null) f.est_value = num(src.est_value);
      if (src.notes != null) f.notes = str(src.notes, 2000);
      if (src.assigned_to != null || src.employee_id != null) f.assigned_to = String(num(src.assigned_to ?? src.employee_id) || '');
      if (src.stage != null) return { error: 'Use set_deal_stage to move the deal' };
      if (!Object.keys(f).length) return { error: 'Give at least one field: title, car_model, budget_egp, est_value, notes, assigned_to' };
      return { args: { deal_id, fields: f } }; } },
  add_deal_note: { label: 'Add a note to a deal', perm: { section: 'deals', action: 'edit' },
    describe: a => `Note on deal #${a.deal_id}: ${str(a.body, 80)}`,
    validate: a => { const deal_id = num(a.deal_id); const body = str(a.body || a.note || a.notes, 2000); if (!(deal_id > 0)) return { error: 'deal_id is required' }; if (!body) return { error: 'body is required' }; return { args: { deal_id, body } }; } },
  update_task: { label: 'Update a task', perm: { section: 'tasks', action: 'edit' },
    describe: a => `Update task #${a.task_id}: ` + Object.entries(a.fields).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join('/') : typeof v === 'string' ? str(v, 60) : v}`).join(', '),
    validate: a => { const task_id = num(a.task_id); if (!(task_id > 0)) return { error: 'task_id is required' };
      const src = { ...(a.fields && typeof a.fields === 'object' ? a.fields : {}), ...a }; const f = {};
      if (src.status != null) { const st = str(src.status, 20).toLowerCase().replace(/[\s-]+/g, '_'); if (!TASK_STATUSES.includes(st)) return { error: 'status must be one of ' + TASK_STATUSES.join(', ') }; f.status = st; }
      const due = dayOf(src.due_date) || (num(src.days) > 0 ? addDays(todayStr(), Math.floor(num(src.days))) : ''); if (due) f.due_date = due;
      if (src.priority != null) f.priority = PRIORITIES.includes(src.priority) ? src.priority : 'medium';
      if (src.title != null && str(src.title, 200)) f.title = str(src.title, 200);
      if (src.description != null || src.body != null) f.description = str(src.description ?? src.body, 2000);
      if (src.assignee_ids != null || src.assignee_id != null || src.employee_id != null) { const list = [...arr(src.assignee_ids), ...(src.assignee_id != null ? [src.assignee_id] : []), ...(src.employee_id != null ? [src.employee_id] : [])].map(x => String(num(x))).filter(x => x !== '0'); if (list.length) f.assignee_ids = [...new Set(list)].slice(0, 10); }
      if (!Object.keys(f).length) return { error: 'Give at least one field: status (todo, in_progress, done), due_date or days, priority, title, description, assignee_ids' };
      return { args: { task_id, fields: f } }; } },
  comment_task: { label: 'Comment on a task', perm: { section: 'tasks', action: 'comment' },
    describe: a => `Comment on task #${a.task_id}: ${str(a.body, 80)}`,
    validate: a => { const task_id = num(a.task_id); const body = str(a.body || a.note, 2000); if (!(task_id > 0)) return { error: 'task_id is required' }; if (!body) return { error: 'body is required' }; return { args: { task_id, body } }; } },
  create_request: { label: 'File a request', perm: { section: 'requests', action: 'create' },
    describe: a => `Request "${a.title}"${a.category ? ' (' + a.category + ')' : ''}, ${a.priority} priority`,
    validate: a => { const title = str(a.title, 200); if (!title) return { error: 'title is required' };
      return { args: { title, description: str(a.description || a.body, 2000), category: str(a.category, 40), priority: PRIORITIES.includes(a.priority) ? a.priority : 'medium', assignee_id: num(a.assignee_id || a.employee_id) > 0 ? num(a.assignee_id || a.employee_id) : null } }; } },
  log_hours: { label: 'Log hours', perm: { section: 'hours', action: 'log' },
    describe: a => `Log ${a.hours}h on ${a.log_date}${a.task_description ? ' — ' + str(a.task_description, 60) : ''}`,
    validate: a => { const hours = num(a.hours); if (!(hours > 0 && hours <= 24)) return { error: 'hours must be between 0 and 24' }; const task_id = num(a.task_id) > 0 ? num(a.task_id) : null; const task_description = str(a.task_description || a.description || a.title, 300);
      if (!task_id && !task_description) return { error: 'Say what the hours were for (task_description) or which task (task_id)' };
      return { args: { hours: Math.round(hours * 100) / 100, task_id, task_description, log_date: dayOf(a.log_date || a.day) || todayStr(), description: str(a.description, 500) } }; } },
  record_payment: { label: 'Record a payment', perm: { section: 'deals', action: 'paymentsEdit' },
    describe: a => `Record ${a.direction === 'out' ? 'a refund/outgoing payment' : 'a payment'} of ${a.currency} ${a.amount.toLocaleString('en-US')} (${a.kind}) on ${a.paid_on}${a.sale_id ? ' for sale #' + a.sale_id : a.customer_id ? ' for lead #' + a.customer_id : ''}`,
    validate: a => { const amount = num(a.amount); if (!(amount > 0)) return { error: 'amount must be greater than zero' };
      const sale_id = num(a.sale_id) > 0 ? num(a.sale_id) : null, customer_id = num(a.customer_id) > 0 ? num(a.customer_id) : null;
      if (!sale_id && !customer_id) return { error: 'Give sale_id or customer_id' };
      const kind = PAYMENT_KIND_KEYS.includes(a.kind) ? a.kind : 'instalment';
      const def = PAYMENT_KINDS.find(k => k.key === kind) || {};
      const direction = a.direction === 'out' || a.direction === 'in' ? a.direction : (def.dir || def.direction || 'in');
      const currency = CURRENCIES.includes(String(a.currency || '').toUpperCase()) ? String(a.currency).toUpperCase() : 'EGP';
      const fx_rate = currency === 'EGP' ? 1 : num(a.fx_rate); if (!(fx_rate > 0)) return { error: 'fx_rate (EGP per 1 ' + currency + ') is required for a non-EGP payment' };
      return { args: { sale_id, customer_id, amount, kind, direction, currency, fx_rate, paid_on: dayOf(a.paid_on || a.day) || todayStr(), method: PAYMENT_METHODS.includes(a.method) ? a.method : '', reference: str(a.reference, 120), notes: str(a.notes || a.note, 1000) } }; } },
  record_expense: { label: 'Record an expense', perm: { section: 'accounting', action: 'edit' },
    describe: a => `Record an expense of ${a.currency} ${a.amount.toLocaleString('en-US')} (${a.category}) on ${a.spent_on}${a.vendor ? ' — ' + a.vendor : ''}`,
    validate: a => { const amount = num(a.amount); if (!(amount > 0)) return { error: 'amount must be greater than zero' };
      const category = EXPENSE_CATEGORY_KEYS.includes(str(a.category, 40).toLowerCase()) ? str(a.category, 40).toLowerCase() : 'other';
      const currency = CURRENCIES.includes(String(a.currency || '').toUpperCase()) ? String(a.currency).toUpperCase() : 'EGP';
      const fx_rate = currency === 'EGP' ? 1 : num(a.fx_rate); if (!(fx_rate > 0)) return { error: 'fx_rate (EGP per 1 ' + currency + ') is required for a non-EGP expense' };
      return { args: { amount, category, currency, fx_rate, spent_on: dayOf(a.spent_on || a.day) || todayStr(), description: str(a.description || a.title || a.body, 300), vendor: str(a.vendor, 120), method: PAYMENT_METHODS.includes(a.method) ? a.method : '', reference: str(a.reference, 120), notes: str(a.notes || a.note, 1000) } }; } },
  link_submission: { label: 'Link a website submission to a lead', perm: { section: 'submissions', action: 'view' }, needsCustomer: true,
    describe: a => `Link submission #${a.submission_id} to lead #${a.customer_id}`,
    validate: a => { const submission_id = num(a.submission_id), customer_id = num(a.customer_id); if (!(submission_id > 0)) return { error: 'submission_id is required' }; if (!(customer_id > 0)) return { error: 'customer_id is required' }; return { args: { submission_id, customer_id } }; } },
};
function validateAction(type, raw) {
  const def = ACTIONS[type];
  if (!def) return { error: `Unknown action "${type}". Choose one of: ${Object.keys(ACTIONS).join(', ')}` };
  const v = def.validate(raw || {});
  if (v.error) return { error: v.error };
  return { type, args: v.args, label: def.label, description: def.describe(v.args), perm: def.perm };
}

module.exports = {
  SECTIONS, PAGE_TO_SECTION, sectionForPage, buildPack, trimSectionPack, sectionQuery, capJson,
  buildLead360, buildDeal360, buildSupplier360, buildVehicle360, buildSearch,
  ACTIONS, validateAction, DEAL_STAGES, LEAD_STATUSES, TASK_STATUSES,
  buildLeadsPack, buildDealsPack, buildQuotationPack, buildContractsPack, buildRfqPack, buildPurchaseOrdersPack,
  buildSuppliersPack, buildStockPack, buildSubmissionsPack, buildTasksPack, buildHoursPack, buildRequestsPack,
  buildMeetPack, buildIssuesPack, buildEmployeesPack, buildAutomationsPack, buildHomePack,
};
