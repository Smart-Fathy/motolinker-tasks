// Supplier catalogue, documents and purchase history
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { driveUpload, driveUploadGuard, express, handleDriveUpload, receiver, requireAuth, supabase } = ctx.need('driveUpload', 'driveUploadGuard', 'express', 'handleDriveUpload', 'receiver', 'requireAuth', 'supabase');

// ─── Supplier catalogue, documents and purchase history ───────────────────────
// Three different things, deliberately kept apart:
//   supplier_vehicles — what they OFFER (quoted price, quoted lead time)
//   supplier_docs     — the paperwork, stored in Drive
//   purchases         — what we actually BOUGHT, derived from stock units and PO
//                       lines. Never typed in, so it cannot drift from reality.

const SUPPLIER_VEHICLE_FIELDS = ['brand', 'model', 'trim', 'model_year', 'availability',
  'fob_price', 'currency', 'lead_time', 'accessories', 'notes'];

function supplierVehicleRow(body, supplierId) {
  const b = body || {};
  const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n ? n : null; };
  const row = {
    supplier_id: supplierId,
    brand: String(b.brand || '').trim(),
    model: String(b.model || '').trim(),
    trim: String(b.trim || '').trim(),
    model_year: (() => { const y = parseInt(b.model_year, 10); return y >= 1900 && y <= 2100 ? y : null; })(),
    availability: String(b.availability || '').trim(),
    fob_price: num(b.fob_price),
    currency: String(b.currency || 'USD').trim().slice(0, 8) || 'USD',
    lead_time: String(b.lead_time || '').trim(),
    accessories: String(b.accessories || '').trim(),
    notes: String(b.notes || '').trim(),
  };
  if (!row.brand && !row.model) return { error: 'Brand or model is required' };
  return { row };
}

// Everything actually bought from this supplier: the individual cars held against
// stock rows, plus the lines of any purchase order pointed at them.
async function supplierPurchases(supplierId) {
  const id = Number(supplierId);
  const [{ data: stock }, { data: pos }, { data: sup }] = await Promise.all([
    supabase.from('stock_vehicles').select('id,make,model,trim,units'),
    supabase.from('purchase_orders').select('id,po_number,po_date,supplier,supplier_id,currency,items'),
    supabase.from('suppliers').select('id,name').eq('id', id).single(),
  ]);
  const name = String((sup || {}).name || '').trim().toLowerCase();
  // supplier_id is authoritative; the free-text name is only a fallback for rows
  // the migration could not match confidently.
  const mine = u => String(u.supplier_id || '') === String(id)
    || (!u.supplier_id && name && String(u.supplier || '').trim().toLowerCase() === name);

  const units = [];
  for (const row of stock || []) {
    for (const u of Array.isArray(row.units) ? row.units : []) {
      if (!mine(u)) continue;
      units.push({
        stock_id: row.id, make: row.make, model: row.model, trim: row.trim,
        vin: u.vin || '', colour: u.colour || '', status: u.status || '',
        price: Number(u.discounted) || Number(u.price_list) || 0,
      });
    }
  }

  const poLines = [];
  for (const po of pos || []) {
    const matches = String(po.supplier_id || '') === String(id)
      || (!po.supplier_id && name && String(po.supplier || '').trim().toLowerCase() === name);
    if (!matches) continue;
    for (const it of Array.isArray(po.items) ? po.items : []) {
      poLines.push({
        po_id: po.id, po_number: po.po_number, po_date: po.po_date, currency: po.currency,
        brand: it.brand || '', model: it.model || '', trim: it.trim || '',
        qty: Number(it.qty) || 1,
        price: Number(String(it.fob_price ?? it.price ?? '').replace(/[^\d.]/g, '')) || 0,
        lead_time: it.lead_time || '',
      });
    }
  }

  const priced = units.filter(u => u.price > 0);
  const poPriced = poLines.filter(l => l.price > 0);
  const avg = rows => rows.length ? Math.round(rows.reduce((s, r) => s + r.price, 0) / rows.length) : 0;
  return {
    units, poLines,
    totals: {
      vehicles: units.length,
      ordered: poLines.reduce((s, l) => s + l.qty, 0),
      avg_unit_price: avg(priced),
      avg_po_price: avg(poPriced),
      lead_times: [...new Set(poLines.map(l => l.lead_time).filter(Boolean))],
    },
  };
}

// ── Catalogue ──
receiver.router.get('/api/dashboard/suppliers/:id/vehicles', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('supplier_vehicles').select('*')
    .eq('supplier_id', req.params.id).order('brand').order('model');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
receiver.router.post('/api/dashboard/suppliers/:id/vehicles', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = supplierVehicleRow(req.body, parseInt(req.params.id));
  if (verr) return res.status(400).json({ error: verr });
  const { data, error } = await supabase.from('supplier_vehicles').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.put('/api/dashboard/suppliers/:id/vehicles/:vid', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = supplierVehicleRow(req.body, parseInt(req.params.id));
  if (verr) return res.status(400).json({ error: verr });
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('supplier_vehicles').update(row)
    .eq('id', req.params.vid).eq('supplier_id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.delete('/api/dashboard/suppliers/:id/vehicles/:vid', requireAuth, async (req, res) => {
  const { error } = await supabase.from('supplier_vehicles').delete()
    .eq('id', req.params.vid).eq('supplier_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Every vehicle any supplier offers — feeds the RFQ and PO item pickers, so those
// stop being free text.
receiver.router.get('/api/dashboard/supplier-vehicles', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('supplier_vehicles')
    .select('*, suppliers(name)').order('brand').order('model').limit(1000);
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(v => ({ ...v, supplier_name: v.suppliers?.name || '' })));
});

// ── Documents (Drive-backed) ──
receiver.router.get('/api/dashboard/suppliers/:id/docs', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('supplier_docs').select('*')
    .eq('supplier_id', req.params.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
receiver.router.post('/api/dashboard/suppliers/:id/docs', requireAuth,
  driveUpload.single('file'), driveUploadGuard, async (req, res) => {
    const meta = await handleDriveUpload(req, res, 'Suppliers');
    if (!meta) return;
    const { data, error } = await supabase.from('supplier_docs').insert({
      supplier_id: parseInt(req.params.id), name: meta.name, drive_file_id: meta.fileId,
      web_link: meta.webViewLink, mime_type: meta.mimeType, size_bytes: meta.size,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });
receiver.router.delete('/api/dashboard/suppliers/:id/docs/:docId', requireAuth, async (req, res) => {
  // The row goes; the file stays in Drive on purpose, so a mis-click is recoverable.
  const { error } = await supabase.from('supplier_docs').delete()
    .eq('id', req.params.docId).eq('supplier_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── What we actually bought ──
receiver.router.get('/api/dashboard/suppliers/:id/purchases', requireAuth, async (req, res) => {
  try { res.json(await supplierPurchases(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});


module.exports = {};
