'use strict';
// The calendar feed, as the rest of the server meets it: the service (both portals' classic routes and /api/v1 use it) and the
// /api/v1 route. Nothing else in this folder is for anyone else.
module.exports = {
  ...require('./service'),
  ...require('./routes'),
};
