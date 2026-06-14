import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { RouteDeps } from '../lib/types';
import type {
  crewIdParams,
  crewIdMpIdParams,
  crewHomeBaseSchema,
  crewPhotoAlbumSchema,
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

  // ── PUT /:crewId/photo-album — set/clear crew shared-album URL ───
  // M6 Crew Photo Wall (Phase 1, link-out only). Member-gated (NOT owner-only):
  // any crew member can set or clear the shared album link. Pass an empty/null
  // photoAlbumUrl to clear it. Festie hosts no photos yet; this is a link-out.
  router.put(
    '/:crewId/photo-album',
    userAuth,
    rateLimit(10, 'crew-photo-album'),
    validateParams(schemas.crewIdParams),
    validate(schemas.crewPhotoAlbum),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof crewPhotoAlbumSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const photoAlbumUrl = body.photoAlbumUrl || null;
        const updated = await stores.crews.updatePhotoAlbum(crewId, { photoAlbumUrl });
        io.to('crew:' + crewId).emit('crew:photo-album-updated', { crewId, photoAlbumUrl });
        await stores.activity
          .log({ crewId, userId: req.user.userId, type: 'photo-album-updated', detail: photoAlbumUrl })
          .catch(() => {});
        return sendSuccess(res, { crew: updated });
      } catch (err) {
        log.error('set photo album failed', { error: (err as Error).message });
        return sendError(res, 500, 'Failed to update photo album', ErrorCodes.INTERNAL_ERROR);
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

        const { label, location, type, meetAt, stageReference, latitude, longitude, recursDaily } = body;
        const id = createOpaqueId('mp');
        // A one-shot timed point auto-expires 30 min after its meet time. A
        // recurring point (recursDaily) must NOT expire — it repeats every
        // festival day, so leave expires_at NULL or the expireStale() sweep
        // would deactivate it after the first occurrence (055).
        let expiresAt = null;
        if (meetAt && !recursDaily) {
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
          // 055: optional daily recurrence; defaults FALSE in the store when omitted.
          recursDaily: recursDaily ?? false,
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

        // Recompute expiry from the EFFECTIVE (post-merge) meetAt + recurrence so an
        // edit can't strand a stale expires_at. A recurring point must NEVER expire
        // (else the expireStale() sweep deactivates it after its first occurrence);
        // re-timing a one-shot point must move its expiry with it. Mirrors create.
        const effMeetAt = (body.meetAt !== undefined ? body.meetAt : existing.meet_at) as string | null | undefined;
        const effRecurs = body.recursDaily !== undefined ? body.recursDaily : existing.recurs_daily;
        let expiresAt: string | null = null;
        if (effMeetAt && !effRecurs) {
          expiresAt = new Date(new Date(effMeetAt).getTime() + 30 * 60_000).toISOString();
        }

        const updated = await stores.crews.meetingPoints.update(mpId, { ...body, expiresAt });
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
