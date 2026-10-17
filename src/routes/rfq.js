// RFQ — Request for Quotation
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, generateQuoteId, getIsoWeek, logLeadActivity, quotationImgUpload, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'generateQuoteId', 'getIsoWeek', 'logLeadActivity', 'quotationImgUpload', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const runAutomations = (...a) => ctx.runAutomations(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);
// What each document looks like lives in src/lib/docs (one shared brand module, one file
// per document). This file is the routes: it loads the record, hands it to the builder
// and sends the result back.
const { buildQuotationHtml } = require('../lib/docs/quotation');
const { buildRfqXlsx, XLSX_MIME } = require('../lib/docs/rfq-xlsx');
const { renderPdf } = require('../lib/docs/render');

// ═══════════════════════════════════════════════════════════════════════════════
// ─── RFQ — Request for Quotation (sent to suppliers) ───────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const RFQ_STATUSES = ['draft', 'sent', 'answered', 'closed'];

function generateRfqNo() {
  const now = new Date();
  const week = String(getIsoWeek(now)).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `MT${week}W${rand}Y${String(now.getFullYear()).slice(-2)}`;
}

function rfqBuildItem(raw) {
  const r = raw || {};
  const money = v => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;
  const built = {
    brand:       String(r.brand || '').trim(),
    model:       String(r.model || '').trim(),
    trim:        String(r.trim || '').trim(),
    colour:      String(r.colour || r.color || '').trim(),
    year:        String(r.year || '').trim(),
    accessories: String(r.accessories || '').trim() || ctx.DOC_DEFAULT_ACCESSORIES,
    lead_time:   String(r.lead_time || '').trim(),
    fob_price:   money(r.fob_price),
    cif_price:   money(r.cif_price),
  };
  // Columns the admin added ride alongside — see ctx.gridExtras.
  return { ...built, ...ctx.gridExtras(r, { ...built, color: 1 }) };
}
const RFQ_ITEM_BUILTINS = { brand: 1, model: 1, trim: 1, colour: 1, color: 1, year: 1,
  accessories: 1, lead_time: 1, fob_price: 1, cif_price: 1 };

function rfqBuildRow(body) {
  const b = body || {};
  const items = (Array.isArray(b.items) ? b.items : []).map(rfqBuildItem)
    .filter(it => it.brand || it.model || it.trim || it.fob_price || it.cif_price
      || ctx.hasGridExtras(it, RFQ_ITEM_BUILTINS));
  return {
    rfq_no:  String(b.rfq_no || '').trim() || generateRfqNo(),
    title:   String(b.title || '').trim(),
    supplier_id:      b.supplier_id ? parseInt(b.supplier_id) : null,
    supplier_name:    String(b.supplier_name || '').trim(),
    supplier_contact: String(b.supplier_contact || '').trim(),
    supplier_address: String(b.supplier_address || '').trim(),
    supplier_country: String(b.supplier_country || '').trim(),
    issuer:   String(b.issuer || '').trim(),
    rfq_date: String(b.rfq_date || '').trim() || null,
    items,
    payment_terms:      String(b.payment_terms || '').trim(),
    delivery_location:  String(b.delivery_location || '').trim(),
    service_provider:   String(b.service_provider || '').trim(),
    contact:            String(b.contact || '').trim(),
    documents_required: String(b.documents_required || '').trim(),
    customer_id: b.customer_id ? parseInt(b.customer_id) : null,
    status: RFQ_STATUSES.includes(b.status) ? b.status : 'draft',
    // Configurable document fields (the rfq_doc column config) ride here.
    custom_fields: b.custom_fields && typeof b.custom_fields === 'object' ? b.custom_fields : {},
  };
}

async function rfqSettings() {
  const { data } = await supabase.from('quotation_settings').select('key,value');
  const settings = {};
  for (const r of data || []) settings[r.key] = r.value;
  return settings;
}

// Mounted for both portals over one set of handlers — see contracts.js for why.
function mountRfqRoutes(base, guard) {
  receiver.router.get(base, guard, requirePerm('rfq', 'view'), async (_req, res) => {
    const { data, error } = await supabase.from('rfqs')
      .select('id,rfq_no,title,supplier_name,issuer,rfq_date,status,customer_id,items,created_by,created_at')
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // Prefill a new RFQ from a lead — same contract as the contract/PO defaults.
  receiver.router.get(`${base}/new/defaults`, guard, requirePerm('rfq', 'create'), async (req, res) => {
    try {
      const customerId = req.query.customer_id ? parseInt(req.query.customer_id) : null;
      const cust = customerId
        ? await supabase.from('customers').select('*').eq('id', customerId).single().then(r => r.data)
        : null;
      const item = rfqBuildItem({});
      if (cust) {
        const cf = cust.custom_fields || {};
        const car = String(cf.cf_vehicle_offered || cf.cf_vehicle_requested || cust.car_in_question || '').trim();
        const bits = car.split(/\s+/).filter(Boolean);
        item.brand = bits[0] || '';
        item.model = bits.slice(1).join(' ') || '';
        item.colour = cf.cf_color || '';
        item.year = cf.cf_year || '';
      }
      // Eight blank lines, matching the printed form.
      const items = [item, ...Array.from({ length: 7 }, () => rfqBuildItem({}))];
      res.json({
        rfq_no: generateRfqNo(),
        rfq_date: new Date().toISOString().slice(0, 10),
        items,
        payment_terms: ctx.DOC_DEFAULT_PAYMENT_TERMS,
        documents_required: ctx.DOC_DEFAULT_DOCUMENTS,
        customer_id: customerId || null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  receiver.router.get(`${base}/:id`, guard, requirePerm('rfq', 'view'), async (req, res) => {
    const { data, error } = await supabase.from('rfqs').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'RFQ not found' });
    res.json(data);
  });

  receiver.router.post(base, guard, requirePerm('rfq', 'create'), express.json({ limit: '2mb' }), async (req, res) => {
    const who = callerIdentity(req);
    const row = rfqBuildRow(req.body);
    row.created_by = who.key;
    const { data, error } = await ctx.writeOptional(
      p => supabase.from('rfqs').insert(p).select().single(), row, ['custom_fields']);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
    if (data.customer_id) {
      logLeadActivity(data.customer_id, {
        type: 'note', body: `RFQ created — ${data.rfq_no}`,
        meta: { rfq_id: data.id, rfq_no: data.rfq_no }, authorKey: who.key, authorName: who.name,
      });
    }
  });

  receiver.router.put(`${base}/:id`, guard, requirePerm('rfq', 'edit'), express.json({ limit: '2mb' }), async (req, res) => {
    const row = rfqBuildRow(req.body);
    row.updated_at = new Date().toISOString();
    delete row.rfq_no;   // immutable once issued
    const { data, error } = await ctx.writeOptional(
      p => supabase.from('rfqs').update(p).eq('id', req.params.id).select().single(), row, ['custom_fields']);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  receiver.router.delete(`${base}/:id`, guard, requirePerm('rfq', 'delete'), async (req, res) => {
    const { error } = await supabase.from('rfqs').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });


  // An RFQ goes to the supplier as an Excel workbook — they fill the prices in and send it
  // back — so there is no PDF. Same {base64, name} reply shape the PDF routes had.
  receiver.router.post(`${base}/xlsx`, guard, requirePerm('rfq', 'export'), express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const settings = await rfqSettings();
      const row = rfqBuildRow(req.body);
      const buf = await buildRfqXlsx({ ...row, settings });
      res.json({ xlsx: Buffer.from(buf).toString('base64'), name: row.rfq_no || 'rfq' });
    } catch (e) { console.error('[rfq-xlsx]', e); res.status(500).json({ error: e.message }); }
  });

  receiver.router.post(`${base}/:id/xlsx`, guard, requirePerm('rfq', 'export'), async (req, res) => {
    try {
      const { data: row, error } = await supabase.from('rfqs').select('*').eq('id', req.params.id).single();
      if (error || !row) return res.status(404).json({ error: 'RFQ not found' });
      const buf = await buildRfqXlsx({ ...row, settings: await rfqSettings() });
      res.json({ xlsx: Buffer.from(buf).toString('base64'), name: row.rfq_no || 'rfq' });
    } catch (e) { console.error('[rfq-xlsx-id]', e); res.status(500).json({ error: e.message }); }
  });

  // A portal tab opened before the switch still asks for the PDF. Say what changed rather
  // than let it fail as an unreadable 404.
  const rfqNoPdf = (_req, res) => res.status(410).json({ error: 'RFQs are exported as Excel now. Refresh the page and use Export Excel.' });
  receiver.router.post(`${base}/pdf`, guard, requirePerm('rfq', 'export'), rfqNoPdf);
  receiver.router.post(`${base}/:id/pdf`, guard, requirePerm('rfq', 'export'), rfqNoPdf);
}
mountRfqRoutes('/api/dashboard/rfqs', requireAuth);
mountRfqRoutes('/api/employee/rfqs', requireEmployeeAuth);

// Every PDF in the system is rendered by src/lib/docs/render.js; the name stays here
// because the other route modules reach it through ctx.renderQuotationPdf.
const renderQuotationPdf = (html, opts) => renderPdf(html, opts);

// There is one quotation design now (src/lib/docs/quotation.js). The `template` a saved
// quotation carries is kept so nothing that reads it breaks, but every value maps to it.
const QUOTE_THEMES = { motolinkers: { key: 'motolinkers', label: 'Motolinkers' } };
function quoteTheme() { return QUOTE_THEMES.motolinkers; }

receiver.router.post('/api/dashboard/quotation/generate', requireAuth,
  quotationImgUpload.array('images', 5), async (req, res) => {
    try {
      const { id, date, validTo, name, vehicleModel, items: itemsJson, logistics: logisticsJson, currency, exchange, issuer, customSpecs: customSpecsJson } = req.body;
      const items       = JSON.parse(itemsJson       || '[]');
      const logistics   = JSON.parse(logisticsJson   || '[]');
      const customSpecs = JSON.parse(customSpecsJson || '[]');
      // The quotation's configurable document fields (quote_doc), kept in the
      // record's own data payload — quotations need no column for them.
      let customFields = {};
      try { const cf = JSON.parse(req.body.customFields || '{}'); if (cf && typeof cf === 'object') customFields = cf; } catch (_) {}
      let existingImages = [];
      try { existingImages = JSON.parse(req.body.existingImages || '[]'); } catch (_) {}
      const files       = req.files || [];
      const uploaded    = files.map(f => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);
      // Keep previously-saved images (restored on edit/duplicate) + any newly uploaded, capped at 5.
      const imageDataUrls = [...(Array.isArray(existingImages) ? existingImages : []), ...uploaded].slice(0, 5);

      // Load company settings from DB
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;

      const template = quoteTheme(req.body.template).key;
      const html = buildQuotationHtml({ id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings, template });

      const pdfBuffer = await renderQuotationPdf(html);

      res.json({ pdf: Buffer.from(pdfBuffer).toString('base64') });
      // Save/update the quotation record (best-effort). Images are persisted in `data` so edit/duplicate can restore them.
      const custId = req.body.customer_id ? parseInt(req.body.customer_id) : null;
      const pk = req.body.quotation_pk ? parseInt(req.body.quotation_pk) : null;
      const record = {
        title: `${vehicleModel || 'Quotation'} — ${name || ''}`.trim(),
        data: { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, customSpecs, imageDataUrls, template, customFields },
        customer_id: custId,
      };
      if (pk) {
        supabase.from('quotations').update(record).eq('id', pk).select().single().then(({ data: qrow }) => {
          if (custId && qrow) logLeadActivity(custId, { type: 'quote', body: `Quotation updated — ${qrow.title}`, meta: { quotation_id: qrow.id, quote_id: qrow.quote_id }, authorKey: 'admin', authorName: 'Admin' });
        }).catch(() => {});
      } else {
        supabase.from('quotations').insert({ ...record, quote_id: id || generateQuoteId(), created_by: 'dashboard' }).select().single().then(({ data: qrow }) => {
          if (custId && qrow) logLeadActivity(custId, { type: 'quote', body: `Quotation generated — ${qrow.title}`, meta: { quotation_id: qrow.id, quote_id: qrow.quote_id }, authorKey: 'admin', authorName: 'Admin' });
          if (qrow) runAutomations('quote.generated', { entityType: 'quote', entityId: qrow.id, customerId: custId, ownerId: null, fields: { name: name || '', vehicleModel: vehicleModel || '', title: qrow.title } });
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[quotation-gen]', e);
      res.status(500).json({ error: e.message });
    }
  }
);


module.exports = { XLSX_MIME, buildQuotationHtml, buildRfqXlsx, quoteTheme, renderQuotationPdf, rfqSettings };
