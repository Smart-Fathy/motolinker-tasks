// Vehicle units — one row per physical vehicle, keyed by VIN.
//
// Until now a vehicle existed in three half-shapes: a `units` entry inside a
// stock_vehicles row, a VIN string on a sales row, and a line inside a purchase
// order's `items` JSON. None of them could be pointed at, so "where is this
// chassis and what did it cost us" had no answer. This is the row that answers
// it, and everything else links to it rather than the other way round.
//
// Nothing migrates automatically. The existing shapes keep working; a unit is
// created here and carries stock_id / po_id / sale_id back to whichever of them
// it came from, so the two can coexist while the team moves over.
//
// src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } =
  ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const requirePerm = (...a) => ctx.requirePerm(...a);

const { BASE_CURRENCY, CURRENCIES, UNIT_STATUS_KEYS } = require('../lib/constants');

// These tables arrive with migrations/019, which is applied by hand like every
// other one. A deploy can therefore land before the SQL does, and "relation does
// not exist" is a useless thing to show a salesperson — so it is turned into the
// one instruction that fixes it.
const MISSING_TABLE_RE = /(does not exist|could not find the table|schema cache)/i;
function dbFail(res, error, what) {
  const msg = String((error && (error.message || error.details)) || 'Database error');
  if (MISSING_TABLE_RE.test(msg) && /vehicle_units|payments|shipment_containers|container_units/.test(msg)) {
    return res.status(503).json({ error: `${what} is not set up yet — apply migrations/019_units_payments_tracking.sql.`, migration: '019' });
  }
  return res.status(500).json({ error: msg });
}

const num = v => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v, max) => String(v ?? '').trim().slice(0, max || 200);
const dateOrNull = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);

// A VIN is 17 characters and never contains I, O or Q — those were left out of
// the standard precisely because they read as 1 and 0. Enforced loosely: a
// pre-production unit legitimately has no VIN at all, and a supplier's interim
// reference is better stored than refused. Uppercased so lookups match.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
function normVin(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
}

// What a unit actually cost, landed, in the base currency.
//
// purchase_cost is in purchase_ccy and fx_rate converts it; freight, customs,
// clearing and other are local charges and are already in the base currency. A
// zero fx_rate means nobody has booked a rate yet, so the purchase side is
// reported as unknown rather than as zero — a 0 there would quietly show a
// vehicle as pure profit.
function unitCosts(u) {
  const rate = num(u.fx_rate);
  const purchase = num(u.purchase_cost);
  const local = num(u.freight_cost) + num(u.customs_cost) + num(u.clearing_cost) + num(u.other_cost);
  const known = !(purchase > 0 && rate <= 0);
  return {
    purchase_base: rate > 0 ? Math.round(purchase * rate * 100) / 100 : null,
    local_base: Math.round(local * 100) / 100,
    landed_base: known ? Math.round((purchase * rate + local) * 100) / 100 : null,
    landed_known: known,
    base_currency: BASE_CURRENCY,
  };
}
ctx.unitCosts = unitCosts;

function unitBuildRow(body) {
  const b = body || {};
  const vin = normVin(b.vin);
  if (vin && !VIN_RE.test(vin)) {
    return { error: 'A VIN is 17 characters, letters and digits, with no I, O or Q. Leave it empty until the supplier sends it.' };
  }
  const make = str(b.make, 60);
  const model = str(b.model, 80);
  if (!make) return { error: 'Make is required' };
  if (!model) return { error: 'Model is required' };

  const status = UNIT_STATUS_KEYS.includes(b.status) ? b.status : 'ordered';
  const ccy = CURRENCIES.includes(String(b.purchase_ccy || '').toUpperCase())
    ? String(b.purchase_ccy).toUpperCase() : 'USD';

  const idOrNull = v => (v == null || v === '' ? null : (Number(v) || null));

  const row = {
    vin: vin || null,
    make, model,
    trim: str(b.trim, 80),
    model_year: Number(b.model_year) > 1900 ? Math.floor(Number(b.model_year)) : null,
    colour: str(b.colour ?? b.color, 60),
    colour_int: str(b.colour_int, 60),
    engine_no: str(b.engine_no, 60),
    status,
    supplier_id: idOrNull(b.supplier_id),
    supplier: str(b.supplier, 120),
    po_id: idOrNull(b.po_id),
    stock_id: idOrNull(b.stock_id),
    customer_id: idOrNull(b.customer_id),
    deal_id: idOrNull(b.deal_id),
    sale_id: idOrNull(b.sale_id),
    purchase_ccy: ccy,
    purchase_cost: num(b.purchase_cost),
    fx_rate: num(b.fx_rate),
    freight_cost: num(b.freight_cost),
    customs_cost: num(b.customs_cost),
    clearing_cost: num(b.clearing_cost),
    other_cost: num(b.other_cost),
    ordered_on: dateOrNull(b.ordered_on),
    shipped_on: dateOrNull(b.shipped_on),
    arrived_on: dateOrNull(b.arrived_on),
    delivered_on: dateOrNull(b.delivered_on),
    location: str(b.location, 160),
    notes: str(b.notes, 2000),
  };
  row.custom_fields = ctx.gridExtras(b, { ...row, color: 1, id: 1, created_by: 1, created_at: 1, updated_at: 1, custom_fields: 1 });
  return { row };
}

// A duplicate VIN is the single most likely write failure here — two people
// entering the same arrival — and Postgres reports it as a constraint name that
// means nothing to anybody outside this file.
function unitWriteError(error) {
  const m = String((error && (error.message || error.details)) || '');
  if (/vehicle_units_vin_uq|duplicate key/i.test(m) && /vin/i.test(m)) {
    return 'That VIN is already on another unit.';
  }
  return null;
}

// ── Read ──────────────────────────────────────────────────────────────────────
function mountUnitReads(base, guard) {
  receiver.router.get(`${base}/units`, guard, requirePerm('stock', 'units'), async (req, res) => {
    let q = supabase.from('vehicle_units').select('*');
    const status = String(req.query.status || '').trim();
    if (status && UNIT_STATUS_KEYS.includes(status)) q = q.eq('status', status);
    for (const [param, col] of [['customer_id', 'customer_id'], ['po_id', 'po_id'], ['sale_id', 'sale_id'], ['stock_id', 'stock_id']]) {
      const v = Number(req.query[param]);
      if (v > 0) q = q.eq(col, v);
    }
    const search = String(req.query.q || '').trim();
    if (search) {
      // PostgREST's `or` takes a comma-separated filter list; a comma or a
      // parenthesis inside the term would end the list early, so they go.
      const safe = search.replace(/[(),*]/g, ' ').trim();
      if (safe) q = q.or(`vin.ilike.%${safe}%,make.ilike.%${safe}%,model.ilike.%${safe}%,trim.ilike.%${safe}%,supplier.ilike.%${safe}%`);
    }
    const { data, error } = await q.order('created_at', { ascending: false }).limit(1000);
    if (error) return dbFail(res, error, 'The vehicle register');
    res.json((data || []).map(u => ({ ...u, costs: unitCosts(u) })));
  });

  // One unit and everything hanging off it: its payments, and the container it
  // is stuffed in. Both are best-effort — a unit is still readable when the
  // ledger or the tracking table is empty or absent.
  receiver.router.get(`${base}/units/:id`, guard, requirePerm('stock', 'units'), async (req, res) => {
    const { data, error } = await supabase.from('vehicle_units').select('*').eq('id', req.params.id).single();
    if (error) return dbFail(res, error, 'The vehicle register');
    if (!data) return res.status(404).json({ error: 'Not found' });

    let payments = [];
    try {
      const r = await supabase.from('payments').select('*').eq('unit_id', data.id).order('paid_on', { ascending: false });
      payments = r.data || [];
    } catch (_) { /* ledger not applied yet */ }

    let container = null;
    try {
      const link = await supabase.from('container_units').select('container_id').eq('unit_id', data.id).limit(1);
      const cid = link.data && link.data[0] && link.data[0].container_id;
      if (cid) {
        const c = await supabase.from('shipment_containers').select('*').eq('id', cid).single();
        container = c.data || null;
      }
    } catch (_) { /* tracking not applied yet */ }

    res.json({ ...data, costs: unitCosts(data), payments, container });
  });
}
mountUnitReads('/api/dashboard', requireAuth);
mountUnitReads('/api/employee', requireEmployeeAuth);

// ── Write ─────────────────────────────────────────────────────────────────────
// Creating and editing follow the Inventory grants they already use for a stock
// row. Deleting stays the admin's: a unit carries its cost history and is
// referenced by payments and by a container.
function mountUnitWrites(base, guard, who) {
  receiver.router.post(`${base}/units`, guard, requirePerm('stock', 'create'), express.json(), async (req, res) => {
    const { row, error: verr } = unitBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.created_by = who(req);
    const { data, error } = await supabase.from('vehicle_units').insert(row).select().single();
    if (error) return res.status(400).json({ error: unitWriteError(error) || error.message });
    res.json({ ...data, costs: unitCosts(data) });
  });

  receiver.router.put(`${base}/units/:id`, guard, requirePerm('stock', 'edit'), express.json(), async (req, res) => {
    const { row, error: verr } = unitBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('vehicle_units').update(row).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: unitWriteError(error) || error.message });
    res.json({ ...data, costs: unitCosts(data) });
  });
}
mountUnitWrites('/api/dashboard', requireAuth, () => 'dashboard');
mountUnitWrites('/api/employee', requireEmployeeAuth, req => `employee_${req.employee.id}`);

receiver.router.delete('/api/dashboard/units/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('vehicle_units').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error, 'The vehicle register');
  res.json({ ok: true });
});

module.exports = { unitCosts, normVin, VIN_RE, dbFail, unitBuildRow };
