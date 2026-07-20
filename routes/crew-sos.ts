// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { RouteDeps } from '../lib/types';
import type { crewIdParams, sosRaiseSchema } from '../lib/schemas';
import { SOS_RAISE_LIMIT, markSosActive, clearSosActive } from '../lib/rate-limiting.js';
import { sanitizeString } from '../lib/helpers/sanitize.js';

/**
 * Crew SOS (Live Location + SOS, safety-critical path).
 *
 * DESIGN DEVIATION (justified): SOS raise/clear are HTTP POSTs, NOT socket
 * events. A safety feature must not be a fire-and-forget emit — it must be
 * reliable, validated, offline-detectable, and produce the durable side-effects
 * transactionally: one crew_activity row + a crew-wide socket broadcast + a
 * best-effort push fan-out. The socket only carries the resulting
 * `sos:raised` / `sos:cleared` broadcasts (clients never emit these).
 *
 * Ephemerality exception: live GPS is never persisted, but an SOS MAY attach a
 * single coarse coordinate (≈4 decimals, ~11m) to the activity row + push so the
 * crew can actually find the person. This is the only location datum that becomes
 * durable; it is opt-in (the user pressed SOS), capped, and crew-scoped.
 *
 * Two endpoints, mounted by routes/crews.ts alongside status/meeting-point:
 *   POST /:crewId/sos        — raise an SOS
 *   POST /:crewId/sos/clear  — clear it ("I'm safe" or any crew member)
 */
export default function createCrewSosRoutes(deps: RouteDeps) {
  const {
    log,
    config,
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
    notificationService,
    redis,
  } = deps;

  const router = Router({ mergeParams: true });

  /** Round a coordinate to ~4 decimals (~11m) — coarse enough for privacy, precise enough to find someone. */
  function coarse(n: number): number {
    return Math.round(n * 1e4) / 1e4;
  }

  // ── POST /:crewId/sos — raise an SOS ─────────────────────────────
  router.post(
    '/:crewId/sos',
    userAuth,
    rateLimit(10, 'crew-sos-raise'),
    validateParams(schemas.crewIdParams),
    validate(schemas.sosRaise),
    async (req: Request, res: Response) => {
      try {
        if (config?.SOS_ENABLED === false) {
          return sendError(res, 503, 'SOS is currently unavailable', ErrorCodes.SERVICE_UNAVAILABLE);
        }
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof sosRaiseSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;
        const username = req.user.username || 'A crew member';

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        // Precise per-user throttle (1 per 120s). Defense-in-depth on top of the
        // coarse Redis-backed rateLimit() middleware above.
        const limit = SOS_RAISE_LIMIT.consume(userId);
        if (!limit.allowed) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))));
          return sendError(res, 429, 'SOS already raised — wait before raising again', ErrorCodes.RATE_LIMITED);
        }

        // L1: run the SOS message through sanitizeString (NFC + strip control/
        // bidi/zero-width chars + cap) — matching every other crew free-text
        // field — before it reaches crew_activity.detail, the socket payload, and
        // the push body. Prevents RTL-override / zero-width spoofing on a
        // safety-critical surface.
        const message = sanitizeString(body.message, 280) || undefined;
        const position = body.position
          ? {
              lat: coarse(body.position.lat),
              lng: coarse(body.position.lng),
              accuracy: body.position.accuracy,
              capturedAt: body.position.capturedAt,
            }
          : undefined;

        // Durable side-effect #1: one crew_activity row. Detail = capped message
        // + optional coarse coords (the single intentional durable location datum).
        const detailParts: string[] = [];
        if (message) detailParts.push(message.slice(0, 280));
        if (position) detailParts.push(`@${position.lat},${position.lng}`);
        const detail = detailParts.join(' ') || null;

        let activityId: string | null = null;
        try {
          activityId = (await stores.activity.log({ crewId, userId, type: 'sos_raised', detail })) as string;
        } catch (err: any) {
          // The activity row is the durable record of the SOS — if it fails we
          // still broadcast + push (best-effort), but log loudly.
          log.error('sos activity log failed', { error: err?.message, crewId, userId });
        }

        const raisedAt = new Date().toISOString();
        const payload = {
          _v: 1,
          crewId,
          userId,
          username,
          message,
          position,
          activityId: activityId || '',
          raisedAt,
        };

        // L3: mark this crew's SOS active (cluster-wide, Redis-backed) so a
        // subsequent /sos/clear is a real clear and clear-spam on an inactive
        // crew is a no-op/409. Best-effort; failure never blocks the raise.
        await markSosActive(redis, crewId);

        // Durable side-effect #2: crew-wide socket broadcast (primary delivery).
        if (io) io.to('crew:' + crewId).emit('sos:raised', payload);

        // Best-effort side-effect #3: push fan-out to the rest of the crew. MUST
        // NOT block or fail the HTTP response — the socket broadcast + activity
        // row are the primary delivery; push is the offline-reach layer.
        if (notificationService?.send) {
          fanoutSosPush({ crewId, raiserId: userId, username, message, position }).catch((err: any) =>
            log.warn('sos push fan-out failed', { error: err?.message, crewId }),
          );
        }

        log.info('crew:sos-raised', { crewId, userId, hasPosition: Boolean(position) });
        return sendSuccess(res, { code: 'OK', activityId: activityId || null, raisedAt });
      } catch (err) {
        log.error('sos raise failed', { error: (err as Error).message, crewId: (req.validatedParams as any)?.crewId });
        return sendError(res, 500, 'Failed to raise SOS', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/sos/clear — clear an SOS ───────────────────────
  router.post(
    '/:crewId/sos/clear',
    userAuth,
    rateLimit(20, 'crew-sos-clear'),
    validateParams(schemas.crewIdParams),
    validate(schemas.sosClear),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;
        const username = req.user.username || 'A crew member';

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        // L3: only clear if an SOS is actually active. This blocks clear-spam
        // (each clear is a DND-adjacent crew-wide broadcast). The check is
        // atomic (DEL returns whether the key existed). When Redis is
        // unavailable (`unknown`) we fail-open and proceed — a safety-critical
        // "I'm safe" must never be silently swallowed by a degraded cache.
        const cleared = await clearSosActive(redis, crewId);
        if (cleared.wasActive === false) {
          return sendError(res, 409, 'No active SOS to clear', ErrorCodes.ALREADY_EXISTS);
        }

        let activityId: string | null = null;
        try {
          activityId = (await stores.activity.log({ crewId, userId, type: 'sos_cleared', detail: null })) as string;
        } catch (err: any) {
          log.error('sos clear activity log failed', { error: err?.message, crewId, userId });
        }

        const clearedAt = new Date().toISOString();
        if (io) {
          io.to('crew:' + crewId).emit('sos:cleared', {
            _v: 1,
            crewId,
            userId,
            clearedBy: username,
            activityId: activityId || undefined,
            clearedAt,
          });
        }

        log.info('crew:sos-cleared', { crewId, userId });
        return sendSuccess(res, { code: 'OK', activityId: activityId || null, clearedAt });
      } catch (err) {
        log.error('sos clear failed', { error: (err as Error).message, crewId: (req.validatedParams as any)?.crewId });
        return sendError(res, 500, 'Failed to clear SOS', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  /**
   * Per-member push fan-out for an SOS. Small N (a crew, not a festival), so a
   * per-user send is fine and avoids the festival-wide sendToOfflineUsers path.
   * 'crew_sos' is safety-critical (bypasses DND + per-type opt-out in send()).
   */
  async function fanoutSosPush({ crewId, raiserId, username, message, position }: any) {
    const members = await stores.crews.getMembers(crewId);
    const recipients = members.filter((m: any) => m.userId && m.userId !== raiserId);
    const data: Record<string, any> = { crewId, userId: raiserId, deepLink: `rave://crew/${crewId}/sos` };
    if (position) {
      data.lat = String(position.lat);
      data.lng = String(position.lng);
    }
    await Promise.allSettled(
      recipients.map((m: any) =>
        notificationService.send({
          userId: m.userId,
          type: 'crew_sos',
          title: `${username} raised an SOS`,
          body: message || 'Tap to see their location',
          data,
          threadId: `sos-${crewId}`,
        }),
      ),
    );
  }

  return router;
}
