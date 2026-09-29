// Finance arithmetic for the Accounting section.
//
// Pure on purpose: no database and no context object, so tests/accttest.js can
// feed it fixtures and assert the numbers, and so every figure on the Accounting
// page — and every figure the finance AI is handed — comes from one place. The
// model narrates these numbers; it never computes them. When it needs one that
// is not in the pack it calls back into `financeQuery` and `safeCalc` below.
//
// Money follows the ledger's rules (src/routes/payments.js): everything carries
// the currency it happened in and the rate it was booked at, and totals are in
// BASE_CURRENCY. A sale with no payment rows yet keeps reading off its own
// down_payment / remaining columns, exactly as the Sales tab does.
const { BASE_CURRENCY, CURRENCIES, PAYMENT_KINDS, PAYMENT_METHODS,
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, sanitizeAttachments } = require('./constants');

const num = v => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const str = (v, max) => String(v ?? '').trim().slice(0, max || 200);
const arr = v => (Array.isArray(v) ? v : []);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = d => new Date(d).toISOString().slice(0, 10);
const todayStr = () => isoDay(Date.now());
const dayOf = v => { const s = String(v || '').slice(0, 10); return DATE_RE.test(s) ? s : ''; };
const monthOf = v => dayOf(v).slice(0, 7);
const inRange = (day, from, to) => !!day && (!from || day >= from) && (!to || day <= to);
const pad2 = n => String(n).padStart(2, '0');

// ── Months ───────────────────────────────────────────────────────────────────
function addMonths(ym, n) {
  const [y, m] = String(ym).split('-').map(Number);
  return new Date(Date.UTC(y, (m - 1) + n, 1)).toISOString().slice(0, 7);
}
const monthStart = ym => ym + '-01';
function monthEnd(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
// Every month from `from` to `to`, inclusive, so a chart has a bar for a month
// with nothing in it rather than a gap that reads as missing data.
function monthsBetween(from, to) {
  const out = [];
  let cur = String(from).slice(0, 7);
  const last = String(to).slice(0, 7);
  let guard = 0;
  while (cur <= last && guard++ < 120) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
}
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = ym => `${MONTH_NAMES[Number(String(ym).slice(5, 7)) - 1] || ym} ${String(ym).slice(0, 4)}`;

// The periods the Reports tab offers. `custom` needs from/to; anything it
// cannot read falls back to this month rather than to an empty range.
function reportRangeFor(period, opts) {
  const o = opts || {};
  const t = dayOf(o.today) || todayStr();
  const ym = t.slice(0, 7);
  const p = String(period || 'this_month');
  if (p === 'last_month') {
    const m = addMonths(ym, -1);
    return { from: monthStart(m), to: monthEnd(m), label: monthLabel(m), period: p };
  }
  if (p === 'quarter') {
    const y = ym.slice(0, 4);
    const q = Math.floor((Number(ym.slice(5, 7)) - 1) / 3);
    const sm = q * 3 + 1;
    return { from: `${y}-${pad2(sm)}-01`, to: monthEnd(`${y}-${pad2(sm + 2)}`), label: `Q${q + 1} ${y}`, period: p };
  }
  if (p === 'ytd') {
    return { from: ym.slice(0, 4) + '-01-01', to: t, label: `${ym.slice(0, 4)} to date`, period: p };
  }
  if (p === 'custom') {
    const from = dayOf(o.from), to = dayOf(o.to);
    if (from && to && from <= to) return { from, to, label: `${from} → ${to}`, period: p };
  }
  return { from: monthStart(ym), to: monthEnd(ym), label: monthLabel(ym), period: 'this_month' };
}

// ── One sale's position ──────────────────────────────────────────────────────
// What the customer agreed to pay: the discounted figure when one was given,
// the list price otherwise. A zero discount means no discount.
function agreedPrice(sale) {
  const s = sale || {};
  return num(s.discounted) > 0 ? num(s.discounted) : num(s.price_list);
}

// Customer-side kinds settle the sale; everything else is cost.
const CUSTOMER_SIDE = new Set(['reservation', 'down_payment', 'instalment', 'final', 'refund']);
const COST_KINDS = ['supplier', 'freight', 'customs'];
const kindLabel = k => (PAYMENT_KINDS.find(x => x.key === k) || {}).label || String(k || '');
const categoryLabel = k => (EXPENSE_CATEGORIES.find(x => x.key === k) || {}).label || String(k || 'Other');
const paymentBase = p => round2(num(p.amount_base) || num(p.amount) * (num(p.fx_rate) || 1));

// How late the remaining balance is, in whole days. Zero when nothing is owed
// or no due date was set: an unsettled sale with no due date is unscheduled,
// not overdue by twenty thousand days. Same rule as the ledger's.
function daysOverdue(dueStr, outstanding, today) {
  if (!(outstanding > 0) || !DATE_RE.test(String(dueStr || ''))) return 0;
  const due = Date.parse(dueStr + 'T00:00:00Z');
  const now = Date.parse((dayOf(today) || todayStr()) + 'T00:00:00Z');
  if (!Number.isFinite(due) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((now - due) / 864e5));
}

const AGING_BUCKETS = [
  { key: 'current', label: 'Not yet due' },
  { key: '1_30',    label: '1–30 days' },
  { key: '31_60',   label: '31–60 days' },
  { key: '61_90',   label: '61–90 days' },
  { key: '90_plus', label: 'Over 90 days' },
];
function agingBucket(days) {
  const d = Math.max(0, Math.round(num(days)));
  if (d <= 0) return 'current';
  if (d <= 30) return '1_30';
  if (d <= 60) return '31_60';
  if (d <= 90) return '61_90';
  return '90_plus';
}

// The receivable position of one sale, from its payment rows.
//
// `helpers.paymentSummary` is the ledger's own summary() (src/routes/payments.js)
// and the production path always passes it, so the Sales tab and the Accounting
// page cannot disagree. Without it the fallback below applies the same rules —
// that is what lets tests run this file without the context object.
function salePosition(sale, rows, today, helpers) {
  const s = sale || {};
  const t = dayOf(today) || todayStr();
  const price = round2(agreedPrice(s));
  const list = arr(rows);
  let received = 0, refunded = 0, outstanding = 0, last = null, legacy = false;
  if (!list.length) {
    // A sale recorded before the ledger existed keeps reading off its own columns.
    legacy = true;
    received = round2(num(s.down_payment));
    const rem = num(s.remaining);
    outstanding = rem > 0 ? round2(rem) : round2(Math.max(0, price - received));
  } else if (helpers && typeof helpers.paymentSummary === 'function') {
    const sum = helpers.paymentSummary(list, price, t);
    received = round2(sum.received); refunded = round2(sum.refunded);
    outstanding = round2(sum.outstanding); last = sum.last_payment_on || null;
  } else {
    for (const p of list) {
      if (!CUSTOMER_SIDE.has(p.kind)) continue;
      const b = paymentBase(p);
      if (p.direction === 'out' || p.kind === 'refund') refunded += b; else received += b;
    }
    received = round2(received); refunded = round2(refunded);
    outstanding = round2(Math.max(0, price - (received - refunded)));
    last = list.filter(p => CUSTOMER_SIDE.has(p.kind)).map(p => dayOf(p.paid_on)).filter(Boolean).sort().slice(-1)[0] || null;
  }
  const due = dayOf(s.remaining_due);
  const days = daysOverdue(due, outstanding, t);
  return {
    sale_id: s.id, customer_id: s.customer_id || null,
    client: str(s.client, 120),
    vehicle: [s.brand, s.model, s.trim].map(x => String(x || '').trim()).filter(Boolean).join(' '),
    vin: str(s.vin, 20), status: str(s.status, 40), sales_name: str(s.sales_name, 80),
    agreed_price: price, received, refunded, net: round2(received - refunded), outstanding,
    due: due || null, days_overdue: days,
    bucket: outstanding > 0 ? agingBucket(days) : null,
    settled: price > 0 && outstanding <= 0,
    last_payment_on: last, legacy,
    reservation_date: dayOf(s.reservation_date) || null,
    delivery_date: dayOf(s.delivery_date) || null,
  };
}

// ── The finance pack ─────────────────────────────────────────────────────────
// Everything the Accounting page shows and everything the AI is told, computed
// once from the raw rows. Cash and costs are by paid_on within the range;
// receivables are as of today, because a debt does not belong to a month.
const DEFINITIONS = [
  'agreed price of a sale = discounted price when one was given, else the list price',
  'cash.in / cash.out = every ledger payment by direction, in the base currency, by paid_on',
  'revenue.cash = customer-side payments received (reservation, down payment, instalment, final) minus refunds, by paid_on',
  'revenue.agreed = agreed price of sales reserved in the range (reservation_date, else the day the sale was recorded)',
  'cogs = supplier + freight + customs payments out, by paid_on',
  'gross_margin = revenue.cash − cogs',
  'opex = operating expenses (the expenses table) in the base currency, by spent_on',
  'net_result = gross_margin − opex',
  'receivables = every sale with money still owed, as of today; a sale with no payment rows uses its own down_payment / remaining columns',
  'purchase order pi_total = Σ pi_price × units of its lines, in the PO currency (usually USD); paid_base is known only where vehicle units link payments to that PO',
  'top_suppliers = purchase orders in the range grouped by supplier and currency',
  'all figures are company-wide',
];

function buildFinancePack(data, range, opts) {
  const d = data || {};
  const o = opts || {};
  const t = dayOf(o.today) || todayStr();
  const from = dayOf(range && range.from) || monthStart(t.slice(0, 7));
  const to = dayOf(range && range.to) || monthEnd(t.slice(0, 7));
  const sales = arr(d.sales), payments = arr(d.payments), pos = arr(d.purchaseOrders);
  const expenses = arr(d.expenses), units = arr(d.units);
  const warnings = arr(d.warnings).map(String);
  const helpers = o.helpers || {};

  // ── Cash, revenue, costs: the ledger inside the range ──
  const months = monthsBetween(from, to);
  const byMonth = Object.fromEntries(months.map(m => [m, { month: m, in: 0, out: 0, net: 0 }]));
  const saleById = new Map(sales.map(s => [String(s.id), s]));
  let cashIn = 0, cashOut = 0, revCash = 0, refunds = 0, payIn = 0, payOut = 0;
  const cogs = { supplier: 0, freight: 0, customs: 0 };
  const outByKind = {};
  const clientIn = {};
  for (const p of payments) {
    const day = dayOf(p.paid_on);
    if (!inRange(day, from, to)) continue;
    const b = paymentBase(p);
    const out = p.direction === 'out';
    const m = day.slice(0, 7);
    if (out) { cashOut += b; payOut++; } else { cashIn += b; payIn++; }
    if (byMonth[m]) { if (out) byMonth[m].out += b; else byMonth[m].in += b; }
    if (CUSTOMER_SIDE.has(p.kind)) {
      if (out || p.kind === 'refund') refunds += b;
      else {
        revCash += b;
        const s = saleById.get(String(p.sale_id));
        const name = (s && String(s.client || '').trim()) || (p.customer_id ? 'Customer #' + p.customer_id : 'Unlinked');
        clientIn[name] = (clientIn[name] || 0) + b;
      }
    } else if (out && COST_KINDS.includes(p.kind)) {
      cogs[p.kind] += b;
    }
    if (out) {
      const k = p.kind || 'other';
      outByKind[k] = outByKind[k] || { kind: k, label: kindLabel(k), amount: 0, count: 0 };
      outByKind[k].amount += b; outByKind[k].count++;
    }
  }
  for (const m of Object.values(byMonth)) { m.in = round2(m.in); m.out = round2(m.out); m.net = round2(m.in - m.out); }
  const cogsTotal = round2(cogs.supplier + cogs.freight + cogs.customs);
  const revenueCash = round2(revCash - refunds);
  const grossMargin = round2(revenueCash - cogsTotal);

  // ── Agreed revenue: sales reserved in the range ──
  let agreed = 0, reserved = 0;
  for (const s of sales) {
    const day = dayOf(s.reservation_date) || dayOf(s.created_at);
    if (!inRange(day, from, to)) continue;
    agreed += agreedPrice(s); reserved++;
  }

  // ── Operating expenses ──
  const opexCat = {}, opexMonth = Object.fromEntries(months.map(m => [m, 0]));
  let opexTotal = 0, opexCount = 0;
  const priorMonths = 3;
  const priorFrom = monthStart(addMonths(from.slice(0, 7), -priorMonths));
  const priorTo = monthEnd(addMonths(from.slice(0, 7), -1));
  const priorCat = {};
  let priorTotal = 0;
  for (const e of expenses) {
    const day = dayOf(e.spent_on);
    const b = paymentBase(e);
    const k = EXPENSE_CATEGORY_KEYS.includes(e.category) ? e.category : 'other';
    if (inRange(day, from, to)) {
      opexTotal += b; opexCount++;
      opexCat[k] = opexCat[k] || { category: k, label: categoryLabel(k), amount: 0, count: 0 };
      opexCat[k].amount += b; opexCat[k].count++;
      const m = day.slice(0, 7);
      if (m in opexMonth) opexMonth[m] += b;
    } else if (inRange(day, priorFrom, priorTo)) {
      priorTotal += b;
      priorCat[k] = priorCat[k] || { category: k, label: categoryLabel(k), amount: 0, count: 0 };
      priorCat[k].amount += b; priorCat[k].count++;
    }
  }
  const opexByCategory = Object.values(opexCat).map(c => ({ ...c, amount: round2(c.amount) })).sort((a, b) => b.amount - a.amount);
  const priorByCategory = Object.values(priorCat).map(c => ({ ...c, amount: round2(c.amount), avg_per_month: round2(c.amount / priorMonths) })).sort((a, b) => b.amount - a.amount);
  opexTotal = round2(opexTotal);
  const netResult = round2(grossMargin - opexTotal);

  // ── Receivables, as of today ──
  const bySale = new Map();
  for (const p of payments) {
    if (p.sale_id == null) continue;
    const k = String(p.sale_id);
    if (!bySale.has(k)) bySale.set(k, []);
    bySale.get(k).push(p);
  }
  const positions = sales.map(s => salePosition(s, bySale.get(String(s.id)) || [], t, helpers));
  const open = positions.filter(r => r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
  const aging = Object.fromEntries(AGING_BUCKETS.map(b => [b.key, { label: b.label, amount: 0, count: 0 }]));
  let recvOutstanding = 0, recvOverdue = 0, overdueCount = 0;
  for (const r of open) {
    recvOutstanding += r.outstanding;
    if (r.days_overdue > 0) { recvOverdue += r.outstanding; overdueCount++; }
    aging[r.bucket].amount += r.outstanding; aging[r.bucket].count++;
  }
  for (const b of Object.values(aging)) b.amount = round2(b.amount);

  // ── Payables: what goes out, and the purchase orders it goes out against ──
  const unitPo = new Map(units.filter(u => u.po_id != null).map(u => [String(u.id), String(u.po_id)]));
  const paidByPo = {};
  if (unitPo.size) {
    for (const p of payments) {
      if (p.direction !== 'out' || p.unit_id == null) continue;
      const po = unitPo.get(String(p.unit_id));
      if (po) paidByPo[po] = (paidByPo[po] || 0) + paymentBase(p);
    }
  }
  const poTotal = items => arr(items).reduce((s, it) => s + (num(it.pi_price) * (num(it.units) || 1)), 0);
  const poUnits = items => arr(items).reduce((s, it) => s + (num(it.units) || 1), 0);
  const purchaseOrders = pos.map(po => ({
    id: po.id, po_number: str(po.po_number, 60), supplier: str(po.supplier, 120),
    currency: str(po.currency, 8) || 'USD', pi_total: round2(poTotal(po.items)), units: poUnits(po.items),
    status: str(po.status, 30), po_date: dayOf(po.po_date) || dayOf(po.created_at) || null,
    paid_base: (String(po.id) in paidByPo) ? round2(paidByPo[String(po.id)]) : null,
  })).sort((a, b) => String(b.po_date || '').localeCompare(String(a.po_date || ''))).slice(0, 200);
  const poInRange = purchaseOrders.filter(po => inRange(po.po_date, from, to));
  const poByCurrency = {};
  for (const po of poInRange) poByCurrency[po.currency] = round2((poByCurrency[po.currency] || 0) + po.pi_total);
  const supMap = {};
  for (const po of poInRange) {
    const k = (po.supplier || '(no supplier)') + '|' + po.currency;
    supMap[k] = supMap[k] || { supplier: po.supplier || '(no supplier)', currency: po.currency, pi_total: 0, orders: 0 };
    supMap[k].pi_total = round2(supMap[k].pi_total + po.pi_total); supMap[k].orders++;
  }
  // The rate the company last booked a USD movement at — indicative, never applied silently.
  const usd = [...payments, ...expenses]
    .filter(x => String(x.currency || '').toUpperCase() === 'USD' && num(x.fx_rate) > 0 && (dayOf(x.paid_on) || dayOf(x.spent_on)))
    .map(x => ({ rate: num(x.fx_rate), as_of: dayOf(x.paid_on) || dayOf(x.spent_on) }))
    .sort((a, b) => b.as_of.localeCompare(a.as_of))[0] || null;

  return {
    range: { from, to }, base_currency: BASE_CURRENCY, today: t, generated_at: new Date().toISOString(),
    definitions: DEFINITIONS.slice(),
    cash: { in: round2(cashIn), out: round2(cashOut), net: round2(cashIn - cashOut), by_month: Object.values(byMonth) },
    revenue: { cash: revenueCash, agreed: round2(agreed), refunds: round2(refunds), sales_reserved: reserved },
    cogs: { supplier: round2(cogs.supplier), freight: round2(cogs.freight), customs: round2(cogs.customs), total: cogsTotal },
    gross_margin: { amount: grossMargin, pct: revenueCash > 0 ? round2((grossMargin / revenueCash) * 100) : 0 },
    opex: {
      total: opexTotal, count: opexCount, by_category: opexByCategory,
      by_month: months.map(m => ({ month: m, amount: round2(opexMonth[m]) })),
      prior: { months: priorMonths, from: priorFrom, to: priorTo, total: round2(priorTotal),
        avg_per_month: round2(priorTotal / priorMonths), by_category: priorByCategory },
    },
    net_result: netResult,
    receivables: {
      outstanding: round2(recvOutstanding), overdue: round2(recvOverdue), count: open.length, overdue_count: overdueCount,
      aging, rows: open,
    },
    payables: {
      out_by_kind: Object.values(outByKind).map(k => ({ ...k, amount: round2(k.amount) })).sort((a, b) => b.amount - a.amount),
      purchase_orders: purchaseOrders, po_in_range: poInRange.length, po_by_currency: poByCurrency,
      indicative_usd_rate: usd,
    },
    top_clients: Object.entries(clientIn).map(([client, received]) => ({ client, received: round2(received) }))
      .sort((a, b) => b.received - a.received).slice(0, 8),
    top_suppliers: Object.values(supMap).sort((a, b) => b.pi_total - a.pi_total).slice(0, 8),
    counts: {
      payments_in: payIn, payments_out: payOut, expenses: opexCount,
      sales_total: sales.length, sales_open: open.length, sales_settled: positions.filter(r => r.settled).length,
      purchase_orders: pos.length,
    },
    warnings,
  };
}

// What the model is handed: the pack with its long lists cut down. The full
// pack is what the page renders; the model gets enough to reason and fetches
// the rest through finance_query.
function trimPack(pack) {
  const p = JSON.parse(JSON.stringify(pack || {}));
  if (p.receivables) p.receivables.rows = arr(p.receivables.rows).slice(0, 40).map(r => {
    const { vin, status, reservation_date, delivery_date, ...rest } = r; return rest;
  });
  if (p.payables) p.payables.purchase_orders = arr(p.payables.purchase_orders).slice(0, 30);
  delete p.generated_at;
  return p;
}

// ── Named queries the AI may run ─────────────────────────────────────────────
// A fixed menu rather than free SQL: each one is a filter over rows this
// process already holds, so the model can look a figure up but cannot reach
// anything the page could not show.
const QUERY_NAMES = ['sum_payments', 'sum_expenses', 'expenses_by_category', 'cash_by_month',
  'top_receivables', 'overdue_receivables', 'sale_position', 'po_list', 'top_clients', 'top_suppliers'];
function financeQuery(data, pack, name, args) {
  const d = data || {}, a = args || {}, p = pack || {};
  if (!QUERY_NAMES.includes(name)) return { error: `Unknown query "${name}". Choose one of: ${QUERY_NAMES.join(', ')}` };
  const from = dayOf(a.from) || (p.range && p.range.from) || '';
  const to = dayOf(a.to) || (p.range && p.range.to) || '';
  if (a.from && !dayOf(a.from)) return { error: 'from must be YYYY-MM-DD' };
  if (a.to && !dayOf(a.to)) return { error: 'to must be YYYY-MM-DD' };
  const limit = Math.max(1, Math.min(50, Math.floor(num(a.limit)) || 10));
  const payments = arr(d.payments), expenses = arr(d.expenses);
  switch (name) {
    case 'sum_payments': {
      if (a.direction && !['in', 'out'].includes(a.direction)) return { error: 'direction must be in or out' };
      const rows = payments.filter(x => inRange(dayOf(x.paid_on), from, to)
        && (!a.direction || x.direction === a.direction) && (!a.kind || x.kind === a.kind));
      return { from, to, direction: a.direction || 'any', kind: a.kind || 'any', count: rows.length,
        amount_base: round2(rows.reduce((s, x) => s + paymentBase(x), 0)), currency: BASE_CURRENCY };
    }
    case 'sum_expenses': {
      const rows = expenses.filter(x => inRange(dayOf(x.spent_on), from, to) && (!a.category || x.category === a.category));
      return { from, to, category: a.category || 'any', count: rows.length,
        amount_base: round2(rows.reduce((s, x) => s + paymentBase(x), 0)), currency: BASE_CURRENCY };
    }
    case 'expenses_by_category': {
      const m = {};
      for (const x of expenses) {
        if (!inRange(dayOf(x.spent_on), from, to)) continue;
        const k = EXPENSE_CATEGORY_KEYS.includes(x.category) ? x.category : 'other';
        m[k] = m[k] || { category: k, label: categoryLabel(k), amount_base: 0, count: 0 };
        m[k].amount_base = round2(m[k].amount_base + paymentBase(x)); m[k].count++;
      }
      return { from, to, rows: Object.values(m).sort((x, y) => y.amount_base - x.amount_base) };
    }
    case 'cash_by_month': {
      const months = monthsBetween(from || to, to || from);
      const m = Object.fromEntries(months.map(k => [k, { month: k, in: 0, out: 0, net: 0 }]));
      for (const x of payments) {
        const day = dayOf(x.paid_on);
        if (!inRange(day, from, to) || !m[day.slice(0, 7)]) continue;
        const b = paymentBase(x);
        if (x.direction === 'out') m[day.slice(0, 7)].out = round2(m[day.slice(0, 7)].out + b);
        else m[day.slice(0, 7)].in = round2(m[day.slice(0, 7)].in + b);
      }
      return { from, to, rows: Object.values(m).map(r => ({ ...r, net: round2(r.in - r.out) })) };
    }
    case 'top_receivables':
      return { as_of: p.today, rows: arr(p.receivables && p.receivables.rows).slice(0, limit) };
    case 'overdue_receivables': {
      const min = Math.max(1, Math.floor(num(a.min_days)) || 1);
      const rows = arr(p.receivables && p.receivables.rows).filter(r => r.days_overdue >= min)
        .sort((x, y) => y.days_overdue - x.days_overdue).slice(0, limit);
      return { as_of: p.today, min_days: min, count: rows.length, outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)), rows };
    }
    case 'sale_position': {
      const q = String(a.client || '').trim().toLowerCase();
      const id = num(a.sale_id);
      const rows = arr(p.receivables && p.receivables.rows)
        .filter(r => (id > 0 && Number(r.sale_id) === id) || (q && String(r.client || '').toLowerCase().includes(q)));
      if (!id && !q) return { error: 'Give a client name or a sale_id' };
      return { as_of: p.today, count: rows.length, rows: rows.slice(0, limit) };
    }
    case 'po_list': {
      const q = String(a.supplier || '').trim().toLowerCase();
      const rows = arr(p.payables && p.payables.purchase_orders)
        .filter(po => !q || String(po.supplier || '').toLowerCase().includes(q)).slice(0, limit);
      return { count: rows.length, rows };
    }
    case 'top_clients': return { from: p.range && p.range.from, to: p.range && p.range.to, rows: arr(p.top_clients).slice(0, limit) };
    case 'top_suppliers': return { from: p.range && p.range.from, to: p.range && p.range.to, rows: arr(p.top_suppliers).slice(0, limit) };
  }
  return { error: 'Unhandled query' };
}

// ── A calculator the model can trust ─────────────────────────────────────────
// A small expression language, parsed by hand: numbers (commas allowed),
// + - * / ^, parentheses, unary minus, a trailing % (5% = 0.05), and a few
// named functions. No eval, no Function, no identifiers it does not know —
// the point is that "what is 12% of the outstanding balance" is answered by
// arithmetic that ran here, not by a language model's arithmetic.
const CALC_FN = {
  pct: (part, whole) => (whole ? (part / whole) * 100 : 0),
  round: (x, n) => { const f = Math.pow(10, Math.max(0, Math.min(6, Math.floor(n || 0)))); return Math.round(x * f) / f; },
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  sum: (...a) => a.reduce((s, x) => s + x, 0),
  avg: (...a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0),
  abs: x => Math.abs(x),
};
function safeCalc(expression) {
  const src = String(expression || '').trim();
  if (!src) throw new Error('Empty expression');
  if (src.length > 200) throw new Error('Expression too long (200 characters max)');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      // A comma is a thousands separator only when exactly three digits follow
      // it, so "pct(250,000, 1,000,000)" reads as two arguments and "max(1,2)"
      // as two numbers.
      const m = src.slice(i).match(/^(\d+(?:,\d{3})*(?:\.\d*)?|\.\d+)/);
      if (!m) throw new Error('Bad number at "' + src.slice(i, i + 6) + '"');
      const raw = m[0];
      if (/[0-9.]/.test(src[i + raw.length] || '')) throw new Error('Bad number "' + src.slice(i, i + raw.length + 1) + '"');
      tokens.push({ t: 'num', v: Number(raw.replace(/,/g, '')) }); i += raw.length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j).toLowerCase() }); i = j; continue;
    }
    if ('+-*/^%(),'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error('Unexpected character "' + c + '"');
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = take().t; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = take().t; const r = factor();
      if (op === '/') { if (r === 0) throw new Error('Division by zero'); v = v / r; } else v = v * r;
    }
    return v;
  }
  function factor() {
    const b = unary();
    if (peek() && peek().t === '^') { take(); return Math.pow(b, factor()); }
    return b;
  }
  function unary() {
    if (peek() && peek().t === '-') { take(); return -unary(); }
    if (peek() && peek().t === '+') { take(); return unary(); }
    return postfix();
  }
  function postfix() {
    let v = primary();
    while (peek() && peek().t === '%') { take(); v = v / 100; }
    return v;
  }
  function primary() {
    const tk = take();
    if (!tk) throw new Error('Unexpected end of expression');
    if (tk.t === 'num') return tk.v;
    if (tk.t === '(') { const v = expr(); const c = take(); if (!c || c.t !== ')') throw new Error('Missing )'); return v; }
    if (tk.t === 'id') {
      const fn = CALC_FN[tk.v];
      if (!fn) throw new Error('Unknown name "' + tk.v + '"');
      const o = take();
      if (!o || o.t !== '(') throw new Error('Expected ( after ' + tk.v);
      const args = [];
      if (peek() && peek().t === ')') take();
      else for (;;) {
        args.push(expr());
        const n = take();
        if (!n) throw new Error('Missing )');
        if (n.t === ')') break;
        if (n.t !== ',') throw new Error('Expected , or )');
      }
      return fn(...args);
    }
    throw new Error('Unexpected token "' + tk.t + '"');
  }
  const result = expr();
  if (pos < tokens.length) throw new Error('Unexpected "' + (tokens[pos].v ?? tokens[pos].t) + '" after the expression');
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number');
  return result;
}

// ── An expense row, validated ────────────────────────────────────────────────
// Modelled on paymentBuildRow: the rules for currency and rate are the ledger's,
// because an expense that does not record its own rate cannot be reconciled.
function expenseBuildRow(body) {
  const b = body || {};
  const amount = num(b.amount);
  if (!(amount > 0)) return { error: 'Amount must be greater than zero.' };
  const category = EXPENSE_CATEGORY_KEYS.includes(b.category) ? b.category : 'other';
  const currency = CURRENCIES.includes(String(b.currency || '').toUpperCase())
    ? String(b.currency).toUpperCase() : BASE_CURRENCY;
  let fx = currency === BASE_CURRENCY ? 1 : num(b.fx_rate);
  if (!(fx > 0)) {
    if (currency !== BASE_CURRENCY) return { error: `A ${currency} expense needs the rate it was converted at.` };
    fx = 1;
  }
  const spent_on = dayOf(b.spent_on) || todayStr();
  // One {url,name,size,type} through the same allowlist a task attachment goes
  // through — the URL must be one our own upload route returned.
  const receipt = sanitizeAttachments(b.receipt ? [b.receipt] : [])[0] || {};
  return {
    row: {
      spent_on, category,
      description: str(b.description, 300),
      vendor: str(b.vendor, 120),
      amount: round2(amount), currency, fx_rate: fx, amount_base: round2(amount * fx),
      method: PAYMENT_METHODS.includes(b.method) ? b.method : '',
      reference: str(b.reference, 120),
      receipt,
      notes: str(b.notes, 1000),
    },
  };
}

// ── The printed report ───────────────────────────────────────────────────────
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (Math.round(Number(n) || 0)).toLocaleString('en-US');
// The same small markdown subset the Help centre renders: ## heading, - bullet,
// 1. numbered, **bold**. Everything is escaped first.
function markdownToHtml(md) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } };
  const inline = s => escHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (/^#{1,3}\s/.test(line)) { close(); out.push('<h2>' + inline(line.replace(/^#{1,3}\s+/, '')) + '</h2>'); }
    else if (/^[-*]\s/.test(line)) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(line.slice(2)) + '</li>'); }
    else if (/^\d+[.)]\s/.test(line)) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(line.replace(/^\d+[.)]\s+/, '')) + '</li>'); }
    else if (!line) close();
    else { close(); out.push('<p>' + inline(line) + '</p>'); }
  }
  close();
  return out.join('\n');
}
const REPORT_LABELS = {
  en: { title: 'Finance report', period: 'Period', generated: 'Generated', cash_in: 'Cash in', cash_out: 'Cash out', net_cash: 'Net cash',
    revenue: 'Revenue (cash)', cogs: 'Cost of vehicles (supplier, freight, customs)', gross: 'Gross margin', opex: 'Operating expenses',
    net: 'Net result', receivables: 'Receivables outstanding', overdue: 'of which overdue', narrative: 'Analysis', cash_month: 'Cash by month',
    month: 'Month', in: 'In', out: 'Out', net_col: 'Net', opex_cat: 'Expenses by category', category: 'Category', amount: 'Amount', count: 'Count',
    aging: 'Receivables aging', bucket: 'Bucket', sales: 'Sales', top_recv: 'Largest open balances', client: 'Client', vehicle: 'Vehicle',
    agreed: 'Agreed', received: 'Received', outstanding: 'Outstanding', due: 'Due', days: 'Days overdue', top_clients: 'Top paying clients',
    no_ai: 'No AI narrative was generated for this report (no AI provider was configured). The figures above stand on their own.',
    footer: 'All amounts in EGP unless stated. Figures are company-wide and were computed from the ledger, the sales register, purchase orders and the expenses table at the moment the report was generated.' },
  ar: { title: 'التقرير المالي', period: 'الفترة', generated: 'تاريخ الإصدار', cash_in: 'النقد الوارد', cash_out: 'النقد الصادر', net_cash: 'صافي النقد',
    revenue: 'الإيرادات (نقدي)', cogs: 'تكلفة السيارات (المورد، الشحن، الجمارك)', gross: 'هامش الربح الإجمالي', opex: 'المصروفات التشغيلية',
    net: 'صافي النتيجة', receivables: 'المستحقات القائمة', overdue: 'منها متأخر', narrative: 'التحليل', cash_month: 'النقد حسب الشهر',
    month: 'الشهر', in: 'وارد', out: 'صادر', net_col: 'الصافي', opex_cat: 'المصروفات حسب الفئة', category: 'الفئة', amount: 'المبلغ', count: 'العدد',
    aging: 'أعمار المستحقات', bucket: 'الشريحة', sales: 'المبيعات', top_recv: 'أكبر الأرصدة المفتوحة', client: 'العميل', vehicle: 'السيارة',
    agreed: 'المتفق عليه', received: 'المحصّل', outstanding: 'المتبقي', due: 'الاستحقاق', days: 'أيام التأخير', top_clients: 'أكثر العملاء سداداً',
    no_ai: 'لم يتم إنشاء تحليل بالذكاء الاصطناعي لهذا التقرير (لم يُضبط أي مزوّد ذكاء اصطناعي). الأرقام أعلاه كافية بذاتها.',
    footer: 'جميع المبالغ بالجنيه المصري ما لم يُذكر غير ذلك. الأرقام على مستوى الشركة وحُسبت من دفتر المدفوعات وسجل المبيعات وأوامر الشراء وجدول المصروفات لحظة إصدار التقرير.' },
};
function buildFinanceReportHtml(row, opts) {
  const r = row || {};
  const o = opts || {};
  const lang = r.lang === 'ar' ? 'ar' : 'en';
  const L = REPORT_LABELS[lang];
  const p = (r.pack && typeof r.pack === 'object') ? r.pack : {};
  const cash = p.cash || {}, rev = p.revenue || {}, cogs = p.cogs || {}, gm = p.gross_margin || {}, opex = p.opex || {}, recv = p.receivables || {};
  const logo = /^https:\/\//.test(String(o.logoUrl || '')) ? `<img src="${escHtml(o.logoUrl)}" alt="" style="height:38px">` : '';
  const kpi = (label, value, cls) => `<div class="kpi ${cls || ''}"><div class="kl">${escHtml(label)}</div><div class="kv">EGP ${money(value)}</div></div>`;
  const tr = cells => '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
  const th = cells => '<tr>' + cells.map(c => `<th>${escHtml(c)}</th>`).join('') + '</tr>';
  const generated = String(r.created_at || new Date().toISOString()).slice(0, 10);
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#141414;margin:0;padding:28px 34px;font-size:12px;line-height:1.5}
  .head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #c9a35e;padding-bottom:12px;margin-bottom:18px}
  h1{font-size:22px;margin:0;letter-spacing:.2px} .sub{color:#666;font-size:11px;margin-top:3px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 18px}
  .kpi{border:1px solid #e3e0d8;border-radius:8px;padding:9px 11px} .kl{font-size:9.5px;text-transform:uppercase;letter-spacing:.6px;color:#777}
  .kv{font-size:15px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums} .kpi.neg .kv{color:#b3261e} .kpi.pos .kv{color:#1e6b2a}
  h2{font-size:14px;margin:20px 0 8px;color:#8a6d2f;border-bottom:1px solid #eee;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;margin:6px 0 14px;page-break-inside:auto} th,td{border-bottom:1px solid #eee;padding:5px 7px;text-align:${lang === 'ar' ? 'right' : 'left'};vertical-align:top}
  th{background:#faf7f0;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:#555} td.n,th.n{text-align:${lang === 'ar' ? 'left' : 'right'};font-variant-numeric:tabular-nums}
  .narr p,.narr li{font-size:12px} .narr h2{margin-top:14px} .muted{color:#777;font-style:italic}
  .foot{margin-top:22px;border-top:1px solid #e3e0d8;padding-top:8px;font-size:10px;color:#777}
</style></head><body>
<div class="head"><div><h1>${escHtml(L.title)}</h1><div class="sub">${escHtml(L.period)}: ${escHtml(r.period_label || `${r.period_from} → ${r.period_to}`)} · ${escHtml(L.generated)}: ${escHtml(generated)}</div></div>${logo}</div>
<div class="kpis">
  ${kpi(L.cash_in, cash.in)}${kpi(L.cash_out, cash.out)}${kpi(L.net_cash, cash.net, (cash.net || 0) < 0 ? 'neg' : 'pos')}${kpi(L.revenue, rev.cash)}
  ${kpi(L.cogs, cogs.total)}${kpi(L.gross, gm.amount, (gm.amount || 0) < 0 ? 'neg' : '')}${kpi(L.opex, opex.total)}${kpi(L.net, p.net_result, (p.net_result || 0) < 0 ? 'neg' : 'pos')}
</div>
<div class="kpis" style="grid-template-columns:repeat(2,1fr)">${kpi(L.receivables, recv.outstanding)}${kpi(L.overdue, recv.overdue, (recv.overdue || 0) > 0 ? 'neg' : '')}</div>
<h2>${escHtml(L.narrative)}</h2>
<div class="narr">${String(r.narrative || '').trim() ? markdownToHtml(r.narrative) : `<p class="muted">${escHtml(L.no_ai)}</p>`}</div>
<h2>${escHtml(L.cash_month)}</h2>
<table>${th([L.month, L.in, L.out, L.net_col])}${arr(cash.by_month).map(m => tr([escHtml(m.month), `<span class="n">${money(m.in)}</span>`, `<span class="n">${money(m.out)}</span>`, `<span class="n">${money(m.net)}</span>`])).join('')}</table>
<h2>${escHtml(L.opex_cat)}</h2>
<table>${th([L.category, L.count, L.amount])}${arr(opex.by_category).map(c => tr([escHtml(c.label), String(c.count), money(c.amount)])).join('') || tr(['—', '0', '0'])}</table>
<h2>${escHtml(L.aging)}</h2>
<table>${th([L.bucket, L.sales, L.amount])}${Object.values(recv.aging || {}).map(b => tr([escHtml(b.label), String(b.count), money(b.amount)])).join('')}</table>
<h2>${escHtml(L.top_recv)}</h2>
<table>${th([L.client, L.vehicle, L.agreed, L.received, L.outstanding, L.due, L.days])}${arr(recv.rows).slice(0, 12).map(x => tr([escHtml(x.client || '—'), escHtml(x.vehicle || '—'), money(x.agreed_price), money(x.received), money(x.outstanding), escHtml(x.due || '—'), String(x.days_overdue || 0)])).join('') || tr(['—', '', '', '', '', '', ''])}</table>
<h2>${escHtml(L.top_clients)}</h2>
<table>${th([L.client, L.received])}${arr(p.top_clients).map(c => tr([escHtml(c.client), money(c.received)])).join('') || tr(['—', '0'])}</table>
<div class="foot">${escHtml(L.footer)}</div>
</body></html>`;
}

module.exports = {
  num, round2, dayOf, monthOf, inRange, addMonths, monthStart, monthEnd, monthsBetween, monthLabel, reportRangeFor,
  agreedPrice, daysOverdue, agingBucket, AGING_BUCKETS, salePosition, buildFinancePack, trimPack,
  financeQuery, QUERY_NAMES, safeCalc, expenseBuildRow, markdownToHtml, buildFinanceReportHtml, DEFINITIONS,
};
