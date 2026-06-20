// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';

export default function createFestivalsRoutes(deps: any) {
  const {
    express,
    config,
    log,
    adminAuth,
    getFestivals,
    getFestivalById,
    validateFestival,
    sanitizeFestivalPayload,
    removeFestivalSockets,
    getRequestIp,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    io,
    stores,
    emitter,
    schemas,
    validate,
    validateQuery,
    validateParams,
    invalidateFestivalCache,
  } = deps;

  const router = express.Router();

  let _festivalListCache: any = null;
  let _festivalListETag: any = null;
  let _festivalListVersion: any = null;

  function invalidateFestivalListCache() {
    _festivalListCache = null;
    _festivalListETag = null;
    _festivalListVersion = null;
  }

  /**
   * H1 (festival delete): evict members from every `crew:${crewId}` room under a
   * festival before its crews are cascaded away. removeFestivalSockets only
   * drops sockets from the festival-presence room (socket.leave(festivalId)) —
   * it does NOT touch the crew rooms, so without this every connected crew
   * member keeps receiving live location/SOS/status broadcasts for a crew whose
   * festival no longer exists, and keeps a stamped sharingCrewId, until they
   * disconnect. Mirrors the whole-crew-delete eviction in routes/admin-bulk.ts.
   *
   * Best-effort: a failure must never fail the HTTP delete (DB rows are already
   * gone / about to go); io may be absent in some test/CLI contexts.
   */
  async function evictFestivalCrewRooms(festivalId: string) {
    if (!io || typeof io.in !== 'function' || !stores.crews?.listByFestival) return;
    try {
      const crews = await stores.crews.listByFestival(festivalId);
      for (const crew of crews) {
        const crewId = crew?.id;
        if (!crewId) continue;
        const room = `crew:${crewId}`;
        io.to(room).emit('crew:deleted', { crewId });
        const sockets = await io.in(room).fetchSockets();
        for (const s of sockets) {
          if (s.data?.sharingCrewId === crewId) delete s.data.sharingCrewId;
          delete s.data.crewMembershipCheckedAt;
          delete s.data.crewMembershipUpdateCount;
          s.leave(room);
        }
      }
    } catch (error: any) {
      log.warn('festival crew room eviction failed', { error: error?.message, festivalId });
    }
  }

  // Audit log helper — writes to audit_log table if available (async, fire-and-forget with error handling)
  function audit(action: any, targetType: any, targetId: any, req: any, details: any = {}) {
    if (!stores.auditLog) return;
    // Fire async without awaiting to avoid blocking HTTP response
    Promise.resolve().then(async () => {
      try {
        await stores.auditLog.insert({
          id: crypto.randomUUID(),
          actorType: req.adminSession ? 'admin' : 'user',
          actorId: req.adminSession ? 'admin' : req.user?.userId,
          action,
          targetType,
          targetId,
          detailsJson: Object.keys(details).length > 0 ? JSON.stringify(details) : null,
          ip: getRequestIp(req),
        });
      } catch (e: any) {
        log.warn('audit log write failed', { error: e.message });
      }
    });
  }

  router.get('/', rateLimit(120, 'festival-list'), async (req: any, res: any) => {
    try {
      const festivals = await getFestivals();
      // Lightweight cache: recompute only when festival data changes
      const version = festivals.map((f: any) => f.updatedAt || f.createdAt || '').join(',');
      if (version !== _festivalListVersion) {
        _festivalListCache = festivals.map((festival: any) => {
          // Derive the date range from the already-loaded day dates (the
          // festivals table has no start/end columns). Lets the picker show the
          // date + an upcoming/past status without a detail fetch.
          const dates = (festival.days || [])
            .map((d: any) => d.date)
            .filter(Boolean)
            .sort();
          return {
            id: festival.id,
            name: festival.name,
            location: festival.location,
            stageCount: festival.stages?.length || 0,
            dayCount: festival.days?.length || 0,
            startDate: dates[0] || null,
            endDate: dates[dates.length - 1] || null,
          };
        });
        _festivalListETag = `"${crypto.createHash('md5').update(JSON.stringify(_festivalListCache)).digest('hex').slice(0, 16)}"`;
        _festivalListVersion = version;
      }
      res.setHeader('ETag', _festivalListETag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === _festivalListETag) {
        return res.status(304).end();
      }
      return sendSuccess(res, _festivalListCache);
    } catch (error: any) {
      log.error('festivals list failed', { error: error.message });
      return sendError(res, 500, 'Failed to load festivals', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Resolve which festival a set belongs to — powers https deep links
  // (festie.us/set/:id): web + mobile look up the festival, load it, then open
  // the set. Public, no user data; just the festivalId. Declared before `/:id`
  // for clarity (the two-segment path can't collide with the one-segment one).
  router.get('/locate-set/:setId', rateLimit(120, 'festival-locate-set'), async (req: any, res: any) => {
    try {
      const setId = String(req.params.setId || '');
      if (!setId) return sendError(res, 400, 'Set ID required', ErrorCodes.INVALID_INPUT);
      const result = await stores.pool.query('SELECT festival_id FROM festival_sets WHERE id = $1 LIMIT 1', [setId]);
      if (!result.rows.length) return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
      res.setHeader('Cache-Control', 'public, max-age=300');
      return sendSuccess(res, { festivalId: result.rows[0].festival_id });
    } catch (error: any) {
      log.error('locate-set failed', { error: error.message });
      return sendError(res, 500, 'Failed to locate set', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Tiered data loading (OpenViking L0/L1/L2 pattern):
  //   ?depth=0 → name, id, location only (already served by GET /)
  //   ?depth=1 → stages + days with set names (no profiles/messages) — default for mobile initial load
  //   ?depth=2 (or omitted) → full festival data (backward compatible default)
  router.get(
    '/:id',
    rateLimit(120, 'festival-detail'),
    validateParams(schemas.genericIdParams),
    validateQuery(schemas.festivalDepthQuery),
    async (req: any, res: any) => {
      try {
        const festival = await getFestivalById(req.validatedParams.id);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        // Public festival structure (stages/days/sets) — no user data. Use
        // `no-cache` (revalidate) rather than `no-store` (never cache) so the
        // service worker can serve the last-known copy when offline while
        // still fetching fresh data when the network is available.
        res.setHeader('Cache-Control', 'no-cache');

        const depth = req.validatedQuery.depth;
        if (depth === 1) {
          // L1: structural overview — stages, days with set names/times, no full profile data
          return sendSuccess(res, {
            id: festival.id,
            name: festival.name,
            location: festival.location,
            stages: (festival.stages || []).map((s: any) => ({ id: s.id, name: s.name, color: s.color })),
            days: (festival.days || []).map((d: any) => ({
              label: d.label,
              date: d.date,
              sets: (d.sets || []).map((s: any) => ({
                id: s.id,
                artist: s.artist,
                artists: s.artists || [],
                stageId: s.stageId,
                startTime: s.startTime,
                endTime: s.endTime,
              })),
            })),
            createdAt: festival.createdAt,
            updatedAt: festival.updatedAt,
          });
        }

        // depth=2 or omitted: full festival (backward compatible)
        return sendSuccess(res, festival);
      } catch (error: any) {
        log.error('festival load failed', { error: error.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to load festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.post(
    '/',
    adminAuth,
    rateLimit(10, 'festival-create'),
    validate(schemas.festivalCreate),
    async (req: any, res: any) => {
      try {
        const validationErrors = validateFestival(config, req.validatedBody);
        if (validationErrors.length > 0) {
          return sendError(res, 400, validationErrors.join('; '), ErrorCodes.INVALID_INPUT);
        }
        const festival = sanitizeFestivalPayload(req.validatedBody);
        await stores.festivals.create(festival);
        invalidateFestivalCache();
        invalidateFestivalListCache();
        log.info('festival:created', { festivalId: festival.id, name: festival.name });
        audit('festival:create', 'festival', festival.id, req, { name: festival.name });
        emitter.festivalCreated({ id: festival.id, name: festival.name });
        res.status(201);
        return sendSuccess(res, festival);
      } catch (error: any) {
        log.error('festival create failed', { error: error.message });
        return sendError(res, 500, 'Failed to create festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.put(
    '/:id',
    adminAuth,
    rateLimit(10, 'festival-update'),
    validateParams(schemas.genericIdParams),
    validate(schemas.festivalUpdate),
    async (req: any, res: any) => {
      try {
        const validationErrors = validateFestival(config, req.validatedBody);
        if (validationErrors.length > 0) {
          return sendError(res, 400, validationErrors.join('; '), ErrorCodes.INVALID_INPUT);
        }
        const existingFestival = await getFestivalById(req.validatedParams.id);
        if (!existingFestival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

        const nextFestival = sanitizeFestivalPayload(req.validatedBody, existingFestival);
        const festival = await stores.festivals.update(req.validatedParams.id, {
          name: nextFestival.name,
          location: nextFestival.location,
          b2bSeparator: nextFestival.b2bSeparator,
          timeZone: nextFestival.timeZone,
          stages: nextFestival.stages,
          days: nextFestival.days,
        });
        invalidateFestivalCache();

        invalidateFestivalListCache();
        log.info('festival:updated', { festivalId: festival.id, name: festival.name });
        audit('festival:update', 'festival', festival.id, req, { name: festival.name });
        emitter.festivalUpdated({ festival });
        return sendSuccess(res, festival);
      } catch (error: any) {
        log.error('festival update failed', { error: error.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to update festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // P3.18: Soft-delete (default). Pass ?hard=true for permanent removal.
  router.delete(
    '/:id',
    adminAuth,
    rateLimit(5, 'festival-delete'),
    validateParams(schemas.genericIdParams),
    validateQuery(schemas.festivalDeleteQuery),
    async (req: any, res: any) => {
      try {
        const festival = await getFestivalById(req.validatedParams.id);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        const festivalId = festival.id;
        const hardDelete = req.validatedQuery.hard === 'true';

        // H1: evict crew-room sockets BEFORE the delete (hard-delete cascades the
        // crews away; soft-delete makes them inaccessible) while listByFestival
        // can still resolve them. removeFestivalSockets below only clears the
        // festival-presence room, not the per-crew rooms.
        await evictFestivalCrewRooms(festivalId);

        if (!hardDelete && stores.festivals?.softDelete) {
          // Soft-delete: mark as deleted, preserve data for potential restore
          await stores.festivals.softDelete(festivalId);
        } else {
          // Hard delete: permanently remove all data (including crew children)
          // inside a single transaction. Migration 031 changed all festival FKs
          // from CASCADE to RESTRICT, so hardDelete deletes child rows
          // explicitly in dependency order.
          await stores.festivals.hardDelete(festivalId);
        }
        invalidateFestivalCache();

        removeFestivalSockets(festivalId, io);
        invalidateFestivalListCache();
        audit(hardDelete ? 'festival:hard-delete' : 'festival:soft-delete', 'festival', festivalId, req, {
          name: festival.name,
        });
        log.warn('admin:delete-festival', {
          festivalId,
          festivalName: festival.name,
          hard: hardDelete,
          ip: getRequestIp(req),
        });
        emitter.festivalDeleted({ id: festivalId });
        return sendSuccess(res, { success: true, softDeleted: !hardDelete });
      } catch (error: any) {
        log.error('festival delete failed', { error: error.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to delete festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // PUT /:festivalId/sets/:setId/link — Admin: set a Spotify/SoundCloud link on a set
  router.put(
    '/:festivalId/sets/:setId/link',
    adminAuth,
    rateLimit(10, 'set-link'),
    validate(schemas.setLink),
    async (req: any, res: any) => {
      try {
        const festivalId = req.params.festivalId;
        const setId = req.params.setId;
        const { linkUrl } = req.validatedBody;

        if (!festivalId || !setId)
          return sendError(res, 400, 'Festival and set IDs required', ErrorCodes.INVALID_INPUT);

        const festival = await getFestivalById(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

        // Validate the set exists in this festival
        const allSets = (festival.days || []).flatMap((d: any) => d.sets || []);
        const set = allSets.find((s: any) => s.id === setId);
        if (!set) return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);

        // Validated by Zod schema — normalize to null if empty
        const cleanUrl = linkUrl && typeof linkUrl === 'string' && linkUrl.trim() ? linkUrl.trim() : null;

        // Update both link_url (backward compat) and artists JSONB
        await stores.pool.query('UPDATE festival_sets SET link_url = $1 WHERE id = $2 AND festival_id = $3', [
          cleanUrl,
          setId,
          festivalId,
        ]);
        // Update first artist's spotify link in artists JSONB
        if (set.artists?.length > 0) {
          const updatedArtists = [...set.artists];
          if (!updatedArtists[0].links) updatedArtists[0].links = {};
          if (cleanUrl) updatedArtists[0].links.spotify = cleanUrl;
          else delete updatedArtists[0].links.spotify;
          await stores.pool.query('UPDATE festival_sets SET artists = $1 WHERE id = $2 AND festival_id = $3', [
            JSON.stringify(updatedArtists),
            setId,
            festivalId,
          ]);
        }
        await stores.pool.query('UPDATE festivals SET updated_at = NOW() WHERE id = $1', [festivalId]);
        invalidateFestivalCache();

        audit('set:link-update', 'set', setId, req, { festivalId, linkUrl: cleanUrl });
        log.info('set link updated', {
          festivalId,
          setId,
          linkUrl: cleanUrl ? 'set' : 'cleared',
          ip: getRequestIp(req),
        });
        return sendSuccess(res, { setId, linkUrl: cleanUrl });
      } catch (error: any) {
        log.error('set link update failed', { error: error.message });
        return sendError(res, 500, 'Failed to update set link', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // GET /:festivalId/sets/links — Admin: list all set links for a festival
  router.get('/:festivalId/sets/links', adminAuth, async (req: any, res: any) => {
    try {
      const festivalId = req.params.festivalId;
      const result = await stores.pool.query(
        'SELECT id, artist, link_url AS "linkUrl", artists FROM festival_sets WHERE festival_id = $1 AND (link_url IS NOT NULL OR artists != \'[]\'::jsonb) ORDER BY artist',
        [festivalId],
      );
      return sendSuccess(res, result.rows);
    } catch (error: any) {
      log.error('set links list failed', { error: error.message });
      return sendError(res, 500, 'Failed to load set links', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
