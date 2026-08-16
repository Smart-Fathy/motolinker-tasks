// Purchase Orders
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { escHtml, express, logLeadActivity, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('escHtml', 'express', 'logLeadActivity', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
// Registered on the context by a module that loads later, so these are looked
// up when called rather than when required.
const quoteTheme = (...a) => ctx.quoteTheme(...a);
const renderQuotationPdf = (...a) => ctx.renderQuotationPdf(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);
const { BRAND_LOGO_URL } = ctx.need('BRAND_LOGO_URL');

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
function poBuildItem(raw) {
  const r = raw || {};
  const num = (v, def = 0) => {
    const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
    return isFinite(n) && n > 0 ? n : def;
  };
  return {
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
    status:       ctx.PO_LINE_STATUS_KEYS.includes(r.status) ? r.status : 'send_to_supplier',
    vin:          String(r.vin || '').trim(),
    file_link:    String(r.file_link || '').trim(),
  };
}

function poBuildRow(body) {
  const b = body || {};
  const items = (Array.isArray(b.items) ? b.items : []).map(poBuildItem)
    .filter(it => it.client || it.brand || it.model || it.vin);
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
    const row = poBuildRow(req.body);
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
    const row = poBuildRow(req.body);
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
      const html = buildPurchaseOrderHtml({ ...req.body, ...poBuildRow(req.body), settings });
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
      const pdf = await renderQuotationPdf(buildPurchaseOrderHtml({ ...row, settings }));
      res.json({ pdf: Buffer.from(pdf).toString('base64'), name: row.po_number || 'purchase-order' });
    } catch (e) {
      console.error('[po-pdf-id]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
mountPurchaseOrderRoutes('/api/dashboard/purchase-orders', requireAuth);
mountPurchaseOrderRoutes('/api/employee/purchase-orders', requireEmployeeAuth);

// ── Shared letterhead chrome for supplier-facing documents (RFQ + PO) ─────────
// Both reproduce the company's real forms: logo, title, ID/Date/Issuer box, a
// Supplier Details block, the item grid, then Payment and Delivery Terms.
function docChromeCss(T) {
  const GOLD = T.accent, INK = T.ink, SOFT = T.soft;
  return `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial,Helvetica,sans-serif; font-size:9.5px; color:${INK}; background:#fff; }
  .page { width:794px; min-height:1123px; padding:22px 26px 96px; position:relative; }
  .head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:10px; }
  .head img { max-height:44px; width:auto; display:block; }
  .title { font-family:${T.titleFont}; font-size:20px; font-weight:900; letter-spacing:${T.titleSpacing};
           color:${INK}; text-align:center; flex:1; padding-top:8px; }
  table.meta { border-collapse:collapse; }
  table.meta td { border:1px solid ${GOLD}; padding:3px 9px; font-size:9px; }
  table.meta .k { background:${SOFT}; font-weight:700; white-space:nowrap; }
  table.meta .v { font-weight:700; color:#c00; min-width:108px; }
  .sec { margin-top:12px; border:1px solid ${GOLD}; }
  .sec-h { background:${SOFT}; font-family:${T.titleFont}; font-weight:800; font-size:11px;
           padding:5px 10px; border-bottom:1px solid ${GOLD}; }
  .sec-b { padding:8px 10px; line-height:1.9; }
  table.kv { width:100%; border-collapse:collapse; }
  table.kv td { border:1px solid ${GOLD}; padding:4px 9px; font-size:9.5px; }
  table.kv td:first-child { width:26%; font-weight:700; background:#fafafa; }
  table.grid { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:12px; }
  table.grid th { background:${INK}; color:#fff; font-family:${T.titleFont}; font-size:8.5px;
                  padding:6px 4px; border:1px solid ${GOLD}; text-align:center; }
  table.grid td { border:1px solid ${GOLD}; padding:6px 5px; vertical-align:middle; word-wrap:break-word; min-height:26px; }
  td.c { text-align:center; } td.r { text-align:right; }
  td.acc { font-size:8px; line-height:1.5; text-align:center; font-weight:700; color:${INK}; }
  .tot td { background:${SOFT}; font-weight:800; font-size:10.5px; }
  .red { color:#c00; font-weight:700; }
  .foot { position:absolute; left:26px; right:26px; bottom:14px; display:flex; align-items:flex-end;
          justify-content:space-between; gap:12px; font-size:7.6px; color:#333; line-height:1.65;
          border-top:2px solid ${GOLD}; padding-top:7px; }
  .foot img { max-height:30px; width:auto; }`;
}
function docFooterHtml(s) {
  return `<div class="foot">
    <div>
      <div><b>Address:</b> ${escHtml(s.company_address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo')}</div>
      <div><b>Email:</b> ${escHtml(s.company_email || 'info@motolinkers.com')}</div>
      <div><b>Website:</b> ${escHtml(s.company_website || 'Motolinkers.com')}</div>
      <div><b>Phone:</b> ${escHtml(s.company_phone || '+2 010 000 78104')}</div>
      <div><b>TAX ID:</b> ${escHtml(s.company_tax_id || '773934006')}</div>
      <div><b>Registration No:</b> ${escHtml(s.company_reg_no || '282378')}</div>
    </div>
    <img src="${BRAND_LOGO_URL}">
  </div>`;
}
function docSupplierBlock(d) {
  return `<div class="sec">
    <div class="sec-h">Supplier Details</div>
    <table class="kv">
      <tr><td>Name</td><td>${escHtml(d.supplier_name || d.supplier || '')}</td></tr>
      <tr><td>Contact</td><td>${escHtml(d.supplier_contact || '')}</td></tr>
      <tr><td>Address</td><td>${escHtml(d.supplier_address || '')}</td></tr>
      <tr><td>Country of Origin</td><td>${escHtml(d.supplier_country || '')}</td></tr>
    </table>
  </div>`;
}
const DOC_DEFAULT_PAYMENT_TERMS =
  '30% deposit to confirm the order\n70% balance due after the vehicle arrives in XXXXX (VIN code and PDI vehicle video and document to be provided for confirmation)';
const DOC_DEFAULT_DOCUMENTS =
  'MSDS / UN3.8 / Commercial Invoice / Shipping order / Packing List / Temporary Licence and Plate / Sales contract / Export Licence / SGS PDI or Certificate of Conformity (CoC) / CIF ONLY ( B/L / Telex Release / Insurance Policy)';
const DOC_DEFAULT_ACCESSORIES =
  'English system , wall mount charging cable , floor mats, tires repairing kit , electric pump';

// Highlight the placeholder tokens the team fills in by hand, like the paper form.
function docRedify(text) {
  return escHtml(text).replace(/\n/g, '<br>')
    .replace(/(X{3,}\s*(?:Port)?|CIF ONLY[^<]*)/gi, m => `<span class="red">${m}</span>`);
}
function docTermsHtml(d, opts) {
  const o = opts || {};
  return `
  <div class="sec">
    <div class="sec-h">Payment Terms</div>
    <div class="sec-b">${docRedify(d.payment_terms || DOC_DEFAULT_PAYMENT_TERMS)}</div>
  </div>
  <div class="sec">
    <div class="sec-h">Delivery Terms</div>
    <table class="kv">
      ${o.incoterm ? `<tr><td>Incoterm</td><td class="red">${escHtml(d.incoterm || 'FOB')}</td></tr>` : ''}
      <tr><td>Delivery Location</td><td class="red">${escHtml(d.delivery_location || '')}</td></tr>
      <tr><td>Service Provider</td><td class="red">${escHtml(d.service_provider || '')}</td></tr>
      <tr><td>Contact</td><td class="red">${escHtml(d.contact || '')}</td></tr>
      <tr><td>Documents Required</td><td>${docRedify(d.documents_required || DOC_DEFAULT_DOCUMENTS)}</td></tr>
    </table>
  </div>`;
}

// A4 portrait Purchase Order on company letterhead (matches the printed form).
function buildPurchaseOrderHtml(po) {
  const s = po.settings || {};
  const T = quoteTheme(po.template);
  const money = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const items = po.items || [];
  const cur = escHtml(po.currency || 'USD');
  // Always print at least 5 rows so the form looks like the paper original.
  const padded = items.concat(Array.from({ length: Math.max(0, 5 - items.length) }, () => null));
  const rows = padded.map((it, i) => {
    if (!it) return `<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
    const qty = Number(it.units) || 1;
    const price = Number(it.pi_price) || 0;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${escHtml(it.client)}</td>
      <td class="c">${escHtml(it.brand)}</td>
      <td>${escHtml(it.model)}</td>
      <td>${escHtml(it.trim)}</td>
      <td>${escHtml(it.color)}</td>
      <td class="c">${escHtml(it.year)}</td>
      <td class="acc">${escHtml(it.accessories || DOC_DEFAULT_ACCESSORIES).replace(/\n/g, '<br>')}</td>
      <td class="c">${qty}</td>
      <td class="r">${price ? cur + ' ' + money(price) : ''}</td>
      <td class="r">${price ? cur + ' ' + money(price * qty) : ''}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">${T.fontLink}
<style>${docChromeCss(T)}</style></head><body>
<div class="page">
  <div class="head">
    <img src="${BRAND_LOGO_URL}">
    <div class="title">Purchase Order</div>
    <table class="meta">
      <tr><td class="k">ID</td><td class="v">${escHtml(po.quote_id || po.po_number || '')}</td></tr>
      <tr><td class="k">Date</td><td class="v">${escHtml(po.po_date || '')}</td></tr>
      <tr><td class="k">Issuer</td><td class="v">${escHtml(po.issuer || '')}</td></tr>
    </table>
  </div>

  ${docSupplierBlock(po)}

  <table class="grid">
    <colgroup>
      <col style="width:26px"><col style="width:86px"><col style="width:52px"><col style="width:62px">
      <col style="width:52px"><col style="width:86px"><col style="width:34px"><col style="width:132px">
      <col style="width:30px"><col style="width:72px"><col style="width:78px">
    </colgroup>
    <thead><tr>
      <th>No</th><th>CLIENT</th><th>BRAND</th><th>MODEL</th><th>TRIM</th><th>COLOR EXT / INT</th>
      <th>YEAR</th><th>ACCESSORIES / REMARKS</th><th>QTY</th><th>PRICE</th><th>TOTAL</th>
    </tr></thead>
    <tbody>
      ${rows}
      <tr class="tot"><td colspan="10" class="r">TOTAL</td><td class="r">${cur} ${money(poTotal(items))}</td></tr>
    </tbody>
  </table>

  ${po.notes ? `<div class="sec"><div class="sec-h">Notes</div><div class="sec-b">${escHtml(po.notes).replace(/\n/g, '<br>')}</div></div>` : ''}
  ${docTermsHtml(po, { incoterm: true })}

  ${docFooterHtml(s)}
</div>
</body></html>`;
}


module.exports = { DOC_DEFAULT_ACCESSORIES, DOC_DEFAULT_DOCUMENTS, DOC_DEFAULT_PAYMENT_TERMS, buildPurchaseOrderHtml, docChromeCss, docFooterHtml, docSupplierBlock, docTermsHtml, quoteTheme };
