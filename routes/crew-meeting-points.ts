import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { RouteDeps } from '../lib/types';
import type {
  crewIdParams,
  crewIdMpIdParams,
  crewHomeBaseSchema,
  meetingPointCreateSchema,
  meetingPointUpdateSchema,
} from '../lib/schemas';

const MAX_MEETING_POINTS_PER_CREW = 20;

export default function createCrewMeetingPointRoutes(deps: RouteDeps) {
  const {
    log,
    userAuth,
    sanitizeIdentifier,
    createOpaqueId,
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

  // ── PUT /:crewId/home-base — set crew meeting point ─────────────
  router.put(
    '/:crewId/home-base',
    userAuth,
    rateLimit(10, 'crew-homebase'),
    validateParams(schemas.crewIdParams),
    validate(schemas.crewHomeBase),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof crewHomeBaseSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        if (member.role !== 'owner') return sendError(res, 403, 'Only owner can set home base', ErrorCodes.FORBIDDEN);

        const { location, time } = body;
        const updated = await stores.crews.updateHomeBase(crewId, { location, time });
        io.to('crew:' + crewId).emit('crew:home-base-updated', { crewId, location, time });
        await stores.activity
          .log({ crewId, userId: req.user.userId, type: 'home-base-updated', detail: location || null })
          .catch(() => {});
        return sendSuccess(res, { crew: updated });
      } catch (err) {
        log.error('set home base failed', { error: (err as Error).message });
        return sendError(res, 500, 'Failed to update home base', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /:crewId/meeting-points ─────────────────────────────────
  router.get(
    '/:crewId/meeting-points',
    userAuth,
    rateLimit(120, 'crew-mp-list'),
    validateParams(schemas.crewIdParams),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const crewId = sanitizeIdentifier(params.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const points = await stores.crews.meetingPoints.listByCrew(crewId);
        return sendSuccess(res, { meetingPoints: points });
      } catch (err) {
        log.error('get meeting points failed', { error: (err as Error).message });
        return sendError(res, 500, 'Failed to load meeting points', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/meeting-points ────────────────────────────────
  router.post(
    '/:crewId/meeting-points',
    userAuth,
    rateLimit(20, 'crew-mp-create'),
    validateParams(schemas.crewIdParams),
    validate(schemas.meetingPointCreate),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof meetingPointCreateSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const count = await stores.crews.meetingPoints.countByCrew(crewId);
        if (count >= MAX_MEETING_POINTS_PER_CREW) {
          return sendError(
            res,
            400,
            'Maximum ' + MAX_MEETING_POINTS_PER_CREW + ' meeting points per crew',
            ErrorCodes.VALIDATION_ERROR,
          );
        }

        const { label, location, type, meetAt, stageReference, latitude, longitude } = body;
        const id = createOpaqueId('mp');
        let expiresAt = null;
        if (meetAt) {
          expiresAt = new Date(new Date(meetAt).getTime() + 30 * 60_000).toISOString();
        }

        const point = await stores.crews.meetingPoints.create({
          id,
          crewId,
          createdBy: req.user.userId,
          label,
          location,
          type: type || 'during',
          meetAt,
          stageReference,
          expiresAt,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        });

        io.to('crew:' + crewId).emit('crew:meeting-point-created', point);
        res.status(201);
        return sendSuccess(res, { meetingPoint: point });
      } catch (err) {
        log.error('create meeting point failed', { error: (err as Error).message });
        return sendError(res, 500, 'Failed to create meeting point', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── PUT /:crewId/meeting-points/:mpId ───────────────────────────
  router.put(
    '/:crewId/meeting-points/:mpId',
    userAuth,
    rateLimit(20, 'crew-mp-update'),
    validateParams(schemas.crewIdMpIdParams),
    validate(schemas.meetingPointUpdate),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdMpIdParams>;
        const body = req.validatedBody as z.infer<typeof meetingPointUpdateSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const mpId = sanitizeIdentifier(params.mpId);

        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crews.meetingPoints.getById(mpId);
        if (!existing || existing.crew_id !== crewId || !existing.active) {
          return sendError(res, 404, 'Meeting point not found', ErrorCodes.NOT_FOUND);
        }

        if (existing.created_by !== req.user.userId && member.role !== 'owner') {
          return sendError(res, 403, 'Only the creator or crew owner can edit', ErrorCodes.FORBIDDEN);
        }

        const updated = await stores.crews.meetingPoints.update(mpId, body);
        io.to('crew:' + crewId).emit('crew:meeting-point-updated', updated);
        return sendSuccess(res, { meetingPoint: updated });
      } catch (err) {
        log.error('update meeting point failed', { error: (err as Error).message });
        return sendError(res, 500, 'Failed to update meeting point', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/meeting-points/:mpId ────────────────────────
  router.delete(
    '/:crewId/meeting-points/:mpId',
    userAuth,
    rateLimit(20, 'crew-mp-delete'),
    validateParams(schemas.crewIdMpIdParams),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdMpIdParams>;
        const crewId = sanitizeIdentifier(params.crewId);
        const mpId = sanitizeIdentifier(params.mpId);

        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crews.meetingPoints.getById(mpId);
        if (!existing || existing.crew_id !== crewId || !existing.active) {
          return sendError(res, 404, 'Meeting point not found', ErrorCodes.NOT_FOUND);
        }

        if (existing.created_by !== req.user.userId && member.role !== 'owner') {
          return sendError(res, 403, 'Only the creator or crew owner can remove', ErrorCodes.FORBIDDEN);
        }

        await stores.crews.meetingPoints.deactivate(mpId);
        io.to('crew:' + crewId).emit('crew:meeting-point-removed', { id: mpId, crewId });
        return sendSuccess(res, { removed: true });
      } catch (err) {
        log.error('delete meeting point failed', { error: (err as Error).message });
        return sendError(res, 500, 'Failed to remove meeting point', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
