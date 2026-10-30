'use strict';
// The new API: /api/v1/*. Mounted in a final pass, after every legacy route has registered, so the
// legacy registration order — which is load-bearing and snapshot-tested — is not touched. Every route
// here goes through `v1()`, which puts the guards in front of the handler and records what the route
// asks of an actor, so the test that crosses every route with every kind of actor (tests/actor.js)
// is driven by the same table the router is.
//
//   v1(router, { method: 'get', path: '/api/v1/leads', cap: 'leads.view' }, handler)
//     → requireActor, requireCan('leads.view'), handler
//   v1(router, { method: 'get', path: '/api/v1/me' }, handler)            any signed-in actor
//   v1(router, { method: 'get', path: '/api/v1/health', public: true }, handler)   no guard — say so on purpose

const contracts = require('@motolinker/contracts');
const { requireCan } = require('./actor');
const { jsonBody } = require('./errors');
const { fileUpload } = require('./uploads');
const { createNotificationsService, mountNotifications } = require('../modules/notifications');
const { createSubmissionsService, mountSubmissions } = require('../modules/submissions');
const { createIssuesService, mountIssues } = require('../modules/issues');
const { createMeetingsService, mountMeetings } = require('../modules/meetings');
const { createCalendarService, mountCalendar } = require('../modules/calendar');

/** @type {{ method: string, path: string, cap: string | null, public: boolean }[]} */
const routes = [];

/**
 * @param {import('express').Router} router
 * @param {{ method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, cap?: string, public?: boolean }} spec
 * @param {import('express').RequestHandler | import('express').RequestHandler[]} handler  what answers; any middleware it
 *   needs (a body parser) comes before it
 * @param {import('express').RequestHandler} requireActor
 */
function register(router, spec, handler, requireActor) {
  if (!spec.path.startsWith('/api/v1/'))
    throw new Error(`v1(): ${spec.path} is not under /api/v1/`);
  if (spec.public && spec.cap)
    throw new Error(`v1(): ${spec.path} cannot be public and need ${spec.cap}`);
  const guards = spec.public ? [] : [requireActor, ...(spec.cap ? [requireCan(spec.cap)] : [])];
  router[spec.method](spec.path, ...guards, ...[handler].flat());
  routes.push({
    method: spec.method.toUpperCase(),
    path: spec.path,
    cap: spec.cap || null,
    public: !!spec.public,
  });
}

/**
 * @param {{ receiver: { router: import('express').Router }, ctx: any }} deps
 */
function mountV1({ receiver, ctx }) {
  const router = receiver.router;
  const v1 = (
    /** @type {any} */ spec,
    /** @type {import('express').RequestHandler[]} */ ...handlers
  ) => register(router, spec, handlers, ctx.requireActor);

  // Is the process up and answering? The host (railway.json) asks this once per deployment and moves
  // traffic only when it gets a 2xx, so a release that cannot boot never replaces the one that can.
  // Liveness only, on purpose: it does not touch the database, so an outage there cannot hold a deploy
  // (or a rollback) hostage — the app is built to ride one out. Public on purpose: the host has no token.
  v1({ method: 'get', path: '/api/v1/health', public: true }, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, uptime_s: Math.round(process.uptime()) });
  });

  // Who is asking, and everything the app needs to draw itself for them. An employee's permissions
  // are read fresh from their record first (the same refresh the portal's /check does), because the
  // session keeps the copy it was opened with.
  v1({ method: 'get', path: '/api/v1/me' }, async (req, res) => {
    try {
      let actor = req.actor;
      if (actor && actor.kind === 'employee' && req.employee) {
        await ctx.refreshEmployeeFromDb(req);
        actor = contracts.employeeActor(req.employee);
      }
      const ws = await ctx.workspaceProfile({ patience: 1500 });
      res.json(
        contracts.schemas.MeResponse.parse({
          ...contracts.describeActor(/** @type {any} */ (actor)),
          workspace: {
            name: ws.name,
            logo_url: ws.logo_url,
            updated_at: ws.updated_at,
            degraded: !!ws.degraded,
          },
          // What the server knows about this installation that changes what the app draws.
          flags: {
            gchat: typeof ctx.gchatConfigured === 'function' && ctx.gchatConfigured() === true,
          },
        }),
      );
    } catch (e) {
      console.warn('[v1/me]', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Could not read who you are. Try again in a moment.' });
    }
  });

  // The people's own notifications (the bell and the Notification Center). The classic routes use the same service.
  mountNotifications({
    v1,
    service: createNotificationsService({ supabase: ctx.supabase }),
    json: jsonBody(),
  });

  // What the website's form sent us (the Submissions page). The classic routes use the same service.
  mountSubmissions({ v1, service: createSubmissionsService({ supabase: ctx.supabase }) });

  // The Issues centre: tickets the team reports to the CTO. The team portal's classic routes use the same service.
  mountIssues({
    v1,
    service: createIssuesService({
      supabase: ctx.supabase,
      notify: (/** @type {any[]} */ ...a) => ctx.createNotification(...a),
      safeFileUrl: ctx.safeFileUrl,
    }),
    json: jsonBody(),
    upload: fileUpload(ctx.multer, { field: 'file', maxBytes: 10 * 1024 * 1024 }),
  });

  // The scheduled meetings (the Meet page, and what the calendar draws). The classic routes use the same service. Google is
  // reached through the context at the moment it is needed: it is wired in after this file is loaded.
  mountMeetings({
    v1,
    service: createMeetingsService({
      supabase: ctx.supabase,
      notify: (/** @type {any[]} */ ...a) => ctx.createNotification(...a),
      getCalendarToken: (/** @type {any[]} */ ...a) => ctx.getCalendarToken(...a),
      getEmployeeCalendarToken: (/** @type {any[]} */ ...a) => ctx.getEmployeeCalendarToken(...a),
      upsertCalendarEvent: (/** @type {any[]} */ ...a) => ctx.upsertCalendarEvent(...a),
      fetch: (/** @type {any[]} */ ...a) => globalThis.fetch(.../** @type {[any, any]} */ (a)),
    }),
    json: jsonBody(),
  });

  // What a person is expected at in a window of time: tasks due, meetings they are in, follow-ups they promised. The classic
  // routes use the same service; an employee's tasks are found the way every other page finds them.
  mountCalendar({
    v1,
    service: createCalendarService({
      supabase: ctx.supabase,
      fetchEmployeeTasks: (/** @type {any[]} */ ...a) => ctx.fetchEmployeeTasks(...a),
    }),
  });
}

module.exports = { mountV1, routes, register };
