// Quotation Draft
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { autoCreateSaleForWonDeal, customerInScope, dealInScope, empCan, empHasScope, express, importLeadRows, loadLeadsColsConfig, logLeadActivity, multer, multerCsv, normalizePhone, parseLeadsCsv, receiver, requireAuth, requireEmployeeAuth, scopedQuotedIds, supabase } = ctx.need('autoCreateSaleForWonDeal', 'customerInScope', 'dealInScope', 'empCan', 'empHasScope', 'express', 'importLeadRows', 'loadLeadsColsConfig', 'logLeadActivity', 'multer', 'multerCsv', 'normalizePhone', 'parseLeadsCsv', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'scopedQuotedIds', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const autoCreateContractForWonDeal = (...a) => ctx.autoCreateContractForWonDeal(...a);
const buildQuotationHtml = (...a) => ctx.buildQuotationHtml(...a);
const createNotification = (...a) => ctx.createNotification(...a);
const dealCtx = (...a) => ctx.dealCtx(...a);
const leadCtx = (...a) => ctx.leadCtx(...a);
const quoteTheme = (...a) => ctx.quoteTheme(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const renderQuotationPdf = (...a) => ctx.renderQuotationPdf(...a);
const runAutomations = (...a) => ctx.runAutomations(...a);

// ─── Quotation Draft ──────────────────────────────────────────────────────────
const quotationImgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  },
});

function getIsoWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function generateQuoteId() {
  const now  = new Date();
  const week = String(getIsoWeek(now)).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 90) + 10);
  const year = String(now.getFullYear()).slice(-2);
  return `MT${week}W${rand}Y${year}`;
}

// ── Employee CRM (gated by the leads/deals permission; delete goes via approval) ──
receiver.router.get('/api/employee/leads', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'leads', 'view')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const stageIdSet = await scopedQuotedIds(req.employee);
  res.json((data || []).filter(c => customerInScope(c, req.employee, stageIdSet)));
});

// Read the shared leads column config (read-only; config editing stays admin-only)
receiver.router.get('/api/employee/leads/columns', requireEmployeeAuth, async (req, res) => {
  if (!(empCan(req.employee, 'leads', 'view') || empCan(req.employee, 'quotation', 'attachLead'))) return res.status(403).json({ error: 'Not permitted' });
  const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'leads_columns_config').single();
  let columns = null; try { if (data?.value) columns = JSON.parse(data.value); } catch (_) {}
  res.json({ columns });
});

receiver.router.post('/api/employee/leads', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'create')) return res.status(403).json({ error: 'Not permitted' });
  const { name, phone, email, source, notes, lead_date, lead_time, lead_status, car_in_question, budget_lead, budget_max, next_action, been_contacted, sales_feedback, inquiry, assigned_to, custom_fields, force } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const phone_norm = normalizePhone(phone);
  if (phone_norm && !force) {
    const { data: dup } = await supabase.from('customers').select('id,name,phone,lead_status').eq('phone_norm', phone_norm).limit(1);
    if (dup && dup.length) return res.status(409).json({ duplicate: true, existing: dup[0] });
  }
  const { data, error } = await supabase.from('customers')
    .insert({ name, phone: phone||'', phone_norm, email: email||'', source: source||'', notes: notes||'', lead_date: lead_date||null, lead_time: lead_time||'', lead_status: lead_status||'cold', car_in_question: car_in_question||'', budget_lead: budget_lead||null, budget_max: budget_max||null, next_action: next_action||'', been_contacted: been_contacted||false, sales_feedback: sales_feedback||'', inquiry: inquiry||'', assigned_to: assigned_to||null, custom_fields: custom_fields||{}, created_by: req.employee.username })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(data.id, { type: 'system', body: `Lead created${data.source ? ' · ' + data.source : ''}`, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  if (data.lead_status === 'hot') {
    supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question||'', budget_egp: data.budget_lead||null, notes: 'Auto-created from Hot lead', created_by: 'system' }).then(()=>{}).catch(()=>{});
  }
  runAutomations('lead.created', leadCtx(data));
  res.json(data);
});

receiver.router.put('/api/employee/leads/:id', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const { data: prev } = await supabase.from('customers').select('lead_status,been_contacted').eq('id', req.params.id).single();
  const patch = { ...req.body, updated_at: new Date().toISOString() };
  delete patch.force; delete patch.created_by; delete patch.id;
  if (Object.prototype.hasOwnProperty.call(patch, 'phone')) patch.phone_norm = normalizePhone(patch.phone);
  const { data, error } = await supabase.from('customers').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const author = { authorKey: `employee_${req.employee.id}`, authorName: req.employee.name };
  if (prev && data.lead_status !== prev.lead_status) logLeadActivity(data.id, { type: 'status_change', body: 'Status changed', meta: { from: prev.lead_status || 'cold', to: data.lead_status || 'cold' }, ...author });
  if (prev && !prev.been_contacted && data.been_contacted) logLeadActivity(data.id, { type: 'system', body: 'Marked as contacted', ...author });
  if (data.lead_status === 'hot' && prev?.lead_status !== 'hot') {
    try {
      const { data: existing } = await supabase.from('deals').select('id').eq('customer_id', data.id).limit(1);
      if (!existing?.length) {
        await supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question||'', budget_egp: data.budget_lead||null, notes: 'Auto-created from Hot lead', created_by: 'system' });
        logLeadActivity(data.id, { type: 'deal', body: 'Deal auto-created from Hot status', authorKey: 'system', authorName: 'System' });
      }
    } catch (e) { console.warn('[emp-leads] auto-deal failed:', e.message); }
  }
  if (prev && data.lead_status !== prev.lead_status) runAutomations('lead.status_changed', { ...leadCtx(data), from: prev.lead_status, to: data.lead_status });
  if (prev && !prev.been_contacted && data.been_contacted) runAutomations('lead.contacted', leadCtx(data));
  res.json(data);
});

receiver.router.get('/api/employee/deals', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'deals', 'view')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('deals').select('*, customers(name,phone,email,lead_status,assigned_to)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).filter(d => dealInScope(d, req.employee)));
});

receiver.router.post('/api/employee/deals', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'deals', 'create')) return res.status(403).json({ error: 'Not permitted' });
  const { customer_id, title, stage, car_model, budget_egp, notes, assigned_to } = req.body;
  if (!customer_id || !title) return res.status(400).json({ error: 'customer_id and title are required' });
  const { data, error } = await supabase.from('deals')
    .insert({ customer_id, title, stage: stage||'lead', car_model: car_model||'', budget_egp: budget_egp||null, notes: notes||'', assigned_to: assigned_to||'', created_by: req.employee.username })
    .select('*, customers(name,phone,email)').single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(customer_id, { type: 'deal', body: `Deal created — ${title}`, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  runAutomations('deal.created', dealCtx(data));
  res.json(data);
});

receiver.router.put('/api/employee/deals/:id', requireEmployeeAuth, express.json(), async (req, res) => {
  // A pure stage change needs 'move'; any other field edit needs 'edit'.
  {
    const keys = Object.keys(req.body || {});
    const onlyStage = keys.length && keys.every(k => k === 'stage');
    const allowed = onlyStage ? (empCan(req.employee, 'deals', 'move') || empCan(req.employee, 'deals', 'edit')) : empCan(req.employee, 'deals', 'edit');
    if (!allowed) return res.status(403).json({ error: 'Not permitted' });
  }
  const { data: prev } = await supabase.from('deals').select('stage').eq('id', req.params.id).single();
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  delete updates.created_by; delete updates.id;
  if ((updates.stage === 'won' || updates.stage === 'lost') && !updates.closed_at) updates.closed_at = new Date().toISOString();
  if (updates.stage && updates.stage !== 'won' && updates.stage !== 'lost') updates.closed_at = null;
  const { data, error } = await supabase.from('deals')
    .update(updates).eq('id', req.params.id).select('*, customers(name,phone,email,car_in_question,budget_lead)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (updates.stage === 'inquiry' && prev?.stage !== 'inquiry') {
    try {
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {}; for (const row of settingsRows || []) settings[row.key] = row.value;
      const notifyId = settings.contact_notify_employee_id;
      if (notifyId) {
        const c = data.customers;
        const body = [`Lead: ${c?.name || data.title}`, c?.phone ? `Phone: ${c.phone}` : '', c?.car_in_question ? `Car: ${c.car_in_question}` : '', c?.budget_lead ? `Budget: ${Number(c.budget_lead).toLocaleString()} EGP` : ''].filter(Boolean).join(' · ');
        await createNotification(`employee_${notifyId}`, { type: 'lead', title: 'New lead to quote — ' + (c?.name || data.title), body, url: '/employee#quotation' }, 'always');
      }
    } catch (e) { console.warn('[emp-deals] notify-contacted failed:', e.message); }
  }
  if (updates.stage && prev?.stage !== updates.stage && data.customer_id) {
    const stageLabels = { lead: 'Lead', inquiry: 'Inquiry', quoted: 'Quoted', negotiating: 'Negotiating', won: 'Won', lost: 'Lost' };
    logLeadActivity(data.customer_id, { type: 'deal', body: `Deal moved to ${stageLabels[updates.stage] || updates.stage} — ${data.title}`, meta: { from: prev?.stage, to: updates.stage }, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  }
  if (updates.stage && prev?.stage !== updates.stage) runAutomations('deal.stage_changed', { ...dealCtx(data), from: prev?.stage, to: updates.stage });
  // Won → draft the Arabic import contract (best-effort, never blocks the move)
  if (updates.stage === 'won' && prev?.stage !== 'won') {
    autoCreateContractForWonDeal(data);
    autoCreateSaleForWonDeal(data);
  }
  res.json(data);
});

// Employee-initiated deletion requests (admin approves → the record is actually deleted)
receiver.router.post('/api/employee/deletion-requests', requireEmployeeAuth, express.json(), async (req, res) => {
  const { entity_type, entity_id, reason } = req.body || {};
  if (!['lead', 'deal'].includes(entity_type) || !entity_id) return res.status(400).json({ error: 'entity_type (lead|deal) and entity_id are required' });
  const permOk = entity_type === 'lead' ? empCan(req.employee, 'leads', 'delete') : empCan(req.employee, 'deals', 'delete');
  if (!permOk) return res.status(403).json({ error: 'Not permitted' });
  let label = '';
  if (entity_type === 'lead') {
    const { data } = await supabase.from('customers').select('name,phone').eq('id', entity_id).single();
    if (!data) return res.status(404).json({ error: 'Lead not found' });
    label = data.name + (data.phone ? ' · ' + data.phone : '');
  } else {
    const { data } = await supabase.from('deals').select('title, customers(name)').eq('id', entity_id).single();
    if (!data) return res.status(404).json({ error: 'Deal not found' });
    // A deal's title is generated as "<customer> — <car>", so appending the customer
    // again read "Ahmed Ali — BMW X5 · Ahmed Ali" on every deal approval card. Only
    // add it when the title does not already carry it.
    const who = data.customers && data.customers.name;
    const already = who && String(data.title || '').toLowerCase().includes(String(who).toLowerCase());
    label = data.title + (who && !already ? ' · ' + who : '');
  }
  const { data: existing } = await supabase.from('deletion_requests').select('id').eq('entity_type', entity_type).eq('entity_id', entity_id).eq('status', 'pending').limit(1);
  if (existing && existing.length) return res.json({ ok: true, duplicate: true });
  const { data: row, error } = await supabase.from('deletion_requests')
    .insert({ entity_type, entity_id, entity_label: label, requested_by: req.employee.username, reason: String(reason || '').slice(0, 500), status: 'pending' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  createNotification('admin', { type: 'request', title: `Deletion request — ${entity_type}`, body: `${req.employee.name} asked to delete "${label}"${reason ? ' — ' + reason : ''}`, url: '/dashboard#deletions' }, 'always').catch(() => {});
  res.json({ ok: true, id: row.id });
});
receiver.router.get('/api/employee/deletion-requests', requireEmployeeAuth, async (req, res) => {
  const { data, error } = await supabase.from('deletion_requests').select('*').eq('requested_by', req.employee.username).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Employee Lead 360° profile: timeline, follow-ups, linked quotations & deals ──
receiver.router.get('/api/employee/customers/:id/profile', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'leads', 'view')) return res.status(403).json({ error: 'Not permitted' });
  const id = parseInt(req.params.id);
  const { data: customer, error } = await supabase.from('customers').select('*').eq('id', id).single();
  if (error || !customer) return res.status(404).json({ error: 'Lead not found' });
  if (empHasScope(req.employee) && !customerInScope(customer, req.employee, await scopedQuotedIds(req.employee))) return res.status(403).json({ error: 'Not permitted' });
  const [activities, followups, quotations, deals, contracts, purchaseOrders] = await Promise.all([
    supabase.from('lead_activities').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('lead_followups').select('*').eq('customer_id', id).order('due_at', { ascending: true }),
    supabase.from('quotations').select('id,quote_id,title,created_by,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('deals').select('id,title,stage,budget_egp,created_at').eq('customer_id', id).order('created_at', { ascending: false }),
    supabase.from('contracts').select('id,contract_no,title,status,created_by,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('purchase_orders').select('id,po_number,title,supplier,status,items,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  res.json({
    customer,
    activities: activities.data || [],
    followups: followups.data || [],
    quotations: quotations.data || [],
    deals: deals.data || [],
    contracts: contracts.data || [],
    purchaseOrders: purchaseOrders.data || [],
  });
});

receiver.router.post('/api/employee/customers/:id/activities', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const type = ['note', 'call', 'whatsapp', 'meeting'].includes(req.body?.type) ? req.body.type : 'note';
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Activity text is required' });
  const { data, error } = await supabase.from('lead_activities')
    .insert({ customer_id: parseInt(req.params.id), type, body, author_key: `employee_${req.employee.id}`, author_name: req.employee.name })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.post('/api/employee/customers/:id/followups', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const due_at = req.body?.due_at;
  if (!due_at || isNaN(new Date(due_at).getTime())) return res.status(400).json({ error: 'A valid due date/time is required' });
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const assigned_to = req.body?.assigned_to ? parseInt(req.body.assigned_to) : null;
  const { data, error } = await supabase.from('lead_followups')
    .insert({ customer_id: parseInt(req.params.id), due_at: new Date(due_at).toISOString(), note, assigned_to, created_by: req.employee.username })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(data.customer_id, { type: 'follow_up', body: `Follow-up scheduled for ${new Date(data.due_at).toLocaleString()}${note ? ' — ' + note : ''}`, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  res.json(data);
});

receiver.router.put('/api/employee/followups/:id', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const status = ['done', 'cancelled', 'pending'].includes(req.body?.status) ? req.body.status : 'done';
  const patch = { status, completed_at: status === 'done' ? new Date().toISOString() : null };
  const { data, error } = await supabase.from('lead_followups').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (status !== 'pending') {
    logLeadActivity(data.customer_id, { type: 'follow_up', body: status === 'done' ? 'Follow-up completed' : 'Follow-up cancelled', authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  }
  res.json(data);
});

receiver.router.get('/api/employee/followups/pending', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'leads', 'view')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('lead_followups')
    .select('id,customer_id,due_at,note,assigned_to').eq('status', 'pending').order('due_at', { ascending: true }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Write the shared leads column config (gated by the leads permission; config is global)
receiver.router.put('/api/employee/leads/columns', requireEmployeeAuth, express.json({ limit: '256kb' }), async (req, res) => {
  // Legacy path, kept for clients still running the previous bundle.
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const columns = ctx.sanitizeColumns(req.body && req.body.columns);
  if (!columns) return res.status(400).json({ error: 'columns must be an array' });
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: 'leads_columns_config', value: JSON.stringify(columns) }, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, columns });
});

// CSV / Google-Sheets import (mirrors the admin importer; deduped on normalized phone)
receiver.router.post('/api/employee/customers/import', requireEmployeeAuth, multerCsv.single('file'), express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'import')) return res.status(403).json({ error: 'Not permitted' });
  try {
    let csvText = '';
    if (req.file) {
      csvText = req.file.buffer.toString('utf8');
    } else if (req.body?.sheetUrl) {
      const match = req.body.sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) return res.status(400).json({ error: 'Invalid Google Sheets URL' });
      const nodeFetch = require('node-fetch');
      const r = await nodeFetch(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`);
      if (!r.ok) return res.status(400).json({ error: 'Could not fetch spreadsheet — make sure it is publicly accessible.' });
      csvText = await r.text();
    }
    if (!csvText) return res.status(400).json({ error: 'No data to import' });
    const { data: emps } = await supabase.from('employees').select('id,name,username,email');
    const cols = await loadLeadsColsConfig();
    const { rows, unmatchedHeaders, error: parseErr } = parseLeadsCsv(csvText, cols, emps || []);
    if (parseErr) return res.status(400).json({ error: parseErr });
    if (!rows.length) return res.status(400).json({ error: 'No valid rows (Name column is required)' });
    const updateExisting = String(req.body?.updateExisting) === 'true';
    const { inserted, updated, skipped, skippedNames, deals } = await importLeadRows(rows, updateExisting);
    res.json({ count: inserted, inserted, updated, skipped, deals, skippedNames: (skippedNames || []).slice(0, 50), unmatchedHeaders });
  } catch (e) { console.error('[emp-csv-import]', e); res.status(500).json({ error: e.message }); }
});

// ── Quotation Settings ────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/quotation/settings', requireAuth, async (_req, res) => {
  const { data } = await supabase.from('quotation_settings').select('key,value');
  const settings = {};
  for (const row of data || []) settings[row.key] = row.value;
  res.json(settings);
});

receiver.router.put('/api/dashboard/quotation/settings', requireAuth, express.json(), async (req, res) => {
  const entries = Object.entries(req.body || {}).map(([key, value]) => ({ key, value: String(value) }));
  if (!entries.length) return res.json({ ok: true });
  const { error } = await supabase.from('quotation_settings').upsert(entries, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Quotation History ─────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/quotations', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('quotations').select('id,quote_id,title,created_by,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/dashboard/quotations/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('quotations').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Re-render a saved quotation to PDF straight from its stored data, so it can be
// viewed from the lead profile without loading it back into the draft form.
//
// Mounted for BOTH portals. It was the dashboard's alone, while the team portal's
// quotation list carried the same PDF button — pointed, through procPath(), at an
// /api/employee route that did not exist. The 404 fell through to the SPA's HTML,
// which the client tried to read as JSON: "Unexpected token '<'".
function mountQuotationPdfRoute(base, guard) {
  receiver.router.post(`${base}/quotations/:id/pdf`, guard, requirePerm('quotation', 'history'), async (req, res) => {
    try {
      const { data: row, error } = await supabase.from('quotations').select('*').eq('id', req.params.id).single();
      if (error || !row) return res.status(404).json({ error: 'Quotation not found' });
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const s of settingsRows || []) settings[s.key] = s.value;
      const d = row.data || {};
      const html = buildQuotationHtml({ ...d, template: quoteTheme(d.template).key, settings });
      const pdf = await renderQuotationPdf(html);
      res.json({ pdf: Buffer.from(pdf).toString('base64'), name: row.quote_id || 'quotation' });
    } catch (e) {
      console.error('[quotation-pdf]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
mountQuotationPdfRoute('/api/dashboard', requireAuth);
mountQuotationPdfRoute('/api/employee', requireEmployeeAuth);

receiver.router.delete('/api/dashboard/quotations/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('quotations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Employee quotation settings — read + write (shared, company-wide; gated by the quotation permission)
receiver.router.get('/api/employee/quotation/settings', requireEmployeeAuth, async (req, res) => {
  // Reading settings is needed to build a draft, so draft OR settings access suffices.
  if (!(empCan(req.employee, 'quotation', 'draft') || empCan(req.employee, 'quotation', 'settings'))) return res.status(403).json({ error: 'Not permitted' });
  const { data } = await supabase.from('quotation_settings').select('key,value');
  const settings = {};
  for (const row of data || []) settings[row.key] = row.value;
  res.json(settings);
});

receiver.router.put('/api/employee/quotation/settings', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'quotation', 'settings')) return res.status(403).json({ error: 'Not permitted' });
  const entries = Object.entries(req.body || {}).map(([key, value]) => ({ key, value: String(value) }));
  if (!entries.length) return res.json({ ok: true });
  const { error } = await supabase.from('quotation_settings').upsert(entries, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Employee history shows ALL quotations (shared), matching the admin dashboard.
receiver.router.get('/api/employee/quotations', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'quotation', 'history')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('quotations').select('id,quote_id,title,created_by,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/employee/quotations/:id', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'quotation', 'history')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('quotations').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Any employee with quotation access can delete any quotation from the shared history.
receiver.router.delete('/api/employee/quotations/:id', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'quotation', 'delete')) return res.status(403).json({ error: 'Not permitted' });
  const { error } = await supabase.from('quotations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

receiver.router.get('/api/dashboard/quotation/newid', requireAuth, (_req, res) => {
  res.json({ id: generateQuoteId() });
});

function fmtNum(n) {
  const v = parseFloat(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('en-US');
}

function calcEgp(priceUsd, units, exchange) {
  const p = parseFloat(priceUsd);
  const u = parseFloat(units) || 1;
  const e = parseFloat(exchange) || 1;
  if (!isFinite(p)) return null;
  return Math.round(p * u * e);
}

// HTML-escape any user/DB-derived value before interpolating into the quotation HTML.
function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Contracts (Arabic  → src/routes/contracts.js
Object.assign(ctx, { escHtml, express, logLeadActivity, receiver, requireAuth, supabase });
Object.assign(ctx, require('./contracts'));
// Purchase Orders  → src/routes/purchase-orders.js
Object.assign(ctx, { escHtml, express, logLeadActivity, receiver, requireAuth, supabase });
Object.assign(ctx, require('./purchase-orders'));
// RFQ — Request for Quotation  → src/routes/rfq.js
Object.assign(ctx, { calcEgp, escHtml, express, fmtNum, generateQuoteId, getIsoWeek, logLeadActivity, quotationImgUpload, receiver, requireAuth, supabase });
Object.assign(ctx, require('./rfq'));

module.exports = { generateQuoteId, quotationImgUpload };
