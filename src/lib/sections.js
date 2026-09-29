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
const { LEADS_ENUM_DEFAULTS, PAYMENT_KINDS } = require('./constants');

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

// ── The registry ────────────────────────────────────────────────────────────
// gate: the read permission the section's own page needs (null = everyone).
// admin: true means the section exists only in the admin dashboard.
const SECTIONS = {
  home: { label: 'Home', gate: null, build: buildHomePack, queries: HOME_QUERIES, actions: ['create_task', 'create_followup', 'notify'],
    chips: { en: ['What needs my attention today?', 'Which follow-ups are overdue?', 'Plan my day'], ar: ['ما الذي يحتاج انتباهي اليوم؟', 'ما المتابعات المتأخرة؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each, about what needs attention today: overdue tasks and follow-ups, meetings, new and hot leads, open pipeline, pending requests.' },
  leads: { label: 'Leads', gate: { section: 'leads', action: 'view' }, build: buildLeadsPack, queries: LEADS_QUERIES, actions: ['create_followup', 'set_lead_status', 'log_activity', 'assign_lead', 'create_deal', 'create_task'],
    chips: { en: ['Which hot leads have gone quiet?', 'Who should I call first today?', 'Draft a WhatsApp follow-up for a stale lead', 'Which sources bring the most hot leads?'], ar: ['أي العملاء الساخنين لم يتم التواصل معهم؟', 'بمن أتصل أولاً اليوم؟', 'اكتب رسالة متابعة واتساب'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…],"call_list":[{"customer_id":0,"name":"","why":""}]} — up to 4 short sentences each, quoting figures from the pack (counts by status and source, new leads, follow-ups overdue/today, stale hot and warm leads, unassigned). call_list: up to 6 leads to contact first, most urgent first (overdue follow-ups, then stale hot leads), each "why" one sentence.' },
  deals: { label: 'Deals', gate: { section: 'deals', action: 'view' }, build: buildDealsPack, queries: DEALS_QUERIES, actions: ['create_followup', 'create_task', 'log_activity', 'notify'],
    chips: { en: ['Which deals are stuck?', 'What is the weighted pipeline?', 'What did we win this month?', 'Which sales still owe money?'], ar: ['أي الصفقات متوقفة؟', 'ما قيمة خط الأنابيب المرجّح؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each, quoting figures from the pack (pipeline by stage, weighted value, win rate, this month, stuck deals, open sales balances).' },
  quotation: { label: 'Quotation', gate: { section: 'quotation', action: 'history' }, build: buildQuotationPack, queries: QUOTATION_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['How many quotes went out this month?', 'Which vehicles are quoted most?', 'Find the latest quote for a customer'], ar: ['كم عرض سعر صدر هذا الشهر؟', 'أكثر السيارات المعروضة؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about quotation volume, the vehicles quoted most and anything worth following up.' },
  contracts: { label: 'Contracts', gate: { section: 'contracts', action: 'view' }, build: buildContractsPack, queries: CONTRACTS_QUERIES, actions: ['create_task', 'notify'],
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
  submissions: { label: 'Submissions', gate: { section: 'submissions', action: 'view' }, build: buildSubmissionsPack, queries: SUBMISSIONS_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['Which website submissions are not linked to a lead?', 'What are people asking for this week?'], ar: ['أي طلبات الموقع غير مرتبطة بعميل؟', 'ماذا يطلب الناس هذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about submission volume, sources, cars asked for and submissions not yet linked to a lead.' },
  tasks: { label: 'Tasks', gate: { section: 'tasks', action: 'view' }, build: buildTasksPack, queries: TASKS_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['What is overdue?', 'What is due this week?', 'Who is overloaded?'], ar: ['ما المهام المتأخرة؟', 'ما المستحق هذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about open tasks by status and priority, overdue, due today and this week, and load per assignee.' },
  hours: { label: 'Hours', gate: { section: 'hours', action: 'view' }, build: buildHoursPack, queries: HOURS_QUERIES, actions: ['notify'],
    chips: { en: ['Hours logged this week', 'Which days had no hours logged?'], ar: ['الساعات المسجلة هذا الأسبوع', 'أي الأيام بلا ساعات؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about hours in the last 7 and 30 days, by day and by employee.' },
  requests: { label: 'Requests', gate: { section: 'requests', action: 'view' }, build: buildRequestsPack, queries: REQUESTS_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['Which requests are waiting longest?', 'Requests by category'], ar: ['أي الطلبات تنتظر أطول؟', 'الطلبات حسب الفئة'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about requests by status and category and the oldest pending ones.' },
  meet: { label: 'Meetings', gate: { section: 'meet', action: 'view' }, build: buildMeetPack, queries: MEET_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['What meetings do I have today?', 'What is on this week?'], ar: ['ما اجتماعات اليوم؟', 'ما المخطط لهذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about today\'s and this week\'s meetings.' },
  issues: { label: 'Issues', gate: { section: 'issues', action: 'view' }, build: buildIssuesPack, queries: ISSUES_QUERIES, actions: ['create_task', 'notify'],
    chips: { en: ['Which issues have been open longest?', 'What was resolved this week?'], ar: ['أي المشكلات مفتوحة منذ أطول وقت؟', 'ما الذي حُل هذا الأسبوع؟'] },
    task: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each about open issues, their age, reporters and what was resolved this week.' },
  employees: { label: 'Employees', gate: null, admin: true, build: buildEmployeesPack, queries: EMPLOYEES_QUERIES, actions: ['create_task', 'notify'],
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
};
function validateAction(type, raw) {
  const def = ACTIONS[type];
  if (!def) return { error: `Unknown action "${type}". Choose one of: ${Object.keys(ACTIONS).join(', ')}` };
  const v = def.validate(raw || {});
  if (v.error) return { error: v.error };
  return { type, args: v.args, label: def.label, description: def.describe(v.args), perm: def.perm };
}

module.exports = {
  SECTIONS, PAGE_TO_SECTION, sectionForPage, buildPack, trimSectionPack, sectionQuery,
  ACTIONS, validateAction, DEAL_STAGES, LEAD_STATUSES,
  buildLeadsPack, buildDealsPack, buildQuotationPack, buildContractsPack, buildRfqPack, buildPurchaseOrdersPack,
  buildSuppliersPack, buildStockPack, buildSubmissionsPack, buildTasksPack, buildHoursPack, buildRequestsPack,
  buildMeetPack, buildIssuesPack, buildEmployeesPack, buildAutomationsPack, buildHomePack,
};
