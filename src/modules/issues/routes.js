'use strict';
// /api/v1/issues. The Issues centre, for the team and for the admin: whoever may read the centre lists the tickets
// (`issues.view`), whoever may manage it closes and reopens them (`issues.resolve`), the replies on a ticket are for its
// reporter and for anyone who may read the centre, and any signed-in actor may report one. The same service answers the
// team portal's classic routes.

const { schemas } = require('@motolinker/contracts');
const { fail, issuesOf } = require('../../http/errors');
const {
  STORED_ID,
  AttachmentFailed,
  IssueForbidden,
  IssueInvalid,
  IssueNotFound,
  IssuesUnavailable,
  toIssue,
  toIssueComment,
} = require('./service');

/** @typedef {import('@motolinker/contracts').Actor} Actor */

/**
 * @param {{
 *   v1: (spec: any, ...handlers: import('express').RequestHandler[]) => void,
 *   service: ReturnType<typeof import('./service').createIssuesService>,
 *   json: import('express').RequestHandler,
 *   upload: import('express').RequestHandler,
 * }} deps
 */
function mountIssues({ v1, service, json, upload }) {
  /** What went wrong with a ticket, as /api/v1 says it. @param {import('express').Response} res @param {unknown} e */
  const problem = (res, e) => {
    if (e instanceof IssueNotFound)
      return void fail(res, 404, 'not_found', 'There is no such ticket.');
    if (e instanceof IssueForbidden) return void fail(res, 403, 'forbidden', 'Not permitted');
    if (e instanceof IssueInvalid) return void fail(res, 400, 'invalid', e.message);
    console.warn('[v1/issues]', e instanceof Error ? e.message : e);
    if (e instanceof AttachmentFailed)
      return void fail(
        res,
        502,
        'upload_failed',
        'The attachment could not be stored. Try again in a moment.',
      );
    if (e instanceof IssuesUnavailable)
      return void fail(
        res,
        503,
        'unavailable',
        'The issues centre is unavailable right now. Try again in a moment.',
      );
    fail(res, 500, 'internal', 'Something went wrong. Try again in a moment.');
  };
  /** The ticket's id, if the path has one. @param {import('express').Request} req @param {import('express').Response} res */
  const idOf = (req, res) => {
    const id = String(req.params['id']);
    if (STORED_ID.test(id)) return id;
    fail(res, 400, 'invalid', 'That is not the id of a ticket.');
    return null;
  };
  const actorOf = (/** @type {import('express').Request} */ req) =>
    /** @type {Actor} */ (req.actor);

  v1({ method: 'get', path: '/api/v1/issues', cap: 'issues.view' }, async (_req, res) => {
    try {
      res.json({ items: (await service.list()).map(toIssue) });
    } catch (e) {
      problem(res, e);
    }
  });

  v1(
    { method: 'patch', path: '/api/v1/issues/:id', cap: 'issues.resolve' },
    json,
    async (req, res) => {
      const id = idOf(req, res);
      if (id === null) return;
      const body = schemas.IssueStatusBody.safeParse(req.body);
      if (!body.success)
        return void fail(res, 400, 'invalid', 'Say whether the ticket is open or resolved.', {
          issues: issuesOf(body.error),
        });
      try {
        res.json(toIssue(await service.setStatus(actorOf(req), id, body.data.status)));
      } catch (e) {
        problem(res, e);
      }
    },
  );

  v1({ method: 'get', path: '/api/v1/issues/:id/comments' }, async (req, res) => {
    const id = idOf(req, res);
    if (id === null) return;
    try {
      res.json({ items: (await service.comments(actorOf(req), id)).map(toIssueComment) });
    } catch (e) {
      problem(res, e);
    }
  });

  v1({ method: 'post', path: '/api/v1/issues/:id/comments' }, json, async (req, res) => {
    const id = idOf(req, res);
    if (id === null) return;
    const body = schemas.IssueCommentBody.safeParse(req.body);
    if (!body.success)
      return void fail(res, 400, 'invalid', 'Write a reply, or attach a file.', {
        issues: issuesOf(body.error),
      });
    try {
      res.status(201).json(toIssueComment(await service.addComment(actorOf(req), id, body.data)));
    } catch (e) {
      problem(res, e);
    }
  });

  v1({ method: 'post', path: '/api/v1/issues' }, upload, async (req, res) => {
    const fields = /** @type {any} */ (req.body) || {};
    const body = schemas.IssueReportBody.safeParse({
      title: fields.title ?? '',
      description: fields.description ?? '',
    });
    if (!body.success)
      return void fail(res, 400, 'invalid', 'Describe the problem: a summary, or the details.', {
        issues: issuesOf(body.error),
      });
    try {
      const file = /** @type {any} */ (req).file || null;
      const out = await service.report(actorOf(req), { ...body.data, file }, { strict: true });
      res.status(201).json({ ok: true, file: out.file });
    } catch (e) {
      problem(res, e);
    }
  });
}

module.exports = { mountIssues };
