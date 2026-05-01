// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
module.exports = function createFestivalsRoutes(deps) {
  const {
    express, config, log,
    adminAuth, setNoStore,
    getFestivals, getFestivalById,
    validateFestival, sanitizeFestivalPayload,
    removeFestivalSockets, getRequestIp,
    sendSuccess, sendError, ErrorCodes,
    rateLimit,
    io, stores, emitter,
    schemas, validate, invalidateFestivalCache,
  } = deps;

  const router = express.Router();
  const crypto = require('crypto');

  let _festivalListCache = null;
  let _festivalListETag = null;
  let _festivalListVersion = null;

  function invalidateFestivalListCache() {
    _festivalListCache = null;
    _festivalListETag = null;
    _festivalListVersion = null;
  }

  // Audit log helper — writes to audit_log table if available (async, fire-and-forget with error handling)
  function audit(action, targetType, targetId, req, details = {}) {
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
      } catch (e) {
        log.debug('audit log write failed', { error: e.message });
      }
    });
  }

  router.get('/', rateLimit(120, 'festival-list'), async (req, res) => {
    try {
      const festivals = await getFestivals();
      // Lightweight cache: recompute only when festival data changes
      const version = festivals.map((f) => f.updatedAt || f.createdAt || '').join(',');
      if (version !== _festivalListVersion) {
        _festivalListCache = festivals.map((festival) => ({
          id: festival.id,
          name: festival.name,
          location: festival.location,
          stageCount: festival.stages?.length || 0,
          dayCount: festival.days?.length || 0,
        }));
        _festivalListETag = `"${crypto.createHash('md5').update(JSON.stringify(_festivalListCache)).digest('hex').slice(0, 16)}"`;
        _festivalListVersion = version;
      }
      res.setHeader('ETag', _festivalListETag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === _festivalListETag) {
        return res.status(304).end();
      }
      return sendSuccess(res, _festivalListCache);
    } catch (error) {
      log.error('festivals list failed', { error: error.message });
      return sendError(res, 500, 'Failed to load festivals', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Tiered data loading (OpenViking L0/L1/L2 pattern):
  //   ?depth=0 → name, id, location only (already served by GET /)
  //   ?depth=1 → stages + days with set names (no profiles/messages) — default for mobile initial load
  //   ?depth=2 (or omitted) → full festival data (backward compatible default)
  router.get('/:id', rateLimit(120, 'festival-detail'), async (req, res) => {
    try {
      const festival = await getFestivalById(req.params.id);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      // Public festival structure (stages/days/sets) — no user data. Use
      // `no-cache` (revalidate) rather than `no-store` (never cache) so the
      // service worker can serve the last-known copy when offline while
      // still fetching fresh data when the network is available.
      res.setHeader('Cache-Control', 'no-cache');

      const depth = req.query.depth !== undefined ? parseInt(req.query.depth, 10) : undefined;
      if (depth !== undefined && (!Number.isFinite(depth) || depth < 0 || depth > 2)) {
        return sendError(res, 400, 'Invalid depth parameter (0-2)', ErrorCodes.INVALID_INPUT);
      }
      if (depth === 1) {
        // L1: structural overview — stages, days with set names/times, no full profile data
        return sendSuccess(res, {
          id: festival.id,
          name: festival.name,
          location: festival.location,
          stages: (festival.stages || []).map(s => ({ id: s.id, name: s.name, color: s.color })),
          days: (festival.days || []).map(d => ({
            label: d.label,
            date: d.date,
            sets: (d.sets || []).map(s => ({
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
    } catch (error) {
      log.error('festival load failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to load festival', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/', adminAuth, rateLimit(10, 'festival-create'), validate(schemas.festivalCreate), async (req, res) => {
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
    } catch (error) {
      log.error('festival create failed', { error: error.message });
      return sendError(res, 500, 'Failed to create festival', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.put('/:id', adminAuth, rateLimit(10, 'festival-update'), validate(schemas.festivalUpdate), async (req, res) => {
    try {
      const validationErrors = validateFestival(config, req.validatedBody);
      if (validationErrors.length > 0) {
        return sendError(res, 400, validationErrors.join('; '), ErrorCodes.INVALID_INPUT);
      }
      const existingFestival = await getFestivalById(req.params.id);
      if (!existingFestival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      const nextFestival = sanitizeFestivalPayload(req.validatedBody, existingFestival);
      const festival = await stores.festivals.update(req.params.id, {
        name: nextFestival.name,
        location: nextFestival.location,
        b2bSeparator: nextFestival.b2bSeparator,
        stages: nextFestival.stages,
        days: nextFestival.days,
      });
      invalidateFestivalCache();

      invalidateFestivalListCache();
      log.info('festival:updated', { festivalId: festival.id, name: festival.name });
      audit('festival:update', 'festival', festival.id, req, { name: festival.name });
      emitter.festivalUpdated({ festival });
      return sendSuccess(res, festival);
    } catch (error) {
      log.error('festival update failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to update festival', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // P3.18: Soft-delete (default). Pass ?hard=true for permanent removal.
  router.delete('/:id', adminAuth, rateLimit(5, 'festival-delete'), async (req, res) => {
    try {
      const festival = await getFestivalById(req.params.id);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      const festivalId = festival.id;
      const hardDelete = req.query.hard === 'true';

      if (!hardDelete && stores.festivals?.softDelete) {
        // Soft-delete: mark as deleted, preserve data for potential restore
        await stores.festivals.softDelete(festivalId);
      } else {
        // Hard delete: permanently remove all data
        // Migration 031 changed all festival FKs from CASCADE to RESTRICT,
        // so we must delete child rows explicitly in dependency order.
        if (stores.crews?.deleteByFestival) await stores.crews.deleteByFestival(festivalId);
        await stores.pool.query('DELETE FROM set_ratings WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)', [festivalId]);
        await stores.pool.query('DELETE FROM festival_sets WHERE festival_id = $1', [festivalId]);
        await stores.pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [festivalId]);
        await stores.pool.query('DELETE FROM festival_days WHERE festival_id = $1', [festivalId]);
        await stores.pool.query('DELETE FROM festival_profiles WHERE festival_id = $1', [festivalId]);
        await stores.pool.query('DELETE FROM calendar_tokens WHERE festival_id = $1', [festivalId]);
        await stores.pool.query('DELETE FROM notification_counts WHERE festival_id = $1', [festivalId]);
        await stores.pool.query('DELETE FROM notification_topic_subs WHERE festival_id = $1', [festivalId]);
        await stores.pool.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
      }
      invalidateFestivalCache();

      removeFestivalSockets(festivalId, io);
      invalidateFestivalListCache();
      audit(hardDelete ? 'festival:hard-delete' : 'festival:soft-delete', 'festival', festivalId, req, { name: festival.name });
      log.warn('admin:delete-festival', { festivalId, festivalName: festival.name, hard: hardDelete, ip: getRequestIp(req) });
      emitter.festivalDeleted({ id: festivalId });
      return sendSuccess(res, { success: true, softDeleted: !hardDelete });
    } catch (error) {
      log.error('festival delete failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to delete festival', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // PUT /:festivalId/sets/:setId/link — Admin: set a Spotify/SoundCloud link on a set
  router.put('/:festivalId/sets/:setId/link', adminAuth, rateLimit(10, 'set-link'), validate(schemas.setLink), async (req, res) => {
    try {
      const festivalId = req.params.festivalId;
      const setId = req.params.setId;
      const { linkUrl } = req.validatedBody;

      if (!festivalId || !setId) return sendError(res, 400, 'Festival and set IDs required', ErrorCodes.INVALID_INPUT);

      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      // Validate the set exists in this festival
      const allSets = (festival.days || []).flatMap(d => d.sets || []);
      const set = allSets.find(s => s.id === setId);
      if (!set) return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);

      // Validated by Zod schema — normalize to null if empty
      const cleanUrl = (linkUrl && typeof linkUrl === 'string' && linkUrl.trim()) ? linkUrl.trim() : null;

      // Update both link_url (backward compat) and artists JSONB
      await stores.pool.query('UPDATE festival_sets SET link_url = $1 WHERE id = $2 AND festival_id = $3', [cleanUrl, setId, festivalId]);
      // Update first artist's spotify link in artists JSONB
      if (set.artists?.length > 0) {
        const updatedArtists = [...set.artists];
        if (!updatedArtists[0].links) updatedArtists[0].links = {};
        if (cleanUrl) updatedArtists[0].links.spotify = cleanUrl;
        else delete updatedArtists[0].links.spotify;
        await stores.pool.query('UPDATE festival_sets SET artists = $1 WHERE id = $2 AND festival_id = $3', [JSON.stringify(updatedArtists), setId, festivalId]);
      }
      await stores.pool.query('UPDATE festivals SET updated_at = NOW() WHERE id = $1', [festivalId]);
      invalidateFestivalCache();

      audit('set:link-update', 'set', setId, req, { festivalId, linkUrl: cleanUrl });
      log.info('set link updated', { festivalId, setId, linkUrl: cleanUrl ? 'set' : 'cleared', ip: getRequestIp(req) });
      return sendSuccess(res, { setId, linkUrl: cleanUrl });
    } catch (error) {
      log.error('set link update failed', { error: error.message });
      return sendError(res, 500, 'Failed to update set link', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /:festivalId/sets/links — Admin: list all set links for a festival
  router.get('/:festivalId/sets/links', adminAuth, async (req, res) => {
    try {
      const festivalId = req.params.festivalId;
      const result = await stores.pool.query(
        'SELECT id, artist, link_url AS "linkUrl", artists FROM festival_sets WHERE festival_id = $1 AND (link_url IS NOT NULL OR artists != \'[]\'::jsonb) ORDER BY artist',
        [festivalId]
      );
      return sendSuccess(res, result.rows);
    } catch (error) {
      log.error('set links list failed', { error: error.message });
      return sendError(res, 500, 'Failed to load set links', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
};
