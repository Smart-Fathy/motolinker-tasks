// Home dashboard — shared by the admin dashboard and the team portal.
//
// Extracted from the two portal bundles, where it lived as a verbatim copy in each.
// Everything portal specific is in HOMECFG, which each portal defines before loading
// this file; nothing here may reference an admin-only or employee-only global.

/* ── Home dashboard ───────────────────────────────────────────────────────────
   Portal-specific bits live in HOMECFG, defined just above this block.
   Layout is a 12-column grid: each widget carries a width (3/4/6/12) and a height
   (1/2), which collapses to one column on a phone. Free-form x/y was deliberately
   avoided — hand-rolled collision and packing is where this kind of UI goes wrong. */

const HOME_SIZES = [
  { w: 3, label: 'Quarter' }, { w: 4, label: 'Third' },
  { w: 6, label: 'Half' }, { w: 12, label: 'Full' },
];

// Every section of the app has at least one widget. `perm` mirrors the gate the
// server applies in src/routes/home.js — the server is the authority and sends the
// resolved list as `allowed`; this copy is only the fallback for a summary that has
// not arrived yet, so the Add list is never wrong in the permissive direction.
// `async` widgets fetch their own data after the grid renders.
const HOME_WIDGETS = {
  // Tasks
  my_tasks:           { title: 'My tasks',            icon: 'clipboard-list',  w: 4, h: 2, perm: 'tasks' },
  task_status:        { title: 'Tasks by status',     icon: 'pie-chart',       w: 4, h: 1, perm: 'tasks' },
  overdue_tasks:      { title: 'Overdue tasks',       icon: 'alarm-clock',     w: 3, h: 1, perm: 'tasks' },
  // Leads and deals
  leads_status:       { title: 'Leads by status',     icon: 'users',           w: 4, h: 2, perm: 'leads' },
  recent_leads:       { title: 'Recent leads',        icon: 'user-plus',       w: 4, h: 2, perm: 'leads' },
  followups:          { title: 'Follow-ups due',      icon: 'calendar-clock',  w: 4, h: 2, perm: 'leads' },
  pipeline:           { title: 'Pipeline by stage',   icon: 'trending-up',     w: 6, h: 2, perm: 'deals' },
  won_month:          { title: 'Won this month',      icon: 'trophy',          w: 3, h: 1, perm: 'deals' },
  // Hours and inventory
  hours_week:         { title: 'Hours this week',     icon: 'timer',           w: 3, h: 1, perm: 'hours' },
  stock_summary:      { title: 'Stock',               icon: 'car-front',       w: 3, h: 1, perm: 'stock' },
  stock_models:       { title: 'Stock by model',      icon: 'layers',          w: 4, h: 2, perm: 'stock' },
  // Requests and approvals
  my_requests:        { title: 'My requests',         icon: 'inbox',           w: 3, h: 1, perm: 'requests' },
  approvals:          { title: 'Pending approvals',   icon: 'shield-check',    w: 4, h: 2, perm: 'admin' },
  // Paperwork
  quotation_recent:   { title: 'Recent quotations',   icon: 'file-text',       w: 4, h: 2, perm: 'quotation' },
  contracts_recent:   { title: 'Recent contracts',    icon: 'file-signature',  w: 4, h: 2, perm: 'admin' },
  sales_month:        { title: 'Sales this month',    icon: 'banknote',        w: 3, h: 1, perm: 'reports' },
  // Purchasing
  suppliers_top:      { title: 'Top suppliers',       icon: 'factory',         w: 4, h: 2, perm: 'admin' },
  rfq_open:           { title: 'Open RFQs',           icon: 'send',            w: 4, h: 2, perm: 'admin' },
  po_status:          { title: 'Purchase orders',     icon: 'shopping-cart',   w: 4, h: 1, perm: 'admin' },
  // Company
  submissions_recent: { title: 'Recent submissions',  icon: 'clipboard-check', w: 4, h: 2, perm: 'admin' },
  automations_active: { title: 'Automations',         icon: 'workflow',        w: 3, h: 1, perm: 'admin' },
  team_roster:        { title: 'Team',                icon: 'users-round',     w: 4, h: 2, perm: 'admin' },
  whatsapp_recent:    { title: 'WhatsApp',            icon: 'message-circle',  w: 4, h: 2, perm: 'admin' },
  issues_open:        { title: 'Open issues',         icon: 'bug',             w: 4, h: 2, perm: 'issues' },
  // Built here rather than by the server
  quick_actions:      { title: 'Quick actions',       icon: 'zap',             w: 4, h: 1, perm: null },
  unread_chat:        { title: 'Unread chat',         icon: 'message-square',  w: 3, h: 1, perm: 'chat' },
  notifications:      { title: 'Notifications',       icon: 'bell',            w: 4, h: 2, perm: null },
  calendar:           { title: 'Calendar',            icon: 'calendar-days',   w: 4, h: 2, perm: 'calendar', async: 'calendar' },
  meet_quick:         { title: 'Meet',                icon: 'video',           w: 3, h: 1, perm: 'meet' },
  drive_recent:       { title: 'Recent Drive files',  icon: 'hard-drive',      w: 4, h: 2, perm: 'drive',   async: 'drive' },
  sheets_recent:      { title: 'Recent Sheets',       icon: 'table',           w: 4, h: 2, perm: 'sheets',  async: 'sheets' },
  email_unread:       { title: 'Unread email',        icon: 'mail',            w: 4, h: 2, perm: 'email',   async: 'email' },
};

const HOME_DEFAULT = [
  { id: 'my_tasks', w: 4, h: 2 }, { id: 'task_status', w: 4, h: 1 },
  { id: 'overdue_tasks', w: 4, h: 1 }, { id: 'pipeline', w: 6, h: 2 },
  { id: 'recent_leads', w: 6, h: 2 }, { id: 'quick_actions', w: 12, h: 1 },
];

let _home = { widgets: [], data: null, editing: false, req: 0, allowed: null, async: {} };

// The catalogue is filtered by what the caller can actually open, so nobody can add
// a widget for a section that would then come back empty or 403.
//
// The server decides and sends the resolved list as `allowed`; that is the authority,
// because it is the same list the summary and the layout writer enforce. HOMECFG.can
// is only consulted before the first summary arrives.
function homeAvailable() {
  const allowed = _home.allowed;
  return Object.entries(HOME_WIDGETS)
    .filter(([id, w]) => allowed ? allowed.includes(id) : (!w.perm || HOMECFG.can(w.perm)))
    .map(([id, w]) => ({ id, ...w }));
}

async function loadHome() {
  const grid = document.getElementById('home-grid');
  if (!grid) return;
  // A token rather than a busy flag: an early return here meant that navigating
  // away and straight back while the first fetch was in flight left Home blank.
  const req = ++_home.req;
  try {
    // One round trip for every widget on the page, not one per widget
    const [layoutR, dataR] = await Promise.all([
      HOMECFG.fetch(HOMECFG.base + '/home/layout'),
      HOMECFG.fetch(HOMECFG.base + '/home/summary'),
    ]);
    const layout = layoutR.ok ? await layoutR.json() : { widgets: [] };
    _home.data = dataR.ok ? await dataR.json() : {};
    if (req !== _home.req) return;                 // a newer load has taken over
    if (Array.isArray(_home.data.allowed)) _home.allowed = _home.data.allowed;
    const allowed = new Set(homeAvailable().map(w => w.id));
    const saved = (layout.widgets || []).filter(w => allowed.has(w.id));
    _home.widgets = saved.length ? saved : HOME_DEFAULT.filter(w => allowed.has(w.id));
  } catch (_) {
    _home.data = _home.data || {};
    // Falling back to the raw default here used to show an employee the widgets they
    // are not allowed — the fallback has to be filtered like everything else.
    if (!_home.widgets.length) {
      const allowed = new Set(homeAvailable().map(w => w.id));
      _home.widgets = HOME_DEFAULT.filter(w => allowed.has(w.id));
    }
  }
  homeRender();
  homeLoadAsync();
}

// Widgets that fetch their own data, so a slow Google call cannot hold up the grid.
// Each result is cached for the life of the page view and patched into its tile.
const HOME_ASYNC_URL = {
  calendar: () => HOMECFG.base + '/home/calendar',
  drive:    () => HOMECFG.google.drive,
  sheets:   () => HOMECFG.google.sheets,
  email:    () => HOMECFG.google.email,
};
async function homeLoadAsync() {
  const kinds = [...new Set(_home.widgets
    .map(w => (HOME_WIDGETS[w.id] || {}).async).filter(Boolean))];
  await Promise.all(kinds.map(async kind => {
    if (_home.async[kind]) return;                 // already fetched this page view
    try {
      const r = await HOMECFG.fetch(HOME_ASYNC_URL[kind]());
      _home.async[kind] = r.ok ? await r.json() : { error: 'unavailable' };
    } catch (_) { _home.async[kind] = { error: 'unavailable' }; }
  }));
  if (kinds.length) homeRender();
}

async function homeSaveLayout() {
  try {
    await HOMECFG.fetch(HOMECFG.base + '/home/layout',
      { method: 'PUT', body: JSON.stringify({ widgets: _home.widgets }) });
  } catch (_) { HOMECFG.toast('Could not save the layout.'); }
}

function homeRender() {
  const grid = document.getElementById('home-grid');
  if (!grid) return;
  document.getElementById('home-edit-label').textContent = _home.editing ? 'Done' : 'Edit layout';
  document.getElementById('home-add-btn').style.display = _home.editing ? '' : 'none';
  document.getElementById('home-reset-btn').style.display = _home.editing ? '' : 'none';
  grid.classList.toggle('editing', _home.editing);

  if (!_home.widgets.length) {
    grid.innerHTML = `<div class="home-empty">
      <div style="font-weight:600;font-size:15px">Your Home is empty</div>
      <div style="font-size:13px;color:var(--muted);margin-top:6px">Choose <em>Edit layout</em> to add widgets.</div>
    </div>`;
    return;
  }

  // Counts built from a capped scan are a floor, not a total. Saying so is the whole
  // point of the cap being visible — a number that is quietly short is worse than one
  // labelled incomplete.
  const capped = (_home.data && _home.data.partial) || [];
  const notice = capped.length
    ? `<div class="home-partial"><i data-lucide="info" style="width:13px;height:13px"></i>
         Showing the most recent records only (${capped.map(esc).join(', ')}) — totals below are a minimum.</div>`
    : '';
  grid.innerHTML = notice + _home.widgets.map((w, i) => {
    const def = HOME_WIDGETS[w.id];
    if (!def) return '';
    return `<section class="home-w" style="grid-column:span ${w.w}" data-h="${w.h}" data-i="${i}"
              ${_home.editing ? 'draggable="true"' : ''}>
      <header class="home-w-head">
        <i data-lucide="${def.icon}" style="width:14px;height:14px"></i>
        <span class="home-w-title">${esc(def.title)}</span>
        ${_home.editing ? `<span class="home-w-tools">
          <select class="home-w-size" onchange="homeSetSize(${i}, this.value)" title="Width">
            ${HOME_SIZES.map(s => `<option value="${s.w}"${s.w === w.w ? ' selected' : ''}>${s.label}</option>`).join('')}
          </select>
          <button class="home-w-btn" onclick="homeSetHeight(${i})" title="Toggle height">
            <i data-lucide="${w.h === 2 ? 'chevrons-down-up' : 'chevrons-up-down'}" style="width:13px;height:13px"></i></button>
          <button class="home-w-btn" onclick="homeRemove(${i})" title="Remove">
            <i data-lucide="x" style="width:13px;height:13px"></i></button>
        </span>` : ''}
      </header>
      <div class="home-w-body">${homeWidgetBody(w.id)}</div>
    </section>`;
  }).join('');

  if (_home.editing) homeBindDrag(grid);
  if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
}

function homeWidgetBody(id) {
  const d = _home.data || {};
  const money = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const bars = rows => !rows || !rows.length
    ? '<div class="home-none">Nothing yet</div>'
    : `<div class="home-bars">${(() => {
        const max = Math.max(...rows.map(r => r.count || r.value || 0), 1);
        return rows.slice(0, 6).map(r => {
          const v = r.count != null ? r.count : r.value;
          return `<div class="home-bar-row"><span class="home-bar-lbl">${esc(r.label)}</span>
            <span class="home-bar"><i style="width:${Math.max(2, Math.round((v / max) * 100))}%"></i></span>
            <span class="home-bar-val">${r.value != null && r.count != null ? money(r.value) : v}</span></div>`;
        }).join('');
      })()}</div>`;
  const list = (rows, line) => !rows || !rows.length
    ? '<div class="home-none">Nothing yet</div>'
    : `<ul class="home-list">${rows.map(line).join('')}</ul>`;
  const big = (v, sub) => `<div class="home-big">${v}</div><div class="home-sub">${esc(sub)}</div>`;

  switch (id) {
    case 'my_tasks':
      return list(d.my_tasks, t => `<li><span class="home-li-main">${esc(t.title || '')}</span>
        <span class="home-li-sub">${t.due_date ? esc(String(t.due_date).slice(0, 10)) : ''}</span></li>`);
    case 'task_status':   return bars(d.task_status);
    case 'overdue_tasks': return big(d.overdue_tasks || 0, 'tasks past their due date');
    case 'leads_status':  return bars(d.leads_status);
    case 'recent_leads':
      return list(d.recent_leads, c => `<li><span class="home-li-main">${esc(c.name || '')}</span>
        <span class="home-li-sub">${esc(c.lead_status || '')}</span></li>`);
    case 'followups':
      return list(d.followups, f => `<li><span class="home-li-main">${esc(f.note || 'Follow-up')}</span>
        <span class="home-li-sub">${f.due_at ? esc(String(f.due_at).slice(0, 10)) : ''}</span></li>`);
    case 'pipeline':      return bars(d.pipeline);
    case 'won_month':     return big(money(d.won_month), 'EGP won this month');
    case 'hours_week':    return big(d.hours_week || 0, 'hours logged this week');
    case 'stock_summary':
      return big((d.stock_summary || {}).units || 0, `${(d.stock_summary || {}).models || 0} models in stock`);
    case 'stock_models':
      return list(d.stock_models, v => `<li><span class="home-li-main">${esc(v.label)}</span>
        <span class="home-li-sub">${v.count} in stock</span></li>`);

    case 'my_requests':   return bars(d.my_requests);
    case 'approvals':
      return list(d.approvals, a => `<li><span class="home-li-main">${esc(a.label || '')}</span>
        <span class="home-li-sub">${esc(a.by || '')}</span></li>`);

    case 'quotation_recent': return list(d.quotation_recent, q => nameRow(q));
    case 'contracts_recent': return list(d.contracts_recent, c => nameRow(c, c.status));
    case 'sales_month': {
      const v = d.sales_month || {};
      return big(money(v.value), `${v.count || 0} ${v.count === 1 ? 'sale' : 'sales'} this month`);
    }

    case 'suppliers_top': return bars(d.suppliers_top);
    case 'po_status':     return bars(d.po_status);
    case 'rfq_open':      return list(d.rfq_open, r => nameRow(r, r.sub));

    case 'submissions_recent': return list(d.submissions_recent, x => nameRow(x, x.sub));
    case 'automations_active': {
      const a = d.automations_active || {};
      return big(a.active || 0, `${a.total || 0} rules in total`);
    }
    case 'team_roster':
      return !d.team_roster || !d.team_roster.length
        ? '<div class="home-none">Nothing yet</div>'
        : `<div class="home-people">${d.team_roster.map(e => `<span class="home-person" title="${esc(e.job_title || '')}">
            ${e.avatar ? `<img src="${esc(e.avatar)}" alt="">` : `<i>${esc(homeInitials(e.name))}</i>`}
            <b class="${e.online ? 'on' : ''}"></b>${esc((e.name || '').split(' ')[0])}</span>`).join('')}</div>`;
    case 'whatsapp_recent': return list(d.whatsapp_recent, m => nameRow(m, m.sub));
    case 'issues_open':     return list(d.issues_open, i => nameRow(i, i.sub));

    // ── Built here, from what the page already holds ──
    case 'unread_chat': {
      const n = HOMECFG.unread ? HOMECFG.unread() : 0;
      return big(n, n === 1 ? 'unread message' : 'unread messages');
    }
    case 'notifications': {
      const rows = (HOMECFG.notifs ? HOMECFG.notifs() : []).slice(0, 6);
      return list(rows, n => `<li><span class="home-li-main">${esc(n.title || '')}</span>
        <span class="home-li-sub">${esc((n.body || '').slice(0, 40))}</span></li>`);
    }
    case 'meet_quick':
      return `<div class="home-actions">
        <button class="btn btn-outline btn-sm" onclick="window.open('https://meet.google.com/new','_blank','noopener')">
          <i data-lucide="video" style="width:13px;height:13px"></i> Start a meeting</button>
        <button class="btn btn-outline btn-sm" onclick="navigate('meet')">
          <i data-lucide="calendar" style="width:13px;height:13px"></i> Open Meet</button></div>`;

    // ── Fetched by homeLoadAsync ──
    case 'calendar': {
      const c = _home.async.calendar;
      if (!c) return '<div class="home-none">Loading…</div>';
      if (!c.connected) return `<div class="home-none">Calendar is not connected.
        <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="navigate('calendar')">Connect</button></div>`;
      return list(c.events, e => `<li><span class="home-li-main">${esc(e.title || '')}</span>
        <span class="home-li-sub">${esc(homeWhen(e.start, e.allDay))}</span></li>`);
    }
    case 'drive_recent':  return homeFileList(_home.async.drive);
    case 'sheets_recent': return homeFileList(_home.async.sheets);
    case 'email_unread': {
      const m = _home.async.email;
      if (!m) return '<div class="home-none">Loading…</div>';
      if (m.error || !Array.isArray(m)) return '<div class="home-none">Email is not connected.</div>';
      const unread = m.filter(x => x.unread).slice(0, 6);
      return list(unread, x => `<li><span class="home-li-main">${esc(x.subject || '')}</span>
        <span class="home-li-sub">${esc((x.from || '').replace(/<[^>]*>/g, '').trim())}</span></li>`);
    }

    case 'quick_actions':
      return `<div class="home-actions">${HOMECFG.actions().map(a =>
        `<button class="btn btn-outline btn-sm" onclick="${a.onclick}">
          <i data-lucide="${a.icon}" style="width:13px;height:13px"></i> ${esc(a.label)}</button>`).join('')}</div>`;
    default: return '<div class="home-none">—</div>';
  }

  // A label with an optional muted second line — the shape most of the new list
  // widgets share, so they do not each re-spell it.
  function nameRow(r, sub) {
    return `<li><span class="home-li-main">${esc(r.label || '')}</span>
      <span class="home-li-sub">${esc(sub || (r.created_at ? String(r.created_at).slice(0, 10) : ''))}</span></li>`;
  }
}

function homeInitials(name) {
  return String(name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// "Today 14:30" reads better than a full timestamp on a tile this small.
function homeWhen(iso, allDay) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  const day = d.toDateString() === new Date().toDateString() ? 'Today'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return allDay ? day : `${day} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function homeFileList(files) {
  if (!files) return '<div class="home-none">Loading…</div>';
  if (files.error || !Array.isArray(files)) return '<div class="home-none">Google Drive is not connected.</div>';
  if (!files.length) return '<div class="home-none">Nothing yet</div>';
  return `<ul class="home-list">${files.slice(0, 6).map(f => `<li>
    <a class="home-li-main" href="${esc(f.webViewLink || '#')}" target="_blank" rel="noopener">${esc(f.name || '')}</a>
    <span class="home-li-sub">${esc(String(f.modifiedTime || '').slice(0, 10))}</span></li>`).join('')}</ul>`;
}

// ── Edit mode ──
function homeToggleEdit() {
  // Dragging tiles around a 12-column grid is not a touch interaction, and the size
  // and height controls are meaningless once every widget is full width. The button
  // is hidden at this width too; this guards the function itself.
  if (typeof mlIsMobile === 'function' && mlIsMobile() && !_home.editing) {
    HOMECFG.toast('Rearranging your Home needs a wider screen.');
    return;
  }
  _home.editing = !_home.editing;
  if (!_home.editing) homeSaveLayout();
  homeRender();
}
function homeSetSize(i, w) {
  if (_home.widgets[i]) _home.widgets[i].w = Number(w) || 4;
  homeRender();
}
function homeSetHeight(i) {
  if (_home.widgets[i]) _home.widgets[i].h = _home.widgets[i].h === 2 ? 1 : 2;
  homeRender();
}
function homeRemove(i) {
  _home.widgets.splice(i, 1);
  homeRender();
}
function homeReset() {
  const allowed = new Set(homeAvailable().map(w => w.id));
  _home.widgets = HOME_DEFAULT.filter(w => allowed.has(w.id)).map(w => ({ ...w }));
  homeRender();
}
function homeOpenAdd() {
  const used = new Set(_home.widgets.map(w => w.id));
  const free = homeAvailable().filter(w => !used.has(w.id));
  if (!free.length) { HOMECFG.toast('Every widget is already on your Home.'); return; }
  HOMECFG.sheet('Add a widget', `<div class="hd-list">
      ${free.map(w => `<label class="hd-row"><input type="checkbox" class="home-add-cb" value="${esc(w.id)}">
        <i data-lucide="${w.icon}" style="width:14px;height:14px"></i>
        <span style="flex:1">${esc(w.title)}</span></label>`).join('')}
    </div>`,
    `<button class="btn btn-outline btn-sm" onclick="hdSheetClose()">Cancel</button>
     <button class="btn btn-primary btn-sm" onclick="homeAddPicked()">Add</button>`);
  if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
}
function homeAddPicked() {
  [...document.querySelectorAll('.home-add-cb:checked')].forEach(cb => {
    const def = HOME_WIDGETS[cb.value];
    if (def) _home.widgets.push({ id: cb.value, w: def.w, h: def.h });
  });
  hdSheetClose();
  homeRender();
}

// Drag to reorder. Same shape as the sidebar arranger: drop before or after the
// widget under the pointer, decided by which half of it you are over.
function homeBindDrag(grid) {
  let from = null;
  grid.querySelectorAll('.home-w').forEach(el => {
    el.addEventListener('dragstart', e => {
      from = Number(el.dataset.i);
      el.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from)); } catch (_) {}
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); grid.querySelectorAll('.home-w').forEach(x => x.classList.remove('over')); });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('over');
      const to = Number(el.dataset.i);
      if (from == null || from === to) return;
      const r = el.getBoundingClientRect();
      const after = (e.clientX - r.left) > r.width / 2;
      const moved = _home.widgets.splice(from, 1)[0];
      let idx = to + (after ? 1 : 0);
      if (from < idx) idx--;
      _home.widgets.splice(idx, 0, moved);
      from = null;
      homeRender();
    });
  });
}
