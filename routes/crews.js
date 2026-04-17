'use strict';
const { escapeHtml, renderInviteJoinPage, renderInviteErrorPage } = require("../lib/invite-pages");

module.exports = function createCrewRoutes(deps) {
  const {
    express, config, log,
    userAuth, setNoStore,
    sanitizeString, sanitizeIdentifier,
    createOpaqueId, _getRequestIp,
    getFestivalById,
    sendSuccess, sendError, ErrorCodes,
    rateLimit, stores,
    schemas, validate,
    io,
  } = deps;

  const crypto = require('crypto');
  const router = express.Router();

  // ── Helpers ────────────────────────────────────────────────────────
  const MAX_CREWS_PER_USER_PER_FESTIVAL = 3;
  const INVITE_CODE_LENGTH = 6;
  const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1

  function generateInviteCode() {
    // Use rejection sampling to avoid modulo bias (charset length 31 doesn't divide 256 evenly)
    const limit = 256 - (256 % INVITE_CODE_CHARS.length); // largest multiple of 31 <= 256
    let code = '';
    while (code.length < INVITE_CODE_LENGTH) {
      const bytes = crypto.randomBytes(INVITE_CODE_LENGTH * 2); // over-request to reduce loops
      for (let i = 0; i < bytes.length && code.length < INVITE_CODE_LENGTH; i++) {
        if (bytes[i] < limit) code += INVITE_CODE_CHARS[bytes[i] % INVITE_CODE_CHARS.length];
      }
    }
    return code;
  }

  async function generateUniqueInviteCode() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateInviteCode();
      if (!(await stores.crews.getByInviteCode(code))) return code;
    }
    throw new Error('Failed to generate unique invite code');
  }

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
    };
    if (membership) {
      result.role = membership.role || crew.role;
      result.joinedAt = membership.joinedAt || crew.joinedAt;
    }
    // Only include invite code + expiry if the user is the owner
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
      avatarKey: m.avatarKey || null,
      avatarVersion: m.avatarVersion || null,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
    result.memberCount = members.length;
    return result;
  }

  // ── POST / — Create a crew ──────────────────────────────────────
  router.post('/', userAuth, rateLimit(10, 'crew-create'), validate(schemas.crewCreate), async (req, res) => {
    try {
      const { name, festivalId } = req.validatedBody;
      const cleanName = sanitizeString(name, 60);
      const cleanFestivalId = sanitizeIdentifier(festivalId, 100);

      if (!cleanName) return sendError(res, 400, 'Crew name required', ErrorCodes.MISSING_FIELD);
      if (!cleanFestivalId) return sendError(res, 400, 'Festival ID required', ErrorCodes.MISSING_FIELD);

      // Verify festival exists
      const festival = (await stores.festivals.readAll()).find((f) => f.id === cleanFestivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      // Verify user has a profile for this festival
      const profile = await stores.profiles.readByUserAndFestival?.(req.user.userId, cleanFestivalId);
      if (!profile) return sendError(res, 403, 'Join the festival first', ErrorCodes.FORBIDDEN);

      // Limit crews per user per festival — wrapped with error handling
      let existingCrews;
      try {
        existingCrews = await stores.crews.listByUserAndFestival(req.user.userId, cleanFestivalId);
      } catch (error) {
        log.error('crew list failed', { error: error.message, userId: req.user.userId });
        return sendError(res, 500, 'Failed to check existing crews', ErrorCodes.INTERNAL_ERROR);
      }
      if (!Array.isArray(existingCrews) || existingCrews.length >= MAX_CREWS_PER_USER_PER_FESTIVAL) {
        return sendError(res, 400, `Maximum ${MAX_CREWS_PER_USER_PER_FESTIVAL} crews per festival`, ErrorCodes.MAX_LIMIT_REACHED);
      }

      const crewId = createOpaqueId('crew');
      let inviteCode;
      try {
        inviteCode = await generateUniqueInviteCode();
      } catch (error) {
        log.error('invite code generation failed', { error: error.message });
        return sendError(res, 500, 'Failed to generate invite code', ErrorCodes.INTERNAL_ERROR);
      }

      try {
        const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await stores.crews.create({
          id: crewId,
          festivalId: cleanFestivalId,
          name: cleanName,
          createdBy: req.user.userId,
          inviteCode,
          inviteExpiresAt,
          maxMembers: 30,
        });

        // Add creator as owner
        await stores.crews.addMember({
          crewId,
          userId: req.user.userId,
          role: 'owner',
        });

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
        log.error('crew creation failed', { error: error.message, userId: req.user.userId });
        return sendError(res, 500, 'Failed to create crew', ErrorCodes.INTERNAL_ERROR);
      }
    } catch (error) {
      log.error('crew create failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to create crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET / — List my crews (optionally filtered by festivalId) ───
  router.get('/', userAuth, async (req, res) => {
    try {
      setNoStore(res);
      const festivalId = req.query.festivalId ? sanitizeIdentifier(req.query.festivalId, 100) : null;

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

  // ── GET /:crewId — Get crew details with members ───────────────

  // ── GET /search-users — Admin: search users for crew add ──────
  router.get('/search-users', userAuth, rateLimit(30, 'crew-user-search'), async (req, res) => {
    try {
      const isAdmin = await stores.roles.hasRole(req.user.userId, 'admin');
      if (!isAdmin) return sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);

      setNoStore(res);
      const q = sanitizeString((req.query.q || ''), 100).toLowerCase();
      if (!q || q.length < 1) return sendSuccess(res, []);

      const allUsers = await stores.users.readAll();
      const matches = allUsers
        .filter(u => u.username.toLowerCase().includes(q) && !u.deletedAt)
        .slice(0, 20)
        .map(u => ({ id: u.id, username: u.username }));

      return sendSuccess(res, matches);
    } catch (error) {
      log.error('crew user search failed', { error: error.message });
      return sendError(res, 500, 'Failed to search users', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.get('/:crewId', userAuth, async (req, res) => {
    try {
      setNoStore(res);
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const crew = await stores.crews.getById(crewId);
      if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

      // Must be a member to view
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

      // Broadcast update to crew room — strip invite code to prevent leakage to non-owners
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

      // Broadcast deletion before removing
      if (io) io.to(`crew:${crewId}`).emit('crew:deleted', { crewId, festivalId: crew.festivalId });

      await stores.crews.delete(crewId);

      log.info('crew:deleted', { crewId, festivalId: crew.festivalId, userId: req.user.userId });
      return sendSuccess(res, { success: true });
    } catch (error) {
      log.error('crew delete failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to delete crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /join — Join a crew via invite code ────────────────────
  router.post('/join', userAuth, rateLimit(10, 'crew-join'), validate(schemas.crewJoin), async (req, res) => {
    try {
      const code = req.validatedBody.inviteCode.toUpperCase().trim();

      const crew = await stores.crews.getByInviteCode(code);
      if (!crew) {
        // Check if code exists but is expired
        const expiredCrew = await stores.crews.getExpiredByInviteCode(code);
        if (expiredCrew) return sendError(res, 410, 'Invite code has expired. Ask the crew owner to regenerate it.', ErrorCodes.NOT_FOUND);
        return sendError(res, 404, 'Invalid invite code', ErrorCodes.NOT_FOUND);
      }

      // Verify user has a profile for this festival
      const profile = await stores.profiles.readByUserAndFestival?.(req.user.userId, crew.festivalId);
      if (!profile) return sendError(res, 403, 'Join the festival first', ErrorCodes.FORBIDDEN);

      // Check if already a member
      const existing = await stores.crews.getMember(crew.id, req.user.userId);
      if (existing) return sendError(res, 400, 'Already a member of this crew', ErrorCodes.ALREADY_EXISTS);

      // Limit crews per user per festival
      const userCrews = await stores.crews.listByUserAndFestival(req.user.userId, crew.festivalId);
      if (userCrews.length >= MAX_CREWS_PER_USER_PER_FESTIVAL) {
        return sendError(res, 400, `Maximum ${MAX_CREWS_PER_USER_PER_FESTIVAL} crews per festival`, ErrorCodes.MAX_LIMIT_REACHED);
      }

      // Check member cap
      const memberCount = await stores.crews.getMemberCount(crew.id);
      if (memberCount >= crew.maxMembers) {
        return sendError(res, 400, 'Crew is full', ErrorCodes.MAX_LIMIT_REACHED);
      }

      await stores.crews.addMember({
        crewId: crew.id,
        userId: req.user.userId,
        role: 'member',
      });

      const members = await stores.crews.getMembers(crew.id);

      // Broadcast new member to crew room
      if (io) {
        io.to(`crew:${crew.id}`).emit('crew:member-joined', {
          crewId: crew.id,
          userId: req.user.userId,
          username: req.user.username,
        });
      }

      log.info('crew:joined', { crewId: crew.id, festivalId: crew.festivalId, userId: req.user.userId });
      return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
    } catch (error) {
      log.error('crew join failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to join crew', ErrorCodes.INTERNAL_ERROR);
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

      // Owner must transfer before leaving
      if (membership.role === 'owner') {
        return sendError(res, 400, 'Transfer ownership before leaving', ErrorCodes.FORBIDDEN);
      }

      await stores.crews.removeMember(crewId, req.user.userId);

      // Broadcast departure to crew room
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

      // Broadcast kick to crew room
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

      await stores.crews.updateMemberRole(crewId, targetUserId, 'owner');
      await stores.crews.updateMemberRole(crewId, req.user.userId, 'member');

      const members = await stores.crews.getMembers(crewId);

      // Broadcast ownership change — use a non-owner perspective to avoid leaking invite code
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

  // ── POST /:crewId/invite — Regenerate invite code (owner only) ─
  router.post('/:crewId/invite', userAuth, rateLimit(5, 'crew-invite'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'regenerate invite codes');
      if (!resolved) return;

      const newCode = await generateUniqueInviteCode();
      await stores.crews.regenerateInviteCode(crewId, newCode);

      log.info('crew:invite-regenerated', { crewId, userId: req.user.userId });
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      return sendSuccess(res, { inviteCode: newCode, inviteExpiresAt });
    } catch (error) {
      log.error('crew invite regen failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to regenerate invite code', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /:crewId/overlap — Get crew pick overlap ───────────────
  router.get('/:crewId/overlap', userAuth, async (req, res) => {
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

  // ── GET /join/:inviteCode — Public crew invite page (no auth) ─────
  router.get('/join/:inviteCode', rateLimit(30, 'crew-invite-page'), async (req, res) => {
    try {
      const inviteCode = String(req.params.inviteCode || '').trim();
      // Sanitize inviteCode: alphanumeric, 4-12 chars
      if (!inviteCode || inviteCode.length < 4 || inviteCode.length > 12 || !/^[a-zA-Z0-9]+$/.test(inviteCode)) {
        const origin = config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
        return res.send(renderInviteErrorPage(escapeHtml(origin), 'Invalid or expired invite link'));
      }

      const crew = await stores.crews.getByInviteCode(inviteCode);
      if (!crew) {
        const origin = config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
        return res.send(renderInviteErrorPage(escapeHtml(origin), 'Invalid or expired invite link'));
      }

      // Get festival name for the invite page
      const festival = await getFestivalById(crew.festivalId);
      const festivalName = festival?.name || 'Festival';

      const origin = config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
      return res.send(renderInviteJoinPage({
        crewName: escapeHtml(crew.name),
        festivalName: escapeHtml(festivalName),
        inviteCode: escapeHtml(inviteCode),
        origin: escapeHtml(origin),
      }));
    } catch (error) {
      log.error('crew invite page failed', { error: error.message, inviteCode: req.params.inviteCode });
      const origin = config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
      return res.send(renderInviteErrorPage(escapeHtml(origin), 'Failed to load invite'));
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

  // ── Meeting points + polls (extracted to crew-features.js) ──────
  require('./crew-features')(router, deps);

  return router;
};
