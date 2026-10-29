'use strict';
// Who is acting on a request, and the guard that insists on a capability.
//
// The legacy guards (requireAuth / requireEmployeeAuth in index.js) attach `req.actor`; the guard for
// /api/v1 (requireActor, also in index.js, because it shares their session store) runs whichever fits
// the token and so does the same. What lives here is the part that does not need the session store:
// reading the actor off a request, and `requireCan`.
//
// `requireCan` FAILS CLOSED. The legacy `requirePerm` lets a request through when there is no
// `req.employee` — it reads "no employee" as "the admin" — so mounted on its own it authorises
// everyone. This one lets a request through only when `req.actor` exists and holds the capability;
// with no actor it answers 401, never `next()`.

const { PERM_ACTIONS, can } = require('@motolinker/contracts');

/**
 * The actor behind a request, or null when no guard has run.
 * @param {{ actor?: import('@motolinker/contracts').Actor }} req
 * @returns {import('@motolinker/contracts').Actor | null}
 */
function actorOf(req) {
  return req.actor || null;
}

/**
 * A capability is `section.action`, and it has to exist in the catalogue: a typo is a boot failure,
 * not a guard that quietly refuses everyone (or, worse, one nobody can be granted).
 * @param {string} cap
 */
function assertKnownCapability(cap) {
  const [section, action, ...rest] = String(cap).split('.');
  const actions = section ? PERM_ACTIONS[section] : undefined;
  if (!section || !action || rest.length || !actions || !actions.includes(action)) {
    throw new Error(
      `requireCan: "${cap}" is not a capability in the permission catalogue (section.action)`,
    );
  }
}

/**
 * Route guard: the actor must hold `cap` (e.g. 'leads.edit').
 *   401 when there is no actor (mount it behind requireActor); 403 when there is one without the capability.
 * The guard's name carries the capability, so the route inventory (tools/route-inventory.js) shows it.
 * @param {string} cap
 * @returns {import('express').RequestHandler}
 */
function requireCan(cap) {
  assertKnownCapability(cap);
  /** @type {import('express').RequestHandler} */
  const guard = (req, res, next) => {
    const actor = actorOf(req);
    if (!actor) return void res.status(401).json({ error: 'Unauthorized' });
    if (!can(actor, cap)) return void res.status(403).json({ error: 'Not permitted' });
    next();
  };
  Object.defineProperty(guard, 'name', { value: `requireCan(${cap})` });
  return guard;
}

module.exports = { actorOf, assertKnownCapability, requireCan };
