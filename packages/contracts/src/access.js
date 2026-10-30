'use strict';
// Who is acting, and what they may do. The server's guards and the portals' navigation ask the same
// questions of the same object, so "can" is derived in one place instead of five.
//
// An actor is the admin (everything) or an employee (the sections and actions their permissions
// grant, on the rows their scope allows). The admin is `caps: '*'` — an explicit "all", not the
// absence of an employee, which is what the guards used to read.

const { PERM_ACTIONS } = require('./permissions-catalogue');
const { employeeCan } = require('./permissions-can');

/**
 * @typedef {{ assignedOnly: boolean, dealStages: readonly string[], leadStatuses: readonly string[] }} Scope
 * @typedef {{
 *   kind: 'admin' | 'employee',
 *   id: number | null,
 *   key: string,
 *   name: string,
 *   jobTitle: string,
 *   caps: '*' | ReadonlySet<string>,
 *   sections: '*' | ReadonlySet<string>,
 *   scope: Scope,
 * }} Actor
 */

// An actor is read by everything that handles the request — and the admin's is one object shared by
// every request — so actors and their scopes are frozen, lists included: nothing downstream can widen
// one by writing to it. (A frozen Set still takes add(); the sets are typed ReadonlySet and nothing
// writes to them, which tests/actor.js pins.)
/** @type {Scope} */
const NO_SCOPE = Object.freeze({
  assignedOnly: false,
  dealStages: Object.freeze(/** @type {string[]} */ ([])),
  leadStatuses: Object.freeze(/** @type {string[]} */ ([])),
});

/**
 * A stored scope list as a list of strings: anything else (a session written by an older version) is empty.
 * @param {unknown} v
 * @returns {string[]}
 */
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

// The entities whose rows a scope narrows. (Leads and deals today; the rest see what their section lets them.)
const SCOPED_ENTITIES = new Set(['leads', 'customers', 'deals', 'reports']);

/**
 * The capabilities a normalised permissions record grants: every `section.action` the person may do,
 * and the sections whose master switch is on (what the navigation shows). Derived through
 * employeeCan, so it carries the same rules, including the Issues centre that belongs to the CTO by title.
 * @param {Record<string, any> | null | undefined} permissions
 * @param {string} [jobTitle]
 * @returns {{ caps: Set<string>, sections: Set<string> }}
 */
function capabilitiesOf(permissions, jobTitle = '') {
  const emp = { permissions: permissions || undefined, job_title: jobTitle };
  const caps = new Set();
  const sections = new Set();
  for (const [section, actions] of Object.entries(PERM_ACTIONS)) {
    for (const action of actions)
      if (employeeCan(emp, section, action)) caps.add(section + '.' + action);
    const master = !!permissions && permissions[section] === true;
    if (master || (section === 'issues' && /chief technical officer/i.test(jobTitle)))
      sections.add(section);
  }
  return { caps, sections };
}

/**
 * The admin.
 * @returns {Actor}
 */
function adminActor() {
  return Object.freeze({
    kind: /** @type {const} */ ('admin'),
    id: null,
    key: 'admin',
    name: 'Admin',
    jobTitle: '',
    caps: /** @type {const} */ ('*'),
    sections: /** @type {const} */ ('*'),
    scope: NO_SCOPE,
  });
}

/**
 * An employee, from the session payload the portal keeps for them (permissions already normalised).
 * @param {{ id: number, name?: string, job_title?: string, permissions?: Record<string, any> }} emp
 * @returns {Actor}
 */
function employeeActor(emp) {
  const jobTitle = emp.job_title || '';
  const { caps, sections } = capabilitiesOf(emp.permissions, jobTitle);
  const s = (emp.permissions && emp.permissions.scope) || NO_SCOPE;
  return Object.freeze({
    kind: /** @type {const} */ ('employee'),
    id: emp.id,
    key: 'employee_' + emp.id,
    name: emp.name || '',
    jobTitle,
    caps,
    sections,
    scope: Object.freeze({
      assignedOnly: s.assignedOnly === true,
      dealStages: Object.freeze(strings(s.dealStages)),
      leadStatuses: Object.freeze(strings(s.leadStatuses)),
    }),
  });
}

/**
 * May this actor do `section.action` (e.g. 'leads.edit')?
 * @param {Actor | null | undefined} actor
 * @param {string} cap
 * @returns {boolean}
 */
function can(actor, cap) {
  if (!actor) return false;
  return actor.caps === '*' || actor.caps.has(cap);
}

/**
 * Is this section switched on for this actor (does its page and navigation item exist for them)?
 * @param {Actor | null | undefined} actor
 * @param {string} section
 * @returns {boolean}
 */
function hasSection(actor, section) {
  if (!actor) return false;
  return actor.sections === '*' || actor.sections.has(section);
}

/**
 * The scope that narrows which rows of `entity` this actor sees: none for the admin and for entities
 * a scope does not apply to.
 * @param {Actor | null | undefined} actor
 * @param {string} entity
 * @returns {Scope}
 */
function scopeOf(actor, entity) {
  if (!actor || actor.caps === '*' || !SCOPED_ENTITIES.has(entity)) return NO_SCOPE;
  return actor.scope;
}

/**
 * Does this scope narrow anything at all?
 * @param {Scope | null | undefined} scope
 * @returns {boolean}
 */
function isScoped(scope) {
  return !!(
    scope &&
    (scope.assignedOnly ||
      (scope.dealStages && scope.dealStages.length) ||
      (scope.leadStatuses && scope.leadStatuses.length))
  );
}

/**
 * The actor as it goes over the wire (GET /api/v1/me): sets become sorted arrays, '*' stays '*'.
 * @param {Actor} actor
 */
function describeActor(actor) {
  /** @param {'*' | ReadonlySet<string>} v @returns {'*' | string[]} */
  const list = v => (v === '*' ? '*' : [...v].sort());
  return {
    actor: {
      kind: actor.kind,
      id: actor.id,
      key: actor.key,
      name: actor.name,
      jobTitle: actor.jobTitle,
    },
    caps: list(actor.caps),
    sections: list(actor.sections),
    scope: actor.scope,
  };
}

module.exports = {
  NO_SCOPE,
  capabilitiesOf,
  adminActor,
  employeeActor,
  can,
  hasSection,
  scopeOf,
  isScoped,
  describeActor,
};
