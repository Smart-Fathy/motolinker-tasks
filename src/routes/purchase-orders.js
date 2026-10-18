// Purchase Orders
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, logLeadActivity, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'logLeadActivity', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
// Registered on the context by a module that loads later, so these are looked
// up when called rather than when required.
const renderQuotationPdf = (...a) => ctx.renderQuotationPdf(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);
const { buildPurchaseOrderHtml } = require('../lib/docs/purchase-order');
const { DOC_DEFAULT_ACCESSORIES, DOC_DEFAULT_DOCUMENTS, DOC_DEFAULT_PAYMENT_TERMS } = require('../lib/docs/defaults');

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Purchase Orders ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Mirrors the ordering sheet: one PO holds many vehicle lines, each with its own
// client/consignee, spec, PI price, tracking status, VIN and client-file link.

function poLineStatus(key) {
  return ctx.PO_LINE_STATUSES.find(s => s.key === key) || ctx.PO_LINE_STATUSES[0];
}
const PO_STATUSES = ['draft', 'sent', 'confirmed', 'closed'];

function generatePoNumber() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `PO${y}${m}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

// Normalize one vehicle line from the UI / import.
function poBuildItem(raw, allowed) {
  const r = raw || {};
  // What this save may write in `status`: the po_items Columns editor options,
  // or the built-ins when it defines none. Hard-coding the built-ins meant an
  // admin-added status was silently rewritten to `send_to_supplier`.
  const statusKeys = (Array.isArray(allowed) && allowed.length) ? allowed : ctx.PO_LINE_STATUS_KEYS;
  const num = (v, def = 0) => {
    const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
    return isFinite(n) && n > 0 ? n : def;
  };
  const built = {
    client:       String(r.client || '').trim(),
    consignee:    String(r.consignee || '').trim(),
    units:        Math.max(1, parseInt(String(r.units ?? '1').replace(/[^\d]/g, ''), 10) || 1),
    brand:        String(r.brand || '').trim(),
    model:        String(r.model || '').trim(),
    trim:         String(r.trim || '').trim(),
    color:        String(r.color || '').trim(),
    year:         String(r.year || '').trim(),
    accessories:  String(r.accessories || '').trim(),
    payment_term: String(r.payment_term || '').trim(),
    pi_price:     num(r.pi_price),
    status:       statusKeys.includes(r.status) ? r.status : 'send_to_supplier',
    vin:          String(r.vin || '').trim(),
    file_link:    String(r.file_link || '').trim(),
  };
  // Columns the admin added ride alongside — see ctx.gridExtras.
  return { ...built, ...ctx.gridExtras(r, built) };
}
const PO_ITEM_BUILTINS = { client: 1, consignee: 1, units: 1, brand: 1, model: 1, trim: 1,
  color: 1, year: 1, accessories: 1, payment_term: 1, pi_price: 1, status: 1, vin: 1, file_link: 1 };

// columns.js publishes columnOptionKeys on the context; feature modules load in
// no fixed order, so resolve it per request rather than at require time.
function allowedItemStatuses() {
  return ctx.columnOptionKeys
    ? ctx.columnOptionKeys('po_items', 'status', ctx.PO_LINE_STATUS_KEYS)
    : Promise.resolve(ctx.PO_LINE_STATUS_KEYS);
}

function poBuildRow(body, allowed) {
  const b = body || {};
  const items = (Array.isArray(b.items) ? b.items : []).map(it => poBuildItem(it, allowed))
    .filter(it => it.client || it.brand || it.model || it.vin
      || ctx.hasGridExtras(it, PO_ITEM_BUILTINS));
  return {
    po_number: String(b.po_number || '').trim() || generatePoNumber(),
    title:     String(b.title || '').trim(),
    supplier:  String(b.supplier || '').trim(),
    po_date:   String(b.po_date || '').trim() || null,
    currency:  String(b.currency || 'USD').trim() || 'USD',
    notes:     String(b.notes || '').trim(),
    items,
    customer_id: b.customer_id ? parseInt(b.customer_id) : null,
    status:    PO_STATUSES.includes(b.status) ? b.status : 'draft',
    // Configurable document fields (the po_doc column config) ride here.
    custom_fields: b.custom_fields && typeof b.custom_fields === 'object' ? b.custom_fields : {},
    // Letterhead fields (supplier block + delivery terms) — see buildPurchaseOrderHtml
    supplier_id:        b.supplier_id ? parseInt(b.supplier_id) : null,
    supplier_contact:   String(b.supplier_contact || '').trim(),
    supplier_address:   String(b.supplier_address || '').trim(),
    supplier_country:   String(b.supplier_country || '').trim(),
    issuer:             String(b.issuer || '').trim(),
    quote_id:           String(b.quote_id || '').trim(),
    incoterm:           String(b.incoterm || 'FOB').trim(),
    delivery_location:  String(b.delivery_location || '').trim(),
    service_provider:   String(b.service_provider || '').trim(),
    contact:            String(b.contact || '').trim(),
    documents_required: String(b.documents_required || '').trim(),
    payment_terms:      String(b.payment_terms || '').trim(),
  };
}
function poTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.pi_price) || 0) * (Number(it.units) || 1), 0);
}

// The lead a purchase order is attached to is its client of record. A line that
// names nobody borrows that name rather than printing an empty CLIENT cell.
async function poClientName(po) {
  const id = po && po.customer_id;
  if (!id) return '';
  const { data } = await supabase.from('customers').select('name').eq('id', id).single();
  return String((data && data.name) || '').trim();
}

// Mounted for both portals over one set of handlers — see contracts.js for why.
function mountPurchaseOrderRoutes(base, guard) {
  receiver.router.get(base, guard, requirePerm('purchaseorders', 'view'), async (_req, res) => {
    const { data, error } = await supabase.from('purchase_orders')
      .select('id,po_number,title,supplier,po_date,currency,status,customer_id,items,created_by,created_at')
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  receiver.router.get(`${base}/new/defaults`, guard, requirePerm('purchaseorders', 'create'), async (req, res) => {
    try {
      const customerId = req.query.customer_id ? parseInt(req.query.customer_id) : null;
      const cust = customerId
        ? await supabase.from('customers').select('*').eq('id', customerId).single().then(r => r.data)
        : null;
      // Seed the first line from the lead so the sheet opens partly filled.
      const item = poBuildItem({});
      if (cust) {
        const cf = cust.custom_fields || {};
        const car = String(cf.cf_vehicle_offered || cf.cf_vehicle_requested || cust.car_in_question || '').trim();
        const bits = car.split(/\s+/).filter(Boolean);
        item.client = cust.name || '';
        item.consignee = cust.name || '';
        item.brand = bits[0] || '';
        item.model = bits.slice(1).join(' ') || '';
        item.color = cf.cf_color || '';
        item.year = cf.cf_year || '';
      }
      res.json({
        po_number: generatePoNumber(),
        po_date: new Date().toISOString().slice(0, 10),
        currency: 'USD',
        items: [item],
        customer_id: customerId || null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  receiver.router.get(`${base}/:id`, guard, requirePerm('purchaseorders', 'view'), async (req, res) => {
    const { data, error } = await supabase.from('purchase_orders').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Purchase order not found' });
    res.json(data);
  });

  receiver.router.post(base, guard, requirePerm('purchaseorders', 'create'), express.json({ limit: '2mb' }), async (req, res) => {
    const who = callerIdentity(req);
    const row = poBuildRow(req.body, await allowedItemStatuses());
    row.created_by = who.key;
    const { data, error } = await ctx.writeOptional(
      p => supabase.from('purchase_orders').insert(p).select().single(), row, ['custom_fields']);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
    if (data.customer_id) {
      logLeadActivity(data.customer_id, {
        type: 'note', body: `Purchase order created — ${data.po_number}`,
        meta: { purchase_order_id: data.id, po_number: data.po_number },
        authorKey: who.key, authorName: who.name,
      });
    }
  });

  receiver.router.put(`${base}/:id`, guard, requirePerm('purchaseorders', 'edit'), express.json({ limit: '2mb' }), async (req, res) => {
    const row = poBuildRow(req.body, await allowedItemStatuses());
    row.updated_at = new Date().toISOString();
    delete row.po_number; // immutable once issued
    const { data, error } = await ctx.writeOptional(
      p => supabase.from('purchase_orders').update(p).eq('id', req.params.id).select().single(), row, ['custom_fields']);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  receiver.router.delete(`${base}/:id`, guard, requirePerm('purchaseorders', 'delete'), async (req, res) => {
    const { error } = await supabase.from('purchase_orders').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  receiver.router.post(`${base}/pdf`, guard, requirePerm('purchaseorders', 'export'), express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const r of settingsRows || []) settings[r.key] = r.value;
      const row = poBuildRow(req.body, await allowedItemStatuses());
      const html = buildPurchaseOrderHtml({ ...req.body, ...row, client_name: await poClientName(row), settings });
      const pdf = await renderQuotationPdf(html);   // portrait A4, like the paper form
      res.json({ pdf: Buffer.from(pdf).toString('base64') });
    } catch (e) {
      console.error('[po-pdf]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Render a saved purchase order by id (used by the lead profile's document viewer).
  receiver.router.post(`${base}/:id/pdf`, guard, requirePerm('purchaseorders', 'export'), async (req, res) => {
    try {
      const { data: row, error } = await supabase.from('purchase_orders').select('*').eq('id', req.params.id).single();
      if (error || !row) return res.status(404).json({ error: 'Purchase order not found' });
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const s of settingsRows || []) settings[s.key] = s.value;
      const pdf = await renderQuotationPdf(
        buildPurchaseOrderHtml({ ...row, client_name: await poClientName(row), settings }));
      res.json({ pdf: Buffer.from(pdf).toString('base64'), name: row.po_number || 'purchase-order' });
    } catch (e) {
      console.error('[po-pdf-id]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
mountPurchaseOrderRoutes('/api/dashboard/purchase-orders', requireAuth);
mountPurchaseOrderRoutes('/api/employee/purchase-orders', requireEmployeeAuth);

// The purchase order's look — and the supplier-document chrome it used to share with
// the RFQ — lives in src/lib/docs (brand.js for the identity, purchase-order.js for this
// document). The RFQ is an Excel workbook now (rfq-xlsx.js), so nothing shares it.

module.exports = { DOC_DEFAULT_ACCESSORIES, DOC_DEFAULT_DOCUMENTS, DOC_DEFAULT_PAYMENT_TERMS, buildPurchaseOrderHtml, poClientName };
