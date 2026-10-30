'use strict';
// /api/v1/meetings. The scheduled meetings, for whoever may see them (`meet.view`) and whoever may schedule, change and cancel
// them (`meet.schedule`); the same service answers the classic portals' routes.

const { schemas } = require('@motolinker/contracts');
const { fail, issuesOf } = require('../../http/errors');
const {
  STORED_ID,
  MeetingInvalid,
  MeetingNotFound,
  MeetingsUnavailable,
  toMeeting,
} = require('./service');

/** @typedef {import('@motolinker/contracts').Actor} Actor */

/** What to tell a person whose meeting was refused, by the first field that was wrong. */
const WORDS = /** @type {Record<string, string>} */ ({
  title: 'Give the meeting a title (up to 200 characters).',
  starts_at: 'Give the meeting a start time.',
  duration_min: 'A meeting lasts from 5 to 480 minutes.',
  attendee_ids: 'Attendees are employees, by id.',
  meet_link: 'That meeting link is too long.',
  description: 'The notes can be 2000 characters at most.',
});

/**
 * @param {{
 *   v1: (spec: any, ...handlers: import('express').RequestHandler[]) => void,
 *   service: ReturnType<typeof import('./service').createMeetingsService>,
 *   json: import('express').RequestHandler,
 * }} deps
 */
function mountMeetings({ v1, service, json }) {
  /** What went wrong, as /api/v1 says it. @param {import('express').Response} res @param {unknown} e */
  const problem = (res, e) => {
    if (e instanceof MeetingNotFound)
      return void fail(res, 404, 'not_found', 'There is no such meeting.');
    if (e instanceof MeetingInvalid) return void fail(res, 400, 'invalid', e.message);
    console.warn('[v1/meetings]', e instanceof Error ? e.message : e);
    if (e instanceof MeetingsUnavailable)
      return void fail(
        res,
        503,
        'unavailable',
        'Meetings are unavailable right now. Try again in a moment.',
      );
    fail(res, 500, 'internal', 'Something went wrong. Try again in a moment.');
  };
  /** The meeting's id, if the path has one. @param {import('express').Request} req @param {import('express').Response} res */
  const idOf = (req, res) => {
    const id = String(req.params['id']);
    if (STORED_ID.test(id)) return id;
    fail(res, 400, 'invalid', 'That is not the id of a meeting.');
    return null;
  };
  /** @param {import('express').Request} req @param {import('express').Response} res */
  const bodyOf = (req, res) => {
    const body = schemas.MeetingBody.safeParse(req.body);
    if (body.success) return body.data;
    const field = String(body.error.issues[0]?.path[0] ?? '');
    fail(res, 400, 'invalid', WORDS[field] || 'Check the meeting and try again.', {
      issues: issuesOf(body.error),
    });
    return null;
  };
  const actorOf = (/** @type {import('express').Request} */ req) =>
    /** @type {Actor} */ (req.actor);

  v1({ method: 'get', path: '/api/v1/meetings', cap: 'meet.view' }, async (_req, res) => {
    try {
      res.json({ items: (await service.list()).map(toMeeting) });
    } catch (e) {
      problem(res, e);
    }
  });

  v1({ method: 'post', path: '/api/v1/meetings', cap: 'meet.schedule' }, json, async (req, res) => {
    const input = bodyOf(req, res);
    if (!input) return;
    try {
      const { meeting, behind } = await service.create(actorOf(req), input);
      res.status(201).json(toMeeting(meeting));
      void behind();
    } catch (e) {
      problem(res, e);
    }
  });

  v1(
    { method: 'put', path: '/api/v1/meetings/:id', cap: 'meet.schedule' },
    json,
    async (req, res) => {
      const id = idOf(req, res);
      if (id === null) return;
      const input = bodyOf(req, res);
      if (!input) return;
      try {
        const { meeting, behind } = await service.update(id, input);
        res.json(toMeeting(meeting));
        void behind();
      } catch (e) {
        problem(res, e);
      }
    },
  );

  v1({ method: 'delete', path: '/api/v1/meetings/:id', cap: 'meet.schedule' }, async (req, res) => {
    const id = idOf(req, res);
    if (id === null) return;
    try {
      const { behind } = await service.remove(id);
      res.json({ ok: true });
      void behind();
    } catch (e) {
      problem(res, e);
    }
  });
}

module.exports = { mountMeetings };
