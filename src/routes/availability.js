// Weekly availability. src/ctx.js explains the context object.
//
// Everyone sets their own week (per day: available with hours, partial, or off)
// and everyone with the permission sees the whole team's — that visibility is
// the feature's entire point, so the section defaults ON.
//
// The one security property that matters here: the PUT writes only the
// CALLER's row. member_key is derived from the session server-side and never
// read from the body, so nobody can mark a colleague "off" for the week.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const requirePerm = (...a) => ctx.requirePerm(...a);
const callerIdentity = (...a) => ctx.callerIdentity(...a);

const DAY_STATUSES = ['available', 'partial', 'off'];
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

// Normalize any date to its week's Monday, as YYYY-MM-DD.
function weekStartOf(input) {
  const d = input ? new Date(input) : new Date();
  if (isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7;   // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function sanitizeDays(days) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = (Array.isArray(days) && days[i]) || {};
    const entry = { status: DAY_STATUSES.includes(d.status) ? d.status : 'off' };
    if (typeof d.from === 'string' && TIME_RE.test(d.from)) entry.from = d.from;
    if (typeof d.to === 'string' && TIME_RE.test(d.to)) entry.to = d.to;
    if (typeof d.note === 'string' && d.note.trim()) entry.note = d.note.trim().slice(0, 120);
    out.push(entry);
  }
  return out;
}

// ── Reading someone else's week, for the schedulers ──────────────────────────
// days[] is indexed 0 = Monday (weekStartOf normalises to Monday), while the
// recurring engine speaks JS weekdays where 0 = Sunday. Every conversion in the
// app goes through dayIndexOf so the two numbering schemes meet in one place.
function dayIndexOf(dateStr) {
  const d = new Date(String(dateStr) + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : (d.getUTCDay() + 6) % 7;   // 0 = Monday
}
function addDaysUTC(dateStr, n) {
  const d = new Date(String(dateStr) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Every member's entry for the given dates, as Map<'key|date', dayObject>.
// A member who never set that week simply has no entry — unknown, not off.
async function availabilityDays(memberKeys, dateStrs) {
  const out = new Map();
  const keys = [...new Set((memberKeys || []).filter(Boolean).map(String))];
  const dates = [...new Set((dateStrs || []).filter(Boolean))];
  if (!keys.length || !dates.length) return out;
  const weeks = [...new Set(dates.map(d => weekStartOf(d)).filter(Boolean))];
  const { data, error } = await supabase.from('availability_weeks')
    .select('member_key,week_start,days').in('member_key', keys).in('week_start', weeks);
  if (error) return out;                       // unreadable == unknown, never a block
  const byKeyWeek = new Map((data || []).map(r => [`${r.member_key}|${r.week_start}`, r.days]));
  for (const key of keys) {
    for (const date of dates) {
      const days = byKeyWeek.get(`${key}|${weekStartOf(date)}`);
      const i = dayIndexOf(date);
      const day = Array.isArray(days) && i != null ? days[i] : null;
      if (day) out.set(`${key}|${date}`, day);
    }
  }
  return out;
}

// The soonest date on/after `fromDate`, within `span` days, that nobody has
// marked off. Returns fromDate unchanged when nothing is known — availability
// informs the schedule, it never withholds the work.
async function nextWorkingDay(memberKeys, fromDate, span) {
  const days = Math.max(1, span || 14);
  const dates = [];
  for (let i = 0; i < days; i++) { const d = addDaysUTC(fromDate, i); if (d) dates.push(d); }
  if (!dates.length) return fromDate;
  const map = await availabilityDays(memberKeys, dates);
  if (!map.size) return fromDate;
  for (const date of dates) {
    const off = (memberKeys || []).some(k => (map.get(`${k}|${date}`) || {}).status === 'off');
    if (!off) return date;
  }
  return fromDate;                             // everyone is off all fortnight
}

ctx.availabilityDays = availabilityDays;
ctx.availabilityNextWorkingDay = nextWorkingDay;

function mountAvailabilityRoutes(base, guard) {
  // The whole team's week, joined with names so the board renders in one call.
  receiver.router.get(base, guard, requirePerm('availability', 'view'), async (req, res) => {
    const week = weekStartOf(req.query.week);
    if (!week) return res.status(400).json({ error: 'Bad week' });
    const [{ data: rows, error }, { data: emps }] = await Promise.all([
      supabase.from('availability_weeks').select('*').eq('week_start', week),
      supabase.from('employees').select('id,name,avatar_url'),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    const byKey = new Map((rows || []).map(r => [r.member_key, r]));
    const me = callerIdentity(req).key;
    const members = [
      { key: 'admin', name: 'Admin', avatar_url: null },
      ...(emps || []).map(e => ({ key: `employee_${e.id}`, name: e.name, avatar_url: e.avatar_url })),
    ].map(m => ({ ...m, me: m.key === me, days: (byKey.get(m.key) || {}).days || null }));
    res.json({ week, members });
  });

  receiver.router.put(base, guard, requirePerm('availability', 'set'), express.json(), async (req, res) => {
    const week = weekStartOf(req.body && req.body.week);
    if (!week) return res.status(400).json({ error: 'Bad week' });
    const me = callerIdentity(req).key;   // never from the body
    const days = sanitizeDays(req.body && req.body.days);
    const { error } = await supabase.from('availability_weeks')
      .upsert({ member_key: me, week_start: week, days, updated_at: new Date().toISOString() },
        { onConflict: 'member_key,week_start' });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, week, days });
  });
}
mountAvailabilityRoutes('/api/dashboard/availability', requireAuth);
mountAvailabilityRoutes('/api/employee/availability', requireEmployeeAuth);

module.exports = { weekStartOf, sanitizeDays, dayIndexOf, addDaysUTC, availabilityDays, nextWorkingDay };
