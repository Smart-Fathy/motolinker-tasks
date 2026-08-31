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

  // Times are STORED as 24h "HH:MM" — the server's TIME_RE and sanitizeDays
  // depend on it — and READ as 12h everywhere, because that is how this team
  // says the time. Only the presentation changed.
  const AV_MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];
  function avFmt12(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm == null ? '' : hhmm).trim());
    if (!m) return '';
    let h = Number(m[1]);
    if (!(h >= 0 && h <= 23)) return '';
    const ap = h < 12 ? 'AM' : 'PM';
    h %= 12; if (h === 0) h = 12;
    return `${h}:${m[2]} ${ap}`;
  }
  function avRange12(from, to) {
    const a = avFmt12(from), b = avFmt12(to);
    return a && b ? `${a} – ${b}` : (a || b || '');
  }

  // Date maths in UTC on the string, matching weekStartOf on the server. Doing
  // it in local time is how a Sunday-night lookup lands in the wrong week.
  function avAddDays(dateStr, n) {
    const d = new Date(String(dateStr) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function avDayIndex(dateStr) {          // 0 = Monday … 6 = Sunday, as days[] is stored
    const d = new Date(String(dateStr) + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : (d.getUTCDay() + 6) % 7;
  }
  function avWeekOf(dateStr) {
    const i = avDayIndex(dateStr);
    return i == null ? null : avAddDays(dateStr, -i);
  }
  function avTodayStr() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }

  let _week = null;       // 'YYYY-MM-DD' Monday currently shown
  let _board = null;      // last fetched { week, members }
  const _weeks = new Map();   // weekStart -> { week, members }, for date lookups

  // One fetch per week, cached — a task form asks about a date, not a week.
  async function avLoadWeek(weekStr) {
    if (!weekStr) return null;
    if (_weeks.has(weekStr)) return _weeks.get(weekStr);
    if (!aCan('view')) return null;
    let d = null;
    try { d = await aFetch('/api/dashboard/availability?week=' + encodeURIComponent(weekStr)).then(r => r.json()); }
    catch (_) {}
    if (!d || !Array.isArray(d.members)) return null;
    _weeks.set(d.week || weekStr, d);
    return _weeks.get(d.week || weekStr);
  }

  // The member's entry for one calendar date, or null when they have not set
  // that week. Null means UNKNOWN, and unknown must never block anything.
  async function avDayFor(memberKey, dateStr) {
    const wk = await avLoadWeek(avWeekOf(dateStr));
    if (!wk) return null;
    const m = wk.members.find(x => x.key === memberKey);
    if (!m || !Array.isArray(m.days)) return null;
    return m.days[avDayIndex(dateStr)] || null;
  }
  function avName(memberKey) {
    for (const wk of _weeks.values()) {
      const m = wk.members.find(x => x.key === memberKey);
      if (m) return m.name;
    }
    return memberKey;
  }
  const avIsOff = day => !!day && day.status === 'off';

  // What each assignee's day looks like: [{ key, name, day, off, known, label }].
  async function avReportFor(memberKeys, dateStr) {
    if (!dateStr || !avWeekOf(dateStr)) return [];
    const out = [];
    for (const key of memberKeys || []) {
      const day = await avDayFor(key, dateStr);
      const known = !!day;
      const hours = day && day.status !== 'off' ? avRange12(day.from, day.to) : '';
      out.push({
        key, name: avName(key), day, known, off: avIsOff(day),
        label: !known ? 'has not set this week'
          : day.status === 'off' ? 'off'
          : `${day.status === 'partial' ? 'partly free' : 'works'}${hours ? ' ' + hours : ''}`,
      });
    }
    return out;
  }

  // The soonest date on/after `fromDateStr`, within `span` days, that no
  // assignee has marked off. Members who never set a week do not count as off,
  // so a team that ignores the board keeps the date it typed.
  async function avNextWorkingDay(memberKeys, fromDateStr, span) {
    const days = Math.max(1, span || 14);
    for (let i = 0; i < days; i++) {
      const d = avAddDays(fromDateStr, i);
      if (!d) return null;
      let ok = true;
      for (const key of memberKeys || []) {
        if (avIsOff(await avDayFor(key, d))) { ok = false; break; }
      }
      if (ok) return d;
    }
    return null;
  }

  function avDayLabel(dateStr) {
    const d = new Date(String(dateStr) + 'T00:00:00Z');
    return isNaN(d.getTime()) ? String(dateStr)
      : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  // The panel a task form shows under its due date. Warns, offers the move, and
  // never changes the date itself — `moveCall` is the caller's onclick.
  async function avWarnHtml(rows, memberKeys, dueStr, moveCall) {
    const known = (rows || []).filter(r => r.known);
    if (!known.length) return '';                 // nobody has set that week
    const off = known.filter(r => r.off);
    const one = r => `<span class="t-av-one${r.off ? ' off' : ''}"><i></i>${esc(r.name)} — ${esc(r.label)}</span>`;
    const list = `<div class="t-av-list">${known.map(one).join('')}</div>`;
    if (!off.length) return `<div class="t-avail-box">${list}</div>`;
    const move = await avNextWorkingDay(memberKeys, dueStr, 14);
    const names = off.map(r => r.name).join(' and ');
    return `<div class="t-avail-box warn">
      <div class="t-av-head"><i data-lucide="alert-triangle"></i>${esc(names)} ${off.length > 1 ? 'are' : 'is'} off on ${esc(avDayLabel(dueStr))}.</div>
      ${list}
      ${move && move !== dueStr ? `<button type="button" class="t-av-move" onclick="${moveCall}('${move}')">Move to ${esc(avDayLabel(move))}</button>` : ''}
      <span class="t-av-note">You can save it anyway.</span>
    </div>`;
  }

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
    const span = avRange12(day.from, day.to);
    const hours = day.status !== 'off' && span ? span : meta.label;
    const title = [meta.label, span, day.note || ''].filter(Boolean).join(' · ');
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
    _weeks.set(d.week, d);   // the task forms read dates out of the same cache
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
    // <input type="time"> renders 12h or 24h purely by browser locale and cannot
    // be told otherwise, so the hour is picked in three parts and the 24h value
    // the server wants is kept in a hidden input beside them.
    const timeCell = (kind, value, off) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
      const h24 = m ? Number(m[1]) : (kind === 'from' ? 10 : 18);
      const mm = m ? m[2] : '00';
      const ap = h24 < 12 ? 'AM' : 'PM';
      const h12 = (h24 % 12) || 12;
      const mins = AV_MINUTES.includes(mm) ? AV_MINUTES : [...AV_MINUTES, mm].sort();
      const dis = off ? ' disabled' : '';
      const hh = Array.from({ length: 12 }, (_, k) => k + 1)
        .map(h => `<option value="${h}"${h === h12 ? ' selected' : ''}>${h}</option>`).join('');
      return `<span class="av-t">
        <select class="form-control av-time av-h" onchange="avSyncTime(this)"${dis}>${hh}</select>
        <span class="av-colon">:</span>
        <select class="form-control av-time av-m" onchange="avSyncTime(this)"${dis}>${mins.map(v => `<option value="${v}"${v === mm ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <select class="form-control av-time av-ap" onchange="avSyncTime(this)"${dis}>${['AM', 'PM'].map(v => `<option value="${v}"${v === ap ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <input type="hidden" class="av-${kind}" value="${esc(m ? `${String(h24).padStart(2, '0')}:${mm}` : '')}">
      </span>`;
    };
    const row = (i) => {
      const d = (mine && mine[i]) || { status: 'available', from: '10:00', to: '18:00' };
      const dd = new Date(monday); dd.setDate(dd.getDate() + i);
      const off = d.status === 'off';
      return `<div class="av-row">
        <div class="av-day">${DAY_NAMES[i]} <span style="color:var(--muted);font-weight:400">${dd.getDate()}</span></div>
        <select class="form-control av-status" data-i="${i}" onchange="avStatusChange(this)">
          ${Object.entries(STATUS_META).map(([k, v]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        ${timeCell('from', d.from, off)}
        ${timeCell('to', d.to, off)}
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

  // Fold the three pickers back into the hidden 24h value the server stores.
  function avSyncTime(el) {
    const box = el.closest('.av-t');
    if (!box) return;
    const h = Number(box.querySelector('.av-h').value) % 12;
    const ap = box.querySelector('.av-ap').value;
    const h24 = ap === 'PM' ? h + 12 : h;
    box.querySelector('input[type=hidden]').value =
      `${String(h24).padStart(2, '0')}:${box.querySelector('.av-m').value}`;
  }
  function avStatusChange(sel) {
    const off = sel.value === 'off';
    sel.closest('.av-row').querySelectorAll('.av-time').forEach(x => { x.disabled = off; });
  }

  async function saveAvailability() {
    // A row the user never touched has a hidden value already; one they did is
    // synced on change. Sync all of them anyway so a stuck picker cannot lie.
    document.querySelectorAll('.av-t').forEach(box => {
      const hidden = box.querySelector('input[type=hidden]');
      if (hidden && !hidden.value) avSyncTime(box.querySelector('.av-h'));
    });
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
    _weeks.delete(_week);   // the task forms must not keep reading the old week
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

  Object.assign(window, {
    renderAvailabilityBoard, openAvailabilityEditor, saveAvailability, availabilityToday,
    avSyncTime, avStatusChange,
    // Read by the task forms in both portals.
    avFmt12, avRange12, avAddDays, avDayIndex, avWeekOf, avTodayStr,
    avLoadWeek, avDayFor, avReportFor, avNextWorkingDay, avDayLabel, avWarnHtml,
  });
})();
