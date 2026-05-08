'use strict';
const { generateUniqueInviteCode } = require('./crew-invites');

module.exports = function createCrewRoutes(deps) {
  const {
    express, log, pool,
    userAuth, setNoStore,
    sanitizeString, sanitizeIdentifier,
    createOpaqueId,
    sendSuccess, sendError, ErrorCodes,
    rateLimit, stores,
    schemas, validate, validateQuery,
    io,
  } = deps;

  const router = express.Router();

  // ── Helpers ────────────────────────────────────────────────────────
  const MAX_CREWS_PER_USER_PER_FESTIVAL = 3;

  /**
   * Resolve a crew by ID and verify the requesting user is the owner.
   * Returns { crew, membership } on success, or null if an error response was already sent.
   */
  async function resolveCrewOwnership(res, crewId, userId, actionLabel) {
    const crew = await stores.crews.getById(crewId);
    if (!crew) { sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND); return null; }
    const membership = await stores.crews.getMember(crewId, userId);
    if (!membership || membership.role !== 'owner') {
      sendError(res, 403, `Only the crew owner can ${actionLabel}`, ErrorCodes.FORBIDDEN);
      return null;
    }
    return { crew, membership };
  }

  function serializeCrew(crew, membership) {
    const result = {
      id: crew.id,
      festivalId: crew.festivalId,
      name: crew.name,
      createdBy: crew.createdBy,
      maxMembers: crew.maxMembers,
      createdAt: crew.createdAt,
      updatedAt: crew.updatedAt,
      homeBaseLocation: crew.homeBaseLocation || crew.home_base_location || null,
      homeBaseTime: crew.homeBaseTime || crew.home_base_time || null,
      homeBaseUpdatedAt: crew.homeBaseUpdatedAt || crew.home_base_updated_at || null,
    };
    if (membership) {
      result.role = membership.role || crew.role;
      result.joinedAt = membership.joinedAt || crew.joinedAt;
    }
    if (result.role === 'owner') {
      result.inviteCode = crew.inviteCode;
      result.inviteExpiresAt = crew.inviteExpiresAt || null;
    }
    return result;
  }

  function serializeCrewWithMembers(crew, members, requestingUserId) {
    const membership = members.find((m) => m.userId === requestingUserId);
    const result = serializeCrew(crew, membership);
    result.members = members.map((m) => ({
      userId: m.userId,
      username: m.username,
      name: m.username,
      avatarKey: m.avatarKey || null,
      avatarVersion: m.avatarVersion || null,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
    result.memberCount = members.length;
    return result;
  }

  // Share helpers with sub-routers via deps
  const _crewHelpers = { resolveCrewOwnership, serializeCrew, serializeCrewWithMembers, MAX_CREWS_PER_USER_PER_FESTIVAL };
  const subDeps = { ...deps, _crewHelpers };

  // ── Mount sub-routers ──────────────────────────────────────────────
  const inviteRoutes = require('./crew-invites')(subDeps);
  const meetingPointRoutes = require('./crew-meeting-points')(subDeps);
  const pollRoutes = require('./crew-polls')(subDeps);

  router.use('/', inviteRoutes);
  router.use('/', meetingPointRoutes);
  router.use('/', pollRoutes);

  // ── Crew creation helpers ────────────────────────────────────────
  async function validateCrewCreation(req, cleanFestivalId) {
    const { rows: festivalRows } = await pool.query(
      'SELECT 1 FROM festivals WHERE id = $1 AND deleted_at IS NULL',
      [cleanFestivalId],
    );
    if (festivalRows.length === 0) return 'Festival not found';

    const profile = await stores.profiles.readByUserAndFestival?.(req.user.userId, cleanFestivalId);
    if (!profile) return 'Join the festival first';

    const existingCrews = await stores.crews.listByUserAndFestival(req.user.userId, cleanFestivalId);
    if (!Array.isArray(existingCrews) || existingCrews.length >= MAX_CREWS_PER_USER_PER_FESTIVAL) {
      return `Maximum ${MAX_CREWS_PER_USER_PER_FESTIVAL} crews per festival`;
    }
    return null;
  }

  async function persistCrew(crewData) {
    if (stores.crews.createWithOwner) {
      await stores.crews.createWithOwner(crewData);
    } else {
      await stores.crews.create(crewData);
      await stores.crews.addMember({ crewId: crewData.id, userId: crewData.createdBy, role: 'owner' });
    }
  }

  // ── POST / — Create a crew ──────────────────────────────────────
  router.post('/', userAuth, rateLimit(10, 'crew-create'), validate(schemas.crewCreate), async (req, res) => {
    try {
      const { name, festivalId } = req.validatedBody;
      const cleanName = sanitizeString(name, 60);
      const cleanFestivalId = sanitizeIdentifier(festivalId, 100);

      if (!cleanName) return sendError(res, 400, 'Crew name required', ErrorCodes.MISSING_FIELD);
      if (!cleanFestivalId) return sendError(res, 400, 'Festival ID required', ErrorCodes.MISSING_FIELD);

      const validationError = await validateCrewCreation(req, cleanFestivalId);
      if (validationError) {
        const code = validationError.startsWith('Maximum') ? ErrorCodes.MAX_LIMIT_REACHED
          : validationError === 'Festival not found' ? ErrorCodes.NOT_FOUND
            : ErrorCodes.FORBIDDEN;
        const status = validationError === 'Festival not found' ? 404
          : validationError.startsWith('Maximum') ? 400 : 403;
        return sendError(res, status, validationError, code);
      }

      const crewId = createOpaqueId('crew');
      const inviteCode = await generateUniqueInviteCode(stores);
      const crewData = {
        id: crewId,
        festivalId: cleanFestivalId,
        name: cleanName,
        createdBy: req.user.userId,
        inviteCode,
        inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        maxMembers: 30,
      };

      await persistCrew(crewData);
      const crew = await stores.crews.getById(crewId);
      const members = await stores.crews.getMembers(crewId);

      if (!crew || !Array.isArray(members)) {
        log.error('crew creation incomplete', { crewId });
        return sendError(res, 500, 'Failed to create crew', ErrorCodes.INTERNAL_ERROR);
      }

      log.info('crew:created', { crewId, festivalId: cleanFestivalId, userId: req.user.userId });
      res.status(201);
      return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
    } catch (error) {
      log.error('crew create failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to create crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET / — List my crews (optionally filtered by festivalId) ───
  router.get('/', userAuth, rateLimit(120, 'crew-list'), validateQuery(schemas.crewListQuery), async (req, res) => {
    try {
      setNoStore(res);
      const festivalId = req.validatedQuery.festivalId ? sanitizeIdentifier(req.validatedQuery.festivalId, 100) : null;

      let crews;
      if (festivalId) {
        crews = await stores.crews.listByUserAndFestival(req.user.userId, festivalId);
      } else {
        crews = await stores.crews.listByUser(req.user.userId);
      }

      const result = crews.map((crew) => serializeCrew(crew, crew));
      return sendSuccess(res, result);
    } catch (error) {
      log.error('crew list failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to list crews', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /search-users — Admin: search users for crew add ──────
  router.get('/search-users', userAuth, rateLimit(30, 'crew-user-search'), validateQuery(schemas.crewUserSearchQuery), async (req, res) => {
    try {
      const isAdmin = await stores.roles.hasRole(req.user.userId, 'admin');
      if (!isAdmin) return sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);

      setNoStore(res);
      const q = (req.validatedQuery.q || '').trim();
      if (!q || q.length < 1) return sendSuccess(res, []);

      // Escape LIKE metacharacters to prevent wildcard injection
      const escaped = q.replace(/[%_\\]/g, '\\$&');

      // Targeted query instead of readAll() + filter
      const { rows: matches } = await pool.query(
        'SELECT id, username FROM users WHERE username ILIKE $1 AND deleted_at IS NULL LIMIT 20',
        [`%${escaped}%`]
      );

      return sendSuccess(res, matches);
    } catch (error) {
      log.error('crew user search failed', { error: error.message });
      return sendError(res, 500, 'Failed to search users', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /:crewId — Get crew details with members ───────────────
  router.get('/:crewId', userAuth, rateLimit(120, 'crew-get'), async (req, res) => {
    try {
      setNoStore(res);
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const crew = await stores.crews.getById(crewId);
      if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

      const membership = await stores.crews.getMember(crewId, req.user.userId);
      if (!membership) return sendError(res, 403, 'Not a member of this crew', ErrorCodes.FORBIDDEN);

      const members = await stores.crews.getMembers(crewId);
      return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
    } catch (error) {
      log.error('crew get failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to get crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── PUT /:crewId — Update crew (owner only) ────────────────────
  router.put('/:crewId', userAuth, rateLimit(10, 'crew-update'), validate(schemas.crewUpdate), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'update');
      if (!resolved) return;
      const { crew } = resolved;

      const updateData = { id: crewId };
      if (req.validatedBody.name !== undefined) {
        updateData.name = sanitizeString(req.validatedBody.name, 60);
      } else {
        updateData.name = crew.name;
      }
      if (req.validatedBody.maxMembers !== undefined) {
        updateData.maxMembers = req.validatedBody.maxMembers;
      } else {
        updateData.maxMembers = crew.maxMembers;
      }

      await stores.crews.update(updateData);
      const updated = await stores.crews.getById(crewId);
      const members = await stores.crews.getMembers(crewId);

      if (io) {
        const broadcastData = serializeCrewWithMembers(updated, members, null);
        delete broadcastData.inviteCode;
        io.to(`crew:${crewId}`).emit('crew:updated', broadcastData);
      }

      log.info('crew:updated', { crewId, userId: req.user.userId });
      return sendSuccess(res, serializeCrewWithMembers(updated, members, req.user.userId));
    } catch (error) {
      log.error('crew update failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to update crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /:crewId — Delete crew (owner only) ──────────────────
  router.delete('/:crewId', userAuth, rateLimit(5, 'crew-delete'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'delete');
      if (!resolved) return;
      const { crew } = resolved;

      if (io) io.to(`crew:${crewId}`).emit('crew:deleted', { crewId, festivalId: crew.festivalId });

      await stores.crews.delete(crewId);

      log.info('crew:deleted', { crewId, festivalId: crew.festivalId, userId: req.user.userId });
      return sendSuccess(res, { success: true });
    } catch (error) {
      log.error('crew delete failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to delete crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /:crewId/leave — Leave a crew ────────────────────────
  router.delete('/:crewId/leave', userAuth, rateLimit(10, 'crew-leave'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const crew = await stores.crews.getById(crewId);
      if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

      const membership = await stores.crews.getMember(crewId, req.user.userId);
      if (!membership) return sendError(res, 400, 'Not a member of this crew', ErrorCodes.INVALID_INPUT);

      if (membership.role === 'owner') {
        return sendError(res, 400, 'Transfer ownership before leaving', ErrorCodes.FORBIDDEN);
      }

      await stores.crews.removeMember(crewId, req.user.userId);

      if (io) {
        io.to(`crew:${crewId}`).emit('crew:member-left', {
          crewId,
          userId: req.user.userId,
          username: req.user.username,
        });
      }

      log.info('crew:left', { crewId, userId: req.user.userId });
      return sendSuccess(res, { success: true });
    } catch (error) {
      log.error('crew leave failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to leave crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /:crewId/members/:userId — Kick a member (owner only)
  router.delete('/:crewId/members/:userId', userAuth, rateLimit(10, 'crew-kick'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      const targetUserId = sanitizeIdentifier(req.params.userId, 100);
      if (!crewId || !targetUserId) return sendError(res, 400, 'Invalid IDs', ErrorCodes.INVALID_INPUT);

      const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'kick members');
      if (!resolved) return;

      if (targetUserId === req.user.userId) {
        return sendError(res, 400, 'Cannot kick yourself', ErrorCodes.INVALID_INPUT);
      }

      const target = await stores.crews.getMember(crewId, targetUserId);
      if (!target) return sendError(res, 404, 'Member not found', ErrorCodes.NOT_FOUND);

      await stores.crews.removeMember(crewId, targetUserId);

      if (io) {
        io.to(`crew:${crewId}`).emit('crew:member-kicked', {
          crewId,
          userId: targetUserId,
        });
      }

      log.info('crew:member-kicked', { crewId, targetUserId, byUserId: req.user.userId });
      return sendSuccess(res, { success: true });
    } catch (error) {
      log.error('crew kick failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to kick member', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── PUT /:crewId/transfer — Transfer ownership (owner only) ────
  router.put('/:crewId/transfer', userAuth, rateLimit(5, 'crew-transfer'), validate(schemas.crewTransfer), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'transfer');
      if (!resolved) return;
      const { crew } = resolved;

      const targetUserId = sanitizeIdentifier(req.validatedBody.userId, 100);
      if (!targetUserId) return sendError(res, 400, 'Target user ID required', ErrorCodes.MISSING_FIELD);
      if (targetUserId === req.user.userId) return sendError(res, 400, 'Already the owner', ErrorCodes.INVALID_INPUT);

      const target = await stores.crews.getMember(crewId, targetUserId);
      if (!target) return sendError(res, 404, 'Target is not a crew member', ErrorCodes.NOT_FOUND);

      // Use transactional transferOwnership when available; fallback to separate calls
      if (stores.crews.transferOwnership) {
        await stores.crews.transferOwnership(crewId, req.user.userId, targetUserId);
      } else {
        await stores.crews.updateMemberRole(crewId, targetUserId, 'owner');
        await stores.crews.updateMemberRole(crewId, req.user.userId, 'member');
      }

      const members = await stores.crews.getMembers(crewId);

      if (io) {
        const broadcastData = serializeCrewWithMembers(crew, members, null);
        delete broadcastData.inviteCode;
        io.to(`crew:${crewId}`).emit('crew:updated', broadcastData);
      }

      log.info('crew:ownership-transferred', { crewId, from: req.user.userId, to: targetUserId });
      return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
    } catch (error) {
      log.error('crew transfer failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to transfer ownership', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /:crewId/overlap — Get crew pick overlap ───────────────
  router.get('/:crewId/overlap', userAuth, rateLimit(60, 'crew-overlap'), async (req, res) => {
    try {
      setNoStore(res);
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const crew = await stores.crews.getById(crewId);
      if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

      const membership = await stores.crews.getMember(crewId, req.user.userId);
      if (!membership) return sendError(res, 403, 'Not a member of this crew', ErrorCodes.FORBIDDEN);

      const rows = await stores.crews.getCrewPickOverlap(crew.festivalId, crewId);

      // Aggregate picks by setId — use null-prototype object to prevent pollution
      const overlap = Object.create(null);
      for (const row of rows) {
        let picks;
        try { picks = row.picksJson ? JSON.parse(row.picksJson) : {}; } catch { picks = {}; }
        for (const [setId, priority] of Object.entries(picks)) {
          if (typeof setId !== 'string' || setId === '__proto__' || setId === 'constructor' || setId === 'prototype') continue;
          if (!overlap[setId]) overlap[setId] = [];
          overlap[setId].push({ userId: row.userId, username: row.username, priority });
        }
      }

      return sendSuccess(res, {
        crewId,
        festivalId: crew.festivalId,
        memberCount: rows.length,
        overlap,
      });
    } catch (error) {
      log.error('crew overlap failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to get overlap', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /:crewId/members — Admin: add any user to a crew ─────
  router.post('/:crewId/members', userAuth, rateLimit(10, 'crew-add-member'), validate(schemas.crewAddMember), async (req, res) => {
    try {
      const isAdmin = await stores.roles.hasRole(req.user.userId, 'admin');
      if (!isAdmin) return sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);

      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const targetUserId = sanitizeIdentifier(req.validatedBody.userId, 100);
      if (!targetUserId) return sendError(res, 400, 'User ID required', ErrorCodes.MISSING_FIELD);

      const crew = await stores.crews.getById(crewId);
      if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

      const targetUser = await stores.users.getById(targetUserId);
      if (!targetUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      const existing = await stores.crews.getMember(crewId, targetUserId);
      if (existing) return sendError(res, 400, 'Already a member of this crew', ErrorCodes.ALREADY_EXISTS);

      const memberCount = await stores.crews.getMemberCount(crewId);
      if (memberCount >= crew.maxMembers) {
        return sendError(res, 400, 'Crew is full', ErrorCodes.MAX_LIMIT_REACHED);
      }

      await stores.crews.addMember({
        crewId: crew.id,
        userId: targetUserId,
        role: 'member',
      });

      const members = await stores.crews.getMembers(crew.id);

      if (io) {
        io.to(`crew:${crew.id}`).emit('crew:member-joined', {
          crewId: crew.id,
          userId: targetUserId,
          username: targetUser.username,
        });
      }

      log.info('crew:admin-add-member', { crewId: crew.id, targetUserId, byAdmin: req.user.userId });
      return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
    } catch (error) {
      log.error('crew admin add member failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to add member', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
};
