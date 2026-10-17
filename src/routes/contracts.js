// Contracts (Arabic
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, logLeadActivity, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'logLeadActivity', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const createNotification = (...a) => ctx.createNotification(...a);
// Registered on the context by a module that loads later, so these are looked
// up when called rather than when required.
const renderQuotationPdf = (...a) => ctx.renderQuotationPdf(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Contracts (Arabic "عقد شراء وإستيراد سيارة لحساب الغير") ──────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Faithful reproduction of the company's signed paper contract: 6 A4 pages, RTL
// Arabic, company footer on every page. Every blank in the paper form is a field
// here — supplied values are printed inline, blanks fall back to dotted leaders.

function generateContractNo() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `MC${y}${m}-${rand}`;
}

const AR_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// Build the default (prefilled) contract payload from a lead + deal + settings.
function contractDefaults({ customer, deal, settings, vehicle }) {
  const s = settings || {};
  const c = customer || {};
  const d = deal || {};
  const cf = c.custom_fields || {};
  const now = new Date();
  const amount = d.budget_egp || cf.cf_vehicle_price || '';
  // The lead's requested vehicle is free text ("BYD Seal Design") — split it so
  // make/model land in their own rows, exactly like the paper form.
  const carText = String(vehicle || cf.cf_vehicle_offered || cf.cf_vehicle_requested || c.car_in_question || '').trim();
  const carBits = carText.split(/\s+/).filter(Boolean);
  return {
    contractDate: { day: AR_WEEKDAYS[now.getDay()], d: String(now.getDate()).padStart(2, '0'), m: String(now.getMonth() + 1).padStart(2, '0'), y: String(now.getFullYear()) },
    company: {
      name: s.company_name || 'MotoLinkers',
      commercialReg: s.company_commercial_reg || '282378',
      taxId: s.company_tax_id || '773934006',
      address: s.company_address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo',
      repIn: s.company_rep || '',
    },
    rep: { name: s.company_rep || '', nationalId: '', idDate: '', nationality: 'مصري', religion: '', address: '', role: 'مدير الشركة' },
    buyer: {
      name: c.name || '', nationalId: cf.cf_national_id || '', idDate: '',
      nationality: 'مصري', religion: 'مسلم', address: c.address || cf.cf_address || '',
    },
    vehicle: {
      make: carBits[0] || '', model: carBits.slice(1).join(' ') || '',
      color: cf.cf_color || '', year: cf.cf_year || '', notes: '',
    },
    importCountry: 'الصين',
    total: amount ? String(amount) : '', totalWords: '',
    payments: [
      { amount: '', when: 'فور التوقيع علي هذا العقد', label: '' },
      { amount: '', when: 'في موعد أقصاه خمسة عشر يوما من تاريخ توقيع هذا العقد', label: 'دفعة الشحن' },
      { amount: '', when: 'عند وصول السيارة الي الموانئ المصرية', label: 'دفعة ضريبه القيمة المضافة' },
      { amount: '', when: 'عند استلام السيارة', label: '' },
    ],
    lateFee: '', lateFeeWords: '',
    deliveryDeadline: '',
  };
}

// The contract builders live in src/lib/docs: contract.js picks the wording by the
// contract's own `data.template`, so one saved before the car-sale contract existed
// still re-exports with the words it was signed on.
const { buildContractHtml } = require('../lib/docs/contract');

// ── Contract routes ───────────────────────────────────────────────────────────
// Mounted twice: for the dashboard behind requireAuth and for the team portal
// behind requireEmployeeAuth, over one set of handlers rather than two — a fix
// here cannot land in one portal and miss the other. requirePerm waves the admin
// through (they have no req.employee) and checks the action for everyone else.
function mountContractRoutes(base, guard) {
  // ── Contract routes ───────────────────────────────────────────────────────────
  receiver.router.get(base, guard, requirePerm('contracts', 'view'), async (_req, res) => {
    const { data, error } = await supabase.from('contracts')
      .select('id,contract_no,title,status,customer_id,deal_id,created_by,created_at')
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  receiver.router.get(`${base}/:id`, guard, requirePerm('contracts', 'view'), async (req, res) => {
    const { data, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Contract not found' });
    res.json(data);
  });

  // Prefill payload for a brand-new contract (optionally seeded from a lead/deal).
  receiver.router.get(`${base}/new/defaults`, guard, requirePerm('contracts', 'create'), async (req, res) => {
    try {
      const customerId = req.query.customer_id ? parseInt(req.query.customer_id) : null;
      const dealId = req.query.deal_id ? parseInt(req.query.deal_id) : null;
      const [cust, deal, settingsRows] = await Promise.all([
        customerId ? supabase.from('customers').select('*').eq('id', customerId).single().then(r => r.data) : null,
        dealId ? supabase.from('deals').select('*').eq('id', dealId).single().then(r => r.data) : null,
        supabase.from('quotation_settings').select('key,value').then(r => r.data),
      ]);
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;
      res.json({ contract_no: generateContractNo(), data: contractDefaults({ customer: cust, deal, settings }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  receiver.router.post(base, guard, requirePerm('contracts', 'create'), express.json({ limit: '2mb' }), async (req, res) => {
    const b = req.body || {};
    const who = callerIdentity(req);
    const row = {
      contract_no: String(b.contract_no || '').trim() || generateContractNo(),
      title: String(b.title || '').trim(),
      data: b.data && typeof b.data === 'object' ? b.data : {},
      customer_id: b.customer_id ? parseInt(b.customer_id) : null,
      deal_id: b.deal_id ? parseInt(b.deal_id) : null,
      status: ['draft', 'signed', 'cancelled'].includes(b.status) ? b.status : 'draft',
      created_by: who.key,
    };
    const { data, error } = await supabase.from('contracts').insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
    // Timeline: show the contract on the attached lead's 360° profile
    if (data.customer_id) {
      logLeadActivity(data.customer_id, {
        type: 'note', body: `Contract generated — ${data.contract_no}`,
        meta: { contract_id: data.id, contract_no: data.contract_no },
        authorKey: who.key, authorName: who.name,
      });
    }
  });

  receiver.router.put(`${base}/:id`, guard, requirePerm('contracts', 'edit'), express.json({ limit: '2mb' }), async (req, res) => {
    const b = req.body || {};
    const upd = { updated_at: new Date().toISOString() };
    if (b.title != null) upd.title = String(b.title).trim();
    if (b.data && typeof b.data === 'object') upd.data = b.data;
    if (['draft', 'signed', 'cancelled'].includes(b.status)) upd.status = b.status;
    if (b.customer_id !== undefined) upd.customer_id = b.customer_id ? parseInt(b.customer_id) : null;
    const { data, error } = await supabase.from('contracts').update(upd).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  receiver.router.delete(`${base}/:id`, guard, requirePerm('contracts', 'delete'), async (req, res) => {
    const { error } = await supabase.from('contracts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // Render the Arabic contract to PDF (reuses the quotation Puppeteer renderer).
  receiver.router.post(`${base}/pdf`, guard, requirePerm('contracts', 'export'), express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const payload = (req.body && req.body.data) || {};
      const html = buildContractHtml(payload);
      const pdf = await renderQuotationPdf(html);
      res.json({ pdf: Buffer.from(pdf).toString('base64') });
    } catch (e) {
      console.error('[contract-pdf]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Render a saved contract by id (used by the lead profile's document viewer).
  receiver.router.post(`${base}/:id/pdf`, guard, requirePerm('contracts', 'export'), async (req, res) => {
    try {
      const { data: row, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
      if (error || !row) return res.status(404).json({ error: 'Contract not found' });
      const pdf = await renderQuotationPdf(buildContractHtml(row.data || {}));
      res.json({ pdf: Buffer.from(pdf).toString('base64'), name: row.contract_no || 'contract' });
    } catch (e) {
      console.error('[contract-pdf-id]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
mountContractRoutes('/api/dashboard/contracts', requireAuth);
mountContractRoutes('/api/employee/contracts', requireEmployeeAuth);

// ── Auto-generate a contract when a deal reaches the Won stage ────────────────
// Idempotent: one contract per deal (guarded by idx_contracts_deal_unique and an
// explicit lookup so re-entering Won never produces duplicates).
async function autoCreateContractForWonDeal(deal) {
  if (!deal || deal.stage !== 'won') return null;
  try {
    const { data: existing } = await supabase.from('contracts').select('id').eq('deal_id', deal.id).maybeSingle();
    if (existing) return null;
    const [cust, settingsRows] = await Promise.all([
      deal.customer_id ? supabase.from('customers').select('*').eq('id', deal.customer_id).single().then(r => r.data) : null,
      supabase.from('quotation_settings').select('key,value').then(r => r.data),
    ]);
    const settings = {};
    for (const row of settingsRows || []) settings[row.key] = row.value;
    const data = contractDefaults({ customer: cust, deal, settings, vehicle: deal.vehicle || deal.title });
    const title = `عقد — ${(cust && cust.name) || deal.title || ''}`.trim();
    const { data: row, error } = await supabase.from('contracts').insert({
      contract_no: generateContractNo(), title, data,
      customer_id: deal.customer_id || null, deal_id: deal.id,
      status: 'draft', created_by: 'auto_won',
    }).select().single();
    if (error) { console.warn('[contract] auto-create failed:', error.message); return null; }
    console.log('[contract] auto-generated', row.contract_no, 'for won deal', deal.id);
    if (deal.customer_id) {
      logLeadActivity(deal.customer_id, {
        type: 'note', body: `Contract ${row.contract_no} generated automatically (deal won)`,
        meta: { contract_id: row.id, contract_no: row.contract_no }, authorKey: 'system', authorName: 'System',
      });
    }
    createNotification('admin', {
      type: 'deal', title: 'Contract ready',
      body: `${title} — ${row.contract_no}`, url: '/dashboard#contracts',
    }, 'always');
    return row;
  } catch (e) { console.warn('[contract] auto-create error:', e.message); return null; }
}


module.exports = { autoCreateContractForWonDeal, buildContractHtml, renderQuotationPdf };
