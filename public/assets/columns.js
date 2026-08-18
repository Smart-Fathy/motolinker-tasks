// The column engine — ClickUp-style configurable fields, shared by both portals.
//
// This is the leads column editor, generalized. It used to live twice: ~420
// lines in dashboard.js and a near-verbatim ~260 in employee.js, which is how a
// fix could land in one portal and quietly miss the other. It lives here once
// now, parameterized by entity, so Sales, PO/RFQ line items and the supplier
// register can adopt the same editor instead of growing copies of their own.
//
// One instance per entity per page:
//
//   ColumnsEngine('leads', {
//     base: PROCFG.base,  fetch: PROCFG.fetch,   // which portal's API
//     builtins: [...],                            // seeds an empty config
//     canEdit: () => bool,                        // hides every mutating affordance
//     onChange: () => {},                         // re-render after any change
//     sort: { get: () => ({key,dir}), set: (k,d) => {} },   // optional menu entries
//   })
//
// The instance's `cols` array is THE array — call sites keep a reference and the
// engine mutates it in place, so nothing has to re-fetch after a reorder.
//
// Column shape (a superset of what was always stored, so old configs parse):
//   { key, label, type, builtin, visible, deleted?,
//     required?, width?, options?: [{ key, label, color? }] }

const CE_REGISTRY = {};
function CE(entity) { return CE_REGISTRY[entity]; }

function ColumnsEngine(entity, cfg) {
  const E = {
    entity, cfg,
    cols: [],
    loaded: false,
  };
  CE_REGISTRY[entity] = E;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const canEdit = () => !cfg.canEdit || cfg.canEdit();
  const changed = () => { E.save(); if (cfg.onChange) cfg.onChange(); };

  // ── Config CRUD ───────────────────────────────────────────────────────────
  E.merge = function (saved) {
    const defaults = cfg.builtins || [];
    if (!Array.isArray(saved) || !saved.length) return JSON.parse(JSON.stringify(defaults));
    const cols = saved
      .filter(c => c && c.key && (!c.builtin || defaults.some(d => d.key === c.key)))
      .map(c => ({ ...c, visible: c.visible !== false }));
    // Builtins introduced after the config was saved get appended
    defaults.forEach(d => { if (!cols.some(c => c.key === d.key)) cols.push(JSON.parse(JSON.stringify(d))); });
    cols.forEach(c => {
      const d = defaults.find(x => x.key === c.key);
      // Select builtins must always carry an options list…
      if (d && d.options && !Array.isArray(c.options)) c.options = JSON.parse(JSON.stringify(d.options));
      // …and options saved before colors existed inherit the builtin's color, so
      // upgrading costs nobody the badges they are about to gain.
      if (d && d.options && Array.isArray(c.options)) {
        c.options.forEach(o => {
          if (!o.color) { const m = d.options.find(x => x.key === o.key); if (m && m.color) o.color = m.color; }
        });
      }
    });
    return cols;
  };
  E.load = async function () {
    if (E.loaded) return E.cols;
    let saved = null;
    try {
      const d = await cfg.fetch(cfg.base + '/columns/' + entity).then(r => r.json());
      saved = d.columns;
    } catch (_) {}
    const merged = E.merge(saved);
    E.cols.length = 0;
    merged.forEach(c => E.cols.push(c));
    E.loaded = true;
    return E.cols;
  };
  E.save = function () {
    cfg.fetch(cfg.base + '/columns/' + entity, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: E.cols }),
    }).catch(() => {});
  };

  // ── Lookups ───────────────────────────────────────────────────────────────
  E.col = key => E.cols.find(c => c.key === key) || (cfg.builtins || []).find(c => c.key === key);
  E.visible = () => E.cols.filter(c => c.visible && !c.deleted);
  E.optMap = col => { const m = {}; ((col && col.options) || []).forEach(o => { m[o.key] = o.label; }); return m; };
  E.optionColor = (col, key) => {
    const o = ((col && col.options) || []).find(x => x.key === key);
    return (o && o.color) || null;
  };
  // A colored pill for any select/radio value. This replaces the hardcoded
  // LEAD_STATUS_COLORS maps — status was the only column with badges because it
  // was the only one anyone had written colors for.
  E.badgeHtml = function (col, rawKey, label) {
    const text = label != null ? label : (E.optMap(col)[rawKey] || rawKey || '—');
    const hex = E.optionColor(col, rawKey);
    const bg = hex ? hexA(hex, 0.12) : 'rgba(255,255,255,.06)';
    const fg = hex || 'var(--muted)';
    const bd = hex ? hexA(hex, 0.30) : 'rgba(255,255,255,.12)';
    return `<span style="display:inline-flex;align-items:center;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700;line-height:1.5;white-space:nowrap;background:${bg};color:${fg};border:1px solid ${bd}">${esc(text)}</span>`;
  };

  // ── The floating menu (sort / rename / type / options / move / hide / delete)
  E.openMenu = function (e, key) {
    e.stopPropagation();
    const col = E.col(key);
    if (!col) return;
    const m = ceMenu();
    m.dataset.mode = 'colmenu';
    const vis = E.visible();
    const vi = vis.findIndex(c => c.key === key);
    const canType = col.type !== 'virtual' && !(cfg.fixedKeys || []).includes(col.key);
    const sort = cfg.sort ? cfg.sort.get() : null;
    const sorted = sort && sort.key === key;
    const edit = canEdit();
    m.innerHTML = `
      ${cfg.sort ? `
      <button onclick="CE('${entity}')._sort('${esc(key)}','asc')"${sorted && sort.dir === 'asc' ? ' class="active"' : ''}><i data-lucide="arrow-up-narrow-wide" style="width:13px;height:13px"></i> Sort ascending</button>
      <button onclick="CE('${entity}')._sort('${esc(key)}','desc')"${sorted && sort.dir === 'desc' ? ' class="active"' : ''}><i data-lucide="arrow-down-wide-narrow" style="width:13px;height:13px"></i> Sort descending</button>
      ${sorted ? `<button onclick="CE('${entity}')._sort(null)"><i data-lucide="x" style="width:13px;height:13px"></i> Clear sort</button>` : ''}` : ''}
      ${edit ? `
      ${cfg.sort ? '<div class="lead-menu-sep"></div>' : ''}
      ${canType ? `<button onclick="CE('${entity}').openFieldModal('${esc(key)}')"><i data-lucide="settings-2" style="width:13px;height:13px"></i> Edit field…</button>` : ''}
      <button onclick="CE('${entity}').rename('${esc(key)}')"><i data-lucide="pencil" style="width:13px;height:13px"></i> Rename</button>
      ${canType ? `<button onclick="CE('${entity}').openTypeModal('${esc(key)}')"><i data-lucide="shuffle" style="width:13px;height:13px"></i> Change type</button>` : ''}
      ${(col.type === 'select' || col.type === 'radio') ? `<button onclick="CE('${entity}').openOptsModal('${esc(key)}')"><i data-lucide="list" style="width:13px;height:13px"></i> Edit options</button>` : ''}
      <div class="lead-menu-sep"></div>
      <button onclick="CE('${entity}').move('${esc(key)}',-1)" ${vi <= 0 ? 'disabled' : ''}><i data-lucide="arrow-left" style="width:13px;height:13px"></i> Move left</button>
      <button onclick="CE('${entity}').move('${esc(key)}',1)" ${vi >= vis.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-right" style="width:13px;height:13px"></i> Move right</button>
      <div class="lead-menu-sep"></div>
      <button onclick="CE('${entity}').hide('${esc(key)}')"><i data-lucide="eye-off" style="width:13px;height:13px"></i> Hide column</button>
      <button class="danger" onclick="CE('${entity}').remove('${esc(key)}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i> Delete column</button>` : ''}`;
    ceMenuShow(e);
  };
  E._sort = (key, dir) => { ceMenuClose(); if (cfg.sort) cfg.sort.set(key, dir); };

  E.openPicker = function (e) {
    e.stopPropagation();
    const m = ceMenu();
    if (m.classList.contains('open') && m.dataset.mode === 'picker') return ceMenuClose();
    m.dataset.mode = 'picker';
    E._pickerHtml(m);
    ceMenuShow(e);
  };
  E.refreshPicker = function () {
    const m = CE_MENU;
    if (!m || !m.classList.contains('open')) return;
    E._pickerHtml(m);
    requestAnimationFrame(() => lucide.createIcons());
  };
  // The picker is also the field editor's doorway. Only the leads table has room
  // for a chevron on every header; the PO/RFQ sheets and the registers reach the
  // same editor through the pencil on each row here, so "Columns" is one click
  // from a field's type, its options and their colors everywhere.
  E._pickerHtml = function (m) {
    const edit = canEdit();
    // Styled in the stylesheets, not here: `.lead-menu button { width:100% }`
    // applies to this button too, and an inline style that forgot to override it
    // squeezed every label into a narrow column with a blank gap beside it.
    const pencil = c => !edit || (cfg.fixedKeys || []).includes(c.key) || c.type === 'virtual' ? '' : `
      <button type="button" class="lead-col-edit" title="Edit field — type, options, colors"
        onclick="event.stopPropagation();CE('${entity}').openFieldModal('${esc(c.key)}')">
        <i data-lucide="pencil" style="width:13px;height:13px"></i></button>`;
    m.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 10px 4px">Columns</div>` +
      E.cols.filter(c => !c.deleted).map(c => `
        <div class="lead-col-row">
          <button type="button" class="lead-col-eye ${c.visible ? '' : 'col-hidden'}" onclick="event.stopPropagation();CE('${entity}').setVis('${esc(c.key)}', ${c.visible ? 'false' : 'true'});CE('${entity}').refreshPicker()">
            <i data-lucide="${c.visible ? 'eye' : 'eye-off'}" style="width:14px;height:14px"></i> ${esc(c.label)}
          </button>${pencil(c)}
        </div>`).join('') +
      (edit ? `<div class="lead-menu-sep"></div>
        <button type="button" onclick="event.stopPropagation();closeLeadMenu();CE('${entity}').openAddModal()">
          <i data-lucide="plus" style="width:13px;height:13px"></i> Add field</button>` : '');
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  E.setVis = function (key, on) {
    const col = E.col(key); if (!col) return;
    col.visible = on === true || on === 'true';
    changed();
  };
  E.rename = function (key) {
    ceMenuClose();
    const col = E.col(key); if (!col) return;
    const v = prompt('Column name', col.label);
    if (v && v.trim()) { col.label = v.trim(); changed(); }
  };
  E.move = function (key, dir) {
    ceMenuClose();
    const vis = E.visible();
    const vi = vis.findIndex(c => c.key === key);
    const nb = vis[vi + dir]; if (!nb) return;
    const from = E.cols.findIndex(c => c.key === key);
    const to = E.cols.findIndex(c => c.key === nb.key);
    const [moved] = E.cols.splice(from, 1);
    E.cols.splice(to, 0, moved);
    changed();
  };
  E.reorder = function (srcKey, targetKey) {
    const from = E.cols.findIndex(c => c.key === srcKey);
    const to = E.cols.findIndex(c => c.key === targetKey);
    if (from < 0 || to < 0) return;
    const [moved] = E.cols.splice(from, 1);
    E.cols.splice(to, 0, moved);
    changed();
  };
  E.hide = function (key) {
    ceMenuClose();
    const col = E.col(key);
    if (col) { col.visible = false; changed(); }
  };
  E.remove = function (key) {
    ceMenuClose();
    const col = E.col(key); if (!col) return;
    if (!confirm(`Delete column "${col.label}"? Saved values stay on the records but won't be shown.`)) return;
    // Builtins are soft-deleted (deleted:true) so merge() won't re-add them.
    if (col.builtin) { col.deleted = true; col.visible = false; }
    else {
      const i = E.cols.findIndex(c => c.key === key);
      if (i >= 0) E.cols.splice(i, 1);
    }
    changed();
  };

  // ── Add-column modal ──────────────────────────────────────────────────────
  E.openAddModal = function () {
    if (!canEdit()) return;
    ceModalShow('Add Column', `
      <div class="form-group"><label class="form-label">Column name</label>
        <input class="form-control" id="ce-name" placeholder="e.g. Insurance status"></div>
      <div class="form-group"><label class="form-label">Type</label>
        ${ceTypeChips('text', 'ceToggleOptions')}</div>
      <div class="form-group" id="ce-options-wrap" style="display:none"><label class="form-label">Options — one per line</label>
        <textarea class="form-control" id="ce-options" rows="4" placeholder="Pending\nApproved\nRejected"></textarea></div>
      <div class="form-group" style="display:flex;gap:18px;align-items:center">
        <label style="display:inline-flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="ce-required" style="accent-color:var(--primary)"> Required in forms</label>
        <label style="display:inline-flex;align-items:center;gap:7px;font-size:13px">
          Width <input class="form-control" id="ce-width" type="number" min="40" max="800" placeholder="auto" style="width:90px"> px</label>
      </div>`,
      `<button class="btn btn-outline" onclick="CE('${entity}')._closeModal()">Cancel</button>
       <button class="btn btn-primary" onclick="CE('${entity}').saveNewCol()">Add column</button>`);
  };
  E.saveNewCol = function () {
    const label = document.getElementById('ce-name').value.trim();
    if (!label) return alert('Column name is required.');
    const type = document.getElementById('ce-type').value;
    let key = 'cf_' + ceSlug(label);
    const base = key; let n = 2;
    while (E.cols.some(c => c.key === key)) key = base + '_' + (n++);
    const col = { key, label, type, builtin: false, visible: true };
    if (ceHasOpts(type)) {
      const opts = ceParseOptLines(document.getElementById('ce-options').value);
      if (!opts.length) return alert('Add at least one option (one per line).');
      col.options = opts;
    }
    if (document.getElementById('ce-required').checked) col.required = true;
    const w = parseInt(document.getElementById('ce-width').value);
    if (w >= 40 && w <= 800) col.width = w;
    E.cols.push(col);
    E._closeModal();
    changed();
  };

  // ── Edit-field modal — everything about one column in one place ───────────
  // Type, required, width and the option list with their colors. The older
  // single-purpose modals below still exist (the leads header menu offers them
  // as shortcuts), but this is the one every table can reach.
  E.openFieldModal = function (key) {
    ceMenuClose();
    if (!canEdit()) return;
    const col = E.col(key); if (!col) return;
    E._fieldKey = key;
    const opts = ceHasOpts(col.type);
    ceModalShow('Edit Field — ' + col.label, `
      <div class="form-group"><label class="form-label">Field name</label>
        <input class="form-control" id="ce-name" value="${esc(col.label)}"></div>
      <div class="form-group"><label class="form-label">Type</label>
        ${ceTypeChips(col.type, 'ce' + entity.replace(/[^a-z0-9]/gi, '') + 'TypeChanged')}</div>
      <div id="ce-options-wrap" style="display:${opts ? '' : 'none'}">
        <label class="form-label">Options</label>
        <div id="ce-opts-list">${(col.options || []).map(o => E._optRow(o.key, o.label, o.color)).join('')}</div>
        <button class="btn btn-outline btn-sm" onclick="CE('${entity}').addOptRow()">+ Add option</button>
        <div style="font-size:11.5px;color:var(--muted);margin:8px 0 12px">The color paints the value's badge in tables and cards.</div>
      </div>
      <div class="form-group" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <label style="display:inline-flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="ce-required" ${col.required ? 'checked' : ''} style="accent-color:var(--primary)"> Required in forms</label>
        <label style="display:inline-flex;align-items:center;gap:7px;font-size:13px">
          Width <input class="form-control" id="ce-width" type="number" min="40" max="800" value="${col.width || ''}" placeholder="auto" style="width:90px"> px</label>
      </div>`,
      `<button class="btn btn-outline" onclick="CE('${entity}')._closeModal()">Cancel</button>
       <button class="btn btn-primary" onclick="CE('${entity}').saveField()">Save field</button>`);
  };
  // Switching to a dropdown with nothing to choose from is the commonest way to
  // end up with an empty select, so the first option is seeded here.
  window['ce' + entity.replace(/[^a-z0-9]/gi, '') + 'TypeChanged'] = t => E._fieldTypeChanged(t);
  E._fieldTypeChanged = function (type) {
    const wrap = document.getElementById('ce-options-wrap');
    if (!wrap) return;
    wrap.style.display = ceHasOpts(type) ? '' : 'none';
    if (ceHasOpts(type) && !document.querySelector('#ce-opts-list .lo-row')) E.addOptRow();
  };
  E.saveField = function () {
    const col = E.col(E._fieldKey); if (!col) return;
    const label = document.getElementById('ce-name').value.trim();
    if (!label) return alert('Field name is required.');
    const type = document.getElementById('ce-type').value;
    if (ceHasOpts(type)) {
      const opts = E._collectOptRows();
      if (!opts.length) return alert('Add at least one option.');
      col.options = opts;
    } else {
      delete col.options;
    }
    col.label = label;
    col.type = type;
    if (document.getElementById('ce-required').checked) col.required = true; else delete col.required;
    const w = parseInt(document.getElementById('ce-width').value);
    if (w >= 40 && w <= 800) col.width = w; else delete col.width;
    E._closeModal();
    changed();
  };

  // ── Change-type modal ─────────────────────────────────────────────────────
  E.openTypeModal = function (key) {
    ceMenuClose();
    const col = E.col(key); if (!col) return;
    E._typeKey = key;
    ceModalShow('Change Type — ' + col.label, `
      <div class="form-group"><label class="form-label">Type</label>
        ${ceTypeChips(ceHasOpts(col.type) ? col.type : (col.type === 'checkbox' ? 'checkbox' : 'text'), 'ceToggleOptions')}</div>
      <div class="form-group" id="ce-options-wrap"><label class="form-label">Options — one per line</label>
        <textarea class="form-control" id="ce-options" rows="4"></textarea></div>`,
      `<button class="btn btn-outline" onclick="CE('${entity}')._closeModal()">Cancel</button>
       <button class="btn btn-primary" onclick="CE('${entity}').saveType()">Save</button>`);
    document.getElementById('ce-options').value = (col.options || []).map(o => o.label).join('\n');
    document.getElementById('ce-options-wrap').style.display = ceHasOpts(document.getElementById('ce-type').value) ? '' : 'none';
  };
  E.saveType = function () {
    const col = E.col(E._typeKey); if (!col) return;
    const type = document.getElementById('ce-type').value;
    if (ceHasOpts(type)) {
      const opts = ceParseOptLines(document.getElementById('ce-options').value, col.options);
      if (!opts.length) return alert('Add at least one option (one per line).');
      col.options = opts;
    } else {
      delete col.options;
    }
    col.type = type;
    E._closeModal();
    changed();
  };

  // ── Options editor (labels + per-option color, ClickUp-style) ─────────────
  E.openOptsModal = function (key) {
    ceMenuClose();
    const col = E.col(key); if (!col) return;
    E._optsKey = key;
    ceModalShow('Edit Options — ' + col.label, `
      <div id="ce-opts-list">${(col.options || []).map(o => E._optRow(o.key, o.label, o.color)).join('')}</div>
      <button class="btn btn-outline btn-sm" onclick="CE('${entity}').addOptRow()">+ Add option</button>
      <div style="font-size:11.5px;color:var(--muted);margin-top:10px">The color paints the value's badge in tables and cards.</div>`,
      `<button class="btn btn-outline" onclick="CE('${entity}')._closeModal()">Cancel</button>
       <button class="btn btn-primary" onclick="CE('${entity}').saveOpts()">Save options</button>`);
  };
  E._optRow = function (key, label, color) {
    return `<div class="lo-row" data-optkey="${esc(key)}" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
      <input class="form-control" value="${esc(label)}" placeholder="Option label" style="flex:1">
      <input type="color" value="${esc(color || '#8a8f98')}" title="Badge color" style="width:34px;height:32px;padding:2px;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer">
      <button onclick="this.closest('.lo-row').remove()" title="Remove" style="background:rgba(239,68,68,.1);border:none;border-radius:6px;color:var(--danger);cursor:pointer;width:30px;height:30px;flex-shrink:0">✕</button>
    </div>`;
  };
  E.addOptRow = function () {
    document.getElementById('ce-opts-list').insertAdjacentHTML('beforeend', E._optRow('', '', ''));
    const rows = document.querySelectorAll('#ce-opts-list .lo-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('input').focus();
  };
  // Read the option rows out of whichever modal is open. Existing keys are kept
  // (the row carries them), so renaming an option does not orphan stored values.
  E._collectOptRows = function () {
    const opts = [];
    document.querySelectorAll('#ce-opts-list .lo-row').forEach(r => {
      const label = r.querySelector('input').value.trim();
      if (!label) return;
      let k = r.dataset.optkey;
      if (!k) { k = ceSlug(label); const b = k; let m = 2; while (opts.some(o => o.key === k)) k = b + '_' + (m++); }
      if (opts.some(o => o.key === k)) return;
      const color = r.querySelector('input[type=color]').value;
      const opt = { key: k, label };
      // The neutral placeholder means "no color chosen" — don't store it.
      if (color && color !== '#8a8f98') opt.color = color;
      opts.push(opt);
    });
    return opts;
  };
  E.saveOpts = function () {
    const col = E.col(E._optsKey); if (!col) return;
    const opts = E._collectOptRows();
    if (!opts.length) return alert('Keep at least one option.');
    col.options = opts;
    E._closeModal();
    changed();
  };
  E._closeModal = () => ceModalClose();

  // ── Form helpers (consumed by the entities that generate their forms) ─────
  E.inputHtml = function (col, value, attrs) {
    const a = attrs || '';
    const v = value == null ? '' : value;
    const req = col.required ? ' <span style="color:var(--danger)">*</span>' : '';
    const label = `<label class="form-label">${esc(col.label)}${req}</label>`;
    if (col.type === 'select' || col.type === 'radio') {
      return `<div class="form-group">${label}<select class="form-control" data-cek="${esc(col.key)}" ${a}>
        <option value="">—</option>
        ${(col.options || []).map(o => `<option value="${esc(o.key)}" ${String(v) === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select></div>`;
    }
    if (col.type === 'checkbox') {
      return `<div class="form-group"><label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" data-cek="${esc(col.key)}" ${v === true || v === 'true' || v === 1 || v === '1' ? 'checked' : ''} ${a}> ${esc(col.label)}${req}</label></div>`;
    }
    const type = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text';
    return `<div class="form-group">${label}<input class="form-control" type="${type}" data-cek="${esc(col.key)}" value="${esc(v)}" ${a}></div>`;
  };
  E.collect = function (container) {
    const out = {};
    (container || document).querySelectorAll('[data-cek]').forEach(el => {
      out[el.dataset.cek] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return out;
  };
  // Required is enforced in generated forms only — the server keeps accepting
  // records without custom fields, because imports, automations and the public
  // website form must not start failing the day a field is marked required.
  E.validateRequired = function (container) {
    const missing = [];
    E.cols.filter(c => c.required && !c.deleted && c.visible).forEach(c => {
      const el = (container || document).querySelector(`[data-cek="${c.key}"]`);
      if (!el) return;
      const v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (!v) missing.push(c.label);
    });
    return missing;
  };

  return E;
}


// Field types as chips rather than a <select>. A native popup is drawn by the
// browser, not by us, and inside a stacked modal some browsers paint it BEHIND
// the dialog — reported from the PO sheet, where choosing a type showed the
// options underneath the editor. Six options fit on two rows; nothing pops up,
// so nothing can be layered wrongly. The hidden input keeps `#ce-type` as the
// one place the modals read the answer from.
const CE_TYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'],
                  ['select', 'Dropdown'], ['radio', 'Radio'], ['checkbox', 'Checkbox']];
function ceTypeChips(current, onChange) {
  const cur = CE_TYPES.some(([v]) => v === current) ? current : 'text';
  return `<input type="hidden" id="ce-type" value="${cur}">
    <div class="ce-types">${CE_TYPES.map(([v, l]) => `
      <button type="button" class="ce-type${v === cur ? ' on' : ''}" data-ce-type="${v}"
        onclick="ceTypePick(this, ${onChange ? `'${onChange}'` : 'null'})">${l}</button>`).join('')}</div>`;
}
function ceTypePick(btn, onChange) {
  const wrap = btn.closest('.ce-types');
  wrap.querySelectorAll('.ce-type').forEach(b => b.classList.toggle('on', b === btn));
  const hidden = document.getElementById('ce-type');
  if (hidden) hidden.value = btn.dataset.ceType;
  if (onChange && typeof window[onChange] === 'function') window[onChange](btn.dataset.ceType);
}
// The shared "does this type need options" toggle, named so a chip can call it.
function ceToggleOptions(type) {
  const wrap = document.getElementById('ce-options-wrap');
  if (wrap) wrap.style.display = ceHasOpts(type) ? '' : 'none';
}

// ── Shared plumbing ───────────────────────────────────────────────────────────
function ceHasOpts(t) { return t === 'select' || t === 'radio'; }
function ceSlug(label) { return String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col'; }
// Parse an options textarea into [{key,label}], reusing existing keys (and their
// colors) when a label matches, so renames don't orphan stored values.
function ceParseOptLines(text, existing) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const prev = existing || [];
  const opts = [];
  lines.forEach(l => {
    const match = prev.find(o => o.label === l);
    let k = match ? match.key : ceSlug(l);
    const b = k; let m = 2;
    while (opts.some(o => o.key === k)) k = b + '_' + (m++);
    const opt = { key: k, label: l };
    if (match && match.color) opt.color = match.color;
    opts.push(opt);
  });
  return opts;
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── The editor's own modal layer ──────────────────────────────────────────────
// Both portals have exactly ONE modal element and showModal() overwrites it. The
// field editor opens from inside the RFQ and PO sheets, so routing it through
// the host's modal REPLACED the sheet: you clicked "+ Field" and the document
// you were half-way through typing was gone, and saving the field closed
// everything. This layer stacks above whatever is open and closes back to it.
let CE_MODAL = null;
function ceModalEl() {
  if (!CE_MODAL) {
    CE_MODAL = document.createElement('div');
    CE_MODAL.className = 'ce-modal-overlay';
    CE_MODAL.innerHTML = `<div class="ce-modal-box" role="dialog" aria-modal="true">
      <div class="ce-modal-head"><span id="ce-modal-title"></span>
        <button type="button" class="ce-modal-x" aria-label="Close">&times;</button></div>
      <div class="ce-modal-body" id="ce-modal-body"></div>
      <div class="ce-modal-foot" id="ce-modal-foot"></div>
    </div>`;
    document.body.appendChild(CE_MODAL);
    CE_MODAL.addEventListener('click', e => { if (e.target === CE_MODAL) ceModalClose(); });
    CE_MODAL.querySelector('.ce-modal-x').addEventListener('click', ceModalClose);
    // Escape closes this layer only — the sheet underneath stays open.
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && CE_MODAL.classList.contains('open')) { e.stopPropagation(); ceModalClose(); }
    }, true);
  }
  return CE_MODAL;
}
function ceModalShow(title, body, footer) {
  const m = ceModalEl();
  m.querySelector('#ce-modal-title').textContent = title;
  m.querySelector('#ce-modal-body').innerHTML = body;
  m.querySelector('#ce-modal-foot').innerHTML = footer;
  m.classList.add('open');
  const first = m.querySelector('#ce-modal-body input, #ce-modal-body select');
  if (first) requestAnimationFrame(() => first.focus());
}
function ceModalClose() { if (CE_MODAL) { CE_MODAL.classList.remove('open'); CE_MODAL.querySelector('#ce-modal-body').innerHTML = ''; } }

// One floating menu element for every engine instance on the page.
let CE_MENU = null;
function ceMenu() {
  if (!CE_MENU) {
    CE_MENU = document.createElement('div');
    CE_MENU.className = 'lead-menu';
    document.body.appendChild(CE_MENU);
    document.addEventListener('click', e => {
      if (CE_MENU.classList.contains('open') && !CE_MENU.contains(e.target)
          && !(e.target.closest && (e.target.closest('th.lead-col') || e.target.closest('#lead-cols-btn')))) ceMenuClose();
    });
  }
  return CE_MENU;
}
function ceMenuClose() { if (CE_MENU) CE_MENU.classList.remove('open'); }
function ceMenuShow(e) {
  const m = CE_MENU;
  m.style.left = Math.min(e.clientX, window.innerWidth - 230) + 'px';
  m.style.top  = Math.min(e.clientY + 6, window.innerHeight - 60) + 'px';
  m.classList.add('open');
  requestAnimationFrame(() => lucide.createIcons());
}

// ── The leads builtins, once ──────────────────────────────────────────────────
// Both portals seed their leads engine from this. The status colors used to be a
// pair of hardcoded maps duplicated per bundle; they are option colors now, and
// every select column gets the same treatment through the options editor.
const LEADS_BUILTIN_COLS = [
  { key:'lead_date',       label:'Date',        type:'date',     builtin:true, visible:true },
  { key:'lead_time',       label:'Time',        type:'text',     builtin:true, visible:true },
  { key:'name',            label:'Name',        type:'text',     builtin:true, visible:true },
  { key:'phone',           label:'Phone',       type:'text',     builtin:true, visible:true },
  { key:'lead_status',     label:'Status',      type:'select',   builtin:true, visible:true, options:[
    { key:'cold', label:'Cold', color:'#b9b3a4' }, { key:'warm', label:'Warm', color:'#e69650' },
    { key:'hot', label:'Hot', color:'#f87171' },
    { key:'immediate_delivery', label:'Immediate Delivery', color:'#6dd8a4' },
    { key:'not_interested', label:'Not Interested', color:'#888888' },
    { key:'blacklist', label:'Blacklist', color:'#dc2626' }] },
  { key:'source',          label:'Origin',      type:'select',   builtin:true, visible:true, options:[
    { key:'fb_ad', label:'FB Ad.' }, { key:'whatsapp', label:'Whatsapp' }, { key:'messenger', label:'Messenger' },
    { key:'direct_call', label:'Direct Call' }, { key:'ig_ads', label:'IG ads' },
    { key:'website', label:'Website' }, { key:'walk_in', label:'Walk-in' }, { key:'marketplace', label:'Marketplace' }] },
  { key:'car_in_question', label:'Car',         type:'text',     builtin:true, visible:true },
  { key:'budget_lead',     label:'Budget',      type:'number',   builtin:true, visible:true },
  { key:'next_action',     label:'Next Action', type:'select',   builtin:true, visible:true, options:[
    { key:'followed_by_sales', label:'Followed By Sales' }, { key:'need_follow_up', label:'Need Follow Up' },
    { key:'closed', label:'Closed' }, { key:'no_answer', label:'No Answer' }] },
  { key:'been_contacted',  label:'Contacted',   type:'checkbox', builtin:true, visible:true },
  { key:'notes',           label:'Notes',       type:'text',     builtin:true, visible:true },
  { key:'sales_feedback',  label:'Sales Feedback', type:'text',  builtin:true, visible:true },
  { key:'inquiry',         label:'Inquiry',     type:'text',     builtin:true, visible:true },
  { key:'next_followup',   label:'Follow-up',   type:'virtual',  builtin:true, visible:true },
  { key:'owner',           label:'Owner',       type:'virtual',  builtin:true, visible:true },
];

// ── Back-compat global names ──────────────────────────────────────────────────
// The header markup both portals render still says onclick="openLeadColMenu(…)"
// etc. These delegate to the leads instance, so ~40 call sites did not have to
// change while the engine moved underneath them.
let _dragColKey = null;
let _leadColDidDrag = false;   // swallow the click that can trail a header drag — both bundles read this in leadHeaderClick
function leadColDragStart(e) { _dragColKey = e.currentTarget.dataset.colkey; _leadColDidDrag = true; e.dataTransfer.effectAllowed = 'move'; }
function leadColDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function leadColDragEnd() { document.querySelectorAll('th.drag-over').forEach(t => t.classList.remove('drag-over')); _dragColKey = null; setTimeout(() => { _leadColDidDrag = false; }, 0); }
function leadColDrop(e) {
  e.preventDefault();
  const target = e.currentTarget.dataset.colkey;
  const src = _dragColKey;
  leadColDragEnd();
  if (!src || src === target) return;
  CE('leads').reorder(src, target);
}
function openLeadColMenu(e, key) { CE('leads').openMenu(e, key); }
function openLeadColsPicker(e) { CE('leads').openPicker(e); }
function openLeadColsPickerRefresh() { CE('leads').refreshPicker(); }
function toggleLeadColVis(key, on) { CE('leads').setVis(key, on); }
function openAddLeadColModal() { CE('leads').openAddModal(); }
function closeLeadMenu() { ceMenuClose(); }
function typeHasOptions(t) { return ceHasOpts(t); }
function parseOptLines(text, existing) { return ceParseOptLines(text, existing); }
function slugKey(label) { return ceSlug(label); }
