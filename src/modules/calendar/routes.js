'use strict';
// /api/v1/calendar. What the signed-in person is expected at in a window of time (`calendar.view`); the same service answers
// the classic portals' routes.

const { schemas } = require('@motolinker/contracts');
const { fail, issuesOf } = require('../../http/errors');
const { toMeeting } = require('../meetings/service');
const { CalendarInvalid } = require('./service');

/** @typedef {import('@motolinker/contracts').Actor} Actor */

/**
 * @param {{
 *   v1: (spec: any, ...handlers: import('express').RequestHandler[]) => void,
 *   service: ReturnType<typeof import('./service').createCalendarService>,
 * }} deps
 */
function mountCalendar({ v1, service }) {
  v1({ method: 'get', path: '/api/v1/calendar', cap: 'calendar.view' }, async (req, res) => {
    const query = schemas.CalendarQuery.safeParse(req.query);
    if (!query.success)
      return void fail(res, 400, 'invalid', 'from and to must be dates', {
        issues: issuesOf(query.error),
      });
    try {
      const { feed, unreadable } = await service.feed(
        /** @type {Actor} */ (req.actor),
        query.data,
        {
          strict: true,
        },
      );
      // A source that could not be read is not a quiet month: the page is told, rather than shown a calendar with a hole in it.
      if (unreadable.length)
        return void fail(
          res,
          503,
          'unavailable',
          'The calendar is unavailable right now. Try again in a moment.',
        );
      res.json({
        ...feed,
        tasks: feed.tasks.map(t => ({ ...t, assignee_ids: t.assignee_ids.map(String) })),
        meetings: feed.meetings.map(toMeeting),
      });
    } catch (e) {
      if (e instanceof CalendarInvalid) return void fail(res, 400, 'invalid', e.message);
      console.warn('[v1/calendar]', e instanceof Error ? e.message : e);
      fail(res, 500, 'internal', 'Something went wrong. Try again in a moment.');
    }
  });
}

module.exports = { mountCalendar };
