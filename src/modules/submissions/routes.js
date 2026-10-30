'use strict';
// /api/v1/submissions. The website's submissions, for whoever may read them or clear them: the capability is the whole
// question (`submissions.view` to list, `submissions.delete` to delete), and the same service answers the classic portals.

const { fail } = require('../../http/errors');
const { STORED_ID, SubmissionsUnavailable, toSubmission } = require('./service');

/**
 * @param {{
 *   v1: (spec: any, ...handlers: import('express').RequestHandler[]) => void,
 *   service: ReturnType<typeof import('./service').createSubmissionsService>,
 * }} deps
 */
function mountSubmissions({ v1, service }) {
  /** @param {import('express').Response} res @param {unknown} e */
  const unavailable = (res, e) => {
    console.warn('[v1/submissions]', e instanceof Error ? e.message : e);
    if (e instanceof SubmissionsUnavailable)
      return void fail(
        res,
        503,
        'unavailable',
        'Submissions are unavailable right now. Try again in a moment.',
      );
    fail(res, 500, 'internal', 'Something went wrong. Try again in a moment.');
  };

  v1({ method: 'get', path: '/api/v1/submissions', cap: 'submissions.view' }, async (_req, res) => {
    try {
      res.json({ items: (await service.list()).map(toSubmission) });
    } catch (e) {
      unavailable(res, e);
    }
  });

  v1(
    { method: 'delete', path: '/api/v1/submissions/:id', cap: 'submissions.delete' },
    async (req, res) => {
      const id = String(req.params['id']);
      if (!STORED_ID.test(id))
        return void fail(res, 400, 'invalid', 'That is not the id of a submission.');
      try {
        await service.remove(Number(id));
        res.json({ ok: true });
      } catch (e) {
        unavailable(res, e);
      }
    },
  );
}

module.exports = { mountSubmissions };
