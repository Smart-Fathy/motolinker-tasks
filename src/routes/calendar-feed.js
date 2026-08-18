// What is actually happening this week — from MotoLinker's own data.
//
// The Calendar page in both portals was an <iframe> pointing at Google's generic
// embed: whatever calendar the browser happened to be signed into, with nothing
// of this company in it. A task assigned with a due date did not appear. A
// meeting scheduled through the platform did not appear. The page could not have
// shown them — it never asked us for anything.
//
// So this is the ask: one endpoint, one window of time, everything a person is
// expected at. Tasks by due date, meetings they attend, and the lead follow-ups
// they are on the hook for. Scoped by portal — the admin sees the company's,
// an employee sees their own — and gated per source, so somebody without the
// tasks grant simply gets no tasks rather than a 403 for the whole page.
const ctx = require('../ctx');
const { receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need(
  'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const empCan = (...a) => ctx.empCan(...a);
const fetchEmployeeTasks = (...a) => ctx.fetchEmployeeTasks(...a);

// A day either side of the requested window: a month grid shows the tail of the
// previous month and the head of the next, and a meeting on those days is still
// a meeting the person has to be at.
function windowOf(q) {
  const from = new Date(q.from || Date.now());
  const to = new Date(q.to || Date.now() + 31 * 864e5);
  if (isNaN(from) || isNaN(to)) return null;
  return { from: new Date(from.getTime() - 864e5), to: new Date(to.getTime() + 864e5) };
}
const iso = d => d.toISOString();
const day = d => iso(d).slice(0, 10);

function mountCalendarFeed(base, guard) {
  receiver.router.get(`${base}/calendar`, guard, async (req, res) => {
    const w = windowOf(req.query || {});
    if (!w) return res.status(400).json({ error: 'from and to must be dates' });
    const emp = req.employee || null;
    const may = (section, action) => !emp || empCan(emp, section, action);
    const out = { from: day(w.from), to: day(w.to), tasks: [], meetings: [], followups: [] };

    // ── Tasks, by due date ────────────────────────────────────────────────────
    if (may('tasks', 'view')) {
      try {
        if (emp) {
          const all = await fetchEmployeeTasks(emp.id);
          out.tasks = (all || []).filter(t => t.due_date && t.due_date >= day(w.from) && t.due_date <= day(w.to));
        } else {
          const { data } = await supabase.from('tasks').select('*')
            .gte('due_date', day(w.from)).lte('due_date', day(w.to)).limit(500);
          out.tasks = data || [];
        }
      } catch (_) { out.tasks = []; }
      out.tasks = out.tasks.map(t => ({
        id: t.id, title: t.title, description: t.description || '', due_date: t.due_date,
        status: t.status, priority: t.priority, milestone: t.milestone || '',
        assignee_ids: t.assignee_ids || [], channel_name: t.channel_name || '',
      }));
    }

    // ── Meetings ──────────────────────────────────────────────────────────────
    if (may('meet', 'view')) {
      const { data } = await supabase.from('meetings').select('*')
        .gte('starts_at', iso(w.from)).lte('starts_at', iso(w.to))
        .order('starts_at', { ascending: true }).limit(300);
      // An employee sees the meetings they are in or booked, not the company's diary.
      out.meetings = (data || []).filter(m => !emp
        || (m.attendee_ids || []).map(String).includes(String(emp.id))
        || m.created_by === `employee_${emp.id}`);
    }

    // ── Lead follow-ups ───────────────────────────────────────────────────────
    if (may('leads', 'view')) {
      let q = supabase.from('lead_followups').select('*')
        .eq('status', 'pending').gte('due_at', iso(w.from)).lte('due_at', iso(w.to))
        .order('due_at', { ascending: true }).limit(300);
      if (emp) q = q.eq('assigned_to', emp.id);
      const { data } = await q;
      const rows = data || [];
      // One lookup for the names, rather than one per follow-up.
      const ids = [...new Set(rows.map(f => f.customer_id).filter(Boolean))];
      const names = {};
      if (ids.length) {
        const { data: cs } = await supabase.from('customers').select('id,name').in('id', ids);
        (cs || []).forEach(c => { names[c.id] = c.name; });
      }
      out.followups = rows.map(f => ({
        id: f.id, due_at: f.due_at, note: f.note || '', customer_id: f.customer_id,
        customer_name: names[f.customer_id] || '',
      }));
    }

    res.json(out);
  });
}
mountCalendarFeed('/api/dashboard', requireAuth);
mountCalendarFeed('/api/employee', requireEmployeeAuth);

module.exports = {};
