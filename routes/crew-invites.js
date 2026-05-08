'use strict';
const crypto = require('crypto');
const { escapeHtml, renderInviteJoinPage, renderInviteErrorPage } = require('../lib/invite-pages');

// ── Invite code helpers ──────────────────────────────────────────
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

async function generateUniqueInviteCode(stores) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateInviteCode();
    if (!(await stores.crews.getByInviteCode(code))) return code;
  }
  throw new Error('Failed to generate unique invite code');
}

module.exports = function createCrewInviteRoutes(deps) {
  const {
    express, config, log,
    userAuth,
    sanitizeIdentifier,
    getFestivalById,
    sendSuccess, sendError, ErrorCodes,
    rateLimit, stores,
    schemas, validate,
    io,
  } = deps;

  const { resolveCrewOwnership, serializeCrewWithMembers, MAX_CREWS_PER_USER_PER_FESTIVAL } = deps._crewHelpers;

  const router = express.Router({ mergeParams: true });

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

  // ── POST /:crewId/invite — Regenerate invite code (owner only) ─
  router.post('/:crewId/invite', userAuth, rateLimit(5, 'crew-invite'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'regenerate invite codes');
      if (!resolved) return;

      const newCode = await generateUniqueInviteCode(stores);
      await stores.crews.regenerateInviteCode(crewId, newCode);

      log.info('crew:invite-regenerated', { crewId, userId: req.user.userId });
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      return sendSuccess(res, { inviteCode: newCode, inviteExpiresAt });
    } catch (error) {
      log.error('crew invite regen failed', { error: error.message, crewId: req.params.crewId });
      return sendError(res, 500, 'Failed to regenerate invite code', ErrorCodes.INTERNAL_ERROR);
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

  return router;
};

// Export the code generator for use by the main crews.js during crew creation
module.exports.generateUniqueInviteCode = generateUniqueInviteCode;
