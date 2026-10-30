// Scheduled meetings on the two portals' classic routes: the Meet page's list, its scheduling sheet and its Cancel button.
// src/ctx.js explains the context object.
//
// Until this existed, "Meet" was a link launcher: meet.google.com in a new tab, no record, nothing on anyone's calendar. A
// meeting is a row now — title, when, how long, who — and lands on every attendee's Google Calendar: attendees who connected
// their own calendar get the event written directly; everyone else is invited from the company account, which also makes the
// Google Meet link when none is given.
//
// The rules are in src/modules/meetings (the service /api/v1/meetings uses as well, and the Google Calendar writing with it).
// These are the routes the classic pages call, over one set of handlers mounted for both portals, answering as they always have:
// the two 400s with their one-line messages, and a database's own words as a 500.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } = ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const { createMeetingsService, MeetingInvalid } = require('../modules/meetings');
// Provided by other modules, so resolved through the context rather than captured at require time — load order between
// feature modules is not fixed.
const requirePerm = (...a) => ctx.requirePerm(...a);

const meetings = createMeetingsService({
  supabase,
  notify: (...a) => ctx.createNotification(...a),
  getCalendarToken: (...a) => ctx.getCalendarToken(...a),
  getEmployeeCalendarToken: (...a) => ctx.getEmployeeCalendarToken(...a),
  upsertCalendarEvent: (...a) => ctx.upsertCalendarEvent(...a),
  fetch: (...a) => globalThis.fetch(...a),
});

/** What went wrong, as the classic pages have always been told. */
const problem = (res, e) => {
  if (e instanceof MeetingInvalid) return res.status(400).json({ error: e.message });
  res.status(500).json({ error: e.message });
};

// Mounted for both portals over one set of handlers — see contracts.js for why.
function mountMeetingRoutes(base, guard) {
  receiver.router.get(base, guard, requirePerm('meet', 'view'), async (_req, res) => {
    try {
      res.json(await meetings.list());
    } catch (e) { problem(res, e); }
  });

  receiver.router.post(base, guard, requirePerm('meet', 'schedule'), express.json(), async (req, res) => {
    try {
      const { meeting, behind } = await meetings.create(req.actor, req.body);
      res.json(meeting);
      // Calendar + notifications ride behind the response — nothing to wait for.
      behind();
    } catch (e) { problem(res, e); }
  });

  receiver.router.put(`${base}/:id`, guard, requirePerm('meet', 'schedule'), express.json(), async (req, res) => {
    try {
      const { meeting, behind } = await meetings.update(req.params.id, req.body);
      res.json(meeting);
      behind();
    } catch (e) { problem(res, e); }
  });

  receiver.router.delete(`${base}/:id`, guard, requirePerm('meet', 'schedule'), async (req, res) => {
    try {
      const { behind } = await meetings.remove(req.params.id);
      res.json({ ok: true });
      behind();
    } catch (e) { problem(res, e); }
  });
}
mountMeetingRoutes('/api/dashboard/meetings', requireAuth);
mountMeetingRoutes('/api/employee/meetings', requireEmployeeAuth);

module.exports = {};
