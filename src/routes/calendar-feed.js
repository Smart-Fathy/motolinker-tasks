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
//
// The rules are in src/modules/calendar (the service /api/v1/calendar uses as well). These are the routes the classic pages
// call, over one handler mounted for both portals, answering as they always have: the one 400, and a source the database
// cannot read as an empty source.
const ctx = require('../ctx');
const { receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need(
  'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const { createCalendarService, CalendarInvalid } = require('../modules/calendar');

const calendar = createCalendarService({
  supabase,
  // Provided by another module, so resolved through the context rather than captured at require time — load order between
  // feature modules is not fixed.
  fetchEmployeeTasks: (...a) => ctx.fetchEmployeeTasks(...a),
});

function mountCalendarFeed(base, guard) {
  receiver.router.get(`${base}/calendar`, guard, async (req, res) => {
    try {
      res.json((await calendar.feed(req.actor, req.query || {})).feed);
    } catch (e) {
      if (e instanceof CalendarInvalid) return res.status(400).json({ error: e.message });
      res.status(500).json({ error: e.message });
    }
  });
}
mountCalendarFeed('/api/dashboard', requireAuth);
mountCalendarFeed('/api/employee', requireEmployeeAuth);

module.exports = {};
