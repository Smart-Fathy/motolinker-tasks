'use strict';
// Website submissions, as the rest of the server meets them: the service (both portals' classic routes and /api/v1 use it)
// and the /api/v1 routes. Nothing else in this folder is for anyone else.
module.exports = {
  ...require('./service'),
  ...require('./routes'),
};
