'use strict';
// The Issues centre, as the rest of the server meets it: the service (the team portal's classic routes and /api/v1 use it)
// and the /api/v1 routes. Nothing else in this folder is for anyone else.
module.exports = {
  ...require('./service'),
  ...require('./routes'),
};
