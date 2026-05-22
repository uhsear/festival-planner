import { Router } from 'express';

export default function createActivityRoutes(deps: any) {
  const router = Router();
  const { stores, userAuth, sendSuccess, sendError, ErrorCodes, log, sanitizeIdentifier, rateLimit, schemas, validateQuery, validateParams } = deps;
  const noopLimit = (_req: any, _res: any, next: any) => next();
  const readLimit = (typeof rateLimit === 'function') ? rateLimit(120, 'activity-read') : noopLimit;

  // GET /crew/:crewId/activity
  router.get('/crews/:crewId/activity', userAuth, readLimit, validateParams(schemas.crewIdParams), validateQuery(schemas.paginationQuery), async (req: any, res: any) => {
    try {
      const crewId = sanitizeIdentifier(req.validatedParams.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      const { cursor, limit } = req.validatedQuery;
      const result = await stores.activity.getByCrew(crewId, { cursor, limit });
      return sendSuccess(res, { items: result.items, nextCursor: result.nextCursor });
    } catch (err: any) {
      log.error('get activity failed', { error: err.message });
      return sendError(res, 500, 'Failed to load activity', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
