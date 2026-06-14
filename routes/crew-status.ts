import { Router } from 'express';

/**
 * Crew member status (M5: last-synced "on my way / ETA to [meeting point]").
 *
 * CARDINAL RULE: this is offline-DEGRADED-SYNCS, NOT live GPS streaming. A row
 * is a snapshot the member set (often offline) that delivers on the next signal
 * blip; the UI renders `updated_at` as honest staleness ("as of N ago") and
 * NEVER implies real-time. Clients capture the status offline; the offline queue
 * collapses toggles on a deterministic clientId and replays the latest on
 * reconnect (PUT is idempotent — one row per crew member, upsert-replaced).
 *
 * A new crew sub-resource cloning routes/crew-polls.ts / routes/crew-packing.ts:
 * userAuth + getMember gate + rate limit + io.to('crew:'+id).emit. Mounted by
 * routes/crews.ts. Two endpoints:
 *   PUT  /:crewId/status  — upsert MY own status (the member can only set their own)
 *   GET  /:crewId/status  — list the crew's statuses (honest staleness rendered client-side)
 */
export default function createCrewStatusRoutes(deps: any) {
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

  // ── GET /:crewId/status — list crew member statuses ────────────
  router.get(
    '/:crewId/status',
    userAuth,
    rateLimit(120, 'crew-status-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;
        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const statuses = await stores.crewStatus.listByCrew(crewId);
        return sendSuccess(res, { statuses });
      } catch (err: any) {
        log.error('get crew status error', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to list crew status', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── PUT /:crewId/status — upsert MY OWN status ─────────────────
  // The member can only set their own status (keyed on req.user.userId), so no
  // ownership check beyond crew membership. Idempotent: re-running with the same
  // body lands the same row (offline replay-safe).
  router.put(
    '/:crewId/status',
    userAuth,
    rateLimit(60, 'crew-status-update'),
    validateParams(schemas.crewIdParams),
    validate(schemas.crewStatus),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;
        const { status, targetMeetingPointId, etaMinutes, note, position } = req.validatedBody;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        // 055: optional offline presence breadcrumb. NOT live GPS — a last-known
        // coord the member captured (often offline) that syncs on the next blip.
        // When a position arrives without an offline-stamped capturedAt, default
        // location_captured_at to now() so the UI always has an honest "as of"
        // timestamp. A status-only update (no position) leaves the prior
        // breadcrumb untouched (the store COALESCEs it).
        const row = await stores.crewStatus.upsert({
          crewId,
          userId,
          status: status ?? null,
          targetMeetingPointId: targetMeetingPointId ?? null,
          etaMinutes: etaMinutes ?? null,
          note: note ?? null,
          latitude: position ? position.lat : null,
          longitude: position ? position.lng : null,
          locationCapturedAt: position ? (position.capturedAt ?? new Date().toISOString()) : null,
        });

        // Broadcast to the crew room so any open client patches in place. The
        // payload IS the upserted row (snake_case) so the client can render it
        // with honest staleness from `updated_at`.
        io.to('crew:' + crewId).emit('crew:status-updated', { status: row });
        return sendSuccess(res, { status: row });
      } catch (err: any) {
        log.error('update crew status error', { error: err.message });
        return sendError(res, 500, 'Failed to update crew status', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
