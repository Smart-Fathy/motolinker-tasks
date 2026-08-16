// RFQ — Request for Quotation
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { calcEgp, escHtml, express, fmtNum, generateQuoteId, getIsoWeek, logLeadActivity, quotationImgUpload, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('calcEgp', 'escHtml', 'express', 'fmtNum', 'generateQuoteId', 'getIsoWeek', 'logLeadActivity', 'quotationImgUpload', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const runAutomations = (...a) => ctx.runAutomations(...a);
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);

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
  return {
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
}

function rfqBuildRow(body) {
  const b = body || {};
  const items = (Array.isArray(b.items) ? b.items : []).map(rfqBuildItem)
    .filter(it => it.brand || it.model || it.trim || it.fob_price || it.cif_price);
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


  receiver.router.post(`${base}/pdf`, guard, requirePerm('rfq', 'export'), express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const html = buildRfqHtml({ ...rfqBuildRow(req.body), settings: await rfqSettings() });
      res.json({ pdf: Buffer.from(await renderQuotationPdf(html)).toString('base64') });
    } catch (e) { console.error('[rfq-pdf]', e); res.status(500).json({ error: e.message }); }
  });

  receiver.router.post(`${base}/:id/pdf`, guard, requirePerm('rfq', 'export'), async (req, res) => {
    try {
      const { data: row, error } = await supabase.from('rfqs').select('*').eq('id', req.params.id).single();
      if (error || !row) return res.status(404).json({ error: 'RFQ not found' });
      const html = buildRfqHtml({ ...row, settings: await rfqSettings() });
      res.json({ pdf: Buffer.from(await renderQuotationPdf(html)).toString('base64'), name: row.rfq_no || 'rfq' });
    } catch (e) { console.error('[rfq-pdf-id]', e); res.status(500).json({ error: e.message }); }
  });
}
mountRfqRoutes('/api/dashboard/rfqs', requireAuth);
mountRfqRoutes('/api/employee/rfqs', requireEmployeeAuth);

// A4 portrait Request for Quotation on company letterhead.
function buildRfqHtml(r) {
  const s = r.settings || {};
  const T = quoteTheme(r.template);
  const money = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const items = Array.isArray(r.items) ? r.items : [];
  const padded = items.concat(Array.from({ length: Math.max(0, 8 - items.length) }, () => null));
  const rows = padded.map(it => {
    const v = it || {};
    return `<tr>
      <td>${escHtml(v.brand || '')}</td>
      <td>${escHtml(v.model || '')}</td>
      <td>${escHtml(v.trim || '')}</td>
      <td>${escHtml(v.colour || '')}</td>
      <td class="c">${escHtml(v.year || '')}</td>
      <td class="acc">${escHtml(v.accessories || ctx.DOC_DEFAULT_ACCESSORIES).replace(/\n/g, '<br>')}</td>
      <td class="c">${escHtml(v.lead_time || '')}</td>
      <td class="r">${v.fob_price ? money(v.fob_price) : ''}</td>
      <td class="r">${v.cif_price ? money(v.cif_price) : ''}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">${T.fontLink}
<style>${docChromeCss(T)}</style></head><body>
<div class="page">
  <div class="head">
    <img src="${BRAND_LOGO_URL}">
    <div class="title">Request for Quotation</div>
    <table class="meta">
      <tr><td class="k">ID</td><td class="v">${escHtml(r.rfq_no || '')}</td></tr>
      <tr><td class="k">Date</td><td class="v">${escHtml(r.rfq_date || '')}</td></tr>
      <tr><td class="k">Issuer</td><td class="v">${escHtml(r.issuer || '')}</td></tr>
    </table>
  </div>

  ${docSupplierBlock(r)}

  <table class="grid">
    <colgroup>
      <col style="width:66px"><col style="width:62px"><col style="width:44px"><col style="width:76px">
      <col style="width:34px"><col style="width:150px"><col style="width:60px"><col style="width:62px">
      <col style="width:88px">
    </colgroup>
    <thead><tr>
      <th>BRAND</th><th>MODEL</th><th>TRIM</th><th>COLOR EXT / INT</th><th>YEAR</th>
      <th>ACCESSORIES / REMARKS</th><th>LEAD TIME</th><th>FOB PRICE</th><th>CIF PRICE (RoRo)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${docTermsHtml(r, { incoterm: false })}

  ${docFooterHtml(s)}
</div>
</body></html>`;
}

// Render quotation HTML to a PDF buffer via Puppeteer, blocking any resource
// load that isn't an inline data: URL or https: (prevents file:// LFI and
// internal http:// SSRF from authored/injected markup).
async function renderQuotationPdf(html, opts) {
  const { landscape = false } = opts || {};
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith('data:') || u.startsWith('https:')) r.continue();
      else r.abort();
    });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  } finally {
    await browser.close();
  }
}

// Company logo used on every generated document (quotation + contract).

// Selectable quotation looks. Both render the SAME structure — only the palette
// and typography differ — so switching a quote between them never moves content.
const QUOTE_THEMES = {
  classic: {
    key: 'classic', label: 'Classic — navy & gold',
    accent: '#c9922a', ink: '#1B2D6B', soft: '#f5e9c8',
    zebra: '#fdfaf3', meta: '#cc3300',
    titleFont: 'Arial, sans-serif', titleSpacing: '2px', fontLink: '',
  },
  brand: {
    key: 'brand', label: 'Brand — charcoal & gold',
    accent: '#c9a35e', ink: '#1b1b1f', soft: '#f7efdf',
    zebra: '#faf7f0', meta: '#a07e3f',
    titleFont: "'Cormorant Garamond', Georgia, serif", titleSpacing: '4px',
    fontLink: '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&display=swap" rel="stylesheet">',
  },
};
function quoteTheme(key) { return QUOTE_THEMES[key] || QUOTE_THEMES.classic; }

function buildQuotationHtml(data) {
  const { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings } = data;
  const s = settings || {};
  const exRate = parseFloat(exchange) || 1;
  const T = quoteTheme(data.template);

  // Calculate totals
  let grandTotal = 0;
  const itemRows = (items || []).map(item => {
    const isFree  = !item.priceUsd || String(item.priceUsd).trim().toLowerCase() === 'free';
    const egp     = isFree ? null : calcEgp(item.priceUsd, item.unit || 1, exRate);
    if (egp !== null) grandTotal += egp;
    return { ...item, egp };
  });

  const logisticsRows = (logistics || []).map(row => {
    const egp = calcEgp(row.priceUsd, 1, exRate);
    if (egp !== null) grandTotal += egp;
    return { ...row, egp };
  });

  const GOLD   = T.accent;   // accent / hairlines
  const NAVY   = T.ink;      // primary ink + header fills
  const LGOLD  = T.soft;     // soft fill behind labels & totals

  const imgSection = imageDataUrls && imageDataUrls.length
    ? `<tr><td colspan="4" style="padding:10px 0;border:1px solid ${GOLD};border-top:none">
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          ${imageDataUrls.map(src => `<img src="${escHtml(src)}" style="height:130px;max-width:220px;object-fit:contain;border-radius:4px;border:1px solid ${GOLD}">`).join('')}
        </div>
       </td></tr>`
    : '';

  const vehicleRow = vehicleModel
    ? `<tr><td colspan="4" style="text-align:center;font-size:17px;font-weight:700;color:${T.meta};padding:10px 8px;border:1px solid ${GOLD};border-bottom:none">${escHtml(vehicleModel)}</td></tr>`
    : '';

  const itemRowsHtml = itemRows.map((item, i) => {
    const isFree = item.egp === null;
    const bg = i % 2 === 1 ? `background:${T.zebra}` : '';
    return `<tr style="${bg}">
      <td style="padding:7px 10px;border:1px solid ${GOLD};color:${NAVY}">${escHtml(item.name || '')}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${escHtml(item.unit || 1)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${isFree ? 'Free' : fmtNum(item.priceUsd)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${isFree ? 'Free' : fmtNum(item.egp)}</td>
    </tr>`;
  }).join('');

  const logRowsHtml = logisticsRows.map((row, i) => {
    const bg = i % 2 === 1 ? `background:${T.zebra}` : '';
    return `<tr style="${bg}">
      <td colspan="2" style="padding:7px 10px;border:1px solid ${GOLD};color:${NAVY}">${escHtml(row.label)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${fmtNum(row.priceUsd)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${fmtNum(row.egp)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">${T.fontLink}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: ${NAVY}; background: #fff; padding: 0; }
  .page { width: 794px; min-height: 1123px; padding: 24px 28px 80px; position: relative; }

  .logo-text { font-size: 22px; font-weight: 900; letter-spacing: 1px; color: ${NAVY}; }
  .logo-link { color: ${GOLD}; }

  .header-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .quotation-title { font-family: ${T.titleFont}; font-size: 24px; font-weight: 900;
    letter-spacing: ${T.titleSpacing}; color: ${NAVY}; text-align: center; }
  .section-label, .col-header, .total-row td, .ks-label, .meta-label { font-family: ${T.titleFont}; }

  .meta-table { border-collapse: collapse; width: 100%; }
  .meta-table td { padding: 3px 8px; border: 1px solid ${GOLD}; font-size: 10px; }
  .meta-label { font-weight: 700; color: ${NAVY}; background: ${LGOLD}; white-space: nowrap; }
  .meta-val   { font-weight: 700; color: ${T.meta}; min-width: 120px; }

  .section-label { font-weight: 700; font-size: 11px; color: ${NAVY}; padding: 6px 10px;
    border: 1px solid ${GOLD}; background: #fff; margin-top: 10px; }

  .main-table { width: 100%; border-collapse: collapse; }
  .col-header { background: ${NAVY}; color: #fff; font-weight: 700; font-size: 11px;
    padding: 7px 10px; text-align: center; border: 1px solid ${GOLD}; }
  .col-header-left { text-align: left; }

  .total-row td { font-weight: 700; color: ${NAVY}; background: ${LGOLD}; padding: 8px 10px;
    border: 1px solid ${GOLD}; font-size: 12px; }

  .key-specs-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .ks-label { font-weight: 700; background: ${LGOLD}; padding: 6px 10px; border: 1px solid ${GOLD}; white-space: nowrap; color: ${NAVY}; }
  .ks-val   { padding: 6px 10px; border: 1px solid ${GOLD}; color: ${NAVY}; }

  .payment-box { border: 1px solid ${GOLD}; padding: 10px 14px; font-size: 10px; line-height: 1.8; color: ${NAVY}; }
  .payment-title { font-weight: 700; margin-bottom: 4px; }

  .footer { position: absolute; bottom: 16px; left: 28px; right: 28px;
    border-top: 2px solid ${GOLD}; padding-top: 8px;
    display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #888; }
  .footer-brand { font-weight: 700; color: ${NAVY}; font-size: 10px; }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <table class="header-table">
    <tr>
      <td style="width:35%;vertical-align:middle">
        <img src="${BRAND_LOGO_URL}" style="max-height:60px;width:auto;display:block">
      </td>
      <td style="width:30%;text-align:center;vertical-align:middle">
        <div class="quotation-title">QUOTATION</div>
      </td>
      <td style="width:35%;vertical-align:top">
        <table class="meta-table">
          <tr><td class="meta-label">ID</td><td class="meta-val">${escHtml(id || '')}</td></tr>
          <tr><td class="meta-label">DATE</td><td class="meta-val">${escHtml(date || '')}</td></tr>
          <tr><td class="meta-label">VALID TO</td><td class="meta-val">${escHtml(validTo || '')}</td></tr>
          <tr><td class="meta-label">NAME</td><td class="meta-val">${escHtml(name || '')}</td></tr>
        </table>
      </td>
    </tr>
  </table>
  <div style="border-top: 2px solid ${GOLD}; margin-bottom: 10px"></div>

  <!-- VEHICLE + IMAGES -->
  <table class="main-table">
    ${vehicleRow}
    ${imgSection}
  </table>

  <!-- PRICING BREAKDOWN -->
  <div class="section-label">PRICING BREAKDOWN</div>
  <table class="main-table">
    <thead>
      <tr>
        <th class="col-header col-header-left" style="width:50%">ITEM</th>
        <th class="col-header" style="width:10%">UNIT</th>
        <th class="col-header" style="width:20%">PRICE USD</th>
        <th class="col-header" style="width:20%">TOTAL EGP</th>
      </tr>
    </thead>
    <tbody>${itemRowsHtml}</tbody>
  </table>

  <!-- LOGISTICS PRICING BREAKDOWN -->
  <div class="section-label" style="margin-top:0;border-top:none">LOGISTICS PRICING BREAKDOWN</div>
  <table class="main-table">
    <thead>
      <tr>
        <th class="col-header col-header-left" colspan="2" style="width:60%">ITEM</th>
        <th class="col-header" style="width:20%">PRICE USD</th>
        <th class="col-header" style="width:20%">TOTAL EGP</th>
      </tr>
    </thead>
    <tbody>
      ${logRowsHtml}
      <tr class="total-row">
        <td colspan="3">Total Price Breakdown in EGP</td>
        <td style="text-align:center">${fmtNum(grandTotal)}</td>
      </tr>
    </tbody>
  </table>

  <!-- KEY SPECS (left) + PAYMENT TERMS / CURRENCY / EXCHANGE (right) -->
  ${(() => {
    const leftContent = [
      issuer ? `<div><strong>Issuer:</strong> ${escHtml(issuer)}</div>` : '',
      ...(customSpecs || []).map(sp => sp.key ? `<div><strong>${escHtml(sp.key)}:</strong> ${escHtml(sp.val || '')}</div>` : `<div>${escHtml(sp.val || '')}</div>`),
    ].filter(Boolean).join('');
    const rightBox = `
      <div style="width:46%;border:1px solid ${GOLD};padding:12px 16px;font-size:10.5px;line-height:2;color:${NAVY};${leftContent ? '' : 'margin-left:auto'}">
        <div style="font-weight:700;margin-bottom:4px">Payment terms</div>
        ${(s.payment_terms || '50% Down payment operations start\n30% Upon shipping from supplier\n20% Upon Custom clearances').split('\n').map(l => `<div style="padding-left:14px">${escHtml(l)}</div>`).join('')}
        <div style="margin-top:8px;border-top:1px solid ${GOLD};padding-top:6px">
          <div><strong>Currency:</strong> ${escHtml(currency || 'EGP')}</div>
          <div><strong>Exchange:</strong> ${fmtNum(exchange)}</div>
        </div>
      </div>`;
    return `
  <div style="margin-top:14px">
    <div class="section-label" style="margin-top:0">KEY SPECS</div>
    <div style="display:flex;gap:14px;align-items:stretch">
      ${leftContent ? `<div style="flex:1;border:1px solid ${GOLD};padding:12px 16px;font-size:10.5px;line-height:2;color:${NAVY}">${leftContent}</div>` : ''}
      ${rightBox}
    </div>
  </div>`;
  })()}

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-brand">${escHtml(s.company_name || 'MOTOLINKERS')}</div>
    <div>This quotation is valid until ${escHtml(validTo || '—')} | ${escHtml(s.footer_note || 'Confidential')}</div>
    <div>${escHtml(id || '')}</div>
  </div>

  <!-- COMPANY CONTACT FOOTER -->
  <div style="border:2px solid ${NAVY};border-radius:8px;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:16px">
    <div style="display:flex;flex-direction:column;gap:3px;font-size:9px;color:#333;line-height:1.5">
      <div><strong>Address:</strong> ${escHtml(s.company_address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo')}</div>
      <div><strong>Email:</strong> ${escHtml(s.company_email || 'info@motolinkers.com')} &nbsp;|&nbsp; <strong>Website:</strong> ${escHtml(s.company_website || 'Motolinkers.com')} &nbsp;|&nbsp; <strong>Phone:</strong> ${escHtml(s.company_phone || '+2 010 000 78104')}</div>
      ${s.company_tax_id ? `<div><strong>TAX ID:</strong> ${escHtml(s.company_tax_id)} &nbsp;|&nbsp; <strong>Registration No:</strong> ${escHtml(s.company_reg_no || '')}</div>` : `<div><strong>TAX ID:</strong> 773934006 &nbsp;|&nbsp; <strong>Registration No:</strong> 282378</div>`}
    </div>
    <div style="margin-left:20px;flex-shrink:0">
      <img src="${BRAND_LOGO_URL}" style="max-height:45px;width:auto;display:block">
    </div>
  </div>

</div>
</body></html>`;
}

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


module.exports = { buildQuotationHtml, buildRfqHtml, quoteTheme, renderQuotationPdf, rfqSettings };
