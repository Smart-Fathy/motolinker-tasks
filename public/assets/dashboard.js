// ── Auth ────────────────────────────────────────────────────────────────────
let authToken = localStorage.getItem('ml_admin_token') || '';

let allTasks = [];
let charts   = {};
let refreshTimer = null;
let countdown    = 60;

// All API calls go through here — adds Bearer token header automatically
function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  // Don't set Content-Type for FormData — browser sets multipart boundary automatically
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  // One central 401 check: a server restart wipes the in-memory session, and the
  // scattered per-call checks missed enough places that the page just went quiet.
  return fetch(path, { ...opts, headers }).then(r => {
    if (r.status === 401 && authToken) showAuthScreen();
    return r;
  });
}

async function checkAuth() {
  if (!authToken) { showAuthScreen(); return false; }
  try {
    const r = await apiFetch('/api/auth/check');
    if (r.status === 401) { showAuthScreen(); return false; }
  } catch (_) {
    // Network down or server restarting. Showing the app anyway — the old
    // behaviour — meant every panel silently failed and the page looked blank.
    // Land somewhere visible and keep retrying until the server answers.
    bootRetryScreen();
    return false;
  }
  document.getElementById('app').style.display = 'block';
  return true;
}

// A visible floor for boot failures. Independent of the app markup on purpose:
// both #app and #auth-screen start display:none, so any unhandled throw during
// init used to leave the page entirely blank until the user refreshed enough
// times to win the service-worker race.
function bootRetryScreen(message) {
  let el = document.getElementById('boot-retry');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-retry';
    el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:var(--bg,#0f1117);color:var(--text,#e7e3da);z-index:9998;text-align:center;padding:20px';
    el.innerHTML = `<div>
      <div style="font-size:17px;font-weight:700;margin-bottom:8px">Can’t reach MotoLinker</div>
      <div id="boot-retry-msg" style="font-size:13px;color:var(--muted,#889);margin-bottom:16px">Retrying automatically…</div>
      <button class="btn btn-primary" onclick="location.reload()">Retry now</button>
    </div>`;
    document.body.appendChild(el);
  }
  if (message) { const m = document.getElementById('boot-retry-msg'); if (m) m.textContent = message; }
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'none';
  clearTimeout(bootRetryScreen._t);
  bootRetryScreen._t = setTimeout(async () => {
    try {
      const r = await fetch('/api/auth/check', { headers: authToken ? { Authorization: 'Bearer ' + authToken } : {} });
      if (r.status > 0) location.reload();   // any HTTP answer means the server is back
    } catch (_) { bootRetryScreen(); }       // still down — keep waiting
  }, 5000);
}

function showAuthScreen() {
  localStorage.removeItem('ml_admin_token');
  authToken = '';
  if (typeof closeNotifStream === 'function') closeNotifStream();
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

async function submitLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('auth-error');
  errEl.style.display = 'none';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) { errEl.style.display = 'block'; return; }
    const data = await r.json();
    authToken = data.token;
    localStorage.setItem('ml_admin_token', authToken);
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadNotifs();
    openNotifStream();
    loadDashboard();
  } catch (e) {
    errEl.textContent = 'Connection error: ' + e.message;
    errEl.style.display = 'block';
  }
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitLogin();
});

// ── Fetch ───────────────────────────────────────────────────────────────────
async function fetchStats() {
  const r = await apiFetch('/api/dashboard/stats');
  if (r.status === 401) { showAuthScreen(); throw new Error('Session expired'); }
  if (!r.ok) throw new Error('Stats: ' + r.status);
  return r.json();
}
async function fetchTasks() {
  const r = await apiFetch('/api/dashboard/tasks');
  if (r.status === 401) { showAuthScreen(); throw new Error('Session expired'); }
  if (!r.ok) throw new Error('Tasks: ' + r.status);
  return r.json();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const TODAY = new Date().toISOString().split('T')[0];
function isOverdue(d, s) { return s !== 'done' && d < TODAY; }
function isDueSoon(d, s) {
  if (s === 'done') return false;
  const diff = (new Date(d) - new Date()) / 86400000;
  return diff >= 0 && diff <= 3;
}

function statusBadge(s) {
  const map = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
  return `<span class="badge badge-${s}">${map[s] || s}</span>`;
}
function priorityBadge(p) {
  const map = { high: 'High', medium: 'Medium', low: 'Low' };
  return `<span class="badge badge-${p}">${map[p] || p}</span>`;
}

// ── Render Stats ─────────────────────────────────────────────────────────────
function renderStats(s) {
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card total">
      <div class="stat-label">Total Tasks</div>
      <div class="stat-value">${s.total}</div>
      <div class="stat-sub">All time</div>
    </div>
    <div class="stat-card done">
      <div class="stat-label">Completed</div>
      <div class="stat-value">${s.done}</div>
      <div class="stat-sub">${s.completionRate}% rate</div>
    </div>
    <div class="stat-card in-progress">
      <div class="stat-label">In Progress</div>
      <div class="stat-value">${s.inProgress}</div>
      <div class="stat-sub">Active now</div>
    </div>
    <div class="stat-card todo">
      <div class="stat-label">To Do</div>
      <div class="stat-value">${s.todo}</div>
      <div class="stat-sub">Pending start</div>
    </div>
    <div class="stat-card high-pri">
      <div class="stat-label">High Priority</div>
      <div class="stat-value">${s.highPriority}</div>
      <div class="stat-sub">Open issues</div>
    </div>
    <div class="stat-card overdue">
      <div class="stat-label">Overdue</div>
      <div class="stat-value">${s.overdue}</div>
      <div class="stat-sub">Past due date</div>
    </div>
  `;

  document.getElementById('progress-fill').style.width = s.completionRate + '%';
  document.getElementById('progress-pct').textContent  = s.completionRate + '%';
}

// ── Charts ───────────────────────────────────────────────────────────────────
// Top Performers — ranked list of tasks completed per employee (replaces the
// old Tasks-by-Channel chart, which became meaningless after Slack removal)
function renderTopPerformers(byEmployee) {
  const c = document.getElementById('top-performers');
  if (!c) return;
  const list = Array.isArray(byEmployee) ? byEmployee : [];
  if (!list.length) {
    c.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:12px">No assigned tasks yet</div>';
    return;
  }
  const medalColors = ['#d4af37', '#b9bcc2', '#c58a4a'];   // gold, silver, bronze
  c.innerHTML = list.slice(0, 8).map((e, i) => {
    const pct = e.total ? Math.round((e.done / e.total) * 100) : 0;
    const initials = (e.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const avatar = e.avatar_url
      ? `<img src="${esc(e.avatar_url)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0">`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--primary);color:#fff;font-size:10px;font-weight:700;flex-shrink:0">${initials}</span>`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border)">
      <span style="width:26px;display:flex;align-items:center;justify-content:center;font-size:11px;color:${i < 3 ? medalColors[i] : 'var(--muted)'};flex-shrink:0">${i < 3 ? '<i data-lucide="award" style="width:15px;height:15px"></i>' : '#' + (i + 1)}</span>
      ${avatar}
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:600">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}</span>
          <span style="color:var(--success);white-space:nowrap">${e.done} <span style="color:var(--muted);font-weight:400">/ ${e.total}</span></span>
        </div>
        <div style="height:5px;background:var(--border);border-radius:99px;margin-top:5px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--primary),#e6c98a);border-radius:99px"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderCharts(s) {
  renderTopPerformers(s.byEmployee);

  // Doughnut — Status distribution
  if (charts.status) charts.status.destroy();
  charts.status = new Chart(document.getElementById('statusChart'), {
    type: 'doughnut',
    data: {
      labels: ['To Do', 'In Progress', 'Done'],
      datasets: [{ data: [s.todo, s.inProgress, s.done], backgroundColor: ['#94a3b8','#f59e0b','#10b981'], borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } } },
    },
  });

  // Horizontal bar — Priority breakdown
  if (charts.priority) charts.priority.destroy();
  charts.priority = new Chart(document.getElementById('priorityChart'), {
    type: 'bar',
    data: {
      labels: ['High', 'Medium', 'Low'],
      datasets: [{
        label: 'Tasks',
        data: [s.byPriority.high, s.byPriority.medium, s.byPriority.low],
        backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      layout: { padding: { right: 16 } },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          suggestedMax: Math.max(s.byPriority.high, s.byPriority.medium, s.byPriority.low, 1) + 1,
          ticks: { stepSize: 1, precision: 0, font: { size: 11 } },
          grid: { display: true },
        },
        y: { ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ── Reports / Sales Analytics ──────────────────────────────────────────────────
let _reportData = null;
function repDateDefaults() {
  const to = document.getElementById('rep-to'), from = document.getElementById('rep-from');
  if (to && !to.value) to.value = new Date().toISOString().slice(0, 10);
  if (from && !from.value) from.value = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
}
function repQuery() {
  const p = new URLSearchParams();
  const f = document.getElementById('rep-from')?.value, t = document.getElementById('rep-to')?.value, s = document.getElementById('rep-source')?.value;
  if (f) p.set('from', f); if (t) p.set('to', t); if (s) p.set('source', s);
  return p.toString();
}
async function loadReports() {
  repDateDefaults();
  const grid = document.getElementById('reports-stats');
  grid.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  try {
    const r = await apiFetch('/api/dashboard/reports/summary?' + repQuery());
    const s = await r.json();
    if (!r.ok) throw new Error(s.error || 'Failed');
    _reportData = s;
    renderReportStats(s);
    renderReportCharts(s);
  } catch (e) {
    grid.innerHTML = `<div class="error-msg" style="grid-column:1/-1">${esc(e.message)}</div>`;
  }
  loadLeadsReport(); // render the custom leads report alongside sales analytics
  requestAnimationFrame(() => lucide.createIcons());
}
function egp(n) { return (Number(n) || 0).toLocaleString() + ' EGP'; }
function renderReportStats(s) {
  document.getElementById('reports-stats').innerHTML = `
    <div class="stat-card total"><div class="stat-label">Open Pipeline</div><div class="stat-value" style="font-size:22px">${egp(s.totalPipeline)}</div><div class="stat-sub">${s.range.from} → ${s.range.to}</div></div>
    <div class="stat-card in-progress"><div class="stat-label">Weighted Pipeline</div><div class="stat-value" style="font-size:22px">${egp(s.weightedPipeline)}</div><div class="stat-sub">Probability-adjusted</div></div>
    <div class="stat-card done"><div class="stat-label">Revenue Won</div><div class="stat-value" style="font-size:22px">${egp(s.revenueWon)}</div><div class="stat-sub">${s.wonCount} deal${s.wonCount === 1 ? '' : 's'}</div></div>
    <div class="stat-card high-pri"><div class="stat-label">Win Rate</div><div class="stat-value">${s.winRate}%</div><div class="stat-sub">Won vs lost</div></div>
    <div class="stat-card todo"><div class="stat-label">Avg Deal</div><div class="stat-value" style="font-size:22px">${egp(s.avgDeal)}</div><div class="stat-sub">Per won deal</div></div>
    <div class="stat-card overdue"><div class="stat-label">Quotes Generated</div><div class="stat-value">${s.quotesCount}</div><div class="stat-sub">In range</div></div>`;
}
function renderReportCharts(s) {
  const gold = '#e6c98a', primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#c99a4e';
  // Funnel (horizontal bar)
  if (charts.repFunnel) charts.repFunnel.destroy();
  charts.repFunnel = new Chart(document.getElementById('repFunnel'), {
    type: 'bar',
    data: { labels: s.funnel.map(f => f.stage), datasets: [{ label: 'Deals', data: s.funnel.map(f => f.count), backgroundColor: primary, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  // Revenue by month (bar)
  if (charts.repRevenue) charts.repRevenue.destroy();
  charts.repRevenue = new Chart(document.getElementById('repRevenue'), {
    type: 'bar',
    data: { labels: s.revenueByMonth.map(m => m.month), datasets: [{ label: 'Revenue (EGP)', data: s.revenueByMonth.map(m => m.value), backgroundColor: gold, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
  // Deals by source (doughnut)
  if (charts.repSource) charts.repSource.destroy();
  charts.repSource = new Chart(document.getElementById('repSource'), {
    type: 'doughnut',
    data: { labels: s.bySource.map(x => x.source), datasets: [{ data: s.bySource.map(x => x.deals), backgroundColor: ['#c99a4e','#f59e0b','#10b981','#3b82f6','#a855f7','#ef4444','#14b8a6','#64748b','#e6c98a'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8 } } } },
  });
  // Rep leaderboard (horizontal bar, revenue won)
  if (charts.repRep) charts.repRep.destroy();
  charts.repRep = new Chart(document.getElementById('repRep'), {
    type: 'bar',
    data: { labels: s.byRep.map(x => x.rep), datasets: [{ label: 'Revenue won (EGP)', data: s.byRep.map(x => x.value), backgroundColor: gold, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } },
  });
}
function exportReport(which) {
  const p = repQuery();
  const tok = encodeURIComponent(authToken || '');
  window.location = `/api/dashboard/reports/export.csv?report=${encodeURIComponent(which)}${p ? '&' + p : ''}&_t=${tok}`;
}

// ── Custom Leads Report ────────────────────────────────────────────────────────
let _leadsReportData = null;
const LR_GROUP_OPTS = [
  ['lead_status', 'Status'], ['source', 'Origin'], ['budget', 'Budget range'], ['next_action', 'Next Action'],
  ['been_contacted', 'Contacted'], ['owner', 'Owner (rep)'], ['month', 'Month'], ['car_in_question', 'Vehicle'],
];
function lrGroupLabel(key) {
  const b = LR_GROUP_OPTS.find(o => o[0] === key);
  if (b) return b[1];
  return (_leadCols || []).find(c => c.key === key)?.label || key;
}
const LR_PALETTE = ['#c99a4e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6', '#64748b', '#e6c98a', '#8b5cf6', '#0ea5e9', '#f97316'];
function lrDimOptions(includeNone) {
  const base = LR_GROUP_OPTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  const customs = (_leadCols || []).filter(c => !c.builtin && !c.deleted);
  const custom = customs.length ? `<optgroup label="Custom columns">${customs.map(c => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}</optgroup>` : '';
  return (includeNone ? '<option value="">— none —</option>' : '') + base + custom;
}
function lrPopulateGroupBy() {
  const g = document.getElementById('lr-groupby'), s = document.getElementById('lr-splitby');
  if (g) { const cur = g.value; g.innerHTML = lrDimOptions(false); if (cur) g.value = cur; }
  if (s) { const cur = s.value; s.innerHTML = lrDimOptions(true); if (cur) s.value = cur; }
}
function lrGroupChanged() {
  const g = document.getElementById('lr-groupby')?.value, s = document.getElementById('lr-splitby')?.value;
  document.getElementById('lr-buckets-wrap').style.display = (g === 'budget' || s === 'budget') ? 'block' : 'none';
}
function lrDateDefaults() { /* all-time by default — leave the date inputs empty so totals match the Leads table */ }
function lrQuery() {
  const p = new URLSearchParams();
  const g = document.getElementById('lr-groupby').value;
  const sb = document.getElementById('lr-splitby').value;
  p.set('groupBy', g);
  if (sb && sb !== g) p.set('splitBy', sb);
  p.set('measure', document.getElementById('lr-measure').value);
  const f = document.getElementById('lr-from').value, t = document.getElementById('lr-to').value;
  const st = document.getElementById('lr-status').value, sr = document.getElementById('lr-source').value;
  if (f) p.set('from', f); if (t) p.set('to', t); if (st) p.set('status', st); if (sr) p.set('source', sr);
  if (g === 'budget' || sb === 'budget') { const bk = document.getElementById('lr-buckets').value.trim(); if (bk) p.set('buckets', bk); }
  return p.toString();
}
async function loadLeadsReport() {
  try { await loadLeadCols(); } catch (_) {}   // for custom-column dimension options
  lrPopulateGroupBy(); lrGroupChanged(); lrDateDefaults();
  const tbl = document.getElementById('lr-table');
  if (tbl) tbl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const r = await apiFetch('/api/dashboard/reports/leads?' + lrQuery());
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    _leadsReportData = d;
    renderLeadsReport(d);
  } catch (e) { if (tbl) tbl.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; }
  requestAnimationFrame(() => lucide.createIcons());
}
function lrMeasureName(m) { return m === 'count' ? 'Lead count' : m === 'budget_sum' ? 'Total budget' : 'Avg budget'; }
function lrRangeLabel(d) { return (d.range && (d.range.from || d.range.to)) ? `${d.range.from || '…'} → ${d.range.to || '…'}` : 'All time'; }
function lrFmt(d, v) { return d.measure === 'count' ? Number(v).toLocaleString() : egp(v); }
function renderLeadsReport(d) {
  document.getElementById('lr-kpis').innerHTML = `
    <div class="stat-card total"><div class="stat-label">Total Leads</div><div class="stat-value">${d.totals.count.toLocaleString()}</div><div class="stat-sub">${lrRangeLabel(d)}</div></div>
    <div class="stat-card high-pri"><div class="stat-label">Hot Leads</div><div class="stat-value">${d.hotCount.toLocaleString()}</div><div class="stat-sub">${d.totals.count ? Math.round(d.hotCount / d.totals.count * 100) : 0}% of leads</div></div>
    <div class="stat-card in-progress"><div class="stat-label">Avg Budget</div><div class="stat-value" style="font-size:20px">${egp(d.totals.avg)}</div><div class="stat-sub">Per lead</div></div>`;
  return d.splitBy ? renderLeadsCrossTab(d) : renderLeadsSingle(d);
}
function renderLeadsSingle(d) {
  const rows = d.rows || [];
  const isCount = d.measure === 'count';
  const maxV = Math.max(1, ...rows.map(r => isCount ? r.count : (Number(r.value) || 0)));
  const gl = lrGroupLabel(d.groupBy);
  document.getElementById('lr-table-title').textContent = `${gl} · ${lrMeasureName(d.measure)}`;
  document.getElementById('lr-table').innerHTML = rows.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
        <th style="padding:6px 8px">${esc(gl)}</th><th style="padding:6px 8px;text-align:right">Leads</th><th style="padding:6px 8px;text-align:right">${isCount ? '% of total' : 'Budget'}</th></tr></thead>
      <tbody>${rows.map(r => {
        const barPct = Math.round((isCount ? r.count : (Number(r.value) || 0)) / maxV * 100);
        const right = isCount ? (d.totals.count ? Math.round(r.count / d.totals.count * 100) : 0) + '%' : egp(r.value);
        return `<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
          <td style="padding:6px 8px"><div style="position:relative;min-width:80px"><div style="position:absolute;inset:0;background:rgba(201,163,94,.16);width:${barPct}%;border-radius:3px"></div><span style="position:relative">${esc(r.label)}</span></div></td>
          <td style="padding:6px 8px;text-align:right;font-weight:600">${r.count.toLocaleString()}</td>
          <td style="padding:6px 8px;text-align:right;color:var(--muted)">${right}</td></tr>`;
      }).join('')}</tbody>
    </table>` : '<div style="color:var(--muted);padding:24px;text-align:center">No leads match these filters.</div>';
  const labels = rows.map(r => r.label);
  const data = rows.map(r => isCount ? r.count : (Number(r.value) || 0));
  const doughnut = ['lead_status', 'source', 'been_contacted', 'next_action'].includes(d.groupBy);
  if (charts.lrChart) charts.lrChart.destroy();
  charts.lrChart = new Chart(document.getElementById('lrChart'), doughnut ? {
    type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: LR_PALETTE, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8 } } } },
  } : {
    type: 'bar', data: { labels, datasets: [{ label: isCount ? 'Leads' : 'EGP', data, backgroundColor: '#c99a4e', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}
function renderLeadsCrossTab(d) {
  const rows = d.rows || [], cats = d.splitCats || [];
  const gl = lrGroupLabel(d.groupBy), sl = lrGroupLabel(d.splitBy);
  document.getElementById('lr-table-title').textContent = `${gl} × ${sl} · ${lrMeasureName(d.measure)}`;
  document.getElementById('lr-table').innerHTML = rows.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
        <th style="padding:6px 8px">${esc(gl)} \\ ${esc(sl)}</th>
        ${cats.map(c => `<th style="padding:6px 8px;text-align:right;white-space:nowrap">${esc(c.label)}</th>`).join('')}
        <th style="padding:6px 8px;text-align:right;font-weight:700">Total</th></tr></thead>
      <tbody>${rows.map(r => `<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
        <td style="padding:6px 8px;font-weight:600">${esc(r.label)}</td>
        ${cats.map(c => { const v = r.cells[c.key] || 0; return `<td style="padding:6px 8px;text-align:right;color:${v ? 'inherit' : 'var(--muted)'}">${v ? lrFmt(d, v) : '·'}</td>`; }).join('')}
        <td style="padding:6px 8px;text-align:right;font-weight:700">${lrFmt(d, d.measure === 'count' ? r.count : r.value)}</td></tr>`).join('')}
      </tbody></table>` : '<div style="color:var(--muted);padding:24px;text-align:center">No leads match these filters.</div>';
  // Stacked bar: one bar per primary group, a segment per split category
  const labels = rows.map(r => r.label);
  const datasets = cats.map((c, i) => ({ label: c.label, data: rows.map(r => r.cells[c.key] || 0), backgroundColor: LR_PALETTE[i % LR_PALETTE.length], borderWidth: 0 }));
  if (charts.lrChart) charts.lrChart.destroy();
  charts.lrChart = new Chart(document.getElementById('lrChart'), {
    type: 'bar', data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, padding: 6 } } },
      scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true } } },
  });
}
function lrCsvCell(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function exportLeadsReport() {
  const d = _leadsReportData;
  if (!d) { alert('Click Apply to run the report first.'); return; }
  const gl = lrGroupLabel(d.groupBy);
  let lines;
  if (d.splitBy) {
    const cats = d.splitCats || [];
    lines = [[gl, ...cats.map(c => c.label), 'Total'].map(lrCsvCell).join(',')];
    for (const r of d.rows) lines.push([r.label, ...cats.map(c => r.cells[c.key] || 0), (d.measure === 'count' ? r.count : r.value)].map(lrCsvCell).join(','));
  } else {
    const isCount = d.measure === 'count';
    lines = [[gl, 'Leads', isCount ? 'Percent' : 'Budget_EGP'].map(lrCsvCell).join(',')];
    for (const r of d.rows) {
      const right = isCount ? (d.totals.count ? Math.round(r.count / d.totals.count * 100) : 0) + '%' : r.value;
      lines.push([lrCsvCell(r.label), r.count, lrCsvCell(right)].join(','));
    }
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `motolinker-leads-${d.groupBy}${d.splitBy ? '-x-' + d.splitBy : ''}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ── Automations ────────────────────────────────────────────────────────────────
let _autoRules = [];
let _autoDraft = { conditions: [], actions: [] };
const AM_TRIGGER_LABELS = { 'lead.created':'Lead created', 'lead.status_changed':'Lead status changed', 'lead.contacted':'Lead marked contacted', 'deal.created':'Deal created', 'deal.stage_changed':'Deal stage changed', 'quote.generated':'Quote generated', 'no_activity_days':'No activity for N days', 'task.created':'Task created', 'task.completed':'Task completed', 'task.overdue':'Task overdue', 'request.created':'Request submitted', 'request.status_changed':'Request status changed', 'submission.created':'Website form submitted', 'hours.not_logged':"Hours not logged" };
const AM_FIELDS = ['source','lead_status','stage','been_contacted','budget_lead','budget_egp','name','car_in_question','to'];
// Which condition fields make sense per trigger (falls back to AM_FIELDS).
const AM_TRIGGER_FIELDS = {
  'lead.created': ['source','lead_status','been_contacted','budget_lead','name','car_in_question'],
  'lead.status_changed': ['source','lead_status','been_contacted','budget_lead','name','car_in_question','to'],
  'lead.contacted': ['source','lead_status','budget_lead','name','car_in_question'],
  'deal.created': ['stage','budget_egp','name','car_in_question'],
  'deal.stage_changed': ['stage','budget_egp','name','car_in_question','to'],
  'quote.generated': ['name'],
  'no_activity_days': ['source','lead_status','budget_lead','name'],
  'task.created': ['priority','status','title'],
  'task.completed': ['priority','title'],
  'task.overdue': ['priority','title'],
  'request.created': ['priority','category','title'],
  'request.status_changed': ['priority','category','status','title','to'],
  'submission.created': ['name','email','phone','source','car_in_question'],
  'hours.not_logged': ['name'],
};
function amFieldsForTrigger() { const t = document.getElementById('am-trigger')?.value; return AM_TRIGGER_FIELDS[t] || AM_FIELDS; }
const AM_OPS = [['equals','is'],['not_equals','is not'],['contains','contains'],['changed_to','changed to'],['gt','>'],['lt','<'],['is_empty','is empty'],['not_empty','is not empty']];
const AM_ACTIONS = [['notify','Send a notification'],['notify_all','Notify all employees'],['create_followup','Create a follow-up'],['create_task','Create a task'],['create_deal','Create a deal'],['set_lead_status','Set lead status'],['assign_lead','Assign the lead to a rep'],['edit_lead','Edit the lead profile'],['delete_deals','Remove the lead from deals (needs approval)'],['delete_lead','Delete the lead (needs approval)']];
const AM_TASK_STATUSES = [['todo','To Do'],['in_progress','In Progress'],['done','Done']];
const AM_REQUEST_STATUSES = [['pending','Pending'],['in_review','In Review'],['approved','Approved'],['rejected','Rejected']];
const AM_PRIORITIES = [['high','High'],['medium','Medium'],['low','Low']];
const AM_LEAD_STATUSES = [['cold','Cold'],['warm','Warm'],['hot','Hot'],['immediate_delivery','Immediate Delivery'],['not_interested','Not Interested'],['blacklist','Blacklist']];
function amActionLabel(t){ const f = AM_ACTIONS.find(a => a[0] === t); return f ? f[1] : t; }
function amEmpOptions(sel){ return '<option value="">— select rep —</option>' + (employeesForTasks || []).map(e => `<option value="${e.id}"${String(sel) === String(e.id) ? ' selected' : ''}>${esc(e.name)}</option>`).join(''); }
// Enum option sets so the condition VALUE is picked (saving the canonical key) instead of free-typed.
const AM_DEAL_STAGES  = [['lead','Lead'],['inquiry','Inquiry'],['quoted','Quoted'],['negotiating','Negotiating'],['won','Won'],['lost','Lost']];
const AM_ORIGINS      = [['fb_ad','FB Ad.'],['whatsapp','Whatsapp'],['messenger','Messenger'],['direct_call','Direct Call'],['ig_ads','IG ads'],['website','Website'],['walk_in','Walk-in'],['marketplace','Marketplace']];
const AM_NEXT_ACTIONS = [['followed_by_sales','Followed By Sales'],['need_follow_up','Need Follow Up'],['closed','Closed'],['no_answer','No Answer']];
const AM_BOOLS        = [['true','Yes'],['false','No']];
const AM_LEAD_SCOPED_ACTIONS = ['assign_lead','create_followup','set_lead_status','create_deal','edit_lead','delete_deals','delete_lead'];
// Fields the "Edit the lead profile" action can set, with the value control chosen per field.
const AM_EDIT_FIELDS = [['lead_status','Status'],['source','Origin'],['next_action','Next Action'],['been_contacted','Contacted'],['assigned_to','Owner (rep)'],['car_in_question','Car'],['budget_lead','Budget'],['name','Name'],['phone','Phone'],['notes','Notes']];
function amNorm(s){ return String(s == null ? '' : s).trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function amFieldOptions(field){
  const t = document.getElementById('am-trigger')?.value || '';
  if (field === 'lead_status') return AM_LEAD_STATUSES;
  if (field === 'stage') return AM_DEAL_STAGES;
  if (field === 'to') return t.startsWith('request') ? AM_REQUEST_STATUSES : AM_DEAL_STAGES; // "changed to" target
  if (field === 'source') return AM_ORIGINS;
  if (field === 'next_action') return AM_NEXT_ACTIONS;
  if (field === 'been_contacted') return AM_BOOLS;
  if (field === 'priority') return AM_PRIORITIES;
  if (field === 'status') return t.startsWith('task') ? AM_TASK_STATUSES : t.startsWith('request') ? AM_REQUEST_STATUSES : null;
  return null; // free-text (budget, name, car_in_question, title, category, email, phone, …)
}
// The value control for a condition row: a dropdown for enum fields, free text otherwise,
// and nothing for is_empty / not_empty.
function amValueControl(cd, i){
  if (cd.op === 'is_empty' || cd.op === 'not_empty') return '';
  const opts = amFieldOptions(cd.field);
  if (opts) {
    const cur = amNorm(cd.value);
    return `<select class="form-input" style="flex:1;padding:6px 8px;font-size:12px" onchange="_autoDraft.conditions[${i}].value=this.value">
      <option value="">— value —</option>
      ${opts.map(([k, l]) => `<option value="${esc(k)}"${amNorm(k) === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}
    </select>`;
  }
  return `<input class="form-input" style="flex:1;padding:6px 8px;font-size:12px" value="${esc(cd.value || '')}" placeholder="value" oninput="_autoDraft.conditions[${i}].value=this.value">`;
}

async function loadAutomations() {
  const c = document.getElementById('automations-list');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  try {
    await preloadEmployeesForTasks();
    const r = await apiFetch('/api/dashboard/automations');
    const rules = await r.json();
    if (!r.ok) throw new Error(rules.error || 'Failed');
    _autoRules = Array.isArray(rules) ? rules : [];
    renderAutomations(_autoRules);
  } catch (e) { c.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; }
  requestAnimationFrame(() => lucide.createIcons());
}
function renderAutomations(rules) {
  const c = document.getElementById('automations-list');
  if (!rules.length) {
    c.innerHTML = `<div style="text-align:center;padding:60px 0;color:var(--muted)">
      <div style="margin-bottom:10px;display:flex;justify-content:center"><i data-lucide="zap" style="width:38px;height:38px"></i></div>
      <div style="font-size:15px;font-weight:600">No automations yet</div>
      <div style="font-size:13px;margin-top:6px">Create one to route leads, schedule follow-ups, or send reminders automatically.</div></div>`;
    return;
  }
  c.innerHTML = rules.map(r => `
    <div class="card" style="display:flex;align-items:center;gap:14px;padding:14px 18px;margin-bottom:10px">
      <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleAutomation(${r.id}, this.checked)" title="${r.enabled ? 'Enabled' : 'Disabled'}" style="accent-color:var(--gold);flex:none;cursor:pointer">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px">${esc(r.name)}${r.enabled ? '' : ' <span style="font-size:11px;color:var(--muted);font-weight:400">(off)</span>'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          <span style="color:var(--primary)">${esc(AM_TRIGGER_LABELS[r.trigger_type] || r.trigger_type)}</span>${(r.conditions && r.conditions.length) ? ` · ${r.conditions.length} condition${r.conditions.length > 1 ? 's' : ''}` : ''} · ${(r.actions || []).length} action${(r.actions || []).length === 1 ? '' : 's'}${(r.actions || []).length ? ` (${(r.actions || []).map(a => amActionLabel(a.type)).join(', ')})` : ''}
        </div>
      </div>
      <button class="btn btn-outline" style="font-size:12px;padding:4px 10px" onclick="openAutomationModal(${r.id})">Edit</button>
      <button class="btn btn-outline" style="font-size:12px;padding:4px 10px;color:var(--danger);border-color:var(--danger)" onclick="deleteAutomation(${r.id})">Delete</button>
    </div>`).join('');
}
function openAutomationModal(id) {
  const rule = id ? _autoRules.find(r => r.id === id) : null;
  document.getElementById('automation-modal-title').textContent = rule ? 'Edit Automation' : 'New Automation';
  document.getElementById('am-id').value = rule?.id || '';
  document.getElementById('am-name').value = rule?.name || '';
  document.getElementById('am-trigger').value = rule?.trigger_type || 'lead.created';
  document.getElementById('am-days').value = rule?.trigger_config?.days || 3;
  document.getElementById('am-enabled').checked = rule?.enabled || false;
  _autoDraft = { conditions: JSON.parse(JSON.stringify(rule?.conditions || [])), actions: JSON.parse(JSON.stringify(rule?.actions || [])) };
  amTriggerChanged();
  amRenderConditions();
  amRenderActions();
  document.getElementById('automation-modal').style.display = 'flex';
}
function amTriggerChanged() {
  document.getElementById('am-days-wrap').style.display = document.getElementById('am-trigger').value === 'no_activity_days' ? 'block' : 'none';
  amRenderConditions(); // field list depends on the trigger
  amRenderActions();    // refresh the lead-scoped-action hint for the new trigger
}
function amAddCondition() { _autoDraft.conditions.push({ field: 'source', op: 'equals', value: '' }); amRenderConditions(); }
function amDelCondition(i) { _autoDraft.conditions.splice(i, 1); amRenderConditions(); }
function amRenderConditions() {
  document.getElementById('am-conditions').innerHTML = _autoDraft.conditions.map((cd, i) => `
    <div style="display:flex;gap:6px;align-items:center">
      <select class="form-input" style="flex:1;padding:6px 8px;font-size:12px" onchange="_autoDraft.conditions[${i}].field=this.value;_autoDraft.conditions[${i}].value='';amRenderConditions()">
        ${amFieldsForTrigger().map(f => `<option value="${f}"${cd.field === f ? ' selected' : ''}>${f}</option>`).join('')}
      </select>
      <select class="form-input" style="flex:1;padding:6px 8px;font-size:12px" onchange="_autoDraft.conditions[${i}].op=this.value;amRenderConditions()">
        ${AM_OPS.map(o => `<option value="${o[0]}"${cd.op === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}
      </select>
      ${amValueControl(cd, i)}
      <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger)" onclick="amDelCondition(${i})">×</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--muted)">No conditions — runs every time.</div>';
}
function amAddAction() { _autoDraft.actions.push({ type: 'notify', to: 'admin', title: '', body: '' }); amRenderActions(); }
function amDelAction(i) { _autoDraft.actions.splice(i, 1); amRenderActions(); }
function amChangeActionType(i, type) {
  const base = { type };
  if (type === 'notify') Object.assign(base, { to: 'admin', title: '', body: '' });
  if (type === 'notify_all') Object.assign(base, { title: '', body: '' });
  if (type === 'create_followup') Object.assign(base, { days: 1, note: '', assign_to: 'none' });
  if (type === 'create_task') Object.assign(base, { title: '', priority: 'medium', due_days: 1 });
  if (type === 'create_deal') Object.assign(base, { stage: 'lead' });
  if (type === 'set_lead_status') Object.assign(base, { status: 'warm' });
  if (type === 'assign_lead') Object.assign(base, { mode: 'round_robin' });
  if (type === 'edit_lead') Object.assign(base, { updates: [] });
  // delete_deals / delete_lead take no params
  _autoDraft.actions[i] = base;
  amRenderActions();
}
// "Edit the lead profile" — repeatable field/value rows (value control chosen per field)
function amAddEditField(i) { (_autoDraft.actions[i].updates = _autoDraft.actions[i].updates || []).push({ field: 'lead_status', value: '' }); amRenderActions(); }
function amDelEditField(i, j) { _autoDraft.actions[i].updates.splice(j, 1); amRenderActions(); }
function amEditValueControl(u, i, j) {
  const setter = `_autoDraft.actions[${i}].updates[${j}].value`;
  if (u.field === 'assigned_to') return `<select class="form-input" style="flex:1;padding:6px 8px;font-size:12px" onchange="${setter}=this.value">${amEmpOptions(u.value)}</select>`;
  const opts = amFieldOptions(u.field);
  if (opts) {
    const cur = amNorm(u.value);
    return `<select class="form-input" style="flex:1;padding:6px 8px;font-size:12px" onchange="${setter}=this.value">
      <option value="">— value —</option>
      ${opts.map(([k, l]) => `<option value="${esc(k)}"${amNorm(k) === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}
    </select>`;
  }
  return `<input class="form-input" style="flex:1;padding:6px 8px;font-size:12px" value="${esc(u.value || '')}" placeholder="value" oninput="${setter}=this.value">`;
}
function amActionParams(a, i) {
  const inp = (ph, key, val, type) => `<input class="form-input" ${type ? `type="${type}"` : ''} style="padding:6px 8px;font-size:12px" placeholder="${ph}" value="${esc(String(val != null ? val : ''))}" oninput="_autoDraft.actions[${i}].${key}=this.value">`;
  if (a.type === 'notify') return `
    <select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].to=this.value;amRenderActions()">
      <option value="admin"${a.to === 'admin' ? ' selected' : ''}>Notify admin</option>
      <option value="owner"${a.to === 'owner' ? ' selected' : ''}>Notify lead owner</option>
      <option value="employee"${a.to === 'employee' ? ' selected' : ''}>Notify specific rep</option>
    </select>
    ${a.to === 'employee' ? `<select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].employee_id=this.value">${amEmpOptions(a.employee_id)}</select>` : ''}
    ${inp('Title (use {{name}}, {{phone}})', 'title', a.title)}
    ${inp('Message body', 'body', a.body)}`;
  if (a.type === 'notify_all') return `
    <div style="font-size:11px;color:var(--muted)"><i data-lucide="megaphone" style="width:11px;height:11px;display:inline-block;vertical-align:-1px"></i> Sends this notification to every employee.</div>
    ${inp('Title', 'title', a.title)}
    ${inp('Message body', 'body', a.body)}`;
  if (a.type === 'create_followup') return `
    ${inp('in N days', 'days', a.days != null ? a.days : 1, 'number')}
    ${inp('Note', 'note', a.note)}
    <select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].assign_to=this.value;amRenderActions()">
      <option value="none"${(a.assign_to || 'none') === 'none' ? ' selected' : ''}>Assign to: admin</option>
      <option value="owner"${a.assign_to === 'owner' ? ' selected' : ''}>Assign to: lead owner</option>
      <option value="employee"${a.assign_to === 'employee' ? ' selected' : ''}>Assign to: specific rep</option>
    </select>
    ${a.assign_to === 'employee' ? `<select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].employee_id=this.value">${amEmpOptions(a.employee_id)}</select>` : ''}`;
  if (a.type === 'create_task') return `
    ${inp('Task title', 'title', a.title)}
    <select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].priority=this.value">
      ${['high','medium','low'].map(p => `<option value="${p}"${(a.priority || 'medium') === p ? ' selected' : ''}>${p}</option>`).join('')}
    </select>
    ${inp('due in N days', 'due_days', a.due_days != null ? a.due_days : 1, 'number')}
    <select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].assignee_id=this.value">${amEmpOptions(a.assignee_id)}</select>`;
  if (a.type === 'create_deal') return `
    <select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].stage=this.value">
      ${['lead','inquiry','quoted','negotiating'].map(s => `<option value="${s}"${(a.stage || 'lead') === s ? ' selected' : ''}>${s}</option>`).join('')}
    </select>`;
  if (a.type === 'set_lead_status') return `
    <select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].status=this.value">
      ${AM_LEAD_STATUSES.map(s => `<option value="${s[0]}"${a.status === s[0] ? ' selected' : ''}>${s[1]}</option>`).join('')}
    </select>`;
  if (a.type === 'assign_lead') return `
    <select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].mode=this.value;amRenderActions()">
      <option value="round_robin"${(a.mode || 'round_robin') === 'round_robin' ? ' selected' : ''}>Round-robin</option>
      <option value="specific"${a.mode === 'specific' ? ' selected' : ''}>Specific rep</option>
    </select>
    ${a.mode === 'specific' ? `<select class="form-input" style="padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].employee_id=this.value">${amEmpOptions(a.employee_id)}</select>` : ''}`;
  if (a.type === 'edit_lead') {
    const ups = Array.isArray(a.updates) ? a.updates : [];
    const rows = ups.map((u, j) => `
      <div style="display:flex;gap:6px;align-items:center">
        <select class="form-input" style="flex:1;padding:6px 8px;font-size:12px" onchange="_autoDraft.actions[${i}].updates[${j}].field=this.value;_autoDraft.actions[${i}].updates[${j}].value='';amRenderActions()">
          ${AM_EDIT_FIELDS.map(f => `<option value="${f[0]}"${u.field === f[0] ? ' selected' : ''}>${f[1]}</option>`).join('')}
        </select>
        ${amEditValueControl(u, i, j)}
        <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger)" onclick="amDelEditField(${i},${j})">×</button>
      </div>`).join('');
    return `${rows || '<div style="font-size:12px;color:var(--muted)">No changes yet — add a field to set.</div>'}
      <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;justify-self:start" onclick="amAddEditField(${i})">+ Set a field</button>`;
  }
  if (a.type === 'delete_deals') return `<div style="font-size:11px;color:var(--muted)"><i data-lucide="shield-check" style="width:11px;height:11px;display:inline-block;vertical-align:-1px"></i> Sends a request to remove the lead's deals — an admin approves before anything is deleted.</div>`;
  if (a.type === 'delete_lead') return `<div style="font-size:11px;color:var(--muted)"><i data-lucide="shield-check" style="width:11px;height:11px;display:inline-block;vertical-align:-1px"></i> Sends a deletion request — an admin approves before the lead is deleted.</div>`;
  return '';
}
function amRenderActions() {
  const trig = document.getElementById('am-trigger')?.value || '';
  // Lead-scoped actions only run when the event is tied to a lead. Lead/deal triggers always are;
  // quote & website-submission may be; task/request/hours triggers never are.
  const leadLinked = trig.startsWith('lead.') || trig.startsWith('deal.') || trig === 'no_activity_days';
  const maybeLinked = trig === 'quote.generated' || trig === 'submission.created';
  document.getElementById('am-actions').innerHTML = _autoDraft.actions.map((a, i) => {
    const isLeadAction = AM_LEAD_SCOPED_ACTIONS.includes(a.type);
    let hint = '';
    if (isLeadAction && !leadLinked) {
      hint = maybeLinked
        ? `<div style="font-size:11px;color:var(--muted)"><i data-lucide="info" style="width:11px;height:11px;display:inline-block;vertical-align:-1px"></i> Runs only when this is linked to a lead.</div>`
        : `<div style="font-size:11px;color:var(--warning,#e0a800)"><i data-lucide="alert-triangle" style="width:11px;height:11px;display:inline-block;vertical-align:-1px"></i> This action needs a lead — it won't do anything for this trigger. Use “Send a notification”, “Notify all employees” or “Create a task” instead.</div>`;
    }
    return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:10px;display:grid;gap:6px">
      <div style="display:flex;gap:6px;align-items:center">
        <select class="form-input" style="flex:1;padding:6px 8px;font-size:12px" onchange="amChangeActionType(${i}, this.value)">
          ${AM_ACTIONS.map(t => `<option value="${t[0]}"${a.type === t[0] ? ' selected' : ''}>${t[1]}</option>`).join('')}
        </select>
        <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger)" onclick="amDelAction(${i})">×</button>
      </div>
      <div style="display:grid;gap:6px">${amActionParams(a, i)}</div>
      ${hint}
    </div>`;
  }).join('') || '<div style="font-size:12px;color:var(--muted)">Add at least one action.</div>';
  requestAnimationFrame(() => lucide.createIcons());
}
async function saveAutomation() {
  const id = document.getElementById('am-id').value;
  const name = document.getElementById('am-name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  if (!_autoDraft.actions.length) { alert('Add at least one action.'); return; }
  const trigger_type = document.getElementById('am-trigger').value;
  const trigger_config = trigger_type === 'no_activity_days' ? { days: parseInt(document.getElementById('am-days').value) || 3 } : {};
  const actions = _autoDraft.actions.map(a => {
    const o = { ...a };
    if (o.days != null) o.days = parseInt(o.days) || 0;
    if (o.due_days != null) o.due_days = parseInt(o.due_days) || 0;
    return o;
  });
  const payload = { name, trigger_type, trigger_config, conditions: _autoDraft.conditions, actions, enabled: document.getElementById('am-enabled').checked };
  try {
    const url = id ? `/api/dashboard/automations/${id}` : '/api/dashboard/automations';
    const r = await apiFetch(url, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert('Error: ' + (e.error || r.status)); return; }
    document.getElementById('automation-modal').style.display = 'none';
    await loadAutomations();
  } catch (e) { alert('Error: ' + e.message); }
}
async function toggleAutomation(id, enabled) {
  try { await apiFetch(`/api/dashboard/automations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }); }
  catch (e) { alert('Error: ' + e.message); }
  const r = _autoRules.find(x => x.id === id); if (r) r.enabled = enabled;
}
async function deleteAutomation(id) {
  if (!confirm('Delete this automation?')) return;
  try { await apiFetch(`/api/dashboard/automations/${id}`, { method: 'DELETE' }); await loadAutomations(); }
  catch (e) { alert('Error: ' + e.message); }
}

// ── Table ────────────────────────────────────────────────────────────────────
function populateChannelFilter(tasks) {
  const sel = document.getElementById('f-channel');
  const cur = sel.value;
  const channels = [...new Set(tasks.map(t => t.channel_name))].sort();
  sel.innerHTML = '<option value="">All Channels</option>';
  channels.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === cur) o.selected = true;
    sel.appendChild(o);
  });
}

function filterTasks() {
  const search   = document.getElementById('search').value.toLowerCase();
  const status   = document.getElementById('f-status').value;
  const priority = document.getElementById('f-priority').value;
  const channel  = document.getElementById('f-channel').value;

  const filtered = allTasks.filter(t => {
    if (status   && t.status       !== status)   return false;
    if (priority && t.priority     !== priority) return false;
    if (channel  && t.channel_name !== channel)  return false;
    if (search && !t.title.toLowerCase().includes(search)
               && !(t.description || '').toLowerCase().includes(search)) return false;
    return true;
  });

  renderTable(filtered);
}

function renderTable(tasks) {
  const container = document.getElementById('table-container');

  if (!tasks.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" style="font-size:44px">—</div>
        <div class="empty-title">No tasks found</div>
        <div class="empty-sub">Adjust the filters or click "+ Add Task" to create one</div>
      </div>`;
    document.getElementById('table-count').textContent = '0 tasks';
    return;
  }

  const rows = tasks.map(t => {
    const overdue = isOverdue(t.due_date, t.status);
    const soon    = !overdue && isDueSoon(t.due_date, t.status);
    const dueCls  = overdue ? 'overdue' : (soon ? 'due-soon' : '');
    const dueLabel = overdue ? `${t.due_date}` : t.due_date;
    const createdDate = new Date(t.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    const isDone = t.status === 'done';
    return `<tr id="row-${t.id}">
      <td style="width:32px"><input type="checkbox" class="row-cb task-cb" data-id="${t.id}" onchange="onRowCheck()"></td>
      <td class="task-id">#${t.id}</td>
      <td>
        <div class="task-title">${esc(t.title)}</div>
        ${t.description ? `<div class="task-desc" title="${esc(t.description)}">${esc(t.description)}</div>` : ''}
      </td>
      <td class="channel-tag">${esc(t.channel_name)}</td>
      <td class="assignee-id">${resolvedNames(t)}</td>
      <td class="due-date ${dueCls}">${dueLabel}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${t.milestone ? `<span class="milestone-tag">${esc(t.milestone)}</span>` : `<span style="color:var(--muted)">—</span>`}</td>
      <td style="font-size:12px;color:var(--muted);white-space:nowrap">${createdDate}</td>
      <td style="font-size:12px;white-space:nowrap">${t.completed_at ? `<span style="color:var(--success)">${new Date(t.completed_at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}</span>` : `<span style="color:var(--muted)">—</span>`}</td>
      <td style="white-space:nowrap">
        ${isDone ? '' : `<button class="btn btn-success" style="padding:4px 10px;font-size:11px" onclick="quickDone(${t.id})">Done</button> `}
        <button class="btn btn-outline" style="padding:4px 10px;font-size:11px" onclick="openTaskModal(${t.id})">Edit</button>
        <button class="btn btn-outline" style="padding:4px 10px;font-size:11px;margin-left:4px" onclick="openTaskComments(${t.id})" title="Comments"><i data-lucide="message-square" style="width:13px;height:13px"></i></button>
        <button class="btn btn-danger"  style="padding:4px 10px;font-size:11px;margin-left:4px" onclick="deleteTask(${t.id})">Delete</button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th style="width:32px"><input type="checkbox" class="row-cb" id="cb-all" onchange="toggleSelectAll(this)"></th>
            <th>ID</th>
            <th>Title</th>
            <th>Channel</th>
            <th>Assignee</th>
            <th>Due Date</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Milestone</th>
            <th>Created</th>
            <th>Completed</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('table-count').textContent =
    `Showing ${tasks.length} of ${allTasks.length} task${allTasks.length !== 1 ? 's' : ''}`;
}

// ── Load Dashboard ───────────────────────────────────────────────────────────
async function loadDashboard() {
  document.getElementById('error-container').innerHTML = '';

  const dot = document.getElementById('refresh-dot');
  dot.classList.remove('pulse');
  void dot.offsetWidth; // reflow to restart animation
  dot.classList.add('pulse');

  try {
    const [stats, tasks] = await Promise.all([fetchStats(), fetchTasks(), preloadEmployeesForTasks()]);

    renderStats(stats);
    renderCharts(stats);

    allTasks = tasks;
    populateChannelFilter(tasks);
    filterTasks();

    document.getElementById('last-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    startCountdown();
    requestAnimationFrame(() => lucide.createIcons());
  } catch (err) {
    document.getElementById('error-container').innerHTML =
      `<div class="error-msg">${esc(err.message)}</div>`;
  }
}

function startCountdown() {
  if (refreshTimer) clearInterval(refreshTimer);
  countdown = 60;
  const el = document.getElementById('refresh-countdown');
  el.textContent = `Auto-refresh in ${countdown}s`;
  refreshTimer = setInterval(() => {
    countdown--;
    el.textContent = `Auto-refresh in ${countdown}s`;
    if (countdown <= 0) { clearInterval(refreshTimer); loadDashboard(); }
  }, 1000);
}

// ── Selection & bulk actions ──────────────────────────────────────────────────
function getSelectedIds() {
  return [...document.querySelectorAll('.task-cb:checked')].map(cb => parseInt(cb.dataset.id));
}

function onRowCheck() {
  const ids  = getSelectedIds();
  const all  = document.querySelectorAll('.task-cb');
  const bar  = document.getElementById('bulk-bar');
  const cbAll = document.getElementById('cb-all');
  document.getElementById('bulk-count').textContent = `${ids.length} selected`;
  bar.classList.toggle('visible', ids.length > 0);
  if (cbAll) cbAll.indeterminate = ids.length > 0 && ids.length < all.length;
  if (cbAll) cbAll.checked = ids.length === all.length && all.length > 0;
}

function toggleSelectAll(cb) {
  document.querySelectorAll('.task-cb').forEach(el => { el.checked = cb.checked; });
  onRowCheck();
}

function clearSelection() {
  document.querySelectorAll('.task-cb, #cb-all').forEach(el => { el.checked = false; el.indeterminate = false; });
  document.getElementById('bulk-bar').classList.remove('visible');
}

async function quickDone(id) {
  await apiFetch(`/api/dashboard/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'done' }) });
  loadDashboard();
}

async function bulkMarkDone() {
  const ids = getSelectedIds();
  if (!ids.length) return;
  await Promise.all(ids.map(id => apiFetch(`/api/dashboard/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'done' }) })));
  clearSelection();
  loadDashboard();
}

async function bulkDelete() {
  const ids = getSelectedIds();
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected task(s)? This cannot be undone.`)) return;
  await Promise.all(ids.map(id => apiFetch(`/api/dashboard/tasks/${id}`, { method: 'DELETE' })));
  clearSelection();
  loadDashboard();
}

// ── Assignee name resolver (employees only — Slack removed) ───────────────────
let employeesForTasks = null;
async function preloadEmployeesForTasks() {
  if (employeesForTasks) return;
  try { employeesForTasks = await apiFetch('/api/dashboard/employees-for-tasks').then(r => r.json()); } catch (_) { employeesForTasks = []; }
}
function resolvedName(id) {
  const empById = (employeesForTasks || []).find(e => String(e.id) === String(id));
  if (empById) {
    const initials = (empById.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `<span class="assignee-chip"><span class="assignee-avatar">${initials}</span>${esc(empById.name)}</span>`;
  }
  return `<span class="assignee-id">${esc(id)}</span>`;
}
// Render every assignee of a task (multi-assignee aware)
function resolvedNames(t) {
  const list = Array.isArray(t.assignee_ids) && t.assignee_ids.length ? t.assignee_ids : (t.assignee_id ? [t.assignee_id] : []);
  return [...new Set(list.map(String))].map(resolvedName).join(' ');
}

// ── Task CRUD modals ──────────────────────────────────────────────────────────
async function openTaskModal(id) {
  await preloadEmployeesForTasks();
  const t = id ? allTasks.find(x => x.id === id) : null;
  const current = new Set((Array.isArray(t?.assignee_ids) && t.assignee_ids.length ? t.assignee_ids : (t?.assignee_id ? [t.assignee_id] : [])).map(String));
  const assigneeChecks = (employeesForTasks || []).map(e => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='none'">
      <input type="checkbox" class="t-assignee-cb" value="${e.id}" ${current.has(String(e.id)) ? 'checked' : ''} style="accent-color:var(--gold)"> ${esc(e.name)}
    </label>`).join('');
  showModal(t ? `Edit Task #${t.id}` : 'Add New Task', `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-control" id="t-title" value="${esc(t?.title||'')}" placeholder="Task title…"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-control" id="t-desc" rows="2">${esc(t?.description||'')}</textarea></div>
    <div class="form-group"><label class="form-label">Assignees * <span style="color:var(--muted);font-size:11px">(select one or more)</span></label>
      <div id="t-assignees" style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px">${assigneeChecks || '<div style="padding:8px;color:var(--muted);font-size:12px">No employees yet</div>'}</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Due Date *</label><input class="form-control" id="t-due" type="date" value="${t?.due_date||''}"></div>
      <div class="form-group"><label class="form-label">Priority</label>
        <select class="form-control" id="t-priority">${['high','medium','low'].map(p=>`<option value="${p}"${(t?.priority||'medium')===p?' selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Status</label>
        <select class="form-control" id="t-status">${[['todo','To Do'],['in_progress','In Progress'],['done','Done']].map(([v,l])=>`<option value="${v}"${(t?.status||'todo')===v?' selected':''}>${l}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Milestone</label><input class="form-control" id="t-milestone" value="${esc(t?.milestone||'')}" placeholder="e.g. Sprint 3…"></div>
    </div>
  `, `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTask(${id||'null'})">Save</button>`);
}

async function saveTask(id) {
  const assignee_ids = [...document.querySelectorAll('.t-assignee-cb:checked')].map(cb => cb.value);
  const body = { title: document.getElementById('t-title').value.trim(), description: document.getElementById('t-desc').value.trim(), assignee_ids, due_date: document.getElementById('t-due').value, priority: document.getElementById('t-priority').value, status: document.getElementById('t-status').value, milestone: document.getElementById('t-milestone').value.trim() };
  if (!body.title || !assignee_ids.length || !body.due_date) { alert('Title, at least one assignee, and due date are required'); return; }
  const url = id ? `/api/dashboard/tasks/${id}` : '/api/dashboard/tasks';
  const method = id ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json(); alert('Error: ' + e.error); return; }
  hideModal(); loadDashboard();
}

async function deleteTask(id) {
  if (!confirm(`Delete task #${id}? This cannot be undone.`)) return;
  await apiFetch(`/api/dashboard/tasks/${id}`, { method: 'DELETE' });
  loadDashboard();
}

// ── Recurring tasks (templates that auto-generate tasks) ──────────────────────
const RT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let _recurringCache = [];

async function openRecurringTasksModal() {
  await preloadEmployeesForTasks();
  showModal('Recurring Tasks', '<div id="rt-body"><div class="loading"><div class="spinner"></div></div></div>',
    `<button class="btn btn-outline" onclick="hideModal()">Close</button>
     <button class="btn btn-primary" onclick="openRecurringForm(null)">+ New recurring task</button>`);
  await renderRecurringList();
}

async function renderRecurringList() {
  const body = document.getElementById('rt-body');
  if (!body) return;
  let list;
  try { list = await apiFetch('/api/dashboard/recurring-tasks').then(r => r.json()); }
  catch (e) { body.innerHTML = `<div style="color:var(--danger)">${esc(e.message)}</div>`; return; }
  _recurringCache = Array.isArray(list) ? list : [];
  if (!_recurringCache.length) {
    body.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center;font-size:13px">No recurring tasks yet.<br>Click "+ New recurring task" to set one up.</div>';
    return;
  }
  body.innerHTML = `<div style="display:grid;gap:10px">${_recurringCache.map(rtCardHtml).join('')}</div>`;
  if (window.lucide) lucide.createIcons();
}

function rtScheduleLabel(rt) {
  if (rt.recurrence_type === 'weekly') {
    const wd = (rt.weekdays || []).map(d => RT_WEEKDAYS[d]).filter(Boolean).join(', ');
    return `Weekly · ${wd || '—'}`;
  }
  return `Every ${rt.interval_days} day${rt.interval_days === 1 ? '' : 's'}`;
}
function rtAssigneeNames(rt) {
  const ids = (Array.isArray(rt.assignee_ids) && rt.assignee_ids.length ? rt.assignee_ids : (rt.assignee_id ? [rt.assignee_id] : [])).map(String);
  return ids.map(id => { const e = (employeesForTasks || []).find(x => String(x.id) === id); return e ? e.name : id; }).join(', ') || '—';
}
function rtCardHtml(rt) {
  return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
    <div style="min-width:180px;flex:1">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">${esc(rt.title)} ${rt.active ? '' : '<span style="color:var(--muted);font-size:11px">· paused</span>'}</div>
      <div style="font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:10px">
        <span><i data-lucide="repeat" style="width:11px;height:11px;vertical-align:-1px"></i> ${esc(rtScheduleLabel(rt))}</span>
        <span><i data-lucide="user" style="width:11px;height:11px;vertical-align:-1px"></i> ${esc(rtAssigneeNames(rt))}</span>
        <span><i data-lucide="flag" style="width:11px;height:11px;vertical-align:-1px"></i> ${esc(rt.priority)}</span>
        ${rt.active && rt.next_run_date ? `<span><i data-lucide="calendar" style="width:11px;height:11px;vertical-align:-1px"></i> Next: ${esc(rt.next_run_date)}</span>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap">
      <button class="btn btn-outline" style="padding:3px 8px;font-size:11px" onclick="rtRunNow(${rt.id})" title="Create a task from this now">Run now</button>
      <button class="btn btn-outline" style="padding:3px 8px;font-size:11px" onclick="rtToggle(${rt.id}, ${rt.active ? 'false' : 'true'})">${rt.active ? 'Pause' : 'Resume'}</button>
      <button class="btn btn-outline" style="padding:3px 8px;font-size:11px" onclick="openRecurringForm(${rt.id})">Edit</button>
      <button class="btn btn-outline" style="padding:3px 8px;font-size:11px;color:var(--danger)" onclick="rtDelete(${rt.id})">Delete</button>
    </div>
  </div>`;
}

function openRecurringForm(id) {
  const rt = id ? _recurringCache.find(x => x.id === id) : null;
  const current = new Set((Array.isArray(rt?.assignee_ids) && rt.assignee_ids.length ? rt.assignee_ids : (rt?.assignee_id ? [rt.assignee_id] : [])).map(String));
  const assigneeChecks = (employeesForTasks || []).map(e => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:13px">
      <input type="checkbox" class="rt-assignee-cb" value="${e.id}" ${current.has(String(e.id)) ? 'checked' : ''} style="accent-color:var(--gold)"> ${esc(e.name)}
    </label>`).join('');
  const type = rt?.recurrence_type || 'interval';
  const wd = new Set((rt?.weekdays || []).map(Number));
  const weekdayBtns = RT_WEEKDAYS.map((l, i) => `
    <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;border:1px solid var(--border);border-radius:6px;padding:5px 9px;cursor:pointer">
      <input type="checkbox" class="rt-weekday-cb" value="${i}" ${wd.has(i) ? 'checked' : ''} style="accent-color:var(--gold)"> ${l}</label>`).join('');
  showModal(rt ? 'Edit recurring task' : 'New recurring task', `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-control" id="rt-title" value="${esc(rt?.title || '')}" placeholder="e.g. Weekly stock report"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-control" id="rt-desc" rows="2">${esc(rt?.description || '')}</textarea></div>
    <div class="form-group"><label class="form-label">Assignee(s) * <span style="color:var(--muted);font-size:11px">(select one or more)</span></label>
      <div style="max-height:130px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:4px">${assigneeChecks || '<div style="padding:8px;color:var(--muted);font-size:12px">No employees yet</div>'}</div>
    </div>
    <div class="form-group"><label class="form-label">Repeat *</label>
      <select class="form-control" id="rt-type" onchange="rtToggleTypeFields()">
        <option value="interval"${type === 'interval' ? ' selected' : ''}>Every N days</option>
        <option value="weekly"${type === 'weekly' ? ' selected' : ''}>Weekly on specific day(s)</option>
      </select>
    </div>
    <div class="form-group" id="rt-interval-wrap" style="display:${type === 'interval' ? 'block' : 'none'}">
      <label class="form-label">Every how many days?</label>
      <input class="form-control" id="rt-interval-days" type="number" min="1" value="${rt?.interval_days || 7}">
    </div>
    <div class="form-group" id="rt-weekly-wrap" style="display:${type === 'weekly' ? 'block' : 'none'}">
      <label class="form-label">On which day(s)?</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${weekdayBtns}</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Priority</label>
        <select class="form-control" id="rt-priority">${['high', 'medium', 'low'].map(p => `<option value="${p}"${(rt?.priority || 'medium') === p ? ' selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Start date <span style="color:var(--muted);font-size:11px">(optional)</span></label><input class="form-control" id="rt-start" type="date" value="${rt?.start_date || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Due after (days)</label><input class="form-control" id="rt-due-offset" type="number" min="0" value="${rt?.due_offset_days || 0}" title="Each generated task is due this many days after it's created (0 = same day)"></div>
      <div class="form-group"><label class="form-label">Milestone</label><input class="form-control" id="rt-milestone" value="${esc(rt?.milestone || '')}" placeholder="optional"></div>
    </div>
  `, `<button class="btn btn-outline" onclick="openRecurringTasksModal()">← Back</button>
      <button class="btn btn-primary" onclick="saveRecurring(${id || 'null'})">Save</button>`);
}

function rtToggleTypeFields() {
  const t = document.getElementById('rt-type').value;
  document.getElementById('rt-interval-wrap').style.display = t === 'interval' ? 'block' : 'none';
  document.getElementById('rt-weekly-wrap').style.display = t === 'weekly' ? 'block' : 'none';
}

async function saveRecurring(id) {
  const assignee_ids = [...document.querySelectorAll('.rt-assignee-cb:checked')].map(cb => cb.value);
  const type = document.getElementById('rt-type').value;
  const body = {
    title: document.getElementById('rt-title').value.trim(),
    description: document.getElementById('rt-desc').value.trim(),
    assignee_ids,
    recurrence_type: type,
    interval_days: type === 'interval' ? parseInt(document.getElementById('rt-interval-days').value, 10) : null,
    weekdays: type === 'weekly' ? [...document.querySelectorAll('.rt-weekday-cb:checked')].map(cb => Number(cb.value)) : null,
    priority: document.getElementById('rt-priority').value,
    start_date: document.getElementById('rt-start').value || null,
    due_offset_days: parseInt(document.getElementById('rt-due-offset').value, 10) || 0,
    milestone: document.getElementById('rt-milestone').value.trim(),
  };
  if (!body.title || !assignee_ids.length) { alert('Title and at least one assignee are required'); return; }
  if (type === 'interval' && (!body.interval_days || body.interval_days < 1)) { alert('Enter a valid number of days (1 or more)'); return; }
  if (type === 'weekly' && !body.weekdays.length) { alert('Pick at least one weekday'); return; }
  const url = id ? `/api/dashboard/recurring-tasks/${id}` : '/api/dashboard/recurring-tasks';
  const r = await apiFetch(url, { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); alert('Error: ' + (e.error || r.status)); return; }
  openRecurringTasksModal();
}

async function rtRunNow(id) {
  const r = await apiFetch(`/api/dashboard/recurring-tasks/${id}/run-now`, { method: 'POST' });
  if (!r.ok) { const e = await r.json().catch(() => ({})); alert('Error: ' + (e.error || r.status)); return; }
  alert('Task created and assigned.');
  if (typeof loadDashboard === 'function') loadDashboard();
  renderRecurringList();
}

async function rtToggle(id, active) {
  await apiFetch(`/api/dashboard/recurring-tasks/${id}`, { method: 'PUT', body: JSON.stringify({ active }) });
  renderRecurringList();
}

async function rtDelete(id) {
  if (!confirm('Delete this recurring task? Tasks already generated from it will remain.')) return;
  await apiFetch(`/api/dashboard/recurring-tasks/${id}`, { method: 'DELETE' });
  renderRecurringList();
}

// ── Task comments (with @mentions) ────────────────────────────────────────────
let _commentsTaskId = null;
async function openTaskComments(id) {
  _commentsTaskId = id;
  _cmtPendingFile = null;
  await preloadEmployeesForTasks();
  const t = allTasks.find(x => x.id === id);
  showModal(`Comments — ${t ? t.title : '#' + id}`, `
    <div id="tc-list" style="max-height:300px;overflow-y:auto;display:grid;gap:10px;padding:2px"><div class="loading"><div class="spinner"></div></div></div>
    <div id="cmt-attach-preview" style="display:none;margin:12px 0 0" class="chat-attach-preview"><span><i data-lucide="paperclip" style="width:14px;height:14px"></i></span><span class="chat-attach-preview-name" id="cmt-attach-name"></span><button class="chat-attach-remove" onclick="cmtRemoveAttach()" title="Remove">×</button></div>
    <div style="margin-top:12px;position:relative">
      <div id="tc-mention-box" class="lead-menu" style="position:absolute;bottom:100%;left:0;margin-bottom:4px;max-height:180px"></div>
      <div class="comment-composer">
        <textarea id="tc-input" rows="2" placeholder="Write a comment…  @name to mention someone" oninput="tcMentionHint(this)"></textarea>
        <div class="comment-composer-bar">
          <input type="file" id="cmt-file-input" style="display:none" onchange="cmtFileSelected(this)">
          <button class="composer-icon-btn" onclick="document.getElementById('cmt-file-input').click()" title="Attach a file"><i data-lucide="paperclip" style="width:15px;height:15px"></i></button>
        </div>
      </div>
    </div>`,
    `<button class="btn btn-outline" onclick="hideModal()">Close</button>
     <button class="btn btn-primary" onclick="postTaskCommentUi()">Comment</button>`);
  loadTaskComments();
}
async function loadTaskComments() {
  const rows = await apiFetch(`/api/dashboard/tasks/${_commentsTaskId}/comments`).then(r => r.json()).catch(() => []);
  const list = document.getElementById('tc-list');
  if (!list) return;
  list.innerHTML = (Array.isArray(rows) && rows.length) ? rows.map(c => `
    <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:8px 12px">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);margin-bottom:3px"><strong style="color:var(--text)">${esc(c.author_name || '—')}</strong><span>${new Date(c.created_at).toLocaleString()}</span></div>
      ${c.body ? `<div style="font-size:13px;white-space:pre-wrap;word-break:break-word">${tcRenderBody(c.body)}</div>` : ''}
      ${commentAttachHtml(c)}${googleUnfurl(c.body)}
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px;text-align:center;padding:14px">No comments yet — be the first.</div>';
  list.scrollTop = list.scrollHeight;
}
// ── Comment attachments (file card) + Google-link unfurl (shared by task & request comments) ──
let _cmtPendingFile = null;
async function cmtFileSelected(input) {
  const file = input.files?.[0]; if (!file) return; input.value = '';
  if (file.size > 10 * 1024 * 1024) return alert('File must be under 10 MB');
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await apiFetch('/api/dashboard/chat/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok || d.error) return alert('Upload failed: ' + (d.error || r.status));
    _cmtPendingFile = d;
    document.getElementById('cmt-attach-name').textContent = d.name;
    document.getElementById('cmt-attach-preview').style.display = 'flex';
  } catch (e) { alert('Upload failed: ' + e.message); }
}
function cmtRemoveAttach() { _cmtPendingFile = null; const p = document.getElementById('cmt-attach-preview'); if (p) p.style.display = 'none'; }
function commentAttachHtml(c) {
  if (!c.file_url) return '';
  const u = esc(c.file_url), t = c.file_type || '';
  if (t.startsWith('image/')) return `<img src="${u}" class="chat-img-thumb" onclick="window.open('${u}','_blank')" loading="lazy">`;
  if (t.startsWith('audio/')) return `<div class="chat-voice-msg"><audio controls src="${u}" preload="none"></audio></div>`;
  return `<div class="chat-file-attach"><i data-lucide="paperclip" style="width:13px;height:13px"></i> <a href="${u}" target="_blank" rel="noopener">${esc(c.file_name || 'File')}</a><span style="color:var(--muted);margin-left:auto">${c.file_size ? (c.file_size / 1024 / 1024).toFixed(1) + 'MB' : ''}</span></div>`;
}
function googleUnfurl(text) {
  const matches = String(text || '').match(/https?:\/\/(?:docs|drive)\.google\.com\/[^\s<>"')]+/g) || [];
  const seen = new Set(); let out = '';
  for (const url of matches) { if (seen.has(url)) continue; seen.add(url); out += gLinkCard(url); }
  return out;
}
function gLinkCard(url) {
  let kind = '', id = '', m;
  if ((m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/))) { kind = 'sheet'; id = m[1]; }
  else if ((m = url.match(/document\/d\/([a-zA-Z0-9_-]+)/))) { kind = 'doc'; id = m[1]; }
  else if ((m = url.match(/presentation\/d\/([a-zA-Z0-9_-]+)/))) { kind = 'slides'; id = m[1]; }
  else if ((m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/))) { kind = 'file'; id = m[1]; }
  else if ((m = url.match(/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/))) { kind = 'folder'; id = m[1]; }
  else return '';
  const meta = { sheet:{label:'Google Sheets',color:'#0f9d58',glyph:'table'}, doc:{label:'Google Docs',color:'#4285f4',glyph:'file-text'}, slides:{label:'Google Slides',color:'#f4b400',glyph:'presentation'}, file:{label:'Google Drive file',color:'#5f6368',glyph:'file'}, folder:{label:'Drive folder',color:'#5f6368',glyph:'folder'} }[kind];
  const u = esc(url);
  const thumb = kind !== 'folder' ? `<img class="gcard-thumb" src="https://drive.google.com/thumbnail?id=${esc(id)}&sz=w400" onerror="this.style.display='none'" loading="lazy">` : '';
  return `<a class="gcard" href="${u}" target="_blank" rel="noopener"><span class="gcard-badge" style="background:${meta.color}"><i data-lucide="${meta.glyph}" style="width:14px;height:14px"></i></span><span class="gcard-meta"><span class="gcard-title">${meta.label}</span><span class="gcard-sub">Google · click to open</span></span><span class="gcard-open">Open ↗</span>${thumb}</a>`;
}
function tcRenderBody(b) {
  let h = esc(b || '');
  (employeesForTasks || []).forEach(e => {
    if (e.name) h = h.split('@' + esc(e.name)).join(`<span style="color:var(--gold);font-weight:700">@${esc(e.name)}</span>`);
  });
  return h;
}
function tcMentionHint(ta) {
  const box = document.getElementById('tc-mention-box');
  if (!box) return;
  const m = ta.value.slice(0, ta.selectionStart).match(/@([a-zA-Z ]{0,30})$/);
  if (!m) { box.classList.remove('open'); return; }
  const q = m[1].toLowerCase();
  const hits = (employeesForTasks || []).filter(e => (e.name || '').toLowerCase().startsWith(q)).slice(0, 6);
  if (!hits.length) { box.classList.remove('open'); return; }
  box.innerHTML = hits.map(e => `<button type="button" onclick="tcInsertMention('${esc(e.name)}')">@ ${esc(e.name)}</button>`).join('');
  box.classList.add('open');
}
function tcInsertMention(name) {
  const ta = document.getElementById('tc-input');
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos).replace(/@[a-zA-Z ]{0,30}$/, '@' + name + ' ');
  ta.value = before + ta.value.slice(pos);
  document.getElementById('tc-mention-box')?.classList.remove('open');
  ta.focus();
}
async function postTaskCommentUi() {
  const ta = document.getElementById('tc-input');
  const body = ta.value.trim();
  if (!body && !_cmtPendingFile) return;
  const payload = { body };
  if (_cmtPendingFile) { payload.file_url = _cmtPendingFile.url; payload.file_name = _cmtPendingFile.name; payload.file_size = _cmtPendingFile.size; payload.file_type = _cmtPendingFile.type; }
  const r = await apiFetch(`/api/dashboard/tasks/${_commentsTaskId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return alert('Error: ' + (e.error || r.status)); }
  ta.value = ''; cmtRemoveAttach();
  loadTaskComments();
}

function downloadCSVTemplate() {
  const rows = [
    ['title', 'description', 'assignee_id', 'due_date', 'priority', 'milestone', 'status'],
    ['Fix homepage bug',    'Button not working on mobile',   '3', '2026-04-15', 'high',   'Sprint 1', 'todo'],
    ['Write Q2 report',     'Monthly summary for leadership', '5', '15/04/2026', 'medium', 'Q2',       'in_progress'],
    ['Old task from Jan',   'Completed last quarter',         '3', '15/1/2026',  'low',    'Q1',       'done'],
  ];
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'tasks_template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function openCSVModal() {
  showModal('Bulk Upload Tasks via CSV', `
    <p style="font-size:13px;color:var(--muted);margin-bottom:8px">CSV columns: <code>title, description, assignee_id, due_date, priority, milestone, status</code> — assignee_id is the employee's ID from the Employees page</p>
    <p style="font-size:12px;color:var(--muted);margin-bottom:4px">Use <strong>#channel-name</strong> format. Get assignee IDs from the Employees page.</p>
    <p style="font-size:12px;color:var(--muted);margin-bottom:16px">Dates accept any format: <code>2026-04-15</code>, <code>15/04/2026</code>, <code>15/4/2026</code>. Past dates are allowed.</p>
    <div style="margin-bottom:16px">
      <button class="btn btn-outline" onclick="downloadCSVTemplate()" style="font-size:12px">Download Template</button>
    </div>
    <div class="form-group"><label class="form-label">CSV File *</label><input type="file" id="csv-file" accept=".csv" class="form-control" style="padding:6px"></div>
    <div id="csv-result" style="margin-top:8px"></div>
  `, `<button class="btn btn-outline" onclick="hideModal()">Close</button>
      <button class="btn btn-primary" onclick="uploadCSV()">Upload</button>`);
}

async function uploadCSV() {
  const file = document.getElementById('csv-file').files[0];
  if (!file) { alert('Please select a CSV file'); return; }
  const fd = new FormData(); fd.append('file', file);
  const headers = {}; if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const r = await fetch('/api/dashboard/tasks/bulk', { method: 'POST', headers, body: fd });
  const data = await r.json();
  const res = document.getElementById('csv-result');
  if (data.error) { res.innerHTML = `<div class="error-msg">${esc(data.error)}</div>`; return; }
  res.innerHTML = `<div style="background:#d1fae5;border:1px solid #6ee7b7;color:#065f46;padding:10px 14px;border-radius:8px;font-size:13px">Inserted <strong>${data.inserted}</strong> task(s)${data.errors?.length ? `<br><span style="color:var(--warning)">${data.errors.join('<br>')}</span>` : ''}</div>`;
  loadDashboard();
}

// ── Car Stock (immediate-delivery inventory) ────────────────────────────────────
// Per-unit columns (screenshot 4): what we track for each physical car.
const STOCK_UNIT_COLS = [
  ['consignee', 'Consignee', 120], ['colour', 'Colour EXT / INT', 120], ['vin', 'VIN', 120],
  ['status', 'Status', 120], ['price_list', 'Price List', 120], ['discounted', 'Discounted', 120],
  ['logistics', 'Logistics', 120], ['supplier', 'Supplier', 120],
];
// Inventory's unit rows are a line grid like the PO and RFQ sheets, so they get
// the same engine: rename, reorder, hide, add a field of any type. Unit rows are
// JSONB inside the vehicle, so a new field needs no column.
function stockUnitsEngine() {
  return procColsEngine('stock', tupleCols(STOCK_UNIT_COLS, {
    price_list: 'number', discounted: 'number', status: 'select',
    'options:status': PO_LINE_STATUSES.map(o => ({ key: o.key, label: o.label, color: o.fg })),
  }), () => renderStock());
}
function stockUnitCols() {
  const eng = CE('stock');
  return eng && eng.loaded ? eng.visible() : tupleCols(STOCK_UNIT_COLS, {});
}
let _stockCache = [];
async function loadStock() {
  await stockUnitsEngine().load();
  const body = document.getElementById('stock-table-container');
  if (body) body.innerHTML = '<div class="loading"><div class="spinner"></div> Loading stock…</div>';
  let list = [];
  try { list = await apiFetch('/api/dashboard/stock').then(r => r.json()); }
  catch (_) { if (body) body.innerHTML = '<div class="error-msg">Failed to load stock.</div>'; return; }
  _stockCache = Array.isArray(list) ? list : [];
  renderStock();
}
function renderStock() {
  const body = document.getElementById('stock-table-container');
  const sumEl = document.getElementById('stock-summary');
  if (!body) return;
  const models = new Set(_stockCache.map(v => `${(v.make||'').toLowerCase()}|${(v.model||'').toLowerCase()}`));
  const totalUnits = _stockCache.reduce((s, v) => s + (Number(v.quantity) || 0), 0);
  const totalValue = _stockCache.reduce((s, v) => s + (Number(v.price) || 0) * (Number(v.quantity) || 0), 0);
  if (sumEl) sumEl.innerHTML = `
    <div class="stat-card total"><div class="stat-label">Listings</div><div class="stat-value">${_stockCache.length.toLocaleString()}</div><div class="stat-sub">${models.size} model(s)</div></div>
    <div class="stat-card high-pri"><div class="stat-label">Units in stock</div><div class="stat-value">${totalUnits.toLocaleString()}</div><div class="stat-sub">Ready for delivery</div></div>
    <div class="stat-card in-progress"><div class="stat-label">Stock value</div><div class="stat-value" style="font-size:20px">${egp(totalValue)}</div><div class="stat-sub">Price × quantity</div></div>`;
  const term = (document.getElementById('stock-search')?.value || '').trim().toLowerCase();
  const rows = _stockCache.filter(v => !term || `${v.make} ${v.model} ${v.trim}`.toLowerCase().includes(term));
  if (!rows.length) {
    body.innerHTML = `<div style="color:var(--muted);padding:24px;text-align:center;font-size:13px">${_stockCache.length ? 'No vehicles match your search.' : 'No vehicles in stock yet.<br>Click “Add vehicle” or “Bulk upload CSV” to get started.'}</div>`;
    return;
  }
  body.innerHTML = `<div class="stock-grid">${rows.map(stockCardHtml).join('')}</div>`;
  requestAnimationFrame(() => lucide.createIcons());
}
// One card per car: title, price, spec sheet and per-colour stock counts.
function stockCardHtml(v) {
  const colors = Array.isArray(v.colors) ? v.colors : [];
  // Individual cars held against this model (VIN, tracking status, supplier…).
  // These ARE the stock count — nothing here reads a typed-in total any more.
  const units = Array.isArray(v.units) ? v.units : [];
  const qty = units.length;
  const noVin = units.filter(u => !String(u.vin || '').trim()).length;
  const legacy = units.length ? 0 : (parseInt(v.legacy_count, 10) || 0);
  const colorChips = colors.length
    ? colors.map(c => {
        const held = units.filter(u => String(u.colour || '').trim().toLowerCase() === String(c.name || '').trim().toLowerCase()).length;
        return `<span class="color-chip"><span class="color-dot" style="background:${stockColorSwatch(c.name)}"></span>${esc(c.name)}${held ? `<b>${held}</b>` : ''}</span>`;
      }).join('')
    : '<span style="color:var(--muted);font-size:12px">No colours recorded</span>';
  const unitsHtml = units.length ? `
    <div class="stock-colors">
      <div class="stock-sec-label">Units (${units.length})</div>
      <div class="table-scroll"><table class="stock-units">
        <thead><tr>${stockUnitCols().map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${units.map(u => {
          const eng = CE('stock');
          return `<tr>${stockUnitCols().map(c => {
            const k = c.key;
            if ((c.type === 'select' || c.type === 'radio') && eng) return `<td>${eng.badgeHtml(c, u[k])}</td>`;
            if (c.type === 'number') return `<td style="text-align:right">${Number(u[k]) ? Number(u[k]).toLocaleString() : '—'}</td>`;
            if (c.type === 'checkbox') return `<td style="text-align:center">${u[k] === true || u[k] === 'true' ? '✓' : '—'}</td>`;
            return `<td>${esc(u[k] == null ? '—' : String(u[k]) || '—')}</td>`;
          }).join('')}</tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>` : '';
  return `
    <div class="stock-card">
      <div class="stock-card-head">
        <div style="min-width:0">
          <div class="stock-title">${esc(v.make || '')} ${esc(v.model || '')}</div>
          ${v.trim ? `<div class="stock-trim">${esc(v.trim)}</div>` : ''}
        </div>
        <span class="stock-qty ${qty > 0 ? 'in' : 'out'}">${qty} in stock</span>
      </div>
      <div class="stock-price">${v.price ? egp(v.price) : 'Price not set'}</div>
      <div class="stock-colors">
        <div class="stock-sec-label">Available colours</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${colorChips}</div>
      </div>
      ${unitsHtml}
      ${legacy ? `<div class="stk-legacy">
        <i data-lucide="alert-triangle" style="width:14px;height:14px"></i>
        <span><strong>${legacy} car${legacy === 1 ? '' : 's'}</strong> ${legacy === 1 ? 'was' : 'were'} recorded here before VIN tracking.
        Add ${legacy === 1 ? 'it' : 'them'} to bring this model back into stock.</span></div>` : ''}
      ${noVin ? `<div class="stk-legacy">
        <i data-lucide="alert-triangle" style="width:14px;height:14px"></i>
        <span>${noVin} car${noVin === 1 ? ' has' : 's have'} no VIN yet.</span></div>` : ''}
      ${v.notes ? `<div class="stock-notes">${esc(v.notes)}</div>` : ''}
      <div class="stock-actions">
        <button class="btn btn-outline" style="padding:5px 10px;font-size:12px" onclick="openStockForm(${v.id})"><i data-lucide="pencil" style="width:13px;height:13px"></i> Edit</button>
        <button class="btn btn-outline" style="padding:5px 10px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteStock(${v.id})"><i data-lucide="trash-2" style="width:13px;height:13px"></i> Delete</button>
      </div>
    </div>`;
}
// Map a colour name to a swatch; unknown names fall back to a neutral grey.
function stockColorSwatch(name) {
  const n = String(name || '').trim().toLowerCase();
  const map = { white:'#f8fafc', black:'#111827', grey:'#6b7280', gray:'#6b7280', silver:'#cbd5e1', red:'#dc2626',
    blue:'#2563eb', 'navy':'#1e3a8a', green:'#16a34a', yellow:'#eab308', orange:'#ea580c', brown:'#92400e',
    beige:'#e7d7bf', gold:'#c9a35e', purple:'#7c3aed', pink:'#ec4899' };
  for (const k in map) if (n.includes(k)) return map[k];
  return '#9ca3af';
}
async function openStockForm(id) {
  await stockUnitsEngine().load();
  const v = id ? _stockCache.find(x => x.id === id) : null;
  showModal(v ? 'Edit vehicle' : 'Add vehicle', `
    <div style="display:grid;gap:12px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label class="form-label">Make *</label><input id="stk-make" class="form-input" value="${esc(v?.make || '')}" placeholder="e.g. Toyota"></div>
        <div><label class="form-label">Model *</label><input id="stk-model" class="form-input" value="${esc(v?.model || '')}" placeholder="e.g. Corolla"></div>
      </div>
      <div><label class="form-label">Trim</label><input id="stk-trim" class="form-input" value="${esc(v?.trim || '')}" placeholder="e.g. GLI 1.6 (leave blank if none)"></div>
      <div><label class="form-label">Price (EGP)</label><input id="stk-price" class="form-input" type="number" min="0" step="any" value="${v?.price ?? ''}" placeholder="e.g. 1150000"></div>

      <div>
        <label class="form-label">Colours offered</label>
        <div id="stk-colors"></div>
        <button class="btn btn-outline" style="margin-top:8px;padding:5px 10px;font-size:12px" onclick="stkAddColorRow()">+ Add colour</button>
        <div style="font-size:11px;color:var(--muted);margin-top:6px">Shown on the spec card. How many are in stock comes from the cars listed below, each with its own VIN.</div>
      </div>

      <div>
        <label class="form-label">Units in stock <span style="color:var(--muted);font-weight:400">(one row per physical car)</span></label>
        <div style="overflow-x:auto;min-width:0;border:1px solid var(--border);border-radius:10px">
          <table style="border-collapse:collapse;font-size:12px;min-width:1080px">
            <thead><tr>
              <th class="po-th" style="width:34px">#</th>
              ${stockUnitCols().map(c => procTh('stock', c, { cls: 'po-th', style: `min-width:${c.width || 120}px` })).join('')}
              <th class="po-th" style="width:38px"></th>
            </tr></thead>
            <tbody id="stk-units"></tbody>
          </table>
        </div>
        <button class="btn btn-outline" style="margin-top:8px;padding:5px 10px;font-size:12px" onclick="stkAddUnitRow()">+ Add unit</button> ${procColsBtn('stock')}
        <div style="font-size:11px;color:var(--muted);margin-top:6px">One row per car. These are the stock count — there is no separate total to type in.</div>
        ${v && !(v.units || []).length && v.legacy_count ? `<div class="stk-legacy">
          <i data-lucide="alert-triangle" style="width:14px;height:14px"></i>
          <span>${v.legacy_count} car${v.legacy_count === 1 ? ' was' : 's were'} recorded here before VIN tracking.
          Add ${v.legacy_count === 1 ? 'it' : 'them'} above to bring this model back into stock.</span>
        </div>` : ''}
      </div>
      <div><label class="form-label">Notes</label><input id="stk-notes" class="form-input" value="${esc(v?.notes || '')}" placeholder="Options, delivery notes…"></div>
      <div id="stk-err" class="error-msg" style="display:none"></div>
    </div>`,
    `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
     <button class="btn btn-primary" onclick="saveStock(${id || 'null'})">${v ? 'Save changes' : 'Add vehicle'}</button>`,
    { wide: true });
  const existing = Array.isArray(v?.colors) ? v.colors : [];
  (existing.length ? existing : [{ name: '', qty: '' }]).forEach(c => stkAddColorRow(c.name, c.qty));
  (Array.isArray(v?.units) ? v.units : []).forEach(stkAddUnitRow);
}
function stkAddColorRow(name, qty) {
  const wrap = document.getElementById('stk-colors');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'stk-color-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 34px;gap:8px;margin-bottom:6px';
  row.innerHTML = `
    <input class="form-input stk-color-name" placeholder="Colour (e.g. White)" value="${esc(name || '')}">
    <button class="btn btn-outline" style="padding:0;font-size:15px;color:var(--danger);border-color:var(--danger)" title="Remove"><i data-lucide="x" style="width:13px;height:13px"></i></button>`;
  row.querySelector('button').onclick = () => row.remove();
  wrap.appendChild(row);
}
function stkAddUnitRow(u) {
  const tbody = document.getElementById('stk-units');
  if (!tbody) return;
  const v = u || {};
  const tr = document.createElement('tr');
  tr.className = 'stk-unit-row';
  const val = c => (c.key === 'status' && v[c.key] == null
    ? ((c.options && c.options[0] && c.options[0].key) || 'send_to_supplier') : v[c.key]);
  tr.innerHTML = `<td class="po-td stk-u-no" style="text-align:center;color:var(--muted)"></td>` +
    stockUnitCols().map(c => procGridInput(CE('stock'), c, val(c), 'stk-u')).join('') +
    `<td class="po-td" style="text-align:center"><button class="btn btn-outline" style="padding:2px 7px;font-size:14px;color:var(--danger);border-color:var(--danger)" title="Remove">×</button></td>`;
  tr.querySelector('button').onclick = () => { tr.remove(); stkRenumberUnits(); };
  tbody.appendChild(tr);
  stkRenumberUnits();
}
function stkRenumberUnits() {
  [...document.querySelectorAll('.stk-unit-row')].forEach((r, i) => {
    const c = r.querySelector('.stk-u-no'); if (c) c.textContent = i + 1;
  });
}

async function saveStock(id) {
  const colors = [...document.querySelectorAll('.stk-color-row')].map(r => ({
    name: r.querySelector('.stk-color-name').value.trim(),
    qty: 0,                    // counts come from the individual cars, not here
  })).filter(c => c.name);
  const units = procGridCollect('.stk-unit-row', '.stk-u')
    .filter(u => u.vin || u.consignee || u.colour || u.supplier);
  const payload = {
    make: document.getElementById('stk-make').value.trim(),
    model: document.getElementById('stk-model').value.trim(),
    trim: document.getElementById('stk-trim').value.trim(),
    price: document.getElementById('stk-price').value,
    notes: document.getElementById('stk-notes').value.trim(),
    colors, units,
  };
  const err = document.getElementById('stk-err');
  if (!payload.make || !payload.model) { err.textContent = 'Make and Model are required.'; err.style.display = 'block'; return; }
  const url = id ? `/api/dashboard/stock/${id}` : '/api/dashboard/stock';
  const r = await apiFetch(url, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  const d = await r.json();
  if (!r.ok) { err.textContent = d.error || 'Failed to save.'; err.style.display = 'block'; return; }
  hideModal();
  loadStock();
}
async function deleteStock(id) {
  const v = _stockCache.find(x => x.id === id);
  if (!confirm(`Delete ${v ? `${v.make} ${v.model} ${v.trim || ''}`.trim() : 'this vehicle'} from stock?`)) return;
  await apiFetch(`/api/dashboard/stock/${id}`, { method: 'DELETE' });
  loadStock();
}
function openStockCsvModal() {
  showModal('Bulk upload vehicles', `
    <div style="display:grid;gap:12px;font-size:13px">
      <p style="color:var(--muted);margin:0">Upload a CSV with columns: <strong>make, model, trim, price, range_km, motor_ps, power_train, drive_train, transmission, battery, top_speed, fast_charge, seats, body, year, colors, quantity, notes</strong>.</p>
      <p style="color:var(--muted);margin:0">Make and Model are required; a model with several trims = one row per trim. Colours use <code>Name:Qty | Name:Qty</code> (e.g. <code>White:2 | Black:1</code>) and their sum becomes the total quantity.</p>
      <a class="btn btn-outline" href="/api/dashboard/stock/template.csv${authToken ? '?_t=' + encodeURIComponent(authToken) : ''}" download style="justify-self:start"><i data-lucide="download" style="width:14px;height:14px"></i> Download sample template</a>
      <input id="stock-csv-file" type="file" accept=".csv,text/csv" class="form-input">
      <div id="stock-csv-result"></div>
    </div>`,
    `<button class="btn btn-outline" onclick="hideModal()">Close</button>
     <button class="btn btn-primary" onclick="importStockCsv()">Upload</button>`);
  requestAnimationFrame(() => lucide.createIcons());
}
async function importStockCsv() {
  const file = document.getElementById('stock-csv-file').files[0];
  const res = document.getElementById('stock-csv-result');
  if (!file) { res.innerHTML = '<div class="error-msg">Please choose a CSV file.</div>'; return; }
  const fd = new FormData(); fd.append('file', file);
  const headers = {}; if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  res.innerHTML = '<div style="color:var(--muted)">Uploading…</div>';
  const r = await fetch('/api/dashboard/stock/bulk', { method: 'POST', headers, body: fd });
  const data = await r.json();
  if (!r.ok || data.error) { res.innerHTML = `<div class="error-msg">${esc(data.error || 'Upload failed')}</div>`; return; }
  res.innerHTML = `<div style="background:#d1fae5;border:1px solid #6ee7b7;color:#065f46;padding:10px 14px;border-radius:8px;font-size:13px">Imported <strong>${data.inserted}</strong> vehicle(s)${data.errors?.length ? `<br><span style="color:var(--warning)">${data.errors.map(esc).join('<br>')}</span>` : ''}</div>`;
  loadStock();
}

// ── Deals tabs: Pipeline · Inquiry · Sales ──────────────────────────────────────
let _dealsTab = 'pipeline';

function dealsTab(tab) {
  _dealsTab = tab;
  document.querySelectorAll('.deal-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['pipeline', 'sales'].forEach(t => {
    const el = document.getElementById('deals-pane-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'sales') loadSales();
  requestAnimationFrame(() => lucide.createIcons());
}

// ── Sidebar layout: admin drag-and-drop ordering + renaming ─────────────────────
// The nav stays static HTML. A saved config (quotation_settings → nav_config)
// reorders and relabels it on load; unknown keys keep their HTML position, so a
// section added later needs no config migration.
let _navArranging = false;

function navGroupEls() { return [...document.querySelectorAll('#sidebar .nav-group')]; }
function navGroupLabelEl(g) { return g.querySelector('.nav-group-label'); }
function navItemLabelText(el) {
  const span = el.querySelector('.nav-item-label');
  if (span) return span.textContent.trim();
  return [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
}
function navSetItemLabel(el, text) {
  const span = el.querySelector('.nav-item-label');
  if (span) { span.textContent = text; return; }
  const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
  if (t.length) { t[0].textContent = ' ' + text; t.slice(1).forEach(n => { n.textContent = ''; }); }
  else el.appendChild(document.createTextNode(' ' + text));
}

// Labels exactly as shipped, captured before any saved arrangement is applied.
// readNavConfig used to snapshot every label whether or not the admin had typed
// it, which permanently masked any later rename in the code (a config saved when
// the item read "Deletion Requests" would keep showing that after the rename to
// "Approvals"). Only a label that differs from the default is a real rename.
const NAV_DEFAULT_LABELS = (() => {
  const d = {};
  navGroupEls().forEach(g => {
    d['g:' + g.dataset.group] = (navGroupLabelEl(g)?.textContent || '').trim();
    g.querySelectorAll('.nav-item').forEach(i => { d['i:' + i.id] = navItemLabelText(i); });
  });
  return d;
})();

async function loadNavConfig() {
  let cfg = null;
  try { cfg = await apiFetch('/api/dashboard/nav-config').then(r => r.json()); } catch (_) { return; }
  applyNavConfig(cfg);
}

function applyNavConfig(cfg) {
  const groups = (cfg && Array.isArray(cfg.groups)) ? cfg.groups : [];
  if (!groups.length) return;
  const nav = document.querySelector('#sidebar .sidebar-nav') || document.querySelector('#sidebar');
  const byKey = new Map(navGroupEls().map(g => [g.dataset.group, g]));
  const placedGroups = new Set();
  groups.forEach(g => {
    const el = byKey.get(g.key);
    if (!el) return;                       // config references a section that no longer exists
    placedGroups.add(g.key);
    if (g.label) { const l = navGroupLabelEl(el); if (l) l.textContent = g.label; }
    el.style.display = g.hidden ? 'none' : '';
    nav.appendChild(el);                   // moving in config order re-sorts the list
    const wrap = el.querySelector('.nav-group-items');
    if (wrap) {
      const placedItems = new Set();
      (g.items || []).forEach(it => {
        // Look the item up document-wide: it may have been moved to this group
        // from another one, so it won't be inside `wrap` yet.
        const iel = document.getElementById(it.id);
        if (!iel || !iel.classList.contains('nav-item')) return;
        if (it.label) navSetItemLabel(iel, it.label);
        iel.style.display = it.hidden ? 'none' : '';
        wrap.appendChild(iel);
        placedItems.add(it.id);
      });
      // An item that shipped after this arrangement was saved isn't in the config,
      // so the appends above leave it sitting at the top of its group. Push it to
      // the end instead — new entries join the list, they don't jump the queue.
      if (placedItems.size) {
        [...wrap.querySelectorAll('.nav-item')]
          .filter(i => !placedItems.has(i.id))
          .forEach(i => wrap.appendChild(i));
      }
    }
  });
  // Same for a whole section added since the save.
  navGroupEls().forEach(g => { if (!placedGroups.has(g.dataset.group)) nav.appendChild(g); });
}

function readNavConfig() {
  // Store a label only when it is a deliberate rename; '' means "use whatever the
  // app ships", so a later rename in the code still reaches an arranged sidebar.
  const rename = (key, text) => (text === NAV_DEFAULT_LABELS[key] ? '' : text);
  return { groups: navGroupEls().map(g => ({
    key: g.dataset.group,
    label: rename('g:' + g.dataset.group, (navGroupLabelEl(g)?.textContent || '').trim()),
    hidden: g.style.display === 'none',
    items: [...g.querySelectorAll('.nav-item')].map(i => ({
      id: i.id, label: rename('i:' + i.id, navItemLabelText(i)), hidden: i.style.display === 'none',
    })),
  })) };
}

let _navSnapshot = null;
function navArrangeToggle() {
  _navArranging ? navArrangeCancel() : navArrangeStart();
}
function navArrangeStart() {
  _navArranging = true;
  _navSnapshot = readNavConfig();
  document.getElementById('sidebar').classList.add('arranging');
  document.getElementById('nav-arrange-label').textContent = 'Arranging…';
  document.getElementById('nav-arrange-actions').style.display = 'flex';
  navGroupEls().forEach(g => g.classList.add('open'));   // every group open so items can be dragged between them
  navBindDrag();
}
function navArrangeCancel() {
  _navArranging = false;
  document.getElementById('sidebar').classList.remove('arranging');
  document.getElementById('nav-arrange-label').textContent = 'Arrange sections';
  document.getElementById('nav-arrange-actions').style.display = 'none';
  navUnbindDrag();
  if (_navSnapshot) applyNavConfig(_navSnapshot);   // undo unsaved moves/renames
}
async function navArrangeSave() {
  const cfg = readNavConfig();
  const r = await apiFetch('/api/dashboard/nav-config', { method: 'PUT', body: JSON.stringify(cfg) });
  if (!r.ok) { alert('Could not save the layout.'); return; }
  _navSnapshot = cfg;
  navArrangeCancel();
}
async function navArrangeReset() {
  if (!confirm('Restore the default section order and names?')) return;
  await apiFetch('/api/dashboard/nav-config', { method: 'DELETE' });
  location.reload();
}

// Drag-and-drop: groups reorder among themselves, items within their own group.
function navBindDrag() {
  navGroupEls().forEach(g => {
    const head = g.querySelector('.nav-group-head');
    if (head) {
      head.draggable = true;
      head.addEventListener('dragstart', navDragStart);
      head.addEventListener('dragover', navDragOver);
      head.addEventListener('drop', navDrop);
      head.addEventListener('dragend', navDragEnd);
      const lbl = navGroupLabelEl(g);
      if (lbl) { lbl.contentEditable = 'true'; lbl.classList.add('nav-label-edit'); lbl.addEventListener('keydown', navLabelKey); }
    }
    g.querySelectorAll('.nav-item').forEach(i => {
      i.draggable = true;
      i.addEventListener('dragstart', navDragStart);
      i.addEventListener('dragover', navDragOver);
      i.addEventListener('drop', navDrop);
      i.addEventListener('dragend', navDragEnd);
      navMakeItemEditable(i, true);
    });
  });
}
function navUnbindDrag() {
  navGroupEls().forEach(g => {
    const head = g.querySelector('.nav-group-head');
    if (head) {
      head.draggable = false;
      head.removeEventListener('dragstart', navDragStart);
      head.removeEventListener('dragover', navDragOver);
      head.removeEventListener('drop', navDrop);
      head.removeEventListener('dragend', navDragEnd);
      const lbl = navGroupLabelEl(g);
      if (lbl) { lbl.contentEditable = 'false'; lbl.classList.remove('nav-label-edit'); lbl.removeEventListener('keydown', navLabelKey); }
    }
    g.querySelectorAll('.nav-item').forEach(i => {
      i.draggable = false;
      i.removeEventListener('dragstart', navDragStart);
      i.removeEventListener('dragover', navDragOver);
      i.removeEventListener('drop', navDrop);
      i.removeEventListener('dragend', navDragEnd);
      navMakeItemEditable(i, false);
    });
  });
}
function navLabelKey(e) { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }

// Item labels live as a loose text node beside the icon. Wrap it once in a span
// so it can be edited in place without disturbing the icon or the unread badge.
function navItemLabelSpan(el) {
  let span = el.querySelector('.nav-item-label');
  if (span) return span;
  const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
  if (!node) return null;
  span = document.createElement('span');
  span.className = 'nav-item-label';
  span.textContent = node.textContent.trim();
  node.replaceWith(document.createTextNode(' '), span);
  return span;
}
function navMakeItemEditable(el, on) {
  const span = navItemLabelSpan(el);
  if (!span) return;
  span.contentEditable = on ? 'true' : 'false';
  span.classList.toggle('nav-label-edit', on);
  // Editing must not fire navigate() or start a drag
  if (on) {
    span.addEventListener('keydown', navLabelKey);
    span.addEventListener('click', navSwallowClick);
    span.addEventListener('mousedown', navSwallowDrag);
  } else {
    span.removeEventListener('keydown', navLabelKey);
    span.removeEventListener('click', navSwallowClick);
    span.removeEventListener('mousedown', navSwallowDrag);
  }
}
function navSwallowClick(e) { e.stopPropagation(); e.preventDefault(); }
function navSwallowDrag(e) { e.stopPropagation(); }

let _navDragEl = null;
function navDragStart(e) {
  e.stopPropagation();
  // A group is dragged by its head, but it's the whole group that moves
  _navDragEl = e.currentTarget.classList.contains('nav-group-head')
    ? e.currentTarget.closest('.nav-group') : e.currentTarget;
  _navDragEl.classList.add('nav-dragging');
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); } catch (_) {}
}
// What a drop on this element would do, or null when it isn't a legal target.
// Groups reorder among themselves; an item can be dropped next to any other item
// (in any group) or onto a group head to move it into that group.
function navDropPlan(currentTarget) {
  if (!_navDragEl) return null;
  const overHead = currentTarget.classList.contains('nav-group-head');
  const group = overHead ? currentTarget.closest('.nav-group') : null;
  const draggingGroup = _navDragEl.classList.contains('nav-group');

  if (draggingGroup) {
    // group → group: reorder, using the head as the handle
    if (!overHead || group === _navDragEl) return null;
    return { kind: 'group', ref: group, highlight: group };
  }
  if (overHead) {
    // item → group head: move it into that group
    const wrap = group && group.querySelector('.nav-group-items');
    if (!wrap) return null;
    return { kind: 'into', wrap, highlight: currentTarget };
  }
  // item → item: insert beside it, even across groups
  if (currentTarget === _navDragEl || !currentTarget.classList.contains('nav-item')) return null;
  return { kind: 'item', ref: currentTarget, highlight: currentTarget };
}

function navDragOver(e) {
  const plan = navDropPlan(e.currentTarget);
  if (!plan) return;
  e.preventDefault(); e.stopPropagation();
  plan.highlight.classList.add('nav-drag-over');
}
function navDrop(e) {
  const plan = navDropPlan(e.currentTarget);
  if (!plan) return;
  e.preventDefault(); e.stopPropagation();
  plan.highlight.classList.remove('nav-drag-over');
  if (plan.kind === 'into') {
    plan.wrap.appendChild(_navDragEl);          // dropped on the header → end of that group
    plan.wrap.closest('.nav-group')?.classList.add('open');
    return;
  }
  const rect = plan.ref.getBoundingClientRect();
  const after = (e.clientY - rect.top) > rect.height / 2;
  plan.ref.parentElement.insertBefore(_navDragEl, after ? plan.ref.nextSibling : plan.ref);
  if (plan.kind === 'item') plan.ref.closest('.nav-group')?.classList.add('open');
}
function navDragEnd() {
  document.querySelectorAll('.nav-drag-over').forEach(el => el.classList.remove('nav-drag-over'));
  if (_navDragEl) _navDragEl.classList.remove('nav-dragging');
  _navDragEl = null;
}

// ── Google Chat panel (real spaces + messages) ──────────────────────────────────
// Capability comes from the scopes Google actually granted, so a partial consent
// renders a read-only or send-only panel instead of failing. Every failure paints
// a state inside this panel and never touches the rest of the page.
let _gchat = { status: null, space: null, spaces: [], timer: null };
const GCHAT_BASE = '/api/dashboard/gchat';

function gchatFetch(path, opts) { return apiFetch(GCHAT_BASE + path, opts); }

function gchatStateCard(icon, title, body, btn) {
  return `<div class="chat-empty-state" style="text-align:center;padding:32px">
    <i data-lucide="${icon}" style="width:40px;height:40px;opacity:.3"></i>
    <div style="font-weight:600;margin-top:4px">${esc(title)}</div>
    <div style="font-size:12.5px;color:var(--muted);max-width:320px;line-height:1.6">${body}</div>
    ${btn || ''}</div>`;
}
function gchatConnectBtn(label) {
  return `<button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="gchatConnect()">${esc(label)}</button>`;
}
function gchatConnect() {
  window.location.href = GCHAT_BASE + '/connect' + (authToken ? '?_t=' + encodeURIComponent(authToken) : '');
}
async function gchatDisconnect() {
  if (!confirm('Disconnect Google Chat?')) return;
  await gchatFetch('/disconnect', { method: 'POST' });
  loadGChat();
}

async function loadGChat() {
  const list = document.getElementById('gchat-space-list');
  const main = document.getElementById('gchat-main');
  if (!list || !main) return;
  // A failed connect redirects back with ?gchat_error=… — show it once.
  const qErr = new URLSearchParams(location.search).get('gchat_error');
  if (qErr) {
    history.replaceState(null, '', location.pathname + '#gchat');
    list.innerHTML = '';
    main.innerHTML = gchatStateCard('alert-triangle', "Couldn't connect Google Chat", esc(qErr), gchatConnectBtn('Try again'));
    requestAnimationFrame(() => lucide.createIcons());
    return;
  }
  try { _gchat.status = await gchatFetch('/status').then(r => r.json()); }
  catch (_) { _gchat.status = { configured: false }; }
  const st = _gchat.status;

  if (!st.configured) {
    list.innerHTML = '';
    main.innerHTML = gchatStateCard('plug', 'Google Chat is not set up',
      'Ask an administrator to enable it (<code>GOOGLE_CHAT_ENABLED=1</code>). Google Chat requires a Google&nbsp;Workspace account.');
  } else if (st.reconnect) {
    list.innerHTML = '';
    main.innerHTML = gchatStateCard('rotate-ccw', 'Reconnect Google Chat',
      'Your Google session expired. Unverified apps in testing mode lose access every 7 days.', gchatConnectBtn('Reconnect'));
  } else if (!st.connected) {
    list.innerHTML = '';
    main.innerHTML = gchatStateCard('message-square', 'Connect Google Chat',
      'See your spaces and messages here, and reply without leaving the app.', gchatConnectBtn('Connect Google Chat'));
  } else {
    await gchatLoadSpaces();
  }
  requestAnimationFrame(() => lucide.createIcons());
}

async function gchatLoadSpaces() {
  const list = document.getElementById('gchat-space-list');
  const main = document.getElementById('gchat-main');
  if (!list) return;
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  let d;
  try { d = await gchatFetch('/spaces').then(r => r.json()); } catch (_) { d = { spaces: [], error: 'failed' }; }
  if (d.error) {
    list.innerHTML = '';
    const msg = d.error === 'forbidden'
      ? 'Google Chat isn\'t available for your organization. A Workspace admin needs to allow this app.'
      : d.error === 'reconnect' ? 'Your Google session expired.'
      : 'Could not reach Google Chat.';
    main.innerHTML = gchatStateCard('alert-circle', 'Google Chat unavailable', esc(msg),
      d.error === 'reconnect' ? gchatConnectBtn('Reconnect') : '');
    requestAnimationFrame(() => lucide.createIcons());
    return;
  }
  _gchat.spaces = d.spaces || [];
  if (!_gchat.spaces.length) {
    list.innerHTML = '<div style="padding:18px;color:var(--muted);font-size:12.5px;line-height:1.6">No spaces yet.<br>Group chats and DMs only appear here once they have at least one message.</div>';
    return;
  }
  list.innerHTML = _gchat.spaces.map(sp => {
    const init = (sp.title || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="chat-room-item${_gchat.space === sp.name ? ' active' : ''}" onclick="gchatOpen('${escJs(sp.name)}')">
      <div class="chat-room-avatar-wrap"><div class="chat-room-avatar${sp.type === 'SPACE' ? ' grp' : ''}">${esc(init)}</div></div>
      <div class="chat-room-info"><div class="chat-room-name">${esc(sp.title)}</div>
        <div class="chat-room-preview">${esc(sp.type === 'DIRECT_MESSAGE' ? 'Direct message' : 'Space')}</div></div>
    </div>`;
  }).join('');
  if (_gchat.space) gchatOpen(_gchat.space, true);
}

async function gchatOpen(space, keepPoll) {
  _gchat.space = space;
  document.querySelectorAll('#gchat-space-list .chat-room-item').forEach(el => el.classList.remove('active'));
  const caps = (_gchat.status && _gchat.status.caps) || {};
  const sp = _gchat.spaces.find(x => x.name === space);
  const main = document.getElementById('gchat-main');
  main.innerHTML = `
    <div class="chat-header"><div class="chat-header-name">${esc(sp ? sp.title : 'Space')}</div></div>
    <div class="chat-messages" id="gchat-messages"><div class="loading"><div class="spinner"></div></div></div>
    ${caps.send ? `<div class="chat-composer">
        <textarea class="chat-input" id="gchat-input" rows="1" placeholder="Message ${esc(sp ? sp.title : '')}… (sent as you)" onkeydown="gchatKey(event)"></textarea>
        <button class="chat-send-btn" id="gchat-send" onclick="gchatSend()" title="Send"><i data-lucide="send" style="width:15px;height:15px"></i></button>
      </div>`
      : `<div class="chat-composer" style="justify-content:center;color:var(--muted);font-size:12px">
          Read-only — you didn't grant permission to send. <a href="#" onclick="gchatConnect();return false" style="color:var(--primary);margin-left:4px">Reconnect</a>
        </div>`}`;
  await gchatLoadMessages();
  if (!keepPoll) gchatStartPoll();
  requestAnimationFrame(() => lucide.createIcons());
}

async function gchatLoadMessages() {
  const box = document.getElementById('gchat-messages');
  if (!box || !_gchat.space) return;
  const caps = (_gchat.status && _gchat.status.caps) || {};
  if (!caps.read) {
    box.innerHTML = gchatStateCard('eye-off', 'Message history not shared',
      'You didn\'t grant permission to read messages. You can still send.', gchatConnectBtn('Grant read access'));
    requestAnimationFrame(() => lucide.createIcons());
    return;
  }
  let d;
  try { d = await gchatFetch('/messages?space=' + encodeURIComponent(_gchat.space)).then(r => r.json()); }
  catch (_) { d = { messages: [], error: 'failed' }; }
  if (d.error) {
    box.innerHTML = gchatStateCard('alert-circle', 'Could not load messages', esc(d.detail || d.error),
      d.error === 'reconnect' ? gchatConnectBtn('Reconnect') : '');
    requestAnimationFrame(() => lucide.createIcons());
    return;
  }
  const msgs = d.messages || [];
  if (!msgs.length) { box.innerHTML = '<div class="chat-empty-state" style="padding:28px"><div>No messages in this space yet.</div></div>'; return; }
  const me = (_gchat.status && _gchat.status.email) || '';
  box.innerHTML = msgs.map(m => {
    const mine = me && m.senderName && _gchat.status.name === m.senderName;
    const t = m.createTime ? new Date(m.createTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}">
      ${!mine ? `<div class="chat-msg-sender">${esc(m.senderName || 'Unknown')}</div>` : ''}
      <div class="chat-msg-bubble">${esc(m.text)}</div>
      <div class="chat-msg-time">${t}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function gchatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gchatSend(); } }
async function gchatSend() {
  const input = document.getElementById('gchat-input');
  const btn = document.getElementById('gchat-send');
  if (!input || !_gchat.space) return;
  const text = input.value.trim();
  if (!text) return;
  if (btn) btn.disabled = true;
  try {
    const r = await gchatFetch('/messages', { method: 'POST', body: JSON.stringify({ space: _gchat.space, text }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.detail || d.error || 'Send failed');
    input.value = '';            // only clear once Google accepted it
    await gchatLoadMessages();
  } catch (e) {
    alert('Could not send: ' + e.message);
  } finally { if (btn) btn.disabled = false; }
}

// Chat has no realtime push without extra Workspace infrastructure, so poll —
// only the open space, and never while the tab is hidden.
function gchatStartPoll() {
  gchatStopPoll();
  _gchat.timer = setInterval(() => {
    if (document.hidden || !_gchat.space) return;
    gchatLoadMessages().catch(() => {});
  }, 20000);
}
function gchatStopPoll() { if (_gchat.timer) { clearInterval(_gchat.timer); _gchat.timer = null; } }

// Hide the nav entry entirely until Chat is configured — never show a dead page.
async function gchatInitNav() {
  const nav = document.getElementById('nav-gchat');
  if (!nav) return;
  try {
    const st = await gchatFetch('/status').then(r => r.json());
    nav.style.display = st.configured ? '' : 'none';
  } catch (_) { nav.style.display = 'none'; }
}

// ── Google Calendar sync (new tasks land on the assignee's calendar) ────────────
let _calSync = { configured: false, connected: false };
async function loadCalendarSync() {
  const badge = document.getElementById('cal-sync-status');
  const btn = document.getElementById('cal-sync-btn');
  if (!badge || !btn) return;
  try { _calSync = await apiFetch('/api/calendar/status').then(r => r.json()); }
  catch (_) { _calSync = { configured: false, connected: false }; }
  if (!_calSync.configured) {
    badge.textContent = 'Google not configured';
    btn.style.display = 'none';
    return;
  }
  btn.style.display = '';
  if (_calSync.connected) {
    badge.textContent = `Task sync on · ${_calSync.email || ''}`;
    btn.textContent = 'Disconnect';
  } else {
    badge.textContent = 'Task sync off';
    btn.textContent = 'Connect for task sync';
  }
}
async function calendarSyncToggle() {
  if (_calSync.connected) {
    if (!confirm('Stop adding new tasks to Google Calendar? Existing events stay put.')) return;
    await apiFetch('/api/calendar/disconnect', { method: 'POST' });
    loadCalendarSync();
    return;
  }
  // OAuth redirect — the token query param keeps the session through the round trip
  window.location.href = '/api/calendar/connect' + (authToken ? '?_t=' + encodeURIComponent(authToken) : '');
}

// ── Navigation ────────────────────────────────────────────────────────────────
let currentPage = 'tasks';
const pageLoaders = { home: loadHome, tasks: loadDashboard, employees: loadEmployees, requests: loadRequests, submissions: loadSubmissions, hours: loadHours, email: loadEmail, drive: loadDrive, sheets: loadSheets, quotation: () => initQuotationPage(), calendar: loadCalendarSync, gchat: loadGChat, chat: loadAdminChat, customers: loadCustomers, deals: loadDeals, stock: loadStock, suppliers: loadSuppliers, rfqs: loadRfqs, contracts: loadContracts, purchaseorders: loadPurchaseOrders, whatsapp: loadWhatsApp, notif: loadNotifPage, meet: () => loadMeetings(), reports: loadReports, automations: loadAutomations, deletions: loadDeletionRequests };

function navigate(page) {
  if (currentPage === 'chat' && page !== 'chat') adminCloseChatSse();
  if (currentPage === 'whatsapp' && page !== 'whatsapp') waCloseSse();
  if (currentPage === 'gchat' && page !== 'gchat') gchatStopPoll();
  // A page id that doesn't exist — a stale hash, or a cached bundle whose page
  // list disagrees with the HTML mid-deploy — used to throw here, which killed
  // init and left the whole app blank. Fall back to home like the team portal.
  if (!document.getElementById('page-' + page)) page = 'home';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const navEl = document.getElementById('nav-' + page);
  if (navEl) navEl.classList.add('active');
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  const bnav = document.getElementById('bnav-' + page);
  if (bnav) bnav.classList.add('active');
  currentPage = page;
  openGroupForPage(page); // reveal the group containing the active item
  rememberPage(page);
  if (pageLoaders[page]) pageLoaders[page]();
  closeSidebar(); // close on mobile after navigation
  requestAnimationFrame(() => lucide.createIcons());
}

// Startup already read location.hash, but nothing ever wrote it — so a refresh
// always found it empty and fell back to the default page. replaceState rather
// than pushState, or Back turns into a crawl through every section visited.
function rememberPage(page) {
  try {
    history.replaceState(null, '', '#' + page);
    localStorage.setItem('ml_page', page);
  } catch (_) { /* private mode; the hash alone still works */ }
}
function lastPage(valid, fallback) {
  const hash = (location.hash || '').replace('#', '');
  if (hash && valid.includes(hash)) return hash;
  let saved = null;
  try { saved = localStorage.getItem('ml_page'); } catch (_) {}
  return saved && valid.includes(saved) ? saved : fallback;
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const isOpen = sb.classList.toggle('open');
  ov.classList.toggle('visible', isOpen);
  // The team portal has always done this; without it the page scrolls behind the drawer.
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  sb.classList.remove('open');
  ov.classList.remove('visible');
  document.body.style.overflow = '';
}

// ── Sidebar collapse (rail) + collapsible section groups ──
function toggleSidebarCollapse() {
  const collapsed = document.getElementById('sidebar').classList.toggle('collapsed');
  try { localStorage.setItem('ml_admin_sidebar', collapsed ? 'collapsed' : 'expanded'); } catch (_) {}
}
function toggleNavGroup(head) {
  const group = head.closest('.nav-group');
  if (!group) return;
  group.classList.toggle('open');
  try {
    const open = [...document.querySelectorAll('.nav-group.open')].map(g => g.dataset.group);
    localStorage.setItem('ml_admin_navgroups', JSON.stringify(open));
  } catch (_) {}
}
function openGroupForPage(page) {
  const nav = document.getElementById('nav-' + page);
  const group = nav && nav.closest('.nav-group');
  if (group) group.classList.add('open');
}
function initSidebarState() {
  const sb = document.getElementById('sidebar');
  try { if (localStorage.getItem('ml_admin_sidebar') === 'collapsed') sb.classList.add('collapsed'); } catch (_) {}
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('ml_admin_navgroups') || 'null'); } catch (_) {}
  const groups = [...document.querySelectorAll('.nav-group')];
  if (Array.isArray(saved)) groups.forEach(g => g.classList.toggle('open', saved.includes(g.dataset.group)));
  else openGroupForPage(currentPage); // default: only active section open
}

async function logout() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  showAuthScreen();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function showModal(title, bodyHTML, footerHTML, opts) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML   = bodyHTML;
  document.getElementById('modal-footer').innerHTML = footerHTML;
  // `wide` opts-in to the roomy layout (used by the purchase-order sheet)
  document.getElementById('modal-box').classList.toggle('modal-wide', !!(opts && opts.wide));
  document.getElementById('modal-overlay').style.display = 'flex';
}
function hideModal() { document.getElementById('modal-overlay').style.display = 'none'; }
function closeModal(e) { if (e.target === document.getElementById('modal-overlay')) hideModal(); }

// ── Employees ─────────────────────────────────────────────────────────────────
let allEmployees = [];

async function loadEmployees() {
  if (typeof renderAvailabilityBoard === 'function') renderAvailabilityBoard('availability-board');
  const tableC = document.getElementById('employees-table-container');
  tableC.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const emps = await apiFetch('/api/dashboard/employees').then(r => r.json());
    allEmployees = emps;

    // Employee portal accounts table
    if (!emps.length) {
      tableC.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">No employee portal accounts yet. Click "+ Create Employee" to add one.</div>';
    } else {
      // The catalogue drives this column too — it used to name eight sections out
      // of twenty-two (including viewAllRequests, which stopped being a section
      // long ago), so the table said nothing true about the other fourteen.
      await permCatalogue();
      tableC.innerHTML = `<div class="table-scroll"><table>
        <thead><tr><th style="width:34px"><input type="checkbox" id="emp-select-all" onchange="empToggleSelectAll(this)"></th><th>Name</th><th>Username</th><th>Job Title</th><th>Status</th><th>Email</th><th>Permissions</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${emps.map(e => {
          const p = e.permissions || {};
          const sc = p.scope || {};
          const scoped = !!(sc.assignedOnly || (sc.dealStages && sc.dealStages.length) || (sc.leadStatuses && sc.leadStatuses.length));
          const badges = empPermsCell(p, scoped);
          const initials = (e.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
          const avatar = e.avatar_url ? `<img src="${esc(e.avatar_url)}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px">` : `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--primary);color:#fff;font-size:10px;font-weight:700;vertical-align:middle;margin-right:8px">${initials}</span>`;
          const statusStr = (e.status_emoji || e.status_text) ? `${e.status_emoji||''} ${esc(e.status_text||'')}`.trim() : '—';
          return `<tr>
            <td><input type="checkbox" class="emp-pick" value="${e.id}" ${_empPicked.has(e.id) ? 'checked' : ''} onchange="empTogglePick(${e.id})"></td>
            <td class="task-title">${avatar}${esc(e.name)}</td>
            <td><code style="font-size:12px">${esc(e.username)}</code></td>
            <td style="font-size:12px;color:var(--muted)">${esc(e.job_title || '—')}</td>
            <td style="font-size:12px;color:var(--muted)">${statusStr}</td>
            <td style="font-size:12px;color:var(--muted)">${esc(e.email || '—')}</td>
            <td style="max-width:200px">${badges}</td>
            <td style="font-size:12px;color:var(--muted)">${new Date(e.created_at).toLocaleDateString()}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-outline" style="padding:4px 10px;font-size:11px" onclick="openEmpModal(${e.id})">Edit</button>
              <button class="btn btn-danger" style="padding:4px 10px;font-size:11px;margin-left:4px" onclick="deleteEmployee(${e.id})">Delete</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }
  } catch (e) {
    tableC.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
  }
  requestAnimationFrame(() => lucide.createIcons());
}

// ── Bulk permissions ──────────────────────────────────────────────────────────
// Tick employees in the list (or none, meaning everyone) and apply ONE
// permission set to all of them. The form is the same catalogue-generated one
// the per-employee modal uses, so the two can never drift apart.
let _empPicked = new Set();
function empTogglePick(id) {
  if (_empPicked.has(id)) _empPicked.delete(id); else _empPicked.add(id);
  empUpdateBulkBtn();
}
function empToggleSelectAll(cb) {
  _empPicked = cb.checked ? new Set(allEmployees.map(e => e.id)) : new Set();
  document.querySelectorAll('.emp-pick').forEach(x => { x.checked = cb.checked; });
  empUpdateBulkBtn();
}
function empUpdateBulkBtn() {
  const btn = document.getElementById('emp-bulk-btn');
  if (btn) btn.textContent = _empPicked.size ? `Apply permissions to ${_empPicked.size} selected…` : 'Apply permissions to all…';
}
async function openBulkPermsModal() {
  const cat = await permCatalogue();
  const targets = _empPicked.size ? [..._empPicked] : 'all';
  const who = targets === 'all' ? `ALL ${allEmployees.length} employees` : `${targets.length} selected employee(s)`;
  _empModalPerms = {};
  showModal('Apply permissions', `
    <div class="error-msg" style="display:block;margin-bottom:14px">
      This <strong>replaces</strong> the permissions of ${who} with what you set below — it does not add to what they have.
    </div>
    <div class="form-group">
      <label class="form-label">Start from</label>
      <select class="form-control" onchange="bulkPermsPrefill(this.value)">
        <option value="">Copy from nobody — use the presets below</option>
        ${allEmployees.map(e => `<option value="${e.id}">Copy from ${esc(e.name)}</option>`).join('')}
      </select>
    </div>
    ${cat.failed
      ? `<div class="error-msg" style="display:block">Could not load the permission list — try again.</div>`
      : `<div class="perm-editor">
          ${empPermToolbar(cat)}
          <div id="perm-groups">${cat.groups.map(empPermGroup).join('')}</div>
        </div>`}
  `, `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" onclick="applyBulkPerms()">Apply to ${who}</button>`);
  empPermTally();
  requestAnimationFrame(() => lucide.createIcons());
}
function bulkPermsPrefill(empId) {
  const e = allEmployees.find(x => String(x.id) === String(empId));
  _empModalPerms = e ? { ...(e.permissions || {}) } : {};
  const wrap = document.getElementById('perm-groups');
  if (wrap && _permCatalogue) wrap.innerHTML = _permCatalogue.groups.map(empPermGroup).join('');
  empPermTally();
  requestAnimationFrame(() => lucide.createIcons());
}
async function applyBulkPerms() {
  const targets = _empPicked.size ? [..._empPicked] : 'all';
  const perms = empBuildPerms();
  const r = await apiFetch('/api/dashboard/employees/permissions/bulk', {
    method: 'POST', body: JSON.stringify({ employee_ids: targets, permissions: perms }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) { alert('Error: ' + (d.error || r.status)); return; }
  hideModal();
  _empPicked = new Set();
  showAdminToast(`Permissions applied to ${d.updated} employee(s).`);
  loadEmployees();
}

// ── Advanced employee permissions editor ──────────────────────────────────────
// The section and action lists are not written here. They are fetched from
// /api/dashboard/permissions/catalogue, which the server builds from the same
// PERM_ACTIONS its route guards consult. Two copies of that list is how you end up
// with a checkbox that governs nothing, or a section that quietly has no switch —
// both of which this editor had before, for every section outside the CRM.
let _permCatalogue = null;
async function permCatalogue() {
  if (_permCatalogue) return _permCatalogue;
  try {
    const r = await apiFetch('/api/dashboard/permissions/catalogue');
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (!d || !Array.isArray(d.groups)) throw new Error('bad payload');
    _permCatalogue = d;
  } catch (_) {
    // Not cached, so the next open retries. The form still opens — an admin
    // renaming somebody should not be blocked by this — but it says the controls
    // are missing, and empBuildPerms leaves their permissions exactly as they were
    // rather than saving the empty set the absent checkboxes would imply.
    return { groups: [], stages: [], failed: true };
  }
  return _permCatalogue;
}
const EMP_DEAL_STAGES = ['lead','inquiry','quoted','negotiating','won','lost'];
function empScopeStatusOpts() {
  try { const o = leadCol('lead_status')?.options; if (Array.isArray(o) && o.length) return o.map(x => [x.key, x.label]); } catch (_) {}
  return (typeof AM_LEAD_STATUSES !== 'undefined') ? AM_LEAD_STATUSES : [['cold','Cold'],['warm','Warm'],['hot','Hot']];
}
function empCnorm(s) { return String(s == null ? '' : s).toLowerCase().trim().replace(/[\s-]+/g, '_'); }
function empActs(p, section) { return (p && p[section + 'Actions']) || {}; }

// One block per section: a master switch, and beneath it the exact actions. An
// employee record that predates a section has no key for it, so the catalogue
// carries the server's default and the block falls back to that rather than to
// "off" — otherwise opening and saving an old employee would silently strip
// everything the section list has grown since they were created.
// The Permissions column: how much access, then which — the three sections that
// name the job, and a count for the rest. A row of twenty-two chips would be the
// same wall the editor used to be.
function empPermsCell(p, scoped) {
  const secs = (_permCatalogue?.groups || []).flatMap(g => g.sections);
  const chip = (text, tone, title) => `<span class="perm-badge ${tone}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
  const scopeChip = scoped ? chip('Scoped', 'scoped', 'This employee only sees part of the leads/deals') : '';
  if (!secs.length) return chip('—', 'off') + scopeChip;   // catalogue unavailable
  const on = secs.filter(s => (Object.prototype.hasOwnProperty.call(p, s.key) ? p[s.key] === true : s.defaultOn));
  if (!on.length) return chip('No access', 'off') + scopeChip;
  if (on.length === secs.length) return chip('Full access', 'full') + scopeChip;
  const named = on.slice(0, 3).map(s => chip(s.label, 'on')).join('');
  return `${chip(on.length + ' of ' + secs.length, 'count', on.map(s => s.label).join(', '))}${named}` +
    (on.length > 3 ? chip('+' + (on.length - 3), 'off', on.slice(3).map(s => s.label).join(', ')) : '') + scopeChip;
}

// One row per section: a switch, the section's name, and — the point of the
// redesign — a live summary of what is actually granted, so twenty-two sections
// can be read at a glance instead of scanned as a hundred loose checkboxes. The
// exact actions are one click away rather than always on screen.
//
// The DOM contract is deliberately unchanged: a real `#perm-<section>` checkbox
// and real `.perm-act[data-section][data-action]` checkboxes, styled as a switch
// and as chips. empBuildPerms() reads exactly what it always read.
function empPermBlock(sec, p) {
  const on = p && Object.prototype.hasOwnProperty.call(p, sec.key) ? p[sec.key] === true : sec.defaultOn;
  const acts = empActs(p, sec.key);
  const known = p && Object.prototype.hasOwnProperty.call(p, sec.key + 'Actions');
  const chosen = sec.actions.filter(a => (known ? acts[a.key] : on));
  const hay = esc((sec.label + ' ' + sec.actions.map(a => a.label).join(' ')).toLowerCase());
  return `<div class="perm-row ${on ? 'on' : ''}" data-perm-section="${esc(sec.key)}" data-perm-hay="${hay}">
    <div class="perm-row-head" onclick="empPermExpand('${esc(sec.key)}', event)">
      <label class="perm-switch" onclick="event.stopPropagation()" title="${on ? 'Granted' : 'Not granted'}">
        <input type="checkbox" id="perm-${sec.key}" ${on ? 'checked' : ''} onchange="empToggleSection('${sec.key}')">
        <span class="perm-switch-track"><span class="perm-switch-knob"></span></span>
      </label>
      <div class="perm-row-name">${esc(sec.label)}</div>
      <div class="perm-row-sum" id="perm-${sec.key}-sum">${empPermSumHtml(sec, chosen, on)}</div>
      <i data-lucide="chevron-down" class="perm-row-chev"></i>
    </div>
    <div class="perm-acts" id="perm-${sec.key}-actions">
      <div class="perm-acts-bar">
        <span>Allowed actions</span>
        <button type="button" onclick="empSectionActs('${esc(sec.key)}',true)">All</button>
        <button type="button" onclick="empSectionActs('${esc(sec.key)}',false)">None</button>
      </div>
      <div class="perm-chips">
        ${sec.actions.map(a => `<label class="perm-chip">
          <input type="checkbox" class="perm-act" data-section="${esc(sec.key)}" data-action="${esc(a.key)}"
            ${(known ? acts[a.key] : on) ? 'checked' : ''} onchange="empPermTouched('${esc(sec.key)}')">
          <span>${esc(a.label)}</span></label>`).join('')}
      </div>
    </div>
  </div>`;
}
// "Full access" / "View, Create +2" / "No access" — the sentence an admin is
// actually trying to read off this screen.
function empPermSumHtml(sec, chosen, on) {
  if (!on) return '<span class="perm-sum-off">No access</span>';
  if (chosen.length === sec.actions.length) return '<span class="perm-sum-full">Full access</span>';
  if (!chosen.length) return '<span class="perm-sum-off">Section only — no actions</span>';
  const names = chosen.slice(0, 2).map(a => esc(a.label)).join(', ');
  return `<span class="perm-sum-part">${names}${chosen.length > 2 ? ` +${chosen.length - 2}` : ''}</span>`;
}
function empPermGroup(g) {
  return `<div class="perm-group" data-perm-group-box="${esc(g.group)}">
    <div class="perm-group-head">
      <div class="perm-group-name">${esc(g.group)}</div>
      <div class="perm-group-count" id="perm-count-${esc(g.group).replace(/\s+/g, '_')}"></div>
      <button type="button" class="perm-mini" onclick="empGroupSet('${esc(g.group)}',true)">All</button>
      <button type="button" class="perm-mini" onclick="empGroupSet('${esc(g.group)}',false)">None</button>
    </div>
    <div data-perm-group="${esc(g.group)}" class="perm-group-rows">
      ${g.sections.map(s => empPermBlock(s, _empModalPerms)).join('')}
    </div>
  </div>`;
}
// The toolbar: what this adds up to, a search across every section AND action
// name, and the presets — because ticking twenty-two sections by hand for each
// new starter is the chore that made this screen feel like work.
function empPermToolbar(cat) {
  const presets = (cat && cat.presets) || [];
  return `<div class="perm-toolbar">
    <div class="perm-toolbar-top">
      <div class="perm-search">
        <i data-lucide="search" style="width:14px;height:14px"></i>
        <input id="perm-search" placeholder="Find a section or action…" oninput="empPermSearch(this.value)">
      </div>
      <div class="perm-tally" id="perm-tally"></div>
      <button type="button" class="perm-mini" onclick="empAllSections(true)">Everything on</button>
      <button type="button" class="perm-mini" onclick="empAllSections(false)">Everything off</button>
    </div>
    ${presets.length ? `<div class="perm-presets">
      <span class="perm-presets-label">Start from</span>
      ${presets.map(p => `<button type="button" class="perm-preset" title="${esc(p.hint || '')}"
        onclick="empApplyPreset('${esc(p.key)}')">${esc(p.label)}</button>`).join('')}
    </div>` : ''}
  </div>`;
}
// Presets come from the server expanded into the permissions shape the editor
// saves, so applying one is a re-render of this form — no second set of rules.
function empApplyPreset(key) {
  const p = (_permCatalogue?.presets || []).find(x => x.key === key);
  if (!p) return;
  const scope = _empModalPerms.scope;
  _empModalPerms = { ...p.permissions, ...(scope ? { scope } : {}) };
  const wrap = document.getElementById('perm-groups');
  if (!wrap) return;
  wrap.innerHTML = _permCatalogue.groups.map(empPermGroup).join('');
  document.querySelectorAll('.perm-preset').forEach(b => b.classList.remove('active'));
  const btn = [...document.querySelectorAll('.perm-preset')].find(b => b.getAttribute('onclick').includes(`'${key}'`));
  if (btn) btn.classList.add('active');
  const term = document.getElementById('perm-search')?.value || '';
  if (term) empPermSearch(term);
  empPermTally();
  requestAnimationFrame(() => lucide.createIcons());
}
function empPermExpand(section, e) {
  if (e && e.target && e.target.closest('.perm-switch')) return;
  const row = document.querySelector(`[data-perm-section="${section}"]`);
  if (row) row.classList.toggle('open');
}
function empSectionActs(section, on) {
  document.querySelectorAll(`.perm-act[data-section="${section}"]`).forEach(cb => { cb.checked = on; });
  // Granting actions grants the section; removing every action is "section only",
  // not a silent revoke — the summary says which, so neither is a surprise.
  if (on) { const m = document.getElementById('perm-' + section); if (m) m.checked = true; }
  empPermTouched(section);
}
// Keep one row's summary, its on/off styling and the totals honest after any
// change, wherever the change came from.
function empPermTouched(section) {
  const sec = empPermSection(section);
  const row = document.querySelector(`[data-perm-section="${section}"]`);
  const master = document.getElementById('perm-' + section);
  if (!sec || !row || !master) return;
  const chosen = sec.actions.filter(a =>
    document.querySelector(`.perm-act[data-section="${section}"][data-action="${a.key}"]`)?.checked);
  row.classList.toggle('on', master.checked);
  const sum = document.getElementById('perm-' + section + '-sum');
  if (sum) sum.innerHTML = empPermSumHtml(sec, chosen, master.checked);
  empPermTally();
}
function empPermSection(key) {
  for (const g of (_permCatalogue?.groups || [])) {
    const s = g.sections.find(x => x.key === key);
    if (s) return s;
  }
  return null;
}
function empPermTally() {
  const rows = [...document.querySelectorAll('[data-perm-section]')];
  const on = rows.filter(r => document.getElementById('perm-' + r.dataset.permSection)?.checked);
  const acts = document.querySelectorAll('.perm-act:checked').length;
  const el = document.getElementById('perm-tally');
  if (el) el.innerHTML = `<strong>${on.length}</strong> of ${rows.length} sections · <strong>${acts}</strong> actions`;
  (_permCatalogue?.groups || []).forEach(g => {
    const box = document.querySelector(`[data-perm-group="${g.group}"]`);
    const cnt = document.getElementById('perm-count-' + g.group.replace(/\s+/g, '_'));
    if (!box || !cnt) return;
    const total = g.sections.length;
    const live = g.sections.filter(s => document.getElementById('perm-' + s.key)?.checked).length;
    cnt.textContent = `${live}/${total}`;
    cnt.classList.toggle('none', live === 0);
    cnt.classList.toggle('all', live === total);
  });
}
// Search matches a section OR any of its action names, and hides a whole group
// once nothing in it matches, so the list stays readable while filtered.
function empPermSearch(term) {
  const q = String(term || '').trim().toLowerCase();
  document.querySelectorAll('[data-perm-section]').forEach(row => {
    const hit = !q || (row.dataset.permHay || '').includes(q);
    row.style.display = hit ? '' : 'none';
    if (q && hit && (row.dataset.permHay || '').includes(q)
        && !row.dataset.permHay.startsWith(q)) row.classList.add('open');
  });
  document.querySelectorAll('[data-perm-group-box]').forEach(box => {
    const any = [...box.querySelectorAll('[data-perm-section]')].some(r => r.style.display !== 'none');
    box.style.display = any ? '' : 'none';
  });
}
function empAllSections(on) {
  (_permCatalogue?.groups || []).forEach(g => empGroupSet(g.group, on, true));
  empPermTally();
}
// Whole group on or off in one click — with twenty-two sections, setting up a new
// starter one checkbox at a time is the kind of chore that gets skipped.
function empGroupSet(group, on, quiet) {
  const wrap = document.querySelector(`[data-perm-group="${group}"]`);
  if (!wrap) return;
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = on; });
  wrap.querySelectorAll('[data-perm-section]').forEach(r => empPermTouched(r.dataset.permSection));
  if (!quiet) empPermTally();
}
function empToggleSection(section) {
  const on = document.getElementById('perm-' + section)?.checked;
  // Turning a section ON with no actions ticked ⇒ default to all actions (matches "master on = full").
  if (on) {
    const boxes = [...document.querySelectorAll(`.perm-act[data-section="${section}"]`)];
    if (boxes.length && !boxes.some(b => b.checked)) boxes.forEach(b => { b.checked = true; });
  }
  empPermTouched(section);
}
let _empModalPerms = {};
async function openEmpModal(id) {
  const cat = await permCatalogue();
  const e = id ? allEmployees.find(x => x.id === id) : null;
  const p = _empModalPerms = { ...(e?.permissions || {}) };
  const scope = (p.scope && typeof p.scope === 'object') ? p.scope : { assignedOnly:false, dealStages:[], leadStatuses:[] };
  const scopeStatuses = (scope.leadStatuses || []).map(empCnorm);
  const stages = Array.isArray(cat.stages) && cat.stages.length ? cat.stages : EMP_DEAL_STAGES;
  showModal(e ? 'Edit Employee' : 'Create Employee', `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Full Name *</label><input class="form-control" id="em-name" value="${esc(e?.name||'')}" placeholder="e.g. Sara Ahmed"></div>
      <div class="form-group"><label class="form-label">Username *</label><input class="form-control" id="em-username" value="${esc(e?.username||'')}" placeholder="e.g. sara.ahmed"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Password ${e ? '(leave blank to keep)' : '*'}</label><input class="form-control" id="em-password" type="password" placeholder="${e ? 'New password…' : 'Set password…'}"></div>
      <div class="form-group"><label class="form-label">Email</label><input class="form-control" id="em-email" value="${esc(e?.email||'')}" placeholder="sara@company.com"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Job Title</label><input class="form-control" id="em-job-title" value="${esc(e?.job_title||'')}" placeholder="e.g. Sales Manager"></div>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label class="form-label">Access</label>
      ${cat.failed
        ? `<div class="error-msg" style="display:block">Could not load the permission list, so it cannot be edited here right now. Saving will leave this employee's access unchanged.</div>`
        : `<div class="perm-editor">
            ${empPermToolbar(cat)}
            <div id="perm-groups">${cat.groups.map(empPermGroup).join('')}</div>
          </div>`}
    </div>
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">Data scope</label>
      <div class="perm-scope-hint">Limit which leads and deals this employee can see. Leave everything unticked for no limit.</div>
      <div class="perm-scope">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="scope-assigned" ${scope.assignedOnly?'checked':''} style="accent-color:var(--primary);width:15px;height:15px"> Only leads/deals <strong>assigned to this employee</strong>
        </label>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:5px">Only leads whose deal is in these stage(s):</div>
          <div class="perm-chips">
            ${stages.map(s => `<label class="perm-chip"><input type="checkbox" class="scope-stage" value="${esc(s)}" ${(scope.dealStages||[]).includes(s)?'checked':''}> <span>${esc(s.charAt(0).toUpperCase()+s.slice(1))}</span></label>`).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:5px">Only leads with these status(es):</div>
          <div class="perm-chips">
            ${empScopeStatusOpts().map(([k,l]) => `<label class="perm-chip"><input type="checkbox" class="scope-status" value="${esc(k)}" ${scopeStatuses.includes(empCnorm(k))?'checked':''}> <span>${esc(l)}</span></label>`).join('')}
          </div>
        </div>
      </div>
    </div>
  `, `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEmployee(${id||'null'})">Save</button>`);
  empPermTally();
  requestAnimationFrame(() => lucide.createIcons());
}

function empBuildPerms() {
  // No catalogue means the form rendered no checkboxes. Reading them back would
  // produce "nothing is allowed" and quietly strip an employee's access on a save
  // that was only meant to fix a typo in their name.
  if (!_permCatalogue) return _empModalPerms;
  const perms = {};
  // Read back from the catalogue that rendered the form, so a section added on the
  // server appears here without this function being touched.
  for (const g of (_permCatalogue.groups || [])) {
    for (const sec of g.sections) {
      perms[sec.key] = document.getElementById('perm-' + sec.key)?.checked || false;
      const acts = {};
      document.querySelectorAll(`.perm-act[data-section="${sec.key}"]`).forEach(cb => { acts[cb.dataset.action] = cb.checked; });
      perms[sec.key + 'Actions'] = acts;
    }
  }
  perms.scope = {
    assignedOnly: document.getElementById('scope-assigned')?.checked || false,
    dealStages: [...document.querySelectorAll('.scope-stage:checked')].map(c => c.value),
    leadStatuses: [...document.querySelectorAll('.scope-status:checked')].map(c => c.value),
  };
  return perms; // server normEmpPerms() validates/normalizes
}
async function saveEmployee(id) {
  const body = {
    name:          document.getElementById('em-name').value.trim(),
    username:      document.getElementById('em-username').value.trim(),
    password:      document.getElementById('em-password').value,
    email:         document.getElementById('em-email').value.trim(),
    job_title:     document.getElementById('em-job-title').value.trim(),
    permissions: empBuildPerms(),
  };
  if (!body.name || !body.username) { alert('Name and username are required'); return; }
  if (!id && !body.password) { alert('Password is required for new employees'); return; }
  if (!body.password) delete body.password;
  const r = await apiFetch(id ? `/api/dashboard/employees/${id}` : '/api/dashboard/employees',
    { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  const data = await r.json();
  if (data.error) { alert('Error: ' + data.error); return; }
  hideModal(); loadEmployees();
}

async function deleteEmployee(id) {
  if (!confirm('Delete this employee account? They will no longer be able to log in.')) return;
  await apiFetch(`/api/dashboard/employees/${id}`, { method: 'DELETE' });
  loadEmployees();
}

// ── Requests ──────────────────────────────────────────────────────────────────
let allRequests = [];
const reqStatusColors = { pending: 'badge-todo', in_review: 'badge-in_progress', approved: 'badge-done', rejected: 'badge-high' };
const reqStatusLabels = { pending: 'Pending', in_review: 'In Review', approved: 'Approved', rejected: 'Rejected' };

function reqAssigneeName(r) {
  if (r.assignee_id) {
    const e = (employeesForTasks || []).find(x => String(x.id) === String(r.assignee_id));
    return e ? e.name : `#${r.assignee_id}`;
  }
  return r.assigned_to || '';
}

async function loadRequests() {
  const c = document.getElementById('requests-table-container');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    await preloadEmployeesForTasks();
    const r = await apiFetch('/api/dashboard/requests'); allRequests = await r.json();
    renderRequestsTable();
  } catch (e) { c.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; }
  requestAnimationFrame(() => lucide.createIcons());
}

function renderRequestsTable() {
  const c = document.getElementById('requests-table-container');
  if (!allRequests.length) { c.innerHTML = '<div class="empty-state"><div class="empty-icon" style="font-size:44px">—</div><div class="empty-title">No requests yet</div></div>'; return; }
  c.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>ID</th><th>Title</th><th>Submitted By</th><th>Priority</th><th>Status</th><th>Assigned To</th><th>Created</th><th>Actions</th></tr></thead>
    <tbody>${allRequests.map(r => `<tr>
      <td class="task-id">#${r.id}</td>
      <td><div class="task-title">${esc(r.title)}</div>${r.description ? `<div class="task-desc">${esc(r.description)}</div>` : ''}${r.category ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(r.category)}</div>` : ''}</td>
      <td style="font-size:13px"><span style="background:rgba(99,102,241,.12);color:var(--primary);padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600">${esc(r.created_by || '—')}</span></td>
      <td>${priorityBadge(r.priority)}</td>
      <td><span class="badge ${reqStatusColors[r.status] || 'badge-todo'}">${reqStatusLabels[r.status] || r.status}</span></td>
      <td style="font-size:12px;color:var(--muted)">${esc(reqAssigneeName(r) || '—')}</td>
      <td style="font-size:12px;color:var(--muted)">${new Date(r.created_at).toLocaleDateString()}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline" style="padding:4px 10px;font-size:11px" onclick="openRequestComments(${r.id})" title="Comments"><i data-lucide="message-square" style="width:13px;height:13px"></i></button>
        <button class="btn btn-outline" style="padding:4px 10px;font-size:11px;margin-left:4px" onclick="editRequest(${r.id})">Edit</button>
        <button class="btn btn-danger"  style="padding:4px 10px;font-size:11px;margin-left:4px" onclick="deleteRequest(${r.id})">Delete</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function openRequestModal(id) {
  await preloadEmployeesForTasks();
  const req = id ? allRequests.find(r => r.id === id) : null;
  const empOpts = '<option value="">— Unassigned —</option>' +
    (employeesForTasks || []).map(e => `<option value="${e.id}"${String(req?.assignee_id||'')===String(e.id)?' selected':''}>${esc(e.name)}</option>`).join('');
  showModal(req ? 'Edit Request' : 'New Request', `
    <div class="form-group"><label class="form-label">Title *</label><input class="form-control" id="req-title" value="${esc(req?.title || '')}" placeholder="Request title…"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-control" id="req-desc" rows="3" placeholder="Details…">${esc(req?.description || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Priority</label>
        <select class="form-control" id="req-priority">
          ${['high','medium','low'].map(p => `<option value="${p}"${(req?.priority||'medium')===p?' selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Status</label>
        <select class="form-control" id="req-status">
          ${Object.entries(reqStatusLabels).map(([v,l]) => `<option value="${v}"${(req?.status||'pending')===v?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Assign to employee</label>
      <select class="form-control" id="req-assignee">${empOpts}</select>
    </div>
  `, `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRequest(${id || 'null'})">Save</button>`);
}
function editRequest(id) { openRequestModal(id); }

async function saveRequest(id) {
  const body = { title: document.getElementById('req-title').value.trim(), description: document.getElementById('req-desc').value.trim(), priority: document.getElementById('req-priority').value, status: document.getElementById('req-status').value, assignee_id: document.getElementById('req-assignee').value || null };
  if (!body.title) { alert('Title is required'); return; }
  const url = id ? `/api/dashboard/requests/${id}` : '/api/dashboard/requests';
  const method = id ? 'PUT' : 'POST';
  await apiFetch(url, { method, body: JSON.stringify(body) });
  hideModal(); loadRequests();
}

// ── Request comments (admin) ──────────────────────────────────────────────────
let _rcReqId = null;
async function openRequestComments(id) {
  _rcReqId = id;
  _cmtPendingFile = null;
  await preloadEmployeesForTasks();
  const r = allRequests.find(x => x.id === id);
  showModal(`Comments — ${r ? r.title : '#' + id}`, `
    <div id="rc-list" style="max-height:300px;overflow-y:auto;display:grid;gap:10px;padding:2px"><div class="loading"><div class="spinner"></div></div></div>
    <div id="cmt-attach-preview" style="display:none;margin:12px 0 0" class="chat-attach-preview"><span><i data-lucide="paperclip" style="width:14px;height:14px"></i></span><span class="chat-attach-preview-name" id="cmt-attach-name"></span><button class="chat-attach-remove" onclick="cmtRemoveAttach()" title="Remove">×</button></div>
    <div style="margin-top:12px;position:relative">
      <div id="rc-mention-box" class="lead-menu" style="position:absolute;bottom:100%;left:0;margin-bottom:4px;max-height:180px"></div>
      <div class="comment-composer">
        <textarea id="rc-input" rows="2" placeholder="Write a comment…  @name to mention" oninput="rcMentionHint(this)"></textarea>
        <div class="comment-composer-bar">
          <input type="file" id="cmt-file-input" style="display:none" onchange="cmtFileSelected(this)">
          <button class="composer-icon-btn" onclick="document.getElementById('cmt-file-input').click()" title="Attach a file"><i data-lucide="paperclip" style="width:15px;height:15px"></i></button>
        </div>
      </div>
    </div>`,
    `<button class="btn btn-outline" onclick="hideModal()">Close</button>
     <button class="btn btn-primary" onclick="postRequestCommentUi()">Comment</button>`);
  loadRequestComments();
}
async function loadRequestComments() {
  const rows = await apiFetch(`/api/dashboard/requests/${_rcReqId}/comments`).then(r => r.json()).catch(() => []);
  const list = document.getElementById('rc-list');
  if (!list) return;
  list.innerHTML = (Array.isArray(rows) && rows.length) ? rows.map(c => `
    <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:8px 12px">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);margin-bottom:3px"><strong style="color:var(--text)">${esc(c.author_name || '—')}</strong><span>${new Date(c.created_at).toLocaleString()}</span></div>
      ${c.body ? `<div style="font-size:13px;white-space:pre-wrap;word-break:break-word">${tcRenderBody(c.body)}</div>` : ''}
      ${commentAttachHtml(c)}${googleUnfurl(c.body)}
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px;text-align:center;padding:14px">No comments yet.</div>';
  list.scrollTop = list.scrollHeight;
}
function rcMentionHint(ta) {
  const box = document.getElementById('rc-mention-box');
  if (!box) return;
  const m = ta.value.slice(0, ta.selectionStart).match(/@([a-zA-Z ]{0,30})$/);
  if (!m) { box.classList.remove('open'); return; }
  const q = m[1].toLowerCase();
  const hits = (employeesForTasks || []).filter(e => (e.name || '').toLowerCase().startsWith(q)).slice(0, 6);
  if (!hits.length) { box.classList.remove('open'); return; }
  box.innerHTML = hits.map(e => `<button type="button" onclick="rcInsertMention('${esc(e.name)}')">@ ${esc(e.name)}</button>`).join('');
  box.classList.add('open');
}
function rcInsertMention(name) {
  const ta = document.getElementById('rc-input');
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos).replace(/@[a-zA-Z ]{0,30}$/, '@' + name + ' ') + ta.value.slice(pos);
  document.getElementById('rc-mention-box')?.classList.remove('open');
  ta.focus();
}
async function postRequestCommentUi() {
  const ta = document.getElementById('rc-input');
  const body = ta.value.trim();
  if (!body && !_cmtPendingFile) return;
  const payload = { body };
  if (_cmtPendingFile) { payload.file_url = _cmtPendingFile.url; payload.file_name = _cmtPendingFile.name; payload.file_size = _cmtPendingFile.size; payload.file_type = _cmtPendingFile.type; }
  const r = await apiFetch(`/api/dashboard/requests/${_rcReqId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return alert('Error: ' + (e.error || r.status)); }
  ta.value = ''; cmtRemoveAttach();
  loadRequestComments();
}

async function deleteRequest(id) {
  if (!confirm('Delete this request?')) return;
  await apiFetch(`/api/dashboard/requests/${id}`, { method: 'DELETE' });
  loadRequests();
}

// ── Hours Logs ────────────────────────────────────────────────────────────────
let allHours = [], allTasksForHours = [];

async function loadHours() {
  const c = document.getElementById('hours-table-container');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const [hours, tasks] = await Promise.all([
      apiFetch('/api/dashboard/hours').then(r => r.json()),
      apiFetch('/api/dashboard/tasks').then(r => r.json()),
    ]);
    allHours = hours; allTasksForHours = tasks;
    renderHoursTable();
  } catch (e) { c.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; }
  requestAnimationFrame(() => lucide.createIcons());
}

function renderHoursTable() {
  const total = allHours.reduce((s, h) => s + parseFloat(h.hours || 0), 0);
  document.getElementById('hours-summary').innerHTML = `
    <div class="hours-card"><div class="hours-card-val">${total.toFixed(1)}h</div><div class="hours-card-lbl">Total Hours Logged</div></div>
    <div class="hours-card"><div class="hours-card-val" style="color:var(--success)">${allHours.length}</div><div class="hours-card-lbl">Log Entries</div></div>`;
  const c = document.getElementById('hours-table-container');
  if (!allHours.length) { c.innerHTML = '<div class="empty-state"><div class="empty-icon" style="font-size:44px">—</div><div class="empty-title">No hours logged yet</div></div>'; return; }
  c.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Task</th><th>Channel</th><th>User ID</th><th>Hours</th><th>Note</th><th>Date</th><th></th></tr></thead>
    <tbody>${allHours.map(h => `<tr>
      <td class="task-title">${esc(h.tasks?.title || `Task #${h.task_id}`)}</td>
      <td class="channel-tag">${esc(h.tasks?.channel_name || '—')}</td>
      <td style="font-size:11px;font-family:monospace;color:var(--muted)">${esc(h.user_id)}</td>
      <td><strong>${parseFloat(h.hours).toFixed(1)}h</strong></td>
      <td style="font-size:12px;color:var(--muted)">${esc(h.description || '—')}</td>
      <td style="font-size:12px;color:var(--muted)">${new Date(h.logged_at).toLocaleDateString()}</td>
      <td><button class="btn btn-danger" style="padding:4px 10px;font-size:11px" onclick="deleteHours(${h.id})">Delete</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function openHoursModal() {
  const taskOptions = allTasksForHours.map(t => `<option value="${t.id}">#${t.id} — ${esc(t.title)}</option>`).join('');
  showModal('Log Hours', `
    <div class="form-group"><label class="form-label">Task *</label><select class="form-control" id="h-task"><option value="">Select task…</option>${taskOptions}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">User ID *</label><input class="form-control" id="h-user" placeholder="U012345…"></div>
      <div class="form-group"><label class="form-label">Hours *</label><input class="form-control" id="h-hours" type="number" min="0.25" step="0.25" placeholder="e.g. 2.5"></div>
    </div>
    <div class="form-group"><label class="form-label">Note</label><input class="form-control" id="h-note" placeholder="What was done…"></div>
  `, `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveHours()">Log Hours</button>`);
}

async function saveHours() {
  const body = { task_id: document.getElementById('h-task').value, user_id: document.getElementById('h-user').value.trim(), hours: document.getElementById('h-hours').value, description: document.getElementById('h-note').value.trim() };
  if (!body.task_id || !body.user_id || !body.hours) { alert('Task, user ID and hours are required'); return; }
  await apiFetch('/api/dashboard/hours', { method: 'POST', body: JSON.stringify(body) });
  hideModal(); loadHours();
}

async function deleteHours(id) {
  if (!confirm('Remove this hours entry?')) return;
  await apiFetch(`/api/dashboard/hours/${id}`, { method: 'DELETE' });
  loadHours();
}

// ── Email ─────────────────────────────────────────────────────────────────────
function connectGmail() {
  window.location.href = '/api/email/connect?_t=' + encodeURIComponent(authToken || '');
}

let emailInboxCache = [];

async function loadEmail() {
  const c = document.getElementById('email-content');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Checking Gmail…</div>';
  try {
    const status = await apiFetch('/api/email/status').then(r => r.json());
    if (!status.configured) {
      c.innerHTML = `<div class="email-connect-card">
        <div class="email-icon"></div><div class="email-title">Connect Gmail</div>
        <div class="email-sub">Add these env vars in Railway then redeploy:</div>
        <pre style="text-align:left;background:var(--bg);padding:12px;border-radius:8px;font-size:12px;margin-bottom:16px">GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=...\nAPP_URL=https://your-app.railway.app</pre>
      </div>`; return;
    }
    if (!status.connected) {
      c.innerHTML = `<div class="email-connect-card">
        <div class="email-icon"></div><div class="email-title">Connect Your Gmail</div>
        <div class="email-sub">Sign in with Google to view your inbox in this dashboard.</div>
        <a href="#" onclick="connectGmail()" class="btn btn-primary btn-full" style="text-decoration:none;display:inline-flex;justify-content:center">Connect Gmail</a>
      </div>`; return;
    }
    // Connected — render inbox layout
    c.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:15px">${esc(status.name?.[0]||'?')}</div>
          <div><div style="font-weight:600;font-size:14px">${esc(status.name)}</div><div style="font-size:12px;color:var(--muted)">${esc(status.email)}</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="openCompose()" style="font-size:13px">Compose</button>
          <button class="btn btn-outline" onclick="disconnectEmail()" style="font-size:12px">Disconnect</button>
        </div>
      </div>
      <div class="email-split" id="email-split">
        <div class="email-inbox-pane">
          <div class="table-card">
            <div class="table-header"><span class="table-title">Inbox</span><button class="btn btn-outline" onclick="loadEmail()" style="font-size:11px;padding:4px 10px">Refresh</button></div>
            <div id="inbox-list"><div class="loading"><div class="spinner"></div></div></div>
          </div>
        </div>
        <div class="email-detail-pane" id="email-view-panel">
          <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:40px;text-align:center;color:var(--muted)">
            <div style="font-size:32px;margin-bottom:8px"></div>
            <div style="font-size:14px">Select an email to read it</div>
          </div>
        </div>
      </div>`;
    const msgs = await apiFetch('/api/email/messages').then(r => r.json());
    emailInboxCache = Array.isArray(msgs) ? msgs : [];
    renderInboxList();
  } catch (e) { c.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; }
  requestAnimationFrame(() => lucide.createIcons());
}

function renderInboxList() {
  const inbox = document.getElementById('inbox-list');
  if (!inbox) return;
  if (!emailInboxCache.length) { inbox.innerHTML = '<div class="empty-state" style="padding:24px">No messages</div>'; return; }
  inbox.innerHTML = emailInboxCache.map(m => `
    <div class="inbox-item" onclick="openEmail('${esc(m.id)}')" style="cursor:pointer;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.04);display:flex;gap:10px;align-items:flex-start;transition:background .15s" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background=''">
      ${m.unread ? '<div class="unread-dot" style="width:8px;height:8px;background:var(--primary);border-radius:50%;flex-shrink:0;margin-top:5px"></div>' : '<div style="width:8px;flex-shrink:0"></div>'}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:2px">
          <span style="font-size:13px;font-weight:${m.unread?'700':'500'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${esc(m.from.replace(/<.*>/,'').trim()||m.from)}</span>
          <span style="font-size:11px;color:var(--muted);flex-shrink:0">${new Date(m.date).toLocaleDateString()}</span>
        </div>
        <div style="font-size:12px;font-weight:${m.unread?'600':'400'};margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.subject||'(no subject)')}</div>
        <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.snippet||'')}</div>
      </div>
    </div>`).join('');
}

function emailGoBack() {
  const split = document.getElementById('email-split');
  if (split) split.classList.remove('show-detail');
}

async function openEmail(id) {
  const panel = document.getElementById('email-view-panel');
  if (!panel) return;
  const split = document.getElementById('email-split');
  if (split) split.classList.add('show-detail');
  panel.innerHTML = '<div class="loading" style="padding:40px"><div class="spinner"></div></div>';
  try {
    const msg = await apiFetch(`/api/email/messages/${id}`).then(r => r.json());
    if (msg.error) throw new Error(msg.error);
    const fromEmail = msg.from.match(/<(.+)>/)?.[1] || msg.from;
    const bodyHtml = msg.isHtml
      ? `<iframe srcdoc="${esc(msg.body)}" style="width:100%;border:none;min-height:400px;background:#fff;border-radius:0 0 var(--radius) var(--radius)" onload="this.style.height=this.contentDocument.body.scrollHeight+40+'px'"></iframe>`
      : `<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:var(--text);line-height:1.6">${esc(msg.body||'(empty)')}</pre>`;
    panel.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border)">
          <button class="email-back-btn btn btn-outline" onclick="emailGoBack()" style="margin-bottom:14px;font-size:12px;padding:5px 12px">← Back</button>
          <div style="font-size:16px;font-weight:700;margin-bottom:12px;word-break:break-word">${esc(msg.subject||'(no subject)')}</div>
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="font-size:13px;min-width:0;flex:1">
              <div style="color:var(--muted);margin-bottom:2px;word-break:break-all">From: <span style="color:var(--text)">${esc(msg.from)}</span></div>
              ${msg.to ? `<div style="color:var(--muted);word-break:break-all">To: <span style="color:var(--text)">${esc(msg.to)}</span></div>` : ''}
              <div style="color:var(--muted);font-size:12px;margin-top:4px">${new Date(msg.date).toLocaleString()}</div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
              <button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="openReply('${esc(msg.id)}','${esc(msg.threadId)}','${esc(fromEmail)}','${esc(msg.subject||'')}','${esc(msg.messageId||'')}')">Reply</button>
              <button class="btn btn-outline" style="font-size:12px;padding:6px 14px" onclick="openCompose('${esc(fromEmail)}')">Forward</button>
            </div>
          </div>
        </div>
        <div style="padding:${msg.isHtml?'0':'20px 24px'};max-width:100%;overflow-x:auto">${bodyHtml}</div>
      </div>`;
  } catch (e) { panel.innerHTML = `<div class="error-msg" style="margin:0">${esc(e.message)}</div>`; }
}

function openReply(msgId, threadId, to, subject, messageId) {
  const replySubject = subject.startsWith('Re:') ? subject : 'Re: ' + subject;
  showEmailCompose(to, replySubject, '', threadId, messageId);
}

function openCompose(to = '') {
  showEmailCompose(to, '', '');
}

function showEmailCompose(to, subject, body, threadId = '', inReplyTo = '') {
  showModal(threadId ? 'Reply' : 'New Email', `
    <div class="form-group"><label class="form-label">To *</label><input class="form-control" id="em-to" value="${esc(to)}" placeholder="recipient@example.com"></div>
    <div class="form-group"><label class="form-label">Subject *</label><input class="form-control" id="em-subject" value="${esc(subject)}" placeholder="Subject…"></div>
    <div class="form-group"><label class="form-label">Message *</label><textarea class="form-control" id="em-body" rows="8" placeholder="Write your message…" style="resize:vertical">${esc(body)}</textarea></div>
    <input type="hidden" id="em-thread" value="${esc(threadId)}">
    <input type="hidden" id="em-inreplyto" value="${esc(inReplyTo)}">
  `, `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" id="em-send-btn" onclick="sendEmail()">Send</button>`);
}

async function sendEmail() {
  const btn = document.getElementById('em-send-btn');
  const to       = document.getElementById('em-to').value.trim();
  const subject  = document.getElementById('em-subject').value.trim();
  const body     = document.getElementById('em-body').value.trim();
  const threadId = document.getElementById('em-thread').value;
  const inReplyTo = document.getElementById('em-inreplyto').value;
  if (!to || !subject || !body) { alert('To, subject and message are required'); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await apiFetch('/api/email/send', { method: 'POST', body: JSON.stringify({ to, subject, body, threadId: threadId||undefined, inReplyTo: inReplyTo||undefined }) });
    const d = await r.json();
    if (d.error) { alert('Failed to send: ' + d.error); return; }
    hideModal();
    alert('Email sent successfully!');
  } catch (e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Send'; }
}

async function disconnectEmail() {
  await apiFetch('/api/email/disconnect', { method: 'POST' });
  loadEmail();
}

// ── Drive / Sheets ────────────────────────────────────────────────────────────
function driveFileIcon(mimeType) {
  if (!mimeType) return '<i data-lucide="paperclip" style="width:16px;height:16px;vertical-align:middle"></i>';
  if (mimeType === 'application/vnd.google-apps.folder') return '<i data-lucide="folder" style="width:16px;height:16px;vertical-align:middle"></i>';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return '<i data-lucide="sheet" style="width:16px;height:16px;vertical-align:middle;color:var(--success)"></i>';
  if (mimeType === 'application/vnd.google-apps.document') return '<i data-lucide="file-text" style="width:16px;height:16px;vertical-align:middle;color:var(--info)"></i>';
  if (mimeType === 'application/vnd.google-apps.presentation') return '<i data-lucide="presentation" style="width:16px;height:16px;vertical-align:middle;color:var(--warning)"></i>';
  if (mimeType === 'application/pdf') return '<i data-lucide="file-type" style="width:16px;height:16px;vertical-align:middle;color:var(--danger)"></i>';
  if (mimeType.startsWith('image/')) return '<i data-lucide="image" style="width:16px;height:16px;vertical-align:middle;color:var(--primary)"></i>';
  if (mimeType.startsWith('video/')) return '<i data-lucide="video" style="width:16px;height:16px;vertical-align:middle;color:var(--warning)"></i>';
  if (mimeType.startsWith('audio/')) return '<i data-lucide="music" style="width:16px;height:16px;vertical-align:middle;color:var(--primary)"></i>';
  return '<i data-lucide="paperclip" style="width:16px;height:16px;vertical-align:middle"></i>';
}

function renderDriveFiles(files, containerId, disconnectFn) {
  const c = document.getElementById(containerId);
  if (!files.length) { c.innerHTML += '<div class="empty-state" style="padding:24px 0">No files found</div>'; return; }
  const rows = files.map(f => `
    <tr>
      <td style="padding:12px 16px;font-size:13px">${driveFileIcon(f.mimeType)} ${esc(f.name)}</td>
      <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—'}</td>
      <td style="padding:12px 16px;text-align:right">
        ${f.webViewLink ? `<a href="${f.webViewLink}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:12px;padding:4px 12px;text-decoration:none">Open ↗</a>` : ''}
      </td>
    </tr>`).join('');
  const existing = c.querySelector('.table-card');
  if (existing) existing.querySelector('tbody').innerHTML = rows;
}

async function loadDriveSection(statusApi, filesApi, disconnectFn, contentId, connectFn, title, icon) {
  const c = document.getElementById(contentId);
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  try {
    const status = await apiFetch(statusApi).then(r => r.json());
    if (!status.configured) {
      c.innerHTML = `<div class="email-connect-card">
        <div class="email-icon">${icon}</div><div class="email-title">Connect Google Drive</div>
        <div class="email-sub">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars then redeploy.</div>
      </div>`; return;
    }
    if (!status.connected) {
      c.innerHTML = `<div class="email-connect-card">
        <div class="email-icon">${icon}</div><div class="email-title">${title}</div>
        <div class="email-sub">Connect your Google account to browse your Drive files.</div>
        <a href="#" onclick="${connectFn}()" class="btn btn-primary btn-full" style="text-decoration:none;display:inline-flex;justify-content:center">Connect Google Drive</a>
      </div>`; return;
    }
    const files = await apiFetch(filesApi).then(r => r.json());
    _adminDriveViewFiles = files;
    c.innerHTML = `
      <div class="page-body">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:15px">${esc(status.name?.[0]||'?')}</div>
            <div><div style="font-weight:600;font-size:14px">${esc(status.name)}</div><div style="font-size:12px;color:var(--muted)">${esc(status.email)}</div></div>
          </div>
          <button class="btn btn-outline" onclick="${disconnectFn}()" style="font-size:12px">Disconnect</button>
        </div>
        ${status.canUpload === false ? `<div class="error-msg" style="display:block;margin-bottom:16px">
          This connection was authorised before uploads were supported, so attaching a client
          file will fail. <a href="#" onclick="${connectFn}();return false" style="color:var(--primary)">Reconnect</a> to fix it.
        </div>` : ''}
        <div class="table-card">
          <div class="table-header"><span class="table-title">${icon} ${title}</span><span style="font-size:12px;color:var(--muted)">${files.length} file${files.length!==1?'s':''}</span></div>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr>
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Name</th>
              <th style="padding:10px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Modified</th>
              <th style="padding:10px 16px;border-bottom:1px solid var(--border)"></th>
            </tr></thead>
            <tbody>${files.map((f, i) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
                <td style="padding:12px 16px;font-size:13px">${driveFileIcon(f.mimeType)} ${esc(f.name)}</td>
                <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—'}</td>
                <td style="padding:12px 16px;text-align:right;white-space:nowrap">
                  <button onclick="adminOpenDriveViewer(${i})" class="btn btn-primary btn-sm" style="font-size:11px;padding:4px 10px;margin-right:5px">View</button>
                  ${f.webViewLink ? `<a href="${esc(f.webViewLink)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:11px;padding:4px 10px;text-decoration:none">Open ↗</a>` : ''}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (e) { c.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; }
}

function connectDrive()  { window.location.href = '/api/drive/connect?_t=' + encodeURIComponent(authToken || ''); }
async function disconnectDrive()  { await apiFetch('/api/drive/disconnect', { method: 'POST' }); loadDrive(); }
function loadDrive()  { loadDriveSection('/api/drive/status',  '/api/drive/files',  'disconnectDrive',  'drive-content',  'connectDrive',  'My Drive',   'Drive'); }
function loadSheets() { loadDriveSection('/api/drive/status',  '/api/drive/sheets', 'disconnectDrive',  'sheets-content', 'connectDrive',  'My Sheets',  'Sheets'); }

let _adminDriveViewFiles = [];
function adminDriveEmbedUrl(f) {
  if (!f?.id) return '';
  if (f.mimeType === 'application/vnd.google-apps.spreadsheet')  return `https://docs.google.com/spreadsheets/d/${f.id}/preview`;
  if (f.mimeType === 'application/vnd.google-apps.document')     return `https://docs.google.com/document/d/${f.id}/preview`;
  if (f.mimeType === 'application/vnd.google-apps.presentation') return `https://docs.google.com/presentation/d/${f.id}/preview`;
  return `https://drive.google.com/file/d/${f.id}/preview`;
}
function adminOpenDriveViewer(idx) {
  const f = _adminDriveViewFiles[idx];
  if (!f) return;
  const url = adminDriveEmbedUrl(f);
  if (!url) return;
  document.getElementById('admin-drive-viewer-title').textContent = f.name;
  document.getElementById('admin-drive-viewer-frame').src = url;
  document.getElementById('admin-drive-viewer-ext-link').href = f.webViewLink || '#';
  document.getElementById('admin-drive-viewer-overlay').style.display = 'flex';
}
function adminCloseDriveViewer() {
  document.getElementById('admin-drive-viewer-overlay').style.display = 'none';
  document.getElementById('admin-drive-viewer-frame').src = 'about:blank';
}
function adminJoinMeeting() {
  const code = document.getElementById('admin-meet-code').value.trim().replace(/\s/g,'');
  if (!code) return;
  window.open('https://meet.google.com/' + code, '_blank', 'noopener');
}

// ── Notification center state ─────────────────────────────────────────────────
// Declared BEFORE the init IIFE: checkAuth() → showAuthScreen() → closeNotifStream()
// runs synchronously on a token-less load, and a later `let` would still be in its
// temporal dead zone — crashing init and blanking the whole page.
let notifSse    = null;
let notifItems  = [];
let notifUnread = 0;

// ── Init ─────────────────────────────────────────────────────────────────────
// The whole sequence sits in one try/catch because both #app and #auth-screen
// start hidden: any unhandled throw in here used to leave the page with nothing
// visible at all — the "blank page until I refresh a few times" report.
(async () => {
  try {
    lucide.createIcons();
    const ok = await checkAuth();
    if (!ok) return;
    adminStartPresenceHeartbeat();
    loadNotifs();
    openNotifStream();
    initSidebarState();
    // Cosmetic — a failure here must not stop the app from opening.
    try { await loadNavConfig(); } catch (_) {}
    gchatInitNav();          // Google Chat nav appears only when it's configured
    const validPages = ['home','tasks','employees','requests','submissions','hours','email','drive','sheets','chat','calendar','meet','quotation','customers','deals','stock','suppliers','rfqs','contracts','purchaseorders','reports','automations','deletions','whatsapp','gchat','notif'];
    navigate(lastPage(validPages, 'home'));
  } catch (e) {
    console.error('[boot]', e);
    // Whatever happened, land somewhere visible with a way out.
    try { navigate('home'); document.getElementById('app').style.display = 'block'; }
    catch (_) { bootRetryScreen('Something went wrong while opening the dashboard.'); }
  }
})();

// ── Notification center (bell + counter) ──────────────────────────────────────

function openNotifStream() {
  if (notifSse) { notifSse.close(); notifSse = null; }
  if (!authToken) return;
  notifSse = chatStream(() => `/api/dashboard/notifications/stream?_t=${encodeURIComponent(authToken)}`, es => {
  // Huddle invites also arrive here, because the chat stream only exists while the
  // chat page is open — off that page an invite used to be dropped server-side with
  // nothing to show it. Only invites come this way; the signalling itself stays on
  // the chat stream.
  es.addEventListener('huddle', e => {
    try { hdRingOnce(JSON.parse(e.data)); } catch (_) {}
  });
  es.addEventListener('notification', e => {
    try {
      const n = JSON.parse(e.data);
      notifItems.unshift(n);
      if (notifItems.length > 50) notifItems.pop();
      if (!n.read) notifUnread++;
      renderNotifs();
      showAdminToast(`${n.title}${n.body ? ' · ' + n.body : ''}`);
    } catch (_) {}
  });
  });
}
function closeNotifStream() { if (notifSse) { notifSse.close(); notifSse = null; } }

async function loadNotifs() {
  try {
    const r = await apiFetch('/api/dashboard/notifications');
    if (!r.ok) return;
    const d = await r.json();
    notifItems  = d.items || [];
    notifUnread = d.unread || 0;
    renderNotifs();
  } catch (_) {}
}

function notifRelTime(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function renderNotifs() {
  const badge = document.getElementById('notif-badge');
  if (badge) {
    if (notifUnread > 0) { badge.textContent = notifUnread > 99 ? '99+' : notifUnread; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  }
  const navBadge = document.getElementById('notif-nav-badge');
  if (navBadge) {
    if (notifUnread > 0) { navBadge.textContent = notifUnread > 99 ? '99+' : notifUnread; navBadge.style.display = 'inline'; }
    else navBadge.style.display = 'none';
  }
  const list = document.getElementById('notif-list');
  if (list) {
    if (!notifItems.length) { list.innerHTML = '<div class="notif-empty">No notifications yet</div>'; }
    else list.innerHTML = notifItems.slice(0, 20).map(n => `
      <div class="notif-item${n.read ? '' : ' unread'}" onclick="notifClick(${n.id ? `'${n.id}'` : 'null'},'${encodeURIComponent(n.url||'')}','${esc(n.type || '')}')">
        <span class="notif-type-icon"><i data-lucide="${notifIcon(n.type)}"></i></span>
        <div class="notif-body">
          <div class="notif-title">${esc(notifCleanTitle(n.title))}</div>
          ${n.body ? `<div class="notif-text">${esc(n.body)}</div>` : ''}
          <div class="notif-time">${esc(notifRelTime(n.created_at))}</div>
        </div>
      </div>`).join('');
    requestAnimationFrame(() => lucide.createIcons());
  }
  if (currentPage === 'notif') renderNotifPage();
}

function notifIcon(type) {
  const m = { task: 'clipboard-list', reminder: 'alarm-clock', hours: 'clock', lead: 'contact-2', deal: 'kanban-square', request: 'inbox', issue: 'bug', followup: 'alarm-clock', huddle: 'headphones' };
  return m[type] || 'bell';
}
// Strip any leading emoji/symbols so legacy notifications render clean text (new ones already clean)
function notifCleanTitle(t) { return (t || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || (t || ''); }

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const willOpen = !panel.classList.contains('open');
  panel.classList.toggle('open', willOpen);
  if (willOpen && notifUnread > 0) markAllNotifsRead();
}

async function markAllNotifsRead() {
  if (notifUnread === 0) return;
  notifItems.forEach(n => n.read = true);
  notifUnread = 0;
  renderNotifs();
  try { await apiFetch('/api/dashboard/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) }); } catch (_) {}
}

// Route a notification to the right page (hash first, then type fallback for legacy rows)
function notifRoute(url, type) {
  const hash = (url || '').split('#')[1];
  if (hash && document.getElementById('page-' + hash)) { navigate(hash); return; }
  const map = { request: 'requests', task: 'tasks', hours: 'hours', quotation: 'quotation', lead: 'customers', deal: 'deals', followup: 'customers' };
  if (map[type]) navigate(map[type]);
}
// Mark a single notification read (local + server)
async function notifMarkRead(id) {
  if (!id) return;
  const it = notifItems.find(n => String(n.id) === String(id));
  if (it && !it.read) { it.read = true; notifUnread = Math.max(0, notifUnread - 1); renderNotifs(); }
  if (String(id).startsWith('tmp-')) return; // live-only notification (not persisted) — nothing to mark on the server
  try { await apiFetch('/api/dashboard/notifications/read', { method: 'POST', body: JSON.stringify({ id }) }); } catch (_) {}
}

function notifClick(id, urlEnc, type) {
  document.getElementById('notif-panel')?.classList.remove('open');
  notifMarkRead(id);
  notifRoute(decodeURIComponent(urlEnc || ''), type);
}

async function loadNotifPage() {
  try {
    const r = await apiFetch('/api/dashboard/notifications');
    if (r.ok) {
      const d = await r.json();
      notifItems = d.items || [];
      notifUnread = d.unread != null ? d.unread : notifItems.filter(n => !n.read).length;
      renderNotifs();
    }
  } catch (_) {}
  renderNotifPage();
}

function renderNotifPage() {
  const container = document.getElementById('notif-center-list');
  if (!container) return;
  if (!notifItems.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:14px">No notifications yet</div>';
    return;
  }
  container.innerHTML = notifItems.map(n => `
    <div class="notif-center-item${n.read ? '' : ' unread'}" onclick="notifCenterClick(${n.id ? `'${n.id}'` : 'null'},'${encodeURIComponent(n.url||'')}','${esc(n.type||'')}')">
      <span class="notif-type-icon" style="margin-top:2px">${!n.read ? '<span class="notif-unread-marker"></span>' : ''}<i data-lucide="${notifIcon(n.type)}"></i></span>
      <div style="flex:1;min-width:0">
        <div class="notif-title">${esc(notifCleanTitle(n.title))}</div>
        ${n.body ? `<div class="notif-text" style="margin-top:2px">${esc(n.body)}</div>` : ''}
        <div class="notif-time" style="margin-top:4px">${esc(notifRelTime(n.created_at))}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0;margin-left:8px">${new Date(n.created_at).toLocaleDateString()}</div>
    </div>`).join('');
  requestAnimationFrame(() => lucide.createIcons());
}

function notifCenterClick(id, urlEnc, type) {
  notifMarkRead(id);
  notifRoute(decodeURIComponent(urlEnc || ''), type);
}

function showAdminToast(msg) {
  let t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#141416;color:#f3efe7;border:1px solid var(--hair-gold);padding:12px 18px;border-radius:8px;font-size:13px;z-index:9999;opacity:0;transition:opacity .3s,transform .3s;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.5);';
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(20px)'; setTimeout(() => t.remove(), 400); }, 4000);
}

document.addEventListener('click', e => {
  const wrap = document.querySelector('.notif-wrap');
  const panel = document.getElementById('notif-panel');
  if (panel?.classList.contains('open') && wrap && !wrap.contains(e.target)) panel.classList.remove('open');
});

// ── Admin Chat ────────────────────────────────────────────────────────────────
let adminChatRooms            = [];
let adminActiveChatRoom       = null;
let adminChatMessages         = [];
let adminChatSse              = null;
let adminChatPeople           = [];
let adminChatUnread           = new Set();
let adminChatReplyingTo       = null;
let adminChatForwardData      = null;
let adminChatPushSubscription = null;
let adminChatTypingTimers     = {};
let adminChatHeartbeatTimer   = null;
let adminChatPresenceTimer    = null;
let adminChatVoiceRecorder    = null;
let adminChatVoiceChunks      = [];
let adminChatVoiceTimer       = null;
let adminChatVoiceSeconds     = 0;

function adminOpenChatSse() {
  if (adminChatSse) { adminChatSse.close(); adminChatSse = null; }
  adminChatSse = chatStream(() => `/api/dashboard/chat/events?_t=${encodeURIComponent(authToken)}`, es => {
  es.addEventListener('message', e => {
    try {
      const { roomId, message } = JSON.parse(e.data);
      if (roomId === adminActiveChatRoom) {
        adminChatAppendMessage(message);
        adminChatScrollBottom();
      } else {
        adminChatUnread.add(roomId);
        adminChatMarkUnread(roomId);
        adminChatUpdateNavBadge();
        adminChatPlayNotifSound();
        adminChatShowNotification(message.sender_name, message.body, roomId);
      }
      adminChatUpdatePreview(roomId, message);
    } catch (_) {}
  });
  es.addEventListener('edit', e => {
    try {
      const { roomId, message } = JSON.parse(e.data);
      if (roomId === adminActiveChatRoom) {
        const el = document.querySelector(`[data-msg-id="${message.id}"]`);
        if (el) {
          const bubble = el.querySelector('.chat-msg-bubble');
          if (bubble) bubble.innerHTML = chatLinkify(message.body) + '<span class="chat-edited">(edited)</span>';
        }
      }
    } catch (_) {}
  });
  es.addEventListener('delete', e => {
    try {
      const { roomId, msgId } = JSON.parse(e.data);
      if (roomId === adminActiveChatRoom) {
        const el = document.querySelector(`[data-msg-id="${msgId}"]`);
        if (el) el.outerHTML = '<div class="chat-deleted">Message deleted</div>';
      }
    } catch (_) {}
  });
  es.addEventListener('typing', e => {
    try {
      const { roomId, senderName } = JSON.parse(e.data);
      if (roomId !== adminActiveChatRoom) return;
      const bar = document.getElementById('admin-chat-typing-bar');
      if (bar) bar.textContent = `${senderName} is typing…`;
      clearTimeout(adminChatTypingTimers[roomId]);
      adminChatTypingTimers[roomId] = setTimeout(() => { if (bar) bar.textContent = ''; }, 3500);
    } catch (_) {}
  });
  // WebRTC signalling for huddles rides this same stream
  es.addEventListener('huddle', e => {
    try { huddleOnSignal(JSON.parse(e.data)); } catch (_) {}
  });
  // Membership or name changed — refresh the list, and the header if it's open
  es.addEventListener('room', e => {
    try {
      const { roomId } = JSON.parse(e.data);
      HDCFG.refreshRooms().then(() => {
        if (adminActiveChatRoom !== roomId) return;
        if (adminChatRooms.some(r => r.id === roomId)) adminChatOpenRoom(roomId);
        else adminChatBackToRooms();   // we were removed from it
      });
    } catch (_) {}
  });
  });
}

function adminCloseChatSse() {
  if (adminChatSse) { adminChatSse.close(); adminChatSse = null; }
  adminActiveChatRoom = null;
}

async function loadAdminChat() {
  adminChatRequestNotifPermission();
  adminOpenChatSse();
  const r = await apiFetch('/api/dashboard/chat/rooms');
  if (!r.ok) return;
  adminChatRooms = await r.json();
  adminChatRenderRoomList();
  adminChatUpdateNavBadge();
  // Mobile: show room list panel
  document.getElementById('admin-chat-rooms-panel')?.classList.add('mob-show');
  document.getElementById('admin-chat-main')?.classList.remove('mob-show');
}

function adminChatBackToRooms() {
  if (adminChatPresenceTimer) { clearInterval(adminChatPresenceTimer); adminChatPresenceTimer = null; }
  adminActiveChatRoom = null;
  document.getElementById('admin-chat-rooms-panel')?.classList.add('mob-show');
  document.getElementById('admin-chat-main')?.classList.remove('mob-show');
}

function adminChatRenderRoomList() {
  const el = document.getElementById('admin-chat-room-list');
  if (!el) return;
  if (!adminChatRooms.length) {
    el.innerHTML = '<div style="padding:28px 16px;font-size:12px;color:var(--muted);text-align:center">No conversations yet.<br>Use the buttons above to start one.</div>';
    return;
  }
  el.innerHTML = adminChatRooms.map(room => {
    const other  = room.type === 'direct' ? (room.members || []).find(m => m.member_key !== 'admin') : null;
    const name   = room.type === 'group' ? room.name : (other?.member_name || 'Unknown');
    const init   = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const prev   = room.lastMessage ? room.lastMessage.body.slice(0,55) : 'No messages yet';
    const unread = adminChatUnread.has(room.id) ? '<div class="chat-unread-dot"></div>' : '';
    return `<div class="chat-room-item${adminActiveChatRoom === room.id ? ' active' : ''}" onclick="adminChatOpenRoom(${room.id})" data-room="${room.id}">
      <div class="chat-room-avatar-wrap">
        <div class="chat-room-avatar${room.type === 'group' ? ' grp' : ''}">${other?.member_avatar ? `<img src="${esc(other.member_avatar)}" alt="">` : esc(init)}</div>
        ${room.type === 'direct' ? `<div class="presence-dot" id="presence-dot-${room.id}"></div>` : ''}
      </div>
      <div class="chat-room-info">
        <div class="chat-room-name">${esc(name)}${statusEmojiOnly(other?.member_status_emoji, other?.member_status)}</div>
        <div class="chat-room-preview">${esc(prev)}</div>
      </div>${unread}
    </div>`;
  }).join('');
  requestAnimationFrame(() => lucide.createIcons());
}

async function adminChatOpenRoom(roomId) {
  adminActiveChatRoom = roomId;
  adminChatReplyingTo = null;
  adminChatUnread.delete(roomId);
  adminChatUpdateNavBadge();
  document.querySelectorAll('.chat-room-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.room) === roomId));
  document.querySelector(`[data-room="${roomId}"] .chat-unread-dot`)?.remove();

  const room = adminChatRooms.find(r => r.id === roomId);
  const name = room?.type === 'group' ? room.name : (room?.members || []).find(m => m.member_key !== 'admin')?.member_name || 'Chat';

  // Mobile: swap panels
  document.getElementById('admin-chat-rooms-panel')?.classList.remove('mob-show');
  const main = document.getElementById('admin-chat-main');
  main.classList.add('mob-show');
  main.innerHTML = `
    <div class="chat-header">
      <button class="chat-back-btn" onclick="adminChatBackToRooms()" title="Back"><i data-lucide="arrow-left" style="width:18px;height:18px"></i></button>
      <div class="chat-room-avatar${room?.type === 'group' ? ' grp' : ''}" style="width:32px;height:32px;font-size:12px">${esc(name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase())}</div>
      <div style="min-width:0">
        <div class="chat-header-name">${esc(name)} ${chatHeaderStatus(room)}</div>
        <div class="chat-header-meta" id="admin-chat-header-meta">${room?.type === 'group' ? `${(room.members||[]).length} members` : 'Direct message'}</div>
      </div>
      ${chatHeaderActions(room)}
    </div>
    <div class="chat-messages" id="admin-chat-messages"><div class="loading"><div class="spinner"></div></div></div>
    <div class="chat-attach-preview" id="admin-attach-preview" style="display:none">
      <span><i data-lucide="paperclip" style="width:14px;height:14px"></i></span><span id="admin-attach-name"></span>
      <button type="button" onclick="adminChatRemoveAttach()"><i data-lucide="x" style="width:13px;height:13px"></i></button>
    </div>
    <div class="chat-typing-bar" id="admin-chat-typing-bar"></div>
    <div class="chat-recording-bar" id="admin-chat-recording-bar">
      <span style="color:var(--danger);display:flex"><i data-lucide="circle-dot" style="width:15px;height:15px"></i></span>
      <span id="admin-chat-rec-timer" class="chat-rec-timer">00:00</span>
      <span style="flex:1;color:var(--muted);font-size:11px">Recording…</span>
      <button onclick="adminChatCancelRecording()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:4px"><i data-lucide="x" style="width:12px;height:12px"></i> Cancel</button>
      <button onclick="adminChatStopRecording()" class="btn btn-primary btn-sm">Send <i data-lucide="check" style="width:12px;height:12px"></i></button>
    </div>
    <div class="chat-reply-bar" id="admin-reply-bar">
      <span style="color:var(--primary);display:flex"><i data-lucide="corner-up-left" style="width:14px;height:14px"></i></span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:11px" id="admin-reply-sender"></div>
        <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="admin-reply-body"></div>
      </div>
      <button onclick="adminChatClearReply()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px">✕</button>
    </div>
    <div class="chat-composer" style="position:relative">
      <div class="chat-emoji-wrap" id="admin-emoji-wrap">
        <div class="chat-emoji-grid" id="admin-emoji-grid"></div>
      </div>
      <input type="file" id="admin-file-input" style="display:none" onchange="adminChatFileSelected(this)">
      <button class="chat-attach-btn" onclick="document.getElementById('admin-file-input').click()" title="Attach file"><i data-lucide="paperclip" style="width:15px;height:15px"></i></button>
      <button class="chat-emoji-btn" onclick="adminChatToggleEmoji()" title="Emoji"><i data-lucide="smile" style="width:15px;height:15px"></i></button>
      <textarea class="chat-input" id="admin-chat-input" rows="1" placeholder="Message ${esc(name)}…" onkeydown="adminChatHandleKey(event)" oninput="adminChatHandleInput()"
        onpaste="adminChatUploadFilePaste(event)" ondrop="adminChatUploadFileDrop(event)" ondragover="event.preventDefault()"></textarea>
      <button class="chat-voice-btn" id="admin-chat-voice-btn" onclick="adminChatStartRecording()" title="Voice message"><i data-lucide="mic" style="width:15px;height:15px"></i></button>
      <button class="chat-send-btn" id="admin-chat-send-btn" onclick="adminChatSend()" title="Send"><i data-lucide="send" style="width:15px;height:15px"></i></button>
    </div>`;
  requestAnimationFrame(() => lucide.createIcons());

  const r = await apiFetch(`/api/dashboard/chat/rooms/${roomId}/messages`);
  if (!r.ok) return;
  adminChatMessages = await r.json();
  adminChatRenderMessages();
  adminChatScrollBottom();
  // Presence refresh for DMs
  if (adminChatPresenceTimer) { clearInterval(adminChatPresenceTimer); adminChatPresenceTimer = null; }
  const openedRoom = adminChatRooms.find(rr => rr.id === roomId);
  if (openedRoom?.type === 'direct') {
    adminChatRefreshPresence();
    adminChatPresenceTimer = setInterval(adminChatRefreshPresence, 30000);
  }
}

function adminChatToggleActions(e) {
  if (e.target.closest('a, button, textarea, img, .chat-reply-quote')) return; // don't hijack links/edit/buttons/quote
  const m = e.currentTarget;
  document.querySelectorAll('.chat-msg.show-actions').forEach(x => { if (x !== m) x.classList.remove('show-actions'); });
  m.classList.toggle('show-actions');
}

function adminChatScrollToMsg(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior:'smooth', block:'center' });
  el.style.transition = 'background .3s';
  el.style.background = 'rgba(90,103,216,.15)';
  setTimeout(() => { el.style.background = ''; }, 900);
}

function adminChatMsgHTML(msg) {
  const mine    = msg.sender_key === 'admin';
  const timeStr = new Date(msg.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const canDel  = mine && (Date.now() - new Date(msg.created_at).getTime()) < 5 * 60 * 1000;
  const actions = `<div class="chat-msg-actions">
    <button class="chat-action-btn" onclick="adminChatSetReply(${msg.id})" title="Reply"><i data-lucide="corner-up-left" style="width:13px;height:13px"></i></button>
    <button class="chat-action-btn" onclick="adminChatForwardMsg(${msg.id})" title="Forward"><i data-lucide="corner-up-right" style="width:13px;height:13px"></i></button>
    ${mine ? `<button class="chat-action-btn" onclick="adminChatStartEdit(${msg.id})" title="Edit"><i data-lucide="pencil" style="width:13px;height:13px"></i></button>` : ''}
    ${mine && canDel ? `<button class="chat-action-btn" onclick="adminChatDeleteMsg(${msg.id})" title="Delete"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>` : ''}
  </div>`;
  const replyHTML = msg.reply_to_body ? `<div class="chat-reply-quote" onclick="adminChatScrollToMsg(${msg.reply_to_id})">
    <div class="chat-reply-quote-sender">${esc(msg.reply_to_sender || '')}</div>
    <div class="chat-reply-quote-body">${esc(msg.reply_to_body)}</div>
  </div>` : '';
  const dlBtn = msg.file_url ? `<button class="chat-download-btn" onclick="adminChatDownloadFile(${msg.id})" title="Download"><i data-lucide="download" style="width:13px;height:13px"></i></button>` : '';
  const fileHTML = msg.file_url ? (
    msg.file_type?.startsWith('image/')
      ? `<div><img src="${esc(msg.file_url)}" class="chat-img-thumb" onclick="window.open('${esc(msg.file_url)}','_blank')" loading="lazy"><div style="text-align:right">${dlBtn}</div></div>`
      : msg.file_type?.startsWith('audio/')
        ? `<div class="chat-voice-msg"><audio controls src="${esc(msg.file_url)}" preload="none"></audio>${msg.voice_duration ? `<span class="chat-voice-dur">${String(Math.floor(msg.voice_duration/60)).padStart(2,'0')}:${String(msg.voice_duration%60).padStart(2,'0')}</span>` : ''}${dlBtn}</div>`
        : `<div class="chat-file-attach"><i data-lucide="paperclip" style="width:13px;height:13px"></i> <a href="${esc(msg.file_url)}" target="_blank" rel="noopener">${esc(msg.file_name || 'File')}</a><span style="color:var(--muted);margin-left:auto">${msg.file_size ? (msg.file_size/1024/1024).toFixed(1)+'MB' : ''}</span>${dlBtn}</div>`
  ) : '';
  return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}" data-msg-id="${msg.id}" onclick="adminChatToggleActions(event)">
    ${actions}
    ${!mine ? `<div class="chat-msg-sender">${msg.sender_avatar ? `<img class="chat-msg-avatar" src="${esc(msg.sender_avatar)}" alt="">` : ''}${esc(msg.sender_name)}${statusEmojiOnly(msg.sender_status_emoji, msg.sender_status)}</div>` : ''}
    ${replyHTML}
    ${msg.body ? `<div class="chat-msg-bubble">${chatLinkify(msg.body)}${msg.edited_at ? '<span class="chat-edited">(edited)</span>' : ''}</div>` : ''}
    ${msg.body ? googleUnfurl(msg.body) + chatPreviewSlot(msg.body) : ''}
    ${fileHTML}
    <div class="chat-msg-time">${timeStr}</div>
  </div>`;
}

function adminChatRenderMessages() {
  const el = document.getElementById('admin-chat-messages');
  if (!el) return;
  let lastDate = '';
  el.innerHTML = adminChatMessages.map(msg => {
    const d       = new Date(msg.created_at);
    const dateStr = d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
    let div = '';
    if (dateStr !== lastDate) { lastDate = dateStr; div = `<div class="chat-date-divider">${dateStr}</div>`; }
    return div + adminChatMsgHTML(msg);
  }).join('');
  chatHydratePreviews(el, apiFetch, '/api/dashboard');
}

function adminChatAppendMessage(msg) {
  adminChatMessages.push(msg);
  const el = document.getElementById('admin-chat-messages');
  if (!el) return;
  el.insertAdjacentHTML('beforeend', adminChatMsgHTML(msg));
  chatHydratePreviews(el, apiFetch, '/api/dashboard');
}

function adminChatScrollBottom() {
  const el = document.getElementById('admin-chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

let adminChatPendingFile = null;

function adminChatFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  adminChatUploadFile(file);
}

// Takes a File rather than an <input>, so the picker, a pasted screenshot and a
// dropped image all go the same way.
async function adminChatUploadFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('File must be under 10 MB'); return; }
  const btn = document.getElementById('admin-chat-send-btn');
  if (btn) btn.disabled = true;
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await apiFetch('/api/dashboard/chat/upload', { method:'POST', body: fd, headers: {} });
    const d = await r.json();
    if (d.error) { alert('Upload failed: ' + d.error); return; }
    adminChatPendingFile = d;
    adminChatUploadFilePreview(d);
  } catch (e) { alert('Upload failed: ' + e.message); }
  finally { if (btn) btn.disabled = false; }
}

// A pasted screenshot has no filename worth reading, so show the picture itself.
function adminChatUploadFilePreview(d) {
  const wrap = document.getElementById('admin-attach-preview');
  const nameEl = document.getElementById('admin-attach-name');
  if (nameEl) nameEl.textContent = d.name || 'Attachment';
  if (wrap) {
    const old = wrap.querySelector('.chat-attach-thumb');
    if (old) old.remove();
    if ((d.type || '').startsWith('image/') && d.url) {
      const img = document.createElement('img');
      img.className = 'chat-attach-thumb';
      img.src = d.url;
      wrap.insertBefore(img, wrap.firstChild);
    }
    wrap.style.display = 'flex';
  }
}

// Paste and drop into the composer. A paste with no image is left entirely alone so
// pasting text keeps working.
function adminChatUploadFilePaste(e) {
  const file = chatImageFromPaste(e);
  if (!file) return;
  e.preventDefault();
  adminChatUploadFile(file);
}
function adminChatUploadFileDrop(e) {
  const file = chatImageFromDrop(e);
  if (!file) return;
  e.preventDefault();
  adminChatUploadFile(file);
}

function adminChatRemoveAttach() {
  adminChatPendingFile = null;
  const _thumb = document.querySelector('#admin-attach-preview .chat-attach-thumb');
  if (_thumb) _thumb.remove();
  document.getElementById('admin-attach-preview').style.display = 'none';
}

async function adminChatSend() {
  const input = document.getElementById('admin-chat-input');
  if (!input || !adminActiveChatRoom) return;
  const body = input.value.trim();
  if (!body && !adminChatPendingFile) return;
  input.value = '';
  adminChatAutoGrow(input);
  const payload = { body };
  if (adminChatPendingFile) { payload.file_url = adminChatPendingFile.url; payload.file_name = adminChatPendingFile.name; payload.file_size = adminChatPendingFile.size; payload.file_type = adminChatPendingFile.type; }
  if (adminChatReplyingTo) { payload.reply_to_id = adminChatReplyingTo.id; payload.reply_to_sender = adminChatReplyingTo.sender; payload.reply_to_body = adminChatReplyingTo.body; }
  adminChatRemoveAttach();
  adminChatClearReply();
  const btn = document.getElementById('admin-chat-send-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await apiFetch(`/api/dashboard/chat/rooms/${adminActiveChatRoom}/messages`, { method:'POST', body:JSON.stringify(payload) });
    if (r.ok) {
      const msg = await r.json();
      adminChatAppendMessage(msg);
      adminChatScrollBottom();
      adminChatUpdatePreview(adminActiveChatRoom, msg);
    }
  } finally {
    if (btn) btn.disabled = false;
    input.focus();
  }
}

function adminChatHandleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); adminChatSend(); } }
function adminChatAutoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 110) + 'px'; }
function adminChatHandleInput() {
  const el = document.getElementById('admin-chat-input');
  if (el) adminChatAutoGrow(el);
  if (!adminActiveChatRoom) return;
  if (adminChatHandleInput._t) return;
  adminChatHandleInput._t = setTimeout(() => { adminChatHandleInput._t = null; }, 2000);
  apiFetch(`/api/dashboard/chat/rooms/${adminActiveChatRoom}/typing`, { method:'POST' }).catch(() => {});
}

// ── Admin Edit / Delete ───────────────────────────────────────────────────────
function adminChatStartEdit(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const bubble = el.querySelector('.chat-msg-bubble');
  const orig   = adminChatMessages.find(m => m.id === msgId)?.body || '';
  bubble.innerHTML = `<textarea class="chat-edit-input" id="admin-edit-input-${msgId}" rows="1">${esc(orig)}</textarea>
    <div class="chat-edit-actions">
      <button class="btn btn-sm btn-outline" onclick="adminChatCancelEdit(${msgId}, ${JSON.stringify(orig)})">Cancel</button>
      <button class="btn btn-sm btn-primary" onclick="adminChatSaveEdit(${msgId})">Save</button>
    </div>`;
  const ta = document.getElementById(`admin-edit-input-${msgId}`);
  if (ta) { ta.style.height = ta.scrollHeight + 'px'; ta.focus(); ta.selectionStart = ta.value.length; }
}

function adminChatCancelEdit(msgId, orig) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const msg = adminChatMessages.find(m => m.id === msgId);
  const bubble = el.querySelector('.chat-msg-bubble');
  if (bubble) bubble.innerHTML = chatLinkify(orig) + (msg?.edited_at ? '<span class="chat-edited">(edited)</span>' : '');
}

async function adminChatSaveEdit(msgId) {
  const ta = document.getElementById(`admin-edit-input-${msgId}`);
  if (!ta) return;
  const body = ta.value.trim();
  if (!body) return;
  const r = await apiFetch(`/api/dashboard/chat/rooms/${adminActiveChatRoom}/messages/${msgId}`, { method:'PATCH', body:JSON.stringify({ body }) });
  if (!r.ok) { alert('Edit failed'); return; }
  const updated = await r.json();
  const idx = adminChatMessages.findIndex(m => m.id === msgId);
  if (idx >= 0) adminChatMessages[idx] = updated;
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) {
    const bubble = el.querySelector('.chat-msg-bubble');
    if (bubble) bubble.innerHTML = chatLinkify(updated.body) + '<span class="chat-edited">(edited)</span>';
  }
}

async function adminChatDeleteMsg(msgId) {
  if (!confirm('Delete this message?')) return;
  const r = await apiFetch(`/api/dashboard/chat/rooms/${adminActiveChatRoom}/messages/${msgId}`, { method:'DELETE' });
  if (!r.ok) { const d = await r.json(); alert(d.error || 'Delete failed'); return; }
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) el.innerHTML = '<div class="chat-deleted">Message deleted</div>';
  const idx = adminChatMessages.findIndex(m => m.id === msgId);
  if (idx >= 0) adminChatMessages.splice(idx, 1);
}

// ── Admin Emoji picker ────────────────────────────────────────────────────────
const ADMIN_CHAT_EMOJIS = ['😀','😂','😍','😎','🥳','😢','😡','🤔','👍','👎','👏','🙏','🔥','❤️','💯','✅','❌','⚠️','🎉','🎊','💪','🤝','👀','💬','📎','📁','🚀','⏰','📌','🔗','😊','🥰','😇','🤩','😏','😤','🤣','😅','😬','🤐','😴','🤮','💀','👻','🤖','🎯','💡','📊','🛠️','🔑'];

function adminChatInitEmoji() {
  const grid = document.getElementById('admin-emoji-grid');
  if (!grid || grid.childElementCount) return;
  grid.innerHTML = ADMIN_CHAT_EMOJIS.map(e => `<button type="button" onclick="adminChatInsertEmoji('${e}')">${e}</button>`).join('');
}

function adminChatToggleEmoji() {
  adminChatInitEmoji();
  document.getElementById('admin-emoji-wrap')?.classList.toggle('open');
}

function adminChatInsertEmoji(e) {
  const ta = document.getElementById('admin-chat-input');
  if (!ta) return;
  const s = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + e + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = s + e.length;
  ta.focus();
  adminChatAutoGrow(ta);
}

function adminChatUpdatePreview(roomId, message) {
  const room = adminChatRooms.find(r => r.id === roomId);
  if (room) room.lastMessage = message;
  const el = document.querySelector(`[data-room="${roomId}"] .chat-room-preview`);
  if (el) el.textContent = message.body.slice(0, 55);
}

function adminChatMarkUnread(roomId) {
  const el = document.querySelector(`[data-room="${roomId}"]`);
  if (el && !el.querySelector('.chat-unread-dot')) el.insertAdjacentHTML('beforeend', '<div class="chat-unread-dot"></div>');
  adminChatUpdateNavBadge();
}

function adminChatUpdateNavBadge() {
  const el = document.getElementById('chat-nav-badge');
  if (!el) return;
  const count = adminChatUnread.size;
  el.textContent = count > 99 ? '99+' : String(count);
  el.style.display = count > 0 ? 'flex' : 'none';
}

// ── Admin Reply ───────────────────────────────────────────────────────────────
function adminChatSetReply(msgId) {
  const msg = adminChatMessages.find(m => m.id === msgId);
  if (!msg) return;
  const body = (msg.body || (msg.file_url ? (msg.file_name || 'Attachment') : '')).slice(0, 80);
  adminChatReplyingTo = { id: msg.id, sender: msg.sender_name, body };
  document.getElementById('admin-reply-sender').textContent = msg.sender_name;
  document.getElementById('admin-reply-body').textContent = body;
  document.getElementById('admin-reply-bar')?.classList.add('visible');
  document.getElementById('admin-chat-input')?.focus();
}

function adminChatClearReply() {
  adminChatReplyingTo = null;
  document.getElementById('admin-reply-bar')?.classList.remove('visible');
}

// ── Admin Download ────────────────────────────────────────────────────────────
async function adminChatDownloadFile(msgId) {
  const msg = adminChatMessages.find(m => m.id === msgId);
  if (!msg || !msg.file_url) return;
  const url = msg.file_url, name = msg.file_name || 'file';
  try {
    const r = await fetch(url);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (_) { window.open(url, '_blank'); }
}

// ── Admin Forward ─────────────────────────────────────────────────────────────
function adminChatForwardMsg(msgId) {
  const msg = adminChatMessages.find(m => m.id === msgId);
  if (!msg) return;
  adminChatForwardData = { body: msg.body, file_url: msg.file_url, file_name: msg.file_name, file_size: msg.file_size, file_type: msg.file_type };
  const list = document.getElementById('admin-forward-room-list');
  list.innerHTML = adminChatRooms.filter(r => r.id !== adminActiveChatRoom).map(r => {
    const name = r.type === 'group' ? r.name : (r.members||[]).find(m => m.member_key !== 'admin')?.member_name || 'Chat';
    return `<button class="btn btn-outline" style="justify-content:flex-start;text-align:left;width:100%" onclick="adminChatForwardTo(${r.id})">${esc(name)}</button>`;
  }).join('');
  if (!list.innerHTML) list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No other conversations yet.</div>';
  document.getElementById('admin-forward-modal').style.display = 'flex';
}

async function adminChatForwardTo(roomId) {
  document.getElementById('admin-forward-modal').style.display = 'none';
  if (!adminChatForwardData) return;
  const payload = { body: adminChatForwardData.body ? `↪ ${adminChatForwardData.body}` : '' };
  if (adminChatForwardData.file_url) { payload.file_url = adminChatForwardData.file_url; payload.file_name = adminChatForwardData.file_name; payload.file_size = adminChatForwardData.file_size; payload.file_type = adminChatForwardData.file_type; }
  adminChatForwardData = null;
  const r = await apiFetch(`/api/dashboard/chat/rooms/${roomId}/messages`, { method:'POST', body:JSON.stringify(payload) });
  if (r.ok && roomId === adminActiveChatRoom) { const msg = await r.json(); adminChatAppendMessage(msg); adminChatScrollBottom(); adminChatUpdatePreview(roomId, msg); }
}

// ── Admin Notifications ───────────────────────────────────────────────────────
async function adminChatRequestNotifPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted' && _adminSwReg) adminChatSubscribePush(_adminSwReg);
  } catch (_) {}
}

function adminChatPlayNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

function adminChatShowNotification(senderName, body, roomId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return; // only when tab is in background
  try {
    const n = new Notification(senderName || 'New message', { body: (body || '').slice(0, 80) || '📎 Attachment' });
    n.onclick = () => { window.focus(); navigate('chat'); adminChatOpenRoom(roomId); n.close(); };
  } catch (_) {}
}

async function adminShowDmModal() {
  if (!adminChatPeople.length) {
    const r = await apiFetch('/api/dashboard/chat/people');
    adminChatPeople = r.ok ? await r.json() : [];
  }
  const sel = document.getElementById('admin-dm-target');
  sel.innerHTML = adminChatPeople.map(p => `<option value="${esc(p.key)}" data-name="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  document.getElementById('admin-dm-modal').style.display = 'flex';
}

async function adminStartDm() {
  const sel = document.getElementById('admin-dm-target');
  const targetKey  = sel.value;
  const targetName = sel.options[sel.selectedIndex]?.dataset.name || targetKey;
  document.getElementById('admin-dm-modal').style.display = 'none';
  const r = await apiFetch('/api/dashboard/chat/rooms/direct', { method:'POST', body:JSON.stringify({ targetKey, targetName }) });
  if (!r.ok) return;
  const room = await r.json();
  room.members = [
    { member_key: 'admin', member_name: 'Admin' },
    { member_key: targetKey, member_name: targetName }
  ];
  if (!adminChatRooms.find(rr => rr.id === room.id)) { adminChatRooms.unshift(room); adminChatRenderRoomList(); }
  adminChatOpenRoom(room.id);
}

async function adminShowGroupModal() {
  if (!adminChatPeople.length) {
    const r = await apiFetch('/api/dashboard/chat/people');
    adminChatPeople = r.ok ? await r.json() : [];
  }
  const sel = document.getElementById('admin-group-members');
  sel.innerHTML = adminChatPeople.map(p => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('');
  document.getElementById('admin-group-name').value = '';
  document.getElementById('admin-group-modal').style.display = 'flex';
}

async function adminCreateGroup() {
  const name = document.getElementById('admin-group-name').value.trim();
  if (!name) { alert('Group name is required'); return; }
  const sel = document.getElementById('admin-group-members');
  const memberKeys = [...sel.selectedOptions].map(o => o.value);
  if (!memberKeys.length) { alert('Select at least one member'); return; }
  document.getElementById('admin-group-modal').style.display = 'none';
  const r = await apiFetch('/api/dashboard/chat/rooms/group', { method:'POST', body:JSON.stringify({ name, memberKeys }) });
  if (!r.ok) { alert('Failed to create group'); return; }
  const room = await r.json();
  adminChatRooms.unshift(room);
  adminChatRenderRoomList();
  adminChatOpenRoom(room.id);
}

// ── Approvals (employee-requested lead/deal deletions awaiting sign-off) ────────
async function loadDeletionRequests() {
  const c = document.getElementById('deletions-container');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  try {
    const rows = await apiFetch('/api/dashboard/deletion-requests').then(r => r.json());
    const pending = (Array.isArray(rows) ? rows : []).filter(r => r.status === 'pending');
    const done = (Array.isArray(rows) ? rows : []).filter(r => r.status !== 'pending').slice(0, 50);
    updateDeletionBadge(pending.length);
    const card = (r, actionable) => `
      <div class="card" style="display:flex;align-items:center;gap:14px;padding:14px 18px;margin-bottom:10px">
        <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 8px;border-radius:20px;background:${r.entity_type === 'lead' ? 'rgba(124,106,255,.15)' : 'rgba(90,180,120,.15)'};color:${r.entity_type === 'lead' ? 'var(--primary)' : '#5ab478'}">${r.entity_type}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">${esc(r.entity_label || ('#' + r.entity_id))}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">by ${esc(r.requested_by)} · ${new Date(r.created_at).toLocaleString()}${r.reason ? ' · “' + esc(r.reason) + '”' : ''}</div>
        </div>
        ${actionable ? `
          <button class="btn btn-sm btn-outline" style="color:#5ab478;border-color:#5ab478" onclick="reviewDeletion(${r.id}, 'approved')"><i data-lucide="check" style="width:13px;height:13px"></i> Approve &amp; delete</button>
          <button class="btn btn-sm btn-outline" onclick="reviewDeletion(${r.id}, 'rejected')"><i data-lucide="x" style="width:13px;height:13px"></i> Reject</button>`
          : `<span style="font-size:12px;font-weight:700;color:${r.status === 'approved' ? '#5ab478' : 'var(--muted)'}">${r.status === 'approved' ? '✓ Approved' : 'Rejected'}</span>`}
      </div>`;
    c.innerHTML = (pending.length ? pending.map(r => card(r, true)).join('')
      : '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">No pending deletion requests.</div>')
      + (done.length ? `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:20px 0 10px">Recently reviewed</div>` + done.map(r => card(r, false)).join('') : '');
    requestAnimationFrame(() => lucide.createIcons());
  } catch (e) { c.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; }
}
async function reviewDeletion(id, status) {
  if (status === 'approved' && !confirm('Approve this deletion? The record will be permanently deleted.')) return;
  try {
    const r = await apiFetch(`/api/dashboard/deletion-requests/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); return alert('Error: ' + (e.error || r.status)); }
    loadDeletionRequests();
    // Refresh leads/deals if the user is viewing them
    if (currentPage === 'customers' && typeof loadCustomers === 'function') loadCustomers();
    if (currentPage === 'deals' && typeof loadDeals === 'function') loadDeals();
  } catch (e) { alert('Error: ' + e.message); }
}
function updateDeletionBadge(n) {
  const b = document.getElementById('nav-deletions-badge');
  if (!b) return;
  if (n > 0) { b.textContent = n; b.style.display = 'inline-flex'; } else { b.style.display = 'none'; }
}

// ── Help Bot (bilingual EN/AR support assistant) ────────────────────────────
const HELP_API = '/api/dashboard/help/chat';
let _helpHistory = [];
let _helpLang = 'auto';
let _helpBusy = false;
function helpInit() {
  if (document.getElementById('hb-root')) return;
  const style = document.createElement('style');
  style.textContent = `
    .hb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9994;opacity:0;pointer-events:none;transition:opacity .2s}
    .hb-overlay.open{opacity:1;pointer-events:auto}
    .hb-panel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:96vw;background:var(--surface,#141416);border-left:1px solid rgba(201,163,94,.3);z-index:9995;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.16,1,.3,1);box-shadow:-16px 0 48px rgba(0,0,0,.5)}
    .hb-panel.open{transform:translateX(0)}
    .hb-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px 18px;border-bottom:1px solid var(--border,#2a2a2e)}
    .hb-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
    .hb-tabs{display:flex;gap:4px;padding:10px 14px 0;border-bottom:1px solid var(--border,#2a2a2e)}
    .hb-tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--muted,#9a958a);
            font-size:12.5px;font-weight:700;padding:7px 12px;cursor:pointer}
    .hb-tab.active{color:var(--text,#e8e4da);border-bottom-color:var(--primary,#c9a35e)}
    .hb-docs{flex:1;overflow-y:auto;padding:14px;display:none;flex-direction:column;gap:10px}
    .hb-docs.open{display:flex}
    .hb-search{background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);
               border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit}
    .hb-doc{display:block;width:100%;text-align:start;background:none;border:1px solid var(--border,#2a2a2e);
            border-radius:9px;padding:10px 12px;color:inherit;cursor:pointer;margin-bottom:7px}
    .hb-doc:hover{border-color:var(--primary,#c9a35e)}
    .hb-doc-t{font-size:13px;font-weight:700}
    .hb-doc-s{font-size:11.5px;color:var(--muted,#9a958a);margin-top:3px;
              display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .hb-art h3{font-size:14px;margin:16px 0 6px}
    .hb-art p{font-size:13px;line-height:1.65;margin:0 0 9px}
    .hb-art li{font-size:13px;line-height:1.65;margin-bottom:4px}
    .hb-art[dir="rtl"]{text-align:right}
    .hb-back{background:none;border:none;color:var(--primary,#c9a35e);font-size:12px;cursor:pointer;padding:0 0 8px}
    .hb-msg{max-width:86%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
    .hb-msg.user{align-self:flex-end;background:var(--primary,#c9a35e);color:#0c0c0e;border-bottom-right-radius:4px}
    .hb-msg.bot{align-self:flex-start;background:rgba(255,255,255,.06);color:var(--text,#e8e4da);border-bottom-left-radius:4px}
    .hb-msg.ar{direction:rtl;text-align:right}
    .hb-chip{display:inline-block;margin:4px 4px 0 0;padding:6px 10px;font-size:12px;border:1px solid var(--border,#2a2a2e);border-radius:16px;cursor:pointer;color:var(--muted,#9a958a);background:none}
    .hb-chip:hover{border-color:var(--primary,#c9a35e);color:var(--primary,#c9a35e)}
    .hb-composer{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border,#2a2a2e)}
    .hb-composer textarea{flex:1;resize:none;background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;max-height:120px}
    .hb-send{background:var(--primary,#c9a35e);color:#0c0c0e;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:700}
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hb-root';
  root.innerHTML = `
    <div class="hb-overlay" id="hb-overlay" onclick="helpClose()"></div>
    <div class="hb-panel" id="hb-panel">
      <div class="hb-head">
        <div>
          <div style="font-weight:800;font-size:15px">Help · مساعدة</div>
          <div id="hb-status" style="font-size:11px;margin-top:2px;display:none"></div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="hb-lang" onchange="_helpLang=this.value" style="background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:8px;padding:4px 6px">
            <option value="auto">Auto</option><option value="en">EN</option><option value="ar">AR</option>
          </select>
          <button onclick="helpClose()" style="background:none;border:none;color:var(--muted,#9a958a);font-size:22px;cursor:pointer;line-height:1">×</button>
        </div>
      </div>
      <div class="hb-tabs">
        <button class="hb-tab active" data-tab="docs" onclick="helpTab('docs')">Docs</button>
        <button class="hb-tab" data-tab="ask" onclick="helpTab('ask')">Ask</button>
      </div>
      <div class="hb-docs" id="hb-docs">
        <input class="hb-search" id="hb-search" placeholder="Search the docs…" oninput="helpDocSearch(this.value)">
        <div id="hb-doc-list"></div>
        <div id="hb-doc-view" style="display:none"></div>
      </div>
      <div class="hb-body" id="hb-body"></div>
      <div class="hb-composer">
        <textarea id="hb-input" rows="1" placeholder="Ask about the system… · اسأل عن النظام…" onkeydown="helpKey(event)"></textarea>
        <button class="hb-send" onclick="helpSend()"><i data-lucide="send" style="width:16px;height:16px"></i></button>
      </div>
    </div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => { try { lucide.createIcons(); } catch (_) {} });
}
// ── Help centre docs ──────────────────────────────────────────────────────────
// Articles come from public/help-docs.js, shared by both portals. The bot stays
// on its own tab; this one is plain reading and search.
let _helpTab = 'docs';
function helpTab(which) {
  _helpTab = which;
  document.querySelectorAll('.hb-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === which));
  document.getElementById('hb-docs').classList.toggle('open', which === 'docs');
  document.getElementById('hb-body').style.display = which === 'docs' ? 'none' : 'flex';
  document.querySelector('.hb-composer').style.display = which === 'docs' ? 'none' : 'flex';
  if (which === 'docs') helpDocSearch(document.getElementById('hb-search').value || '');
}
function helpDocLang() {
  const v = (document.getElementById('hb-lang') || {}).value || 'auto';
  if (v === 'en' || v === 'ar') return v;
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
function helpDocSearch(q) {
  const lang = helpDocLang();
  const docs = window.HELP_DOCS || [];
  const term = String(q || '').trim().toLowerCase();
  const hits = docs.filter(d => !term
    || (d.title[lang] || '').toLowerCase().includes(term)
    || (d.body[lang] || '').toLowerCase().includes(term)
    || (d.title.en || '').toLowerCase().includes(term));
  document.getElementById('hb-doc-view').style.display = 'none';
  const list = document.getElementById('hb-doc-list');
  list.style.display = '';
  list.innerHTML = hits.length
    ? hits.map(d => `<button class="hb-doc" onclick="helpDocOpen('${d.id}')" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
        <div class="hb-doc-t">${esc(d.title[lang] || d.title.en)}</div>
        <div class="hb-doc-s">${esc((d.body[lang] || '').replace(/[#*-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110))}</div>
      </button>`).join('')
    : '<div style="font-size:12.5px;color:var(--muted);padding:8px">Nothing matched that.</div>';
}
// A deliberately small markdown subset — ## heading, - bullet, **bold**
function helpDocRender(md) {
  const out = [];
  let ul = false;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    const bold = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (line.startsWith('## ')) { if (ul) { out.push('</ul>'); ul = false; } out.push('<h3>' + bold(line.slice(3)) + '</h3>'); }
    else if (line.startsWith('- ')) { if (!ul) { out.push('<ul>'); ul = true; } out.push('<li>' + bold(line.slice(2)) + '</li>'); }
    else if (!line) { if (ul) { out.push('</ul>'); ul = false; } }
    else { if (ul) { out.push('</ul>'); ul = false; } out.push('<p>' + bold(line) + '</p>'); }
  }
  if (ul) out.push('</ul>');
  return out.join('');
}
function helpDocOpen(id) {
  const lang = helpDocLang();
  const d = (window.HELP_DOCS || []).find(x => x.id === id);
  if (!d) return;
  document.getElementById('hb-doc-list').style.display = 'none';
  const v = document.getElementById('hb-doc-view');
  v.style.display = '';
  v.innerHTML = `<button class="hb-back" onclick="helpDocSearch(document.getElementById('hb-search').value||'')">&larr; All articles</button>
    <div class="hb-art" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
      <h3 style="margin-top:0">${esc(d.title[lang] || d.title.en)}</h3>
      ${helpDocRender(d.body[lang] || d.body.en)}
    </div>`;
}

function helpOpen() {
  helpInit();
  document.getElementById('hb-overlay').classList.add('open');
  document.getElementById('hb-panel').classList.add('open');
  if (!_helpHistory.length) helpWelcome();
  helpRefreshStatus();
  helpTab(_helpTab);
  setTimeout(() => document.getElementById('hb-input')?.focus(), 120);
}
async function helpRefreshStatus() {
  const el = document.getElementById('hb-status');
  if (!el) return;
  try {
    const d = await apiFetch('/api/dashboard/help/status').then(r => r.json());
    el.style.display = 'block'; el.title = '';
    if (d.ai && d.ok) { el.textContent = '● AI connected (' + (d.model || 'Gemini') + ')'; el.style.color = '#6dd8a4'; }
    else if (d.ai && d.status === 429) { el.textContent = '● AI busy — free-tier rate limit, retry shortly'; el.style.color = '#e6a850'; el.title = d.error || ''; }
    else if (d.ai && d.ok === false) { el.textContent = '● AI key set but failing — tap for details'; el.style.color = '#e6a850'; el.title = d.error || 'unknown error'; }
    else if (d.ai) { el.textContent = '● AI ready — send a message to test'; el.style.color = 'var(--muted,#9a958a)'; }
    else { el.textContent = '● AI off — answering from the built-in guide'; el.style.color = 'var(--muted,#9a958a)'; }
  } catch (_) { el.style.display = 'none'; }
}
function helpClose() {
  document.getElementById('hb-overlay')?.classList.remove('open');
  document.getElementById('hb-panel')?.classList.remove('open');
}
function helpWelcome() {
  const chips = ['Add lead', 'Edit quotation', 'عرض سعر', 'متابعة'];
  document.getElementById('hb-body').innerHTML =
    `<div class="hb-msg bot">👋 Hi! I'm the Help Bot — ask me anything about using the system, in English or العربية.<br><br>مرحباً! أنا مساعد النظام، اسألني عن أي شيء داخل النظام بالعربية أو الإنجليزية.</div>
     <div>${chips.map(c => `<span class="hb-chip" onclick="helpChip(this)">${esc(c)}</span>`).join('')}</div>`;
}
function helpChip(el) { const i = document.getElementById('hb-input'); i.value = el.textContent; helpSend(); }
function helpAppend(text, who, source) {
  const body = document.getElementById('hb-body');
  const isAr = /[؀-ۿ]/.test(text);
  const div = document.createElement('div');
  div.className = 'hb-msg ' + (who === 'user' ? 'user' : 'bot') + (isAr ? ' ar' : '');
  div.textContent = text;
  if (who === 'bot' && source) {
    const tag = document.createElement('div');
    tag.textContent = source === 'ai' ? 'AI' : 'Guide';
    tag.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:.05em;opacity:.5;margin-top:4px';
    div.appendChild(tag);
  }
  body.appendChild(div); body.scrollTop = body.scrollHeight;
  return div;
}
function helpKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); helpSend(); } }
async function helpSend() {
  if (_helpBusy) return;
  const input = document.getElementById('hb-input');
  const msg = (input.value || '').trim();
  if (!msg) return;
  const chipRow = document.querySelector('#hb-body .hb-chip'); if (chipRow) chipRow.parentElement.remove();
  input.value = '';
  helpAppend(msg, 'user');
  _helpHistory.push({ role: 'user', content: msg });
  _helpBusy = true;
  const typing = helpAppend('…', 'bot');
  try {
    const r = await apiFetch(HELP_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, history: _helpHistory.slice(-8), lang: _helpLang === 'auto' ? undefined : _helpLang }) });
    const d = await r.json();
    const ans = d.answer || d.error || 'Sorry, something went wrong.';
    typing.remove();
    helpAppend(ans, 'bot', d.source);
    _helpHistory.push({ role: 'bot', content: ans });
  } catch (e) {
    typing.remove(); helpAppend('Network error: ' + e.message, 'bot');
  } finally { _helpBusy = false; }
}
document.addEventListener('DOMContentLoaded', helpInit);

// ── PWA: Standalone detection ──────────────────────────────────────────────
(function detectStandalone() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;
  if (isStandalone) document.body.classList.add('standalone');
  window.matchMedia('(display-mode: standalone)').addEventListener('change', e => {
    document.body.classList.toggle('standalone', e.matches);
  });
})();

// ── PWA: Service Worker ────────────────────────────────────────────────────
let _adminSwReg = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw-dashboard.js', { scope: '/dashboard' });
      _adminSwReg = reg;
      adminChatSubscribePush(reg);
    } catch (err) { console.warn('SW registration failed:', err); }
  });
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'open_chat_room') { navigate('chat'); adminChatOpenRoom(e.data.roomId); }
  });
}

async function adminChatSubscribePush(reg) {
  try {
    if (!('PushManager' in window)) return;
    const res = await fetch('/api/push/vapid-public-key');
    const { key } = await res.json();
    if (!key) return;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: adminUrlBase64ToUint8Array(key) });
    adminChatPushSubscription = sub;
    await apiFetch('/api/dashboard/push/subscribe', { method:'POST', body:JSON.stringify(sub.toJSON()) });
  } catch (_) {}
}

function adminUrlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// ── Admin Presence heartbeat ───────────────────────────────────────────────
function adminStartPresenceHeartbeat() {
  if (adminChatHeartbeatTimer) return;
  apiFetch('/api/dashboard/presence/heartbeat', { method:'POST' }).catch(() => {});
  adminChatHeartbeatTimer = setInterval(() => {
    apiFetch('/api/dashboard/presence/heartbeat', { method:'POST' }).catch(() => {});
  }, 30000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(adminChatHeartbeatTimer); adminChatHeartbeatTimer = null;
  } else {
    adminStartPresenceHeartbeat();
  }
});

async function adminChatRefreshPresence() {
  if (!adminActiveChatRoom) return;
  const room = adminChatRooms.find(r => r.id === adminActiveChatRoom);
  if (!room || room.type !== 'direct') return;
  const otherKey = (room.members || []).find(m => m.member_key !== 'admin')?.member_key;
  if (!otherKey) return;
  try {
    const data = await (await apiFetch(`/api/dashboard/presence?keys=${encodeURIComponent(otherKey)}`)).json();
    const p = data.find(d => d.member_key === otherKey);
    const isOnline = p && (Date.now() - new Date(p.last_seen).getTime()) < 45000;
    const meta = document.getElementById('admin-chat-header-meta');
    if (meta) meta.textContent = p ? (isOnline ? 'Online' : 'Last seen ' + adminChatRelativeTime(new Date(p.last_seen))) : 'Direct message';
    const dot = document.getElementById(`presence-dot-${adminActiveChatRoom}`);
    if (dot) dot.classList.toggle('online', isOnline);
  } catch (_) {}
}

function adminChatRelativeTime(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

// ── Admin Voice recorder ───────────────────────────────────────────────────
async function adminChatStartRecording() {
  if (adminChatVoiceRecorder) { adminChatStopRecording(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    adminChatVoiceChunks = [];
    adminChatVoiceRecorder = new MediaRecorder(stream);
    adminChatVoiceRecorder.ondataavailable = e => { if (e.data.size > 0) adminChatVoiceChunks.push(e.data); };
    adminChatVoiceRecorder.onstop = adminChatVoiceUploadAndSend;
    adminChatVoiceRecorder.start(250);
    adminChatVoiceSeconds = 0;
    document.getElementById('admin-chat-voice-btn')?.classList.add('recording');
    document.getElementById('admin-chat-recording-bar')?.classList.add('active');
    adminChatVoiceTimer = setInterval(() => {
      adminChatVoiceSeconds++;
      const m = String(Math.floor(adminChatVoiceSeconds / 60)).padStart(2, '0');
      const s = String(adminChatVoiceSeconds % 60).padStart(2, '0');
      const el = document.getElementById('admin-chat-rec-timer');
      if (el) el.textContent = m + ':' + s;
      if (adminChatVoiceSeconds >= 300) adminChatStopRecording();
    }, 1000);
  } catch (_) { alert('Microphone access denied.'); }
}

function adminChatStopRecording() {
  if (!adminChatVoiceRecorder) return;
  clearInterval(adminChatVoiceTimer);
  adminChatVoiceRecorder.stream.getTracks().forEach(t => t.stop());
  adminChatVoiceRecorder.stop();
  adminChatVoiceRecorder = null;
  document.getElementById('admin-chat-voice-btn')?.classList.remove('recording');
  document.getElementById('admin-chat-recording-bar')?.classList.remove('active');
}

function adminChatCancelRecording() {
  if (!adminChatVoiceRecorder) return;
  clearInterval(adminChatVoiceTimer);
  adminChatVoiceRecorder.stream.getTracks().forEach(t => t.stop());
  adminChatVoiceRecorder.onstop = null;
  adminChatVoiceRecorder.stop();
  adminChatVoiceRecorder = null;
  adminChatVoiceChunks = [];
  document.getElementById('admin-chat-voice-btn')?.classList.remove('recording');
  document.getElementById('admin-chat-recording-bar')?.classList.remove('active');
}

async function adminChatVoiceUploadAndSend() {
  if (!adminChatVoiceChunks.length) return;
  const mimeType = adminChatVoiceChunks[0]?.type || 'audio/webm';
  const blob = new Blob(adminChatVoiceChunks, { type: mimeType });
  const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });
  const fd = new FormData(); fd.append('file', file);
  const duration = adminChatVoiceSeconds;
  adminChatVoiceChunks = [];
  try {
    const r = await apiFetch('/api/dashboard/chat/upload', { method:'POST', body:fd, headers:{} });
    const d = await r.json();
    if (d.error) { alert('Upload failed'); return; }
    const payload = { body: '', file_url: d.url, file_name: d.name, file_size: d.size, file_type: d.type, voice_duration: duration };
    const msgR = await apiFetch(`/api/dashboard/chat/rooms/${adminActiveChatRoom}/messages`, { method:'POST', body:JSON.stringify(payload) });
    if (msgR.ok) { const msg = await msgR.json(); adminChatAppendMessage(msg); adminChatScrollBottom(); adminChatUpdatePreview(adminActiveChatRoom, msg); }
  } catch (_) { alert('Failed to send voice message'); }
}

// ── PWA: Install prompt (Android/Chrome) ───────────────────────────────────
let _installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  if (!localStorage.getItem('pwaAdminInstallDismissed')) _showAdminInstallBanner();
});

function _showAdminInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
}

function triggerAdminInstall() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(() => { _installPrompt = null; });
  document.getElementById('pwa-install-banner').style.display = 'none';
}

function dismissAdminInstallBanner() {
  localStorage.setItem('pwaAdminInstallDismissed', '1');
  document.getElementById('pwa-install-banner').style.display = 'none';
}

// ── Quotation Tabs ────────────────────────────────────────────────────────
// ── Leads (Customers) ─────────────────────────────────────────────────────
let _allCustomers = [];
let _selectedLeads = new Set();
// Sort state: { key, dir:'asc'|'desc' } — persisted so the choice sticks.
let _leadSort = (() => { try { return JSON.parse(localStorage.getItem('ml_leads_sort')) || { key: null, dir: 'asc' }; } catch (_) { return { key: null, dir: 'asc' }; } })();


// ── Leads: ClickUp-style configurable columns ─────────────────────────────────
// Column config (order, visibility, labels, dropdown options, custom columns) is
// persisted server-side via /api/dashboard/leads/columns. Custom column values
// live in customers.custom_fields (JSONB) keyed by column key.
// The engine (public/assets/columns.js) owns the config now; this bundle keeps
// a live reference to its array plus the same thin lookups every call site used.
let _leadCols = null;
function leadCol(key) { return CE('leads') ? CE('leads').col(key) : null; }
function colOptMap(col) { return CE('leads') ? CE('leads').optMap(col) : {}; }
function leadOptColor(col, key) { return CE('leads') ? CE('leads').optionColor(col, key) : null; }
function isChecked(raw) { return raw === true || raw === 'true' || raw === 1 || raw === '1'; }
// Budget: parse a single number OR a range ("1700000-2000000", "1.7M to 2M") into {min,max}.
function parseBudgetPart(s) {
  s = String(s == null ? '' : s).trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '').replace(/egp|le|£|\$/g, '');
  if (!s) return null;
  let mult = 1;
  if (/[km]$/.test(s)) { mult = s.endsWith('m') ? 1e6 : 1e3; s = s.slice(0, -1); }
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n * mult) : null;
}
function parseBudget(raw) {
  const str = String(raw == null ? '' : raw).trim();
  if (!str) return { min: null, max: null };
  const parts = str.split(/\s*(?:-|–|—|to|:|\/)\s*/i).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    let a = parseBudgetPart(parts[0]), b = parseBudgetPart(parts[parts.length - 1]);
    if (a != null && b != null && a > b) { const t = a; a = b; b = t; }
    return { min: a != null ? a : b, max: (a != null && b != null) ? b : null };
  }
  return { min: parseBudgetPart(str), max: null };
}
function fmtBudget(min, max) {
  const f = n => Number(n).toLocaleString();
  if (min != null && min !== '' && max != null && max !== '') return f(min) + ' – ' + f(max) + ' EGP';
  if (min != null && min !== '') return f(min) + ' EGP';
  return '—';
}

async function loadLeadCols() {
  const eng = CE('leads') || ColumnsEngine('leads', {
    base: '/api/dashboard',
    fetch: (url, opts) => apiFetch(url, opts),
    builtins: LEADS_BUILTIN_COLS,
    fixedKeys: ['name', 'budget_lead', 'lead_date'],
    canEdit: () => true,
    sort: { get: () => _leadSort, set: (k, d) => setLeadSort(k, d) },
    onChange: () => { renderLeadHead(); renderLeadFilterOptions(); filterCustomers(); },
  });
  _leadCols = await eng.load();
}
function saveLeadCols() { CE('leads').save(); }

// ── Header rendering + drag-to-reorder ──
function renderLeadHead() {
  const tr = document.getElementById('leads-head-row');
  if (!tr || !_leadCols) return;
  const ths = visibleLeadCols().map(c => `
    <th class="lead-col" draggable="true" data-colkey="${esc(c.key)}"
        ondragstart="leadColDragStart(event)" ondragover="leadColDragOver(event)" ondragleave="this.classList.remove('drag-over')"
        ondrop="leadColDrop(event)" ondragend="leadColDragEnd()"
        onclick="leadHeaderClick(event,'${esc(c.key)}')" title="Click to sort">${esc(c.label)}${leadSortArrow(c.key)}<span class="col-chev-btn" onclick="event.stopPropagation();openLeadColMenu(event,'${esc(c.key)}')" title="Column options"><i data-lucide="chevron-down" class="col-chev"></i></span></th>`).join('');
  tr.innerHTML = `
    <th style="width:36px;padding:8px 6px"><input type="checkbox" id="select-all-leads" onchange="toggleSelectAllLeads(this)"></th>
    ${ths}
    <th style="width:34px;text-align:center"><button onclick="openAddLeadColModal()" title="Add column" style="background:none;border:1px dashed var(--border);border-radius:6px;color:var(--muted);cursor:pointer;width:24px;height:24px;font-size:15px;line-height:1">+</button></th>
    <th>Actions</th>`;
  requestAnimationFrame(() => lucide.createIcons());
}


// Rebuild the status/origin filter dropdowns from the current column options
function renderLeadFilterOptions() {
  const fill = (id, col, allLabel) => {
    const sel = document.getElementById(id);
    if (!sel || !col) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` + (col.options || []).map(o => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('');
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  };
  fill('lead-status-filter', leadCol('lead_status'), 'All Statuses');
  fill('lead-origin-filter', leadCol('source'), 'All Origins');
}

// ── Inline cell editing (click a cell to edit, ClickUp-style) ──
let _editingLeadCell = false;
function leadCellClick(e, id, key) {
  e.stopPropagation();
  if (_editingLeadCell) return;
  // Cards put every field under a thumb; inline editing on touch is an accident
  // waiting to happen. Open the record instead and edit it there.
  if (typeof mlIsMobile === 'function' && mlIsMobile()) return openLeadProfile(id);
  const col = leadCol(key);
  const c = _allCustomers.find(x => x.id === id);
  if (!col || !c) return;
  // Name + follow-up cells open the Lead 360° profile instead of inline editing
  if (col.key === 'name' || col.key === 'next_followup') return openLeadProfile(id);
  // Owner cell → floating rep picker (reassign the lead)
  if (col.key === 'owner') {
    const cur = c.assigned_to ? String(c.assigned_to) : '';
    brandMenu(e.currentTarget, [{ key: '', label: '— Unassigned —', selected: !cur },
      ...(employeesForTasks || []).map(emp => ({ key: String(emp.id), label: emp.name, selected: cur === String(emp.id) }))],
      val => saveLeadOwner(id, val));
    return;
  }
  const raw = col.builtin ? c[key] : (c.custom_fields || {})[key];
  if (col.type === 'checkbox') return saveLeadCell(id, col, !isChecked(raw));
  const td = e.currentTarget;
  if (td.querySelector('input,select')) return;
  const cur = raw == null ? '' : String(raw);
  if (col.type === 'select' || col.type === 'radio') {
    // Branded floating option panel anchored to the cell (no native select menu)
    const m = colOptMap(col);
    const curKey = normKey(cur, m);
    brandMenu(td, [{ key: '', label: '—', selected: !curKey }, ...(col.options || []).map(o => ({ key: o.key, label: o.label, selected: curKey === o.key }))],
      val => saveLeadCell(id, col, val));
    return;
  }
  _editingLeadCell = true;
  {
    // Budget accepts a number OR a range → plain text; number/date/time as-is; else text.
    const t = col.key === 'budget_lead' ? 'text' : col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : key === 'lead_time' ? 'time' : 'text';
    const inputVal = col.key === 'budget_lead'
      ? (c.budget_max != null && c.budget_max !== '' ? `${c.budget_lead}-${c.budget_max}` : (c.budget_lead != null ? String(c.budget_lead) : ''))
      : cur;
    td.innerHTML = `<input class="form-input" type="${t}" value="${esc(inputVal)}" placeholder="${col.key === 'budget_lead' ? 'e.g. 1700000 or 1.7M - 2M' : ''}" style="font-size:12px;padding:4px 6px;min-width:90px;max-width:170px">`;
  }
  const el = td.firstElementChild;
  el.focus();
  if (el.select) try { el.select(); } catch (_) {}
  let done = false;
  const finish = commit => {
    if (done) return;
    done = true;
    _editingLeadCell = false;
    if (commit) saveLeadCell(id, col, el.value);
    else filterCustomers();
  };
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') finish(false);
  });
  el.addEventListener('blur', () => finish(true));
}

async function saveLeadOwner(id, val) {
  try {
    const updated = await apiFetch(`/api/dashboard/customers/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ assigned_to: val ? parseInt(val) : null }) }).then(r => r.json());
    if (updated?.error) throw new Error(updated.error);
    const i = _allCustomers.findIndex(x => x.id === id);
    if (i >= 0) _allCustomers[i] = updated;
  } catch (e) { alert('Save failed: ' + e.message); }
  filterCustomers();
}

async function saveLeadCell(id, col, val) {
  const c = _allCustomers.find(x => x.id === id);
  if (!c) return;
  let payload;
  if (col.builtin) {
    if (col.key === 'budget_lead') { const b = parseBudget(val); payload = { budget_lead: b.min, budget_max: b.max }; }
    else {
      let v = val;
      if (col.type === 'checkbox') v = !!val;
      else if (col.key === 'lead_date') v = val || null;
      if (col.key === 'name' && !String(v || '').trim()) { filterCustomers(); return alert('Name is required.'); }
      payload = { [col.key]: v };
    }
  } else {
    let v = val;
    if (col.type === 'checkbox') v = !!val;
    else if (col.type === 'number') v = val === '' ? null : Number(val);
    payload = { custom_fields: { ...(c.custom_fields || {}), [col.key]: v } };
  }
  try {
    const updated = await apiFetch(`/api/dashboard/customers/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).then(r => r.json());
    if (updated?.error) throw new Error(updated.error);
    const i = _allCustomers.findIndex(x => x.id === id);
    if (i >= 0) _allCustomers[i] = updated;
  } catch (e) { alert('Save failed: ' + e.message); }
  filterCustomers();
}

// Render one data cell for a lead row according to its column definition
function leadCellHtml(c, col) {
  const raw = col.builtin ? c[col.key] : (c.custom_fields || {})[col.key];
  const attrs = `class="lead-cell" onclick="leadCellClick(event, ${c.id}, '${esc(col.key)}')"`;
  if (col.key === 'name') return `<td ${attrs} title="Open profile"><strong style="color:var(--primary);cursor:pointer">${esc(raw || '—')}</strong></td>`;
  if (col.key === 'next_followup') {
    const due = _pendingFollowups[c.id];
    if (!due) return `<td ${attrs} style="font-size:12px;color:var(--muted)">—</td>`;
    const overdue = new Date(due) < new Date();
    const label = new Date(due).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<td ${attrs} style="font-size:11.5px;white-space:nowrap;color:${overdue ? 'var(--danger)' : 'var(--primary)'};font-weight:600"><i data-lucide="clock" style="width:12px;height:12px"></i> ${label}${overdue ? ' · overdue' : ''}</td>`;
  }
  if (col.key === 'owner') {
    const nm = c.assigned_to ? ((employeesForTasks || []).find(x => String(x.id) === String(c.assigned_to))?.name || ('#' + c.assigned_to)) : '';
    return `<td ${attrs} style="font-size:12px;white-space:nowrap" title="Click to assign">${nm ? esc(nm) : '<span style="color:var(--muted)">—</span>'}</td>`;
  }
  if (col.key === 'lead_status') {
    const m = colOptMap(col);
    const k = normKey(raw || 'cold', m);
    return `<td ${attrs}>${CE('leads').badgeHtml(col, k, m[k] || raw || k)}</td>`;
  }
  if (col.key === 'budget_lead') return `<td ${attrs} style="font-size:12px;white-space:nowrap">${fmtBudget(c.budget_lead, c.budget_max)}</td>`;
  if (col.type === 'checkbox') return `<td ${attrs} style="text-align:center;font-size:16px">${isChecked(raw) ? '<i data-lucide="check-square" style="width:15px;height:15px"></i>' : '<i data-lucide="square" style="width:15px;height:15px"></i>'}</td>`;
  if (col.type === 'select' || col.type === 'radio') {
    const m = colOptMap(col); const k = normKey(raw, m);
    // Colored like the status column when the option carries a color; plain otherwise.
    if (CE('leads').optionColor(col, k)) return `<td ${attrs}>${CE('leads').badgeHtml(col, k, m[k] || raw || '—')}</td>`;
    return `<td ${attrs} style="font-size:12px;white-space:nowrap">${esc(m[k] || raw || '—')}</td>`;
  }
  if (col.key === 'notes' || col.key === 'car_in_question' || col.key === 'sales_feedback' || col.key === 'inquiry') return `<td ${attrs} style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(raw || '')}">${esc(raw || '—')}</td>`;
  if (col.type === 'number') return `<td ${attrs} style="font-size:12px;white-space:nowrap">${raw != null && raw !== '' ? Number(raw).toLocaleString() : '—'}</td>`;
  return `<td ${attrs} style="font-size:12px;white-space:nowrap">${esc(raw || '—')}</td>`;
}

let _pendingFollowups = {}; // customer_id -> earliest pending due_at (ISO)
let _fuFilterOn = false;

async function loadCustomers() {
  const ps = document.getElementById('leads-pagesize'); if (ps) ps.value = String(leadsPageSize());
  try {
    await loadLeadCols();
    renderLeadHead();
    renderLeadFilterOptions();
    const [customers, followups] = await Promise.all([
      apiFetch('/api/dashboard/customers').then(r => r.json()),
      apiFetch('/api/dashboard/followups/pending').then(r => r.json()).catch(() => []),
      preloadEmployeesForTasks(),
    ]);
    _allCustomers = customers;
    _pendingFollowups = {};
    (Array.isArray(followups) ? followups : []).forEach(f => {
      if (!_pendingFollowups[f.customer_id]) _pendingFollowups[f.customer_id] = f.due_at; // sorted asc → first = earliest
    });
    renderFuChip();
    filterCustomers();
  } catch (e) {
    document.getElementById('customers-tbody').innerHTML = `<tr><td colspan="20" style="color:var(--danger);text-align:center;padding:24px">${esc(e.message)}</td></tr>`;
  }
}

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
  filterCustomers();
}

// Canonicalize a stored value (which may be a key OR human label, any casing) to its key.
// Handles data stored as "Cold"/"Not Interested"/"FB Ad." as well as cold/not_interested/fb_ad.
function normKey(v, labels) {
  if (v == null || v === '') return '';
  const low = String(v).trim().toLowerCase();
  if (labels[low]) return low;                       // already a key (e.g. 'cold')
  const snake = low.replace(/\s+/g, '_');
  if (labels[snake]) return snake;                   // 'immediate delivery' -> 'immediate_delivery'
  for (const k in labels) if (labels[k].toLowerCase() === low) return k; // label match ('FB Ad.' -> 'fb_ad')
  return snake;                                      // fallback
}

// ── Sort by any column ────────────────────────────────────────────────────────
// A comparable value per column type: numbers/budget numeric, dates as epoch,
// checkbox boolean, selects by their human label, everything else as text.
// Empty values return null and always sort last (in both directions).
// Buying-intent ranking for the Status column. Higher = hotter, so sorting
// descending lists the most promising leads first. Closed/negative statuses are
// pinned below everything, and any status not listed here lands in between.
const LEAD_STATUS_RANK = {
  hot: 100, immediate_delivery: 95, warm: 70, cold: 40,
  awaiting_reply: 20, no_response: 15, not_interested: 10, blacklist: 0,
};
const LEAD_STATUS_UNRANKED = 30; // custom statuses: below cold, above the dead ones

function leadSortValue(c, col) {
  const key = col.key;
  if (key === 'next_followup') { const d = _pendingFollowups[c.id]; return d ? new Date(d).getTime() : null; }
  if (key === 'owner') { if (!c.assigned_to) return null; const e = (employeesForTasks || []).find(x => String(x.id) === String(c.assigned_to)); return (e ? e.name : ('#' + c.assigned_to)) || null; }
  if (key === 'budget_lead') { const n = Number(c.budget_lead); return c.budget_lead != null && c.budget_lead !== '' && isFinite(n) ? n : null; }
  const raw = col.builtin ? c[key] : (c.custom_fields || {})[key];
  if (key === 'lead_date' || col.type === 'date') { if (!raw) return null; const t = new Date(raw).getTime(); return isNaN(t) ? null : t; }
  if (col.type === 'checkbox') return isChecked(raw) ? 1 : 0;
  if (col.type === 'select' || col.type === 'radio') {
    if (raw == null || raw === '') return null;
    const k = normKey(raw, colOptMap(col));
    // Status sorts by buying intent, so "descending" puts the hottest leads on top
    // rather than whichever option happens to sit last in the column config.
    if (key === 'lead_status') {
      const r = LEAD_STATUS_RANK[k];
      if (r != null) return r;
      const i = (col.options || []).findIndex(o => o.key === k);
      return i >= 0 ? LEAD_STATUS_UNRANKED : null; // custom statuses sit between active and dead
    }
    // Every other select keeps its configured order (Cold→Warm→Hot…), not alphabetical.
    const idx = (col.options || []).findIndex(o => o.key === k);
    return idx >= 0 ? idx : null; // unknown/orphan values (e.g. pending_contact) sort last
  }
  if (col.type === 'number') { const n = Number(raw); return raw != null && raw !== '' && isFinite(n) ? n : null; }
  const s = (raw == null ? '' : String(raw)).trim();
  return s || null;
}
function applyLeadSort(list) {
  if (!_leadSort || !_leadSort.key) return list;
  const col = leadCol(_leadSort.key);
  if (!col || col.deleted || col.visible === false) return list; // don't sort by a hidden/removed column
  const dir = _leadSort.dir === 'desc' ? -1 : 1;
  const isEmpty = v => v === null || v === undefined || v === '';
  return [...list].sort((a, b) => {
    const va = leadSortValue(a, col), vb = leadSortValue(b, col);
    const ea = isEmpty(va), eb = isEmpty(vb);
    if (ea && eb) return 0;
    if (ea) return 1;   // empties always last
    if (eb) return -1;
    let r;
    if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
    else r = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    return r * dir;
  });
}
function setLeadSort(key, dir) {
  closeLeadMenu();
  _leadSort = key ? { key, dir: dir || 'asc' } : { key: null, dir: 'asc' };
  try { localStorage.setItem('ml_leads_sort', JSON.stringify(_leadSort)); } catch (_) {}
  renderLeadHead();
  filterCustomers();
}
// Header click cycles the column: asc → desc → cleared.
function toggleLeadSort(key) {
  if (!_leadSort || _leadSort.key !== key) return setLeadSort(key, 'asc');
  if (_leadSort.dir === 'asc') return setLeadSort(key, 'desc');
  return setLeadSort(null);
}
function leadHeaderClick(e, key) {
  if (_leadColDidDrag) { _leadColDidDrag = false; return; } // swallow the click that trails a drag
  toggleLeadSort(key);
}
function leadSortArrow(key) {
  if (!_leadSort || _leadSort.key !== key) return '';
  return `<span class="lead-sort-arrow" style="color:var(--primary);margin-left:3px;font-size:10px">${_leadSort.dir === 'desc' ? '▼' : '▲'}</span>`;
}

// ── Lead filters ────────────────────────────────────────────────────────────────
// The engine lives in public/assets/lead-filters.js, shared with the team portal.
// Only the portal-specific bindings are here.
lfInit({
  storageKey: 'ml_lead_filters',
  chipsId: 'lead-filter-chips',
  inputClass: 'form-input',
  inputIds: ['customer-search', 'lead-date-from', 'lead-date-to'],
  owners: () => employeesForTasks,
  apply: () => filterCustomers(),
  showPicker: body => showModal('Add filter', body,
    `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
     <button class="btn btn-primary" onclick="addLeadFilter()">Add filter</button>`),
  hidePicker: () => hideModal(),
  warn: msg => alert(msg),
});

function filterCustomers() {
  _leadsShown = leadsPageSize();            // a new result set starts from the top
  const q    = (document.getElementById('customer-search')?.value || '').toLowerCase();
  const from = document.getElementById('lead-date-from')?.value || '';
  const to   = document.getElementById('lead-date-to')?.value || '';
  let list = _allCustomers;
  if (q)  list = list.filter(c => (c.name||'').toLowerCase().includes(q) || (c.phone||'').includes(q) || (c.car_in_question||'').toLowerCase().includes(q));
  // ISO dates (YYYY-MM-DD) compare correctly as strings; either bound may be left empty
  if (from) list = list.filter(c => c.lead_date && c.lead_date >= from);
  if (to)   list = list.filter(c => c.lead_date && c.lead_date <= to);
  list = lfApply(list);
  if (_fuFilterOn) {
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    list = list.filter(c => _pendingFollowups[c.id] && new Date(_pendingFollowups[c.id]) <= endOfDay);
  }
  renderCustomers(applyLeadSort(list));
}

let _lastRenderedLeads = []; // filtered+sorted list currently on screen (feeds Export)

// Plain-text value of a lead cell, mirroring how leadCellHtml displays it.
function leadCellText(c, col) {
  const raw = col.builtin ? c[col.key] : (c.custom_fields || {})[col.key];
  if (col.key === 'next_followup') { const d = _pendingFollowups[c.id]; return d ? new Date(d).toLocaleString() : ''; }
  if (col.key === 'owner') { return c.assigned_to ? ((employeesForTasks || []).find(x => String(x.id) === String(c.assigned_to))?.name || ('#' + c.assigned_to)) : ''; }
  if (col.key === 'budget_lead') { return c.budget_lead != null && c.budget_lead !== '' ? (c.budget_max ? `${c.budget_lead} - ${c.budget_max}` : String(c.budget_lead)) : ''; }
  if (col.type === 'checkbox') return isChecked(raw) ? 'Yes' : 'No';
  if (col.type === 'select' || col.type === 'radio') { const m = colOptMap(col); const k = normKey(raw, m); return m[k] || (raw == null ? '' : String(raw)); }
  return raw == null ? '' : String(raw);
}
// Export the table exactly as shown: visible columns only, current filters + sort.
function exportLeadsTable() {
  const vis = visibleLeadCols();
  const list = _lastRenderedLeads || [];
  if (!list.length) { alert('No leads to export (adjust your filters).'); return; }
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [vis.map(c => cell(c.label)).join(',')];
  for (const c of list) lines.push(vis.map(col => cell(leadCellText(c, col))).join(','));
  // UTF-8 BOM so Excel opens Arabic text correctly
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `motolinker-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// How many rows are on screen. Filters and sort still run over every lead — only the
// rendering is capped, because ~800 rows meant ~4,000 controls in the DOM and, once
// each row becomes a card on a phone, a page tens of thousands of pixels tall.
const LEADS_PAGE = 50;
// The user picks the page size (25/50/100/500/1000) and it sticks per browser.
// Search, filters, sort and export still run over EVERY lead — the choice caps
// rendering only, so nothing else changes with it.
function leadsPageSize() {
  const n = parseInt(localStorage.getItem('ml_leads_pagesize'));
  return [25, 50, 100, 500, 1000].includes(n) ? n : LEADS_PAGE;
}
function setLeadsPageSize(v) {
  try { localStorage.setItem('ml_leads_pagesize', String(parseInt(v) || LEADS_PAGE)); } catch (_) {}
  _leadsShown = leadsPageSize();
  renderCustomers(_lastRenderedLeads);
}
let _leadsShown = leadsPageSize();
function leadsShowMore() { _leadsShown += leadsPageSize(); renderCustomers(_lastRenderedLeads); }

function renderCustomers(list) {
  if (typeof mlTopScrollbar === 'function') mlTopScrollbar('leads-scroll');
  _lastRenderedLeads = list;
  const tbody = document.getElementById('customers-tbody');
  const vis = visibleLeadCols();
  const span = vis.length + 3; // select-all + add-column + actions
  if (!list.length) { tbody.innerHTML = `<tr><td colspan="${span}" style="text-align:center;color:var(--muted);padding:32px">No leads yet. Click "Add Lead" to get started.</td></tr>`; return; }
  const shown = list.slice(0, _leadsShown);
  tbody.innerHTML = shown.map(c => `<tr data-id="${c.id}">
      <td style="padding:8px 6px"><input type="checkbox" ${_selectedLeads.has(c.id) ? 'checked' : ''} onchange="toggleLeadSelect(${c.id})" onclick="event.stopPropagation()"></td>
      ${vis.map(col => leadCellHtml(c, col)).join('')}
      <td></td>
      <td style="display:flex;gap:5px;flex-wrap:nowrap">
        <button class="btn btn-sm btn-outline" onclick="openLeadProfile(${c.id})" title="Profile"><i data-lucide="user" style="width:12px;height:12px"></i></button>
        <button class="btn btn-sm btn-outline" onclick="openCustomerModal(${c.id})" title="Edit"><i data-lucide="edit-2" style="width:12px;height:12px"></i></button>
        <button class="btn btn-sm btn-outline" onclick="navigate('deals');filterDealsByCustomer(${c.id})" title="View Deals"><i data-lucide="kanban-square" style="width:12px;height:12px"></i></button>
        <button class="btn btn-sm" style="background:rgba(239,68,68,.1);color:var(--danger);border:none" onclick="deleteCustomer(${c.id})" title="Delete"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
      </td>
    </tr>`).join('')
    + (list.length > shown.length ? `<tr><td colspan="${span}" style="text-align:center;padding:14px">
        <button class="btn btn-outline" onclick="leadsShowMore()">Load more · ${shown.length} of ${list.length}</button>
      </td></tr>` : '');
  // sync select-all checkbox state
  const allCb = document.getElementById('select-all-leads');
  if (allCb) allCb.checked = list.length > 0 && list.every(c => _selectedLeads.has(c.id));
  requestAnimationFrame(() => lucide.createIcons());
}

// ── Lead 360° profile drawer ─────────────────────────────────────────────────
let _ldProfile = null; // { customer, activities, followups, quotations, deals }
const LD_ACT_ICONS = { note: 'sticky-note', call: 'phone', whatsapp: 'message-circle', meeting: 'users', status_change: 'refresh-ccw', quote: 'file-badge', deal: 'kanban-square', follow_up: 'alarm-clock', system: 'info' };

async function openLeadProfile(id) {
  // The drawer reads the lead's columns; the pipeline and the submissions page
  // never load them, which left the info grid blank exactly there.
  if (!_leadCols) { try { await loadLeadCols(); } catch (_) {} }
  document.getElementById('lead-drawer-overlay').classList.add('open');
  document.getElementById('lead-drawer').classList.add('open');
  document.getElementById('lead-drawer-body').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const p = await apiFetch(`/api/dashboard/customers/${id}/profile`).then(r => r.json());
    if (p.error) throw new Error(p.error);
    _ldProfile = p;
    renderLeadDrawer();
  } catch (e) {
    document.getElementById('lead-drawer-body').innerHTML = `<div class="error-msg">${esc(e.message)}</div>`;
  }
}

function closeLeadProfile() {
  document.getElementById('lead-drawer-overlay').classList.remove('open');
  document.getElementById('lead-drawer').classList.remove('open');
}

async function refreshLeadProfile() {
  if (!_ldProfile) return;
  try {
    const p = await apiFetch(`/api/dashboard/customers/${_ldProfile.customer.id}/profile`).then(r => r.json());
    if (!p.error) { _ldProfile = p; renderLeadDrawer(); }
  } catch (_) {}
}

function ldWaDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '2' + d;       // Egyptian local → +20…
  else if (d.startsWith('1') && d.length === 10) d = '20' + d;
  return d;
}

function renderLeadDrawer() {
  const c = _ldProfile.customer;
  const stCol = leadCol('lead_status');
  const stMap = colOptMap(stCol);
  const stKey = normKey(c.lead_status || 'cold', stMap);
  // Head
  document.getElementById('ld-avatar').textContent = (c.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('ld-name').textContent = c.name || '—';
  const badge = document.getElementById('ld-status');
  badge.textContent = (stMap[stKey] || c.lead_status || 'Cold') + ' ▾';
  const stHex = leadOptColor(stCol, stKey);
  badge.style.background = stHex ? hexA(stHex, 0.16) : 'rgba(255,255,255,.06)';
  badge.style.color = stHex || '#b9b3a4';
  document.getElementById('ld-phone').textContent = c.phone || '';
  document.getElementById('ld-call').href = c.phone ? 'tel:' + c.phone : '#';
  document.getElementById('ld-wa').href = c.phone ? 'https://wa.me/' + ldWaDigits(c.phone) : '#';

  // Info grid — all builtin data columns except the ones in the header, plus customs
  const skip = new Set(['name', 'phone', 'lead_status', 'next_followup']);
  const infoItems = (_leadCols || []).filter(col => !skip.has(col.key) && col.type !== 'virtual' && !col.deleted).map(col => {
    const raw = col.builtin ? c[col.key] : (c.custom_fields || {})[col.key];
    let val;
    if (col.key === 'budget_lead') val = fmtBudget(c.budget_lead, c.budget_max);
    else if (col.type === 'select' || col.type === 'radio') { const m = colOptMap(col); val = m[normKey(raw, m)] || raw || '—'; }
    else if (col.type === 'checkbox') val = isChecked(raw) ? '<i data-lucide="check" style="width:12px;height:12px"></i> Yes' : '—';
    else if (col.type === 'number') val = raw ? Number(raw).toLocaleString() : '—';
    else val = raw || '—';
    return `<div class="ld-info-item"><div class="ld-info-label">${esc(col.label)}</div><div class="ld-info-value" title="${esc(String(raw ?? ''))}">${esc(String(val))}</div></div>`;
  }).join('');

  // Follow-ups
  const pending = (_ldProfile.followups || []).filter(f => f.status === 'pending');
  const fuCards = pending.map(f => {
    const overdue = new Date(f.due_at) < new Date();
    const assignee = (employeesForTasks || []).find(e => String(e.id) === String(f.assigned_to));
    return `<div class="ld-fu-card${overdue ? ' overdue' : ''}">
      <i data-lucide="alarm-clock" style="width:18px;height:18px;color:${overdue ? 'var(--danger)' : 'var(--primary)'};flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:${overdue ? 'var(--danger)' : 'var(--text)'}">${new Date(f.due_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${overdue ? ' — overdue' : ''}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(f.note || 'Follow up with the lead')}${assignee ? ` · ${esc(assignee.name)}` : ' · Admin'}</div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="ldFollowupStatus(${f.id},'done')">Done</button>
      <button class="btn btn-sm btn-outline" onclick="ldFollowupStatus(${f.id},'cancelled')" title="Cancel"><i data-lucide="x" style="width:12px;height:12px"></i></button>
    </div>`;
  }).join('');
  const empOpts = (employeesForTasks || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');

  // Timeline
  const acts = _ldProfile.activities || [];
  const tl = acts.length ? acts.map(a => {
    let bodyHtml = esc(a.body || '');
    if (a.type === 'status_change' && a.meta?.to) {
      const fk = normKey(a.meta.from, stMap), tk = normKey(a.meta.to, stMap);
      const pill = k => { const h = leadOptColor(stCol, k); return `background:${h ? hexA(h, 0.16) : 'rgba(255,255,255,.06)'};color:${h || '#b9b3a4'}`; };
      bodyHtml = `Status: <span class="ld-stage-pill" style="${pill(fk)}">${esc(stMap[fk] || a.meta.from || '—')}</span> → <span class="ld-stage-pill" style="${pill(tk)}">${esc(stMap[tk] || a.meta.to)}</span>`;
    }
    return `<div class="ld-tl-item">
      <div class="ld-tl-icon"><i data-lucide="${LD_ACT_ICONS[a.type] || 'circle'}"></i></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;line-height:1.5;word-break:break-word">${bodyHtml}</div>
        <div class="ld-tl-meta">${esc(a.author_name || '—')} · ${esc(notifRelTime(a.created_at))}</div>
      </div>
    </div>`;
  }).join('') : '<div style="color:var(--muted);font-size:12px;padding:10px 0">No activity yet — log the first touch below.</div>';

  // Quotations
  const quotes = _ldProfile.quotations || [];
  const quotesHtml = quotes.length ? quotes.map(q => `
    <div class="ld-quote-row">
      <div style="min-width:0">
        <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.title)}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:2px"><code>${esc(q.quote_id)}</code> · ${new Date(q.created_at).toLocaleDateString()} · ${esc(q.created_by)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-outline" onclick="viewDocPdf('quotation',${q.id},'${escJs(q.quote_id || 'Quotation')}')"><i data-lucide="file-text" style="width:12px;height:12px"></i> PDF</button>
        <button class="btn btn-sm btn-outline" onclick="closeLeadProfile();duplicateQuotation(${q.id})">Open in draft</button>
      </div>
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px">No quotations yet — use "Generate Quotation" above.</div>';

  // Contracts attached to this lead
  const contracts = _ldProfile.contracts || [];
  const contractsHtml = contracts.length ? contracts.map(ct => `
    <div class="ld-quote-row">
      <div style="min-width:0">
        <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ct.title || ct.contract_no)}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:2px"><code>${esc(ct.contract_no)}</code> · ${esc(CT_STATUS[ct.status] || ct.status)} · ${new Date(ct.created_at).toLocaleDateString()}${ct.created_by === 'auto_won' ? ' · auto' : ''}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-outline" onclick="viewDocPdf('contract',${ct.id},'${escJs(ct.contract_no || 'Contract')}')"><i data-lucide="file-text" style="width:12px;height:12px"></i> PDF</button>
        <button class="btn btn-sm btn-outline" onclick="closeLeadProfile();navigate('contracts');openContractForm(${ct.id})">Open</button>
      </div>
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px">No contracts yet — one is drafted automatically when a deal is Won.</div>';

  // Purchase orders attached to this lead
  const pos = _ldProfile.purchaseOrders || [];
  const posHtml = pos.length ? pos.map(p => {
    const items = Array.isArray(p.items) ? p.items : [];
    return `<div class="ld-quote-row">
      <div style="min-width:0">
        <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.supplier || p.title || p.po_number)}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:2px"><code>${esc(p.po_number)}</code> · ${items.length} line(s) · ${esc(PO_STATUS[p.status] || p.status)} · ${new Date(p.created_at).toLocaleDateString()}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-sm btn-outline" onclick="viewDocPdf('po',${p.id},'${escJs(p.po_number || 'Purchase order')}')"><i data-lucide="file-text" style="width:12px;height:12px"></i> PDF</button>
        <button class="btn btn-sm btn-outline" onclick="closeLeadProfile();navigate('purchaseorders');openPoForm(${p.id})">Open</button>
      </div>
    </div>`;
  }).join('') : '<div style="color:var(--muted);font-size:12px">No purchase orders yet.</div>';

  // Deals
  const deals = _ldProfile.deals || [];
  const dealsHtml = deals.length ? deals.map(d => `
    <div class="ld-quote-row">
      <div style="min-width:0">
        <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title)}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:2px">${d.budget_egp ? Number(d.budget_egp).toLocaleString() + ' EGP · ' : ''}${new Date(d.created_at).toLocaleDateString()}</div>
      </div>
      <span class="ld-stage-pill">${esc(DEAL_STAGE_LABELS[d.stage] || d.stage)}</span>
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px">No deals yet.</div>';

  document.getElementById('lead-drawer-body').innerHTML = `
    <div class="ld-section">
      <div class="ld-info-grid">${infoItems}</div>
    </div>
    <div class="ld-section">
      <div class="ld-section-title">Follow-ups</div>
      ${fuCards}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:${pending.length ? '10px' : '0'}">
        <input class="form-input" id="ld-fu-when" type="datetime-local" style="max-width:190px;font-size:12px;padding:8px 10px">
        <input class="form-input" id="ld-fu-note" placeholder="What to do…" style="flex:1;min-width:130px;font-size:12px;padding:8px 10px">
        <select class="form-input" id="ld-fu-who" style="max-width:150px;font-size:12px"><option value="">Remind me (Admin)</option>${empOpts}</select>
        <button class="btn btn-sm btn-primary" onclick="ldScheduleFollowup()">Schedule</button>
      </div>
    </div>
    ${clientFolderSection(c.id)}
    <div class="ld-section">
      <div class="ld-section-title">Quotations <span style="font-weight:400;text-transform:none;letter-spacing:0">${quotes.length || ''}</span></div>
      ${quotesHtml}
    </div>
    <div class="ld-section">
      <div class="ld-section-title">Contracts <span style="font-weight:400;text-transform:none;letter-spacing:0">${contracts.length || ''}</span></div>
      ${contractsHtml}
    </div>
    <div class="ld-section">
      <div class="ld-section-title">Purchase Orders <span style="font-weight:400;text-transform:none;letter-spacing:0">${pos.length || ''}</span></div>
      ${posHtml}
    </div>
    <div class="ld-section">
      <div class="ld-section-title">Deals ${deals.length ? `<button class="btn btn-sm btn-outline" style="font-size:10px;padding:3px 8px" onclick="closeLeadProfile();navigate('deals');filterDealsByCustomer(${c.id})">View in pipeline</button>` : ''}</div>
      ${dealsHtml}
    </div>
    <div class="ld-section">
      <div class="ld-section-title">Activity</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <select class="form-input" id="ld-act-type" style="max-width:120px;font-size:12px">
          <option value="note">Note</option><option value="call">Call</option>
          <option value="whatsapp">WhatsApp</option><option value="meeting">Meeting</option>
        </select>
        <input class="form-input" id="ld-act-body" placeholder="Log a call, note, meeting…" style="flex:1;font-size:12px" onkeydown="if(event.key==='Enter')ldLogActivity()">
        <button class="btn btn-sm btn-primary" onclick="ldLogActivity()">Log</button>
      </div>
      <div id="ld-timeline">${tl}</div>
    </div>`;
  requestAnimationFrame(() => { lucide.createIcons(); enhanceBrandSelects(); });
}

function ldStatusMenu(e) {
  e.stopPropagation();
  if (!_ldProfile) return;
  const col = leadCol('lead_status');
  const m = colOptMap(col);
  const cur = normKey(_ldProfile.customer.lead_status || 'cold', m);
  brandMenu(e.currentTarget, (col.options || []).map(o => ({ key: o.key, label: o.label, selected: o.key === cur })), async key => {
    try {
      const updated = await apiFetch(`/api/dashboard/customers/${_ldProfile.customer.id}`, { method: 'PUT', body: JSON.stringify({ lead_status: key }) }).then(r => r.json());
      if (updated.error) throw new Error(updated.error);
      const i = _allCustomers.findIndex(x => x.id === updated.id);
      if (i >= 0) _allCustomers[i] = updated;
      filterCustomers();
      refreshLeadProfile();
    } catch (err) { showAdminToast('Status change failed: ' + err.message); }
  });
}

async function ldScheduleFollowup() {
  const when = document.getElementById('ld-fu-when').value;
  if (!when) return showAdminToast('Pick a date & time for the follow-up');
  const body = {
    due_at: new Date(when).toISOString(),
    note: document.getElementById('ld-fu-note').value.trim(),
    assigned_to: document.getElementById('ld-fu-who').value || null,
  };
  const r = await apiFetch(`/api/dashboard/customers/${_ldProfile.customer.id}/followups`, { method: 'POST', body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok || d.error) return showAdminToast('Error: ' + (d.error || r.status));
  showAdminToast('Follow-up scheduled — a reminder will fire when it\'s due');
  _pendingFollowups[_ldProfile.customer.id] = _pendingFollowups[_ldProfile.customer.id] && new Date(_pendingFollowups[_ldProfile.customer.id]) < new Date(d.due_at) ? _pendingFollowups[_ldProfile.customer.id] : d.due_at;
  renderFuChip(); filterCustomers();
  refreshLeadProfile();
}

async function ldFollowupStatus(id, status) {
  const r = await apiFetch(`/api/dashboard/followups/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
  const d = await r.json();
  if (!r.ok || d.error) return showAdminToast('Error: ' + (d.error || r.status));
  // Recompute the table's earliest-pending map for this lead
  delete _pendingFollowups[d.customer_id];
  const rest = (_ldProfile.followups || []).filter(f => f.status === 'pending' && f.id !== id).sort((a, b) => a.due_at.localeCompare(b.due_at));
  if (rest[0]) _pendingFollowups[d.customer_id] = rest[0].due_at;
  renderFuChip(); filterCustomers();
  refreshLeadProfile();
}

async function ldLogActivity() {
  const input = document.getElementById('ld-act-body');
  const body = input.value.trim();
  if (!body) return;
  const type = document.getElementById('ld-act-type').value;
  const r = await apiFetch(`/api/dashboard/customers/${_ldProfile.customer.id}/activities`, { method: 'POST', body: JSON.stringify({ type, body }) });
  const d = await r.json();
  if (!r.ok || d.error) return showAdminToast('Error: ' + (d.error || r.status));
  input.value = '';
  refreshLeadProfile();
}

function ldEdit() {
  if (!_ldProfile) return;
  openCustomerModal(_ldProfile.customer.id);
}

function ldGenerateQuote() {
  if (!_ldProfile) return;
  const c = _ldProfile.customer;
  closeLeadProfile();
  // The quotation is a sheet now (same idiom as POs/RFQs) — open it directly
  // with the lead's name, vehicle, photos and price prefilled.
  openQuoteForm(null, { lead: c });
}

function toggleSelectAllLeads(cb) {
  // The FILTERED list, never _allCustomers: with a filter active, "select all"
  // used to quietly select every lead in the database — and the only bulk action
  // is Delete, so one confident click could have removed the whole leads pool.
  // _lastRenderedLeads is the same list the header checkbox's own state is
  // computed from, so behaviour and display finally agree.
  (_lastRenderedLeads || []).forEach(c => { if (cb.checked) _selectedLeads.add(c.id); else _selectedLeads.delete(c.id); });
  filterCustomers();
  updateLeadsBulkBar();
}

function toggleLeadSelect(id) {
  if (_selectedLeads.has(id)) _selectedLeads.delete(id); else _selectedLeads.add(id);
  updateLeadsBulkBar();
}

function updateLeadsBulkBar() {
  const bar = document.getElementById('leads-bulk-bar');
  const n = _selectedLeads.size;
  if (bar) { bar.style.display = n > 0 ? 'flex' : 'none'; }
  const cnt = document.getElementById('leads-bulk-count');
  // Say what the selection is out of, so "select all" under a filter reads as
  // what it now is — all of the filtered leads, not all leads.
  const total = (_lastRenderedLeads || []).length;
  if (cnt) cnt.textContent = n + ' selected' + (total && total < _allCustomers.length ? ` of ${total} filtered` : '');
}

function clearLeadSelection() {
  _selectedLeads.clear();
  updateLeadsBulkBar();
  filterCustomers();
}

async function bulkDeleteLeads() {
  if (!_selectedLeads.size) return;
  if (!confirm(`Delete ${_selectedLeads.size} lead(s)? This cannot be undone.`)) return;
  try {
    await Promise.all([..._selectedLeads].map(id => apiFetch(`/api/dashboard/customers/${id}`, { method:'DELETE' })));
    _selectedLeads.clear();
    updateLeadsBulkBar();
    await loadCustomers();
  } catch (e) { alert('Error: ' + e.message); }
}

function fillLeadSelect(id, colKey, emptyLabel, rawValue) {
  const sel = document.getElementById(id);
  const col = leadCol(colKey);
  if (!sel || !col) return;
  sel.innerHTML = (emptyLabel != null ? `<option value="">${esc(emptyLabel)}</option>` : '') +
    (col.options || []).map(o => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('');
  const k = normKey(rawValue, colOptMap(col));
  sel.value = [...sel.options].some(o => o.value === k) ? k : (emptyLabel != null ? '' : (col.options?.[0]?.key || ''));
}

// Is this lead column the "vehicle offered" field — the one wired to the inventory
// search? "Vehicle Requested" is what the customer asked for and stays free text;
// "Vehicle Offered" is the car we actually propose, so it picks from our inventory.
function isVehicleField(col) {
  const key = col?.key || '';
  if (key === 'cf_vehicle_offered') return true;
  const lbl = (col?.label || '').trim().toLowerCase();
  return lbl === 'vehicle offered' || lbl === 'car offered' || lbl === 'offered vehicle';
}
// ── Vehicle inventory combobox (search the website inventory, attach to a lead) ──
// Reusable across admin + employee lead modals. Fills the car text field and stashes
// the selected price in a hidden input. Free-typing is allowed (clears the price).
function attachVehicleSearch(inputId, priceId, resultsId, endpoint, hintId, imagesId) {
  const input = document.getElementById(inputId), results = document.getElementById(resultsId);
  const priceEl = document.getElementById(priceId), hint = hintId && document.getElementById(hintId);
  const imagesEl = imagesId && document.getElementById(imagesId);
  if (!input || !results || input._vehBound) return;
  input._vehBound = true;
  let t = null, lastReq = 0;
  const hide = () => { results.style.display = 'none'; };
  const money = n => (Number(n) || 0).toLocaleString() + ' EGP';
  const run = async () => {
    const q = input.value.trim();
    if (priceEl) priceEl.value = ''; // manual typing = no known price until a pick
    if (imagesEl) imagesEl.value = '';
    if (q.length < 1) { hide(); return; }
    const reqId = ++lastReq;
    try {
      const r = await apiFetch(`${endpoint}?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (reqId !== lastReq) return; // stale response
      if (hint && d.configured === false) { hint.textContent = '(inventory not connected)'; hide(); return; }
      if (hint) hint.textContent = '';
      const items = d.items || [];
      if (!items.length) { hide(); return; }
      results.innerHTML = items.map((it, i) => `
        <div class="veh-opt" data-i="${i}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);display:flex;justify-content:space-between;gap:10px;align-items:center"
             onmouseover="this.style.background='rgba(201,163,94,.12)'" onmouseout="this.style.background='none'">
          <div style="min-width:0"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.name)}</div>${it.subtitle ? `<div style="font-size:11px;color:var(--muted)">${esc(it.subtitle)}</div>` : ''}</div>
          ${it.price ? `<div style="font-size:12px;color:var(--primary);white-space:nowrap;font-weight:600">${money(it.price)}</div>` : ''}
        </div>`).join('');
      results._items = items;
      [...results.querySelectorAll('.veh-opt')].forEach(el => el.addEventListener('mousedown', ev => {
        ev.preventDefault();
        const it = results._items[+el.dataset.i];
        input.value = it.name;
        if (priceEl) priceEl.value = it.price != null ? it.price : '';
        if (imagesEl) imagesEl.value = JSON.stringify(Array.isArray(it.images) ? it.images : (it.image ? [it.image] : []));
        hide();
      }));
      results.style.display = 'block';
    } catch (_) { hide(); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  input.addEventListener('focus', () => { if (input.value.trim()) run(); });
  input.addEventListener('blur', () => setTimeout(hide, 200));
}

function openCustomerModal(id) {
  const c = id ? _allCustomers.find(x => x.id === id) : null;
  document.getElementById('customer-modal-title').textContent = c ? 'Edit Lead' : 'Add Lead';
  document.getElementById('cm-id').value = c?.id || '';
  document.getElementById('cm-name').value = c?.name || '';
  document.getElementById('cm-phone').value = c?.phone || '';
  document.getElementById('cm-date').value = c?.lead_date || '';
  document.getElementById('cm-time').value = c?.lead_time || '';
  fillLeadSelect('cm-lead-status', 'lead_status', null, c?.lead_status || 'cold');
  fillLeadSelect('cm-source', 'source', '— Unknown —', c?.source);
  fillLeadSelect('cm-next-action', 'next_action', '— None —', c?.next_action);
  document.getElementById('cm-car').value = c?.car_in_question || '';
  document.getElementById('cm-car-price').value = (c?.custom_fields && c.custom_fields.cf_vehicle_price) || '';
  document.getElementById('cm-car-images').value = (c?.custom_fields && Array.isArray(c.custom_fields.cf_vehicle_images)) ? JSON.stringify(c.custom_fields.cf_vehicle_images) : '';
  // 'Vehicle Requested' (car_in_question) is free text — the inventory picker now
  // lives on the 'Vehicle Offered' column, attached below with the custom fields.
  document.getElementById('cm-budget').value = (c?.budget_max != null && c?.budget_max !== '') ? `${c.budget_lead}-${c.budget_max}` : (c?.budget_lead || '');
  document.getElementById('cm-been-contacted').checked = c?.been_contacted || false;
  // Owner (sales rep) picker
  const ownerSel = document.getElementById('cm-owner');
  if (ownerSel) {
    ownerSel.innerHTML = '<option value="">— Unassigned —</option>' +
      (employeesForTasks || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    ownerSel.value = c?.assigned_to ? String(c.assigned_to) : '';
  }
  document.getElementById('cm-notes').value = c?.notes || '';
  document.getElementById('cm-sales-feedback').value = c?.sales_feedback || '';
  document.getElementById('cm-inquiry').value = c?.inquiry || '';
  // Custom columns → dynamic inputs
  const wrap = document.getElementById('cm-custom-fields');
  const custom = (_leadCols || []).filter(x => !x.builtin);
  wrap.innerHTML = custom.map(col => {
    const v = (c?.custom_fields || {})[col.key];
    if (col.type === 'checkbox') {
      return `<div><label class="form-label">${esc(col.label)}</label>
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#0e0e10;border:1px solid var(--hair);border-radius:6px">
          <input type="checkbox" id="cm-cf-${esc(col.key)}" ${v ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--gold)">
          <label for="cm-cf-${esc(col.key)}" style="font-size:13px;cursor:pointer">Yes</label>
        </div></div>`;
    }
    if (col.type === 'select') {
      const m = colOptMap(col);
      const k = normKey(v, m);
      return `<div><label class="form-label">${esc(col.label)}</label>
        <select class="form-input" id="cm-cf-${esc(col.key)}">
          <option value="">— None —</option>
          ${(col.options || []).map(o => `<option value="${esc(o.key)}"${k === o.key ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></div>`;
    }
    if (isVehicleField(col)) {
      return `<div style="position:relative"><label class="form-label">${esc(col.label)} <span id="cm-cf-${esc(col.key)}-hint" style="color:var(--muted);font-weight:400;font-size:11px"></span></label>
        <input class="form-input" id="cm-cf-${esc(col.key)}" value="${esc(v ?? '')}" placeholder="Search inventory or type a vehicle…" autocomplete="off">
        <input type="hidden" id="cm-cf-${esc(col.key)}-price"><input type="hidden" id="cm-cf-${esc(col.key)}-images">
        <div id="cm-cf-${esc(col.key)}-results" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:60;background:var(--card,#18181b);border:1px solid var(--border);border-radius:8px;margin-top:4px;max-height:240px;overflow:auto;box-shadow:0 10px 28px rgba(0,0,0,.45)"></div></div>`;
    }
    const t = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text';
    return `<div><label class="form-label">${esc(col.label)}</label>
      <input class="form-input" id="cm-cf-${esc(col.key)}" type="${t}" value="${esc(v ?? '')}"></div>`;
  }).join('');
  // Wire the inventory combobox onto each vehicle custom column + prefill its price.
  custom.filter(isVehicleField).forEach(col => {
    const pe = document.getElementById('cm-cf-' + col.key + '-price'); if (pe) pe.value = (c?.custom_fields && c.custom_fields.cf_vehicle_price) || '';
    const ie = document.getElementById('cm-cf-' + col.key + '-images'); if (ie) ie.value = (c?.custom_fields && Array.isArray(c.custom_fields.cf_vehicle_images)) ? JSON.stringify(c.custom_fields.cf_vehicle_images) : '';
    attachVehicleSearch('cm-cf-' + col.key, 'cm-cf-' + col.key + '-price', 'cm-cf-' + col.key + '-results', '/api/dashboard/inventory/search', 'cm-cf-' + col.key + '-hint', 'cm-cf-' + col.key + '-images');
  });
  // The static "Car in Question" field: hide it when the built-in column is removed/hidden
  // (this install uses the custom "Vehicle Requested" instead); otherwise keep its picker.
  const carCol = (_leadCols || []).find(x => x.key === 'car_in_question');
  const carWrap = document.getElementById('cm-car')?.closest('div');
  if (carWrap) carWrap.style.display = (carCol && (carCol.deleted || carCol.visible === false)) ? 'none' : '';
  document.getElementById('customer-modal').style.display = 'flex';
}

function closeCustomerModal() { document.getElementById('customer-modal').style.display = 'none'; }

async function saveCustomer() {
  const id = document.getElementById('cm-id').value;
  const payload = {
    name:           document.getElementById('cm-name').value.trim(),
    phone:          document.getElementById('cm-phone').value.trim(),
    lead_date:      document.getElementById('cm-date').value || null,
    lead_time:      document.getElementById('cm-time').value || null,
    lead_status:    document.getElementById('cm-lead-status').value,
    source:         document.getElementById('cm-source').value,
    car_in_question:document.getElementById('cm-car').value.trim(),
    ...(() => { const b = parseBudget(document.getElementById('cm-budget').value); return { budget_lead: b.min, budget_max: b.max }; })(),
    next_action:    document.getElementById('cm-next-action').value,
    been_contacted: document.getElementById('cm-been-contacted').checked,
    notes:          document.getElementById('cm-notes').value.trim(),
    sales_feedback: document.getElementById('cm-sales-feedback').value.trim(),
    inquiry:        document.getElementById('cm-inquiry').value.trim(),
    assigned_to:    document.getElementById('cm-owner')?.value ? parseInt(document.getElementById('cm-owner').value) : null,
  };
  const customCols = (_leadCols || []).filter(x => !x.builtin);
  const existingCf = id ? (_allCustomers.find(x => String(x.id) === String(id))?.custom_fields || {}) : {};
  const cf = { ...existingCf };
  customCols.forEach(col => {
    const el = document.getElementById('cm-cf-' + col.key);
    if (!el) return;
    cf[col.key] = col.type === 'checkbox' ? el.checked
      : col.type === 'number' ? (el.value === '' ? null : Number(el.value))
      : el.value;
  });
  // Stash the picked inventory vehicle's price + images (from whichever vehicle field was used) so quotes can prefill them.
  const vpEl = [...document.querySelectorAll('#customer-modal input[type=hidden][id$="-price"]')].find(el => el.value);
  if (vpEl) cf.cf_vehicle_price = Number(vpEl.value); else delete cf.cf_vehicle_price;
  const viEl = [...document.querySelectorAll('#customer-modal input[type=hidden][id$="-images"]')].find(el => el.value);
  if (viEl) { try { const arr = JSON.parse(viEl.value); if (Array.isArray(arr) && arr.length) cf.cf_vehicle_images = arr; else delete cf.cf_vehicle_images; } catch (_) { delete cf.cf_vehicle_images; } } else delete cf.cf_vehicle_images;
  if (Object.keys(cf).length || customCols.length) payload.custom_fields = cf;
  if (!payload.name) { alert('Name is required.'); return; }
  try {
    const url = id ? `/api/dashboard/customers/${id}` : '/api/dashboard/customers';
    const method = id ? 'PUT' : 'POST';
    let r = await apiFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    // Duplicate phone on create → let the admin open the existing lead or create anyway.
    if (r.status === 409) {
      const { existing } = await r.json();
      const openIt = confirm(`A lead with this phone already exists: "${existing?.name || 'Unknown'}".\n\nOK = open the existing lead · Cancel = create a new one anyway.`);
      if (openIt) { closeCustomerModal(); if (existing?.id && typeof openLeadProfile === 'function') openLeadProfile(existing.id); return; }
      r = await apiFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...payload, force: true }) });
    }
    if (!r.ok) { const err = await r.json().catch(() => ({})); alert('Error: ' + (err.error || r.status)); return; }
    closeCustomerModal();
    await loadCustomers();
  } catch (e) { alert('Error: ' + e.message); }
}

async function deleteCustomer(id) {
  if (!confirm('Delete this lead and all their deals?')) return;
  try {
    await apiFetch(`/api/dashboard/customers/${id}`, { method:'DELETE' });
    await loadCustomers();
  } catch (e) { alert('Error: ' + e.message); }
}

function openCsvImportModal() {
  document.getElementById('csv-file-input').value = '';
  document.getElementById('csv-sheet-url').value = '';
  document.getElementById('csv-import-modal').style.display = 'flex';
}

async function importLeadsCsv() {
  const fileInput = document.getElementById('csv-file-input');
  const sheetUrl = document.getElementById('csv-sheet-url').value.trim();
  const updateExisting = document.getElementById('csv-update-existing')?.checked ? 'true' : 'false';
  if (!fileInput.files[0] && !sheetUrl) { alert('Please select a CSV file or enter a spreadsheet URL.'); return; }
  try {
    let result;
    if (fileInput.files[0]) {
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      fd.append('updateExisting', updateExisting);
      result = await apiFetch('/api/dashboard/customers/import', { method:'POST', body: fd }).then(r => r.json());
    } else {
      result = await apiFetch('/api/dashboard/customers/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sheetUrl, updateExisting: updateExisting === 'true' }) }).then(r => r.json());
    }
    if (result.error) { alert('Import error: ' + result.error); return; }
    let msg = `Imported ${result.count} new lead(s)` + (result.updated ? `, updated ${result.updated} existing` : '') + (result.skipped ? `, skipped ${result.skipped}` : '') + (result.deals ? `, created ${result.deals} deal(s) for Hot leads` : '') + '.';
    if (result.unmatchedHeaders && result.unmatchedHeaders.length) msg += `\n\nThese columns aren't in your leads table, so they were skipped. Add them (+ button), then re-import:\n${result.unmatchedHeaders.join(', ')}`;
    alert(msg);
    document.getElementById('csv-import-modal').style.display = 'none';
    await loadCustomers();
  } catch (e) { alert('Import error: ' + e.message); }
}

// ── Find & remove duplicate leads ───────────────────────────────────────────
let _dedupeGroups = [];
async function openDedupeModal() {
  document.getElementById('dedupe-modal').style.display = 'flex';
  document.getElementById('dedupe-confirm-btn').style.display = 'none';
  const body = document.getElementById('dedupe-body');
  body.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">Scanning…</div>';
  try {
    const data = await apiFetch('/api/dashboard/customers/duplicates').then(r => r.json());
    if (data.error) throw new Error(data.error);
    _dedupeGroups = data.groups || [];
    if (!_dedupeGroups.length) {
      body.innerHTML = '<div style="color:var(--muted);padding:24px;text-align:center"><i data-lucide="check" style="width:14px;height:14px"></i> No duplicate leads found.</div>';
      return;
    }
    const fmt = c => [c.phone, c.car_in_question, c.lead_date].filter(Boolean).join(' · ') || '—';
    body.innerHTML = `<div style="font-size:13px;color:var(--gold);font-weight:600">${data.groupCount} duplicate group(s) · ${data.totalRemove} lead(s) to remove</div>` +
      _dedupeGroups.map((g, gi) => `
        <div style="border:1px solid var(--hair);border-radius:8px;padding:10px 12px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:12px;background:rgba(100,180,120,.15);color:#7fce9a;padding:2px 8px;border-radius:6px">KEEP</span>
            <strong style="font-size:13px">${esc(g.keeper.name || '(no name)')}</strong>
            <span style="font-size:11px;color:var(--muted)">${esc(fmt(g.keeper))} · #${g.keeper.id}</span>
          </div>
          ${g.remove.map(c => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;cursor:pointer">
              <input type="checkbox" class="dedupe-cb" data-id="${c.id}" checked>
              <span style="color:var(--danger)">remove</span>
              <span>${esc(c.name || '(no name)')}</span>
              <span style="color:var(--muted)">${esc(fmt(c))} · #${c.id}</span>
            </label>`).join('')}
        </div>`).join('');
    document.getElementById('dedupe-confirm-btn').style.display = 'inline-flex';
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    body.innerHTML = `<div style="color:var(--danger);padding:20px">${esc(e.message)}</div>`;
  }
}
async function confirmDedupe() {
  const ids = [...document.querySelectorAll('.dedupe-cb:checked')].map(cb => Number(cb.dataset.id));
  if (!ids.length) { alert('Select at least one lead to remove.'); return; }
  if (!confirm(`Permanently delete ${ids.length} duplicate lead(s)? This cannot be undone.`)) return;
  try {
    const r = await apiFetch('/api/dashboard/customers/dedupe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    document.getElementById('dedupe-modal').style.display = 'none';
    alert(`Removed ${r.deleted} duplicate lead(s).`);
    await loadCustomers();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── Deals ─────────────────────────────────────────────────────────────────
const DEAL_STAGES = ['lead','inquiry','quoted','negotiating','won','lost'];
const DEAL_STAGE_LABELS = { lead:'Lead', inquiry:'Inquiry', quoted:'Quoted', negotiating:'Negotiating', won:'Won', lost:'Lost' };
const DEAL_STAGE_COLORS = { lead:'rgba(201,163,94,.15)', inquiry:'rgba(124,106,255,.15)', quoted:'rgba(90,120,200,.15)', negotiating:'rgba(230,150,80,.15)', won:'rgba(100,180,120,.15)', lost:'rgba(239,68,68,.1)' };
let _allDeals = [];
let _dealsCustomerFilter = null;

async function loadDeals() {
  try {
    _allDeals = await apiFetch('/api/dashboard/deals').then(r => r.json());
    renderDealsKanban();
    await populateDealModalCustomers();
    await populateDealModalAssignees();
    // Keep the active tab in sync (Inquiry reads the deals we just loaded)
    dealsTab(_dealsTab);
  } catch (e) { document.getElementById('deals-kanban').innerHTML = `<div style="color:var(--danger);padding:24px">${esc(e.message)}</div>`; }
}

function filterDealsByCustomer(customerId) {
  _dealsCustomerFilter = customerId || null;
  renderDealsKanban();
}

function renderDealsKanban() {
  const kanban = document.getElementById('deals-kanban');
  const deals = _dealsCustomerFilter ? _allDeals.filter(d => d.customer_id === _dealsCustomerFilter) : _allDeals;
  kanban.innerHTML = DEAL_STAGES.map(stage => {
    const stagDeals = deals.filter(d => d.stage === stage);
    return `<div class="deal-col" data-stage="${stage}"
        ondragover="dealDragOver(event)" ondragleave="dealDragLeave(event)" ondrop="dealDrop(event,'${stage}')"
        style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;min-height:200px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">${esc(DEAL_STAGE_LABELS[stage])}</div>
        <div style="background:rgba(255,255,255,.07);border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700">${stagDeals.length}</div>
      </div>
      ${stagDeals.map(d => dealCard(d)).join('')}
    </div>`;
  }).join('');
  requestAnimationFrame(() => lucide.createIcons());
}

function dealCard(d) {
  const daysOpen = Math.floor((Date.now() - new Date(d.created_at)) / 86400000);
  const customer = d.customers;
  return `<div class="deal-card" id="deal-card-${d.id}" draggable="true"
      ondragstart="dealDragStart(event, ${d.id})" ondragend="dealDragEnd(event)"
      onclick="dealCardClick(${d.id})">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px;line-height:1.3">${esc(d.title)}</div>
    ${customer && d.customer_id
      ? `<div onclick="dealOpenLead(event, ${d.customer_id})" title="View lead profile" style="font-size:11px;color:var(--primary);margin-bottom:4px;cursor:pointer;display:inline-flex;align-items:center;gap:3px"><i data-lucide="user" style="width:10px;height:10px"></i> ${esc(customer.name)}</div>`
      : (customer ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px"><i data-lucide="user" style="width:10px;height:10px"></i> ${esc(customer.name)}</div>` : '')}
    ${d.car_model ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px"><i data-lucide="car" style="width:10px;height:10px"></i> ${esc(d.car_model)}</div>` : ''}
    ${d.budget_egp ? `<div style="font-size:12px;font-weight:700;color:var(--primary);margin-bottom:4px">${Number(d.budget_egp).toLocaleString()} EGP</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
      ${d.assigned_to ? `<div style="font-size:10px;color:var(--muted)">${esc(d.assigned_to)}</div>` : '<div></div>'}
      <div style="font-size:10px;color:var(--muted)">${daysOpen}d</div>
    </div>
  </div>`;
}

// ── Deals drag & drop between stages ──────────────────────────────────────────
let _dragDealId = null;
let _dealJustDragged = false; // suppress the click-to-edit that follows a drag

function dealCardClick(id) {
  if (_dealJustDragged) { _dealJustDragged = false; return; }
  // Open the linked lead's 360° profile (the full card) instead of the small
  // "Edit Deal" modal. Deals are managed via drag-and-drop + the lead card.
  const d = _allDeals.find(x => x.id === id);
  if (d && d.customer_id) openLeadProfile(d.customer_id);
  else openDealModal(id); // fallback: a deal with no linked lead
}

// Open the deal's linked lead in the 360° drawer (from the card's customer name)
function dealOpenLead(e, customerId) {
  e.stopPropagation();                                          // don't open the deal-edit modal
  if (_dealJustDragged) { _dealJustDragged = false; return; }   // ignore the click after a drag
  if (customerId) openLeadProfile(customerId);
}

function dealDragStart(e, id) {
  _dragDealId = id;
  const card = e.currentTarget;
  card.classList.add('deal-dragging');
  document.body.classList.add('dragging-deal');
  e.dataTransfer.effectAllowed = 'move';
  // Cool drag ghost: a tilted, glowing clone of the card
  const ghost = card.cloneNode(true);
  ghost.style.cssText = `position:fixed;top:-500px;left:-500px;width:${card.offsetWidth}px;transform:rotate(4deg) scale(1.05);box-shadow:0 14px 40px rgba(201,163,94,.45), 0 0 0 1px var(--primary);border-radius:8px;background:var(--card,#18181b);opacity:.95;pointer-events:none;padding:12px`;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, card.offsetWidth / 2, 24);
  setTimeout(() => ghost.remove(), 0);
}

function dealDragEnd(e) {
  _dealJustDragged = true;
  setTimeout(() => { _dealJustDragged = false; }, 150);
  e.currentTarget.classList.remove('deal-dragging');
  document.body.classList.remove('dragging-deal');
  document.querySelectorAll('.deal-col.drag-over').forEach(c => c.classList.remove('drag-over'));
  _dragDealId = null;
}

function dealDragOver(e) {
  if (_dragDealId == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function dealDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
}

async function dealDrop(e, stage) {
  e.preventDefault();
  const id = _dragDealId;
  document.querySelectorAll('.deal-col.drag-over').forEach(c => c.classList.remove('drag-over'));
  if (id == null) return;
  const deal = _allDeals.find(d => d.id === id);
  if (!deal || deal.stage === stage) return;
  const prevStage = deal.stage;
  // Optimistic move, revert on failure
  deal.stage = stage;
  renderDealsKanban();
  try {
    const updated = await apiFetch(`/api/dashboard/deals/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) }).then(r => r.json());
    if (updated?.error) throw new Error(updated.error);
    const idx = _allDeals.findIndex(d => d.id === id);
    if (idx >= 0) _allDeals[idx] = updated;
    renderDealsKanban();
  } catch (err) {
    deal.stage = prevStage;
    renderDealsKanban();
    showAdminToast('Could not move deal: ' + err.message);
  }
}

let _dealModalEmployees = [];
let _dealModalCustomers = [];

async function populateDealModalCustomers() {
  _dealModalCustomers = _allCustomers.length ? _allCustomers : await apiFetch('/api/dashboard/customers').then(r => r.json());
  const sel = document.getElementById('dm-customer-id');
  if (sel) {
    sel.innerHTML = '<option value="">Select customer…</option>' +
      _dealModalCustomers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }
}

async function populateDealModalAssignees() {
  try {
    const emps = await apiFetch('/api/dashboard/employees-for-tasks').then(r => r.json());
    _dealModalEmployees = emps;
    const sel = document.getElementById('dm-assigned-to');
    if (sel) {
      sel.innerHTML = '<option value="">Unassigned</option>' +
        emps.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join('');
    }
  } catch (_) {}
}

function openDealModal(id) {
  const d = id ? _allDeals.find(x => x.id === id) : null;
  document.getElementById('deal-modal-title').textContent = d ? 'Edit Deal' : 'Add Deal';
  document.getElementById('dm-id').value          = d?.id           || '';
  document.getElementById('dm-customer-id').value = d?.customer_id  || '';
  document.getElementById('dm-title').value        = d?.title        || '';
  document.getElementById('dm-stage').value        = d?.stage        || 'lead';
  document.getElementById('dm-car-model').value    = d?.car_model    || '';
  document.getElementById('dm-budget').value       = d?.budget_egp   || '';
  document.getElementById('dm-inquiry').value      = d?.inquiry_details || '';
  document.getElementById('dm-est-value').value   = d?.est_value    || '';
  document.getElementById('dm-notes').value        = d?.notes        || '';
  document.getElementById('dm-assigned-to').value  = d?.assigned_to  || '';
  document.getElementById('deal-modal').style.display = 'flex';
}

function closeDealModal() { document.getElementById('deal-modal').style.display = 'none'; }

async function saveDeal() {
  const id = document.getElementById('dm-id').value;
  const payload = {
    customer_id: parseInt(document.getElementById('dm-customer-id').value),
    title:       document.getElementById('dm-title').value.trim(),
    stage:       document.getElementById('dm-stage').value,
    car_model:   document.getElementById('dm-car-model').value.trim(),
    budget_egp:  parseFloat(document.getElementById('dm-budget').value) || null,
    inquiry_details: document.getElementById('dm-inquiry').value.trim(),
    est_value:   parseFloat(document.getElementById('dm-est-value').value) || null,
    notes:       document.getElementById('dm-notes').value.trim(),
    assigned_to: document.getElementById('dm-assigned-to').value,
  };
  if (!payload.customer_id || !payload.title) { alert('Customer and title are required.'); return; }
  try {
    const url = id ? `/api/dashboard/deals/${id}` : '/api/dashboard/deals';
    const method = id ? 'PUT' : 'POST';
    const deal = await apiFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).then(r => r.json());
    if (id) { const idx = _allDeals.findIndex(d => d.id === deal.id); if (idx >= 0) _allDeals[idx] = deal; }
    else { _allDeals.unshift(deal); }
    closeDealModal();
    renderDealsKanban();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── WhatsApp ───────────────────────────────────────────────────────────────
let waSse = null;
let waContacts = [];
let waActiveContact = null;
let waMessages = [];

async function loadWhatsApp() {
  waOpenSse();
  await waRefreshStatus();
}

async function waRefreshStatus() {
  try {
    const s = await apiFetch('/api/dashboard/whatsapp/status').then(r => r.json());
    waApplyStatus(s.status, s.qr, s.enabled);
  } catch (_) {}
}

function waApplyStatus(status, qr, enabled) {
  const dot = document.getElementById('wa-status-dot');
  const txt = document.getElementById('wa-status-text');
  const connectBtn = document.getElementById('wa-connect-btn');
  const logoutBtn  = document.getElementById('wa-logout-btn');
  const qrPanel = document.getElementById('wa-qr-panel');
  const layout  = document.getElementById('wa-layout');

  const labels = { ready:'Connected', qr:'Scan QR to link', connecting:'Connecting…', disconnected:'Disconnected' };
  txt.textContent = (enabled === false) ? 'WhatsApp disabled on server' : (labels[status] || status);
  dot.style.background = status === 'ready' ? '#4caf50' : (status === 'disconnected' ? 'var(--muted)' : 'var(--primary)');

  connectBtn.style.display = (status === 'disconnected' && enabled !== false) ? '' : 'none';
  logoutBtn.style.display  = (status === 'ready') ? '' : 'none';
  qrPanel.style.display = (status === 'qr') ? 'flex' : 'none';
  layout.style.display  = (status === 'ready') ? 'grid' : 'none';

  if (status === 'qr' && qr) document.getElementById('wa-qr-img').src = qr;
  if (status === 'ready') waLoadContacts();
  requestAnimationFrame(() => lucide.createIcons());
}

function waOpenSse() {
  waCloseSse();
  waSse = chatStream(() => `/api/dashboard/whatsapp/events?_t=${encodeURIComponent(authToken)}`, es => {
  es.addEventListener('whatsapp_status', e => {
    const d = JSON.parse(e.data);
    waApplyStatus(d.status, d.qr);
  });
  es.addEventListener('whatsapp_message', e => {
    const d = JSON.parse(e.data);
    // Update contact list ordering/preview
    const idx = waContacts.findIndex(c => c.id === d.contact.id);
    if (idx >= 0) waContacts[idx] = d.contact; else waContacts.unshift(d.contact);
    waContacts.sort((a,b) => new Date(b.last_message_at||0) - new Date(a.last_message_at||0));
    if (waActiveContact && d.contact.id === waActiveContact.id) {
      waMessages.push(d.message);
      waRenderMessages();
      // mark read on server (explicit read endpoint — GET no longer mutates unread)
      apiFetch(`/api/dashboard/whatsapp/contacts/${waActiveContact.id}/read`, { method: 'POST' }).catch(()=>{});
    }
    waRenderContacts();
  });
  });
}

function waCloseSse() { if (waSse) { try { waSse.close(); } catch(_){} waSse = null; } }

async function waConnect() {
  document.getElementById('wa-status-text').textContent = 'Connecting…';
  try { await apiFetch('/api/dashboard/whatsapp/connect', { method:'POST' }); } catch (e) { alert('Connect failed: ' + e.message); }
}

async function waLogout() {
  if (!confirm('Log out of WhatsApp? You will need to scan the QR again to reconnect.')) return;
  try { await apiFetch('/api/dashboard/whatsapp/logout', { method:'POST' }); waApplyStatus('disconnected'); } catch (e) { alert(e.message); }
}

async function waLoadContacts() {
  try {
    waContacts = await apiFetch('/api/dashboard/whatsapp/contacts').then(r => r.json());
    waRenderContacts();
  } catch (_) {}
}

function waRenderContacts() {
  const list = document.getElementById('wa-contacts-list');
  if (!waContacts.length) { list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No conversations yet.</div>'; return; }
  list.innerHTML = waContacts.map(c => `
    <div class="chat-room-item ${waActiveContact && waActiveContact.id === c.id ? 'active':''}" data-wa="${c.id}" onclick="waOpenContact(${c.id})">
      <div style="width:38px;height:38px;border-radius:50%;background:rgba(37,211,102,.15);color:#25d366;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700">${esc((c.name||c.phone||'?').charAt(0).toUpperCase())}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;gap:6px">
          <span style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name || c.phone)}</span>
          ${c.unread ? `<span style="background:#25d366;color:#fff;border-radius:10px;font-size:10px;font-weight:700;padding:1px 6px;flex-shrink:0">${c.unread}</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.last_message_preview || '')}</div>
      </div>
    </div>`).join('');
}

async function waOpenContact(id) {
  waActiveContact = waContacts.find(c => c.id === id) || null;
  if (!waActiveContact) return;
  document.getElementById('wa-conv-empty').style.display = 'none';
  document.getElementById('wa-conv').style.display = 'flex';
  document.getElementById('wa-conv-name').textContent = waActiveContact.name || waActiveContact.phone;
  document.getElementById('wa-conv-phone').textContent = '+' + (waActiveContact.phone || '');
  waActiveContact.unread = 0;
  waRenderContacts();
  // mobile: swap to conversation view
  document.getElementById('wa-contacts-panel').classList.remove('mob-show');
  document.getElementById('wa-conv-panel').classList.add('mob-show');
  try {
    waMessages = await apiFetch(`/api/dashboard/whatsapp/contacts/${id}/messages`).then(r => r.json());
    waRenderMessages();
    // clear unread explicitly now that opening the conversation no longer mutates state via GET
    apiFetch(`/api/dashboard/whatsapp/contacts/${id}/read`, { method: 'POST' }).catch(()=>{});
  } catch (_) {}
}

function waBackToList() {
  document.getElementById('wa-contacts-panel').classList.add('mob-show');
  document.getElementById('wa-conv-panel').classList.remove('mob-show');
}

function waRenderMessages() {
  const box = document.getElementById('wa-messages');
  box.innerHTML = waMessages.map(m => {
    const mine = m.direction === 'out';
    const t = new Date(m.ts || m.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    let media = '';
    if (m.media_url) {
      if ((m.media_type||'').startsWith('image/')) media = `<a href="${esc(m.media_url)}" target="_blank"><img src="${esc(m.media_url)}" style="max-width:220px;border-radius:10px;margin-bottom:4px;display:block"></a>`;
      else media = `<a href="${esc(m.media_url)}" target="_blank" style="color:inherit;text-decoration:underline"><i data-lucide="paperclip" style="width:12px;height:12px"></i> Attachment</a>`;
    }
    return `<div class="chat-msg ${mine?'mine':'theirs'}">
      <div class="chat-msg-bubble">${media}${esc(m.body||'')}</div>
      <div class="chat-msg-time">${t}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function waInputKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); waSend(); } }

async function waSend() {
  const input = document.getElementById('wa-input');
  const body = input.value.trim();
  if (!body || !waActiveContact) return;
  input.value = '';
  try {
    const msg = await apiFetch(`/api/dashboard/whatsapp/contacts/${waActiveContact.id}/messages`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ body })
    }).then(r => r.json());
    if (msg.error) { alert(msg.error); input.value = body; return; }
    waMessages.push(msg);
    waRenderMessages();
  } catch (e) { alert('Send failed: ' + e.message); input.value = body; }
}

function waShowNewModal() { document.getElementById('wa-new-phone').value = ''; document.getElementById('wa-new-body').value = ''; document.getElementById('wa-new-modal').style.display = 'flex'; }
function waCloseNewModal() { document.getElementById('wa-new-modal').style.display = 'none'; }

async function waSendNew() {
  const phone = document.getElementById('wa-new-phone').value.replace(/[^\d]/g, '');
  const body  = document.getElementById('wa-new-body').value.trim();
  if (!phone || !body) { alert('Phone and message are required.'); return; }
  try {
    const result = await apiFetch('/api/dashboard/whatsapp/send', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone, body })
    }).then(r => r.json());
    if (result.error) { alert(result.error); return; }
    waCloseNewModal();
    await waLoadContacts();
    if (result.contact) waOpenContact(result.contact.id);
  } catch (e) { alert('Send failed: ' + e.message); }
}

// ── PWA: iOS add-to-home-screen hint ──────────────────────────────────────
(function iosInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!isIOS || window.navigator.standalone === true) return;
  if (localStorage.getItem('iosAdminHintDismissed')) return;
  const hint = document.getElementById('pwa-ios-hint');
  if (hint) setTimeout(() => { hint.style.display = 'flex'; }, 2500);
})();

function dismissAdminIOSHint() {
  localStorage.setItem('iosAdminHintDismissed', '1');
  document.getElementById('pwa-ios-hint').style.display = 'none';
}

// ── Brand dropdowns ───────────────────────────────────────────────────────────
// Replaces every native <select> (form-input / form-control / filter-input) with
// a styled trigger + floating gold-on-dark options panel. The original select
// stays in the DOM (hidden) as the source of truth, so all existing code that
// reads/writes .value, rebuilds options via innerHTML, or listens to `change`
// keeps working unchanged. New selects added later (modals) are auto-enhanced.
(function () {
  const SELECTOR = 'select.form-input, select.form-control, select.filter-input';
  let menuEl = null, openFor = null;

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'bselect-menu';
    document.body.appendChild(menuEl);
    document.addEventListener('click', e => {
      if (openFor && !menuEl.contains(e.target) && !(openFor.trigger && openFor.trigger.contains(e.target))) closeBrandMenu();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBrandMenu(); });
    window.addEventListener('resize', closeBrandMenu);
  }
  function closeBrandMenu() {
    if (menuEl) menuEl.classList.remove('open');
    if (openFor?.trigger) openFor.trigger.classList.remove('open');
    openFor = null;
  }

  // Generic: open a styled option panel anchored to an element.
  // items: [{ key, label, selected }] — onPick(key) called on choose.
  window.brandMenu = function (anchorEl, items, onPick, trigger) {
    ensureMenu();
    if (openFor && openFor.anchor === anchorEl) return closeBrandMenu();
    const showSearch = items.length > 8;   // type-to-filter for long lists (e.g. leads)
    const optsHtml = items.map((it, i) => `
      <button type="button" class="bselect-opt${it.selected ? ' selected' : ''}" data-i="${i}">
        <span class="bselect-check">${it.selected ? '<i data-lucide="check" style="width:12px;height:12px"></i>' : ''}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.label || '—')}</span>
      </button>`).join('');
    menuEl.innerHTML =
      (showSearch ? `<div class="bselect-search-wrap"><input type="text" class="bselect-search" placeholder="Search…"></div>` : '') +
      `<div class="bselect-list">${optsHtml}</div>` +
      `<div class="bselect-empty" style="display:none">No matches</div>`;
    const listEl = menuEl.querySelector('.bselect-list');
    const emptyEl = menuEl.querySelector('.bselect-empty');
    const pick = i => { const it = items[i]; closeBrandMenu(); onPick(it.key, it); };
    listEl.querySelectorAll('.bselect-opt').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); pick(parseInt(btn.dataset.i)); }));
    if (showSearch) {
      const search = menuEl.querySelector('.bselect-search');
      search.addEventListener('click', e => e.stopPropagation());
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        listEl.querySelectorAll('.bselect-opt').forEach(btn => {
          const ok = !q || (items[parseInt(btn.dataset.i)].label || '').toLowerCase().includes(q);
          btn.style.display = ok ? '' : 'none';
          if (ok) shown++;
        });
        emptyEl.style.display = shown ? 'none' : 'block';
      });
      search.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); const first = [...listEl.querySelectorAll('.bselect-opt')].find(b => b.style.display !== 'none'); if (first) pick(parseInt(first.dataset.i)); }
        else if (e.key === 'Escape') { e.preventDefault(); closeBrandMenu(); }
      });
    }
    const r = anchorEl.getBoundingClientRect();
    menuEl.style.minWidth = Math.max(r.width, 150) + 'px';
    menuEl.classList.add('open');
    const mh = Math.min(menuEl.scrollHeight, 280);
    const spaceBelow = window.innerHeight - r.bottom;
    menuEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menuEl.offsetWidth - 8)) + 'px';
    menuEl.style.top = (spaceBelow > mh + 12 || spaceBelow > r.top ? r.bottom + 6 : Math.max(8, r.top - mh - 6)) + 'px';
    openFor = { anchor: anchorEl, trigger: trigger || null };
    if (trigger) trigger.classList.add('open');
    menuEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    if (showSearch) setTimeout(() => menuEl.querySelector('.bselect-search')?.focus(), 20);
  };

  function labelFor(sel) {
    const o = sel.options[sel.selectedIndex];
    return o ? o.text : '';
  }
  function syncLabel(sel) {
    const lbl = sel._bTrigger?.querySelector('.bselect-label');
    if (lbl) lbl.textContent = labelFor(sel) || ' ';
  }

  function enhanceSelect(sel) {
    if (sel._bTrigger || sel.dataset.native != null || sel.multiple) return;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'bselect-trigger';
    trigger.style.cssText = sel.style.cssText;
    trigger.innerHTML = '<span class="bselect-label"> </span>';
    sel.after(trigger);
    sel.classList.add('bselect-hidden');
    sel._bTrigger = trigger;
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      window.brandMenu(trigger, [...sel.options].map((o, i) => ({ key: i, label: o.text, selected: i === sel.selectedIndex })), i => {
        sel.selectedIndex = i;
        syncLabel(sel);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, trigger);
    });
    sel.addEventListener('change', () => syncLabel(sel));
    // Programmatic `sel.value = x` must update the visible label too
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      get() { return proto.get.call(this); },
      set(v) { proto.set.call(this, v); syncLabel(this); },
    });
    new MutationObserver(() => syncLabel(sel)).observe(sel, { childList: true, subtree: true });
    syncLabel(sel);
  }

  function enhanceAll(root) { (root && root.querySelectorAll ? root : document).querySelectorAll(SELECTOR).forEach(enhanceSelect); }
  window.enhanceBrandSelects = enhanceAll;
  enhanceAll();
  new MutationObserver(muts => {
    for (const mu of muts) {
      for (const n of mu.addedNodes) {
        if (n.nodeType === 1 && (n.matches?.(SELECTOR) || n.querySelector?.(SELECTOR))) { enhanceAll(); return; }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
})();

// Portal binding for the shared Home dashboard below.
const HOMECFG = {
  base: '/api/dashboard',
  fetch: (url, opts) => apiFetch(url, opts),
  can: () => true,                       // the admin sees every widget
  // Read-only views of state the page already keeps, so the widgets do not fetch
  // what is sitting in memory a few lines away.
  unread: () => adminChatUnread.size,
  notifs: () => notifItems.filter(n => !n.read),
  google: { drive: '/api/drive/files', sheets: '/api/drive/sheets', email: '/api/email/messages' },
  toast: msg => hdToast(msg),
  sheet: (t, b, f) => hdSheet(t, b, f),
  actions: () => ([
    { label: 'New lead',  icon: 'user-plus',      onclick: "navigate('customers')" },
    { label: 'New task',  icon: 'plus',           onclick: "navigate('tasks')" },
    { label: 'Quotation', icon: 'file-text',      onclick: "navigate('quotation')" },
    { label: 'Chat',      icon: 'message-square', onclick: "navigate('chat')" },
  ]),
};

// Portal binding for the shared huddle / group-admin module below.
// Portal binding for the shared operations module (Suppliers, RFQ, POs, Contracts,
// Submissions). The admin is not subject to employee permissions, so `can` is true.
// Portal binding for the shared quotation sheet (quote.js). Who may issue,
// which leads are pickable, and who the settings can notify — the three lists
// that genuinely differ between the portals.
// Attendee list for the shared meetings module.
const MEETCFG = {
  people: async () => apiFetch('/api/dashboard/employees-for-tasks').then(r => r.json()).catch(() => []),
};
const QTCFG = {
  issuers: async () => { await preloadEmployeesForTasks(); return (employeesForTasks || []).map(e => e.name); },
  leads: async () => {
    const leads = _allCustomers.length ? _allCustomers : await apiFetch('/api/dashboard/customers').then(r => r.json());
    if (Array.isArray(leads) && !_allCustomers.length) _allCustomers = leads;
    return [...(Array.isArray(leads) ? leads : [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },
  people: async () => apiFetch('/api/dashboard/employees-for-tasks').then(r => r.json()).catch(() => []),
};

// The client folder's portal adapter — the admin owns the sharing list, so
// isAdmin is true here and the people list is the employee roster.
const CFCFG = {
  base: '/api/dashboard',
  path: id => `/customers/${id}/folder`,
  fetch: (url, opts) => apiFetch(url, opts),
  toast: (msg, bad) => showAdminToast(msg, bad),
  can: () => true,
  isAdmin: true,
  people: () => employeesForTasks || [],
};

const PROCFG = {
  base: '/api/dashboard',
  fetch: (url, opts) => apiFetch(url, opts),
  modal: (...a) => showModal(...a),
  closeModal: () => hideModal(),
  toast: (m) => showAdminToast(m),
  can: () => true,
};

const HDCFG = {
  // The admin is not subject to employee permissions; nothing here is gated.
  can: () => true,
  base: '/api/dashboard/chat',
  me: () => 'admin',
  fetch: (url, opts) => apiFetch(url, opts),
  rooms: () => adminChatRooms,
  activeRoom: () => adminActiveChatRoom,
  openRoom: id => adminChatOpenRoom(id),
  // Opened on demand when a huddle is accepted from outside the chat page, which is
  // where the signalling actually travels.
  ensureStream: () => { if (!adminChatSse) adminOpenChatSse(); },
  refreshRooms: async () => {
    const r = await apiFetch('/api/dashboard/chat/rooms');
    if (!r.ok) return;
    adminChatRooms = await r.json();
    adminChatRenderRoomList();
  },
};
