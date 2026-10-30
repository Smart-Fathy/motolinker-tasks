'use strict';
// /api/v1/notifications. The routes of the people's own notifications: every signed-in actor has them, so no capability
// is asked for — the actor is the whole question (the service files everything under `actor.key`).

const { schemas } = require('@motolinker/contracts');
const { fail, issuesOf } = require('../../http/errors');
const { NotificationsUnavailable, toNotification } = require('./service');

/** @typedef {import('@motolinker/contracts').Actor} Actor */

/**
 * @param {{
 *   v1: (spec: any, ...handlers: import('express').RequestHandler[]) => void,
 *   service: ReturnType<typeof import('./service').createNotificationsService>,
 *   json: import('express').RequestHandler,
 * }} deps
 */
function mountNotifications({ v1, service, json }) {
  /** @param {import('express').Response} res @param {unknown} e */
  const unavailable = (res, e) => {
    console.warn('[v1/notifications]', e instanceof Error ? e.message : e);
    if (e instanceof NotificationsUnavailable)
      return void fail(
        res,
        503,
        'unavailable',
        'Notifications are unavailable right now. Try again in a moment.',
      );
    fail(res, 500, 'internal', 'Something went wrong. Try again in a moment.');
  };

  v1({ method: 'get', path: '/api/v1/notifications' }, async (req, res) => {
    try {
      const { rows, unread } = await service.list(/** @type {Actor} */ (req.actor));
      res.json({ items: rows.map(toNotification), unread });
    } catch (e) {
      unavailable(res, e);
    }
  });

  v1({ method: 'post', path: '/api/v1/notifications/read' }, json, async (req, res) => {
    const body = schemas.NotificationReadBody.safeParse(req.body);
    if (!body.success)
      return void fail(res, 400, 'invalid', 'Say which notification, or all of them.', {
        issues: issuesOf(body.error),
      });
    try {
      await service.markRead(/** @type {Actor} */ (req.actor), body.data);
      res.json({ ok: true });
    } catch (e) {
      unavailable(res, e);
    }
  });
}

module.exports = { mountNotifications };
