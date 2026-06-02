import { Router } from 'express';

const MAX_MEETING_POINTS_PER_CREW = 20;

export default function createCrewMeetingPointRoutes(deps: any) {
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
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        if (member.role !== 'owner') return sendError(res, 403, 'Only owner can set home base', ErrorCodes.FORBIDDEN);

        const { location, time } = req.validatedBody;
        const updated = await stores.crews.updateHomeBase(crewId, { location, time });
        io.to('crew:' + crewId).emit('crew:home-base-updated', { crewId, location, time });
        await stores.activity
          .log({ crewId, userId: req.user.userId, type: 'home-base-updated', detail: location || null })
          .catch(() => {});
        return sendSuccess(res, { crew: updated });
      } catch (err: any) {
        log.error('set home base failed', { error: err.message });
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
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const points = await stores.crews.meetingPoints.listByCrew(crewId);
        return sendSuccess(res, { meetingPoints: points });
      } catch (err: any) {
        log.error('get meeting points failed', { error: err.message });
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
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
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

        const { label, location, type, meetAt, stageReference } = req.validatedBody;
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
        });

        io.to('crew:' + crewId).emit('crew:meeting-point-created', point);
        res.status(201);
        return sendSuccess(res, { meetingPoint: point });
      } catch (err: any) {
        log.error('create meeting point failed', { error: err.message });
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
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const mpId = sanitizeIdentifier(req.validatedParams.mpId);

        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crews.meetingPoints.getById(mpId);
        if (!existing || existing.crew_id !== crewId || !existing.active) {
          return sendError(res, 404, 'Meeting point not found', ErrorCodes.NOT_FOUND);
        }

        if (existing.created_by !== req.user.userId && member.role !== 'owner') {
          return sendError(res, 403, 'Only the creator or crew owner can edit', ErrorCodes.FORBIDDEN);
        }

        const updated = await stores.crews.meetingPoints.update(mpId, req.validatedBody);
        io.to('crew:' + crewId).emit('crew:meeting-point-updated', updated);
        return sendSuccess(res, { meetingPoint: updated });
      } catch (err: any) {
        log.error('update meeting point failed', { error: err.message });
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
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const mpId = sanitizeIdentifier(req.validatedParams.mpId);

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
      } catch (err: any) {
        log.error('delete meeting point failed', { error: err.message });
        return sendError(res, 500, 'Failed to remove meeting point', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
