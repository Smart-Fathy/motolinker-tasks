// Employee Quotation Draft
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { ADMIN_USERNAME, express, quotationImgUpload, receiver, requireAuth, requireEmployeeAuth, supabase, upload } = ctx.need('ADMIN_USERNAME', 'express', 'quotationImgUpload', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase', 'upload');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const buildLeadsReport = (...a) => ctx.buildLeadsReport(...a);
const buildQuotationHtml = (...a) => ctx.buildQuotationHtml(...a);
const buildSalesReport = (...a) => ctx.buildSalesReport(...a);
const csvSerialize = (...a) => ctx.csvSerialize(...a);
const customerInScope = (...a) => ctx.customerInScope(...a);
const dealInScope = (...a) => ctx.dealInScope(...a);
const empCan = (...a) => ctx.empCan(...a);
const generateQuoteId = (...a) => ctx.generateQuoteId(...a);
const logLeadActivity = (...a) => ctx.logLeadActivity(...a);
const quoteTheme = (...a) => ctx.quoteTheme(...a);
const renderQuotationPdf = (...a) => ctx.renderQuotationPdf(...a);
const runAutomations = (...a) => ctx.runAutomations(...a);
const scopedQuotedIds = (...a) => ctx.scopedQuotedIds(...a);
// Reassigned at runtime (Drive connect/disconnect, VAPID boot), so these are
// read from the context on use — capturing them here would pin the boot value.

// ─── Employee Quotation Draft ──────────────────────────────────────────────────
receiver.router.get('/api/employee/quotation/newid', requireEmployeeAuth, (req, res) => {
  if (!empCan(req.employee, 'quotation', 'draft')) return res.status(403).json({ error: 'Not permitted' });
  res.json({ id: generateQuoteId() });
});

// Slim, scope-aware lead list for the quotation/deal lead-picker — usable WITHOUT
// the Leads section (needs quotation "attach to a lead" OR leads view).
receiver.router.get('/api/employee/lead-options', requireEmployeeAuth, async (req, res) => {
  const emp = req.employee;
  if (!(empCan(emp, 'quotation', 'attachLead') || empCan(emp, 'leads', 'view') || empCan(emp, 'deals', 'create'))) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('customers').select('id,name,phone,lead_status,assigned_to').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const stageIdSet = await scopedQuotedIds(emp);
  res.json((data || []).filter(c => customerInScope(c, emp, stageIdSet)).map(c => ({ id: c.id, name: c.name, phone: c.phone })));
});

// ── Employee reports ──────────────────────────────────────────────────────────
// Granted per report (leads / sales / export). Every figure is restricted to the
// employee's data scope, so a rep limited to their own leads sees only their own
// totals — never company-wide numbers.
async function empReportScope(emp) {
  const stageIdSet = await scopedQuotedIds(emp);
  return {
    scopeLeads: c => customerInScope(c, emp, stageIdSet),
    scopeDeals: d => dealInScope(d, emp),
  };
}

receiver.router.get('/api/employee/reports/leads', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'reports', 'leads')) return res.status(403).json({ error: 'Not permitted' });
  try {
    const scope = await empReportScope(req.employee);
    res.json(await buildLeadsReport({ ...req.query, ...scope }));
  } catch (e) { console.error('[emp-reports-leads]', e); res.status(500).json({ error: e.message }); }
});

receiver.router.get('/api/employee/reports/summary', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'reports', 'sales')) return res.status(403).json({ error: 'Not permitted' });
  try {
    const scope = await empReportScope(req.employee);
    res.json(await buildSalesReport({ ...req.query, ...scope }));
  } catch (e) { console.error('[emp-reports-summary]', e); res.status(500).json({ error: e.message }); }
});

// CSV export of the leads report — needs both the report itself and export rights.
receiver.router.get('/api/employee/reports/leads-export.csv', requireEmployeeAuth, async (req, res) => {
  const emp = req.employee;
  if (!(empCan(emp, 'reports', 'leads') && empCan(emp, 'reports', 'export'))) return res.status(403).json({ error: 'Not permitted' });
  try {
    const scope = await empReportScope(emp);
    const rep = await buildLeadsReport({ ...req.query, ...scope });
    const rows = (rep.rows || []).map(r => ({ label: r.label, leads: r.count, value: r.value }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-report-${rep.groupBy}.csv"`);
    res.send('﻿' + csvSerialize(rows, ['label', 'leads', 'value']));
  } catch (e) { console.error('[emp-reports-csv]', e); res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/employee/quotation/generate', requireEmployeeAuth,
  quotationImgUpload.array('images', 5), async (req, res) => {
    try {
      if (!empCan(req.employee, 'quotation', 'draft')) return res.status(403).json({ error: 'Not permitted' });
      const { id, date, validTo, name, vehicleModel, items: itemsJson, logistics: logisticsJson, currency, exchange, issuer, customSpecs: customSpecsJson } = req.body;
      const items       = JSON.parse(itemsJson       || '[]');
      const logistics   = JSON.parse(logisticsJson   || '[]');
      const customSpecs = JSON.parse(customSpecsJson || '[]');
      let existingImages = [];
      try { existingImages = JSON.parse(req.body.existingImages || '[]'); } catch (_) {}
      const files       = req.files || [];
      const uploaded    = files.map(f => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);
      const imageDataUrls = [...(Array.isArray(existingImages) ? existingImages : []), ...uploaded].slice(0, 5);

      // Load company settings from DB
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;

      const template = quoteTheme(req.body.template).key;
      const html = buildQuotationHtml({ id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings, template });

      const pdfBuffer = await renderQuotationPdf(html);

      res.json({ pdf: Buffer.from(pdfBuffer).toString('base64') });
      // Save/update the quotation record (best-effort). Images persisted in `data` for edit/duplicate.
      let custId = req.body.customer_id ? parseInt(req.body.customer_id) : null;
      // Scope guard: an employee without full leads view can only attach to a lead
      // that is inside their scope — otherwise silently drop the link (quote still generates).
      if (custId && !empCan(req.employee, 'leads', 'view')) {
        const { data: tgt } = await supabase.from('customers').select('id,lead_status,assigned_to').eq('id', custId).single();
        if (!tgt || !customerInScope(tgt, req.employee, await scopedQuotedIds(req.employee))) custId = null;
      }
      const pk = req.body.quotation_pk ? parseInt(req.body.quotation_pk) : null;
      const record = {
        title: `${vehicleModel || 'Quotation'} — ${name || ''}`.trim(),
        data: { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, customSpecs, imageDataUrls, template },
        customer_id: custId,
      };
      if (pk) {
        supabase.from('quotations').update(record).eq('id', pk).select().single().then(({ data: qrow }) => {
          if (custId && qrow) logLeadActivity(custId, { type: 'quote', body: `Quotation updated — ${qrow.title}`, meta: { quotation_id: qrow.id, quote_id: qrow.quote_id }, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
        }).catch(() => {});
      } else {
        supabase.from('quotations').insert({ ...record, quote_id: id || generateQuoteId(), created_by: req.employee.username }).select().single().then(({ data: qrow }) => {
          if (custId && qrow) logLeadActivity(custId, { type: 'quote', body: `Quotation generated — ${qrow.title}`, meta: { quotation_id: qrow.id, quote_id: qrow.quote_id }, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
          if (qrow) runAutomations('quote.generated', { entityType: 'quote', entityId: qrow.id, customerId: custId, ownerId: null, fields: { name: name || '', vehicleModel: vehicleModel || '', title: qrow.title } });
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[emp-quotation-gen]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// Help Bot (bilingual  → src/routes/help-bot.js
Object.assign(ctx, { ADMIN_USERNAME, express, receiver, requireAuth, requireEmployeeAuth, upload });
require('./help-bot');
// Form Submissions  → src/routes/submissions.js
Object.assign(ctx, { express, receiver, requireAuth, supabase });
Object.assign(ctx, require('./submissions'));

module.exports = { empReportScope };
