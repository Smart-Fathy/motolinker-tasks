// The payments ledger.
//
// A sale used to carry three numbers — price_list, down_payment, remaining — and
// nothing else. That records a position, not a history: it cannot say when the
// money came, who took it, what the receipt was, or what the rate was on the
// day. `remaining` in particular was a typed-in figure that nothing recomputed,
// so it drifted the first time somebody paid in two instalments.
//
// Here every movement is a row. The sale's position is DERIVED from them —
// `summary` below is the only place that arithmetic lives, and both portals and
// the Sales tab read it rather than doing their own. The legacy columns are left
// alone: a sale that has no payment rows yet still reads the way it always did,
// which is what lets the team move over one sale at a time.
//
// src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } =
  ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const requirePerm = (...a) => ctx.requirePerm(...a);

const { BASE_CURRENCY, CURRENCIES, PAYMENT_KINDS, PAYMENT_KIND_KEYS,
  PAYMENT_METHODS, PAYMENT_DIRECTIONS, sanitizeAttachments } = require('../lib/constants');
const { dbFail } = require('./vehicle-units');

const num = v => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v, max) => String(v ?? '').trim().slice(0, max || 200);
const round2 = n => Math.round(n * 100) / 100;

function paymentBuildRow(body) {
  const b = body || {};
  const amount = num(b.amount);
  if (!(amount > 0)) return { error: 'Amount must be greater than zero.' };

  const kind = PAYMENT_KIND_KEYS.includes(b.kind) ? b.kind : 'instalment';
  // Direction defaults to whichever way this kind of payment normally moves, so
  // recording a supplier payment does not need two fields set correctly.
  const kindDef = PAYMENT_KINDS.find(k => k.key === kind);
  const direction = PAYMENT_DIRECTIONS.includes(b.direction) ? b.direction : (kindDef ? kindDef.dir : 'in');

  const currency = CURRENCIES.includes(String(b.currency || '').toUpperCase())
    ? String(b.currency).toUpperCase() : BASE_CURRENCY;
  // A payment already in the base currency is rate 1 whatever the form sent;
  // anything else must state its rate, because the base figure is stored and a
  // missing rate would silently book the payment as worthless.
  let fx = currency === BASE_CURRENCY ? 1 : num(b.fx_rate);
  if (!(fx > 0)) {
    if (currency !== BASE_CURRENCY) return { error: `A ${currency} payment needs the rate it was converted at.` };
    fx = 1;
  }

  const paid_on = /^\d{4}-\d{2}-\d{2}$/.test(String(b.paid_on || '').trim())
    ? String(b.paid_on).trim() : new Date().toISOString().slice(0, 10);

  const idOrNull = v => (v == null || v === '' ? null : (Number(v) || null));
  // One {url,name,size,type} through the same allowlist a task attachment goes
  // through — the URL must be one our own upload route returned, or the column
  // becomes a place to park a link that something later renders.
  const receipt = sanitizeAttachments(b.receipt ? [b.receipt] : [])[0] || {};

  return {
    row: {
      sale_id: idOrNull(b.sale_id),
      unit_id: idOrNull(b.unit_id),
      customer_id: idOrNull(b.customer_id),
      direction,
      kind,
      method: PAYMENT_METHODS.includes(b.method) ? b.method : '',
      amount: round2(amount),
      currency,
      fx_rate: fx,
      amount_base: round2(amount * fx),
      paid_on,
      reference: str(b.reference, 120),
      receipt,
      notes: str(b.notes, 1000),
    },
  };
}

// The one piece of payment arithmetic in the codebase.
//
// `price` is what the sale is for, in the base currency. Everything in is money
// received from the customer; everything out (a refund) comes back off it.
// Supplier-side payments are counted separately — they are cost, not settlement
// — so that "the customer still owes 200,000" cannot be confused by a freight
// invoice being paid on the same day.
const CUSTOMER_SIDE = new Set(['reservation', 'down_payment', 'instalment', 'final', 'refund']);
function summary(payments, price, today) {
  const rows = Array.isArray(payments) ? payments : [];
  let received = 0, refunded = 0, costs = 0;
  for (const p of rows) {
    const base = num(p.amount_base) || num(p.amount) * (num(p.fx_rate) || 1);
    if (!CUSTOMER_SIDE.has(p.kind)) { costs += base; continue; }
    if (p.direction === 'out' || p.kind === 'refund') refunded += base;
    else received += base;
  }
  const net = round2(received - refunded);
  const total = round2(num(price));
  const outstanding = round2(Math.max(0, total - net));
  const last = rows
    .filter(p => CUSTOMER_SIDE.has(p.kind))
    .map(p => p.paid_on).filter(Boolean).sort().slice(-1)[0] || null;
  return {
    base_currency: BASE_CURRENCY,
    price: total,
    received: round2(received),
    refunded: round2(refunded),
    net,
    outstanding,
    // Guard the divide: a sale with no price yet is 0% collected, not NaN%.
    collected_pct: total > 0 ? Math.min(100, Math.round((net / total) * 100)) : 0,
    settled: total > 0 && outstanding <= 0,
    supplier_costs: round2(costs),
    payment_count: rows.length,
    last_payment_on: last,
    // Filled in by the caller when it knows the due date, so this function stays
    // pure and testable.
    days_overdue: 0,
    as_of: today || new Date().toISOString().slice(0, 10),
  };
}

// How late the remaining balance is, in whole days. Zero when nothing is owed or
// no due date was set — an unsettled sale with no due date is not overdue, it is
// unscheduled, and reporting it as overdue by 20,000 days is how nobody trusts
// the number again.
function daysOverdue(dueStr, outstanding, today) {
  if (!(outstanding > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(dueStr || ''))) return 0;
  const due = Date.parse(dueStr + 'T00:00:00Z');
  const now = Date.parse((today || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  if (!Number.isFinite(due) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((now - due) / 864e5));
}

ctx.paymentSummary = summary;

// ── Read ──────────────────────────────────────────────────────────────────────
function mountPaymentReads(base, guard) {
  // The ledger for one sale, with the position derived from it. The sale row is
  // read here rather than sent by the client so the price the percentage is
  // measured against cannot be spoofed by the caller.
  receiver.router.get(`${base}/sales/:id/payments`, guard, requirePerm('deals', 'payments'), async (req, res) => {
    const saleId = Number(req.params.id);
    if (!(saleId > 0)) return res.status(400).json({ error: 'Bad sale id' });

    const sale = await supabase.from('sales').select('id,price_list,discounted,remaining_due,client').eq('id', saleId).single();
    if (sale.error) return dbFail(res, sale.error, 'Sales');

    const { data, error } = await supabase.from('payments').select('*').eq('sale_id', saleId)
      .order('paid_on', { ascending: false }).order('id', { ascending: false });
    if (error) return dbFail(res, error, 'The payments ledger');

    // What the customer actually agreed to pay: the discounted figure when one
    // was given, the list price otherwise. A zero discount means no discount.
    const price = Number(sale.data.discounted) > 0 ? sale.data.discounted : sale.data.price_list;
    const s = summary(data || [], price);
    s.days_overdue = daysOverdue(sale.data.remaining_due, s.outstanding);
    res.json({ sale: sale.data, payments: data || [], summary: s });
  });

  // Everything, newest first — the ledger as its own page, and what a receivables
  // report will read. Capped rather than paged: this is a few thousand rows a
  // year, and an unbounded select against Supabase is how a page hangs.
  receiver.router.get(`${base}/payments`, guard, requirePerm('deals', 'payments'), async (req, res) => {
    let q = supabase.from('payments').select('*');
    const dir = String(req.query.direction || '').trim();
    if (PAYMENT_DIRECTIONS.includes(dir)) q = q.eq('direction', dir);
    const cust = Number(req.query.customer_id);
    if (cust > 0) q = q.eq('customer_id', cust);
    const from = String(req.query.from || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte('paid_on', from);
    const to = String(req.query.to || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lte('paid_on', to);
    const { data, error } = await q.order('paid_on', { ascending: false }).limit(2000);
    if (error) return dbFail(res, error, 'The payments ledger');
    res.json(data || []);
  });
}
mountPaymentReads('/api/dashboard', requireAuth);
mountPaymentReads('/api/employee', requireEmployeeAuth);

// ── Write ─────────────────────────────────────────────────────────────────────
function mountPaymentWrites(base, guard, who) {
  receiver.router.post(`${base}/payments`, guard, requirePerm('deals', 'paymentsEdit'), express.json(), async (req, res) => {
    const { row, error: verr } = paymentBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    if (!row.sale_id && !row.unit_id && !row.customer_id) {
      return res.status(400).json({ error: 'A payment has to belong to a sale, a unit or a customer.' });
    }
    row.recorded_by = who(req);
    const { data, error } = await supabase.from('payments').insert(row).select().single();
    if (error) return dbFail(res, error, 'The payments ledger');
    res.json(data);
  });

  receiver.router.put(`${base}/payments/:id`, guard, requirePerm('deals', 'paymentsEdit'), express.json(), async (req, res) => {
    const { row, error: verr } = paymentBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('payments').update(row).eq('id', req.params.id).select().single();
    if (error) return dbFail(res, error, 'The payments ledger');
    res.json(data);
  });

  // Deleting a payment is deleting evidence that money moved, so it is the
  // admin's alone — an employee who mistyped one edits it.
  if (base === '/api/dashboard') {
    receiver.router.delete(`${base}/payments/:id`, guard, async (req, res) => {
      const { error } = await supabase.from('payments').delete().eq('id', req.params.id);
      if (error) return dbFail(res, error, 'The payments ledger');
      res.json({ ok: true });
    });
  }
}
mountPaymentWrites('/api/dashboard', requireAuth, () => 'dashboard');
mountPaymentWrites('/api/employee', requireEmployeeAuth, req => `employee_${req.employee.id}`);

module.exports = { paymentSummary: summary, daysOverdue, paymentBuildRow };
