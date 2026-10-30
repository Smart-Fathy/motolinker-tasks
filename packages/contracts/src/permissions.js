'use strict';
// The permission rules in one place that carries nothing else: the catalogue of sections and actions, how a stored
// record is read, and may-this-employee-do-that. The browser imports this (the package root also holds the response
// schemas, which are zod, and a page has no use for those); the root and the server keep reading the same functions.

module.exports = {
  ...require('./permissions-catalogue'),
  ...require('./permissions-normalise'),
  ...require('./permissions-can'),
};
