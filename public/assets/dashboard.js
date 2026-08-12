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
  return fetch(path, { ...opts, headers });
}

async function checkAuth() {
  if (!authToken) { showAuthScreen(); return false; }
  try {
    const r = await apiFetch('/api/auth/check');
    if (r.status === 401) { showAuthScreen(); return false; }
  } catch (_) { /* network issue — show dashboard and let calls fail naturally */ }
  document.getElementById('app').style.display = 'block';
  return true;
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
      <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleAutomation(${r.id}, this.checked)" title="${r.enabled ? 'Enabled' : 'Disabled'}" style="width:20px;height:20px;accent-color:var(--gold);flex:none;cursor:pointer">
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
    <div style="overflow-x:auto">
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
  ['consignee', 'Consignee'], ['colour', 'Colour EXT / INT'], ['vin', 'VIN'],
  ['status', 'Status'], ['price_list', 'Price List'], ['discounted', 'Discounted'],
  ['logistics', 'Logistics'], ['supplier', 'Supplier'],
];
let _stockCache = [];
async function loadStock() {
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
      <div style="overflow-x:auto"><table class="stock-units">
        <thead><tr>${STOCK_UNIT_COLS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${units.map(u => {
          const st = poLineStatus(u.status);
          return `<tr>${STOCK_UNIT_COLS.map(([k]) => {
            if (k === 'status') return `<td><span class="pill-sm" style="background:${st.bg};color:${st.fg}">${esc(st.label)}</span></td>`;
            if (k === 'price_list' || k === 'discounted') return `<td style="text-align:right">${Number(u[k]) ? Number(u[k]).toLocaleString() : '—'}</td>`;
            return `<td>${esc(u[k] || '—')}</td>`;
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
function openStockForm(id) {
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
              ${STOCK_UNIT_COLS.map(([, l]) => `<th class="po-th" style="min-width:120px">${esc(l)}</th>`).join('')}
              <th class="po-th" style="width:38px"></th>
            </tr></thead>
            <tbody id="stk-units"></tbody>
          </table>
        </div>
        <button class="btn btn-outline" style="margin-top:8px;padding:5px 10px;font-size:12px" onclick="stkAddUnitRow()">+ Add unit</button>
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
  const cell = k => {
    if (k === 'status') {
      return `<td class="po-td"><select class="form-input stk-u" data-k="status" style="font-size:12px;padding:5px 6px">
        ${PO_LINE_STATUSES.map(o => `<option value="${o.key}" ${(v.status || 'send_to_supplier') === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select></td>`;
    }
    const num = (k === 'price_list' || k === 'discounted') ? 'type="number" min="0"' : '';
    return `<td class="po-td"><input class="form-input stk-u" data-k="${k}" ${num} value="${esc(v[k] == null ? '' : String(v[k]))}" style="font-size:12px;padding:5px 6px"></td>`;
  };
  tr.innerHTML = `<td class="po-td stk-u-no" style="text-align:center;color:var(--muted)"></td>` +
    STOCK_UNIT_COLS.map(([k]) => cell(k)).join('') +
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
  const units = [...document.querySelectorAll('.stk-unit-row')].map(r => {
    const o = {}; r.querySelectorAll('.stk-u').forEach(el => { o[el.dataset.k] = el.value; }); return o;
  }).filter(u => u.vin || u.consignee || u.colour || u.supplier);
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
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
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
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openContractForm(${c.id})">Edit</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="previewContract(${c.id})">PDF</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteContract(${c.id})">Delete</button>
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
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
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
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openPoForm(${p.id})">Edit</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="previewPo(${p.id})">PDF</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deletePo(${p.id})">Delete</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

async function openPoForm(id, seedCustomerId) {
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
              ${PO_COLS.map(([, label, w]) => `<th class="po-th" style="min-width:${w}px">${esc(label)}</th>`).join('')}
              <th class="po-th" style="width:38px"></th>
            </tr></thead>
            <tbody id="po-rows"></tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:10px;flex-wrap:wrap">
          <button class="btn btn-outline" style="padding:5px 10px;font-size:12px" onclick="poAddRow()">+ Add vehicle line</button>
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
  const cell = (key, val, type) => {
    if (key === 'status') {
      return `<td class="po-td"><select class="form-input po-f" data-k="status" style="font-size:12px;padding:5px 6px">
        ${PO_LINE_STATUSES.map(s => `<option value="${s.key}" ${(val || 'send_to_supplier') === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
      </select></td>`;
    }
    if (key === 'accessories') {
      return `<td class="po-td"><textarea class="form-input po-f" data-k="accessories" rows="3" style="font-size:11.5px;padding:5px 6px;resize:vertical">${esc(val || '')}</textarea></td>`;
    }
    // numbers arrive as numbers from the API — esc() only handles strings
    return `<td class="po-td"><input class="form-input po-f" data-k="${key}" ${type ? `type="${type}" min="0"` : ''} value="${esc(val == null ? '' : String(val))}" style="font-size:12px;padding:5px 6px"></td>`;
  };
  tr.innerHTML = `<td class="po-td po-no" style="text-align:center;color:var(--muted)"></td>` +
    PO_COLS.map(([k]) => cell(k, v[k], k === 'units' || k === 'pi_price' ? 'number' : '')).join('') +
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
  return [...document.querySelectorAll('.po-row')].map(r => {
    const o = {};
    r.querySelectorAll('.po-f').forEach(el => { o[el.dataset.k] = el.value; });
    return o;
  });
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

// ── Deals tabs: Pipeline · Inquiry · Sales ──────────────────────────────────────
let _dealsTab = 'pipeline';
let _salesCache = [];
const SALE_STATUS_OPTS = PO_LINE_STATUSES;

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

async function loadSales() {
  const box = document.getElementById('deals-sales-table');
  if (box) box.innerHTML = '<div class="loading"><div class="spinner"></div> Loading sales…</div>';
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
  box.innerHTML = `
    <div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12.5px;min-width:1900px">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
        <th style="padding:8px 10px;width:40px">No</th>
        ${SALE_COLS.map(([, l, w]) => `<th style="padding:8px 10px;min-width:${w}px">${esc(l)}</th>`).join('')}
        <th style="padding:8px 10px;text-align:right"></th></tr></thead>
      <tbody>${_salesCache.map((x, i) => {
        const st = SALE_STATUS_OPTS.find(o => o.key === x.status) || SALE_STATUS_OPTS[0];
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:8px 10px;color:var(--muted)">${i + 1}</td>
          ${SALE_COLS.map(([k]) => {
            if (k === 'status') return `<td style="padding:8px 10px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${st.bg};color:${st.fg}">${esc(st.label)}</span></td>`;
            if (SALE_NUM_KEYS.includes(k)) return `<td style="padding:8px 10px;text-align:right">${Number(x[k]) ? Number(x[k]).toLocaleString() : '—'}</td>`;
            if (k === 'client_file' && x[k]) return `<td style="padding:8px 10px"><a href="${esc(x[k])}" target="_blank" rel="noopener" style="color:var(--primary)">file</a></td>`;
            return `<td style="padding:8px 10px">${esc(x[k] || '')}</td>`;
          }).join('')}
          <td style="padding:8px 10px;text-align:right;white-space:nowrap">
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openSaleForm(${x.id})">Edit</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteSale(${x.id})">Delete</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function openSaleForm(id) {
  const x = id ? _salesCache.find(v => v.id === id) : null;
  const field = ([k, label]) => {
    if (k === 'status') {
      return `<div><div class="po-lbl">${esc(label)}</div><select id="sale-${k}" class="form-input">
        ${SALE_STATUS_OPTS.map(o => `<option value="${o.key}" ${(x?.status || 'send_to_supplier') === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select></div>`;
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
          <span style="font-size:11px;color:var(--muted)">Google Drive · up to 100 MB</span>
        </div>
        <div id="sale-file-msg" style="font-size:12px;margin-top:6px"></div>
        <input type="hidden" id="sale-client_file" value="${esc(x?.client_file || '')}"></div>`;
    }
    const type = SALE_DATE_KEYS.includes(k) ? 'date' : SALE_NUM_KEYS.includes(k) ? 'number' : 'text';
    return `<div><div class="po-lbl">${esc(label)}</div><input id="sale-${k}" class="form-input" type="${type}" value="${esc(x?.[k] == null ? '' : String(x[k]))}"></div>`;
  };
  showModal(id ? 'Edit sale' : 'Add sale', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;max-height:66vh;overflow-y:auto;padding-right:4px">
      ${SALE_COLS.map(field).join('')}
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
  msg.textContent = 'Uploaded.';
  document.getElementById('sale-client_file').value = d.client_file || '';
  loadSales();
}

async function saveSale(id) {
  const payload = {};
  SALE_COLS.forEach(([k]) => { payload[k] = document.getElementById('sale-' + k).value; });
  const err = document.getElementById('sale-err');
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

// ── RFQ — Request for Quotation ─────────────────────────────────────────────────
const RFQ_STATUS = { draft: 'Draft', sent: 'Sent', answered: 'Answered', closed: 'Closed' };
const RFQ_COLS = [
  ['brand', 'BRAND', 90], ['model', 'MODEL', 96], ['trim', 'TRIM', 90],
  ['colour', 'COLOR EXT / INT', 130], ['year', 'YEAR', 60],
  ['accessories', 'ACCESSORIES / REMARKS', 190], ['lead_time', 'LEAD TIME', 90],
  ['fob_price', 'FOB PRICE', 90], ['cif_price', 'CIF PRICE (RoRo)', 100],
];
let _rfqCache = [], _rfqEditing = null;

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
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
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
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openRfqForm(${r.id})">Edit</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="viewDocPdf('rfq',${r.id},'${escJs(r.rfq_no)}')">PDF</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteRfq(${r.id})">Delete</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

async function openRfqForm(id, seedCustomerId) {
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
              ${RFQ_COLS.map(([, l, w]) => `<th class="po-th" style="min-width:${w}px">${esc(l)}</th>`).join('')}
              <th class="po-th" style="width:38px"></th>
            </tr></thead>
            <tbody id="rfq-rows"></tbody>
          </table>
        </div>
        <button class="btn btn-outline" style="margin-top:8px;padding:5px 10px;font-size:12px" onclick="rfqAddRow()">+ Add line</button>
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
  const cell = (k) => k === 'accessories'
    ? `<td class="po-td"><textarea class="form-input rfq-f" data-k="accessories" rows="2" style="font-size:11.5px;padding:5px 6px;resize:vertical">${esc(v.accessories || '')}</textarea></td>`
    : `<td class="po-td"><input class="form-input rfq-f" data-k="${k}" ${k.endsWith('_price') ? 'type="number" min="0"' : ''} value="${esc(v[k] == null ? '' : String(v[k]))}" style="font-size:12px;padding:5px 6px"></td>`;
  tr.innerHTML = `<td class="po-td rfq-no-cell" style="text-align:center;color:var(--muted)"></td>` +
    RFQ_COLS.map(([k]) => cell(k)).join('') +
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
    items: [...document.querySelectorAll('.rfq-row')].map(r => {
      const o = {}; r.querySelectorAll('.rfq-f').forEach(el => { o[el.dataset.k] = el.value; }); return o;
    }),
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
  body.innerHTML = `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
        <th style="padding:8px 10px">Name</th><th style="padding:8px 10px">Contact</th>
        <th style="padding:8px 10px">Country</th><th style="padding:8px 10px">Address</th>
        <th style="padding:8px 10px;text-align:right">Actions</th></tr></thead>
      <tbody>${_suppliersCache.map(x => `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:8px 10px;font-weight:600">${esc(x.name)}</td>
          <td style="padding:8px 10px">${esc(x.contact || '—')}</td>
          <td style="padding:8px 10px">${esc(x.country || '—')}</td>
          <td style="padding:8px 10px;color:var(--muted)">${esc(x.address || '')}</td>
          <td style="padding:8px 10px;text-align:right;white-space:nowrap">
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openSupplierDetail(${x.id})">Open</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px" onclick="openSupplierForm(${x.id})">Edit</button>
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="deleteSupplier(${x.id})">Delete</button>
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

function openSupplierForm(id) {
  const x = id ? _suppliersCache.find(v => v.id === id) : null;
  showModal(x ? 'Edit supplier' : 'Add supplier', `
    <div style="display:grid;gap:12px">
      <div><label class="form-label">Name *</label><input id="sup-name" class="form-input" value="${esc(x?.name || '')}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label class="form-label">Contact</label><input id="sup-contact" class="form-input" value="${esc(x?.contact || '')}"></div>
        <div><label class="form-label">Country of origin</label><input id="sup-country" class="form-input" value="${esc(x?.country || '')}"></div>
      </div>
      <div><label class="form-label">Address</label><input id="sup-address" class="form-input" value="${esc(x?.address || '')}"></div>
      <div><label class="form-label">Notes</label><input id="sup-notes" class="form-input" value="${esc(x?.notes || '')}"></div>
      <div id="sup-err" class="error-msg" style="display:none"></div>
    </div>`,
    `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
     <button class="btn btn-primary" onclick="saveSupplier(${id || 'null'})">Save</button>`);
}
async function saveSupplier(id) {
  const payload = {
    name: document.getElementById('sup-name').value.trim(),
    contact: document.getElementById('sup-contact').value.trim(),
    country: document.getElementById('sup-country').value.trim(),
    address: document.getElementById('sup-address').value.trim(),
    notes: document.getElementById('sup-notes').value.trim(),
  };
  const err = document.getElementById('sup-err');
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

// ── Navigation ────────────────────────────────────────────────────────────────
let currentPage = 'tasks';
const pageLoaders = { home: loadHome, tasks: loadDashboard, employees: loadEmployees, requests: loadRequests, submissions: loadSubmissions, hours: loadHours, email: loadEmail, drive: loadDrive, sheets: loadSheets, quotation: loadQuotation, calendar: loadCalendarSync, gchat: loadGChat, chat: loadAdminChat, customers: loadCustomers, deals: loadDeals, stock: loadStock, suppliers: loadSuppliers, rfqs: loadRfqs, contracts: loadContracts, purchaseorders: loadPurchaseOrders, whatsapp: loadWhatsApp, notif: loadNotifPage, reports: loadReports, automations: loadAutomations, deletions: loadDeletionRequests };

function navigate(page) {
  if (currentPage === 'chat' && page !== 'chat') adminCloseChatSse();
  if (currentPage === 'whatsapp' && page !== 'whatsapp') waCloseSse();
  if (currentPage === 'gchat' && page !== 'gchat') gchatStopPoll();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('nav-' + page).classList.add('active');
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
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  sb.classList.remove('open');
  ov.classList.remove('visible');
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
  const tableC = document.getElementById('employees-table-container');
  tableC.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const emps = await apiFetch('/api/dashboard/employees').then(r => r.json());
    allEmployees = emps;

    // Employee portal accounts table
    if (!emps.length) {
      tableC.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">No employee portal accounts yet. Click "+ Create Employee" to add one.</div>';
    } else {
      const permLabels = { requests: 'Requests', drive: 'Drive', sheets: 'Sheets', email: 'Email', viewAllRequests: 'View All Requests', quotation: 'Quotation', leads: 'Leads', deals: 'Deals' };
      tableC.innerHTML = `<div style="overflow-x:auto"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Job Title</th><th>Status</th><th>Email</th><th>Permissions</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${emps.map(e => {
          const p = e.permissions || {};
          const sc = p.scope || {};
          const scoped = !!(sc.assignedOnly || (sc.dealStages && sc.dealStages.length) || (sc.leadStatuses && sc.leadStatuses.length));
          const badges = Object.entries(permLabels).map(([k, lbl]) =>
            `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;margin:1px;background:${p[k]?'rgba(99,102,241,.15)':'rgba(255,255,255,.05)'};color:${p[k]?'var(--primary)':'var(--muted)'}">${lbl}</span>`
          ).join('') + (scoped ? `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700;margin:1px;background:rgba(230,150,80,.18);color:var(--gold)" title="Data scope is limited">⛨ Scoped</span>` : '');
          const initials = (e.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
          const avatar = e.avatar_url ? `<img src="${esc(e.avatar_url)}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:8px">` : `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--primary);color:#fff;font-size:10px;font-weight:700;vertical-align:middle;margin-right:8px">${initials}</span>`;
          const statusStr = (e.status_emoji || e.status_text) ? `${e.status_emoji||''} ${esc(e.status_text||'')}`.trim() : '—';
          return `<tr>
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

// ── Advanced employee permissions editor ──────────────────────────────────────
const EMP_SIMPLE_PERMS = [
  { key:'requests',        label:'Requests',          desc:'Submit & view own requests', def:true },
  { key:'viewAllRequests', label:'View All Requests', desc:'See every employee\'s requests', def:false },
  { key:'drive',           label:'My Drive',          desc:'Browse Google Drive files', def:true },
  { key:'sheets',          label:'My Sheets',         desc:'Browse Google Sheets', def:true },
  { key:'email',           label:'Email',             desc:'Access personal email', def:false },
];
const EMP_CRM_ACTIONS = {
  leads:     [['view','View'],['create','Add'],['edit','Edit'],['delete','Delete (needs approval)'],['import','Import'],['export','Export']],
  deals:     [['view','View'],['create','Add'],['edit','Edit'],['move','Move stage'],['delete','Delete (needs approval)']],
  quotation: [['draft','Draft & generate'],['history','History'],['settings','Settings'],['delete','Delete'],['attachLead','Attach to a lead']],
  reports:   [['leads','Custom Leads Report'],['sales','Sales & Revenue'],['export','Export CSV']],
};
const EMP_DEAL_STAGES = ['lead','inquiry','quoted','negotiating','won','lost'];
function empScopeStatusOpts() {
  try { const o = leadCol('lead_status')?.options; if (Array.isArray(o) && o.length) return o.map(x => [x.key, x.label]); } catch (_) {}
  return (typeof AM_LEAD_STATUSES !== 'undefined') ? AM_LEAD_STATUSES : [['cold','Cold'],['warm','Warm'],['hot','Hot']];
}
function empCnorm(s) { return String(s == null ? '' : s).toLowerCase().trim().replace(/[\s-]+/g, '_'); }
function empActs(p, section) { return (p && p[section + 'Actions']) || {}; }
function empCrmBlock(section, label, p) {
  const on = p && p[section] === true;
  const acts = empActs(p, section);
  return `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px">
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;cursor:pointer">
      <input type="checkbox" id="perm-${section}" ${on ? 'checked' : ''} onchange="empToggleSection('${section}')" style="accent-color:var(--primary);width:15px;height:15px"> ${label}
    </label>
    <div id="perm-${section}-actions" style="display:${on ? 'flex' : 'none'};flex-wrap:wrap;gap:12px;margin-top:8px;padding-left:23px">
      ${EMP_CRM_ACTIONS[section].map(([a, al]) => `<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="perm-act" data-section="${section}" data-action="${a}" ${acts[a] ? 'checked' : ''} style="accent-color:var(--primary)"> ${al}</label>`).join('')}
    </div>
  </div>`;
}
function empToggleSection(section) {
  const on = document.getElementById('perm-' + section)?.checked;
  const wrap = document.getElementById('perm-' + section + '-actions');
  if (wrap) wrap.style.display = on ? 'flex' : 'none';
  // Turning a section ON with no actions ticked ⇒ default to all actions (matches "master on = full").
  if (on) {
    const boxes = [...document.querySelectorAll(`.perm-act[data-section="${section}"]`)];
    if (boxes.length && !boxes.some(b => b.checked)) boxes.forEach(b => { b.checked = true; });
  }
}
function openEmpModal(id) {
  const e = id ? allEmployees.find(x => x.id === id) : null;
  const p = { requests:true, drive:true, sheets:true, email:false, viewAllRequests:false, quotation:false, leads:false, deals:false, reports:false, ...(e?.permissions||{}) };
  const scope = (p.scope && typeof p.scope === 'object') ? p.scope : { assignedOnly:false, dealStages:[], leadStatuses:[] };
  const scopeStatuses = (scope.leadStatuses || []).map(empCnorm);
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
    <div class="form-group" style="margin-top:4px">
      <label class="form-label">General access</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
        ${EMP_SIMPLE_PERMS.map(item => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border-radius:8px;border:1px solid var(--border);cursor:pointer;background:var(--surface)">
          <input type="checkbox" id="perm-${item.key}" ${p[item.key]?'checked':''} style="margin-top:2px;accent-color:var(--primary);width:15px;height:15px;flex-shrink:0">
          <div><div style="font-size:13px;font-weight:600;color:var(--text)">${item.label}</div><div style="font-size:11px;color:var(--muted);margin-top:2px">${item.desc}</div></div>
        </label>`).join('')}
      </div>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label class="form-label">CRM access — tick a section, then the exact actions allowed</label>
      <div style="margin-top:6px">
        ${empCrmBlock('leads', 'Leads', p)}
        ${empCrmBlock('deals', 'Deals', p)}
        ${empCrmBlock('quotation', 'Quotation', p)}
        ${empCrmBlock('reports', 'Reports', p)}
      </div>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label class="form-label">Data scope — limit which leads/deals this employee can see (leave all unticked = everything)</label>
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:6px;display:grid;gap:12px">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="scope-assigned" ${scope.assignedOnly?'checked':''} style="accent-color:var(--primary);width:15px;height:15px"> Only leads/deals <strong>assigned to this employee</strong>
        </label>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:5px">Only leads whose deal is in these stage(s):</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            ${EMP_DEAL_STAGES.map(s => `<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="scope-stage" value="${s}" ${(scope.dealStages||[]).includes(s)?'checked':''} style="accent-color:var(--primary)"> ${s.charAt(0).toUpperCase()+s.slice(1)}</label>`).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:5px">Only leads with these status(es):</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            ${empScopeStatusOpts().map(([k,l]) => `<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="scope-status" value="${esc(k)}" ${scopeStatuses.includes(empCnorm(k))?'checked':''} style="accent-color:var(--primary)"> ${esc(l)}</label>`).join('')}
          </div>
        </div>
      </div>
    </div>
  `, `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEmployee(${id||'null'})">Save</button>`);
}

function empBuildPerms() {
  const perms = {};
  ['requests', 'viewAllRequests', 'drive', 'sheets', 'email'].forEach(k => { perms[k] = document.getElementById('perm-' + k)?.checked || false; });
  ['leads', 'deals', 'quotation', 'reports'].forEach(sec => {
    perms[sec] = document.getElementById('perm-' + sec)?.checked || false;
    const acts = {};
    document.querySelectorAll(`.perm-act[data-section="${sec}"]`).forEach(cb => { acts[cb.dataset.action] = cb.checked; });
    perms[sec + 'Actions'] = acts;
  });
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
  c.innerHTML = `<div style="overflow-x:auto"><table>
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
  c.innerHTML = `<div style="overflow-x:auto"><table>
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
(async () => {
  lucide.createIcons();
  const ok = await checkAuth();
  if (!ok) return;
  adminStartPresenceHeartbeat();
  loadNotifs();
  openNotifStream();
  initSidebarState();
  await loadNavConfig();   // apply the admin's saved section order + names
  gchatInitNav();          // Google Chat nav appears only when it's configured
  const validPages = ['home','tasks','employees','requests','submissions','hours','email','drive','sheets','chat','calendar','meet','quotation','customers','deals','stock','suppliers','rfqs','contracts','purchaseorders','reports','automations','deletions','whatsapp','gchat','notif'];
  navigate(lastPage(validPages, 'home'));
})();

// ── Notification center (bell + counter) ──────────────────────────────────────

function openNotifStream() {
  if (notifSse) { notifSse.close(); notifSse = null; }
  if (!authToken) return;
  notifSse = new EventSource(`/api/dashboard/notifications/stream?_t=${encodeURIComponent(authToken)}`);
  notifSse.addEventListener('notification', e => {
    try {
      const n = JSON.parse(e.data);
      notifItems.unshift(n);
      if (notifItems.length > 50) notifItems.pop();
      if (!n.read) notifUnread++;
      renderNotifs();
      showAdminToast(`${n.title}${n.body ? ' · ' + n.body : ''}`);
    } catch (_) {}
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
  const m = { task: 'clipboard-list', reminder: 'alarm-clock', hours: 'clock', lead: 'contact-2', deal: 'kanban-square', request: 'inbox', issue: 'bug', followup: 'alarm-clock' };
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
  adminChatSse = new EventSource(`/api/dashboard/chat/events?_t=${encodeURIComponent(authToken)}`);
  adminChatSse.addEventListener('message', e => {
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
  adminChatSse.addEventListener('edit', e => {
    try {
      const { roomId, message } = JSON.parse(e.data);
      if (roomId === adminActiveChatRoom) {
        const el = document.querySelector(`[data-msg-id="${message.id}"]`);
        if (el) {
          const bubble = el.querySelector('.chat-msg-bubble');
          if (bubble) bubble.innerHTML = esc(message.body) + '<span class="chat-edited">(edited)</span>';
        }
      }
    } catch (_) {}
  });
  adminChatSse.addEventListener('delete', e => {
    try {
      const { roomId, msgId } = JSON.parse(e.data);
      if (roomId === adminActiveChatRoom) {
        const el = document.querySelector(`[data-msg-id="${msgId}"]`);
        if (el) el.outerHTML = '<div class="chat-deleted">Message deleted</div>';
      }
    } catch (_) {}
  });
  adminChatSse.addEventListener('typing', e => {
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
  adminChatSse.addEventListener('huddle', e => {
    try { huddleOnSignal(JSON.parse(e.data)); } catch (_) {}
  });
  // Membership or name changed — refresh the list, and the header if it's open
  adminChatSse.addEventListener('room', e => {
    try {
      const { roomId } = JSON.parse(e.data);
      HDCFG.refreshRooms().then(() => {
        if (adminActiveChatRoom !== roomId) return;
        if (adminChatRooms.some(r => r.id === roomId)) adminChatOpenRoom(roomId);
        else adminChatBackToRooms();   // we were removed from it
      });
    } catch (_) {}
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
      <textarea class="chat-input" id="admin-chat-input" rows="1" placeholder="Message ${esc(name)}…" onkeydown="adminChatHandleKey(event)" oninput="adminChatHandleInput()"></textarea>
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
    ${msg.body ? `<div class="chat-msg-bubble">${esc(msg.body)}${msg.edited_at ? '<span class="chat-edited">(edited)</span>' : ''}</div>` : ''}
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
}

function adminChatAppendMessage(msg) {
  adminChatMessages.push(msg);
  const el = document.getElementById('admin-chat-messages');
  if (!el) return;
  el.insertAdjacentHTML('beforeend', adminChatMsgHTML(msg));
}

function adminChatScrollBottom() {
  const el = document.getElementById('admin-chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

let adminChatPendingFile = null;

async function adminChatFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  if (file.size > 10 * 1024 * 1024) { alert('File must be under 10 MB'); return; }
  const btn = document.getElementById('admin-chat-send-btn');
  if (btn) btn.disabled = true;
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await apiFetch('/api/dashboard/chat/upload', { method:'POST', body: fd, headers: {} });
    const d = await r.json();
    if (d.error) { alert('Upload failed: ' + d.error); return; }
    adminChatPendingFile = d;
    document.getElementById('admin-attach-name').textContent = d.name;
    document.getElementById('admin-attach-preview').style.display = 'flex';
  } catch (e) { alert('Upload failed: ' + e.message); }
  finally { if (btn) btn.disabled = false; }
}

function adminChatRemoveAttach() {
  adminChatPendingFile = null;
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
  if (bubble) bubble.innerHTML = esc(orig) + (msg?.edited_at ? '<span class="chat-edited">(edited)</span>' : '');
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
    if (bubble) bubble.innerHTML = esc(updated.body) + '<span class="chat-edited">(edited)</span>';
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
      <div style="background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden">
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
                <button class="btn btn-outline" style="font-size:12px;padding:4px 12px;color:var(--danger);border-color:var(--danger)" onclick="deleteSubmission(${s.id})">Delete</button>
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

// ── Quotation Draft ────────────────────────────────────────────────────────────
let qtImages    = []; // newly-uploaded File objects
let qtExistingImages = []; // data-URL strings restored from a saved quote (edit/duplicate)
let qtEditingPk = null; // DB id of the quotation being edited in place (null = new)
let qtPdfBase64 = null;

const LOGISTICS_LABELS = [
  'Ocean Freight',
  'THC, Documentation & Clearances',
  'Customs Vat & Tax',
  'Last Mile Wench to Door',
  'Service Fees',
];

async function loadQuotation() {
  // Load employees for the issuer dropdown
  try {
    await preloadEmployeesForTasks();
    const sel = document.getElementById('qt-issuer');
    if (sel && (employeesForTasks || []).length) {
      sel.innerHTML = '<option value="">— Select issuer —</option>' +
        employeesForTasks.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join('');
    }
  } catch (_) {}

  // Populate the lead picker (attaches the quotation to a lead's 360° profile)
  try {
    const pick = document.getElementById('qt-customer-id');
    if (pick) {
      const cur = pick.value;
      const leads = _allCustomers.length ? _allCustomers : await apiFetch('/api/dashboard/customers').then(r => r.json());
      if (Array.isArray(leads)) {
        if (!_allCustomers.length) _allCustomers = leads;
        pick.innerHTML = '<option value="">— No lead —</option>' +
          [...leads].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(l => `<option value="${l.id}">${esc(l.name)}${l.phone ? ' · ' + esc(l.phone) : ''}</option>`).join('');
        if (cur && [...pick.options].some(o => o.value === cur)) pick.value = cur;
      }
    }
  } catch (_) {}

  // Generate ID if empty
  if (!document.getElementById('qt-id').value) await refreshQuoteId();

  // Set today + 7 days as defaults
  const today = new Date();
  const valid = new Date(today); valid.setDate(valid.getDate() + 7);
  const fmt = d => d.toISOString().split('T')[0];
  if (!document.getElementById('qt-date').value)     document.getElementById('qt-date').value     = fmt(today);
  if (!document.getElementById('qt-valid-to').value) document.getElementById('qt-valid-to').value = fmt(valid);

  // Build logistics rows if empty
  if (!document.getElementById('qt-logistics').children.length) buildLogisticsRows();

  // Build one default pricing row if empty
  if (!document.getElementById('qt-items').children.length) addPricingRow();

  requestAnimationFrame(() => lucide.createIcons());
}

async function refreshQuoteId() {
  try {
    const d = await apiFetch('/api/dashboard/quotation/newid').then(r => r.json());
    document.getElementById('qt-id').value = d.id;
  } catch (_) {}
}

function buildLogisticsRows() {
  const container = document.getElementById('qt-logistics');
  container.innerHTML = '';
  LOGISTICS_LABELS.forEach((label, i) => {
    const row = document.createElement('div');
    row.id = `qt-log-${i}`;
    row.style.cssText = 'display:grid;grid-template-columns:1fr 130px 130px;gap:8px;margin-bottom:8px;align-items:center';
    row.innerHTML = `
      <div style="font-size:13px;color:var(--text);padding:0 4px">${esc(label)}</div>
      <input class="form-input" id="qt-log-usd-${i}" type="number" min="0" step="0.01" placeholder="0"
        oninput="recalcLogistics(${i})" style="text-align:center">
      <input class="form-input" id="qt-log-egp-${i}" readonly placeholder="0"
        style="background:rgba(255,255,255,.03);text-align:center;font-weight:600">`;
    container.appendChild(row);
  });
}

function addPricingRow(name='', unit=1, priceUsd='', isFree=false) {
  const container = document.getElementById('qt-items');
  const idx = container.children.length;
  const row = document.createElement('div');
  row.className = 'qt-item-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 130px 130px 36px;gap:8px;margin-bottom:8px;align-items:center';
  row.innerHTML = `
    <input class="form-input" placeholder="Item name…" value="${esc(name)}" oninput="recalcItem(this)">
    <input class="form-input" type="number" min="1" step="1" value="${unit}" placeholder="1"
      style="text-align:center" oninput="recalcItem(this)">
    <div style="position:relative">
      <input class="form-input" placeholder="e.g. 22500 or Free" value="${esc(priceUsd)}"
        oninput="recalcItem(this)" style="padding-right:50px">
      <span onclick="toggleFreeItem(this)" title="Mark as Free"
        style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;
               cursor:pointer;padding:2px 6px;border-radius:4px;background:${isFree?'var(--primary)':'rgba(255,255,255,.08)'};
               color:${isFree?'#fff':'var(--muted)'}">FREE</span>
    </div>
    <input class="form-input" readonly placeholder="Auto" style="background:rgba(255,255,255,.03);text-align:center;font-weight:600">
    <button onclick="this.closest('.qt-item-row').remove();recalcGrandTotal()"
      style="background:rgba(248,113,113,.12);border:none;border-radius:6px;color:var(--danger);cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i data-lucide="x" style="width:13px;height:13px"></i>
    </button>`;
  container.appendChild(row);
  requestAnimationFrame(() => lucide.createIcons());
  recalcGrandTotal();
}

function toggleFreeItem(btn) {
  const isNowFree = btn.style.background !== 'var(--primary)' && !btn.style.background.includes('124,106,255');
  btn.style.background = isNowFree ? 'var(--primary)' : 'rgba(255,255,255,.08)';
  btn.style.color       = isNowFree ? '#fff' : 'var(--muted)';
  const input = btn.closest('div').querySelector('input');
  if (isNowFree) { input.value = 'Free'; input.readOnly = true; }
  else           { input.value = '';     input.readOnly = false; }
  recalcItem(input);
}

function getExchange() { return parseFloat(document.getElementById('qt-exchange').value) || 0; }

function recalcItem(inputEl) {
  const row    = inputEl.closest('.qt-item-row');
  const inputs = row.querySelectorAll('input');
  const priceRaw  = inputs[2].value.trim();
  const unitVal   = parseFloat(inputs[1].value) || 1;
  const isFree    = priceRaw.toLowerCase() === 'free' || priceRaw === '';
  const egpInput  = inputs[3];
  if (isFree) { egpInput.value = priceRaw.toLowerCase() === 'free' ? 'Free' : ''; }
  else {
    const price  = parseFloat(priceRaw);
    const exRate = getExchange();
    egpInput.value = (isFinite(price) && exRate > 0)
      ? Math.round(price * unitVal * exRate).toLocaleString()
      : '';
  }
  recalcGrandTotal();
}

function recalcLogistics(i) {
  const usdEl = document.getElementById(`qt-log-usd-${i}`);
  const egpEl = document.getElementById(`qt-log-egp-${i}`);
  if (!usdEl || !egpEl) return;
  const usd    = parseFloat(usdEl.value) || 0;
  const exRate = getExchange();
  egpEl.value  = exRate > 0 ? Math.round(usd * exRate).toLocaleString() : '';
  recalcGrandTotal();
}

function recalcAll() {
  // Recalc all item rows
  document.querySelectorAll('.qt-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    recalcItem(inputs[0]);
  });
  // Recalc all logistics rows
  LOGISTICS_LABELS.forEach((_, i) => recalcLogistics(i));
}

function addCustomSpecRow(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'qt-custom-spec-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 36px;gap:8px;margin-bottom:8px;align-items:center';
  row.innerHTML = `
    <input class="form-input" placeholder="e.g. Incoterms: CIF">
    <button onclick="this.closest('.qt-custom-spec-row').remove()"
      style="background:rgba(248,113,113,.12);border:none;border-radius:6px;color:var(--danger);cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i data-lucide="x" style="width:13px;height:13px"></i>
    </button>`;
  container.appendChild(row);
  requestAnimationFrame(() => lucide.createIcons());
}

function recalcGrandTotal() {
  let total = 0;
  // Items
  document.querySelectorAll('.qt-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const val = inputs[3].value.replace(/,/g, '');
    const n   = parseFloat(val);
    if (isFinite(n)) total += n;
  });
  // Logistics
  LOGISTICS_LABELS.forEach((_, i) => {
    const egpEl = document.getElementById(`qt-log-egp-${i}`);
    if (egpEl) {
      const val = (egpEl.value || '').replace(/,/g, '');
      const n   = parseFloat(val);
      if (isFinite(n)) total += n;
    }
  });
  const el = document.getElementById('qt-grand-total');
  if (el) el.textContent = total.toLocaleString();
}

// Image handling
function handleImgSelect(files) {
  addImages(Array.from(files));
}
function handleImgDrop(e) {
  addImages(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
}
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
  container.innerHTML = '';
  qtExistingImages.forEach((src, i) => container.appendChild(imgPreviewWrap(src, `removeExistingImg(${i})`)));
  qtImages.forEach((file, i) => container.appendChild(imgPreviewWrap(URL.createObjectURL(file), `removeImg(${i})`)));
  const drop = document.getElementById('qt-img-drop');
  if (drop) drop.style.display = (qtImages.length + qtExistingImages.length) >= 5 ? 'none' : '';
  requestAnimationFrame(() => lucide.createIcons());
}
function removeImg(i) { qtImages.splice(i, 1); renderImgPreviews(); }
function removeExistingImg(i) { qtExistingImages.splice(i, 1); renderImgPreviews(); }

// Build payload and generate PDF
async function generateQuotation() {
  const btn = document.getElementById('qt-generate-btn');
  const err = document.getElementById('qt-error');
  err.style.display = 'none';

  const id       = document.getElementById('qt-id').value.trim();
  const date     = document.getElementById('qt-date').value;
  const validTo  = document.getElementById('qt-valid-to').value;
  const name     = document.getElementById('qt-name').value.trim();
  const vehicle  = document.getElementById('qt-vehicle').value.trim();
  const exchange = document.getElementById('qt-exchange').value;
  const currency = document.getElementById('qt-currency').value;
  const issuer   = document.getElementById('qt-issuer').value;

  if (!id || !date || !name) {
    err.textContent = 'Please fill in ID, Date and Customer Name.';
    err.style.display = 'block';
    return;
  }
  if (!exchange || parseFloat(exchange) <= 0) {
    err.textContent = 'Please enter a valid Exchange Rate.';
    err.style.display = 'block';
    return;
  }

  // Collect pricing items
  const items = [];
  document.querySelectorAll('.qt-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const itemName = inputs[0].value.trim();
    if (!itemName) return;
    items.push({
      name:     itemName,
      unit:     inputs[1].value || '1',
      priceUsd: inputs[2].value.trim(),
    });
  });

  // Collect logistics
  const logistics = LOGISTICS_LABELS.map((label, i) => ({
    label,
    priceUsd: document.getElementById(`qt-log-usd-${i}`)?.value || '0',
  }));

  // Collect custom specs
  const customSpecs = [];
  document.querySelectorAll('#qt-custom-specs .qt-custom-spec-row').forEach(row => {
    const val = row.querySelector('input')?.value.trim();
    if (val) customSpecs.push({ key: '', val });
  });

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';

  try {
    const formData = new FormData();
    formData.append('id',          id);
    formData.append('date',        date);
    formData.append('validTo',     validTo);
    formData.append('name',        name);
    formData.append('vehicleModel', vehicle);
    formData.append('currency',    currency);
    formData.append('exchange',    exchange);
    formData.append('issuer',      issuer);
    formData.append('items',       JSON.stringify(items));
    formData.append('logistics',   JSON.stringify(logistics));
    formData.append('customSpecs', JSON.stringify(customSpecs));
    const qtLeadId = document.getElementById('qt-customer-id')?.value || '';
    if (qtLeadId) formData.append('customer_id', qtLeadId);
    formData.append('template', document.getElementById('qt-template')?.value || 'classic');
    formData.append('existingImages', JSON.stringify(qtExistingImages));
    if (qtEditingPk) formData.append('quotation_pk', String(qtEditingPk));
    qtImages.forEach(f => formData.append('images', f));

    const res = await fetch('/api/dashboard/quotation/generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + authToken },
      body: formData,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    qtPdfBase64 = data.pdf;
    // Build a Blob URL (Chrome blocks data: URLs for PDFs in iframes)
    const bytes = Uint8Array.from(atob(qtPdfBase64), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    const frame = document.getElementById('qt-preview-frame');
    if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
    frame._blobUrl = blobUrl;
    frame.src = blobUrl;
    const modal = document.getElementById('qt-modal');
    modal.style.display = 'flex';
    requestAnimationFrame(() => lucide.createIcons());
  } catch (e) {
    err.textContent = 'Error: ' + e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="file-badge" style="width:15px;height:15px"></i> Generate PDF';
    lucide.createIcons({ nodes: [btn] });
  }
}

function downloadQuotationPdf() {
  if (!qtPdfBase64) return;
  const id    = document.getElementById('qt-id').value || 'quotation';
  const frame = document.getElementById('qt-preview-frame');
  // Reuse the already-created blob URL if available
  const blobUrl = frame?._blobUrl;
  if (blobUrl) {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `Quotation_${id}.pdf`;
    a.click();
    return;
  }
  // Fallback: rebuild blob from base64
  const bytes = Uint8Array.from(atob(qtPdfBase64), c => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: 'application/pdf' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = `Quotation_${id}.pdf`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
          <select id="hb-lang" onchange="_helpLang=this.value" style="background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:8px;font-size:12px;padding:4px 6px">
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
function switchQtTab(tab) {
  ['draft','history','settings'].forEach(t => {
    document.getElementById('qt-tab-' + t).classList.toggle('active', t === tab);
    document.getElementById('qt-panel-' + t).style.display = t === tab ? '' : 'none';
  });
  document.getElementById('qt-generate-btn').style.display = tab === 'draft' ? '' : 'none';
  if (tab === 'history')  loadQtHistory();
  if (tab === 'settings') loadQtSettings();
}

async function loadQtHistory() {
  const body = document.getElementById('qt-history-body');
  body.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">Loading…</div>';
  try {
    const rows = await apiFetch('/api/dashboard/quotations').then(r => r.json());
    if (!rows.length) { body.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">No saved quotations yet.</div>'; return; }
    body.innerHTML = `<table class="table"><thead><tr><th>ID</th><th>Title</th><th>Created By</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows.map(q => `<tr>
        <td><code style="font-size:11px">${esc(q.quote_id)}</code></td>
        <td>${esc(q.title||'—')}</td>
        <td>${esc(q.created_by||'—')}</td>
        <td>${new Date(q.created_at).toLocaleDateString()}</td>
        <td style="white-space:nowrap;text-align:right">
          <button class="btn btn-sm btn-outline" onclick="editQuotation(${q.id})"><i data-lucide="pencil" style="width:12px;height:12px"></i> Edit</button>
          <button class="btn btn-sm btn-outline" onclick="duplicateQuotation(${q.id})"><i data-lucide="copy" style="width:12px;height:12px"></i> Duplicate</button>
          <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger)" onclick="deleteQuotation(${q.id})"><i data-lucide="trash-2" style="width:12px;height:12px"></i> Delete</button>
        </td>
      </tr>`).join('')}</tbody></table>`;
    requestAnimationFrame(() => lucide.createIcons());
  } catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:16px">${esc(e.message)}</div>`; }
}

async function deleteQuotation(id) {
  if (!confirm('Delete this quotation from history? This cannot be undone.')) return;
  try {
    const r = await apiFetch(`/api/dashboard/quotations/${id}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); return alert('Error: ' + (e.error || r.status)); }
    loadQtHistory();
  } catch (e) { alert('Error: ' + e.message); }
}

// Load a saved quotation into the draft. editing=true → update the same record on Generate;
// editing=false (duplicate) → fresh quote id, saves as a new record. Restores ALL fields + images.
async function populateQuoteDraft(q, editing) {
  const d = q.data || {};
  switchQtTab('draft');
  qtEditingPk = editing ? q.id : null;
  if (editing && d.id) document.getElementById('qt-id').value = d.id;
  else await refreshQuoteId();
  renderQtEditBanner();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v != null ? v : ''); };
  set('qt-date', d.date); set('qt-valid-to', d.validTo);
  set('qt-name', d.name); set('qt-vehicle', d.vehicleModel);
  set('qt-currency', d.currency); set('qt-exchange', d.exchange);
  const iss = document.getElementById('qt-issuer'); if (iss && d.issuer) iss.value = d.issuer;
  const pick = document.getElementById('qt-customer-id'); if (pick) pick.value = q.customer_id ? String(q.customer_id) : '';
  const tpl = document.getElementById('qt-template'); if (tpl) tpl.value = d.template === 'brand' ? 'brand' : 'classic';
  // Items
  document.getElementById('qt-items').innerHTML = '';
  (d.items || []).forEach(it => addPricingRow(it.name, it.unit, it.priceUsd === 'Free' ? 'Free' : it.priceUsd, it.priceUsd === 'Free'));
  if (!document.getElementById('qt-items').children.length) addPricingRow();
  // Logistics
  if (!document.getElementById('qt-logistics').children.length) buildLogisticsRows();
  (d.logistics || []).forEach((lg, i) => { const el = document.getElementById(`qt-log-usd-${i}`); if (el) el.value = (lg && lg.priceUsd && lg.priceUsd !== '0') ? lg.priceUsd : ''; });
  // Custom specs
  const cs = document.getElementById('qt-custom-specs');
  if (cs) { cs.innerHTML = ''; (d.customSpecs || []).forEach(s => { addCustomSpecRow('qt-custom-specs'); const rows = cs.querySelectorAll('.qt-custom-spec-row'); const inp = rows[rows.length - 1]?.querySelector('input'); if (inp) inp.value = s.val || s.key || ''; }); }
  // Images (restored data-URLs) + reset any pending uploads
  qtImages = [];
  qtExistingImages = Array.isArray(d.imageDataUrls) ? [...d.imageDataUrls] : [];
  renderImgPreviews();
  recalcAll();
}
function renderQtEditBanner() {
  let b = document.getElementById('qt-edit-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'qt-edit-banner';
    b.style.cssText = 'align-items:center;justify-content:space-between;gap:10px;background:rgba(201,163,94,.12);border:1px solid var(--primary);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--primary)';
    const idField = document.getElementById('qt-id');
    const host = idField ? (idField.closest('.card') || idField.parentElement) : null;
    if (host && host.parentElement) host.parentElement.insertBefore(b, host);
  }
  if (qtEditingPk) {
    b.style.display = 'flex';
    b.innerHTML = `<span><i data-lucide="pencil" style="width:13px;height:13px;vertical-align:-2px"></i> Editing this quotation — <strong>Generate</strong> will update it (same ID).</span><button class="btn btn-sm btn-outline" onclick="cancelQtEdit()">Cancel edit</button>`;
    requestAnimationFrame(() => lucide.createIcons());
  } else { b.style.display = 'none'; b.innerHTML = ''; }
}
async function cancelQtEdit() { qtEditingPk = null; renderQtEditBanner(); await refreshQuoteId(); }
async function duplicateQuotation(id) {
  try {
    const q = await apiFetch(`/api/dashboard/quotations/${id}`).then(r => r.json());
    if (!q || !q.data) return;
    await populateQuoteDraft(q, false);
  } catch (e) { alert('Could not load quotation: ' + e.message); }
}
async function editQuotation(id) {
  try {
    const q = await apiFetch(`/api/dashboard/quotations/${id}`).then(r => r.json());
    if (!q || !q.data) return;
    await populateQuoteDraft(q, true);
  } catch (e) { alert('Could not load quotation: ' + e.message); }
}

async function loadQtSettings() {
  try {
    const [settings, emps] = await Promise.all([
      apiFetch('/api/dashboard/quotation/settings').then(r => r.json()),
      apiFetch('/api/dashboard/employees-for-tasks').then(r => r.json()).catch(() => []),
    ]);
    document.getElementById('qts-company-name').value    = settings.company_name    || '';
    document.getElementById('qts-company-phone').value   = settings.company_phone   || '';
    document.getElementById('qts-company-email').value   = settings.company_email   || '';
    document.getElementById('qts-company-website').value = settings.company_website  || '';
    document.getElementById('qts-company-address').value = settings.company_address  || '';
    document.getElementById('qts-company-tax-id').value  = settings.company_tax_id   || '';
    document.getElementById('qts-payment-terms').value   = settings.payment_terms    || '';
    document.getElementById('qts-footer-note').value     = settings.footer_note      || '';
    // Populate notify dropdown
    const sel = document.getElementById('qts-contact-notify-id');
    if (sel) {
      sel.innerHTML = '<option value="">— Nobody —</option>' + emps.map(e => `<option value="${esc(String(e.id))}"${String(settings.contact_notify_employee_id) === String(e.id) ? ' selected' : ''}>${esc(e.name)}</option>`).join('');
    }
  } catch (e) { console.error('loadQtSettings', e); }
}

async function saveQtSettings() {
  const msg = document.getElementById('qts-msg');
  const payload = {
    company_name:    document.getElementById('qts-company-name').value,
    company_phone:   document.getElementById('qts-company-phone').value,
    company_email:   document.getElementById('qts-company-email').value,
    company_website: document.getElementById('qts-company-website').value,
    company_address: document.getElementById('qts-company-address').value,
    company_tax_id:  document.getElementById('qts-company-tax-id').value,
    payment_terms:   document.getElementById('qts-payment-terms').value,
    footer_note:     document.getElementById('qts-footer-note').value,
    contact_notify_employee_id: document.getElementById('qts-contact-notify-id')?.value || '',
  };
  try {
    await apiFetch('/api/dashboard/quotation/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    msg.style.display = 'block';
    msg.style.background = 'rgba(138,154,134,.1)';
    msg.style.color = '#9fb59a';
    msg.textContent = 'Settings saved successfully.';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
  } catch (e) {
    msg.style.display = 'block';
    msg.style.background = 'rgba(239,68,68,.08)';
    msg.style.color = '#f87171';
    msg.textContent = 'Error: ' + e.message;
  }
}

// ── Leads (Customers) ─────────────────────────────────────────────────────
let _allCustomers = [];
let _selectedLeads = new Set();
// Sort state: { key, dir:'asc'|'desc' } — persisted so the choice sticks.
let _leadSort = (() => { try { return JSON.parse(localStorage.getItem('ml_leads_sort')) || { key: null, dir: 'asc' }; } catch (_) { return { key: null, dir: 'asc' }; } })();

const LEAD_STATUS_COLORS = { cold:'rgba(255,255,255,.06)', warm:'rgba(230,150,80,.18)', hot:'rgba(239,68,68,.14)', immediate_delivery:'rgba(100,180,120,.14)', not_interested:'rgba(150,150,150,.1)', blacklist:'rgba(60,0,0,.35)' };
const LEAD_STATUS_TEXT   = { cold:'#b9b3a4', warm:'var(--gold)', hot:'#f87171', immediate_delivery:'#6dd8a4', not_interested:'#888', blacklist:'#f87171' };

// ── Leads: ClickUp-style configurable columns ─────────────────────────────────
// Column config (order, visibility, labels, dropdown options, custom columns) is
// persisted server-side via /api/dashboard/leads/columns. Custom column values
// live in customers.custom_fields (JSONB) keyed by column key.
const LEAD_DEFAULT_COLS = [
  { key:'lead_date',       label:'Date',        type:'date',     builtin:true, visible:true },
  { key:'lead_time',       label:'Time',        type:'text',     builtin:true, visible:true },
  { key:'name',            label:'Name',        type:'text',     builtin:true, visible:true },
  { key:'phone',           label:'Phone',       type:'text',     builtin:true, visible:true },
  { key:'lead_status',     label:'Status',      type:'select',   builtin:true, visible:true, options:[
    { key:'cold', label:'Cold' }, { key:'warm', label:'Warm' }, { key:'hot', label:'Hot' },
    { key:'immediate_delivery', label:'Immediate Delivery' }, { key:'not_interested', label:'Not Interested' }, { key:'blacklist', label:'Blacklist' }] },
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
let _leadCols = null;
let _leadColsLoaded = false;

function leadCol(key) { return (_leadCols || LEAD_DEFAULT_COLS).find(c => c.key === key); }
function colOptMap(col) { const m = {}; (col?.options || []).forEach(o => { m[o.key] = o.label; }); return m; }
function slugKey(label) { return String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col'; }
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
  if (_leadColsLoaded) return;
  let saved = null;
  try { const d = await apiFetch('/api/dashboard/leads/columns').then(r => r.json()); saved = d.columns; } catch (_) {}
  _leadCols = mergeLeadCols(saved);
  _leadColsLoaded = true;
}

function mergeLeadCols(saved) {
  if (!Array.isArray(saved) || !saved.length) return JSON.parse(JSON.stringify(LEAD_DEFAULT_COLS));
  const cols = saved
    .filter(c => c && c.key && (!c.builtin || LEAD_DEFAULT_COLS.some(d => d.key === c.key)))
    .map(c => ({ ...c, visible: c.visible !== false }));
  // Builtins introduced after the config was saved get appended
  LEAD_DEFAULT_COLS.forEach(d => { if (!cols.some(c => c.key === d.key)) cols.push(JSON.parse(JSON.stringify(d))); });
  // Select builtins must always carry an options list
  cols.forEach(c => {
    const d = LEAD_DEFAULT_COLS.find(x => x.key === c.key);
    if (d?.options && !Array.isArray(c.options)) c.options = JSON.parse(JSON.stringify(d.options));
  });
  return cols;
}

function saveLeadCols() {
  apiFetch('/api/dashboard/leads/columns', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ columns: _leadCols }) }).catch(() => {});
}

// ── Header rendering + drag-to-reorder ──
function renderLeadHead() {
  const tr = document.getElementById('leads-head-row');
  if (!tr || !_leadCols) return;
  const ths = _leadCols.filter(c => c.visible && !c.deleted).map(c => `
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

let _dragColKey = null;
let _leadColDidDrag = false; // swallow the click that can trail a header drag
function leadColDragStart(e) { _dragColKey = e.currentTarget.dataset.colkey; _leadColDidDrag = true; e.dataTransfer.effectAllowed = 'move'; }
function leadColDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function leadColDragEnd() { document.querySelectorAll('#leads-head-row th.drag-over').forEach(t => t.classList.remove('drag-over')); _dragColKey = null; setTimeout(() => { _leadColDidDrag = false; }, 0); }
function leadColDrop(e) {
  e.preventDefault();
  const target = e.currentTarget.dataset.colkey;
  const src = _dragColKey;
  leadColDragEnd();
  if (!src || src === target) return;
  const from = _leadCols.findIndex(c => c.key === src);
  const to = _leadCols.findIndex(c => c.key === target);
  if (from < 0 || to < 0) return;
  const [moved] = _leadCols.splice(from, 1);
  _leadCols.splice(to, 0, moved);
  saveLeadCols(); renderLeadHead(); filterCustomers();
}

// ── Column menu (rename / options / move / hide / delete) + visibility picker ──
let _leadMenuEl = null;
function ensureLeadMenu() {
  if (!_leadMenuEl) {
    _leadMenuEl = document.createElement('div');
    _leadMenuEl.className = 'lead-menu';
    document.body.appendChild(_leadMenuEl);
    document.addEventListener('click', e => {
      if (_leadMenuEl.classList.contains('open') && !_leadMenuEl.contains(e.target)
          && !e.target.closest?.('th.lead-col') && !e.target.closest?.('#lead-cols-btn')) closeLeadMenu();
    });
  }
  return _leadMenuEl;
}
function closeLeadMenu() { if (_leadMenuEl) _leadMenuEl.classList.remove('open'); }
function positionLeadMenu(e) {
  const m = _leadMenuEl;
  m.style.left = Math.min(e.clientX, window.innerWidth - 230) + 'px';
  m.style.top  = Math.min(e.clientY + 6, window.innerHeight - 60) + 'px';
  m.classList.add('open');
}

function openLeadColMenu(e, key) {
  e.stopPropagation();
  const col = leadCol(key);
  if (!col) return;
  const m = ensureLeadMenu();
  m.dataset.mode = 'colmenu';
  const vis = _leadCols.filter(c => c.visible && !c.deleted);
  const vi = vis.findIndex(c => c.key === key);
  const canType = col.type !== 'virtual' && !['name', 'budget_lead', 'lead_date'].includes(col.key);
  const sorted = _leadSort && _leadSort.key === key;
  m.innerHTML = `
    <button onclick="setLeadSort('${esc(key)}','asc')"${sorted && _leadSort.dir === 'asc' ? ' class="active"' : ''}><i data-lucide="arrow-up-narrow-wide" style="width:13px;height:13px"></i> Sort ascending</button>
    <button onclick="setLeadSort('${esc(key)}','desc')"${sorted && _leadSort.dir === 'desc' ? ' class="active"' : ''}><i data-lucide="arrow-down-wide-narrow" style="width:13px;height:13px"></i> Sort descending</button>
    ${sorted ? `<button onclick="setLeadSort(null)"><i data-lucide="x" style="width:13px;height:13px"></i> Clear sort</button>` : ''}
    <div class="lead-menu-sep"></div>
    <button onclick="leadColRename('${esc(key)}')"><i data-lucide="pencil" style="width:13px;height:13px"></i> Rename</button>
    ${canType ? `<button onclick="openLeadTypeModal('${esc(key)}')"><i data-lucide="shuffle" style="width:13px;height:13px"></i> Change type</button>` : ''}
    ${(col.type === 'select' || col.type === 'radio') ? `<button onclick="openLeadOptsModal('${esc(key)}')"><i data-lucide="list" style="width:13px;height:13px"></i> Edit options</button>` : ''}
    <div class="lead-menu-sep"></div>
    <button onclick="leadColMove('${esc(key)}',-1)" ${vi <= 0 ? 'disabled' : ''}><i data-lucide="arrow-left" style="width:13px;height:13px"></i> Move left</button>
    <button onclick="leadColMove('${esc(key)}',1)" ${vi >= vis.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-right" style="width:13px;height:13px"></i> Move right</button>
    <div class="lead-menu-sep"></div>
    <button onclick="leadColHide('${esc(key)}')"><i data-lucide="eye-off" style="width:13px;height:13px"></i> Hide column</button>
    <button class="danger" onclick="leadColDelete('${esc(key)}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i> Delete column</button>`;
  positionLeadMenu(e);
  requestAnimationFrame(() => lucide.createIcons());
}

function openLeadColsPicker(e) {
  e.stopPropagation();
  const m = ensureLeadMenu();
  if (m.classList.contains('open') && m.dataset.mode === 'picker') return closeLeadMenu();
  m.dataset.mode = 'picker';
  m.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 10px 4px">Show columns</div>` +
    _leadCols.filter(c => !c.deleted).map(c => `
      <button type="button" class="lead-col-eye ${c.visible ? '' : 'col-hidden'}" onclick="event.stopPropagation();toggleLeadColVis('${esc(c.key)}', ${c.visible ? 'false' : 'true'});openLeadColsPickerRefresh()">
        <i data-lucide="${c.visible ? 'eye' : 'eye-off'}" style="width:14px;height:14px"></i> ${esc(c.label)}
      </button>`).join('');
  positionLeadMenu(e);
  requestAnimationFrame(() => lucide.createIcons());
}
// Re-render the picker in place (keeps it open) after an eye toggle
function openLeadColsPickerRefresh() {
  const m = _leadMenuEl;
  if (!m || !m.classList.contains('open')) return;
  m.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 10px 4px">Show columns</div>` +
    _leadCols.filter(c => !c.deleted).map(c => `
      <button type="button" class="lead-col-eye ${c.visible ? '' : 'col-hidden'}" onclick="event.stopPropagation();toggleLeadColVis('${esc(c.key)}', ${c.visible ? 'false' : 'true'});openLeadColsPickerRefresh()">
        <i data-lucide="${c.visible ? 'eye' : 'eye-off'}" style="width:14px;height:14px"></i> ${esc(c.label)}
      </button>`).join('');
  requestAnimationFrame(() => lucide.createIcons());
}

function toggleLeadColVis(key, on) {
  const col = leadCol(key);
  if (!col) return;
  col.visible = !!on;
  saveLeadCols(); renderLeadHead(); filterCustomers();
}

function leadColRename(key) {
  closeLeadMenu();
  const col = leadCol(key);
  const v = prompt('Column name', col.label);
  if (v && v.trim()) { col.label = v.trim(); saveLeadCols(); renderLeadHead(); renderLeadFilterOptions(); }
}
function leadColMove(key, dir) {
  closeLeadMenu();
  const vis = _leadCols.filter(c => c.visible && !c.deleted);
  const vi = vis.findIndex(c => c.key === key);
  const nb = vis[vi + dir];
  if (!nb) return;
  const from = _leadCols.findIndex(c => c.key === key);
  const to = _leadCols.findIndex(c => c.key === nb.key);
  const [moved] = _leadCols.splice(from, 1);
  _leadCols.splice(to, 0, moved);
  saveLeadCols(); renderLeadHead(); filterCustomers();
}
function leadColHide(key) {
  closeLeadMenu();
  const col = leadCol(key);
  if (col) { col.visible = false; saveLeadCols(); renderLeadHead(); filterCustomers(); }
}
function leadColDelete(key) {
  closeLeadMenu();
  const col = leadCol(key);
  if (!col) return;
  if (!confirm(`Delete column "${col.label}"? Saved values stay on the leads but won't be shown.`)) return;
  // Builtins are soft-deleted (kept with deleted:true) so mergeLeadCols won't re-add them on reload.
  if (col.builtin) { col.deleted = true; col.visible = false; }
  else _leadCols = _leadCols.filter(c => c.key !== key);
  saveLeadCols(); renderLeadHead(); filterCustomers();
}

// ── Add-column modal ──
function openAddLeadColModal() {
  document.getElementById('lc-name').value = '';
  document.getElementById('lc-type').value = 'text';
  document.getElementById('lc-options').value = '';
  lcTypeChanged();
  document.getElementById('lead-col-modal').style.display = 'flex';
}
function typeHasOptions(t) { return t === 'select' || t === 'radio'; }
// Parse an options textarea into [{key,label}], reusing existing keys when a label matches.
function parseOptLines(text, existing) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const prev = existing || [];
  const opts = [];
  lines.forEach(l => {
    const match = prev.find(o => o.label === l);
    let k = match ? match.key : slugKey(l);
    const b = k; let m = 2;
    while (opts.some(o => o.key === k)) k = b + '_' + (m++);
    opts.push({ key: k, label: l });
  });
  return opts;
}
function lcTypeChanged() {
  document.getElementById('lc-options-wrap').style.display = typeHasOptions(document.getElementById('lc-type').value) ? '' : 'none';
}
function saveNewLeadCol() {
  const label = document.getElementById('lc-name').value.trim();
  if (!label) return alert('Column name is required.');
  const type = document.getElementById('lc-type').value;
  let key = 'cf_' + slugKey(label);
  const base = key; let n = 2;
  while (_leadCols.some(c => c.key === key)) key = base + '_' + (n++);
  const col = { key, label, type, builtin: false, visible: true };
  if (typeHasOptions(type)) {
    const opts = parseOptLines(document.getElementById('lc-options').value);
    if (!opts.length) return alert('Add at least one option (one per line).');
    col.options = opts;
  }
  _leadCols.push(col);
  saveLeadCols();
  document.getElementById('lead-col-modal').style.display = 'none';
  renderLeadHead(); filterCustomers();
}

// ── Change column type ──
let _typeColKey = null;
function openLeadTypeModal(key) {
  closeLeadMenu();
  const col = leadCol(key);
  if (!col) return;
  _typeColKey = key;
  document.getElementById('lt-col-name').textContent = col.label;
  // Map current type to the modal's offered set (Text / Dropdown / Radio / Checkbox)
  document.getElementById('lt-type').value = typeHasOptions(col.type) ? col.type : (col.type === 'checkbox' ? 'checkbox' : 'text');
  document.getElementById('lt-options').value = (col.options || []).map(o => o.label).join('\n');
  ltTypeChanged();
  document.getElementById('lead-type-modal').style.display = 'flex';
}
function ltTypeChanged() {
  document.getElementById('lt-options-wrap').style.display = typeHasOptions(document.getElementById('lt-type').value) ? '' : 'none';
}
function saveLeadType() {
  const col = leadCol(_typeColKey);
  if (!col) return;
  const type = document.getElementById('lt-type').value;
  if (typeHasOptions(type)) {
    const opts = parseOptLines(document.getElementById('lt-options').value, col.options);
    if (!opts.length) return alert('Add at least one option (one per line).');
    col.options = opts;
  } else {
    delete col.options;
  }
  col.type = type;
  saveLeadCols();
  document.getElementById('lead-type-modal').style.display = 'none';
  renderLeadHead(); filterCustomers();
}

// ── Dropdown-options editor ──
function openLeadOptsModal(key) {
  closeLeadMenu();
  const col = leadCol(key);
  if (!col) return;
  document.getElementById('lo-key').value = key;
  document.getElementById('lo-title').textContent = 'Edit Options — ' + col.label;
  document.getElementById('lo-list').innerHTML = (col.options || []).map(o => loRowHtml(o.key, o.label)).join('');
  document.getElementById('lead-opts-modal').style.display = 'flex';
  requestAnimationFrame(() => lucide.createIcons());
}
function loRowHtml(key, label) {
  return `<div class="lo-row" data-optkey="${esc(key)}" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
    <input class="form-input" value="${esc(label)}" placeholder="Option label" style="flex:1">
    <button onclick="this.closest('.lo-row').remove()" title="Remove" style="background:rgba(239,68,68,.1);border:none;border-radius:6px;color:var(--danger);cursor:pointer;width:30px;height:30px;flex-shrink:0">✕</button>
  </div>`;
}
function loAddOption() {
  document.getElementById('lo-list').insertAdjacentHTML('beforeend', loRowHtml('', ''));
  const rows = document.querySelectorAll('#lo-list .lo-row');
  rows[rows.length - 1]?.querySelector('input')?.focus();
}
function saveLeadOpts() {
  const key = document.getElementById('lo-key').value;
  const col = leadCol(key);
  if (!col) return;
  const opts = [];
  document.querySelectorAll('#lo-list .lo-row').forEach(r => {
    const label = r.querySelector('input').value.trim();
    if (!label) return;
    let k = r.dataset.optkey;
    if (!k) { k = slugKey(label); const b = k; let m = 2; while (opts.some(o => o.key === k)) k = b + '_' + (m++); }
    if (!opts.some(o => o.key === k)) opts.push({ key: k, label });
  });
  if (!opts.length) return alert('Keep at least one option.');
  col.options = opts;
  saveLeadCols();
  document.getElementById('lead-opts-modal').style.display = 'none';
  renderLeadFilterOptions(); filterCustomers();
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
    const bg = LEAD_STATUS_COLORS[k] || 'rgba(255,255,255,.06)';
    const tc = LEAD_STATUS_TEXT[k] || '#b9b3a4';
    return `<td ${attrs}><span style="background:${bg};color:${tc};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">${esc(m[k] || raw || k)}</span></td>`;
  }
  if (col.key === 'budget_lead') return `<td ${attrs} style="font-size:12px;white-space:nowrap">${fmtBudget(c.budget_lead, c.budget_max)}</td>`;
  if (col.type === 'checkbox') return `<td ${attrs} style="text-align:center;font-size:16px">${isChecked(raw) ? '<i data-lucide="check-square" style="width:15px;height:15px"></i>' : '<i data-lucide="square" style="width:15px;height:15px"></i>'}</td>`;
  if (col.type === 'select' || col.type === 'radio') { const m = colOptMap(col); const k = normKey(raw, m); return `<td ${attrs} style="font-size:12px;white-space:nowrap">${esc(m[k] || raw || '—')}</td>`; }
  if (col.key === 'notes' || col.key === 'car_in_question' || col.key === 'sales_feedback' || col.key === 'inquiry') return `<td ${attrs} style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(raw || '')}">${esc(raw || '—')}</td>`;
  if (col.type === 'number') return `<td ${attrs} style="font-size:12px;white-space:nowrap">${raw != null && raw !== '' ? Number(raw).toLocaleString() : '—'}</td>`;
  return `<td ${attrs} style="font-size:12px;white-space:nowrap">${esc(raw || '—')}</td>`;
}

let _pendingFollowups = {}; // customer_id -> earliest pending due_at (ISO)
let _fuFilterOn = false;

async function loadCustomers() {
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
// Filters work on ANY column — built-in or custom cf_* — with options read from
// the saved column config, so renamed options keep matching. Each filter is
// { key, op, a, b }; the operator set depends on the column's type.
let _leadFilters = [];
try { _leadFilters = JSON.parse(localStorage.getItem('ml_lead_filters') || '[]') || []; } catch (_) { _leadFilters = []; }

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
    const e = (employeesForTasks || []).find(x => String(x.id) === String(c.assigned_to));
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

function filterCustomers() {
  const q    = (document.getElementById('customer-search')?.value || '').toLowerCase();
  const from = document.getElementById('lead-date-from')?.value || '';
  const to   = document.getElementById('lead-date-to')?.value || '';
  let list = _allCustomers;
  if (q)  list = list.filter(c => (c.name||'').toLowerCase().includes(q) || (c.phone||'').includes(q) || (c.car_in_question||'').toLowerCase().includes(q));
  // ISO dates (YYYY-MM-DD) compare correctly as strings; either bound may be left empty
  if (from) list = list.filter(c => c.lead_date && c.lead_date >= from);
  if (to)   list = list.filter(c => c.lead_date && c.lead_date <= to);
  for (const f of _leadFilters) list = list.filter(c => leadFilterMatch(c, f));
  if (_fuFilterOn) {
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    list = list.filter(c => _pendingFollowups[c.id] && new Date(_pendingFollowups[c.id]) <= endOfDay);
  }
  renderLeadFilterChips();
  renderCustomers(applyLeadSort(list));
}

function leadFilterLabel(f) {
  const col = leadCol(f.key);
  const name = col ? (col.label || col.key) : f.key;
  const opLabel = (leadFilterOps(leadColType(col)).find(o => o[0] === f.op) || [, f.op])[1];
  let val = '';
  if (f.op === 'between') val = `${f.a || '…'} – ${f.b || '…'}`;
  else if (f.op !== 'empty' && f.op !== 'yes' && f.op !== 'no') {
    const col2 = leadCol(f.key);
    val = (leadColType(col2) === 'select' ? (colOptMap(col2)[f.a] || f.a) : f.a) || '';
  }
  return `${name} ${opLabel}${val ? ' ' + val : ''}`;
}
function renderLeadFilterChips() {
  const box = document.getElementById('lead-filter-chips');
  if (!box) return;
  box.style.display = _leadFilters.length ? 'flex' : 'none';
  box.innerHTML = _leadFilters.map((f, i) => `
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 10px;border:1px solid var(--hair-gold);border-radius:14px;background:rgba(201,163,94,.08)">
      ${esc(leadFilterLabel(f))}
      <button onclick="removeLeadFilter(${i})" title="Remove" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;padding:0">×</button>
    </span>`).join('');
}
function saveLeadFilters() {
  try { localStorage.setItem('ml_lead_filters', JSON.stringify(_leadFilters)); } catch (_) {}
}
function removeLeadFilter(i) { _leadFilters.splice(i, 1); saveLeadFilters(); filterCustomers(); }

function clearLeadFilters() {
  ['customer-search', 'lead-date-from', 'lead-date-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  _leadFilters = []; saveLeadFilters();
  filterCustomers();
}

function openLeadFilterPicker() {
  const cols = leadFilterableCols();
  showModal('Add filter', `
    <div style="display:grid;gap:12px">
      <div><label class="form-label">Column</label>
        <select id="lf-col" class="form-input" onchange="lfRenderOps()">
          ${cols.map(c => `<option value="${esc(c.key)}">${esc(c.label || c.key)}</option>`).join('')}
        </select></div>
      <div id="lf-op-wrap"></div>
      <div id="lf-val-wrap"></div>
    </div>`,
    `<button class="btn btn-outline" onclick="hideModal()">Cancel</button>
     <button class="btn btn-primary" onclick="addLeadFilter()">Add filter</button>`);
  lfRenderOps();
}
function lfRenderOps() {
  const col = leadCol(document.getElementById('lf-col').value);
  const type = leadColType(col);
  document.getElementById('lf-op-wrap').innerHTML = `<label class="form-label">Condition</label>
    <select id="lf-op" class="form-input" onchange="lfRenderVal()">
      ${leadFilterOps(type).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
    </select>`;
  lfRenderVal();
}
function lfRenderVal() {
  const col = leadCol(document.getElementById('lf-col').value);
  const type = leadColType(col);
  const op = document.getElementById('lf-op').value;
  const wrap = document.getElementById('lf-val-wrap');
  if (op === 'empty' || op === 'yes' || op === 'no') { wrap.innerHTML = ''; return; }
  if (type === 'select') {
    const opts = (col.options || []);
    wrap.innerHTML = `<label class="form-label">Value</label>
      <select id="lf-a" class="form-input">${opts.map(o => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('')}</select>`;
    return;
  }
  if (type === 'owner') {
    const names = [...new Set((employeesForTasks || []).map(e => e.name).filter(Boolean))];
    wrap.innerHTML = `<label class="form-label">Owner</label>
      <select id="lf-a" class="form-input">${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>`;
    return;
  }
  if (op === 'between') {
    const t = type === 'date' ? 'date' : 'number';
    wrap.innerHTML = `<label class="form-label">Range</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input id="lf-a" class="form-input" type="${t}" placeholder="From">
        <input id="lf-b" class="form-input" type="${t}" placeholder="To">
      </div>`;
    return;
  }
  wrap.innerHTML = `<label class="form-label">Value</label><input id="lf-a" class="form-input" placeholder="Text to match">`;
}
function addLeadFilter() {
  const key = document.getElementById('lf-col').value;
  const op = document.getElementById('lf-op').value;
  const a = document.getElementById('lf-a')?.value ?? '';
  const b = document.getElementById('lf-b')?.value ?? '';
  if (op !== 'empty' && op !== 'yes' && op !== 'no' && a === '' && b === '') { alert('Enter a value to filter on.'); return; }
  _leadFilters.push({ key, op, a, b });
  saveLeadFilters();
  hideModal();
  filterCustomers();
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
  const vis = (_leadCols || []).filter(c => c.visible && !c.deleted);
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

function renderCustomers(list) {
  _lastRenderedLeads = list;
  const tbody = document.getElementById('customers-tbody');
  const vis = (_leadCols || []).filter(c => c.visible && !c.deleted);
  const span = vis.length + 3; // select-all + add-column + actions
  if (!list.length) { tbody.innerHTML = `<tr><td colspan="${span}" style="text-align:center;color:var(--muted);padding:32px">No leads yet. Click "Add Lead" to get started.</td></tr>`; return; }
  tbody.innerHTML = list.map(c => `<tr>
      <td style="padding:8px 6px"><input type="checkbox" ${_selectedLeads.has(c.id) ? 'checked' : ''} onchange="toggleLeadSelect(${c.id})" onclick="event.stopPropagation()"></td>
      ${vis.map(col => leadCellHtml(c, col)).join('')}
      <td></td>
      <td style="display:flex;gap:5px;flex-wrap:nowrap">
        <button class="btn btn-sm btn-outline" onclick="openLeadProfile(${c.id})" title="Profile"><i data-lucide="user" style="width:12px;height:12px"></i></button>
        <button class="btn btn-sm btn-outline" onclick="openCustomerModal(${c.id})" title="Edit"><i data-lucide="edit-2" style="width:12px;height:12px"></i></button>
        <button class="btn btn-sm btn-outline" onclick="navigate('deals');filterDealsByCustomer(${c.id})" title="View Deals"><i data-lucide="kanban-square" style="width:12px;height:12px"></i></button>
        <button class="btn btn-sm" style="background:rgba(239,68,68,.1);color:var(--danger);border:none" onclick="deleteCustomer(${c.id})" title="Delete"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
      </td>
    </tr>`).join('');
  // sync select-all checkbox state
  const allCb = document.getElementById('select-all-leads');
  if (allCb) allCb.checked = list.length > 0 && list.every(c => _selectedLeads.has(c.id));
  requestAnimationFrame(() => lucide.createIcons());
}

// ── Lead 360° profile drawer ─────────────────────────────────────────────────
let _ldProfile = null; // { customer, activities, followups, quotations, deals }
const LD_ACT_ICONS = { note: 'sticky-note', call: 'phone', whatsapp: 'message-circle', meeting: 'users', status_change: 'refresh-ccw', quote: 'file-badge', deal: 'kanban-square', follow_up: 'alarm-clock', system: 'info' };

async function openLeadProfile(id) {
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
  badge.style.background = LEAD_STATUS_COLORS[stKey] || 'rgba(255,255,255,.06)';
  badge.style.color = LEAD_STATUS_TEXT[stKey] || '#b9b3a4';
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
      bodyHtml = `Status: <span class="ld-stage-pill" style="background:${LEAD_STATUS_COLORS[fk] || 'rgba(255,255,255,.06)'};color:${LEAD_STATUS_TEXT[fk] || '#b9b3a4'}">${esc(stMap[fk] || a.meta.from || '—')}</span> → <span class="ld-stage-pill" style="background:${LEAD_STATUS_COLORS[tk] || 'rgba(255,255,255,.06)'};color:${LEAD_STATUS_TEXT[tk] || '#b9b3a4'}">${esc(stMap[tk] || a.meta.to)}</span>`;
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
        <button class="btn btn-sm btn-outline" onclick="closeLeadProfile();navigate('quotation');duplicateQuotation(${q.id})">Open in draft</button>
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
  navigate('quotation');
  if (typeof switchQtTab === 'function') switchQtTab('draft');
  setTimeout(() => {
    const nameEl = document.getElementById('qt-name');
    const vehEl = document.getElementById('qt-vehicle');
    if (nameEl && !nameEl.value) nameEl.value = c.name || '';
    if (nameEl && c.name) nameEl.value = c.name;
    // Quote the vehicle we OFFER; fall back to what the customer asked for.
    const cfq = c.custom_fields || {};
    const vehName = cfq.cf_vehicle_offered || c.car_in_question || cfq.cf_vehicle_requested || '';
    if (vehEl && vehName) vehEl.value = vehName;
    // Prefill the quotation's images from the attached inventory vehicle.
    const vehImgs = (c.custom_fields && Array.isArray(c.custom_fields.cf_vehicle_images)) ? c.custom_fields.cf_vehicle_images : [];
    if (vehImgs.length && typeof renderImgPreviews === 'function') { qtExistingImages = vehImgs.slice(0, 5); renderImgPreviews(); }
    const pick = document.getElementById('qt-customer-id');
    if (pick) pick.value = String(c.id);
    // Prefill a pricing line from the attached inventory vehicle's price (EGP → USD via exchange).
    const vp = Number(c.custom_fields?.cf_vehicle_price) || 0;
    if (vp > 0 && typeof addPricingRow === 'function') {
      const ex = (typeof getExchange === 'function' ? getExchange() : 0);
      addPricingRow(vehName || 'Vehicle', 1, ex > 0 ? Math.round(vp / ex) : vp);
    }
  }, 350);
}

function toggleSelectAllLeads(cb) {
  _allCustomers.forEach(c => { if (cb.checked) _selectedLeads.add(c.id); else _selectedLeads.delete(c.id); });
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
  if (cnt) cnt.textContent = n + ' selected';
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
  waSse = new EventSource(`/api/dashboard/whatsapp/events?_t=${encodeURIComponent(authToken)}`);
  waSse.addEventListener('whatsapp_status', e => {
    const d = JSON.parse(e.data);
    waApplyStatus(d.status, d.qr);
  });
  waSse.addEventListener('whatsapp_message', e => {
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
  toast: msg => hdToast(msg),
  sheet: (t, b, f) => hdSheet(t, b, f),
  actions: () => ([
    { label: 'New lead',  icon: 'user-plus',      onclick: "navigate('customers')" },
    { label: 'New task',  icon: 'plus',           onclick: "navigate('tasks')" },
    { label: 'Quotation', icon: 'file-text',      onclick: "navigate('quotation')" },
    { label: 'Chat',      icon: 'message-square', onclick: "navigate('chat')" },
  ]),
};
/* ── Home dashboard ───────────────────────────────────────────────────────────
   Portal-specific bits live in HOMECFG, defined just above this block.
   Layout is a 12-column grid: each widget carries a width (3/4/6/12) and a height
   (1/2), which collapses to one column on a phone. Free-form x/y was deliberately
   avoided — hand-rolled collision and packing is where this kind of UI goes wrong. */

const HOME_SIZES = [
  { w: 3, label: 'Quarter' }, { w: 4, label: 'Third' },
  { w: 6, label: 'Half' }, { w: 12, label: 'Full' },
];

const HOME_WIDGETS = {
  my_tasks:      { title: 'My tasks',            icon: 'clipboard-list', w: 4, h: 2, perm: null },
  task_status:   { title: 'Tasks by status',     icon: 'pie-chart',      w: 4, h: 1, perm: null },
  overdue_tasks: { title: 'Overdue tasks',       icon: 'alarm-clock',    w: 3, h: 1, perm: null },
  leads_status:  { title: 'Leads by status',     icon: 'users',          w: 4, h: 2, perm: 'leads' },
  recent_leads:  { title: 'Recent leads',        icon: 'user-plus',      w: 4, h: 2, perm: 'leads' },
  followups:     { title: 'Follow-ups due',      icon: 'calendar-clock', w: 4, h: 2, perm: 'leads' },
  pipeline:      { title: 'Pipeline by stage',   icon: 'trending-up',    w: 6, h: 2, perm: 'deals' },
  won_month:     { title: 'Won this month',      icon: 'trophy',         w: 3, h: 1, perm: 'deals' },
  hours_week:    { title: 'Hours this week',     icon: 'timer',          w: 3, h: 1, perm: null },
  stock_summary: { title: 'Stock',               icon: 'car-front',      w: 3, h: 1, perm: null },
  quick_actions: { title: 'Quick actions',       icon: 'zap',            w: 4, h: 1, perm: null },
};

const HOME_DEFAULT = [
  { id: 'my_tasks', w: 4, h: 2 }, { id: 'task_status', w: 4, h: 1 },
  { id: 'overdue_tasks', w: 4, h: 1 }, { id: 'pipeline', w: 6, h: 2 },
  { id: 'recent_leads', w: 6, h: 2 }, { id: 'quick_actions', w: 12, h: 1 },
];

let _home = { widgets: [], data: null, editing: false, req: 0 };

// The catalogue an employee sees is filtered by what they can actually open, so
// nobody can add a widget for a section that would then 403 on them.
function homeAvailable() {
  return Object.entries(HOME_WIDGETS)
    .filter(([, w]) => !w.perm || HOMECFG.can(w.perm))
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
    const allowed = new Set(homeAvailable().map(w => w.id));
    const saved = (layout.widgets || []).filter(w => allowed.has(w.id));
    _home.widgets = saved.length ? saved : HOME_DEFAULT.filter(w => allowed.has(w.id));
  } catch (_) {
    _home.data = _home.data || {};
    if (!_home.widgets.length) _home.widgets = HOME_DEFAULT;
  }
  homeRender();
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

  grid.innerHTML = _home.widgets.map((w, i) => {
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
    case 'quick_actions':
      return `<div class="home-actions">${HOMECFG.actions().map(a =>
        `<button class="btn btn-outline btn-sm" onclick="${a.onclick}">
          <i data-lucide="${a.icon}" style="width:13px;height:13px"></i> ${esc(a.label)}</button>`).join('')}</div>`;
    default: return '<div class="home-none">—</div>';
  }
}

// ── Edit mode ──
function homeToggleEdit() {
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

// Portal binding for the shared huddle / group-admin module below.
const HDCFG = {
  base: '/api/dashboard/chat',
  me: () => 'admin',
  fetch: (url, opts) => apiFetch(url, opts),
  rooms: () => adminChatRooms,
  activeRoom: () => adminActiveChatRoom,
  openRoom: id => adminChatOpenRoom(id),
  refreshRooms: async () => {
    const r = await apiFetch('/api/dashboard/chat/rooms');
    if (!r.ok) return;
    adminChatRooms = await r.json();
    adminChatRenderRoomList();
  },
};

/* ── Huddles, group administration & status ───────────────────────────────────
   Shared between the admin dashboard and the team portal. Everything portal
   specific lives in HDCFG, which each portal defines just above this block. */

// Mesh topology: every participant holds one RTCPeerConnection per peer, so the
// server caps a huddle at HUDDLE_MAX. Signalling rides the chat SSE stream that
// messages already use, so there is no second socket to keep alive.
let _hd = { roomId: null, peers: new Map(), local: null, screen: null, muted: false, cam: false, sharing: false, ice: null, iceUntil: 0, roster: [], statsTimer: null };

function hdMe() { return HDCFG.me(); }
function hdFetch(path, opts) { return HDCFG.fetch(HDCFG.base + path, opts); }
function hdRoom(id) { return (HDCFG.rooms() || []).find(r => r.id === id) || null; }
function hdRoomMemberKeys(id) { return ((hdRoom(id) || {}).members || []).map(m => m.member_key); }
function hdNameFor(key) {
  for (const r of HDCFG.rooms() || []) {
    const m = (r.members || []).find(x => x.member_key === key);
    if (m) return m.member_name;
  }
  return key === 'admin' ? 'Admin' : key;
}
function hdSignal(type, to, data) {
  return hdFetch('/huddle/signal', { method: 'POST', body: JSON.stringify({ roomId: _hd.roomId, type, to, data }) });
}

async function hdIce() {
  // Relay credentials expire (Cloudflare mints short-lived ones), so this cache
  // has to as well — a tab left open all day must not start a call with a dead
  // username. Refresh a few minutes before the server's stated TTL.
  if (_hd.ice && Date.now() < _hd.iceUntil) return _hd.ice;
  try {
    _hd.ice = await hdFetch('/huddle/ice').then(r => r.json());
    _hd.iceUntil = Date.now() + Math.max(60, (_hd.ice.ttl || 3600) - 300) * 1000;
  } catch (_) {
    _hd.ice = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], hasTurn: false };
    _hd.iceUntil = Date.now() + 60000;   // retry soon; this is a degraded fallback
  }
  return _hd.ice;
}

// Does the relay actually work? Credentials being issued proves nothing — a revoked
// key, a blocked port or a typo'd token all still return a well-formed config, and
// on a friendly network peer-to-peer succeeds so the relay is never exercised.
// Gathering with iceTransportPolicy:'relay' discards host and reflexive candidates,
// so any candidate at all means the relay answered, and none means it didn't.
async function huddleRelayTest() {
  hdToast('Testing the relay…');
  _hd.ice = null; _hd.iceUntil = 0;          // always ask the server, never a stale cache
  const cfg = await hdIce();
  if (!cfg.hasTurn) {
    hdToast(`No TURN configured — provider: ${cfg.provider || 'none'}. Huddles will use STUN only.`);
    return { ok: false, reason: 'not-configured', provider: cfg.provider || 'none' };
  }
  let pc = null;
  try {
    pc = new RTCPeerConnection({ iceServers: cfg.iceServers || [], iceTransportPolicy: 'relay' });
    const protos = new Set();
    const done = new Promise(resolve => {
      const finish = () => resolve();
      const timer = setTimeout(finish, 8000);
      pc.onicecandidate = e => {
        if (!e.candidate) { clearTimeout(timer); return finish(); }   // gathering complete
        const m = /(?:^| )(udp|tcp|tls)(?: |$)/i.exec(e.candidate.candidate || '');
        protos.add(m ? m[1].toLowerCase() : (e.candidate.protocol || '?'));
      };
    });
    pc.createDataChannel('relay-probe');
    await pc.setLocalDescription(await pc.createOffer());
    await done;
    if (protos.size) {
      hdToast(`Relay OK via ${cfg.provider} — ${[...protos].sort().join(', ')}.`);
      return { ok: true, provider: cfg.provider, protocols: [...protos].sort() };
    }
    hdToast(`No relay reachable. ${cfg.provider} issued credentials but nothing came back — check the key is still active.`);
    return { ok: false, reason: 'no-candidates', provider: cfg.provider };
  } catch (e) {
    hdToast('Relay test failed to run: ' + (e && e.message ? e.message : e));
    return { ok: false, reason: 'error', error: String(e && e.message || e) };
  } finally {
    if (pc) { try { pc.close(); } catch (_) {} }
  }
}

async function huddleStart(roomId, withVideo) {
  if (_hd.roomId === roomId) { hdToast('You are already in this huddle.'); return; }
  if (_hd.roomId) { hdToast('Leave your current huddle first.'); return; }
  try {
    _hd.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!withVideo });
  } catch (_) {
    hdToast('Could not access your microphone. Check the browser permission.');
    return;
  }
  _hd.roomId = roomId; _hd.cam = !!withVideo; _hd.muted = false; _hd.sharing = false;
  await hdIce();
  hdHideJoinChip();
  hdRenderBar();
  let r = null;
  try { r = await hdFetch('/huddle/signal', { method: 'POST', body: JSON.stringify({ roomId, type: 'join' }) }).then(x => x.json()); }
  catch (_) {}
  if (!r || r.error) { hdToast((r && r.error) || 'Could not join the huddle.'); huddleLeave(); return; }
  _hd.roster = r.participants || [];
  hdStartStats();
  // Ring everyone else in the conversation; they get an incoming-huddle prompt.
  hdRoomMemberKeys(roomId).forEach(k => { if (k !== hdMe()) hdSignal('invite', k).catch(() => {}); });
  hdRenderBar();
}

function huddleJoinExisting(roomId) { return huddleStart(roomId, false); }

function huddleLeave() {
  if (_hd.roomId) hdSignal('leave').catch(() => {});
  if (_hd.statsTimer) { clearInterval(_hd.statsTimer); _hd.statsTimer = null; }
  _hd.peers.forEach(p => { try { p.pc.close(); } catch (_) {} });
  _hd.peers.clear();
  [_hd.local, _hd.screen].forEach(st => st && st.getTracks().forEach(t => t.stop()));
  _hd = { roomId: null, peers: new Map(), local: null, screen: null, muted: false, cam: false, sharing: false, ice: _hd.ice, iceUntil: _hd.iceUntil, roster: [], statsTimer: null };
  hdRenderBar();
}

function hdPeer(key) {
  if (_hd.peers.has(key)) return _hd.peers.get(key);
  const pc = new RTCPeerConnection({ iceServers: (_hd.ice && _hd.ice.iceServers) || [] });
  const entry = { pc, stream: new MediaStream(), name: hdNameFor(key), state: 'connecting' };
  _hd.peers.set(key, entry);
  if (_hd.local) _hd.local.getTracks().forEach(t => pc.addTrack(t, _hd.local));
  // Reserve the video slot before the first offer. A mesh has no SFU to renegotiate
  // through, so turning a camera or screen share on later has to be a track swap
  // onto an m-line that already exists.
  //
  // Only the side that will SEND the offer may reserve it. On the answering side
  // setRemoteDescription builds the transceivers from the offer itself, and one
  // added here beforehand is left unassociated (mid === null) — a track swapped
  // onto it goes nowhere. That is why sharing a screen only ever worked in one
  // direction: the offerer's share arrived, the answerer's silently did not.
  if (hdMe() < key && !pc.getSenders().some(s => s.track && s.track.kind === 'video')) {
    pc.addTransceiver('video', { direction: 'sendrecv' });
  }
  // Safety net for any m-line that genuinely appears later. Only the designated
  // offerer may renegotiate, and never before the first exchange has settled,
  // or the two sides collide.
  pc.onnegotiationneeded = async () => {
    if (hdMe() > key || !entry.negotiated || entry.makingOffer || pc.signalingState !== 'stable') return;
    try {
      entry.makingOffer = true;
      await pc.setLocalDescription(await pc.createOffer());
      hdSignal('offer', key, pc.localDescription).catch(() => {});
    } catch (_) { /* the next state change will retry */ }
    finally { entry.makingOffer = false; }
  };
  pc.onicecandidate = e => { if (e.candidate) hdSignal('ice', key, e.candidate).catch(() => {}); };
  pc.ontrack = e => {
    (e.streams[0] ? e.streams[0].getTracks() : [e.track]).forEach(t => {
      if (!entry.stream.getTracks().includes(t)) entry.stream.addTrack(t);
    });
    hdRenderBar();
  };
  // Whether a peer has a picture is NOT readable from the track: with the slot
  // reserved sendrecv in both directions the remote track reports muted:false and
  // live even when nothing is being sent. Peers announce it instead (see 'media'),
  // and the stats poll below corrects us if that message is ever missed.
  pc.onconnectionstatechange = () => {
    entry.state = pc.connectionState;
    // 'failed' nearly always means no relay path — say so rather than hanging
    if (pc.connectionState === 'failed' && !(_hd.ice && _hd.ice.hasTurn)) {
      hdToast("Couldn't reach " + entry.name + ". This network needs a TURN relay.");
    }
    hdRenderBar();
  };
  return entry;
}

async function hdCall(key) {
  const entry = hdPeer(key);
  const { pc } = entry;
  try {
    entry.makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    hdSignal('offer', key, offer).catch(() => {});
  } finally { entry.makingOffer = false; }
}

// Every 'huddle' SSE frame lands here.
async function huddleOnSignal(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'roster') {
    if (msg.roomId !== _hd.roomId) { hdNoteRoster(msg); return; }
    _hd.roster = msg.participants || [];
    // Glare rule: only the lexicographically smaller key offers, so two peers
    // never negotiate against each other.
    _hd.roster.forEach(p => {
      if (p.key !== hdMe() && !_hd.peers.has(p.key) && hdMe() < p.key) hdCall(p.key);
    });
    [..._hd.peers.keys()].forEach(k => {
      if (!_hd.roster.some(p => p.key === k)) {
        try { _hd.peers.get(k).pc.close(); } catch (_) {}
        _hd.peers.delete(k);
      }
    });
    hdRenderBar();
    // Someone arriving mid-call has no idea what we are already sending
    if (_hd.cam || _hd.sharing) hdBroadcastMedia();
    if (_hd.peers.size) hdStartStats();
    return;
  }
  if (msg.type === 'invite') { hdIncoming(msg); return; }
  if (msg.type === 'media') {
    const p = _hd.peers.get(msg.from);
    if (p) { p.video = !!(msg.data && (msg.data.cam || msg.data.sharing)); p.sharing = !!(msg.data && msg.data.sharing); hdRenderBar(); }
    return;
  }
  if (msg.type === 'decline') { hdToast(esc(msg.fromName || 'They') + ' declined the huddle.'); return; }
  if (!_hd.roomId || msg.roomId !== _hd.roomId) return;   // signal for a call we're not in
  const from = msg.from;
  if (msg.type === 'offer') {
    const entry = hdPeer(from);
    const { pc } = entry;
    await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
    // We have no camera yet, so the offer's video m-line lands here as recvonly
    // and the answer would close this direction for good. Open it both ways
    // before answering — then starting a screen share later is a track swap on
    // an already-negotiated m-line, with nothing to renegotiate.
    const vt = hdVideoTransceiver(pc);
    if (vt && vt.direction !== 'sendrecv') { try { vt.direction = 'sendrecv'; } catch (_) {} }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    entry.negotiated = true;
    hdSignal('answer', from, answer).catch(() => {});
  } else if (msg.type === 'answer') {
    const p = _hd.peers.get(from);
    if (p && p.pc.signalingState !== 'stable') {
      await p.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
      p.negotiated = true;
    }
  } else if (msg.type === 'ice') {
    const p = _hd.peers.get(from);
    if (p && msg.data) { try { await p.pc.addIceCandidate(new RTCIceCandidate(msg.data)); } catch (_) {} }
  }
}

// Tell every peer what we are sending. Cheap, instant, and the only reliable
// source of "do they have a picture" now that the reserved transceiver keeps the
// remote track unmuted regardless.
function hdBroadcastMedia() {
  const data = { cam: !!_hd.cam, sharing: !!_hd.sharing };
  _hd.peers.forEach((_p, key) => hdSignal('media', key, data).catch(() => {}));
}

// One poll drives two things: the per-participant quality bars, and a backstop for
// the picture flag in case a 'media' message was lost.
function hdStartStats() {
  if (_hd.statsTimer) return;
  _hd.statsTimer = setInterval(hdPollStats, 3000);
}
async function hdPollStats() {
  if (!_hd.roomId) return;
  for (const [, p] of _hd.peers) {
    try {
      let lost = 0, recv = 0, rtt = null, frames = 0;
      (await p.pc.getStats()).forEach(r => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') { lost = r.packetsLost || 0; recv = r.packetsReceived || 0; }
        if (r.type === 'inbound-rtp' && r.kind === 'video') frames = r.framesDecoded || 0;
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime;
      });
      const prev = p.stats || { lost: 0, recv: 0, frames: 0 };
      const dLost = Math.max(0, lost - prev.lost), dRecv = Math.max(0, recv - prev.recv);
      p.loss = (dLost + dRecv) ? dLost / (dLost + dRecv) : 0;
      p.rtt = rtt;
      p.stats = { lost, recv, frames };
      p.quality = hdQuality(p);
      if (frames > prev.frames) p.video = true;   // frames arriving = a real picture
    } catch (_) { /* a closing connection throws; the next tick will settle it */ }
  }
  hdRenderBar();
}
// 0 connecting/failed · 1 poor · 2 fair · 3 good
function hdQuality(p) {
  if (p.pc.connectionState !== 'connected') return 0;
  if (p.loss > 0.08 || (p.rtt != null && p.rtt > 0.4)) return 1;
  if (p.loss > 0.03 || (p.rtt != null && p.rtt > 0.2)) return 2;
  return 3;
}
function hdQualityLabel(p) {
  const pct = Math.round((p.loss || 0) * 1000) / 10;
  const ms = p.rtt != null ? Math.round(p.rtt * 1000) + ' ms' : 'unknown';
  return ['Connecting', 'Poor connection', 'Fair connection', 'Good connection'][p.quality || 0]
    + ' \u00b7 ' + pct + '% packet loss \u00b7 round trip ' + ms;
}

// ── Controls ──
function huddleToggleMute() {
  if (!_hd.local) return;
  _hd.muted = !_hd.muted;
  _hd.local.getAudioTracks().forEach(t => { t.enabled = !_hd.muted; });
  hdRenderBar();
}
function hdAnnounceAndRender() { hdBroadcastMedia(); hdRenderBar(); }
async function huddleToggleCam() {
  if (!_hd.roomId) return;
  if (_hd.cam) {
    _hd.local.getVideoTracks().forEach(t => { t.stop(); _hd.local.removeTrack(t); });
    if (!_hd.sharing) hdSwapVideo(null);
    _hd.cam = false;
  } else {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = cam.getVideoTracks()[0];
      _hd.local.addTrack(track);
      // While sharing a screen the screen track owns the video sender; the camera
      // takes over again when sharing stops.
      if (!_hd.sharing) hdSwapVideo(track);
      _hd.cam = true;
    } catch (_) { hdToast('Could not access your camera.'); }
  }
  hdAnnounceAndRender();
}
// The negotiated video transceiver, resolved fresh every time. Caching a sender
// across a negotiation is what broke this: the cached one can end up unassociated
// while the peer renders a different m-line entirely.
function hdVideoTransceiver(pc) {
  return pc.getTransceivers().find(t => t.mid != null && !t.stopped &&
    (((t.receiver || {}).track || {}).kind === 'video' || ((t.sender || {}).track || {}).kind === 'video'));
}
function hdSwapVideo(track) {
  _hd.peers.forEach(p => {
    const t = hdVideoTransceiver(p.pc);
    if (!t) return;
    // A transceiver left recvonly swallows the track without complaint
    if (t.direction !== 'sendrecv') { try { t.direction = 'sendrecv'; } catch (_) {} }
    t.sender.replaceTrack(track).catch(() => {});
  });
}
async function huddleToggleShare() {
  if (!_hd.roomId) return;
  if (_hd.sharing) {
    if (_hd.screen) _hd.screen.getTracks().forEach(t => t.stop());
    _hd.screen = null; _hd.sharing = false;
    hdSwapVideo(_hd.local.getVideoTracks()[0] || null);
  } else {
    try {
      _hd.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = _hd.screen.getVideoTracks()[0];
      track.onended = () => { if (_hd.sharing) huddleToggleShare(); };   // browser's own "Stop sharing"
      hdSwapVideo(track);
      _hd.sharing = true;
    } catch (_) { /* the picker was cancelled */ }
  }
  hdAnnounceAndRender();
}
function huddleInvite(key) { if (_hd.roomId) hdSignal('invite', key).catch(() => {}); }

// ── Huddle UI ──
function hdToast(msg) {
  const el = document.getElementById('hd-toast');
  if (!el) { console.warn('[huddle]', msg); return; }
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
}
function hdNoteRoster(msg) {
  // A huddle is running in a room we are not in
  if ((msg.participants || []).length) hdShowJoinChip(msg.roomId, msg.participants.length);
  else hdHideJoinChip();
}
function hdShowJoinChip(roomId, n) {
  const el = document.getElementById('hd-join-chip');
  if (!el || _hd.roomId) return;
  const room = hdRoom(roomId);
  const where = room ? (room.type === 'group' ? room.name : hdNameFor((room.members || []).map(m => m.member_key).find(k => k !== hdMe()) || '')) : 'a conversation';
  el.innerHTML = `<span>Huddle in ${esc(where)} · ${n} ${n === 1 ? 'person' : 'people'}</span>
    <button class="hd-chip-btn" onclick="huddleJoinExisting(${roomId})">Join</button>
    <button class="hd-chip-x" onclick="hdHideJoinChip()" title="Dismiss">×</button>`;
  el.style.display = 'flex';
}
function hdHideJoinChip() { const el = document.getElementById('hd-join-chip'); if (el) el.style.display = 'none'; }

function hdIncoming(msg) {
  if (_hd.roomId === msg.roomId) return;              // already in it
  const el = document.getElementById('hd-incoming');
  if (!el) return;
  el.innerHTML = `<div class="hd-ring-title">${esc(msg.fromName || 'Someone')} started a huddle</div>
    <div class="hd-ring-actions">
      <button class="hd-chip-btn" onclick="hdAccept(${msg.roomId})">Join</button>
      <button class="hd-chip-x wide" onclick="hdDecline(${JSON.stringify(String(msg.from || '')).replace(/"/g, '&quot;')},${msg.roomId})">Decline</button>
    </div>`;
  el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 45000);
  try { hdRing(); } catch (_) {}
}
function hdRing() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.frequency.value = 660; gain.gain.value = 0.06;
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + 0.5);
  setTimeout(() => { try { ctx.close(); } catch (_) {} }, 900);
}
function hdAccept(roomId) {
  const el = document.getElementById('hd-incoming');
  if (el) el.style.display = 'none';
  huddleJoinExisting(roomId);
}
function hdDecline(from, roomId) {
  const el = document.getElementById('hd-incoming');
  if (el) el.style.display = 'none';
  hdFetch('/huddle/signal', { method: 'POST', body: JSON.stringify({ roomId, type: 'decline', to: from }) }).catch(() => {});
}

function hdCssEsc(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');
}

// Find-or-create a tile. Tiles are reused across renders because they hold live
// media elements: rebuilding the bar's innerHTML would tear down every <video>
// mid-call and restart playback, which is audible as a dropout.
function hdTileEl(tiles, id) {
  let el = tiles.querySelector('[data-tile="' + hdCssEsc(id) + '"]');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'hd-tile';
  el.setAttribute('data-tile', id);
  el.innerHTML = '<div class="hd-tile-name"></div>'
    + '<video class="hd-video" autoplay playsinline></video>'
    + '<div class="hd-avatar"><i data-lucide="mic" style="width:22px;height:22px"></i></div>'
    + '<button class="hd-full" style="display:none" title="Full screen">⛶</button>'
    + '<span class="hd-q" data-q="0"><i></i><i></i><i></i></span>';
  el.querySelector('.hd-full').addEventListener('click', () => hdFullscreen(el));
  el.querySelector('.hd-video').addEventListener('dblclick', () => hdFullscreen(el));
  tiles.appendChild(el);
  return el;
}

// Full screen for a shared screen — a 132px tile is useless for reading someone's
// code or spreadsheet. Goes full screen on the tile rather than the <video> so the
// name label comes along, except on iOS Safari, which can only do it to a <video>.
function hdFullscreen(tile) {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    return;
  }
  const v = tile.querySelector('.hd-video');
  if (tile.requestFullscreen) { const r = tile.requestFullscreen(); if (r && r.catch) r.catch(() => {}); }
  else if (tile.webkitRequestFullscreen) tile.webkitRequestFullscreen();
  else if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  else hdToast('This browser will not go full screen.');
}

// A remote stream is only audible once it is attached to a media element, so every
// participant keeps a <video> whether or not a camera is on — it is simply hidden
// behind the avatar when there is no picture, and display:none does not stop audio.
// Creating the element only once video arrived is what made audio-only huddles
// silent: the audio was being received and decoded, but nothing was playing it.
function hdPaintTile(el, label, stream, showVideo, mute, peer) {
  const nameEl = el.querySelector('.hd-tile-name');
  if (nameEl.textContent !== label) nameEl.textContent = label;
  const v = el.querySelector('.hd-video');
  v.muted = !!mute;                        // only ever our own tile, or we echo
  if (v.srcObject !== (stream || null)) {
    v.srcObject = stream || null;
    if (stream) { const r = v.play(); if (r && r.catch) r.catch(() => hdAudioBlocked()); }
  }
  v.style.display = showVideo ? '' : 'none';
  el.querySelector('.hd-avatar').style.display = showVideo ? 'none' : '';
  // Nothing to enlarge when there is no picture
  el.querySelector('.hd-full').style.display = showVideo ? 'flex' : 'none';
  // Quality bars, so everyone can see who is struggling and why
  const q = el.querySelector('.hd-q');
  if (peer) {
    q.style.display = '';
    q.setAttribute('data-q', String(peer.quality == null ? 0 : peer.quality));
    q.title = hdQualityLabel(peer);
  } else { q.style.display = 'none'; }
}

// Browsers refuse to start audio without a user gesture. Joining a huddle is a
// click, so this should be rare — but when it does happen the call is silent with
// no clue why, so say so and retry on the next click anywhere.
let _hdGestureHooked = false;
function hdAudioBlocked() {
  hdToast('Your browser blocked the sound. Click anywhere to turn it on.');
  if (_hdGestureHooked) return;
  _hdGestureHooked = true;
  const resume = () => {
    document.querySelectorAll('#hd-bar video').forEach(v => { const r = v.play(); if (r && r.catch) r.catch(() => {}); });
    document.removeEventListener('click', resume);
    _hdGestureHooked = false;
  };
  document.addEventListener('click', resume);
}

// Where the widget sits and whether it is collapsed survives across calls and
// reloads — it is a preference, not call state, so it lives outside _hd.
let _hdUI = { min: false, max: false, x: null, y: null };
try { Object.assign(_hdUI, JSON.parse(localStorage.getItem('ml_huddle_ui') || '{}')); } catch (_) {}
function hdSaveUI() { try { localStorage.setItem('ml_huddle_ui', JSON.stringify(_hdUI)); } catch (_) {} }

function hdApplyWidget(bar) {
  bar.classList.toggle('min', !!_hdUI.min);
  bar.classList.toggle('max', !!_hdUI.max);
  // Only override the CSS corner once the user has actually dragged it somewhere
  const moved = !_hdUI.max && _hdUI.x != null;
  bar.style.left = moved ? _hdUI.x + 'px' : '';
  bar.style.top = moved ? _hdUI.y + 'px' : '';
  bar.style.right = moved ? 'auto' : '';
  bar.style.bottom = moved ? 'auto' : '';
}
function hdWidgetAct(act) {
  if (act === 'min') { _hdUI.min = !_hdUI.min; if (_hdUI.min) _hdUI.max = false; }
  if (act === 'max') { _hdUI.max = !_hdUI.max; if (_hdUI.max) _hdUI.min = false; }
  hdSaveUI();
  hdRenderBar();
}
function hdBindWidget(bar) {
  const head = bar.querySelector('.hd-head');
  head.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.hd-wbtn');
    if (btn) { hdWidgetAct(btn.dataset.act); return; }
    if (_hdUI.max) return;                       // maximised does not move
    const r = bar.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => {
      // Clamped, so it can never be dragged off screen and stranded there
      _hdUI.x = Math.round(Math.min(Math.max(0, ev.clientX - dx), innerWidth - bar.offsetWidth));
      _hdUI.y = Math.round(Math.min(Math.max(0, ev.clientY - dy), innerHeight - bar.offsetHeight));
      hdApplyWidget(bar);
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      hdSaveUI();
    };
    try { head.setPointerCapture(e.pointerId); } catch (_) {}
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    e.preventDefault();
  });
}

function hdRenderBar() {
  const bar = document.getElementById('hd-bar');
  if (!bar) return;
  if (!_hd.roomId) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  if (!bar.querySelector('.hd-tiles')) {
    bar.innerHTML = '<div class="hd-head">'
      + '<span class="hd-grip"><i data-lucide="grip-horizontal" style="width:14px;height:14px"></i></span>'
      + '<span class="hd-title"></span>'
      + '<button class="hd-wbtn" data-act="min" title="Minimise"><i data-lucide="minus" style="width:14px;height:14px"></i></button>'
      + '<button class="hd-wbtn" data-act="max" title="Maximise"><i data-lucide="maximize-2" style="width:14px;height:14px"></i></button>'
      + '</div><div class="hd-tiles"></div><div class="hd-controls"></div>';
    hdBindWidget(bar);
  }
  const tiles = bar.querySelector('.hd-tiles');
  bar.style.display = 'flex';
  hdApplyWidget(bar);
  bar.querySelector('.hd-title').textContent = 'Huddle · ' + (_hd.peers.size + 1);

  const selfLabel = 'You' + (_hd.muted ? ' (muted)' : '') + (_hd.sharing ? ' · sharing' : '');
  hdPaintTile(hdTileEl(tiles, '__self'), selfLabel, _hd.sharing ? _hd.screen : _hd.local, !!(_hd.cam || _hd.sharing), true);

  const peers = [..._hd.peers.entries()];
  peers.forEach(([key, p]) => {
    const label = (p.name || key) + (p.state !== 'connected' ? ' · ' + p.state : '')
      + (p.sharing ? ' · sharing' : '');
    hdPaintTile(hdTileEl(tiles, key), label, p.stream, !!p.video, false, p);
  });

  const keep = new Set(['__self', ...peers.map(([k]) => k)]);
  [...tiles.children].forEach(el => { if (!keep.has(el.getAttribute('data-tile'))) el.remove(); });

  // No media lives in the controls, so replacing those wholesale is safe
  const ic = n => `<i data-lucide="${n}" style="width:16px;height:16px"></i>`;
  bar.querySelector('.hd-controls').innerHTML = `
    <button class="hd-btn ${_hd.muted ? 'off' : 'on'}" onclick="huddleToggleMute()" title="${_hd.muted ? 'Unmute' : 'Mute'}">${ic(_hd.muted ? 'mic-off' : 'mic')}</button>
    <button class="hd-btn ${_hd.cam ? 'on' : ''}" onclick="huddleToggleCam()" title="Camera">${ic(_hd.cam ? 'video' : 'video-off')}</button>
    <button class="hd-btn ${_hd.sharing ? 'on' : ''}" onclick="huddleToggleShare()" title="Share screen">${ic('monitor-up')}</button>
    <button class="hd-btn" onclick="hdOpenInvite()" title="Add someone">${ic('user-plus')}</button>
    <button class="hd-btn leave" onclick="huddleLeave()" title="Leave huddle">${ic('phone-off')}</button>`;
  if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
}

// Anyone in the workspace can be pulled in, not just people in this conversation.
// Someone outside it joins the call as a guest — the server grants them signalling
// for this huddle only, and never adds them to the room, so no history leaks.
async function hdOpenInvite() {
  const inCall = new Set((_hd.roster || []).map(r => r.key));
  const members = new Set(hdRoomMemberKeys(_hd.roomId));
  let people = [];
  try { const r = await HDCFG.fetch(HDCFG.base + '/people'); people = r.ok ? await r.json() : []; } catch (_) {}
  const rows = people
    .filter(p => p.key !== hdMe() && !inCall.has(p.key))
    .map(p => ({ ...p, guest: !members.has(p.key) }))
    .sort((a, b) => (a.guest - b.guest) || String(a.name).localeCompare(String(b.name)));
  if (!rows.length) { hdToast('Everyone is already here.'); return; }
  hdSheet('Add to huddle', `<div class="hd-list">
      ${rows.map(p => `<label class="hd-row"><input type="checkbox" class="hd-inv" value="${esc(p.key)}">
        <span style="flex:1">${esc(p.name)}</span>
        ${p.guest ? '<span class="hd-guest">guest</span>' : ''}</label>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">Someone marked <em>guest</em> is not in this
      conversation. They join the call only — they will not see its messages.</div>`,
    `<button class="btn btn-outline btn-sm" onclick="hdSheetClose()">Cancel</button>
     <button class="btn btn-primary btn-sm" onclick="hdSendInvites()">Invite</button>`);
}
function hdSendInvites() {
  const picked = [...document.querySelectorAll('.hd-inv:checked')].map(cb => cb.value);
  picked.forEach(k => huddleInvite(k));
  hdSheetClose();
  hdToast(picked.length ? 'Invite sent.' : 'Nobody selected.');
}

// ── A small overlay used by the huddle invite and the group panel ──
function hdSheet(title, bodyHTML, footHTML) {
  const el = document.getElementById('hd-sheet');
  if (!el) return;
  el.innerHTML = `<div class="hd-sheet-box">
      <div class="hd-sheet-head"><div class="hd-sheet-title">${esc(title)}</div>
        <button class="hd-sheet-x" onclick="hdSheetClose()" title="Close">×</button></div>
      <div class="hd-sheet-body">${bodyHTML}</div>
      ${footHTML ? `<div class="hd-sheet-foot">${footHTML}</div>` : ''}
    </div>`;
  el.style.display = 'flex';
}
function hdSheetClose() { const el = document.getElementById('hd-sheet'); if (el) { el.style.display = 'none'; el.innerHTML = ''; } }

// ── Group administration ──────────────────────────────────────────────────────
// The admin manages any group; an employee manages groups they created. The
// server enforces the same rule — this only decides whether to draw the controls.
function chatCanManageRoom(room) {
  if (!room || room.type !== 'group') return false;
  return hdMe() === 'admin' || room.created_by === hdMe();
}

async function chatGroupPanel(roomId) {
  const room = hdRoom(roomId);
  if (!room) return;
  const can = chatCanManageRoom(room);
  const members = room.members || [];
  hdSheet(room.type === 'group' ? (room.name || 'Group') : 'Conversation', `
    ${can ? `<div class="hd-field">
      <label>Group name</label>
      <div style="display:flex;gap:8px">
        <input id="cg-name" class="hd-input" value="${esc(room.name || '')}" maxlength="80">
        <button class="btn btn-primary btn-sm" onclick="chatRenameRoom(${roomId})">Save</button>
      </div>
    </div>` : ''}
    <div class="hd-field">
      <label>${members.length} member${members.length === 1 ? '' : 's'}</label>
      <div class="hd-list" id="cg-members">
        ${members.map(m => `<div class="hd-row">
          <span style="flex:1">${esc(m.member_name)}${m.member_status_emoji ? ` <span title="${esc(m.member_status || '')}">${esc(m.member_status_emoji)}</span>` : ''}${m.member_key === hdMe() ? ' <span style="color:var(--muted)">(you)</span>' : ''}</span>
          ${can && m.member_key !== hdMe() ? `<button class="hd-sheet-x" title="Remove" onclick="chatRemoveMember(${roomId},${JSON.stringify(m.member_key).replace(/"/g, '&quot;')})">×</button>` : ''}
        </div>`).join('')}
      </div>
    </div>
    ${can ? `<div class="hd-field">
      <label>Add people</label>
      <div class="hd-list" id="cg-add"><div style="font-size:12px;color:var(--muted);padding:6px">Loading…</div></div>
    </div>` : ''}
    <div class="hd-field">
      <label>Shared files</label>
      <div id="cg-files"><div style="font-size:12px;color:var(--muted);padding:6px">Loading…</div></div>
    </div>`,
    `<button class="btn btn-outline btn-sm" onclick="hdSheetClose()">Close</button>
     ${can ? '<button class="btn btn-primary btn-sm" onclick="chatAddMembers(' + roomId + ')">Add selected</button>' : ''}`);
  if (can) chatGroupLoadCandidates(roomId);
  chatGroupLoadFiles(roomId);
}

async function chatGroupLoadCandidates(roomId) {
  const box = document.getElementById('cg-add');
  if (!box) return;
  let people = [];
  try { const r = await HDCFG.fetch(HDCFG.base + '/people'); people = r.ok ? await r.json() : []; } catch (_) {}
  const have = new Set(hdRoomMemberKeys(roomId));
  const free = people.filter(p => !have.has(p.key));
  box.innerHTML = free.length
    ? free.map(p => `<label class="hd-row"><input type="checkbox" class="cg-add-cb" value="${esc(p.key)}"> ${esc(p.name)}${p.role ? ` <span style="color:var(--muted)">· ${esc(p.role)}</span>` : ''}</label>`).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:6px">Everyone is already in this group.</div>';
}

async function chatGroupLoadFiles(roomId) {
  const box = document.getElementById('cg-files');
  if (!box) return;
  let files = [];
  try { const r = await HDCFG.fetch(HDCFG.base + '/rooms/' + roomId + '/attachments'); files = r.ok ? await r.json() : []; } catch (_) {}
  if (!files.length) { box.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px">Nothing shared yet.</div>'; return; }
  box.innerHTML = '<div class="hd-files">' + files.map(f => {
    const img = (f.file_type || '').startsWith('image/');
    const kb = f.file_size ? Math.max(1, Math.round(f.file_size / 1024)) + ' KB' : '';
    return `<a class="hd-file" href="${esc(f.file_url)}" target="_blank" rel="noopener" title="${esc(f.file_name || '')}">
      ${img ? `<img src="${esc(f.file_url)}" alt="">` : '<div class="hd-file-ic"><i data-lucide="file-text" style="width:22px;height:22px"></i></div>'}
      <div class="hd-file-meta"><div class="hd-file-name">${esc(f.file_name || 'file')}</div>
        <div class="hd-file-sub">${esc(f.sender_name || '')}${kb ? ' · ' + kb : ''}</div></div></a>`;
  }).join('') + '</div>';
}

async function chatRenameRoom(roomId) {
  const name = (document.getElementById('cg-name') || {}).value || '';
  if (!name.trim()) { hdToast('Give the group a name.'); return; }
  const r = await HDCFG.fetch(HDCFG.base + '/rooms/' + roomId, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
  if (!r.ok) { hdToast(((await r.json().catch(() => ({}))).error) || 'Could not rename the group.'); return; }
  await HDCFG.refreshRooms();
  hdToast('Group renamed.');
  if (HDCFG.activeRoom() === roomId) HDCFG.openRoom(roomId);
  chatGroupPanel(roomId);
}

async function chatAddMembers(roomId) {
  const keys = [...document.querySelectorAll('.cg-add-cb:checked')].map(cb => cb.value);
  if (!keys.length) { hdToast('Pick at least one person.'); return; }
  const r = await HDCFG.fetch(HDCFG.base + '/rooms/' + roomId + '/members', { method: 'POST', body: JSON.stringify({ memberKeys: keys }) });
  if (!r.ok) { hdToast(((await r.json().catch(() => ({}))).error) || 'Could not add members.'); return; }
  await HDCFG.refreshRooms();
  hdToast(keys.length === 1 ? 'Member added.' : keys.length + ' members added.');
  chatGroupPanel(roomId);
}

async function chatRemoveMember(roomId, key) {
  if (!confirm('Remove ' + hdNameFor(key) + ' from this group?')) return;
  const r = await HDCFG.fetch(HDCFG.base + '/rooms/' + roomId + '/members/' + encodeURIComponent(key), { method: 'DELETE' });
  if (!r.ok) { hdToast(((await r.json().catch(() => ({}))).error) || 'Could not remove that member.'); return; }
  await HDCFG.refreshRooms();
  hdToast('Member removed.');
  chatGroupPanel(roomId);
}

// ── Chat header extras ────────────────────────────────────────────────────────
function chatHeaderActions(room) {
  if (!room) return '';
  const ic = (n) => `<i data-lucide="${n}" style="width:16px;height:16px"></i>`;
  const inThis = _hd.roomId === room.id;
  return `<div class="chat-head-actions">
    ${inThis
      ? `<button class="hd-head-btn live" onclick="huddleLeave()" title="Leave the huddle">${ic('phone-off')}</button>`
      : `<button class="hd-head-btn" onclick="huddleStart(${room.id},false)" title="Start a huddle">${ic('headphones')}</button>
         <button class="hd-head-btn" onclick="huddleStart(${room.id},true)" title="Start a huddle with video">${ic('video')}</button>`}
    <button class="hd-head-btn" onclick="chatGroupPanel(${room.id})" title="${room.type === 'group' ? 'Group info, members and files' : 'Shared files'}">${ic(room.type === 'group' ? 'users' : 'paperclip')}</button>
  </div>`;
}
function chatHeaderStatus(room) {
  if (!room || room.type !== 'direct') return '';
  const other = (room.members || []).find(m => m.member_key !== hdMe());
  return other ? statusChip(other.member_status_emoji, other.member_status) : '';
}

// ── Status ────────────────────────────────────────────────────────────────────
// Everyone's status is attached to room members and message senders by the API,
// so any viewer sees it — not just the person who set it.
function statusChip(emoji, text) {
  if (!emoji && !text) return '';
  const tip = text || '';
  return `<span class="status-chip" title="${esc(tip)}">${emoji ? esc(emoji) : '<i data-lucide="message-square" style="width:11px;height:11px"></i>'}${text ? '<span class="status-chip-txt">' + esc(text) + '</span>' : ''}</span>`;
}
function statusEmojiOnly(emoji, text) {
  if (!emoji) return '';
  return `<span class="status-emo" title="${esc(text || '')}">${esc(emoji)}</span>`;
}
