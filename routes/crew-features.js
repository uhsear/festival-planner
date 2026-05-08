/**
 * Crew features — meeting points + polls
 * Thin adapter: delegates to crew-meeting-points.js and crew-polls.js.
 * Kept for backward compatibility with existing tests.
 */
'use strict';

module.exports = function mountCrewFeatures(router, deps) {
  const createMeetingPointRoutes = require('./crew-meeting-points');
  const createPollRoutes = require('./crew-polls');

  const meetingPointRouter = createMeetingPointRoutes(deps);
  const pollRouter = createPollRoutes(deps);

  router.use('/', meetingPointRouter);
  router.use('/', pollRouter);
};
