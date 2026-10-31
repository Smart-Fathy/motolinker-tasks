'use strict';
// @motolinker/contracts — what the server and the web app agree on.
//
//   permissions             (the three below, together, for a caller that wants no zod)
//     permissions-catalogue   the sections, actions, defaults and presets (data)
//     permissions-normalise   how a stored permissions record is read (rule)
//     permissions-can         employeeCan: may this employee do that? (rule)
//   access                  actors, capabilities, scope: one `can()` for guards and navigation
//   modules                 the screens: who gets each, where each sits in the navigation, what the classic portals called it
//   deeplinks               links that already exist ('/employee#requests', '?chat=') and the new app's paths, both ways
//   documents               what the documents are made of: the statuses of an RFQ, a purchase order and a contract, the fields of a
//                           line, the blanks of a contract's form
//   schemas                 the shapes that go over the wire (zod)
//
// Plain CommonJS with JSDoc types (checked by `npm run typecheck`): the server loads it with no build
// step, and the web app imports it through its bundler.

/**
 * @typedef {import('./access').Actor} Actor
 * @typedef {import('./access').Scope} Scope
 */

module.exports = {
  ...require('./permissions'),
  ...require('./access'),
  modules: require('./modules'),
  deeplinks: require('./deeplinks'),
  documents: require('./documents'),
  schemas: require('./schemas'),
};
