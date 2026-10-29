'use strict';
// @motolinker/contracts — what the server and the web app agree on.
//
//   permissions-catalogue   the sections, actions, defaults and presets (data)
//   permissions-normalise   how a stored permissions record is read (rule)
//   permissions-can         employeeCan: may this employee do that? (rule)
//   access                  actors, capabilities, scope: one `can()` for guards and navigation
//   schemas                 the shapes that go over the wire (zod)
//
// Plain CommonJS with JSDoc types (checked by `npm run typecheck`): the server loads it with no build
// step, and the web app imports it through its bundler.

/**
 * @typedef {import('./access').Actor} Actor
 * @typedef {import('./access').Scope} Scope
 */

module.exports = {
  ...require('./permissions-catalogue'),
  ...require('./permissions-normalise'),
  ...require('./permissions-can'),
  ...require('./access'),
  schemas: require('./schemas'),
};
