import { Router } from 'express';
import { randomUUID } from 'crypto';

/**
 * Crew carpool / ride board (M2 logistics) — a shared "who's driving" board.
 * A new crew sub-resource cloning routes/crew-packing.ts exactly: userAuth +
 * getMember gate + rate limit + io.to('crew:'+id).emit + activity log.
 */
export default function createCrewRidesRoutes(deps: any) {
  const {
    log,
    userAuth,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    stores,
    schemas,
    validate,
    validateParams,
    io,
  } = deps;

  const router = Router({ mergeParams: true });

  // ── GET /:crewId/rides ─────────────────────────────────────────
  router.get(
    '/:crewId/rides',
    userAuth,
    rateLimit(120, 'crew-rides-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;
        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const offers = await stores.crewRides.listByCrew(crewId);
        return sendSuccess(res, { offers });
      } catch (err: any) {
        log.error('get rides error', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to list ride offers', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/rides ────────────────────────────────────────
  router.post(
    '/:crewId/rides',
    userAuth,
    rateLimit(30, 'crew-rides-create'),
    validateParams(schemas.crewIdParams),
    validate(schemas.rideCreate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const { driver, seats, departFrom, departAt, note } = req.validatedBody;
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const count = await stores.crewRides.countByCrew(crewId);
        if (count >= 200) return sendError(res, 409, 'Max 200 ride offers per crew', ErrorCodes.CONFLICT);

        const offer = await stores.crewRides.create({
          id: 'ride-' + randomUUID(),
          crewId,
          createdBy: userId,
          driver: driver ?? null,
          seats: seats ?? null,
          departFrom: departFrom ?? null,
          departAt: departAt ?? null,
          note: note ?? null,
        });

        io.to('crew:' + crewId).emit('crew:ride-created', { offer });
        await stores.activity
          .log({
            crewId,
            userId,
            type: 'ride-created',
            detail: (offer.driver || offer.depart_from || 'Ride').slice(0, 100),
          })
          .catch(() => {});
        return sendSuccess(res, { offer });
      } catch (err: any) {
        log.error('create ride offer error', { error: err.message });
        return sendError(res, 500, 'Failed to add ride offer', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── PUT /:crewId/rides/:itemId ─────────────────────────────────
  router.put(
    '/:crewId/rides/:itemId',
    userAuth,
    rateLimit(60, 'crew-rides-update'),
    validateParams(schemas.crewIdItemIdParams),
    validate(schemas.rideUpdate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const itemId = sanitizeIdentifier(req.validatedParams.itemId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crewRides.getById(itemId);
        if (!existing || existing.crew_id !== crewId) {
          return sendError(res, 404, 'Ride offer not found', ErrorCodes.NOT_FOUND);
        }

        const offer = await stores.crewRides.update(itemId, req.validatedBody);
        io.to('crew:' + crewId).emit('crew:ride-updated', { offer });
        return sendSuccess(res, { offer });
      } catch (err: any) {
        log.error('update ride offer error', { error: err.message });
        return sendError(res, 500, 'Failed to update ride offer', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/rides/:itemId ──────────────────────────────
  router.delete(
    '/:crewId/rides/:itemId',
    userAuth,
    rateLimit(30, 'crew-rides-delete'),
    validateParams(schemas.crewIdItemIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const itemId = sanitizeIdentifier(req.validatedParams.itemId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crewRides.getById(itemId);
        if (!existing || existing.crew_id !== crewId) {
          return sendError(res, 404, 'Ride offer not found', ErrorCodes.NOT_FOUND);
        }
        if (existing.created_by !== userId && membership.role !== 'owner') {
          return sendError(res, 403, 'Only creator or owner can remove offer', ErrorCodes.FORBIDDEN);
        }

        await stores.crewRides.delete(itemId);
        io.to('crew:' + crewId).emit('crew:ride-deleted', { itemId });
        return sendSuccess(res, { deleted: true });
      } catch (err: any) {
        log.error('delete ride offer error', { error: err.message });
        return sendError(res, 500, 'Failed to remove ride offer', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
