// Leads: the status band, the Board and the Follow-ups list — shared by the
// admin dashboard and the team portal.
//
// The table answers "what do I have". It could not answer "where is the money
// sitting" or "who am I supposed to ring today" without reading every row, so
// those are views of the same filtered list. They were built for the admin
// portal first; rather than copy ~200 lines into the team bundle they moved
// here, with the handful of genuinely portal-specific things behind LVCFG:
// who the owners are, how that portal opens a lead and creates one, whether
// the person may create one at all, and how to repaint the table.
//
// Everything else — leadCol, colOptMap, normKey, CE, esc, _leadCols,
// _pendingFollowups, _lastRenderedLeads — is already defined identically in
// both bundles, so it is called directly. Both portals also use the SAME
// element ids for the panes (leads-mix, lead-views, leads-pane-board,
// leads-pane-follow, leads-scroll, leads-toolbar), which is why none of them
// is configurable.

let LVCFG = null;                 // set by each portal via lvInit()
let _leadView = 'table';
let _fuFilterOn = false;

function lvInit(cfg) { LVCFG = cfg; }

function setLeadView(v) {
  _leadView = v;
  document.querySelectorAll('#lead-views .task-view-tab')
    .forEach(b => b.classList.toggle('active', b.dataset.lview === v));
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('leads-scroll', v === 'table');
  show('leads-pane-board', v === 'board');
  show('leads-pane-follow', v === 'follow');
  // Columns and rows-per-page describe the table specifically; leaving them
  // over a board would offer settings that change nothing on screen.
  show('leads-toolbar', v === 'table');
  if (_lastRenderedLeads) LVCFG.render(_lastRenderedLeads);
}

// Called first thing by each portal's table renderer. True means a non-table
// view has already painted this list and the table code should stand down.
function lvRoute(list) {
  renderLeadMix(list);
  if (_leadView === 'board')  { renderLeadBoard(list);  return true; }
  if (_leadView === 'follow') { renderLeadFollow(list); return true; }
  return false;
}

function lvStatusCol() {
  return (typeof leadCol === 'function' ? leadCol('lead_status') : null)
    || (_leadCols || []).find(c => c.key === 'lead_status');
}

// ── The status band ───────────────────────────────────────────────────────────
// The lead statuses already carry their own colours in columns.js; this shows
// the shape of the filtered set before any row is read.
function renderLeadMix(list) {
  const el = document.getElementById('leads-mix');
  if (!el) return;
  const col = lvStatusCol();
  const opts = (col && col.options) || [];
  if (!opts.length || !list.length) { el.style.display = 'none'; return; }
  const counts = new Map();
  list.forEach(c => {
    const k = String(c.lead_status || '').trim();
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  });
  const rows = opts
    .map(o => ({ label: o.label || o.key, n: counts.get(o.key) || 0, c: o.color || 'var(--muted)' }))
    .filter(r => r.n > 0);
  if (!rows.length) { el.style.display = 'none'; return; }
  const total = rows.reduce((a, r) => a + r.n, 0) || 1;
  el.style.display = '';
  el.innerHTML = `
    <div class="mix-total">
      <span class="stat-value">${total.toLocaleString()}</span>
      <span class="mix-unit">lead${total === 1 ? '' : 's'}</span>
    </div>
    <div class="mix-body">
      <div class="mix-bar">${rows.map(r =>
        `<span title="${esc(r.label)}: ${r.n}" style="flex:${r.n};background:${r.c}"></span>`).join('')}</div>
      <div class="mix-legend">${rows.map(r =>
        `<span class="mix-key"><i style="background:${r.c}"></i>${esc(r.label)}<b class="num">${r.n}</b></span>`).join('')}</div>
    </div>`;
}

// ── Board ─────────────────────────────────────────────────────────────────────
function leadOwnerName(c) {
  if (!c.assigned_to) return '';
  const e = (LVCFG.owners() || []).find(x => String(x.id) === String(c.assigned_to));
  return e ? e.name : '#' + c.assigned_to;
}

function leadInitials(n) {
  return String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}

// Money on a board card is a scale read, not an accounting figure: 4.2M
// beats 4,200,000 when six of them sit side by side in a 250px column.
function leadShortMoney(n) {
  const v = Number(n) || 0;
  if (!v) return '—';
  if (v >= 1e9) return 'EGP ' + (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (v >= 1e6) return 'EGP ' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return 'EGP ' + Math.round(v / 1e3) + 'K';
  return 'EGP ' + v.toLocaleString();
}

function renderLeadBoard(list) {
  const host = document.getElementById('leads-pane-board');
  if (!host) return;
  // Columns come from the column engine, not a hardcoded list, so a status
  // added in Columns appears here without touching this function.
  const col = lvStatusCol();
  const opts = (col && col.options) || [];
  if (!opts.length) { host.innerHTML = '<div class="fu-none">No lead statuses configured.</div>'; return; }
  const m = colOptMap(col);
  const total = list.length || 1;
  const srcMap = {};
  ((_leadCols || []).find(c => c.key === 'source')?.options || []).forEach(o => { srcMap[o.key] = o.label; });
  const mayAdd = !LVCFG.canAdd || LVCFG.canAdd();

  host.innerHTML = `<div class="lead-board">${opts.map(o => {
    const rows = list.filter(c => normKey(c.lead_status || 'cold', m) === o.key);
    const value = rows.reduce((a, c) => a + (Number(c.budget_lead) || 0), 0);
    const pct = Math.round((rows.length / total) * 100);
    const c0 = o.color || 'var(--muted)';
    return `<section class="lb-col" style="--c:${c0}">
      <div class="lb-head">
        <div class="lb-head-top">
          ${CE('leads').badgeHtml(col, o.key, o.label || o.key)}
          <span class="lb-n num">${rows.length}</span>
        </div>
        <div><span class="lb-val num">${leadShortMoney(value)}</span><span class="lb-share num">${pct}% of leads</span></div>
      </div>
      <div class="lb-body">
        ${rows.map(c => {
          const owner = leadOwnerName(c);
          return `<article class="lb-card" onclick="${LVCFG.openFn}(${c.id})">
            <div class="lb-name">${esc(c.name || '—')}</div>
            ${c.car_in_question ? `<div class="lb-meta"><i data-lucide="car"></i><span>${esc(c.car_in_question)}</span></div>` : ''}
            ${c.source ? `<div class="lb-meta"><i data-lucide="tag"></i><span>${esc(srcMap[c.source] || c.source)}</span></div>` : ''}
            <div class="lb-budget num">${leadShortMoney(c.budget_lead)}</div>
            ${owner ? `<div class="lb-foot"><span class="td-av">${esc(leadInitials(owner))}</span>${esc(owner)}</div>` : ''}
          </article>`;
        }).join('')}
        ${mayAdd ? `<button class="lb-add" onclick="${LVCFG.addFn}(null, '${esc(o.key)}')">
          <i data-lucide="plus"></i> Add</button>` : ''}
      </div>
    </section>`;
  }).join('')}</div>`;
  requestAnimationFrame(() => lucide.createIcons());
}

// ── Follow-ups ────────────────────────────────────────────────────────────────
// Buckets are relative to now, so "this week" means the next seven days
// rather than "before Sunday" — a Friday lead should not fall out of the
// list because the calendar week happens to end.
function fuBucket(due) {
  const t = new Date(due).getTime();
  if (Number.isNaN(t)) return null;
  const now = Date.now();
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  if (t < now) return 'overdue';
  if (t <= endOfDay.getTime()) return 'today';
  if (t <= now + 7 * 86400000) return 'week';
  return 'later';
}

function fuWhen(due) {
  const t = new Date(due).getTime();
  const now = Date.now();
  const day = 86400000;
  const days = Math.round((t - now) / day);
  if (t < now) {
    const late = Math.max(1, Math.round((now - t) / day));
    return late === 1 ? '1 day late' : late + ' days late';
  }
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  if (t <= endOfDay.getTime()) return 'Today';
  if (days <= 1) return 'Tomorrow';
  return 'In ' + days + ' days';
}

function renderLeadFollow(list) {
  const host = document.getElementById('leads-pane-follow');
  if (!host) return;
  const col = lvStatusCol();
  const m = colOptMap(col);
  const due = list
    .map(c => ({ c, at: _pendingFollowups[c.id] }))
    .filter(x => x.at)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const GROUPS = [
    { key: 'overdue', label: 'Overdue',   c: 'var(--danger)' },
    { key: 'today',   label: 'Due today', c: 'var(--warning)' },
    { key: 'week',    label: 'This week', c: 'var(--success)' },
    { key: 'later',   label: 'Later',     c: 'var(--muted)' },
  ];
  const body = GROUPS.map(g => {
    const rows = due.filter(x => fuBucket(x.at) === g.key);
    if (!rows.length) return '';
    return `<section class="fu-group" style="--c:${g.c}">
      <div class="fu-group-head"><i class="dot"></i>${g.label}<span class="fu-group-n num">${rows.length}</span></div>
      ${rows.map(({ c, at }) => {
        const parts = [c.car_in_question, c.phone].filter(Boolean).map(esc).join(' · ');
        return `<div class="fu-row">
          <span class="td-av">${esc(leadInitials(c.name))}</span>
          <div class="fu-main" onclick="${LVCFG.openFn}(${c.id})">
            <div class="fu-name">${esc(c.name || '—')}</div>
            ${parts ? `<div class="fu-sub">${parts}</div>` : ''}
          </div>
          ${col ? CE('leads').badgeHtml(col, normKey(c.lead_status || 'cold', m), m[normKey(c.lead_status || 'cold', m)] || c.lead_status || '—') : ''}
          <span class="fu-when num" title="${esc(new Date(at).toLocaleString())}">${fuWhen(at)}</span>
          ${c.phone ? `<a class="fu-call" href="tel:${esc(c.phone)}" onclick="event.stopPropagation()">
            <i data-lucide="phone"></i> Call</a>` : ''}
        </div>`;
      }).join('')}
    </section>`;
  }).join('');

  host.innerHTML = body || '<div class="fu-none">Nothing scheduled. Follow-ups you set on a lead show up here.</div>';
  requestAnimationFrame(() => lucide.createIcons());
}

// ── The "due today" chip on the toolbar ───────────────────────────────────────
function renderFuChip() {
  const chip = document.getElementById('fu-chip');
  if (!chip) return;
  const now = new Date();
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  let dueToday = 0, overdue = 0;
  Object.values(_pendingFollowups).forEach(d => {
    const t = new Date(d);
    if (t < now) overdue++;
    else if (t <= endOfDay) dueToday++;
  });
  if (!dueToday && !overdue) { chip.style.display = 'none'; if (_fuFilterOn) { _fuFilterOn = false; } return; }
  chip.style.display = '';
  chip.innerHTML = `<i data-lucide="clock" style="width:12px;height:12px"></i> ${overdue ? `<span style="color:var(--danger);font-weight:700">${overdue} overdue</span>` : ''}${overdue && dueToday ? ' · ' : ''}${dueToday ? `${dueToday} due today` : ''}`;
  chip.style.borderColor = _fuFilterOn ? 'var(--primary)' : '';
  chip.style.color = _fuFilterOn ? 'var(--primary)' : '';
}

function toggleFuFilter() {
  _fuFilterOn = !_fuFilterOn;
  renderFuChip();
  LVCFG.apply();
}

// Applied by each portal inside its own filter function, after the text,
// date and column filters have run.
function fuFilterApply(list) {
  if (!_fuFilterOn) return list;
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  return list.filter(c => _pendingFollowups[c.id] && new Date(_pendingFollowups[c.id]) <= endOfDay);
}
