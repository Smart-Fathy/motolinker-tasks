// Weekly availability — the team board and the own-week editor, both portals.
//
// Everyone marks their upcoming week (per day: available with hours, partial,
// or off); everyone with availability.view sees the whole team's, so "can I
// call them right now?" has an answer before the call. Consumes PROCFG like the
// other shared modules.
(function () {
  function aPath(url) {
    return PROCFG.base === '/api/dashboard' ? url : url.replace(/^\/api\/dashboard/, PROCFG.base);
  }
  const aFetch = (url, opts) => PROCFG.fetch(aPath(url), opts);
  const aCan = a => !PROCFG.can || PROCFG.can('availability', a);

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const STATUS_META = {
    available: { label: 'Available', color: '#22c55e' },
    partial:   { label: 'Partial',   color: '#eab308' },
    off:       { label: 'Off',       color: '#6b7280' },
  };

  let _week = null;       // 'YYYY-MM-DD' Monday currently shown
  let _board = null;      // last fetched { week, members }

  function mondayOf(d) {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function cellHtml(day) {
    if (!day) return '<td style="padding:7px 8px;text-align:center;color:var(--muted);font-size:11px">—</td>';
    const meta = STATUS_META[day.status] || STATUS_META.off;
    const hours = day.status !== 'off' && day.from && day.to ? `${day.from}–${day.to}` : meta.label;
    const title = [meta.label, day.from && day.to ? `${day.from}–${day.to}` : '', day.note || ''].filter(Boolean).join(' · ');
    return `<td style="padding:7px 8px;text-align:center" title="${esc(title)}">
      <span style="display:inline-block;padding:2px 8px;border-radius:9px;font-size:10.5px;font-weight:600;background:${meta.color}26;color:${meta.color};white-space:nowrap">${esc(hours)}</span>
    </td>`;
  }

  async function renderAvailabilityBoard(containerId, weekStr) {
    const box = document.getElementById(containerId || 'availability-board');
    if (!box) return;
    if (!aCan('view')) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
    let d = null;
    try { d = await aFetch('/api/dashboard/availability' + (weekStr ? `?week=${weekStr}` : '')).then(r => r.json()); }
    catch (_) {}
    if (!d || !Array.isArray(d.members)) {
      box.innerHTML = `<div class="error-msg" style="display:block">${esc((d && d.error) || 'Could not load availability.')}${/availability_weeks/.test(String(d && d.error)) ? '<br><span style="font-size:12px">Run <code>migrations/011_availability.sql</code>.</span>' : ''}</div>`;
      return;
    }
    _week = d.week; _board = d;
    const monday = new Date(d.week + 'T00:00:00');
    const next = new Date(monday); next.setDate(next.getDate() + 7);
    const prev = new Date(monday); prev.setDate(prev.getDate() - 7);
    const range = `${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(next - 864e5).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="renderAvailabilityBoard('${containerId || 'availability-board'}','${fmt(prev)}')">‹</button>
          <div style="font-weight:700;font-size:13.5px">${esc(range)}</div>
          <button class="btn btn-outline btn-sm" onclick="renderAvailabilityBoard('${containerId || 'availability-board'}','${fmt(next)}')">›</button>
        </div>
        ${aCan('set') ? `<button class="btn btn-primary btn-sm" onclick="openAvailabilityEditor()"><i data-lucide="calendar-check" style="width:14px;height:14px"></i> Set my week</button>` : ''}
      </div>
      <div class="table-scroll"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          <th style="padding:7px 8px;min-width:130px">Member</th>
          ${DAY_NAMES.map((n, i) => { const dd = new Date(monday); dd.setDate(dd.getDate() + i);
            return `<th style="padding:7px 8px;text-align:center">${n}<div style="font-weight:400;font-size:10px">${dd.getDate()}</div></th>`; }).join('')}
        </tr></thead>
        <tbody>${d.members.map(m => `
          <tr style="border-bottom:1px solid rgba(255,255,255,.05)">
            <td style="padding:7px 8px;font-weight:600${m.me ? ';color:var(--primary)' : ''}">${esc(m.name)}${m.me ? ' · you' : ''}</td>
            ${DAY_NAMES.map((_, i) => cellHtml(m.days && m.days[i])).join('')}
          </tr>`).join('')}</tbody>
      </table></div>`;
    requestAnimationFrame(() => lucide.createIcons());
  }

  function openAvailabilityEditor() {
    if (!_board) return;
    const mine = (_board.members.find(m => m.me) || {}).days;
    const monday = new Date(_week + 'T00:00:00');
    const row = (i) => {
      const d = (mine && mine[i]) || { status: 'available', from: '10:00', to: '18:00' };
      const dd = new Date(monday); dd.setDate(dd.getDate() + i);
      return `<div class="av-row" style="display:grid;grid-template-columns:86px 120px 1fr 1fr 1.4fr;gap:8px;align-items:center;margin-bottom:8px">
        <div style="font-size:12.5px;font-weight:600">${DAY_NAMES[i]} <span style="color:var(--muted);font-weight:400">${dd.getDate()}</span></div>
        <select class="form-control av-status" data-i="${i}" onchange="this.closest('.av-row').querySelectorAll('.av-time').forEach(x => { x.disabled = this.value === 'off'; })">
          ${Object.entries(STATUS_META).map(([k, v]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        <input class="form-control av-time av-from" type="time" value="${esc(d.from || '')}" ${d.status === 'off' ? 'disabled' : ''}>
        <input class="form-control av-time av-to" type="time" value="${esc(d.to || '')}" ${d.status === 'off' ? 'disabled' : ''}>
        <input class="form-control av-note" placeholder="Note (optional)" value="${esc(d.note || '')}">
      </div>`;
    };
    PROCFG.modal('My availability — week of ' + monday.toLocaleDateString(), `
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
        What the whole team sees when they wonder whether you can be contacted.</div>
      ${DAY_NAMES.map((_, i) => row(i)).join('')}
      <div id="av-err" class="error-msg" style="display:none"></div>`,
      `<button class="btn btn-outline" onclick="PROCFG.closeModal()">Cancel</button>
       <button class="btn btn-primary" onclick="saveAvailability()">Save my week</button>`,
      { wide: true });
  }

  async function saveAvailability() {
    const days = [...document.querySelectorAll('.av-row')].map(r => ({
      status: r.querySelector('.av-status').value,
      from: r.querySelector('.av-from').value,
      to: r.querySelector('.av-to').value,
      note: r.querySelector('.av-note').value,
    }));
    const r = await aFetch('/api/dashboard/availability', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week: _week, days }) });
    const d = await r.json().catch(() => ({}));
    const err = document.getElementById('av-err');
    if (!r.ok) { err.textContent = d.error || 'Failed to save.'; err.style.display = 'block'; return; }
    PROCFG.closeModal();
    PROCFG.toast('Your week is saved — the whole team sees it now.');
    renderAvailabilityBoard('availability-board', _week);
  }

  // Today's cell for one member, for the chat header: 'available 10:00–18:00' etc.
  function availabilityToday(memberKey) {
    if (!_board) return null;
    const m = _board.members.find(x => x.key === memberKey);
    if (!m || !m.days) return null;
    const i = (new Date().getDay() + 6) % 7;
    const today = fmt(mondayOf(new Date()));
    if (_board.week !== today) return null;   // showing another week
    return m.days[i] || null;
  }

  Object.assign(window, { renderAvailabilityBoard, openAvailabilityEditor, saveAvailability, availabilityToday });
})();
