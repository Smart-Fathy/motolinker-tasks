// Quotations — drafted in a sheet, like purchase orders and RFQs, by both portals.
//
// This replaces two nearly identical implementations: a ~620-line static page in
// dashboard.html + dashboard.js and a ~440-line emp-qt-* copy in employee.js.
// The user's ask was parity — "the user sees the same way to input the data" —
// so the draft is now the same wide modal sheet the PO and RFQ use: a header
// grid, a real line-item table with running totals, and Save & preview in the
// footer. The server contract is untouched: the multipart POST to
// …/quotation/generate carries byte-identical field names, so every saved
// quotation still opens, edits and regenerates.
//
// Portal seams: PROCFG (base/fetch/modal/closeModal/toast/can) like the rest of
// the shared modules, plus QTCFG for the three lists that genuinely differ per
// portal: who can be the issuer, which leads are pickable, and who can be
// notified from settings.
(function () {

  function qPath(url) {
    const u = String(url);
    if (PROCFG.base === '/api/dashboard') return u;
    return u.replace(/^\/api\/dashboard/, PROCFG.base);
  }
  const qFetch = (url, opts) => PROCFG.fetch(qPath(url), opts);
  const qCan = (section, action) => !PROCFG.can || PROCFG.can(section, action);

  const LOGISTICS_LABELS = [
    'Ocean Freight',
    'THC, Documentation & Clearances',
    'Customs Vat & Tax',
    'Last Mile Wench to Door',
    'Service Fees',
  ];

  let qtImages = [];          // newly-picked File objects
  let qtExistingImages = [];  // data-URLs restored from a saved quote
  let qtEditingPk = null;     // DB id being edited in place (null = new)
  let qtPdfBase64 = null;

  // ── The page: tabs + shells ─────────────────────────────────────────────────
  function initQuotationPage() {
    const settings = document.getElementById('qt-panel-settings');
    if (settings && !settings.dataset.built) { settings.innerHTML = qtSettingsHtml(); settings.dataset.built = '1'; }
    switchQtTab('draft');
  }
  function switchQtTab(tab) {
    ['draft', 'history', 'settings'].forEach(t => {
      const b = document.getElementById('qt-tab-' + t);
      const p = document.getElementById('qt-panel-' + t);
      if (b) b.classList.toggle('active', t === tab);
      if (p) p.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'history') loadQtHistory();
    if (tab === 'settings') loadQtSettings();
    requestAnimationFrame(() => lucide.createIcons());
  }

  // ── The sheet ───────────────────────────────────────────────────────────────
  const F = 'style="width:100%"';
  function headField(label, inner) {
    return `<div><div style="font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);margin-bottom:4px">${label}</div>${inner}</div>`;
  }

  async function openQuoteForm(saved, opts) {
    const editing = !!(saved && opts && opts.editing);
    const d = (saved && saved.data) || {};
    qtEditingPk = editing ? saved.id : null;
    qtImages = [];
    qtExistingImages = Array.isArray(d.imageDataUrls) ? [...d.imageDataUrls] : [];
    qtPdfBase64 = null;

    const [issuers, leads] = await Promise.all([
      QTCFG.issuers().catch(() => []),
      QTCFG.leads().catch(() => []),
    ]);
    const today = new Date();
    const valid = new Date(today); valid.setDate(valid.getDate() + 7);
    const fmt = x => x.toISOString().split('T')[0];

    PROCFG.modal(editing ? `Edit quotation — ${esc(d.id || saved.quote_id || '')}` : 'New quotation', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
        ${headField('Quote ID', `<div style="display:flex;gap:6px"><input class="form-control" id="qt-id" value="${esc(d.id || '')}" ${F}>
          <button class="btn btn-outline btn-sm" onclick="refreshQuoteId()" title="Generate a fresh ID">↻</button></div>`)}
        ${headField('Date', `<input class="form-control" id="qt-date" type="date" value="${esc(d.date || fmt(today))}">`)}
        ${headField('Valid to', `<input class="form-control" id="qt-valid-to" type="date" value="${esc(d.validTo || fmt(valid))}">`)}
        ${headField('Issuer', `<select class="form-control" id="qt-issuer">
          <option value="">— Select issuer —</option>
          ${issuers.map(n => `<option value="${esc(n)}" ${d.issuer === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>`)}
        ${headField('Customer name', `<input class="form-control" id="qt-name" value="${esc(d.name || '')}" placeholder="e.g. Ahmed Kamal">`)}
        ${headField('Vehicle', `<input class="form-control" id="qt-vehicle" value="${esc(d.vehicleModel || '')}" placeholder="e.g. BYD Seal">`)}
        ${headField('Currency', `<select class="form-control" id="qt-currency">
          <option value="EGP" ${d.currency === 'EGP' ? 'selected' : ''}>EGP — Egyptian Pound</option>
          <option value="USD" ${d.currency === 'USD' ? 'selected' : ''}>USD — US Dollar</option>
        </select>`)}
        ${headField('Exchange rate', `<input class="form-control" id="qt-exchange" type="number" min="0" step="0.01" value="${esc(d.exchange || '')}" placeholder="USD → EGP" oninput="qtRecalcAll()">`)}
        ${headField('Design', `<select class="form-control" id="qt-template">
          <option value="classic" ${d.template !== 'brand' ? 'selected' : ''}>Classic — navy &amp; gold</option>
          <option value="brand" ${d.template === 'brand' ? 'selected' : ''}>Brand — charcoal &amp; gold</option>
        </select>`)}
        ${qCan('quotation', 'attachLead') ? headField('Lead', `<select class="form-control" id="qt-customer-id">
          <option value="">— No lead —</option>
          ${leads.map(l => `<option value="${l.id}" ${saved && String(saved.customer_id) === String(l.id) ? 'selected' : ''}>${esc(l.name)}${l.phone ? ' · ' + esc(l.phone) : ''}</option>`).join('')}
        </select>`) : '<input type="hidden" id="qt-customer-id" value="">'}
      </div>

      <div style="font-weight:700;font-size:13px;margin:6px 0 8px">Pricing</div>
      <div style="overflow-x:auto"><table id="qt-grid" style="width:100%;min-width:640px;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          <th style="padding:6px 8px;width:34px">#</th><th style="padding:6px 8px">Item</th>
          <th style="padding:6px 8px;width:80px">Units</th><th style="padding:6px 8px;width:170px">Price USD</th>
          <th style="padding:6px 8px;width:130px">Total EGP</th><th style="width:36px"></th>
        </tr></thead>
        <tbody id="qt-items"></tbody>
      </table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 14px">
        <button class="btn btn-outline btn-sm" onclick="addPricingRow()">+ Add line</button>
        <div style="font-size:13px">Grand total: <strong id="qt-grand-total" style="font-size:15px">0</strong> EGP</div>
      </div>

      <div style="font-weight:700;font-size:13px;margin:6px 0 8px">Logistics</div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:14px">
        <tbody id="qt-logistics"></tbody>
      </table>

      <div style="font-weight:700;font-size:13px;margin:6px 0 8px">Custom lines <span style="color:var(--muted);font-weight:400">(printed under the specs)</span></div>
      <div id="qt-custom-specs"></div>
      <button class="btn btn-outline btn-sm" onclick="addCustomSpecRow('qt-custom-specs')" style="margin-bottom:14px">+ Add line</button>

      <div style="font-weight:700;font-size:13px;margin:6px 0 8px">Vehicle photos <span style="color:var(--muted);font-weight:400">(up to 5, printed on the PDF)</span></div>
      <div id="qt-img-drop" ondrop="event.preventDefault();handleImgDrop(event)" ondragover="event.preventDefault()"
        onclick="document.getElementById('qt-img-input').click()"
        style="border:1.5px dashed var(--border);border-radius:10px;padding:18px;text-align:center;color:var(--muted);font-size:12.5px;cursor:pointer;margin-bottom:8px">
        Drop images here or click to choose
        <input type="file" id="qt-img-input" accept="image/*" multiple style="display:none" onchange="handleImgSelect(this.files)">
      </div>
      <div id="qt-img-preview" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"></div>

      <div id="qt-error" class="error-msg" style="display:none"></div>`,
      `<button class="btn btn-outline" onclick="PROCFG.closeModal()">Cancel</button>
       <button class="btn btn-primary" id="qt-generate-btn" onclick="generateQuotation()">
         <i data-lucide="file-badge" style="width:15px;height:15px"></i> ${editing ? 'Update & preview PDF' : 'Generate PDF'}</button>`,
      { wide: true });

    // Rows
    const items = (d.items || []);
    if (items.length) items.forEach(it => addPricingRow(it.name, it.unit, it.priceUsd === 'Free' ? 'Free' : it.priceUsd, it.priceUsd === 'Free'));
    else addPricingRow();
    buildLogisticsRows();
    (d.logistics || []).forEach((lg, i) => { const el = document.getElementById(`qt-log-usd-${i}`); if (el) el.value = (lg && lg.priceUsd && lg.priceUsd !== '0') ? lg.priceUsd : ''; });
    (d.customSpecs || []).forEach(s => { addCustomSpecRow('qt-custom-specs'); const rows = document.querySelectorAll('#qt-custom-specs .qt-custom-spec-row'); const inp = rows[rows.length - 1] && rows[rows.length - 1].querySelector('input'); if (inp) inp.value = s.val || s.key || ''; });
    renderImgPreviews();
    if (!d.id && !document.getElementById('qt-id').value) refreshQuoteId();
    qtRecalcAll();
    if (opts && opts.lead) qtPrefillFromLead(opts.lead);
    requestAnimationFrame(() => lucide.createIcons());
  }

  // The lead profile's "Generate quote" button lands here in both portals.
  function qtPrefillFromLead(c) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    set('qt-name', c.name);
    const cfq = c.custom_fields || {};
    const vehName = cfq.cf_vehicle_offered || c.car_in_question || cfq.cf_vehicle_requested || '';
    set('qt-vehicle', vehName);
    set('qt-customer-id', String(c.id));
    const vehImgs = Array.isArray(cfq.cf_vehicle_images) ? cfq.cf_vehicle_images : [];
    if (vehImgs.length) { qtExistingImages = vehImgs.slice(0, 5); renderImgPreviews(); }
    const vp = Number(cfq.cf_vehicle_price) || 0;
    if (vp > 0) {
      const ex = getExchange();
      const tbody = document.getElementById('qt-items');
      if (tbody && tbody.children.length === 1 && !tbody.querySelector('input').value) tbody.innerHTML = '';
      addPricingRow(vehName || 'Vehicle', 1, ex > 0 ? Math.round(vp / ex) : vp);
    }
  }

  async function refreshQuoteId() {
    try {
      const d = await qFetch('/api/dashboard/quotation/newid').then(r => r.json());
      document.getElementById('qt-id').value = d.id;
    } catch (_) {}
  }

  function buildLogisticsRows() {
    const tbody = document.getElementById('qt-logistics');
    tbody.innerHTML = LOGISTICS_LABELS.map((label, i) => `
      <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
        <td style="padding:6px 8px;font-size:13px">${esc(label)}</td>
        <td style="padding:6px 8px;width:170px"><input class="form-control" id="qt-log-usd-${i}" type="number" min="0" step="0.01" placeholder="0 USD" oninput="recalcLogistics(${i})" style="text-align:center"></td>
        <td style="padding:6px 8px;width:130px"><input class="form-control" id="qt-log-egp-${i}" readonly placeholder="EGP" style="background:rgba(255,255,255,.03);text-align:center;font-weight:600"></td>
      </tr>`).join('');
  }

  function addPricingRow(name = '', unit = 1, priceUsd = '', isFree = false) {
    const tbody = document.getElementById('qt-items');
    const tr = document.createElement('tr');
    tr.className = 'qt-item-row';
    tr.style.cssText = 'border-bottom:1px solid rgba(255,255,255,.04)';
    tr.innerHTML = `
      <td class="qt-line-no" style="padding:6px 8px;color:var(--muted)"></td>
      <td style="padding:6px 8px"><input class="form-control" placeholder="Item name…" value="${esc(name)}" oninput="recalcItem(this)"></td>
      <td style="padding:6px 8px"><input class="form-control" type="number" min="1" step="1" value="${unit}" style="text-align:center" oninput="recalcItem(this)"></td>
      <td style="padding:6px 8px"><div style="position:relative">
        <input class="form-control" placeholder="e.g. 22500 or Free" value="${esc(priceUsd)}" ${isFree ? 'readonly' : ''} oninput="recalcItem(this)" style="padding-right:50px">
        <span onclick="toggleFreeItem(this)" title="Mark as Free"
          style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;cursor:pointer;padding:2px 6px;border-radius:4px;background:${isFree ? 'var(--primary)' : 'rgba(255,255,255,.08)'};color:${isFree ? '#fff' : 'var(--muted)'}">FREE</span>
      </div></td>
      <td style="padding:6px 8px"><input class="form-control" readonly placeholder="Auto" style="background:rgba(255,255,255,.03);text-align:center;font-weight:600"></td>
      <td style="padding:6px 8px"><button class="qt-remove" onclick="this.closest('.qt-item-row').remove();qtRenumber();recalcGrandTotal()"
        style="background:rgba(248,113,113,.12);border:none;border-radius:6px;color:var(--danger);cursor:pointer;width:26px;height:26px;display:flex;align-items:center;justify-content:center">✕</button></td>`;
    tbody.appendChild(tr);
    qtRenumber();
    recalcGrandTotal();
  }
  function qtRenumber() {
    document.querySelectorAll('#qt-items .qt-line-no').forEach((td, i) => { td.textContent = i + 1; });
  }

  function toggleFreeItem(btn) {
    const isNowFree = btn.style.background !== 'var(--primary)' && !btn.style.background.includes('124,106,255');
    btn.style.background = isNowFree ? 'var(--primary)' : 'rgba(255,255,255,.08)';
    btn.style.color = isNowFree ? '#fff' : 'var(--muted)';
    const input = btn.closest('div').querySelector('input');
    if (isNowFree) { input.value = 'Free'; input.readOnly = true; }
    else { input.value = ''; input.readOnly = false; }
    recalcItem(input);
  }

  function getExchange() { return parseFloat(document.getElementById('qt-exchange')?.value) || 0; }

  function recalcItem(inputEl) {
    const row = inputEl.closest('.qt-item-row');
    const inputs = row.querySelectorAll('input');
    const priceRaw = inputs[2].value.trim();
    const unitVal = parseFloat(inputs[1].value) || 1;
    const isFree = priceRaw.toLowerCase() === 'free' || priceRaw === '';
    const egpInput = inputs[3];
    if (isFree) { egpInput.value = priceRaw.toLowerCase() === 'free' ? 'Free' : ''; }
    else {
      const price = parseFloat(priceRaw);
      const exRate = getExchange();
      egpInput.value = (isFinite(price) && exRate > 0) ? Math.round(price * unitVal * exRate).toLocaleString() : '';
    }
    recalcGrandTotal();
  }

  function recalcLogistics(i) {
    const usdEl = document.getElementById(`qt-log-usd-${i}`);
    const egpEl = document.getElementById(`qt-log-egp-${i}`);
    if (!usdEl || !egpEl) return;
    const usd = parseFloat(usdEl.value) || 0;
    const exRate = getExchange();
    egpEl.value = exRate > 0 ? Math.round(usd * exRate).toLocaleString() : '';
    recalcGrandTotal();
  }

  function qtRecalcAll() {
    document.querySelectorAll('.qt-item-row').forEach(row => recalcItem(row.querySelectorAll('input')[0]));
    LOGISTICS_LABELS.forEach((_, i) => recalcLogistics(i));
  }

  function addCustomSpecRow(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'qt-custom-spec-row';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 36px;gap:8px;margin-bottom:8px;align-items:center';
    row.innerHTML = `
      <input class="form-control" placeholder="e.g. Incoterms: CIF">
      <button onclick="this.closest('.qt-custom-spec-row').remove()"
        style="background:rgba(248,113,113,.12);border:none;border-radius:6px;color:var(--danger);cursor:pointer;height:26px">✕</button>`;
    container.appendChild(row);
  }

  function recalcGrandTotal() {
    let total = 0;
    document.querySelectorAll('.qt-item-row').forEach(row => {
      const n = parseFloat(row.querySelectorAll('input')[3].value.replace(/,/g, ''));
      if (isFinite(n)) total += n;
    });
    LOGISTICS_LABELS.forEach((_, i) => {
      const egpEl = document.getElementById(`qt-log-egp-${i}`);
      if (egpEl) { const n = parseFloat((egpEl.value || '').replace(/,/g, '')); if (isFinite(n)) total += n; }
    });
    const el = document.getElementById('qt-grand-total');
    if (el) el.textContent = total.toLocaleString();
  }

  // ── Images ──────────────────────────────────────────────────────────────────
  function handleImgSelect(files) { addImages(Array.from(files)); }
  function handleImgDrop(e) { addImages(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))); }
  function addImages(newFiles) {
    const remaining = 5 - (qtImages.length + qtExistingImages.length);
    qtImages = qtImages.concat(newFiles.slice(0, Math.max(0, remaining)));
    renderImgPreviews();
  }
  function imgPreviewWrap(src, onRemove) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:inline-block';
    wrap.innerHTML = `<img src="${src}" style="height:90px;width:120px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">
      <button onclick="${onRemove}"
        style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,.6);border:none;border-radius:50%;width:20px;height:20px;color:#fff;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0">×</button>`;
    return wrap;
  }
  function renderImgPreviews() {
    const container = document.getElementById('qt-img-preview');
    if (!container) return;
    container.innerHTML = '';
    qtExistingImages.forEach((src, i) => container.appendChild(imgPreviewWrap(src, `removeExistingImg(${i})`)));
    qtImages.forEach((file, i) => container.appendChild(imgPreviewWrap(URL.createObjectURL(file), `removeImg(${i})`)));
    const drop = document.getElementById('qt-img-drop');
    if (drop) drop.style.display = (qtImages.length + qtExistingImages.length) >= 5 ? 'none' : '';
  }
  function removeImg(i) { qtImages.splice(i, 1); renderImgPreviews(); }
  function removeExistingImg(i) { qtExistingImages.splice(i, 1); renderImgPreviews(); }

  // ── Generate — the untouched server contract ────────────────────────────────
  async function generateQuotation() {
    const btn = document.getElementById('qt-generate-btn');
    const err = document.getElementById('qt-error');
    err.style.display = 'none';

    const id = document.getElementById('qt-id').value.trim();
    const date = document.getElementById('qt-date').value;
    const validTo = document.getElementById('qt-valid-to').value;
    const name = document.getElementById('qt-name').value.trim();
    const vehicle = document.getElementById('qt-vehicle').value.trim();
    const exchange = document.getElementById('qt-exchange').value;
    const currency = document.getElementById('qt-currency').value;
    const issuer = document.getElementById('qt-issuer').value;

    if (!id || !date || !name) { err.textContent = 'Please fill in ID, Date and Customer Name.'; err.style.display = 'block'; return; }
    if (!exchange || parseFloat(exchange) <= 0) { err.textContent = 'Please enter a valid Exchange Rate.'; err.style.display = 'block'; return; }

    const items = [];
    document.querySelectorAll('.qt-item-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      const itemName = inputs[0].value.trim();
      if (!itemName) return;
      items.push({ name: itemName, unit: inputs[1].value || '1', priceUsd: inputs[2].value.trim() });
    });
    const logistics = LOGISTICS_LABELS.map((label, i) => ({
      label, priceUsd: (document.getElementById(`qt-log-usd-${i}`) || {}).value || '0',
    }));
    const customSpecs = [];
    document.querySelectorAll('#qt-custom-specs .qt-custom-spec-row').forEach(row => {
      const val = row.querySelector('input') && row.querySelector('input').value.trim();
      if (val) customSpecs.push({ key: '', val });
    });

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating…';
    try {
      const formData = new FormData();
      formData.append('id', id);
      formData.append('date', date);
      formData.append('validTo', validTo);
      formData.append('name', name);
      formData.append('vehicleModel', vehicle);
      formData.append('currency', currency);
      formData.append('exchange', exchange);
      formData.append('issuer', issuer);
      formData.append('items', JSON.stringify(items));
      formData.append('logistics', JSON.stringify(logistics));
      formData.append('customSpecs', JSON.stringify(customSpecs));
      const qtLeadId = (document.getElementById('qt-customer-id') || {}).value || '';
      if (qtLeadId) formData.append('customer_id', qtLeadId);
      formData.append('template', (document.getElementById('qt-template') || {}).value || 'classic');
      formData.append('existingImages', JSON.stringify(qtExistingImages));
      if (qtEditingPk) formData.append('quotation_pk', String(qtEditingPk));
      qtImages.forEach(f => formData.append('images', f));

      const res = await qFetch('/api/dashboard/quotation/generate', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      qtPdfBase64 = data.pdf;
      PROCFG.closeModal();
      qtShowPdf(id);
      loadQtHistory();
    } catch (e) {
      err.textContent = 'Error: ' + e.message;
      err.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="file-badge" style="width:15px;height:15px"></i> Generate PDF';
      requestAnimationFrame(() => lucide.createIcons());
    }
  }

  // The generated PDF opens in the shared document viewer both portals have —
  // the bespoke qt-modal is gone with the rest of the static panel.
  function qtShowPdf(id) {
    const modal = document.getElementById('doc-modal');
    const frame = document.getElementById('doc-preview-frame');
    const load = document.getElementById('doc-modal-loading');
    document.getElementById('doc-modal-title').textContent = 'Quotation ' + id;
    window._docName = `Quotation_${id}`;
    const bytes = Uint8Array.from(atob(qtPdfBase64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
    frame._blobUrl = URL.createObjectURL(blob);
    frame.src = frame._blobUrl;
    load.style.display = 'none';
    frame.style.display = 'block';
    modal.style.display = 'flex';
    requestAnimationFrame(() => lucide.createIcons());
  }

  // ── History ─────────────────────────────────────────────────────────────────
  async function loadQtHistory() {
    const body = document.getElementById('qt-history-body');
    if (!body) return;
    body.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">Loading…</div>';
    try {
      const rows = await qFetch('/api/dashboard/quotations').then(r => r.json());
      if (!Array.isArray(rows)) throw new Error(rows.error || 'Not permitted');
      if (!rows.length) { body.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">No saved quotations yet.</div>'; return; }
      const mayDraft = qCan('quotation', 'draft');
      const mayDelete = qCan('quotation', 'delete');
      body.innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>ID</th><th>Title</th><th>Created By</th><th>Date</th><th></th></tr></thead>
        <tbody>${rows.map(q => `<tr>
          <td><code style="font-size:11px">${esc(q.quote_id)}</code></td>
          <td>${esc(q.title || '—')}</td>
          <td>${esc(q.created_by || '—')}</td>
          <td>${new Date(q.created_at).toLocaleDateString()}</td>
          <td style="white-space:nowrap;text-align:right">
            ${mayDraft ? `<button class="btn btn-sm btn-outline" onclick="editQuotation(${q.id})">Edit</button>
            <button class="btn btn-sm btn-outline" onclick="duplicateQuotation(${q.id})">Duplicate</button>` : ''}
            <button class="btn btn-sm btn-outline" onclick="viewDocPdf('quotation',${q.id},'${escJs(q.quote_id || 'Quotation')}')">PDF</button>
            ${mayDelete ? `<button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger)" onclick="deleteQuotation(${q.id})">Delete</button>` : ''}
          </td>
        </tr>`).join('')}</tbody></table></div>`;
      requestAnimationFrame(() => lucide.createIcons());
    } catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:16px">${esc(e.message)}</div>`; }
  }
  async function deleteQuotation(id) {
    if (!confirm('Delete this quotation from history? This cannot be undone.')) return;
    try {
      const r = await qFetch(`/api/dashboard/quotations/${id}`, { method: 'DELETE' });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return alert('Error: ' + (e.error || r.status)); }
      loadQtHistory();
    } catch (e) { alert('Error: ' + e.message); }
  }
  async function editQuotation(id) {
    try {
      const q = await qFetch(`/api/dashboard/quotations/${id}`).then(r => r.json());
      if (q && q.data) openQuoteForm(q, { editing: true });
    } catch (e) { alert('Could not load quotation: ' + e.message); }
  }
  async function duplicateQuotation(id) {
    try {
      const q = await qFetch(`/api/dashboard/quotations/${id}`).then(r => r.json());
      if (q && q.data) { delete q.data.id; openQuoteForm(q, { editing: false }); }
    } catch (e) { alert('Could not load quotation: ' + e.message); }
  }

  // ── Settings (one form, both portals; people list differs per portal) ───────
  function qtSettingsHtml() {
    const f = (id, label, ph) => `<div class="form-group"><label class="form-label">${label}</label><input class="form-control" id="${id}" placeholder="${ph || ''}"></div>`;
    return `<div style="max-width:640px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 14px">
        ${f('qts-company-name', 'Company name')}${f('qts-company-phone', 'Phone')}
        ${f('qts-company-email', 'Email')}${f('qts-company-website', 'Website')}
        ${f('qts-company-address', 'Address')}${f('qts-company-tax-id', 'Tax ID')}
      </div>
      <div class="form-group"><label class="form-label">Payment terms</label><textarea class="form-control" id="qts-payment-terms" rows="3"></textarea></div>
      <div class="form-group"><label class="form-label">Footer note</label><textarea class="form-control" id="qts-footer-note" rows="2"></textarea></div>
      <div class="form-group"><label class="form-label">Notify when a client opens the contact link</label>
        <select class="form-control" id="qts-contact-notify-id"><option value="">— Nobody —</option></select></div>
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-primary" onclick="saveQtSettings()">Save settings</button>
        <span id="qts-msg" style="font-size:12.5px;color:var(--muted)"></span>
      </div>
    </div>`;
  }
  async function loadQtSettings() {
    try {
      const [settings, people] = await Promise.all([
        qFetch('/api/dashboard/quotation/settings').then(r => r.json()),
        QTCFG.people().catch(() => []),
      ]);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
      set('qts-company-name', settings.company_name); set('qts-company-phone', settings.company_phone);
      set('qts-company-email', settings.company_email); set('qts-company-website', settings.company_website);
      set('qts-company-address', settings.company_address); set('qts-company-tax-id', settings.company_tax_id);
      set('qts-payment-terms', settings.payment_terms); set('qts-footer-note', settings.footer_note);
      const sel = document.getElementById('qts-contact-notify-id');
      if (sel) sel.innerHTML = '<option value="">— Nobody —</option>' +
        people.map(e => `<option value="${esc(String(e.id))}"${String(settings.contact_notify_employee_id) === String(e.id) ? ' selected' : ''}>${esc(e.name)}</option>`).join('');
    } catch (e) { console.error('loadQtSettings', e); }
  }
  async function saveQtSettings() {
    const msg = document.getElementById('qts-msg');
    const g = id => (document.getElementById(id) || {}).value || '';
    const payload = {
      company_name: g('qts-company-name').trim(), company_phone: g('qts-company-phone').trim(),
      company_email: g('qts-company-email').trim(), company_website: g('qts-company-website').trim(),
      company_address: g('qts-company-address').trim(), company_tax_id: g('qts-company-tax-id').trim(),
      payment_terms: g('qts-payment-terms'), footer_note: g('qts-footer-note'),
      contact_notify_employee_id: g('qts-contact-notify-id'),
    };
    try {
      const r = await qFetch('/api/dashboard/quotation/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      msg.textContent = r.ok ? 'Saved.' : 'Error saving.';
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
    setTimeout(() => { msg.textContent = ''; }, 3000);
  }

  Object.assign(window, {
    initQuotationPage, switchQtTab, openQuoteForm, qtPrefillFromLead, refreshQuoteId,
    addPricingRow, toggleFreeItem, getExchange, recalcItem, recalcLogistics, qtRecalcAll,
    addCustomSpecRow, recalcGrandTotal, handleImgSelect, handleImgDrop, renderImgPreviews,
    removeImg, removeExistingImg, generateQuotation, loadQtHistory, deleteQuotation,
    editQuotation, duplicateQuotation, loadQtSettings, saveQtSettings, qtRenumber,
  });
})();
