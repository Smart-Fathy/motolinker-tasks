// Lead filters — shared by the admin dashboard and the team portal.
//
// Filters work on ANY column, built-in or custom cf_*, with options read from the
// saved column config so renamed options keep matching. Each filter is
// { key, op, a, b }; the operator set depends on the column's type.
//
// This lived only in the admin bundle. Rather than copy it into the team portal it
// moved here, with the handful of genuinely portal-specific things behind LFCFG:
// which array holds the rows, how to re-render, where the chips go, which storage key
// to use, who the owners are, and how that portal opens a modal. Everything else —
// leadCol, colOptMap, normKey, isChecked, esc — is already defined identically in both
// bundles, so it is called directly.

let LFCFG = null;                 // set by each portal via lfInit()
let _leadFilters = [];

function lfInit(cfg) {
  LFCFG = cfg;
  try { _leadFilters = JSON.parse(localStorage.getItem(cfg.storageKey) || '[]') || []; }
  catch (_) { _leadFilters = []; }
}

function leadFilterableCols() {
  return (_leadCols || LEAD_DEFAULT_COLS).filter(c => c && !c.deleted && c.key !== 'select');
}
function leadColType(col) {
  if (!col) return 'text';
  if (col.key === 'lead_date' || col.type === 'date') return 'date';
  if (col.key === 'budget_lead' || col.type === 'number') return 'number';
  if (col.type === 'checkbox') return 'checkbox';
  if (col.type === 'select' || col.type === 'radio') return 'select';
  if (col.key === 'owner') return 'owner';
  return 'text';
}
function leadFilterOps(type) {
  if (type === 'select' || type === 'owner') return [['is', 'is'], ['is_not', 'is not'], ['empty', 'is empty']];
  if (type === 'checkbox') return [['yes', 'is yes'], ['no', 'is no']];
  if (type === 'number' || type === 'date') return [['between', 'between'], ['empty', 'is empty']];
  return [['contains', 'contains'], ['not_contains', "doesn't contain"], ['empty', 'is empty']];
}

// The comparable value for a lead in a given column.
function leadFilterValue(c, col) {
  const key = col.key;
  if (key === 'owner') {
    if (!c.assigned_to) return '';
    const e = (LFCFG.owners() || []).find(x => String(x.id) === String(c.assigned_to));
    return e ? e.name : ('#' + c.assigned_to);
  }
  return col.builtin ? c[key] : (c.custom_fields || {})[key];
}

function leadFilterMatch(c, f) {
  const col = leadCol(f.key);
  if (!col) return true;                       // column removed since the filter was saved
  const type = leadColType(col);
  const raw = leadFilterValue(c, col);
  const isEmpty = raw == null || raw === '';
  if (f.op === 'empty') return isEmpty;
  if (type === 'checkbox') return isChecked(raw) === (f.op === 'yes');
  if (type === 'select') {
    if (isEmpty) return false;
    const k = normKey(raw, colOptMap(col));
    return f.op === 'is_not' ? k !== f.a : k === f.a;
  }
  if (type === 'owner') {
    const v = String(raw || '').toLowerCase();
    return f.op === 'is_not' ? v !== String(f.a || '').toLowerCase() : v === String(f.a || '').toLowerCase();
  }
  if (type === 'number') {
    const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''));
    if (!isFinite(n) || isEmpty) return false;
    if (f.a !== '' && f.a != null && n < Number(f.a)) return false;
    if (f.b !== '' && f.b != null && n > Number(f.b)) return false;
    return true;
  }
  if (type === 'date') {
    const d = String(raw || '').slice(0, 10);   // ISO strings compare correctly
    if (!d) return false;
    if (f.a && d < f.a) return false;
    if (f.b && d > f.b) return false;
    return true;
  }
  const v = String(raw ?? '').toLowerCase();
  const needle = String(f.a || '').toLowerCase();
  return f.op === 'not_contains' ? !v.includes(needle) : v.includes(needle);
}

// Each portal's own filter function runs its search box and date range, then hands the
// remaining list through here.
function lfApply(list) {
  let out = list;
  for (const f of _leadFilters) out = out.filter(c => leadFilterMatch(c, f));
  renderLeadFilterChips();
  return out;
}

function leadFilterLabel(f) {
  const col = leadCol(f.key);
  const name = col ? (col.label || col.key) : f.key;
  const opLabel = (leadFilterOps(leadColType(col)).find(o => o[0] === f.op) || [, f.op])[1];
  let val = '';
  if (f.op === 'between') val = `${f.a || '…'} – ${f.b || '…'}`;
  else if (f.op !== 'empty' && f.op !== 'yes' && f.op !== 'no') {
    val = (leadColType(col) === 'select' ? (colOptMap(col)[f.a] || f.a) : f.a) || '';
  }
  return `${name} ${opLabel}${val ? ' ' + val : ''}`;
}

function renderLeadFilterChips() {
  const box = document.getElementById(LFCFG.chipsId);
  if (!box) return;
  box.style.display = _leadFilters.length ? 'flex' : 'none';
  box.innerHTML = _leadFilters.map((f, i) => `
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 10px;border:1px solid var(--hair-gold,var(--border));border-radius:14px;background:rgba(201,163,94,.08)">
      ${esc(leadFilterLabel(f))}
      <button onclick="removeLeadFilter(${i})" title="Remove" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;padding:0">×</button>
    </span>`).join('');
}

function saveLeadFilters() {
  try { localStorage.setItem(LFCFG.storageKey, JSON.stringify(_leadFilters)); } catch (_) {}
}
function removeLeadFilter(i) { _leadFilters.splice(i, 1); saveLeadFilters(); LFCFG.apply(); }

function clearLeadFilters() {
  (LFCFG.inputIds || []).forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  _leadFilters = []; saveLeadFilters();
  LFCFG.apply();
}

// ── The picker ────────────────────────────────────────────────────────────────
// Column → condition → value, each stage rebuilt from the one above it.
function lfPickerBody() {
  const cols = leadFilterableCols();
  return `<div style="display:grid;gap:12px">
      <div><label class="form-label">Column</label>
        <select id="lf-col" class="${LFCFG.inputClass}" onchange="lfRenderOps()">
          ${cols.map(c => `<option value="${esc(c.key)}">${esc(c.label || c.key)}</option>`).join('')}
        </select></div>
      <div id="lf-op-wrap"></div>
      <div id="lf-val-wrap"></div>
    </div>`;
}
function openLeadFilterPicker() {
  LFCFG.showPicker(lfPickerBody());
  lfRenderOps();
}
function lfRenderOps() {
  const col = leadCol(document.getElementById('lf-col').value);
  const type = leadColType(col);
  document.getElementById('lf-op-wrap').innerHTML = `<label class="form-label">Condition</label>
    <select id="lf-op" class="${LFCFG.inputClass}" onchange="lfRenderVal()">
      ${leadFilterOps(type).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
    </select>`;
  lfRenderVal();
}
function lfRenderVal() {
  const col = leadCol(document.getElementById('lf-col').value);
  const type = leadColType(col);
  const op = document.getElementById('lf-op').value;
  const wrap = document.getElementById('lf-val-wrap');
  const cls = LFCFG.inputClass;
  if (op === 'empty' || op === 'yes' || op === 'no') { wrap.innerHTML = ''; return; }
  if (type === 'select') {
    wrap.innerHTML = `<label class="form-label">Value</label>
      <select id="lf-a" class="${cls}">${(col.options || []).map(o => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('')}</select>`;
    return;
  }
  if (type === 'owner') {
    const names = [...new Set((LFCFG.owners() || []).map(e => e.name).filter(Boolean))];
    wrap.innerHTML = `<label class="form-label">Owner</label>
      <select id="lf-a" class="${cls}">${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>`;
    return;
  }
  if (op === 'between') {
    const t = type === 'date' ? 'date' : 'number';
    wrap.innerHTML = `<label class="form-label">Range</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input id="lf-a" class="${cls}" type="${t}" placeholder="From">
        <input id="lf-b" class="${cls}" type="${t}" placeholder="To">
      </div>`;
    return;
  }
  wrap.innerHTML = `<label class="form-label">Value</label><input id="lf-a" class="${cls}" placeholder="Text to match">`;
}
function addLeadFilter() {
  const key = document.getElementById('lf-col').value;
  const op = document.getElementById('lf-op').value;
  const a = document.getElementById('lf-a') ? document.getElementById('lf-a').value : '';
  const b = document.getElementById('lf-b') ? document.getElementById('lf-b').value : '';
  if (op !== 'empty' && op !== 'yes' && op !== 'no' && a === '' && b === '') {
    LFCFG.warn('Enter a value to filter on.');
    return;
  }
  _leadFilters.push({ key, op, a, b });
  saveLeadFilters();
  LFCFG.hidePicker();
  LFCFG.apply();
}
