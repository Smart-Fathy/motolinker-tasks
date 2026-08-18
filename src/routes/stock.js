// Car Stock (immediate-delivery inventory)
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, parseCSV, receiver, requireAuth, requireEmployeeAuth, supabase, upload } = ctx.need('express', 'parseCSV', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase', 'upload');
const requirePerm = (...a) => ctx.requirePerm(...a);
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.

// ─── Car Stock (immediate-delivery inventory) ───────────────────────────────────
// A CRM-owned list of vehicles physically in stock for immediate delivery. One row
// per make+model+trim (a model may carry several trims); each physical car is a
// unit with its own VIN, and `quantity` is derived from them. `price` = per car. Separate from the read-only website inventory picker.
// Spec sheet shown on each car card. Keys are stable; labels drive the UI/CSV.
const STOCK_CSV_HEADERS = ['make', 'model', 'trim', 'price', 'units', 'notes'];

// Individual physical cars held against a model row. Accepts the UI's array form
// or a CSV cell like "VIN123:White:in_logistics | VIN124:Black:delivered".
function parseStockUnits(val) {
  const one = u => ({
    consignee:  String(u.consignee  ?? '').trim(),
    colour:     String(u.colour     ?? u.color ?? '').trim(),
    vin:        String(u.vin        ?? '').trim().toUpperCase(),
    status:     ctx.PO_LINE_STATUS_KEYS.includes(u.status) ? u.status : 'send_to_supplier',
    price_list: Number(String(u.price_list ?? '').replace(/[^\d.]/g, '')) || 0,
    discounted: Number(String(u.discounted ?? '').replace(/[^\d.]/g, '')) || 0,
    logistics:  String(u.logistics  ?? '').trim(),
    supplier:   String(u.supplier   ?? '').trim(),
  });
  if (Array.isArray(val)) {
    return val.map(one).filter(u => u.vin || u.consignee || u.colour || u.supplier);
  }
  const s = String(val || '').trim();
  if (!s) return [];
  return s.split(/\s*\|\s*/).map(part => {
    const [vin, colour, status] = part.split(':');
    return one({ vin, colour, status: String(status || '').trim() });
  }).filter(u => u.vin || u.colour);
}

function stockBuildRow(body) {
  const b = body || {};
  const make = String(b.make || '').trim();
  const model = String(b.model || '').trim();
  if (!make) return { error: 'Make is required' };
  if (!model) return { error: 'Model is required' };
  const priceNum = Number(String(b.price ?? '').replace(/[^\d.]/g, ''));

  const units = parseStockUnits(b.units);
  // Every car has its own VIN, so the cars themselves are the count. A typed-in
  // total and per-colour tallies were summaries nobody could trace back to a
  // vehicle; quantity is now derived and the client no longer sends one.
  const quantity = units.length;

  return { row: {
    make, model,
    trim: String(b.trim || '').trim(),
    price: (isFinite(priceNum) && priceNum > 0) ? priceNum : 0,
    quantity,
    units,
    notes: String(b.notes || '').trim(),
    // Once real cars are listed the pre-migration figure has served its purpose
    legacy_count: units.length ? null : (b.legacy_count ?? undefined),
  } };
}

// How many cars are actually recorded, and how many the old count claimed. Used
// by the UI to prompt for VINs that were never captured.
function stockUnitGaps(row) {
  const units = Array.isArray(row?.units) ? row.units : [];
  return {
    counted: units.length,
    missingVin: units.filter(u => !String(u.vin || '').trim()).length,
    legacy: units.length ? 0 : (parseInt(row?.legacy_count, 10) || 0),
  };
}

// Until migrations/001 and /003 have been applied the specs/units columns may not
// exist. (colors is still named because an old database may lack that column too,
// even though nothing writes it any more.)
// Detect that specific failure and retry without them so Car Stock keeps working.
function isMissingColumnErr(err) {
  const m = String((err && (err.message || err.details)) || '');
  return /column .*(colors|units|legacy_count).* does not exist/i.test(m)
      || /could not find the '(colors|units|legacy_count)' column/i.test(m)
      || err?.code === '42703' || err?.code === 'PGRST204';
}
async function stockWrite(row, id) {
  Object.keys(row).forEach(k => { if (row[k] === undefined) delete row[k]; });
  const run = payload => id
    ? supabase.from('stock_vehicles').update(payload).eq('id', id).select().single()
    : supabase.from('stock_vehicles').insert(payload).select().single();
  let res = await run(row);
  if (res.error && isMissingColumnErr(res.error)) {
    console.warn('[stock] units column missing — apply migrations/001 and /003. Saving without it.');
    const { colors, units, legacy_count, ...rest } = row;
    res = await run(rest);
  }
  return res;
}

// Reading the register is mounted for both portals. stock.view was grantable long
// before there was anywhere in the team portal to spend it — the permission
// existed, the page did not, so granting Inventory to a rep did nothing at all.
// Writing stays the admin's: there is no employee mount below this one.
function mountStockReadRoute(base, guard) {
  receiver.router.get(`${base}/stock`, guard, requirePerm('stock', 'browse'), async (_req, res) => {
    const { data, error } = await supabase.from('stock_vehicles').select('*').order('make', { ascending: true }).order('model', { ascending: true }).order('trim', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });
}
mountStockReadRoute('/api/dashboard', requireAuth);
mountStockReadRoute('/api/employee', requireEmployeeAuth);

// Adding and editing a vehicle is grantable now — a team that keeps the register
// could read it but not touch it, which made the Inventory grant half a feature.
// Deleting stays the admin's: a vehicle carries its units, and losing those loses
// the VINs with them.
function mountStockWriteRoutes(base, guard, who) {
  receiver.router.post(`${base}/stock`, guard, requirePerm('stock', 'create'), express.json(), async (req, res) => {
    const { row, error: verr } = stockBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.created_by = who(req);
    const { data, error } = await stockWrite(row, null);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  receiver.router.put(`${base}/stock/:id`, guard, requirePerm('stock', 'edit'), express.json(), async (req, res) => {
    const { row, error: verr } = stockBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.updated_at = new Date().toISOString();
    const { data, error } = await stockWrite(row, req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });
}
mountStockWriteRoutes('/api/dashboard', requireAuth, () => 'dashboard');
mountStockWriteRoutes('/api/employee', requireEmployeeAuth, req => `employee_${req.employee.id}`);

receiver.router.delete('/api/dashboard/stock/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('stock_vehicles').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Downloadable sample CSV template for bulk upload.
receiver.router.get('/api/dashboard/stock/template.csv', requireAuth, (_req, res) => {
  // units = "VIN:Colour:Status | VIN:Colour:Status" — the cars themselves are the
  // count, and each one carries its own colour. A model no longer keeps a list of
  // the colours it is offered in.
  const sample = [
    STOCK_CSV_HEADERS.join(','),
    '"BYD","Seal","Design",1950000,"LGXC76C41P0123456:White:in_logistics | LGXC76C41P0123457:White:delivered","Immediate delivery"',
    '"BYD","Seal","Excellence AWD",2250000,,',
    '"Toyota","Corolla","GLI 1.6",1150000,,',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="car-stock-template.csv"');
  res.send('﻿' + sample); // BOM for Excel
});

// Bulk import stock vehicles from a CSV (make,model,trim,price,quantity,notes).
receiver.router.post('/api/dashboard/stock/bulk', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
  const rows = parseCSV(req.file.buffer.toString('utf-8'));
  if (!rows.length) return res.status(400).json({ error: 'CSV has no data rows' });
  const inserts = [], errors = [];
  rows.forEach((row, i) => {
    const { row: built, error } = stockBuildRow(row);
    if (error) { errors.push(`Row ${i + 2}: ${error}`); return; }
    built.created_by = 'dashboard_bulk';
    inserts.push(built);
  });
  if (!inserts.length) return res.json({ inserted: 0, errors });
  let { data, error } = await supabase.from('stock_vehicles').insert(inserts).select();
  if (error && isMissingColumnErr(error)) {
    console.warn('[stock] units column missing — apply migrations/001 and /003. Importing without it.');
    ({ data, error } = await supabase.from('stock_vehicles')
      .insert(inserts.map(({ colors, units, ...rest }) => rest)).select());
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json({ inserted: data.length, errors });
});


module.exports = {};
