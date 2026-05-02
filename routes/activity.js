'use strict';

module.exports = function createActivityRoutes(deps) {
  const router = deps.express.Router();
  const { stores, userAuth, sendSuccess, sendError, ErrorCodes, log, sanitizeIdentifier, rateLimit } = deps;
  const noopLimit = (_req, _res, next) => next();
  const readLimit = (typeof rateLimit === 'function') ? rateLimit(120, 'activity-read') : noopLimit;

  // GET /crew/:crewId/activity
  router.get('/crews/:crewId/activity', userAuth, readLimit, async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      const { cursor, limit } = deps.schemas.paginationQuery.parse(req.query);
      const result = await stores.activity.getByCrew(crewId, { cursor, limit });
      return sendSuccess(res, { items: result.items, nextCursor: result.nextCursor });
    } catch (err) {
      log.error('get activity failed', { error: err.message });
      return sendError(res, 500, 'Failed to load activity', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
};
