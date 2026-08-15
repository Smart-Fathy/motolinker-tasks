// Scheduled meetings — the Meet page's list + scheduling sheet, both portals.
//
// Consumes PROCFG like the other shared modules. Drawing the Schedule button is
// gated on meet.schedule (the server refuses without it regardless); the list
// needs meet.view. The admin passes both by construction.
(function () {
  function mPath(url) {
    return PROCFG.base === '/api/dashboard' ? url : url.replace(/^\/api\/dashboard/, PROCFG.base);
  }
  const mFetch = (url, opts) => PROCFG.fetch(mPath(url), opts);
  const mCan = (a) => !PROCFG.can || PROCFG.can('meet', a);

  let _meetings = [];

  async function loadMeetings() {
    const box = document.getElementById('meet-meetings');
    if (!box) return;
    if (!mCan('view')) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="loading"><span class="spinner"></span> Loading meetings…</div>';
    let list = [];
    try { list = await mFetch('/api/dashboard/meetings').then(r => r.json()); } catch (_) {}
    _meetings = Array.isArray(list) ? list : [];
    const scheduleBtn = mCan('schedule')
      ? `<button class="btn btn-primary btn-sm" onclick="openMeetingForm(null)"><i data-lucide="calendar-plus" style="width:14px;height:14px"></i> Schedule a meeting</button>`
      : '';
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 10px">
        <div style="font-weight:700;font-size:14px">Upcoming meetings</div>
        ${scheduleBtn}
      </div>
      ${!_meetings.length
        ? '<div style="color:var(--muted);font-size:12.5px;padding:14px 0">Nothing scheduled. A scheduled meeting lands on every attendee\'s Google Calendar automatically.</div>'
        : `<div style="display:grid;gap:8px">${_meetings.map(m => {
            const t = new Date(m.starts_at);
            const mine = mCan('schedule');
            return `<div style="display:flex;align-items:center;gap:10px 12px;flex-wrap:wrap;padding:11px 14px;background:var(--card,var(--surface));border:1px solid var(--border);border-radius:10px">
              <div style="text-align:center;min-width:52px">
                <div style="font-size:11px;color:var(--muted);text-transform:uppercase">${t.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div style="font-size:16px;font-weight:700">${t.getDate()}</div>
              </div>
              <div style="flex:1;min-width:140px">
                <div style="font-weight:600;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.title)}</div>
                <div style="font-size:12px;color:var(--muted)">${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${m.duration_min} min · ${(m.attendee_ids || []).length} attendee(s)</div>
              </div>
              ${m.meet_link ? `<a class="btn btn-primary btn-sm" href="${esc(m.meet_link)}" target="_blank" rel="noopener">Join</a>` : ''}
              ${mine ? `<button class="btn btn-outline btn-sm" onclick="openMeetingForm(${m.id})">Edit</button>
              <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="deleteMeeting(${m.id})">Cancel</button>` : ''}
            </div>`;
          }).join('')}</div>`}`;
    requestAnimationFrame(() => lucide.createIcons());
  }

  async function openMeetingForm(id) {
    const m = id ? _meetings.find(x => x.id === id) : null;
    let people = [];
    try { people = await MEETCFG.people(); } catch (_) {}
    const picked = new Set(((m && m.attendee_ids) || []).map(String));
    const start = m ? new Date(m.starts_at) : new Date(Date.now() + 3600e3);
    const pad = n => String(n).padStart(2, '0');
    const dateVal = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const timeVal = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    PROCFG.modal(m ? 'Edit meeting' : 'Schedule a meeting', `
      <div class="form-group"><label class="form-label">Title</label>
        <input class="form-control" id="mt-title" value="${esc(m ? m.title : '')}" placeholder="e.g. Weekly sales sync"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="form-group"><label class="form-label">Date</label><input class="form-control" id="mt-date" type="date" value="${dateVal}"></div>
        <div class="form-group"><label class="form-label">Time</label><input class="form-control" id="mt-time" type="time" value="${timeVal}"></div>
        <div class="form-group"><label class="form-label">Duration</label>
          <select class="form-control" id="mt-duration">
            ${[15, 30, 45, 60, 90, 120].map(d => `<option value="${d}" ${(m ? m.duration_min : 30) === d ? 'selected' : ''}>${d} min</option>`).join('')}
          </select></div>
      </div>
      <div class="form-group"><label class="form-label">Attendees</label>
        <div id="mt-attendees" style="display:flex;flex-wrap:wrap;gap:8px;max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:10px">
          ${people.map(p => `<label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;border:1px solid var(--border);border-radius:16px;padding:4px 10px">
            <input type="checkbox" class="mt-att" value="${p.id}" ${picked.has(String(p.id)) ? 'checked' : ''} style="accent-color:var(--primary)"> ${esc(p.name)}</label>`).join('')
          || '<span style="color:var(--muted);font-size:12px">No team members found</span>'}
        </div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:6px">
          Lands on each attendee's Google Calendar; anyone without a connected calendar is invited by email.
          Leave the link empty and a Google Meet link is created automatically.</div></div>
      <div class="form-group"><label class="form-label">Meet link (optional)</label>
        <input class="form-control" id="mt-link" value="${esc(m ? m.meet_link : '')}" placeholder="https://meet.google.com/…"></div>
      <div class="form-group"><label class="form-label">Notes</label>
        <textarea class="form-control" id="mt-desc" rows="2">${esc(m ? m.description : '')}</textarea></div>
      <div id="mt-err" class="error-msg" style="display:none"></div>`,
      `<button class="btn btn-outline" onclick="PROCFG.closeModal()">Cancel</button>
       <button class="btn btn-primary" onclick="saveMeeting(${id || 'null'})">${m ? 'Save & re-sync calendars' : 'Schedule'}</button>`);
  }

  async function saveMeeting(id) {
    const err = document.getElementById('mt-err');
    const g = x => (document.getElementById(x) || {}).value || '';
    const payload = {
      title: g('mt-title').trim(),
      starts_at: g('mt-date') && g('mt-time') ? new Date(`${g('mt-date')}T${g('mt-time')}`).toISOString() : '',
      duration_min: parseInt(g('mt-duration')) || 30,
      attendee_ids: [...document.querySelectorAll('.mt-att:checked')].map(c => c.value),
      meet_link: g('mt-link').trim(),
      description: g('mt-desc'),
    };
    if (!payload.title) { err.textContent = 'Title is required.'; err.style.display = 'block'; return; }
    if (!payload.starts_at) { err.textContent = 'Pick a date and time.'; err.style.display = 'block'; return; }
    const r = await mFetch(id ? `/api/dashboard/meetings/${id}` : '/api/dashboard/meetings',
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = d.error || 'Failed to save.'; err.style.display = 'block'; return; }
    PROCFG.closeModal();
    PROCFG.toast(id ? 'Meeting updated — calendars re-sync in the background.' : 'Scheduled — it lands on every attendee\'s calendar.');
    loadMeetings();
  }

  async function deleteMeeting(id) {
    if (!confirm('Cancel this meeting? Calendar events are removed for everyone.')) return;
    await mFetch(`/api/dashboard/meetings/${id}`, { method: 'DELETE' });
    loadMeetings();
  }

  Object.assign(window, { loadMeetings, openMeetingForm, saveMeeting, deleteMeeting });
})();
