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

/** @type {{ method: string, path: string, cap: string | null, public: boolean }[]} */
const routes = [];

/**
 * @param {import('express').Router} router
 * @param {{ method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, cap?: string, public?: boolean }} spec
 * @param {import('express').RequestHandler} handler
 * @param {import('express').RequestHandler} requireActor
 */
function register(router, spec, handler, requireActor) {
  if (!spec.path.startsWith('/api/v1/'))
    throw new Error(`v1(): ${spec.path} is not under /api/v1/`);
  if (spec.public && spec.cap)
    throw new Error(`v1(): ${spec.path} cannot be public and need ${spec.cap}`);
  const guards = spec.public ? [] : [requireActor, ...(spec.cap ? [requireCan(spec.cap)] : [])];
  router[spec.method](spec.path, ...guards, handler);
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
  const v1 = (/** @type {any} */ spec, /** @type {import('express').RequestHandler} */ handler) =>
    register(router, spec, handler, ctx.requireActor);

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
          flags: {},
        }),
      );
    } catch (e) {
      console.warn('[v1/me]', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Could not read who you are. Try again in a moment.' });
    }
  });
}

module.exports = { mountV1, routes, register };
