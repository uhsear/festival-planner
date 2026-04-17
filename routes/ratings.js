'use strict';

const { Router } = require('express');

// Rating emoji map: 1=skip, 2=meh, 3=okay, 4=good, 5=fire
const VALID_RATINGS = [1, 2, 3, 4, 5];

function createRatingsRoutes({ stores, userAuth, sendSuccess, sendError, ErrorCodes, rateLimit }) {
  const router = Router();
  const noopLimit = (_req, _res, next) => next();
  const writeLimit = (typeof rateLimit === 'function') ? rateLimit(60, 'rating-write') : noopLimit;
  const readLimit  = (typeof rateLimit === 'function') ? rateLimit(120, 'rating-read')  : noopLimit;

  // Rate a set (upsert)
  router.post('/:setId', userAuth, writeLimit, async (req, res) => {
    try {
      const { setId } = req.params;
      const { rating, note } = req.body || {};

      if (!VALID_RATINGS.includes(rating)) {
        return sendError(res, 400, 'Rating must be 1-5', ErrorCodes.VALIDATION);
      }
      if (note && typeof note !== 'string') {
        return sendError(res, 400, 'Note must be a string', ErrorCodes.VALIDATION);
      }

      // Verify set exists
      const setCheck = await stores.pool.query('SELECT id, festival_id FROM festival_sets WHERE id = $1', [setId]);
      if (setCheck.rows.length === 0) {
        return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
      }

      const result = await stores.ratings.upsert(req.user.id, setId, rating, (note || '').slice(0, 500));
      sendSuccess(res, result);
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Delete a rating
  router.delete('/:setId', userAuth, writeLimit, async (req, res) => {
    try {
      await stores.ratings.delete(req.user.id, req.params.setId);
      sendSuccess(res, { deleted: true });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Get my ratings for a festival
  router.get('/festival/:festivalId', userAuth, readLimit, async (req, res) => {
    try {
      const ratings = await stores.ratings.getByUser(req.user.id, req.params.festivalId);
      sendSuccess(res, { ratings });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Get aggregate ratings for a festival (public)
  router.get('/festival/:festivalId/all', readLimit, async (req, res) => {
    try {
      const ratings = await stores.ratings.getByFestival(req.params.festivalId);
      sendSuccess(res, { ratings });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Get crew ratings for a festival
  router.get('/crew/:crewId/festival/:festivalId', userAuth, readLimit, async (req, res) => {
    try {
      const ratings = await stores.ratings.getCrewRatings(req.params.crewId, req.params.festivalId);
      sendSuccess(res, { ratings });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Get wrap stats for current user
  router.get('/wrap/:festivalId', userAuth, readLimit, async (req, res) => {
    try {
      const [stats, ratings] = await Promise.all([
        stores.ratings.getWrapStats(req.user.id, req.params.festivalId),
        stores.ratings.getByUser(req.user.id, req.params.festivalId),
      ]);
      const topSets = ratings.filter(r => r.rating >= 4).slice(0, 5);
      sendSuccess(res, { stats, topSets, allRatings: ratings });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  return router;
}

module.exports = { createRatingsRoutes };
