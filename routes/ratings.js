'use strict';

const { Router } = require('express');

function createRatingsRoutes({ stores, userAuth, sendSuccess, sendError, ErrorCodes, rateLimit, schemas, validate, validateParams, validateQuery }) {
  const router = Router();
  const noopLimit = (_req, _res, next) => next();
  const writeLimit = (typeof rateLimit === 'function') ? rateLimit(60, 'rating-write') : noopLimit;
  const readLimit  = (typeof rateLimit === 'function') ? rateLimit(120, 'rating-read')  : noopLimit;

  // Rate a set (upsert)
  router.post('/:setId', userAuth, writeLimit, validateParams(schemas.setIdParams), validate(schemas.ratingCreate), async (req, res) => {
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
      sendSuccess(res, result);
    } catch {
      sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Delete a rating
  router.delete('/:setId', userAuth, writeLimit, validateParams(schemas.setIdParams), async (req, res) => {
    try {
      await stores.ratings.delete(req.user.userId, req.validatedParams.setId);
      sendSuccess(res, { deleted: true });
    } catch {
      sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get my ratings for a festival
  router.get('/festival/:festivalId', userAuth, readLimit, validateParams(schemas.festivalIdParams), async (req, res) => {
    try {
      const ratings = await stores.ratings.getByUser(req.user.userId, req.validatedParams.festivalId);
      sendSuccess(res, { ratings });
    } catch {
      sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get aggregate ratings for a festival (public — intentionally unauthenticated).
  // This endpoint returns read-only aggregate data (average rating, count per set)
  // with no PII. Keeping it public allows share pages and unauthenticated festival
  // browsers to display community sentiment without requiring login.
  router.get('/festival/:festivalId/all', readLimit, validateParams(schemas.festivalIdParams), validateQuery(schemas.paginationQuery), async (req, res) => {
    try {
      const { cursor, limit } = req.validatedQuery;
      const result = await stores.ratings.getByFestival(req.validatedParams.festivalId, { cursor, limit });
      sendSuccess(res, { ratings: result.items, nextCursor: result.nextCursor });
    } catch {
      sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get crew ratings for a festival
  router.get('/crew/:crewId/festival/:festivalId', userAuth, readLimit, validateParams(schemas.crewIdFestivalIdParams), validateQuery(schemas.paginationQuery), async (req, res) => {
    try {
      const { cursor, limit } = req.validatedQuery;
      const result = await stores.ratings.getCrewRatings(req.validatedParams.crewId, req.validatedParams.festivalId, { cursor, limit });
      sendSuccess(res, { ratings: result.items, nextCursor: result.nextCursor });
    } catch {
      sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get wrap stats for current user
  router.get('/wrap/:festivalId', userAuth, readLimit, validateParams(schemas.festivalIdParams), async (req, res) => {
    try {
      const [stats, ratings] = await Promise.all([
        stores.ratings.getWrapStats(req.user.userId, req.validatedParams.festivalId),
        stores.ratings.getByUser(req.user.userId, req.validatedParams.festivalId),
      ]);
      const topSets = ratings.filter(r => r.rating >= 4).slice(0, 5);
      sendSuccess(res, { stats, topSets, allRatings: ratings });
    } catch {
      sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}

module.exports = { createRatingsRoutes };
