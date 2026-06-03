import { Router } from 'express';
import { randomUUID } from 'crypto';

/**
 * Crew packing board (M2 logistics) — a shared "who's bringing what" checklist.
 * A new crew sub-resource cloning routes/crew-polls.ts exactly: userAuth +
 * getMember gate + rate limit + io.to('crew:'+id).emit + activity log.
 */
export default function createCrewPackingRoutes(deps: any) {
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

  // ── GET /:crewId/packing ───────────────────────────────────────
  router.get(
    '/:crewId/packing',
    userAuth,
    rateLimit(120, 'crew-packing-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;
        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const items = await stores.crewPacking.listByCrew(crewId);
        return sendSuccess(res, { items });
      } catch (err: any) {
        log.error('get packing error', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to list packing items', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/packing ──────────────────────────────────────
  router.post(
    '/:crewId/packing',
    userAuth,
    rateLimit(30, 'crew-packing-create'),
    validateParams(schemas.crewIdParams),
    validate(schemas.packingCreate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const { label, broughtBy, claimed } = req.validatedBody;
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const count = await stores.crewPacking.countByCrew(crewId);
        if (count >= 200) return sendError(res, 409, 'Max 200 packing items per crew', ErrorCodes.CONFLICT);

        const item = await stores.crewPacking.create({
          id: 'pack-' + randomUUID(),
          crewId,
          createdBy: userId,
          label,
          broughtBy: broughtBy ?? null,
          claimed: claimed === true,
        });

        io.to('crew:' + crewId).emit('crew:packing-created', { item });
        await stores.activity
          .log({ crewId, userId, type: 'packing-created', detail: item.label.slice(0, 100) })
          .catch(() => {});
        return sendSuccess(res, { item });
      } catch (err: any) {
        log.error('create packing item error', { error: err.message });
        return sendError(res, 500, 'Failed to add packing item', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── PUT /:crewId/packing/:itemId ───────────────────────────────
  router.put(
    '/:crewId/packing/:itemId',
    userAuth,
    rateLimit(60, 'crew-packing-update'),
    validateParams(schemas.crewIdItemIdParams),
    validate(schemas.packingUpdate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const itemId = sanitizeIdentifier(req.validatedParams.itemId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crewPacking.getById(itemId);
        if (!existing || existing.crew_id !== crewId) {
          return sendError(res, 404, 'Packing item not found', ErrorCodes.NOT_FOUND);
        }

        const item = await stores.crewPacking.update(itemId, req.validatedBody);
        io.to('crew:' + crewId).emit('crew:packing-updated', { item });
        return sendSuccess(res, { item });
      } catch (err: any) {
        log.error('update packing item error', { error: err.message });
        return sendError(res, 500, 'Failed to update packing item', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/packing/:itemId ────────────────────────────
  router.delete(
    '/:crewId/packing/:itemId',
    userAuth,
    rateLimit(30, 'crew-packing-delete'),
    validateParams(schemas.crewIdItemIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const itemId = sanitizeIdentifier(req.validatedParams.itemId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crewPacking.getById(itemId);
        if (!existing || existing.crew_id !== crewId) {
          return sendError(res, 404, 'Packing item not found', ErrorCodes.NOT_FOUND);
        }
        if (existing.created_by !== userId && membership.role !== 'owner') {
          return sendError(res, 403, 'Only creator or owner can remove item', ErrorCodes.FORBIDDEN);
        }

        await stores.crewPacking.delete(itemId);
        io.to('crew:' + crewId).emit('crew:packing-deleted', { itemId });
        return sendSuccess(res, { deleted: true });
      } catch (err: any) {
        log.error('delete packing item error', { error: err.message });
        return sendError(res, 500, 'Failed to remove packing item', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
