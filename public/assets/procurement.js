// Operations and procurement: Suppliers, RFQ, Purchase Orders, Sales Contracts and
// Website Submissions — the five sections both portals now have.
//
// This lived inside dashboard.js, which was fine while only the admin could reach
// it. Copying 1,100 lines into employee.js to give the team portal the same five
// pages is how a fix lands in one portal and quietly misses the other, so it moved
// here instead, next to huddle.js and home.js, which are shared for the same reason.
//
// The seam is PROCFG, defined by each portal in its own bundle:
//
//   base        '/api/dashboard' | '/api/employee'
//   fetch       that portal's authenticated fetch
//   modal       show a modal: (title, bodyHTML, footerHTML, opts)
//   closeModal  close it
//   toast       transient message
//   can         (section, action) -> boolean; the admin answers true to everything
//
// The server side matches: every route below is one handler mounted at both bases
// (see src/routes/contracts.js), so the only difference between the two portals is
// which actions the admin has granted.
(function () {

  // The code below keeps the dashboard-shaped paths it was written with, and this
  // maps them onto whichever portal is running. One line rather than 60 edited
  // string literals, and the mapping is visible in one place.
  function procPath(url) {
    const u = String(url);
    if (PROCFG.base === '/api/dashboard') return u;
    return u.replace(/^\/api\/dashboard/, PROCFG.base)
            // Submissions predate the /api/dashboard prefix; the team portal's
            // copy is mounted under it like everything else.
            .replace(/^\/api\/submissions/, PROCFG.base + '/submissions');
  }
  const apiFetch       = (url, opts) => PROCFG.fetch(procPath(url), opts);
  const showModal      = (...a) => PROCFG.modal(...a);
  const hideModal      = () => PROCFG.closeModal();
  const showAdminToast = (m) => PROCFG.toast(m);
  // Read as "may I", so a button the employee cannot use is never drawn. The server
  // refuses it as well; this is only so the page does not offer what it cannot do.
  const procCan        = (section, action) => !PROCFG.can || PROCFG.can(section, action);

  // ── Shared document viewer (lead profile → view an attached file as PDF) ────────
  // Every attached document type re-renders server-side from its stored record, so
  // what you see here is exactly what Download produces.
  // esc() leaves ' alone, which would break a single-quoted onclick argument.
  function escJs(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      .replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }
  const DOC_ENDPOINTS = {
    quotation: id => `/api/dashboard/quotations/${id}/pdf`,
    contract:  id => `/api/dashboard/contracts/${id}/pdf`,
    po:        id => `/api/dashboard/purchase-orders/${id}/pdf`,
    rfq:       id => `/api/dashboard/rfqs/${id}/pdf`,
  };
  let _docName = 'document';

  async function viewDocPdf(kind, id, label) {
    const build = DOC_ENDPOINTS[kind];
    if (!build) return;
    const modal = document.getElementById('doc-modal');
    const frame = document.getElementById('doc-preview-frame');
    const load  = document.getElementById('doc-modal-loading');
    document.getElementById('doc-modal-title').textContent = label || 'Document';
    _docName = (label || 'document').replace(/[^\w.-]+/g, '_');
    frame.removeAttribute('src');
    frame.style.display = 'none';
    load.style.display = 'block';
    modal.style.display = 'flex';
    requestAnimationFrame(() => lucide.createIcons());
    try {
      const r = await apiFetch(build(id), { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to render');
      if (d.name) _docName = String(d.name).replace(/[^\w.-]+/g, '_');
      const bytes = Uint8Array.from(atob(d.pdf), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
      frame._blobUrl = URL.createObjectURL(blob);
      frame.src = frame._blobUrl;
      load.style.display = 'none';
      frame.style.display = 'block';
    } catch (e) {
      load.innerHTML = `<div class="error-msg">Could not render this document: ${esc(e.message)}</div>`;
    }
  }
  // Preview an unsaved payload (used by the "Save & preview" buttons).
  async function viewDocPdfPayload(url, payload, label) {
    const modal = document.getElementById('doc-modal');
    const frame = document.getElementById('doc-preview-frame');
    const load  = document.getElementById('doc-modal-loading');
    document.getElementById('doc-modal-title').textContent = label || 'Document';
    _docName = (label || 'document').replace(/[^\w.-]+/g, '_');
    frame.removeAttribute('src'); frame.style.display = 'none';
    load.style.display = 'block'; load.innerHTML = '<div class="spinner" style="margin:0 auto 10px"></div> Rendering PDF…';
    modal.style.display = 'flex';
    try {
      const r = await apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to render');
      const bytes = Uint8Array.from(atob(d.pdf), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
      frame._blobUrl = URL.createObjectURL(blob);
      frame.src = frame._blobUrl;
      load.style.display = 'none'; frame.style.display = 'block';
    } catch (e) {
      load.innerHTML = `<div class="error-msg">Could not render this document: ${esc(e.message)}</div>`;
    }
  }

  function downloadDocPdf() {
    const frame = document.getElementById('doc-preview-frame');
    if (!frame || !frame._blobUrl) return;
    const a = document.createElement('a');
    a.href = frame._blobUrl;
    a.download = `${_docName}.pdf`;
    a.click();
  }
  function closeDocPdf() {
    const frame = document.getElementById('doc-preview-frame');
    if (frame && frame._blobUrl) { URL.revokeObjectURL(frame._blobUrl); frame._blobUrl = null; }
    if (frame) frame.removeAttribute('src');
    document.getElementById('doc-modal').style.display = 'none';
  }

  // ── Contracts (Arabic vehicle import contract) ──────────────────────────────────
  let _contractsCache = [];
  let _ctPdfBase64 = null;
  const CT_STATUS = { draft: 'Draft', signed: 'Signed', cancelled: 'Cancelled' };

  async function loadContracts() {
    const body = document.getElementById('contracts-list');
    if (body) body.innerHTML = '<div class="loading"><div class="spinner"></div> Loading contracts…</div>';
    let list = [];
    try { list = await apiFetch('/api/dashboard/contracts').then(r => r.json()); }
    catch (_) { if (body) body.innerHTML = '<div class="error-msg">Failed to load contracts.</div>'; return; }
    if (list && list.error) {
      body.innerHTML = `<div class="error-msg">${esc(list.error)}<br><span style="font-size:12px">If this mentions a missing <code>contracts</code> table, run <code>migrations/001_stock_specs_colors_contracts.sql</code> on the Supabase project.</span></div>`;
      return;
    }
    _contractsCache = Array.isArray(list) ? list : [];
    if (!_contractsCache.length) {
      body.innerHTML = '<div style="color:var(--muted);padding:24px;text-align:center;font-size:13px">No contracts yet.<br>Click “New contract”, or move a deal to <strong>Won</strong> to have one drafted automatically.</div>';
      return;
    }
    body.innerHTML = `
      <div class="table-scroll"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          <th style="padding:8px 10px">Contract #</th><th style="padding:8px 10px">Title</th>
          <th style="padding:8px 10px">Status</th><th style="padding:8px 10px">Created</th>
          <th style="padding:8px 10px;text-align:right">Actions</th></tr></thead>
        <tbody>${_contractsCache.map(c => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px 10px;font-family:monospace;font-weight:600">${esc(c.contract_no)}</td>
            <td style="padding:8px 10px">${esc(c.title || '—')}${c.created_by === 'auto_won' ? ' <span style="font-size:10.5px;color:var(--primary);border:1px solid var(--primary);border-radius:8px;padding:1px 6px">auto</span>' : ''}</td>
            <td style="padding:8px 10px">${esc(CT_STATUS[c.status] || c.status)}</td>
            <td style="padding:8px 10px;color:var(--muted)">${c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</td>
            <td style="padding:8px 10px;text-align:right;white-space:nowrap">
              ${procCan('contracts', 'edit') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openContractForm(${c.id})">Edit</button>` : ''}
              ${procCan('contracts', 'export') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="previewContract(${c.id})">PDF</button>` : ''}
              ${procCan('contracts', 'delete') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteContract(${c.id})">Delete</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  }

  // Text input bound to a dotted path inside the contract `data` object.
  function ctField(label, path, value, ph) {
    return `<div><div style="font-size:11px;color:var(--muted);margin-bottom:3px">${esc(label)}</div>
      <input class="form-input ct-f" data-path="${esc(path)}" value="${esc(value ?? '')}" placeholder="${esc(ph || '')}"></div>`;
  }
  function ctGet(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function ctSet(obj, path, val) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    o[keys[keys.length - 1]] = val;
  }

  async function openContractForm(id, seedCustomerId) {
    let rec = null, data = null, contractNo = '';
    if (id) {
      rec = await apiFetch(`/api/dashboard/contracts/${id}`).then(r => r.json());
      data = rec.data || {}; contractNo = rec.contract_no;
    } else {
      const qs = seedCustomerId ? `?customer_id=${encodeURIComponent(seedCustomerId)}` : '';
      const d = await apiFetch('/api/dashboard/contracts/new/defaults' + qs).then(r => r.json());
      data = d.data || {}; contractNo = d.contract_no;
      if (seedCustomerId) rec = { customer_id: seedCustomerId, status: 'draft' };
    }
    _ctEditing = { id, contract_no: contractNo, data };
    const cd = data.contractDate || {}, co = data.company || {}, rp = data.rep || {}, by = data.buyer || {}, ve = data.vehicle || {};
    const pays = Array.isArray(data.payments) ? data.payments : [];
    const g = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px';
    showModal(id ? `Contract ${contractNo}` : 'New contract', `
      <div style="display:grid;gap:16px;max-height:66vh;overflow-y:auto;padding-right:4px">
        <div>
          <label class="form-label">Contract date · تاريخ العقد</label>
          <div style="${g}">
            ${ctField('Day (اليوم)', 'contractDate.day', cd.day)}
            ${ctField('DD', 'contractDate.d', cd.d)}
            ${ctField('MM', 'contractDate.m', cd.m)}
            ${ctField('YYYY', 'contractDate.y', cd.y)}
          </div>
        </div>
        <div>
          <label class="form-label">First party — company · الطرف الأول</label>
          <div style="${g}">
            ${ctField('Company name', 'company.name', co.name)}
            ${ctField('Commercial register', 'company.commercialReg', co.commercialReg)}
            ${ctField('Tax ID', 'company.taxId', co.taxId)}
            ${ctField('Address', 'company.address', co.address)}
            ${ctField('Represented by', 'company.repIn', co.repIn)}
          </div>
          <div style="${g};margin-top:10px">
            ${ctField('Rep. name', 'rep.name', rp.name)}
            ${ctField('Rep. national ID', 'rep.nationalId', rp.nationalId)}
            ${ctField('ID issue date', 'rep.idDate', rp.idDate)}
            ${ctField('Nationality', 'rep.nationality', rp.nationality)}
            ${ctField('Religion', 'rep.religion', rp.religion)}
            ${ctField('Rep. address', 'rep.address', rp.address)}
            ${ctField('Capacity (بصفة)', 'rep.role', rp.role)}
          </div>
        </div>
        <div>
          <label class="form-label">Second party — buyer · الطرف الثاني</label>
          <div style="${g}">
            ${ctField('Buyer name', 'buyer.name', by.name)}
            ${ctField('National ID', 'buyer.nationalId', by.nationalId)}
            ${ctField('ID issue date', 'buyer.idDate', by.idDate)}
            ${ctField('Nationality', 'buyer.nationality', by.nationality)}
            ${ctField('Religion', 'buyer.religion', by.religion)}
            ${ctField('Address', 'buyer.address', by.address)}
          </div>
        </div>
        <div>
          <label class="form-label">Vehicle · بيانات السيارة</label>
          <div style="${g}">
            ${ctField('Make (ماركة)', 'vehicle.make', ve.make)}
            ${ctField('Model (موديل)', 'vehicle.model', ve.model)}
            ${ctField('Colour (اللون)', 'vehicle.color', ve.color)}
            ${ctField('Year (سنة الصنع)', 'vehicle.year', ve.year)}
            ${ctField('Notes (ملاحظات)', 'vehicle.notes', ve.notes)}
            ${ctField('Import country', 'importCountry', data.importCountry)}
          </div>
        </div>
        <div>
          <label class="form-label">Financials · البند الثالث</label>
          <div style="${g}">
            ${ctField('Total amount', 'total', data.total)}
            ${ctField('Amount in words', 'totalWords', data.totalWords)}
            ${ctField('Late fee / day', 'lateFee', data.lateFee)}
            ${ctField('Late fee in words', 'lateFeeWords', data.lateFeeWords)}
            ${ctField('Delivery deadline (البند الرابع)', 'deliveryDeadline', data.deliveryDeadline)}
          </div>
          <div style="margin-top:10px">
            ${pays.map((p, i) => `<div style="display:grid;grid-template-columns:150px 1fr;gap:8px;margin-bottom:6px;align-items:center">
              <input class="form-input ct-f" data-path="payments.${i}.amount" value="${esc(p.amount || '')}" placeholder="Amount">
              <div style="font-size:12px;color:var(--muted)">${esc(p.when || '')}${p.label ? ` (${esc(p.label)})` : ''}</div>
            </div>`).join('')}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label class="form-label">Lead <span style="color:var(--muted);font-weight:400">(attach to profile)</span></label>
            <select id="ct-customer-id" class="form-input"><option value="">— No lead —</option></select>
          </div>
          <div>
            <label class="form-label">Status</label>
            <select id="ct-status" class="form-input">
              ${Object.entries(CT_STATUS).map(([k, l]) => `<option value="${k}" ${(rec?.status || 'draft') === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="ct-err" class="error-msg" style="display:none"></div>
      </div>`,
      `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
       <button class="btn btn-outline" onclick="saveContract(true)">Save &amp; preview PDF</button>
       <button class="btn btn-primary" onclick="saveContract(false)">Save</button>`);
    await ctPopulateLeadPicker(rec ? rec.customer_id : null);
  }

  // Lead picker — mirrors the quotation's "attach to profile" dropdown.
  async function ctPopulateLeadPicker(selectedId) {
    const pick = document.getElementById('ct-customer-id');
    if (!pick) return;
    try {
      const leads = _allCustomers.length ? _allCustomers : await apiFetch('/api/dashboard/customers').then(r => r.json());
      if (!Array.isArray(leads)) return;
      if (!_allCustomers.length) _allCustomers = leads;
      pick.innerHTML = '<option value="">— No lead —</option>' +
        [...leads].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(l => `<option value="${l.id}">${esc(l.name)}${l.phone ? ' · ' + esc(l.phone) : ''}</option>`).join('');
      if (selectedId) pick.value = String(selectedId);
    } catch (_) {}
    // Picking a lead fills the buyer block (and vehicle, when still blank)
    pick.onchange = () => {
      const lead = _allCustomers.find(l => String(l.id) === pick.value);
      if (!lead) return;
      const cf = lead.custom_fields || {};
      const setF = (path, val) => {
        const el = document.querySelector(`.ct-f[data-path="${path}"]`);
        if (el && val && !el.value.trim()) el.value = val;
      };
      const nameEl = document.querySelector('.ct-f[data-path="buyer.name"]');
      if (nameEl) nameEl.value = lead.name || '';
      setF('buyer.nationalId', cf.cf_national_id);
      setF('buyer.address', lead.address || cf.cf_address);
      const car = String(cf.cf_vehicle_offered || cf.cf_vehicle_requested || lead.car_in_question || '').trim();
      if (car) {
        const bits = car.split(/\s+/);
        setF('vehicle.make', bits[0]);
        setF('vehicle.model', bits.slice(1).join(' '));
      }
    };
  }
  let _ctEditing = null;

  function ctCollect() {
    const data = JSON.parse(JSON.stringify(_ctEditing.data || {}));
    document.querySelectorAll('.ct-f').forEach(inp => {
      const path = inp.dataset.path;
      // payments.<i>.amount needs the array preserved rather than turned into an object
      const m = path.match(/^payments\.(\d+)\.(\w+)$/);
      if (m) {
        if (!Array.isArray(data.payments)) data.payments = [];
        if (!data.payments[+m[1]]) data.payments[+m[1]] = {};
        data.payments[+m[1]][m[2]] = inp.value.trim();
      } else ctSet(data, path, inp.value.trim());
    });
    return data;
  }

  async function saveContract(thenPreview) {
    const data = ctCollect();
    const err = document.getElementById('ct-err');
    if (!(data.buyer && data.buyer.name)) { err.textContent = 'Buyer name is required.'; err.style.display = 'block'; return; }
    const title = `عقد — ${data.buyer.name}`;
    const status = document.getElementById('ct-status').value;
    const customer_id = document.getElementById('ct-customer-id')?.value || null;
    const body = JSON.stringify({ contract_no: _ctEditing.contract_no, title, data, status, customer_id });
    const url = _ctEditing.id ? `/api/dashboard/contracts/${_ctEditing.id}` : '/api/dashboard/contracts';
    const r = await apiFetch(url, { method: _ctEditing.id ? 'PUT' : 'POST', body });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Failed to save.'; err.style.display = 'block'; return; }
    hideModal();
    loadContracts();
    if (thenPreview) renderContractPdf(data);
  }

  async function previewContract(id) {
    const rec = await apiFetch(`/api/dashboard/contracts/${id}`).then(r => r.json());
    renderContractPdf(rec.data || {});
  }

  async function renderContractPdf(data) {
    const modal = document.getElementById('ct-modal');
    const frame = document.getElementById('ct-preview-frame');
    frame.removeAttribute('src');
    modal.style.display = 'flex';
    try {
      const r = await apiFetch('/api/dashboard/contracts/pdf', { method: 'POST', body: JSON.stringify({ data }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to render');
      _ctPdfBase64 = d.pdf;
      const bytes = Uint8Array.from(atob(d.pdf), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
      frame._blobUrl = URL.createObjectURL(blob);
      frame.src = frame._blobUrl;
    } catch (e) {
      alert('Could not render the contract: ' + e.message);
      modal.style.display = 'none';
    }
    requestAnimationFrame(() => lucide.createIcons());
  }

  function downloadContractPdf() {
    const frame = document.getElementById('ct-preview-frame');
    const url = frame && frame._blobUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `Contract_${(_ctEditing && _ctEditing.contract_no) || 'motolinkers'}.pdf`;
    a.click();
  }

  // Lead drawer → draft a contract already attached to (and prefilled from) this lead.
  function ldGenerateContract() {
    if (!_ldProfile) return;
    const cid = _ldProfile.customer.id;
    closeLeadProfile();
    navigate('contracts');
    openContractForm(null, cid);
  }

  async function deleteContract(id) {
    const c = _contractsCache.find(x => x.id === id);
    if (!confirm(`Delete contract ${c ? c.contract_no : ''}?`)) return;
    await apiFetch(`/api/dashboard/contracts/${id}`, { method: 'DELETE' });
    loadContracts();
  }

  // ── Purchase Orders ─────────────────────────────────────────────────────────────
  // One PO = many vehicle lines, mirroring the supplier ordering sheet.
  const PO_LINE_STATUSES = [
    { key: 'send_to_supplier', label: 'SEND TO SUPPLIER',      bg: '#dbe4ff', fg: '#2f3f8f' },
    { key: 'in_preparation',   label: 'Car in Preparation',    bg: '#f3ddf7', fg: '#7b2d8e' },
    { key: 'in_logistics',     label: 'In Logistics',          bg: '#fdecc8', fg: '#8a5a00' },
    { key: 'delivered',        label: 'Car Delivered to moto', bg: '#d7f2d9', fg: '#1e6b2a' },
  ];
  const PO_STATUS = { draft: 'Draft', sent: 'Sent', confirmed: 'Confirmed', closed: 'Closed' };
  // ── Supplier catalogue picker ────────────────────────────────────────────────
  // RFQ and purchase-order lines were free text, so the same car got typed three
  // different ways and prices drifted from what the supplier actually quoted. Both
  // editors can now pull a line straight from supplier_vehicles. Typing still works —
  // this only pre-fills.
  let _supCatalogue = null;
  async function supCatalogue() {
    if (_supCatalogue) return _supCatalogue;
    try {
      const r = await apiFetch('/api/dashboard/supplier-vehicles');
      _supCatalogue = r.ok ? await r.json() : [];
    } catch (_) { _supCatalogue = []; }
    return _supCatalogue;
  }
  function supCatLabel(v) {
    return [v.brand, v.model, v.trim].filter(Boolean).join(' ') || '(unnamed)';
  }
  async function openCataloguePicker(target) {
    const rows = await supCatalogue();
    if (!rows.length) {
      hdToast('No supplier vehicles yet — add them under Suppliers → Open → Vehicles.');
      return;
    }
    hdSheet('Add from supplier catalogue', `
      <input class="hd-input" id="supcat-q" placeholder="Search brand, model or supplier…"
             oninput="supCatFilter(this.value)" style="width:100%;margin-bottom:10px">
      <div class="hd-list" id="supcat-list" style="max-height:320px">${supCatRows(rows)}</div>`,
      `<button class="btn btn-outline btn-sm" onclick="hdSheetClose()">Cancel</button>
       <button class="btn btn-primary btn-sm" onclick="cataloguePick('${target}')">Add selected</button>`);
  }
  function supCatRows(rows) {
    const money = n => (Number(n) || 0).toLocaleString();
    return rows.map(v => `<label class="hd-row">
        <input type="checkbox" class="supcat-cb" value="${esc(String(v.id))}">
        <span style="flex:1;min-width:0">
          <span style="display:block">${esc(supCatLabel(v))}${v.model_year ? ' · ' + v.model_year : ''}</span>
          <span style="font-size:11px;color:var(--muted)">${esc(v.supplier_name || '')}${
            v.fob_price ? ' · ' + esc(v.currency || 'USD') + ' ' + money(v.fob_price) : ''}${
            v.lead_time ? ' · ' + esc(v.lead_time) : ''}</span>
        </span></label>`).join('');
  }
  function supCatFilter(q) {
    const term = String(q || '').trim().toLowerCase();
    const rows = (_supCatalogue || []).filter(v => !term
      || supCatLabel(v).toLowerCase().includes(term)
      || String(v.supplier_name || '').toLowerCase().includes(term));
    document.getElementById('supcat-list').innerHTML = rows.length ? supCatRows(rows)
      : '<div style="font-size:12px;color:var(--muted);padding:8px">Nothing matched that.</div>';
  }
  function cataloguePick(target) {
    const ids = new Set([...document.querySelectorAll('.supcat-cb:checked')].map(c => c.value));
    const picked = (_supCatalogue || []).filter(v => ids.has(String(v.id)));
    if (!picked.length) { hdToast('Pick at least one vehicle.'); return; }
    picked.forEach(v => {
      if (target === 'rfq') {
        rfqAddRow({ brand: v.brand, model: v.model, trim: v.trim, year: v.model_year || '',
                    accessories: v.accessories || '', lead_time: v.lead_time || '',
                    fob_price: v.fob_price == null ? '' : v.fob_price });
      } else {
        poAddRow({ brand: v.brand, model: v.model, trim: v.trim, year: v.model_year || '',
                   accessories: v.accessories || '', units: 1,
                   pi_price: v.fob_price == null ? '' : v.fob_price });
      }
    });
    hdSheetClose();
    hdToast(picked.length === 1 ? 'Line added from the catalogue.' : picked.length + ' lines added.');
  }

  const PO_COLS = [
    ['client', 'CLIENT', 150], ['consignee', 'CONSIGNEE', 150], ['units', 'UNITS', 62],
    ['brand', 'BRAND', 92], ['model', 'MODEL', 110], ['trim', 'TRIM', 120],
    ['color', 'COLOR EXT / INT', 160], ['year', 'YEAR', 66],
    ['accessories', 'ACCESSORIES / REMARKS', 200], ['payment_term', 'PAYMENT TERM', 130],
    ['pi_price', 'PI PRICE', 100], ['status', 'STATUS', 168],
    ['vin', 'VIN', 150], ['file_link', 'Client file Link', 140],
  ];
  let _poCache = [];
  let _poEditing = null;
  function poItemsEngine() {
    return procColsEngine('po_items', tupleCols(PO_COLS, {
      units: 'number', pi_price: 'number',
      status: 'select', 'options:status': PO_LINE_STATUSES.map(o => ({ key: o.key, label: o.label, color: o.fg })),
    }), () => {});
  }
  // The grid's visible columns, engine-ordered; falls back to the tuples until load().
  function poGridCols() {
    const eng = CE('po_items');
    return eng && eng.loaded ? eng.visible() : tupleCols(PO_COLS, {});
  }

  function poLineStatus(key) { return PO_LINE_STATUSES.find(s => s.key === key) || PO_LINE_STATUSES[0]; }
  function poLineTotal(items) {
    return (items || []).reduce((s, it) => s + (Number(it.pi_price) || 0) * (Number(it.units) || 1), 0);
  }

  async function loadPurchaseOrders() {
    const body = document.getElementById('po-list');
    if (body) body.innerHTML = '<div class="loading"><div class="spinner"></div> Loading purchase orders…</div>';
    let list = [];
    try { list = await apiFetch('/api/dashboard/purchase-orders').then(r => r.json()); }
    catch (_) { if (body) body.innerHTML = '<div class="error-msg">Failed to load purchase orders.</div>'; return; }
    if (list && list.error) {
      body.innerHTML = `<div class="error-msg">${esc(list.error)}<br><span style="font-size:12px">If this mentions a missing <code>purchase_orders</code> table, run <code>migrations/002_purchase_orders.sql</code> on the Supabase project.</span></div>`;
      return;
    }
    _poCache = Array.isArray(list) ? list : [];
    if (!_poCache.length) {
      body.innerHTML = '<div style="color:var(--muted);padding:24px;text-align:center;font-size:13px">No purchase orders yet.<br>Click “New purchase order” to create one.</div>';
      return;
    }
    body.innerHTML = `
      <div class="table-scroll"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          <th style="padding:8px 10px">PO #</th><th style="padding:8px 10px">Supplier</th>
          <th style="padding:8px 10px;text-align:right">Lines</th><th style="padding:8px 10px;text-align:right">Total</th>
          <th style="padding:8px 10px">Status</th><th style="padding:8px 10px">Date</th>
          <th style="padding:8px 10px;text-align:right">Actions</th></tr></thead>
        <tbody>${_poCache.map(p => {
          const items = Array.isArray(p.items) ? p.items : [];
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px 10px;font-family:monospace;font-weight:600">${esc(p.po_number)}</td>
            <td style="padding:8px 10px">${esc(p.supplier || '—')}</td>
            <td style="padding:8px 10px;text-align:right">${items.length}</td>
            <td style="padding:8px 10px;text-align:right">${esc(p.currency || 'USD')} ${poLineTotal(items).toLocaleString()}</td>
            <td style="padding:8px 10px">${esc(PO_STATUS[p.status] || p.status)}</td>
            <td style="padding:8px 10px;color:var(--muted)">${esc(p.po_date || (p.created_at ? new Date(p.created_at).toLocaleDateString() : ''))}</td>
            <td style="padding:8px 10px;text-align:right;white-space:nowrap">
              ${procCan('purchaseorders', 'edit') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openPoForm(${p.id})">Edit</button>` : ''}
              ${procCan('purchaseorders', 'export') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="previewPo(${p.id})">PDF</button>` : ''}
              ${procCan('purchaseorders', 'delete') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deletePo(${p.id})">Delete</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }

  async function openPoForm(id, seedCustomerId) {
    await poItemsEngine().load();
    let rec;
    if (id) {
      rec = await apiFetch(`/api/dashboard/purchase-orders/${id}`).then(r => r.json());
    } else {
      const qs = seedCustomerId ? `?customer_id=${encodeURIComponent(seedCustomerId)}` : '';
      rec = await apiFetch('/api/dashboard/purchase-orders/new/defaults' + qs).then(r => r.json());
    }
    _poEditing = { id, po_number: rec.po_number };
    showModal(id ? `Purchase order ${rec.po_number}` : 'New purchase order', `
      <!-- minmax(0,1fr): stops the wide vehicle table from stretching every row -->
      <div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-height:66vh;overflow-y:auto;padding-right:4px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;min-width:0">
          <div><div class="po-lbl">PO number</div><input id="po-number" class="form-input" value="${esc(rec.po_number || '')}" ${id ? 'readonly' : ''}></div>
          <div><div class="po-lbl">Date</div><input id="po-date" class="form-input" type="date" value="${esc(rec.po_date || '')}"></div>
          <div><div class="po-lbl">Supplier</div><input id="po-supplier" class="form-input" value="${esc(rec.supplier || '')}" placeholder="e.g. BYD Auto Industry"></div>
          <div><div class="po-lbl">Currency</div><input id="po-currency" class="form-input" value="${esc(rec.currency || 'USD')}"></div>
          <div><div class="po-lbl">Status</div><select id="po-status" class="form-input">
            ${Object.entries(PO_STATUS).map(([k, l]) => `<option value="${k}" ${(rec.status || 'draft') === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
          <div><div class="po-lbl">Lead <span style="color:var(--muted);font-weight:400">(attach to profile)</span></div>
            <select id="po-customer-id" class="form-input"><option value="">— No lead —</option></select></div>
        </div>

        <div>
          <div class="po-lbl" style="margin-bottom:6px">Vehicle lines</div>
          <!-- min-width:0 lets this grid item shrink so the wide table scrolls
               inside it instead of stretching the whole modal -->
          <div style="overflow-x:auto;min-width:0;border:1px solid var(--border);border-radius:10px">
            <table id="po-grid" style="border-collapse:collapse;font-size:12px;min-width:1500px">
              <thead><tr>
                <th class="po-th" style="width:38px">No</th>
                ${poGridCols().map(c => procTh('po_items', c, { cls: 'po-th', style: `min-width:${c.width || 90}px` })).join('')}
                <th class="po-th" style="width:38px"></th>
              </tr></thead>
              <tbody id="po-rows"></tbody>
            </table>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:10px;flex-wrap:wrap">
            <button class="btn btn-outline" style="padding:5px 10px;font-size:12px" onclick="poAddRow()">+ Add vehicle line</button> ${procColsBtn('po_items')}
            <button class="btn btn-outline" style="padding:5px 10px;font-size:12px;margin-left:6px" onclick="openCataloguePicker('po')">
              <i data-lucide="list-plus" style="width:13px;height:13px"></i> From supplier catalogue</button>
            <div id="po-total" style="font-size:13px;font-weight:700;color:var(--primary)"></div>
          </div>
        </div>

        <div>
          <div class="po-lbl" style="margin-bottom:6px">Supplier details (printed on the PO)</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;min-width:0">
            <div><div class="po-lbl">From register</div><select id="po-supplier-id" class="form-input" onchange="poSupplierPicked(this.value)"></select></div>
            <div><div class="po-lbl">Contact</div><input id="po-supplier-contact" class="form-input" value="${esc(rec.supplier_contact || '')}"></div>
            <div><div class="po-lbl">Address</div><input id="po-supplier-address" class="form-input" value="${esc(rec.supplier_address || '')}"></div>
            <div><div class="po-lbl">Country of origin</div><input id="po-supplier-country" class="form-input" value="${esc(rec.supplier_country || '')}"></div>
            <div><div class="po-lbl">Issuer</div><input id="po-issuer" class="form-input" value="${esc(rec.issuer || '')}"></div>
            <div><div class="po-lbl">Quote / RFQ ID</div><input id="po-quote-id" class="form-input" value="${esc(rec.quote_id || '')}"></div>
          </div>
        </div>

        <div><div class="po-lbl">Payment Terms</div><textarea id="po-payment" class="form-input" rows="2" placeholder="Leave blank for the standard 30% / 70% terms">${esc(rec.payment_terms || '')}</textarea></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;min-width:0">
          <div><div class="po-lbl">Incoterm</div><input id="po-incoterm" class="form-input" value="${esc(rec.incoterm || 'FOB')}"></div>
          <div><div class="po-lbl">Delivery Location</div><input id="po-delivery" class="form-input" value="${esc(rec.delivery_location || '')}"></div>
          <div><div class="po-lbl">Service Provider</div><input id="po-service" class="form-input" value="${esc(rec.service_provider || '')}"></div>
          <div><div class="po-lbl">Contact</div><input id="po-contact" class="form-input" value="${esc(rec.contact || '')}"></div>
        </div>
        <div><div class="po-lbl">Documents Required</div><textarea id="po-docs" class="form-input" rows="2" placeholder="Leave blank for the standard document list">${esc(rec.documents_required || '')}</textarea></div>

        <div><div class="po-lbl">Notes</div><textarea id="po-notes" class="form-input" rows="2" placeholder="Shipping instructions, remarks…">${esc(rec.notes || '')}</textarea></div>
        <div id="po-err" class="error-msg" style="display:none"></div>
      </div>`,
      `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
       <button class="btn btn-outline" onclick="savePo(true)">Save &amp; preview PDF</button>
       <button class="btn btn-primary" onclick="savePo(false)">Save</button>`,
      { wide: true });

    const items = Array.isArray(rec.items) && rec.items.length ? rec.items : [{}];
    items.forEach(it => poAddRow(it));
    document.getElementById('po-supplier-id').innerHTML = await supplierOptionsHtml(rec.supplier_id);
    await poPopulateLeadPicker(rec.customer_id || seedCustomerId || null);
  }

  function poAddRow(it) {
    const tbody = document.getElementById('po-rows');
    if (!tbody) return;
    const v = it || {};
    const tr = document.createElement('tr');
    tr.className = 'po-row';
    // The line status defaults to the first configured option rather than a
    // hardcoded key, so an admin who renames or reorders the statuses gets what
    // they configured on the next new line.
    const val = c => (c.key === 'status' && v[c.key] == null
      ? ((c.options && c.options[0] && c.options[0].key) || 'send_to_supplier') : v[c.key]);
    tr.innerHTML = `<td class="po-td po-no" style="text-align:center;color:var(--muted)"></td>` +
      poGridCols().map(c => procGridInput(CE('po_items'), c, val(c), 'po-f')).join('') +
      `<td class="po-td" style="text-align:center"><button class="btn btn-outline" style="padding:2px 7px;font-size:14px;color:var(--danger);border-color:var(--danger)" title="Remove line">×</button></td>`;
    tr.querySelector('button').onclick = () => { tr.remove(); poRenumber(); };
    tr.querySelectorAll('.po-f').forEach(el => el.addEventListener('input', poRenumber));
    tbody.appendChild(tr);
    poRenumber();
  }

  // Keep the No column and the running total in sync with the grid.
  function poRenumber() {
    const rows = [...document.querySelectorAll('.po-row')];
    rows.forEach((r, i) => { const c = r.querySelector('.po-no'); if (c) c.textContent = i + 1; });
    const totEl = document.getElementById('po-total');
    if (totEl) {
      const cur = document.getElementById('po-currency')?.value || 'USD';
      totEl.textContent = `${rows.length} line(s) · Total ${cur} ${poLineTotal(poCollectItems()).toLocaleString()}`;
    }
  }

  function poCollectItems() {
    return procGridCollect('.po-row', '.po-f');
  }

  async function poPopulateLeadPicker(selectedId) {
    const pick = document.getElementById('po-customer-id');
    if (!pick) return;
    try {
      const leads = _allCustomers.length ? _allCustomers : await apiFetch('/api/dashboard/customers').then(r => r.json());
      if (!Array.isArray(leads)) return;
      if (!_allCustomers.length) _allCustomers = leads;
      pick.innerHTML = '<option value="">— No lead —</option>' +
        [...leads].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(l => `<option value="${l.id}">${esc(l.name)}${l.phone ? ' · ' + esc(l.phone) : ''}</option>`).join('');
      if (selectedId) pick.value = String(selectedId);
    } catch (_) {}
  }

  // Choosing a registered supplier fills the printed supplier block.
  function poSupplierPicked(id) {
    const x = _suppliersCache.find(v => String(v.id) === String(id));
    if (!x) return;
    const set = (el, val) => { const e = document.getElementById(el); if (e) e.value = val || ''; };
    set('po-supplier', x.name); set('po-supplier-contact', x.contact);
    set('po-supplier-address', x.address); set('po-supplier-country', x.country);
  }

  function poCollect() {
    return {
      po_number: document.getElementById('po-number').value.trim(),
      po_date: document.getElementById('po-date').value || null,
      supplier: document.getElementById('po-supplier').value.trim(),
      currency: document.getElementById('po-currency').value.trim() || 'USD',
      status: document.getElementById('po-status').value,
      customer_id: document.getElementById('po-customer-id')?.value || null,
      notes: document.getElementById('po-notes').value.trim(),
      items: poCollectItems(),
      supplier_id:        document.getElementById('po-supplier-id')?.value || null,
      supplier_contact:   (document.getElementById('po-supplier-contact')?.value || '').trim(),
      supplier_address:   (document.getElementById('po-supplier-address')?.value || '').trim(),
      supplier_country:   (document.getElementById('po-supplier-country')?.value || '').trim(),
      issuer:             (document.getElementById('po-issuer')?.value || '').trim(),
      quote_id:           (document.getElementById('po-quote-id')?.value || '').trim(),
      payment_terms:      (document.getElementById('po-payment')?.value || '').trim(),
      incoterm:           (document.getElementById('po-incoterm')?.value || '').trim(),
      delivery_location:  (document.getElementById('po-delivery')?.value || '').trim(),
      service_provider:   (document.getElementById('po-service')?.value || '').trim(),
      contact:            (document.getElementById('po-contact')?.value || '').trim(),
      documents_required: (document.getElementById('po-docs')?.value || '').trim(),
    };
  }

  async function savePo(thenPreview) {
    const payload = poCollect();
    const err = document.getElementById('po-err');
    const filled = payload.items.filter(it => it.client || it.brand || it.model || it.vin);
    if (!filled.length) { err.textContent = 'Add at least one vehicle line (client, brand or model).'; err.style.display = 'block'; return; }
    payload.title = `${payload.supplier || 'PO'} — ${filled.length} vehicle(s)`;
    const url = _poEditing.id ? `/api/dashboard/purchase-orders/${_poEditing.id}` : '/api/dashboard/purchase-orders';
    const r = await apiFetch(url, { method: _poEditing.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Failed to save.'; err.style.display = 'block'; return; }
    hideModal();
    loadPurchaseOrders();
    if (thenPreview) renderPoPdf(payload);
  }

  async function previewPo(id) {
    const rec = await apiFetch(`/api/dashboard/purchase-orders/${id}`).then(r => r.json());
    _poEditing = { id: rec.id, po_number: rec.po_number };
    renderPoPdf(rec);
  }

  async function renderPoPdf(payload) {
    const modal = document.getElementById('po-modal');
    const frame = document.getElementById('po-preview-frame');
    frame.removeAttribute('src');
    modal.style.display = 'flex';
    try {
      const r = await apiFetch('/api/dashboard/purchase-orders/pdf', { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to render');
      const bytes = Uint8Array.from(atob(d.pdf), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
      frame._blobUrl = URL.createObjectURL(blob);
      frame.src = frame._blobUrl;
    } catch (e) {
      alert('Could not render the purchase order: ' + e.message);
      modal.style.display = 'none';
    }
    requestAnimationFrame(() => lucide.createIcons());
  }

  function downloadPoPdf() {
    const frame = document.getElementById('po-preview-frame');
    const url = frame && frame._blobUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `PurchaseOrder_${(_poEditing && _poEditing.po_number) || 'motolinkers'}.pdf`;
    a.click();
  }

  async function deletePo(id) {
    const p = _poCache.find(x => x.id === id);
    if (!confirm(`Delete purchase order ${p ? p.po_number : ''}?`)) return;
    await apiFetch(`/api/dashboard/purchase-orders/${id}`, { method: 'DELETE' });
    loadPurchaseOrders();
  }

  // Lead drawer → new PO already attached to (and seeded from) this lead.
  function ldGeneratePo() {
    if (!_ldProfile) return;
    const cid = _ldProfile.customer.id;
    closeLeadProfile();
    navigate('purchaseorders');
    openPoForm(null, cid);
  }

  // ── RFQ — Request for Quotation ─────────────────────────────────────────────────
  const RFQ_STATUS = { draft: 'Draft', sent: 'Sent', answered: 'Answered', closed: 'Closed' };
  const RFQ_COLS = [
    ['brand', 'BRAND', 90], ['model', 'MODEL', 96], ['trim', 'TRIM', 90],
    ['colour', 'COLOR EXT / INT', 130], ['year', 'YEAR', 60],
    ['accessories', 'ACCESSORIES / REMARKS', 190], ['lead_time', 'LEAD TIME', 90],
    ['fob_price', 'FOB PRICE', 90], ['cif_price', 'CIF PRICE (RoRo)', 100],
  ];
  let _rfqCache = [], _rfqEditing = null;
  function rfqItemsEngine() {
    return procColsEngine('rfq_items', tupleCols(RFQ_COLS, { fob_price: 'number', cif_price: 'number' }), () => {});
  }
  function rfqGridCols() {
    const eng = CE('rfq_items');
    return eng && eng.loaded ? eng.visible() : tupleCols(RFQ_COLS, {});
  }

  async function loadRfqs() {
    const body = document.getElementById('rfqs-list');
    if (body) body.innerHTML = '<div class="loading"><div class="spinner"></div> Loading RFQs…</div>';
    let list = [];
    try { list = await apiFetch('/api/dashboard/rfqs').then(r => r.json()); }
    catch (_) { body.innerHTML = '<div class="error-msg">Failed to load RFQs.</div>'; return; }
    if (list && list.error) {
      body.innerHTML = `<div class="error-msg">${esc(list.error)}<br><span style="font-size:12px">If this mentions a missing <code>rfqs</code> table, run <code>migrations/003_logistics_deals_docs.sql</code>.</span></div>`;
      return;
    }
    _rfqCache = Array.isArray(list) ? list : [];
    if (!_rfqCache.length) {
      body.innerHTML = '<div style="color:var(--muted);padding:24px;text-align:center;font-size:13px">No RFQs yet.</div>';
      return;
    }
    body.innerHTML = `
      <div class="table-scroll"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          <th style="padding:8px 10px">ID</th><th style="padding:8px 10px">Supplier</th>
          <th style="padding:8px 10px;text-align:right">Lines</th><th style="padding:8px 10px">Status</th>
          <th style="padding:8px 10px">Date</th><th style="padding:8px 10px;text-align:right">Actions</th></tr></thead>
        <tbody>${_rfqCache.map(r => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px 10px;font-family:monospace;font-weight:600">${esc(r.rfq_no)}</td>
            <td style="padding:8px 10px">${esc(r.supplier_name || '—')}</td>
            <td style="padding:8px 10px;text-align:right">${(Array.isArray(r.items) ? r.items : []).length}</td>
            <td style="padding:8px 10px">${esc(RFQ_STATUS[r.status] || r.status)}</td>
            <td style="padding:8px 10px;color:var(--muted)">${esc(r.rfq_date || (r.created_at ? new Date(r.created_at).toLocaleDateString() : ''))}</td>
            <td style="padding:8px 10px;text-align:right;white-space:nowrap">
              ${procCan('rfq', 'edit') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openRfqForm(${r.id})">Edit</button>` : ''}
              ${procCan('rfq', 'export') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="viewDocPdf('rfq',${r.id},'${escJs(r.rfq_no)}')">PDF</button>` : ''}
              ${procCan('rfq', 'delete') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteRfq(${r.id})">Delete</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  }

  async function openRfqForm(id, seedCustomerId) {
    await rfqItemsEngine().load();
    let rec;
    if (id) rec = await apiFetch(`/api/dashboard/rfqs/${id}`).then(r => r.json());
    else {
      const qs = seedCustomerId ? `?customer_id=${encodeURIComponent(seedCustomerId)}` : '';
      rec = await apiFetch('/api/dashboard/rfqs/new/defaults' + qs).then(r => r.json());
    }
    _rfqEditing = { id, rfq_no: rec.rfq_no };
    const g = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;min-width:0';
    showModal(id ? `RFQ ${rec.rfq_no}` : 'New RFQ', `
      <div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-height:66vh;overflow-y:auto;padding-right:4px">
        <div style="${g}">
          <div><div class="po-lbl">ID</div><input id="rfq-no" class="form-input" value="${esc(rec.rfq_no || '')}" ${id ? 'readonly' : ''}></div>
          <div><div class="po-lbl">Date</div><input id="rfq-date" class="form-input" type="date" value="${esc(rec.rfq_date || '')}"></div>
          <div><div class="po-lbl">Issuer</div><input id="rfq-issuer" class="form-input" value="${esc(rec.issuer || '')}"></div>
          <div><div class="po-lbl">Status</div><select id="rfq-status" class="form-input">
            ${Object.entries(RFQ_STATUS).map(([k, l]) => `<option value="${k}" ${(rec.status || 'draft') === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
          <div><div class="po-lbl">Lead <span style="color:var(--muted);font-weight:400">(attach)</span></div>
            <select id="rfq-customer-id" class="form-input"><option value="">— No lead —</option></select></div>
        </div>

        <div>
          <div class="po-lbl" style="margin-bottom:6px">Supplier</div>
          <div style="${g}">
            <div><div class="po-lbl">From register</div><select id="rfq-supplier-id" class="form-input" onchange="supplierFillFields(this.value,'rfq-')"></select></div>
            <div><div class="po-lbl">Name</div><input id="rfq-supplier-name" class="form-input" value="${esc(rec.supplier_name || '')}"></div>
            <div><div class="po-lbl">Contact</div><input id="rfq-supplier-contact" class="form-input" value="${esc(rec.supplier_contact || '')}"></div>
            <div><div class="po-lbl">Address</div><input id="rfq-supplier-address" class="form-input" value="${esc(rec.supplier_address || '')}"></div>
            <div><div class="po-lbl">Country of origin</div><input id="rfq-supplier-country" class="form-input" value="${esc(rec.supplier_country || '')}"></div>
          </div>
        </div>

        <div>
          <div class="po-lbl" style="margin-bottom:6px">Requested vehicles</div>
          <div style="overflow-x:auto;min-width:0;border:1px solid var(--border);border-radius:10px">
            <table style="border-collapse:collapse;font-size:12px;min-width:1080px">
              <thead><tr>
                <th class="po-th" style="width:34px">#</th>
                ${rfqGridCols().map(c => procTh('rfq_items', c, { cls: 'po-th', style: `min-width:${c.width || 90}px` })).join('')}
                <th class="po-th" style="width:38px"></th>
              </tr></thead>
              <tbody id="rfq-rows"></tbody>
            </table>
          </div>
          <button class="btn btn-outline" style="margin-top:8px;padding:5px 10px;font-size:12px" onclick="rfqAddRow()">+ Add line</button> ${procColsBtn('rfq_items')}
          <button class="btn btn-outline" style="margin-top:8px;padding:5px 10px;font-size:12px;margin-left:6px" onclick="openCataloguePicker('rfq')">
            <i data-lucide="list-plus" style="width:13px;height:13px"></i> From supplier catalogue</button>
        </div>

        <div><div class="po-lbl">Payment Terms</div><textarea id="rfq-payment" class="form-input" rows="2">${esc(rec.payment_terms || '')}</textarea></div>
        <div style="${g}">
          <div><div class="po-lbl">Delivery Location</div><input id="rfq-delivery" class="form-input" value="${esc(rec.delivery_location || '')}"></div>
          <div><div class="po-lbl">Service Provider</div><input id="rfq-service" class="form-input" value="${esc(rec.service_provider || '')}"></div>
          <div><div class="po-lbl">Contact</div><input id="rfq-contact" class="form-input" value="${esc(rec.contact || '')}"></div>
        </div>
        <div><div class="po-lbl">Documents Required</div><textarea id="rfq-docs" class="form-input" rows="2">${esc(rec.documents_required || '')}</textarea></div>
        <div id="rfq-err" class="error-msg" style="display:none"></div>
      </div>`,
      `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
       <button class="btn btn-outline" onclick="saveRfq(true)">Save &amp; preview PDF</button>
       <button class="btn btn-primary" onclick="saveRfq(false)">Save</button>`,
      { wide: true });

    (Array.isArray(rec.items) && rec.items.length ? rec.items : [{}]).forEach(rfqAddRow);
    document.getElementById('rfq-supplier-id').innerHTML = await supplierOptionsHtml(rec.supplier_id);
    await ctxPopulateLeadPicker('rfq-customer-id', rec.customer_id || seedCustomerId || null);
  }

  function rfqAddRow(it) {
    const tbody = document.getElementById('rfq-rows');
    if (!tbody) return;
    const v = it || {};
    const tr = document.createElement('tr');
    tr.className = 'rfq-row';
    tr.innerHTML = `<td class="po-td rfq-no-cell" style="text-align:center;color:var(--muted)"></td>` +
      rfqGridCols().map(c => procGridInput(CE('rfq_items'), c, v[c.key], 'rfq-f')).join('') +
      `<td class="po-td" style="text-align:center"><button class="btn btn-outline" style="padding:2px 7px;font-size:14px;color:var(--danger);border-color:var(--danger)" title="Remove">×</button></td>`;
    tr.querySelector('button').onclick = () => { tr.remove(); rfqRenumber(); };
    tbody.appendChild(tr);
    rfqRenumber();
  }
  function rfqRenumber() {
    [...document.querySelectorAll('.rfq-row')].forEach((r, i) => {
      const c = r.querySelector('.rfq-no-cell'); if (c) c.textContent = i + 1;
    });
  }
  function rfqCollect() {
    const val = id => (document.getElementById(id)?.value || '').trim();
    return {
      rfq_no: val('rfq-no'), rfq_date: val('rfq-date') || null, issuer: val('rfq-issuer'),
      status: val('rfq-status'), customer_id: val('rfq-customer-id') || null,
      supplier_id: val('rfq-supplier-id') || null,
      supplier_name: val('rfq-supplier-name'), supplier_contact: val('rfq-supplier-contact'),
      supplier_address: val('rfq-supplier-address'), supplier_country: val('rfq-supplier-country'),
      payment_terms: val('rfq-payment'), delivery_location: val('rfq-delivery'),
      service_provider: val('rfq-service'), contact: val('rfq-contact'),
      documents_required: val('rfq-docs'),
      items: procGridCollect('.rfq-row', '.rfq-f'),
    };
  }
  async function saveRfq(thenPreview) {
    const payload = rfqCollect();
    const err = document.getElementById('rfq-err');
    const filled = payload.items.filter(it => it.brand || it.model || it.trim);
    if (!filled.length) { err.textContent = 'Add at least one vehicle line (brand, model or trim).'; err.style.display = 'block'; return; }
    payload.title = `${payload.supplier_name || 'RFQ'} — ${filled.length} vehicle(s)`;
    const r = await apiFetch(_rfqEditing.id ? `/api/dashboard/rfqs/${_rfqEditing.id}` : '/api/dashboard/rfqs',
      { method: _rfqEditing.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Failed to save.'; err.style.display = 'block'; return; }
    hideModal(); loadRfqs();
    if (thenPreview) viewDocPdfPayload('/api/dashboard/rfqs/pdf', payload, payload.rfq_no);
  }
  async function deleteRfq(id) {
    const r = _rfqCache.find(x => x.id === id);
    if (!confirm(`Delete RFQ ${r ? r.rfq_no : ''}?`)) return;
    await apiFetch(`/api/dashboard/rfqs/${id}`, { method: 'DELETE' });
    loadRfqs();
  }
  // Lead drawer → RFQ prefilled from this lead.
  function ldGenerateRfq() {
    if (!_ldProfile) return;
    const cid = _ldProfile.customer.id;
    closeLeadProfile(); navigate('rfqs'); openRfqForm(null, cid);
  }

  // Shared lead picker for document forms (contract / PO / RFQ all use the same list).
  async function ctxPopulateLeadPicker(selectId, selectedId) {
    const pick = document.getElementById(selectId);
    if (!pick) return;
    try {
      const leads = _allCustomers.length ? _allCustomers : await apiFetch('/api/dashboard/customers').then(r => r.json());
      if (!Array.isArray(leads)) return;
      if (!_allCustomers.length) _allCustomers = leads;
      pick.innerHTML = '<option value="">— No lead —</option>' +
        [...leads].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(l => `<option value="${l.id}">${esc(l.name)}${l.phone ? ' · ' + esc(l.phone) : ''}</option>`).join('');
      if (selectedId) pick.value = String(selectedId);
    } catch (_) {}
  }

  // ── Suppliers (Logistics & Shipping) ────────────────────────────────────────────
  let _suppliersCache = [];
  async function loadSuppliers() {
    const body = document.getElementById('suppliers-list');
    if (body) body.innerHTML = '<div class="loading"><div class="spinner"></div> Loading suppliers…</div>';
    let list = [];
    try { list = await apiFetch('/api/dashboard/suppliers').then(r => r.json()); }
    catch (_) { body.innerHTML = '<div class="error-msg">Failed to load suppliers.</div>'; return; }
    if (list && list.error) {
      body.innerHTML = `<div class="error-msg">${esc(list.error)}<br><span style="font-size:12px">If this mentions a missing <code>suppliers</code> table, run <code>migrations/003_logistics_deals_docs.sql</code>.</span></div>`;
      return;
    }
    _suppliersCache = Array.isArray(list) ? list : [];
    if (!_suppliersCache.length) {
      body.innerHTML = '<div style="color:var(--muted);padding:24px;text-align:center;font-size:13px">No suppliers yet.</div>';
      return;
    }
    const eng = suppliersEngine();
    await eng.load();
    const cols = eng.visible();
    body.innerHTML = `
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px">${procColsBtn('suppliers')}</div>
      <div class="table-scroll"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          ${cols.map(c => procTh('suppliers', c, { style: `padding:8px 10px${c.width ? `;min-width:${c.width}px` : ''}` })).join('')}
          <th style="padding:8px 10px;text-align:right">Actions</th></tr></thead>
        <tbody>${_suppliersCache.map(x => `
          <tr style="border-bottom:1px solid var(--border)">
            ${cols.map(c => {
              if (!c.builtin) return procCfCell(eng, c, x);
              if (c.type === 'select' || c.type === 'radio') return `<td style="padding:8px 10px">${eng.badgeHtml(c, x[c.key])}</td>`;
              if (c.key === 'name') return `<td style="padding:8px 10px;font-weight:600">${esc(x.name)}</td>`;
              if (c.key === 'notes' || c.key === 'address') return `<td style="padding:8px 10px;color:var(--muted)">${esc(x[c.key] || '')}</td>`;
              return `<td style="padding:8px 10px">${esc(x[c.key] || '—')}</td>`;
            }).join('')}
            <td style="padding:8px 10px;text-align:right;white-space:nowrap">
              <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openSupplierDetail(${x.id})">Open</button>
              ${procCan('suppliers', 'edit') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openSupplierForm(${x.id})">Edit</button>` : ''}
              ${procCan('suppliers', 'delete') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteSupplier(${x.id})">Delete</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  }
  // ── Supplier detail: what they offer, their paperwork, and what we actually bought
  // Kept as three tabs because they answer different questions. "Purchases" is
  // derived from stock units and purchase-order lines, never typed in, so it cannot
  // drift from what really happened.
  let _supTab = 'vehicles';
  let _supDetailId = null;
  let _supData = { vehicles: [], docs: [], purchases: null };

  async function openSupplierDetail(id) {
    _supDetailId = id;
    _supTab = 'vehicles';
    const sup = _suppliersCache.find(v => v.id === id) || {};
    showModal(sup.name || 'Supplier', `
      <div class="sup-tabs">
        ${[['vehicles', 'Vehicles'], ['docs', 'Documents'], ['purchases', 'Purchases']]
          // Each tab is its own grant now: docs → suppliers.docs, purchases →
          // suppliers.purchases; the catalogue is readable with the section.
          .filter(([k]) => k !== 'purchases' || procCan('suppliers', 'purchases'))
          .filter(([k]) => k !== 'docs' || procCan('suppliers', 'docs'))
          .map(([k, l]) => `<button class="sup-tab" data-t="${k}" onclick="supTab('${k}')">${l}</button>`).join('')}
      </div>
      <div id="sup-pane" style="min-height:220px"><div class="loading"><div class="spinner"></div></div></div>`,
      `<button class="btn btn-outline" onclick="hideModal()">Close</button>`, { wide: true });
    supTab('vehicles');
  }

  async function supTab(which) {
    _supTab = which;
    document.querySelectorAll('.sup-tab').forEach(b => b.classList.toggle('active', b.dataset.t === which));
    const pane = document.getElementById('sup-pane');
    if (!pane) return;
    pane.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const id = _supDetailId;
    try {
      if (which === 'vehicles') {
        _supData.vehicles = await apiFetch(`/api/dashboard/suppliers/${id}/vehicles`).then(r => r.json());
        supRenderVehicles();
      } else if (which === 'docs') {
        _supData.docs = await apiFetch(`/api/dashboard/suppliers/${id}/docs`).then(r => r.json());
        supRenderDocs();
      } else {
        _supData.purchases = await apiFetch(`/api/dashboard/suppliers/${id}/purchases`).then(r => r.json());
        supRenderPurchases();
      }
    } catch (e) { pane.innerHTML = `<div class="error-msg">${esc(String(e.message || e))}</div>`; }
    requestAnimationFrame(() => lucide.createIcons());
  }

  const SUP_V_COLS = [['brand', 'Brand'], ['model', 'Model'], ['trim', 'Trim'], ['model_year', 'Year'],
    ['availability', 'Availability'], ['fob_price', 'FOB price'], ['lead_time', 'Lead time'],
    ['accessories', 'Accessories']];

  function supRenderVehicles() {
    const rows = Array.isArray(_supData.vehicles) ? _supData.vehicles : [];
    document.getElementById('sup-pane').innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <button class="btn btn-outline btn-sm" onclick="supAddVehicleRow()"><i data-lucide="plus" style="width:13px;height:13px"></i> Add vehicle</button>
      </div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px">
        <table style="border-collapse:collapse;font-size:12px;min-width:900px;width:100%">
          <thead><tr>${SUP_V_COLS.map(([, l]) => `<th class="po-th">${esc(l)}</th>`).join('')}<th class="po-th" style="width:38px"></th></tr></thead>
          <tbody id="sup-v-body">${rows.map(supVehicleRowHtml).join('')}</tbody>
        </table>
      </div>
      ${rows.length ? '' : '<div style="color:var(--muted);font-size:12.5px;padding:14px;text-align:center">Nothing listed yet. Add what this supplier offers so RFQs and purchase orders can pick from it.</div>'}`;
  }
  function supVehicleRowHtml(v) {
    return `<tr data-vid="${v.id}">${SUP_V_COLS.map(([k]) => {
      const val = k === 'fob_price' && v[k] ? Number(v[k]).toLocaleString() : (v[k] ?? '');
      return `<td class="po-td"><input class="form-input sup-v" data-k="${k}" value="${esc(String(val))}"
        style="font-size:12px;padding:5px 6px" onchange="supSaveVehicle(${v.id}, this)"></td>`;
    }).join('')}
    <td class="po-td"><button class="btn btn-outline" style="padding:2px 6px;color:var(--danger);border-color:var(--danger)"
      onclick="supDeleteVehicle(${v.id})"><i data-lucide="x" style="width:12px;height:12px"></i></button></td></tr>`;
  }
  function supRowPayload(tr) {
    const o = {};
    tr.querySelectorAll('.sup-v').forEach(i => { o[i.dataset.k] = i.value; });
    return o;
  }
  async function supAddVehicleRow() {
    const r = await apiFetch(`/api/dashboard/suppliers/${_supDetailId}/vehicles`,
      { method: 'POST', body: JSON.stringify({ brand: 'New', model: '' }) });
    if (!r.ok) return showAdminToast('Could not add that row.');
    supTab('vehicles');
  }
  async function supSaveVehicle(vid, input) {
    const tr = input.closest('tr');
    const r = await apiFetch(`/api/dashboard/suppliers/${_supDetailId}/vehicles/${vid}`,
      { method: 'PUT', body: JSON.stringify(supRowPayload(tr)) });
    if (!r.ok) showAdminToast('Could not save that change.');
  }
  async function supDeleteVehicle(vid) {
    if (!confirm('Remove this vehicle from the supplier list?')) return;
    await apiFetch(`/api/dashboard/suppliers/${_supDetailId}/vehicles/${vid}`, { method: 'DELETE' });
    supTab('vehicles');
  }

  function supRenderDocs() {
    const rows = Array.isArray(_supData.docs) ? _supData.docs : [];
    const kb = n => n ? Math.max(1, Math.round(n / 1024)) + ' KB' : '';
    document.getElementById('sup-pane').innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <input type="file" id="sup-doc-file" style="display:none" onchange="supUploadDoc(this)">
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('sup-doc-file').click()">
          <i data-lucide="upload" style="width:13px;height:13px"></i> Upload document</button>
        <span style="font-size:11.5px;color:var(--muted)">Stored in Google Drive, under MotoLinker / Suppliers.</span>
      </div>
      <div id="sup-doc-err"></div>
      ${rows.length ? `<div class="hd-files">${rows.map(d => `
        <a class="hd-file" href="${esc(d.web_link || '#')}" target="_blank" rel="noopener">
          <div class="hd-file-ic"><i data-lucide="file-text" style="width:22px;height:22px"></i></div>
          <div class="hd-file-meta"><div class="hd-file-name">${esc(d.name || 'file')}</div>
            <div class="hd-file-sub">${esc(kb(d.size_bytes))}</div></div></a>`).join('')}</div>`
        : '<div style="color:var(--muted);font-size:12.5px;padding:14px;text-align:center">No documents yet.</div>'}`;
  }
  async function supUploadDoc(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const err = document.getElementById('sup-doc-err');
    err.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px 0">Uploading…</div>';
    const fd = new FormData();
    fd.append('file', f);
    const r = await apiFetch(`/api/dashboard/suppliers/${_supDetailId}/docs`, { method: 'POST', body: fd });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      err.innerHTML = `<div class="error-msg" style="display:block">${esc(e.error || 'Upload failed.')}</div>`;
      return;
    }
    supTab('docs');
  }

  function supRenderPurchases() {
    const p = _supData.purchases || { units: [], poLines: [], totals: {} };
    const t = p.totals || {};
    const money = n => (Number(n) || 0).toLocaleString();
    document.getElementById('sup-pane').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
        ${[['Cars received', t.vehicles || 0], ['Ordered on POs', t.ordered || 0],
           ['Avg price paid', money(t.avg_unit_price)], ['Avg PO price', money(t.avg_po_price)]]
          .map(([l, v]) => `<div class="home-w" style="padding:12px 14px"><div class="home-w-title">${l}</div>
            <div class="home-big" style="font-size:22px">${v}</div></div>`).join('')}
      </div>
      ${(t.lead_times || []).length ? `<div style="font-size:12px;color:var(--muted);margin-bottom:12px">
        Quoted lead times seen: ${esc((t.lead_times || []).join(' · '))}</div>` : ''}
      <div class="stock-sec-label">Cars received (${p.units.length})</div>
      ${p.units.length ? `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px;margin-bottom:14px">
        <table style="border-collapse:collapse;font-size:12px;width:100%">
          <thead><tr><th class="po-th">Model</th><th class="po-th">VIN</th><th class="po-th">Colour</th><th class="po-th" style="text-align:right">Price</th></tr></thead>
          <tbody>${p.units.map(u => `<tr>
            <td class="po-td">${esc([u.make, u.model, u.trim].filter(Boolean).join(' '))}</td>
            <td class="po-td">${esc(u.vin || '—')}</td><td class="po-td">${esc(u.colour || '—')}</td>
            <td class="po-td" style="text-align:right">${u.price ? money(u.price) : '—'}</td></tr>`).join('')}</tbody>
        </table></div>`
        : '<div style="color:var(--muted);font-size:12.5px;padding:10px 0 16px">None attributed to this supplier yet. Stock units carry a supplier — set it there and it shows here.</div>'}
      <div class="stock-sec-label">Purchase-order lines (${p.poLines.length})</div>
      ${p.poLines.length ? `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px">
        <table style="border-collapse:collapse;font-size:12px;width:100%">
          <thead><tr><th class="po-th">PO</th><th class="po-th">Model</th><th class="po-th">Qty</th>
            <th class="po-th" style="text-align:right">Price</th><th class="po-th">Lead time</th></tr></thead>
          <tbody>${p.poLines.map(l => `<tr>
            <td class="po-td">${esc(l.po_number || '')}</td>
            <td class="po-td">${esc([l.brand, l.model, l.trim].filter(Boolean).join(' '))}</td>
            <td class="po-td">${l.qty}</td>
            <td class="po-td" style="text-align:right">${l.price ? money(l.price) : '—'}</td>
            <td class="po-td">${esc(l.lead_time || '—')}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div style="color:var(--muted);font-size:12.5px;padding:10px 0">No purchase orders yet.</div>'}`;
  }

  function suppliersEngine() {
    return procColsEngine('suppliers', tupleCols([
      ['name', 'Name', 140], ['contact', 'Contact', 120],
      ['country', 'Country', 90], ['address', 'Address', 160], ['notes', 'Notes', 160],
    ], {}), () => loadSuppliers());
  }

  function openSupplierForm(id) {
    const x = id ? _suppliersCache.find(v => v.id === id) : null;
    const eng = suppliersEngine();
    // Builtin supplier fields honor their configured type too — switch Country to
    // a dropdown in the field editor and the form draws a dropdown.
    const builtinField = c => {
      const v = x ? (x[c.key] == null ? '' : x[c.key]) : '';
      if (c.type === 'select' || c.type === 'radio') {
        return `<div class="form-group"><label class="form-label">${esc(c.label)}</label>
          <select class="form-control" id="sup-${c.key}"><option value="">—</option>
            ${(c.options || []).map(o => `<option value="${esc(o.key)}" ${String(v) === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select></div>`;
      }
      const type = c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text';
      return `<div class="form-group"><label class="form-label">${esc(c.label)}</label>
        <input class="form-control" type="${type}" id="sup-${c.key}" value="${esc(v)}"></div>`;
    };
    showModal(id ? 'Edit supplier' : 'Add supplier', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 12px">
        ${eng.visible().map(c => c.builtin ? builtinField(c) : eng.inputHtml(c, (x && x.custom_fields || {})[c.key])).join('')}
      </div>
      <div id="sup-err" class="error-msg" style="display:none"></div>`,
      `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
       <button class="btn btn-primary" onclick="saveSupplier(${id || 'null'})">Save</button>`);
  }
  async function saveSupplier(id) {
    const eng = suppliersEngine();
    const g = k => { const el = document.getElementById('sup-' + k); return el ? el.value.trim() : ''; };
    const payload = { name: g('name'), contact: g('contact'), country: g('country'), address: g('address'), notes: g('notes') };
    payload.custom_fields = eng.collect(document.getElementById('modal-body'));
    const err = document.getElementById('sup-err');
    const missing = eng.validateRequired(document.getElementById('modal-body'));
    if (missing.length) { err.textContent = 'Required: ' + missing.join(', '); err.style.display = 'block'; return; }
    if (!payload.name) { err.textContent = 'Supplier name is required.'; err.style.display = 'block'; return; }
    const r = await apiFetch(id ? `/api/dashboard/suppliers/${id}` : '/api/dashboard/suppliers',
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Failed to save.'; err.style.display = 'block'; return; }
    hideModal(); loadSuppliers();
  }
  async function deleteSupplier(id) {
    const x = _suppliersCache.find(v => v.id === id);
    if (!confirm(`Delete supplier ${x ? x.name : ''}?`)) return;
    await apiFetch(`/api/dashboard/suppliers/${id}`, { method: 'DELETE' });
    loadSuppliers();
  }
  // Shared <select> of suppliers; picking one fills the document's supplier block.
  async function supplierOptionsHtml(selectedId) {
    if (!_suppliersCache.length) {
      try { const l = await apiFetch('/api/dashboard/suppliers').then(r => r.json()); if (Array.isArray(l)) _suppliersCache = l; } catch (_) {}
    }
    return '<option value="">— None —</option>' + _suppliersCache
      .map(x => `<option value="${x.id}" ${String(selectedId) === String(x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  }
  function supplierFillFields(selId, prefix) {
    const x = _suppliersCache.find(v => String(v.id) === String(selId));
    if (!x) return;
    const set = (id, val) => { const el = document.getElementById(prefix + id); if (el) el.value = val || ''; };
    set('supplier-name', x.name); set('supplier-contact', x.contact);
    set('supplier-address', x.address); set('supplier-country', x.country);
  }

  // ── Submissions ───────────────────────────────────────────────────────────────
  async function loadSubmissions() {
    const c = document.getElementById('submissions-table-container');
    c.innerHTML = '<div class="loading"><div class="spinner"></div> Loading submissions…</div>';
    try {
      const res  = await apiFetch('/api/submissions');
      const data = await res.json();
      if (!res.ok) { c.innerHTML = `<div class="error-msg">${esc(data.error || 'Failed to load')}</div>`; return; }
      if (!data.length) {
        c.innerHTML = `<div style="text-align:center;padding:60px 0;color:var(--muted)">
          <div style="font-size:40px;margin-bottom:12px">—</div>
          <div style="font-size:15px;font-weight:600">No submissions yet</div>
          <div style="font-size:13px;margin-top:6px">Submissions from website forms will appear here.</div>
        </div>`;
        return;
      }
      c.innerHTML = `
        <div class="table-scroll" style="background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow)">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f7fafc">
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Name</th>
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Lead</th>
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Email</th>
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Phone</th>
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Car Interest</th>
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Message</th>
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Submitted</th>
              <th style="padding:10px 16px;border-bottom:1px solid var(--border)"></th>
            </tr></thead>
            <tbody>${data.map(s => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:12px 16px;font-size:13px;font-weight:600">${esc(s.name)}</td>
                <td style="padding:12px 16px;font-size:12px">${s.customer_id ? `<span onclick="openLeadProfile(${s.customer_id})" title="Open lead profile" style="cursor:pointer;color:var(--primary);background:rgba(230,150,80,.12);padding:2px 8px;border-radius:20px;font-weight:600;white-space:nowrap">→ ${esc(s.lead_name || 'lead')}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
                <td style="padding:12px 16px;font-size:13px"><a href="mailto:${esc(s.email)}" style="color:var(--primary)">${esc(s.email)}</a></td>
                <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${esc(s.phone || '—')}</td>
                <td style="padding:12px 16px;font-size:13px">${esc(s.car_interest || '—')}</td>
                <td style="padding:12px 16px;font-size:13px;color:var(--muted);max-width:240px;white-space:pre-wrap;word-break:break-word">${esc(s.message || '—')}</td>
                <td style="padding:12px 16px;font-size:12px;color:var(--muted);white-space:nowrap">${new Date(s.submitted_at).toLocaleString()}</td>
                <td style="padding:12px 16px;text-align:right">
                  ${procCan('submissions', 'delete') ? `<button class="btn btn-outline" style="font-size:12px;padding:4px 12px;color:var(--danger);border-color:var(--danger)" onclick="deleteSubmission(${s.id})">Delete</button>` : ''}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (e) { c.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; }
    requestAnimationFrame(() => lucide.createIcons());
  }

  async function deleteSubmission(id) {
    if (!confirm('Delete this submission?')) return;
    const res = await apiFetch(`/api/submissions/${id}`, { method: 'DELETE' });
    if (res.ok) loadSubmissions();
    else alert('Delete failed');
  }


  // ── Column-engine adoption ───────────────────────────────────────────────────
  // Sales, the PO/RFQ line-item grids and the supplier register read their
  // columns from the shared engine now (columns.js) — rename, reorder, hide,
  // add cf_ fields, option colors, required — the same editor leads have.
  // Editing the layout is the ADMIN's: the server refuses employee writes for
  // these entities, so canEdit mirrors that instead of offering a doomed save.
  function procColsEngine(entity, builtins, onChange) {
    return CE(entity) || ColumnsEngine(entity, {
      base: PROCFG.base,
      fetch: (url, opts) => PROCFG.fetch(url, opts),
      modal: (...a) => PROCFG.modal(...a),
      closeModal: () => PROCFG.closeModal(),
      builtins,
      canEdit: () => PROCFG.base === '/api/dashboard',
      onChange,
    });
  }
  const tupleCols = (tuples, types) => tuples.map(([key, label, width]) => ({
    key, label, width, builtin: true, visible: true,
    type: (types && types[key]) || 'text',
    ...(types && types['options:' + key] ? { options: types['options:' + key] } : {}),
  }));
  // A "Columns" affordance for the tables that adopted the engine.
  function procColsBtn(entity) {
    const eng = CE(entity);
    if (!eng || !eng.cfg.canEdit()) return '';
    return `<button class="btn btn-outline" style="padding:4px 10px;font-size:12px" onclick="CE('${entity}').openPicker(event)">Columns</button>
      <button class="btn btn-outline" style="padding:4px 10px;font-size:12px" onclick="CE('${entity}').openAddModal()">+ Field</button>`;
  }
  // A header cell with the field menu behind a chevron — the affordance the leads
  // table always had. Without it these tables offered show/hide and "+ Field" and
  // nothing else, so a field's TYPE and its dropdown OPTIONS were unreachable
  // once created: exactly the "I still cannot edit the fields" report.
  function procTh(entity, col, o) {
    const eng = CE(entity);
    const opts = o || {};
    const chev = eng && eng.cfg.canEdit()
      ? `<span class="col-chev-btn" title="Field options — type, dropdown options, colors"
           onclick="event.stopPropagation();CE('${entity}').openMenu(event,'${escJs(col.key)}')"
           style="cursor:pointer;display:inline-flex;align-items:center;padding:0 2px;margin-left:3px;border-radius:4px;opacity:.7;vertical-align:middle"><i data-lucide="chevron-down" style="width:11px;height:11px"></i></span>`
      : '';
    return `<th class="${opts.cls || ''}" style="${opts.style || ''}">${esc(col.label)}${chev}</th>`;
  }
  // One line-grid cell, rendered for the column's CONFIGURED type. Before this the
  // PO/RFQ sheets hardcoded their controls by key, so a field switched to a
  // dropdown — or added as one — still drew a plain text box.
  function procGridInput(eng, col, val, cls) {
    const k = escJs(col.key);
    const base = 'font-size:12px;padding:5px 6px';
    if (col.type === 'select' || col.type === 'radio') {
      const opts = (col.options || []).map(op =>
        `<option value="${esc(op.key)}" ${String(val == null ? '' : val) === op.key ? 'selected' : ''}>${esc(op.label)}</option>`).join('');
      const known = (col.options || []).some(op => op.key === String(val == null ? '' : val));
      return `<td class="po-td"><select class="form-input ${cls}" data-k="${k}" style="${base}">
        <option value="" ${!val || known ? '' : 'selected'}>—</option>${opts}</select></td>`;
    }
    if (col.type === 'checkbox') {
      return `<td class="po-td" style="text-align:center"><input type="checkbox" class="${cls}" data-k="${k}"
        ${val === true || val === 'true' || val === 1 || val === '1' ? 'checked' : ''} style="accent-color:var(--primary)"></td>`;
    }
    // Long free text keeps the textarea it was designed with.
    if (col.key === 'accessories') {
      return `<td class="po-td"><textarea class="form-input ${cls}" data-k="${k}" rows="2"
        style="font-size:11.5px;padding:5px 6px;resize:vertical">${esc(val == null ? '' : String(val))}</textarea></td>`;
    }
    const type = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text';
    return `<td class="po-td"><input class="form-input ${cls}" data-k="${k}" type="${type}"
      ${type === 'number' ? 'min="0"' : ''} value="${esc(val == null ? '' : String(val))}" style="${base}"></td>`;
  }
  // Line grids collect by class; a checkbox reports .checked, everything else .value.
  function procGridCollect(rowSel, fieldSel) {
    return [...document.querySelectorAll(rowSel)].map(r => {
      const o = {};
      r.querySelectorAll(fieldSel).forEach(el => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; });
      return o;
    });
  }
  // Render one custom-field cell for a record whose extras live in custom_fields.
  function procCfCell(eng, col, rec) {
    const raw = (rec.custom_fields || {})[col.key];
    if ((col.type === 'select' || col.type === 'radio')) return `<td style="padding:8px 10px">${eng.badgeHtml(col, raw)}</td>`;
    if (col.type === 'checkbox') return `<td style="padding:8px 10px;text-align:center">${raw === true || raw === 'true' ? '✓' : '—'}</td>`;
    return `<td style="padding:8px 10px">${esc(raw == null ? '' : String(raw))}</td>`;
  }

  // ── Sales (the Deals page's Sales tab) ───────────────────────────────────────
  // Moved here from dashboard.js when the tab became a permission of its own
  // (deals.sales to read, deals.salesEdit to write): both portals render it now,
  // through the same PROCFG seam as everything else in this file.
  let _salesCache = [];
  const SALE_STATUS_OPTS = PO_LINE_STATUSES;

  // Sales is its own table — a row per sold car, opened when a deal is Won.
  const SALE_COLS = [
    ['client', 'Client', 130], ['consignee', 'Consignee', 130], ['brand', 'Brand', 80],
    ['model', 'Model', 90], ['trim', 'Trim', 90], ['colour', 'Colour EXT / INT', 130],
    ['vin', 'VIN', 140], ['status', 'Status', 150], ['sales_name', 'Sales Name', 110],
    ['price_list', 'Price List', 100], ['down_payment', 'D payment', 100],
    ['discounted', 'Discounted', 100], ['remaining', 'Remaining', 100],
    ['remaining_due', 'Remaining due', 130], ['reservation_date', 'Reservation Date', 140],
    ['payment_type', 'Payment type', 120], ['delivery_date', 'Delivery Date', 130],
    ['client_file', 'Client File', 110],
  ];
  const SALE_DATE_KEYS = ['remaining_due', 'reservation_date', 'delivery_date'];
  const SALE_NUM_KEYS  = ['price_list', 'down_payment', 'discounted', 'remaining'];
  function salesEngine() {
    const types = {};
    SALE_DATE_KEYS.forEach(k => { types[k] = 'date'; });
    SALE_NUM_KEYS.forEach(k => { types[k] = 'number'; });
    types.status = 'select';
    types['options:status'] = SALE_STATUS_OPTS.map(o => ({ key: o.key, label: o.label, color: o.fg }));
    return procColsEngine('sales', tupleCols(SALE_COLS, types), () => loadSales());
  }

  async function loadSales() {
    const box = document.getElementById('deals-sales-table');
    if (box) box.innerHTML = '<div class="loading"><div class="spinner"></div> Loading sales…</div>';
    const eng = salesEngine();
    await eng.load();
    let list = [];
    try { list = await apiFetch('/api/dashboard/sales').then(r => r.json()); }
    catch (_) { box.innerHTML = '<div class="error-msg">Failed to load sales.</div>'; return; }
    if (list && list.error) {
      box.innerHTML = `<div class="error-msg">${esc(list.error)}<br><span style="font-size:12px">If this mentions a missing <code>sales</code> table, run <code>migrations/003_logistics_deals_docs.sql</code>.</span></div>`;
      return;
    }
    _salesCache = Array.isArray(list) ? list : [];
    if (!_salesCache.length) {
      box.innerHTML = '<div style="color:var(--muted);padding:24px;text-align:center;font-size:13px">No sales yet — a row opens automatically when a deal is Won.</div>';
      return;
    }
    const cols = eng.visible();
    box.innerHTML = `
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px">${procColsBtn('sales')}</div>
      <div class="table-scroll"><table class="wide-table wide-table-xl" style="border-collapse:collapse;font-size:12.5px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          <th style="padding:8px 10px;width:40px">No</th>
          ${cols.map(c => procTh('sales', c, { style: `padding:8px 10px;min-width:${c.width || 90}px` })).join('')}
          <th style="padding:8px 10px;text-align:right"></th></tr></thead>
        <tbody>${_salesCache.map((x, i) => {
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px 10px;color:var(--muted)">${i + 1}</td>
            ${cols.map(c => {
              const k = c.key;
              if (!c.builtin) return procCfCell(eng, c, x);
              // Badges come from the column's configured options, so renaming a
              // status or recoloring it in the field editor shows up here.
              if (c.type === 'select' || c.type === 'radio') return `<td style="padding:8px 10px">${eng.badgeHtml(c, x[k])}</td>`;
              if (SALE_NUM_KEYS.includes(k)) return `<td style="padding:8px 10px;text-align:right">${Number(x[k]) ? Number(x[k]).toLocaleString() : '—'}</td>`;
              if (k === 'client_file' && x[k]) return `<td style="padding:8px 10px"><a href="${esc(x[k])}" target="_blank" rel="noopener" style="color:var(--primary)">file</a></td>`;
              return `<td style="padding:8px 10px">${esc(x[k] || '')}</td>`;
            }).join('')}
            <td style="padding:8px 10px;text-align:right;white-space:nowrap">
              ${procCan('deals', 'salesEdit') ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openSaleForm(${x.id})">Edit</button>
              <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteSale(${x.id})">Delete</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }

  function openSaleForm(id) {
    const x = id ? _salesCache.find(v => v.id === id) : null;
    const field = (col) => {
      const k = col.key, label = col.label;
      // Builtin dropdowns follow the configured option list, not a frozen const.
      if (col.type === 'select' || col.type === 'radio') {
        const opts = col.options || [];
        const cur = x?.[k] == null ? (opts[0] && opts[0].key) : x[k];
        return `<div><div class="po-lbl">${esc(label)}</div><select id="sale-${k}" class="form-input">
          ${opts.map(o => `<option value="${esc(o.key)}" ${cur === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></div>`;
      }
      if (col.type === 'checkbox') {
        return `<div><div class="po-lbl">${esc(label)}</div>
          <input id="sale-${k}" type="checkbox" ${x?.[k] === true || x?.[k] === 'true' ? 'checked' : ''} style="accent-color:var(--primary)"></div>`;
      }
      if (k === 'client_file') {
        // Client paperwork is scans and can be large, so it goes to Google Drive
        // rather than the 1 GB Supabase tier. Upload needs a saved row to attach to.
        const meta = x?.client_file_meta || null;
        return `<div style="grid-column:1/-1"><div class="po-lbl">${esc(label)}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${x?.client_file ? `<a href="${esc(x.client_file)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">
              <i data-lucide="file-text" style="width:13px;height:13px"></i> ${esc(meta?.name || 'Open current file')}</a>` : ''}
            <input type="file" id="sale-file-input" style="display:none" onchange="saleUploadFile(${id || 'null'}, this)">
            <button class="btn btn-outline btn-sm" ${id ? '' : 'disabled title="Save the sale first"'}
              onclick="document.getElementById('sale-file-input').click()">
              <i data-lucide="upload" style="width:13px;height:13px"></i> ${x?.client_file ? 'Replace file' : 'Upload file'}</button>
            <span style="font-size:11px;color:var(--muted)">Stored in your Google Drive → <strong>MotoLinker / Client Files</strong> · up to 25 MB</span>
          </div>
          <div id="sale-file-msg" style="font-size:12px;margin-top:6px"></div>
          <input type="hidden" id="sale-client_file" value="${esc(x?.client_file || '')}"></div>`;
      }
      const type = col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text';
      return `<div><div class="po-lbl">${esc(label)}</div><input id="sale-${k}" class="form-input" type="${type}" value="${esc(x?.[k] == null ? '' : String(x[k]))}"></div>`;
    };
    const eng = salesEngine();
    showModal(id ? 'Edit sale' : 'Add sale', `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;max-height:66vh;overflow-y:auto;padding-right:4px">
        ${eng.visible().map(c => c.builtin ? field(c) : eng.inputHtml(c, (x && x.custom_fields || {})[c.key])).join('')}
        <div id="sale-err" class="error-msg" style="display:none;grid-column:1/-1"></div>
      </div>`,
      `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
       <button class="btn btn-primary" onclick="saveSale(${id || 'null'})">Save</button>`,
      { wide: true });
  }
  // Upload straight to Drive. Refuses rather than falling back to Supabase, so a
  // disconnected Drive is loud instead of quietly eating the free tier.
  async function saleUploadFile(id, input) {
    const f = input.files && input.files[0];
    const msg = document.getElementById('sale-file-msg');
    if (!f || !id) return;
    msg.style.color = 'var(--muted)';
    msg.textContent = 'Uploading to Drive…';
    const fd = new FormData();
    fd.append('file', f);
    const r = await apiFetch(`/api/dashboard/sales/${id}/file`, { method: 'POST', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      msg.style.color = 'var(--danger)';
      msg.innerHTML = esc(d.error || 'Upload failed.')
        + (r.status === 409 ? ' <a href="#" onclick="hideModal();navigate(\'drive\');return false" style="color:var(--primary)">Connect Drive</a>' : '');
      return;
    }
    msg.style.color = 'var(--success)';
    // Name the destination and link the file — "Uploaded." answered none of the
    // questions people actually had ("uploaded WHERE?").
    const meta = d.client_file_meta || {};
    msg.innerHTML = `Saved to Drive → MotoLinker / Client Files` +
      (d.client_file ? ` · <a href="${esc(d.client_file)}" target="_blank" rel="noopener" style="color:var(--primary)">${esc(meta.name || 'open the file')}</a>` : '');
    document.getElementById('sale-client_file').value = d.client_file || '';
    loadSales();
  }

  async function saveSale(id) {
    const eng = salesEngine();
    const payload = {};
    SALE_COLS.forEach(([k]) => {
      const el = document.getElementById('sale-' + k);
      if (el) payload[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
    payload.custom_fields = eng.collect(document.getElementById('modal-body'));
    const err = document.getElementById('sale-err');
    const missing = eng.validateRequired(document.getElementById('modal-body'));
    if (missing.length) { err.textContent = 'Required: ' + missing.join(', '); err.style.display = 'block'; return; }
    if (!payload.client && !payload.vin && !payload.model) {
      err.textContent = 'Enter at least a client, model or VIN.'; err.style.display = 'block'; return;
    }
    const r = await apiFetch(id ? `/api/dashboard/sales/${id}` : '/api/dashboard/sales',
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Failed to save.'; err.style.display = 'block'; return; }
    hideModal(); loadSales();
  }
  async function deleteSale(id) {
    if (!confirm('Delete this sale record?')) return;
    await apiFetch(`/api/dashboard/sales/${id}`, { method: 'DELETE' });
    loadSales();
  }

  // Everything the pages call from an inline onclick, plus what the rest of each
  // bundle still reaches for — these were plain globals before the move and stay
  // globals now, so no call site had to change.
  Object.assign(window, {
    CT_STATUS, PO_LINE_STATUSES, PO_STATUS, cataloguePick,
    closeDocPdf, ctCollect, ctField, ctGet,
    ctPopulateLeadPicker, ctSet, ctxPopulateLeadPicker, deleteContract,
    deletePo, deleteRfq, deleteSubmission, deleteSupplier,
    downloadContractPdf, downloadDocPdf, downloadPoPdf, escJs,
    ldGenerateContract, ldGeneratePo, ldGenerateRfq, loadContracts,
    loadPurchaseOrders, loadRfqs, loadSubmissions, loadSuppliers,
    openCataloguePicker, openContractForm, openPoForm, openRfqForm,
    openSupplierDetail, openSupplierForm, poAddRow, poCollect,
    poCollectItems, poLineStatus, poLineTotal, poPopulateLeadPicker,
    poRenumber, poSupplierPicked, previewContract, previewPo,
    renderContractPdf, renderPoPdf, rfqAddRow, rfqCollect,
    rfqRenumber, saveContract, savePo, saveRfq,
    saveSupplier, supAddVehicleRow, supCatFilter, supCatLabel,
    supCatRows, supCatalogue, supDeleteVehicle, supRenderDocs,
    supRenderPurchases, supRenderVehicles, supRowPayload, supSaveVehicle,
    supTab, supUploadDoc, supVehicleRowHtml, supplierFillFields,
    supplierOptionsHtml, viewDocPdf, viewDocPdfPayload,
      SALE_COLS, SALE_STATUS_OPTS, deleteSale, loadSales, openSaleForm, saleUploadFile, saveSale,
  });
})();
