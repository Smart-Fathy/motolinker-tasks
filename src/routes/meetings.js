// Scheduled meetings. src/ctx.js explains the context object.
//
// Until this existed, "Meet" was a link launcher: meet.google.com in a new tab,
// no record, nothing on anyone's calendar. A meeting is a row now — title, when,
// how long, who — and lands on every attendee's Google Calendar through the same
// machinery tasks use: attendees who connected their own calendar get the event
// written directly; everyone else is invited from the company account, which
// also mints the Google Meet link (conferenceDataVersion=1) when none is given.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Provided by other modules, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);
const createNotification = (...a) => ctx.createNotification(...a);
const getEmployeeCalendarToken = (...a) => ctx.getEmployeeCalendarToken(...a);
const getCalendarToken = (...a) => ctx.getCalendarToken(...a);
const upsertCalendarEvent = (...a) => ctx.upsertCalendarEvent(...a);

function meetingBuildRow(b) {
  const title = String((b && b.title) || '').trim();
  if (!title) return { error: 'Title is required' };
  const starts = new Date((b && b.starts_at) || '');
  if (isNaN(starts.getTime())) return { error: 'A valid start time is required' };
  return { row: {
    title,
    description: String(b.description || '').trim(),
    starts_at: starts.toISOString(),
    duration_min: Math.min(480, Math.max(5, parseInt(b.duration_min) || 30)),
    attendee_ids: (Array.isArray(b.attendee_ids) ? b.attendee_ids : []).map(String).filter(Boolean),
    meet_link: String(b.meet_link || '').trim(),
  } };
}

function meetingEventBody(m, attendees, withMeetLink) {
  const start = new Date(m.starts_at);
  const end = new Date(start.getTime() + (m.duration_min || 30) * 60000);
  const body = {
    summary: m.title,
    description: [m.description || '', m.meet_link ? `Meet: ${m.meet_link}` : ''].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
  if (attendees && attendees.length) body.attendees = attendees;
  if (withMeetLink) {
    body.conferenceData = { createRequest: { requestId: 'ml-meet-' + m.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return body;
}

// Same shape as syncTaskToCalendar: personal events for connected attendees,
// one company invite for the rest, ids tracked per target so a reschedule
// patches instead of duplicating.
async function syncMeetingToCalendar(meeting) {
  try {
    const ids = (meeting.attendee_ids || []).map(Number).filter(n => !isNaN(n));
    const { data: emps } = ids.length
      ? await supabase.from('employees').select('id,name,email').in('id', ids)
      : { data: [] };
    const prior = (meeting.calendar_events && typeof meeting.calendar_events === 'object') ? { ...meeting.calendar_events } : {};
    const next = { ...prior };
    let changed = false;
    let meetLink = meeting.meet_link || '';

    // The company event goes FIRST when we need Google to mint the Meet link,
    // so the personal events can carry it in their description.
    const inviteesAll = (emps || []).filter(e => e.email).map(e => ({ email: e.email }));
    const companyToken = await getCalendarToken();
    if (companyToken) {
      const wantLink = !meetLink;
      const url = next.company
        ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(next.company)}?sendUpdates=all&conferenceDataVersion=1`
        : 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1';
      const r = await fetch(url, {
        method: next.company ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${companyToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(meetingEventBody({ ...meeting, meet_link: meetLink }, inviteesAll, wantLink)),
      });
      const ev = await r.json();
      if (r.ok) {
        if (next.company !== ev.id) { next.company = ev.id; changed = true; }
        if (!meetLink && ev.hangoutLink) { meetLink = ev.hangoutLink; changed = true; }
      } else if (next.company && (r.status === 404 || r.status === 410)) {
        delete next.company; changed = true;
      } else if (!r.ok) {
        console.warn('[meetings] company event failed:', ev.error && ev.error.message);
      }
    }

    // Personal calendars for attendees who connected their own.
    for (const emp of emps || []) {
      try {
        const token = await getEmployeeCalendarToken(emp.id);
        if (!token) continue;
        const key = String(emp.id);
        const r = await upsertCalendarEvent(token, meetingEventBody({ ...meeting, meet_link: meetLink }, null, false), next[key], false);
        if (r && r.gone) { delete next[key]; changed = true; continue; }
        if (r && next[key] !== r.id) { next[key] = r.id; changed = true; }
      } catch (e) { console.warn('[meetings] employee', emp.id, 'sync failed:', e.message); }
    }

    if (changed || meetLink !== (meeting.meet_link || '')) {
      await supabase.from('meetings')
        .update({ calendar_events: next, meet_link: meetLink })
        .eq('id', meeting.id);
    }
    return { calendar_events: next, meet_link: meetLink };
  } catch (e) {
    console.warn('[meetings] sync error:', e.message);
    return null;
  }
}

async function deleteMeetingEvents(meeting) {
  const evs = (meeting.calendar_events && typeof meeting.calendar_events === 'object') ? meeting.calendar_events : {};
  for (const [key, evId] of Object.entries(evs)) {
    try {
      const token = key === 'company' ? await getCalendarToken() : await getEmployeeCalendarToken(Number(key));
      if (token) await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(evId)}${key === 'company' ? '?sendUpdates=all' : ''}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    } catch (_) {}
  }
}

function notifyAttendees(meeting, who) {
  for (const id of meeting.attendee_ids || []) {
    if (`employee_${id}` === who.key) continue;   // not yourself
    createNotification(`employee_${id}`, {
      type: 'task',
      title: `${who.name} scheduled a meeting`,
      body: `${meeting.title} — ${new Date(meeting.starts_at).toLocaleString()}`,
      url: '/employee#meet',
    }, 'always');
  }
}

// Mounted for both portals over one set of handlers — see contracts.js for why.
function mountMeetingRoutes(base, guard) {
  receiver.router.get(base, guard, requirePerm('meet', 'view'), async (_req, res) => {
    // Upcoming plus the recent past, so a meeting that just ended is still visible.
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const { data, error } = await supabase.from('meetings')
      .select('*').gte('starts_at', since).order('starts_at', { ascending: true }).limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  receiver.router.post(base, guard, requirePerm('meet', 'schedule'), express.json(), async (req, res) => {
    const { row, error: verr } = meetingBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    const who = callerIdentity(req);
    row.created_by = who.key;
    const { data, error } = await supabase.from('meetings').insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
    // Calendar + notifications ride behind the response — nothing to wait for.
    syncMeetingToCalendar(data).then(() => {}, () => {});
    notifyAttendees(data, who);
  });

  receiver.router.put(`${base}/:id`, guard, requirePerm('meet', 'schedule'), express.json(), async (req, res) => {
    const { row, error: verr } = meetingBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    const { data, error } = await supabase.from('meetings').update(row).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
    syncMeetingToCalendar(data).then(() => {}, () => {});
  });

  receiver.router.delete(`${base}/:id`, guard, requirePerm('meet', 'schedule'), async (req, res) => {
    const { data: meeting } = await supabase.from('meetings').select('*').eq('id', req.params.id).single();
    const { error } = await supabase.from('meetings').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
    if (meeting) deleteMeetingEvents(meeting);
  });
}
mountMeetingRoutes('/api/dashboard/meetings', requireAuth);
mountMeetingRoutes('/api/employee/meetings', requireEmployeeAuth);

module.exports = { meetingBuildRow, syncMeetingToCalendar };
