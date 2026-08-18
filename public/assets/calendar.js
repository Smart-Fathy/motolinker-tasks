// The calendar — MotoLinker's own, in both portals.
//
// What was here before was an <iframe> of Google's public embed: it showed
// whatever calendar the browser was signed into and knew nothing about this
// company. Assign somebody a task with a due date and it did not appear.
// Schedule a meeting through the platform and it did not appear. It could not
// have — the page never asked the server for anything.
//
// This asks. One month or week at a time, from /calendar, drawn as a grid:
//   • meetings   — with Join, either a Meet link or an in-app huddle
//   • tasks      — on their due date, overdue ones marked
//   • follow-ups — the leads a person owes a call
//
// Wired through CALCFG so each portal supplies its own API base and abilities:
//   CALCFG = { base, fetch, can(section, action), toast, openTask, openLead }
(function () {
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const CAL = () => (typeof CALCFG !== 'undefined' ? CALCFG : null);
  const can = (sec, act) => { const c = CAL(); return !c || !c.can || c.can(sec, act); };

  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfWeek = d => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const sameDay = (a, b) => dayKey(a) === dayKey(b);
  const hhmm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // An in-app huddle is stored in the meeting's link field as huddle:<roomId>.
  // The alternative was a migration for one boolean; this keeps "where do I join"
  // in the single field that already answers that question.
  const HUDDLE = /^huddle:(\d+)$/;
  const huddleRoom = m => { const x = HUDDLE.exec(String(m.meet_link || '')); return x ? Number(x[1]) : null; };

  let _cal = { view: 'month', cursor: new Date(), data: { tasks: [], meetings: [], followups: [] }, loading: false };

  function calRange() {
    if (_cal.view === 'week') {
      const from = startOfWeek(_cal.cursor);
      return { from, to: addDays(from, 6) };
    }
    const first = new Date(_cal.cursor.getFullYear(), _cal.cursor.getMonth(), 1);
    const last = new Date(_cal.cursor.getFullYear(), _cal.cursor.getMonth() + 1, 0);
    return { from: startOfWeek(first), to: addDays(startOfWeek(last), 6) };
  }

  async function loadCalendar() {
    const host = document.getElementById('ml-calendar');
    if (!host) return;
    const { from, to } = calRange();
    _cal.loading = true;
    renderCalendar();
    try {
      const c = CAL();
      const r = await c.fetch(`${c.base}/calendar?from=${dayKey(from)}&to=${dayKey(to)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load the calendar.');
      _cal.data = { tasks: d.tasks || [], meetings: d.meetings || [], followups: d.followups || [] };
    } catch (e) {
      _cal.data = { tasks: [], meetings: [], followups: [], error: e.message };
    }
    _cal.loading = false;
    renderCalendar();
  }

  // Everything on one day, in the order it happens. Tasks and follow-ups without
  // a time sort to the end of the day rather than pretending to be at midnight.
  function itemsOn(d) {
    const key = dayKey(d);
    const out = [];
    _cal.data.meetings.forEach(m => {
      const t = new Date(m.starts_at);
      if (dayKey(t) === key) out.push({ kind: 'meeting', at: t, sort: t.getTime(), m });
    });
    _cal.data.followups.forEach(f => {
      const t = new Date(f.due_at);
      if (dayKey(t) === key) out.push({ kind: 'followup', at: t, sort: t.getTime(), f });
    });
    _cal.data.tasks.forEach(t => {
      if (t.due_date === key) out.push({ kind: 'task', at: null, sort: 8.64e15, t });
    });
    return out.sort((a, b) => a.sort - b.sort);
  }

  function chipHtml(it) {
    if (it.kind === 'meeting') {
      const room = huddleRoom(it.m);
      return `<button class="cal-chip cal-meeting" onclick="calOpen('meeting',${it.m.id})" title="${esc(it.m.title)}">
        <i data-lucide="${room ? 'radio' : 'video'}" style="width:11px;height:11px"></i>
        <span class="cal-chip-t">${esc(hhmm(it.at))}</span> ${esc(it.m.title)}</button>`;
    }
    if (it.kind === 'followup') {
      return `<button class="cal-chip cal-followup" onclick="calOpen('followup',${it.f.id})" title="${esc(it.f.note || 'Follow up')}">
        <i data-lucide="phone-call" style="width:11px;height:11px"></i>
        <span class="cal-chip-t">${esc(hhmm(it.at))}</span> ${esc(it.f.customer_name || 'Follow-up')}</button>`;
    }
    const overdue = it.t.status !== 'done' && it.t.due_date < dayKey(new Date());
    return `<button class="cal-chip cal-task${overdue ? ' overdue' : ''}${it.t.status === 'done' ? ' done' : ''}"
      onclick="calOpen('task',${it.t.id})" title="${esc(it.t.title)}">
      <i data-lucide="${it.t.status === 'done' ? 'check-circle-2' : 'circle-dot'}" style="width:11px;height:11px"></i>
      ${esc(it.t.title)}</button>`;
  }

  function renderCalendar() {
    const host = document.getElementById('ml-calendar');
    if (!host) return;
    const { from, to } = calRange();
    const today = new Date();
    const title = _cal.view === 'week'
      ? `${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : _cal.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const days = [];
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) days.push(new Date(d));
    const counts = { meeting: 0, task: 0, followup: 0 };
    days.forEach(d => itemsOn(d).forEach(i => { counts[i.kind]++; }));

    host.innerHTML = `
      <div class="cal-bar">
        <button class="cal-nav" onclick="calToday()">Today</button>
        <button class="cal-nav cal-arrow" onclick="calStep(-1)" aria-label="Previous">&lsaquo;</button>
        <button class="cal-nav cal-arrow" onclick="calStep(1)" aria-label="Next">&rsaquo;</button>
        <div class="cal-title">${esc(title)}</div>
        <div class="cal-legend">
          <span class="cal-key cal-meeting">${counts.meeting} meeting${counts.meeting === 1 ? '' : 's'}</span>
          <span class="cal-key cal-task">${counts.task} task${counts.task === 1 ? '' : 's'}</span>
          <span class="cal-key cal-followup">${counts.followup} follow-up${counts.followup === 1 ? '' : 's'}</span>
        </div>
        <div class="cal-views">
          <button class="cal-view${_cal.view === 'month' ? ' on' : ''}" onclick="calView('month')">Month</button>
          <button class="cal-view${_cal.view === 'week' ? ' on' : ''}" onclick="calView('week')">Week</button>
        </div>
        ${can('meet', 'schedule') ? `<button class="btn btn-primary btn-sm" onclick="calNewEvent()">
          <i data-lucide="plus" style="width:14px;height:14px"></i> New event</button>` : ''}
      </div>
      ${_cal.data.error ? `<div class="error-msg" style="display:block;margin:12px 0">${esc(_cal.data.error)}</div>` : ''}
      <div class="cal-grid ${_cal.view}">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
        ${days.map(d => {
          const items = itemsOn(d);
          const other = _cal.view === 'month' && d.getMonth() !== _cal.cursor.getMonth();
          const show = _cal.view === 'week' ? items : items.slice(0, 3);
          return `<div class="cal-day${other ? ' other' : ''}${sameDay(d, today) ? ' today' : ''}"
            ondblclick="calNewEvent('${dayKey(d)}')" title="Double-click to schedule">
            <div class="cal-daynum">${d.getDate()}</div>
            <div class="cal-items">${show.map(chipHtml).join('')}
              ${items.length > show.length ? `<button class="cal-more" onclick="calDay('${dayKey(d)}')">+${items.length - show.length} more</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
      ${_cal.loading ? '<div class="cal-loading"><span class="spinner"></span> Loading…</div>' : ''}`;
    if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
  }

  function calView(v) { _cal.view = v; loadCalendar(); }
  function calToday() { _cal.cursor = new Date(); loadCalendar(); }
  function calStep(n) {
    _cal.cursor = _cal.view === 'week'
      ? addDays(_cal.cursor, 7 * n)
      : new Date(_cal.cursor.getFullYear(), _cal.cursor.getMonth() + n, 1);
    loadCalendar();
  }

  // One day, everything on it — what "+2 more" opens, and what a person actually
  // wants when a day is busy.
  function calDay(key) {
    const c = CAL();
    const d = new Date(key + 'T12:00:00');
    const items = itemsOn(d);
    c.modal(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      items.length
        ? `<div class="cal-daylist">${items.map(it => `<div class="cal-dayrow">${chipHtml(it)}</div>`).join('')}</div>`
        : '<div style="color:var(--muted);font-size:13px">Nothing scheduled.</div>',
      `${can('meet', 'schedule') ? `<button class="btn btn-primary" onclick="calNewEvent('${esc(key)}')">Schedule something</button>` : ''}
       <button class="btn btn-outline" onclick="CALCFG.closeModal()">Close</button>`);
    if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
  }

  function calOpen(kind, id) {
    const c = CAL();
    if (kind === 'task') return c.openTask ? c.openTask(id) : null;
    if (kind === 'followup') {
      const f = _cal.data.followups.find(x => x.id === id);
      return f && c.openLead ? c.openLead(f.customer_id) : null;
    }
    const m = _cal.data.meetings.find(x => x.id === id);
    if (!m) return;
    const room = huddleRoom(m);
    const t = new Date(m.starts_at);
    c.modal(m.title, `
      <div style="font-size:13px;display:grid;gap:8px">
        <div><strong>${esc(t.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</strong>
          · ${m.duration_min} min · ${(m.attendee_ids || []).length} attendee(s)</div>
        ${m.description ? `<div style="white-space:pre-wrap;color:var(--muted)">${esc(m.description)}</div>` : ''}
        ${room ? '<div style="color:var(--muted)">Joins the in-app huddle — audio in MotoLinker, no Google account needed.</div>' : ''}
      </div>`,
      `${room
        ? `<button class="btn btn-primary" onclick="CALCFG.closeModal();calJoinHuddle(${room})"><i data-lucide="radio" style="width:14px;height:14px"></i> Join huddle</button>`
        : (m.meet_link ? `<a class="btn btn-primary" href="${esc(m.meet_link)}" target="_blank" rel="noopener">Join</a>` : '')}
       ${can('meet', 'schedule') ? `<button class="btn btn-outline" onclick="CALCFG.closeModal();openMeetingForm(${m.id})">Edit</button>` : ''}
       <button class="btn btn-outline" onclick="CALCFG.closeModal()">Close</button>`);
    if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
  }

  function calJoinHuddle(roomId) {
    if (typeof huddleJoinExisting === 'function') return huddleJoinExisting(roomId);
    CAL().toast('Huddles are not available here.');
  }

  // Scheduling goes through the meetings module — one scheduler, which already
  // syncs to everyone's Google Calendar and notifies the attendees.
  function calNewEvent(dayStr) {
    if (!can('meet', 'schedule')) return;
    if (typeof openMeetingForm !== 'function') return CAL().toast('Scheduling is not available here.');
    openMeetingForm(null, dayStr ? { date: dayStr } : null);
    // Re-read the month once the sheet closes, whatever it did.
    const seen = setInterval(() => {
      if (!document.getElementById('mt-title')) { clearInterval(seen); loadCalendar(); }
    }, 700);
    setTimeout(() => clearInterval(seen), 120000);
  }

  Object.assign(window, { loadCalendar, renderCalendar, calView, calToday, calStep, calDay, calOpen,
                          calNewEvent, calJoinHuddle });
})();
