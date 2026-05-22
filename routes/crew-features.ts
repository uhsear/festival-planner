/**
 * Crew features — meeting points + polls
 * Thin adapter: delegates to crew-meeting-points.js and crew-polls.js.
 * Kept for backward compatibility with existing tests.
 */

import type { Router } from 'express';
import createMeetingPointRoutes from './crew-meeting-points.js';
import createPollRoutes from './crew-polls.js';

export default function mountCrewFeatures(router: Router, deps: any): void {
  const meetingPointRouter = createMeetingPointRoutes(deps);
  const pollRouter = createPollRoutes(deps);

  router.use('/', meetingPointRouter);
  router.use('/', pollRouter);
}
