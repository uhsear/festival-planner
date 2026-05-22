import { Router } from 'express';

export function createRatingsRoutes({ stores, userAuth, log, sendSuccess, sendError, ErrorCodes, rateLimit, schemas, validate, validateParams, validateQuery }: any) {
  const router = Router();
  const noopLimit = (_req: any, _res: any, next: any) => next();
  const writeLimit = (typeof rateLimit === 'function') ? rateLimit(60, 'rating-write') : noopLimit;
  const readLimit  = (typeof rateLimit === 'function') ? rateLimit(120, 'rating-read')  : noopLimit;

  // Rate a set (upsert)
  router.post('/:setId', userAuth, writeLimit, validateParams(schemas.setIdParams), validate(schemas.ratingCreate), async (req: any, res: any) => {
    try {
      const { setId } = req.validatedParams;
      const { rating, note } = req.validatedBody;

      // Verify set exists
      const setCheck = await stores.pool.query(
        `SELECT fs.id, fs.festival_id FROM festival_sets fs
         JOIN festivals f ON fs.festival_id = f.id AND f.deleted_at IS NULL
         WHERE fs.id = $1`, [setId]);
      if (setCheck.rows.length === 0) {
        return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
      }

      const result = await stores.ratings.upsert(req.user.userId, setId, rating, (note || '').slice(0, 500));
      return sendSuccess(res, result);
    } catch (err: any) {
      log.error('rate set failed', { error: err.message, setId: req.validatedParams?.setId });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Delete a rating
  router.delete('/:setId', userAuth, writeLimit, validateParams(schemas.setIdParams), async (req: any, res: any) => {
    try {
      await stores.ratings.delete(req.user.userId, req.validatedParams.setId);
      return sendSuccess(res, { deleted: true });
    } catch (err: any) {
      log.error('delete rating failed', { error: err.message, setId: req.validatedParams?.setId });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get my ratings for a festival
  router.get('/festival/:festivalId', userAuth, readLimit, validateParams(schemas.festivalIdParams), async (req: any, res: any) => {
    try {
      const ratings = await stores.ratings.getByUser(req.user.userId, req.validatedParams.festivalId);
      return sendSuccess(res, { ratings });
    } catch (err: any) {
      log.error('get user ratings failed', { error: err.message, festivalId: req.validatedParams?.festivalId });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get aggregate ratings for a festival (public — intentionally unauthenticated).
  // This endpoint returns read-only aggregate data (average rating, count per set)
  // with no PII. Keeping it public allows share pages and unauthenticated festival
  // browsers to display community sentiment without requiring login.
  router.get('/festival/:festivalId/all', readLimit, validateParams(schemas.festivalIdParams), validateQuery(schemas.paginationQuery), async (req: any, res: any) => {
    try {
      const { cursor, limit } = req.validatedQuery;
      const result = await stores.ratings.getByFestival(req.validatedParams.festivalId, { cursor, limit });
      return sendSuccess(res, { ratings: result.items, nextCursor: result.nextCursor });
    } catch (err: any) {
      log.error('get festival ratings failed', { error: err.message, festivalId: req.validatedParams?.festivalId });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get crew ratings for a festival
  router.get('/crew/:crewId/festival/:festivalId', userAuth, readLimit, validateParams(schemas.crewIdFestivalIdParams), validateQuery(schemas.paginationQuery), async (req: any, res: any) => {
    try {
      const member = await stores.crews.getMember(req.validatedParams.crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      const { cursor, limit } = req.validatedQuery;
      const result = await stores.ratings.getCrewRatings(req.validatedParams.crewId, req.validatedParams.festivalId, { cursor, limit });
      return sendSuccess(res, { ratings: result.items, nextCursor: result.nextCursor });
    } catch (err: any) {
      log.error('get crew ratings failed', { error: err.message, crewId: req.validatedParams?.crewId });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get wrap stats for current user
  router.get('/wrap/:festivalId', userAuth, readLimit, validateParams(schemas.festivalIdParams), async (req: any, res: any) => {
    try {
      const [stats, ratings] = await Promise.all([
        stores.ratings.getWrapStats(req.user.userId, req.validatedParams.festivalId),
        stores.ratings.getByUser(req.user.userId, req.validatedParams.festivalId),
      ]);
      const topSets = ratings.filter((r: any) => r.rating >= 4).slice(0, 5);
      return sendSuccess(res, { stats, topSets, allRatings: ratings });
    } catch (err: any) {
      log.error('get wrap stats failed', { error: err.message, festivalId: req.validatedParams?.festivalId });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
