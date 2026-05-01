// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
module.exports = function createAccountRoutes(deps) {
  const {
    express, _config, log,
    userAuth, handleAvatarUpload, processAvatarUpload,
    runUserTask, getUserById, getUsers,
    writeAvatarFile, removeAvatarFile, createVersionToken,
    emitProfileIdentity, setNoStore, serializePublicUser,
    sanitizeString, validateUsername,
    rateLimit,
    sendSuccess, sendError, ErrorCodes,
    schemas, validate,
    io,
    stores, invalidateUserCache,
  } = deps;

  const router = express.Router();
  const crypto = require('crypto');

  // Rate limiter for GDPR data exports (1 per 24 hours per user)
  const exportRateLimits = new Map();
  const EXPORT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours
  const MAX_EXPORT_RATE_ENTRIES = 1000;

  function canExportData(userId) {
    const lastExport = exportRateLimits.get(userId);
    if (!lastExport) return true;
    return Date.now() - lastExport >= EXPORT_RATE_LIMIT_MS;
  }

  function recordExport(userId) {
    exportRateLimits.set(userId, Date.now());
    // Cap Map size with FIFO eviction
    if (exportRateLimits.size > MAX_EXPORT_RATE_ENTRIES) {
      const oldest = exportRateLimits.keys().next().value;
      exportRateLimits.delete(oldest);
    }
  }

  // ── POST /avatar — upload avatar ──────────────────────────────────────
  router.post('/avatar', userAuth, rateLimit(10, 'avatar-upload'), handleAvatarUpload, async (req, res) => {
    try {
      if (!req.file?.buffer) return sendError(res, 400, 'Avatar image is required', ErrorCodes.MISSING_FIELD);
      const processed = await processAvatarUpload(req.file.buffer);
      const updatedUser = await runUserTask(req.user.userId, async () => {
        const currentUser = await getUserById(req.user.userId);
        if (!currentUser) return null;
        const avatarKey = currentUser.avatarKey || crypto.randomBytes(12).toString('hex');
        try {
          await writeAvatarFile(avatarKey, processed);
          const committedUser = await stores.users.update(req.user.userId, {
            avatarKey,
            avatarVersion: createVersionToken(),
            avatarUpdatedAt: new Date().toISOString(),
          });
          if (!committedUser) await removeAvatarFile(avatarKey).catch(() => {});
          return committedUser;
        } catch (err) {
          await removeAvatarFile(avatarKey).catch(() => {});
          throw err;
        }
      });

      if (!updatedUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      deps.invalidateUserCache();
      emitProfileIdentity(updatedUser, io);
      setNoStore(res);
      return sendSuccess(res, { user: serializePublicUser(updatedUser) });
    } catch (error) {
      if (error.statusCode) {
        return sendError(res, error.statusCode, error.message, ErrorCodes.INVALID_INPUT);
      }
      log.error('avatar upload failed', { error: error.message });
      return sendError(res, 400, 'Failed to process avatar image', ErrorCodes.INVALID_INPUT);
    }
  });

  // ── DELETE /avatar — remove avatar ────────────────────────────────────
  router.delete('/avatar', userAuth, rateLimit(60, 'avatar-delete'), async (req, res) => {
    try {
      const updatedUser = await runUserTask(req.user.userId, async () => {
        const currentUser = await getUserById(req.user.userId);
        if (!currentUser) return null;
        const avatarKey = currentUser.avatarKey;
        const committedUser = await stores.users.update(req.user.userId, {
          avatarKey: null,
          avatarVersion: null,
          avatarUpdatedAt: null,
        });
        await removeAvatarFile(avatarKey).catch(() => {});
        return committedUser;
      });

      if (!updatedUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      deps.invalidateUserCache();
      emitProfileIdentity(updatedUser, io);
      setNoStore(res);
      return sendSuccess(res, { user: serializePublicUser(updatedUser) });
    } catch (error) {
      log.error('avatar delete failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to remove avatar', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── PUT|PATCH /username — change username ─────────────────────────────
  const updateUsername = async (req, res) => {
    try {
      setNoStore(res);
      const { username } = req.validatedBody;
      const cleanUsername = sanitizeString(username, 30);
      if (!validateUsername(cleanUsername)) {
        return sendError(res, 400, 'Username must be 2-30 characters (letters, numbers, spaces, hyphens, underscores)', ErrorCodes.INVALID_INPUT);
      }

      // Check if username is available
      const allUsers = await getUsers();
      const currentUser = allUsers.find((u) => u.id === req.user.userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      // Allow case-only changes for the same user
      const taken = allUsers.find((u) => u.id !== req.user.userId && u.username.toLowerCase() === cleanUsername.toLowerCase());
      if (taken) return sendError(res, 400, 'Username already taken', ErrorCodes.ALREADY_EXISTS);

      // Update username — DB UNIQUE constraint is the authoritative guard
      let result;
      try {
        result = await stores.users.update(req.user.userId, { username: cleanUsername });
      } catch (err) {
        if (err.code === '23505') {
          return sendError(res, 400, 'Username already taken', ErrorCodes.ALREADY_EXISTS);
        }
        throw err;
      }
      invalidateUserCache();

      emitProfileIdentity(result, io);
      return sendSuccess(res, { user: serializePublicUser(result) });
    } catch (error) {
      log.error('username change failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to change username', ErrorCodes.INTERNAL_ERROR);
    }
  };
  router.put('/username', userAuth, rateLimit(10, 'username-change'), validate(schemas.usernameChange), updateUsername);
  router.patch('/username', userAuth, rateLimit(10, 'username-change'), validate(schemas.usernameChange), updateUsername);

  // ── DELETE / — soft-delete account (30-day grace period) ──────────────
  router.delete('/', userAuth, rateLimit(5, 'account-delete'), validate(schemas.accountDelete), async (req, res) => {
    try {
      const { password } = req.validatedBody;

      const { verifyPassword, invalidateUserSessions, disconnectUserSockets, getRequestIp } = deps;
      const currentUser = await getUserById(req.user.userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      // Already soft-deleted?
      if (currentUser.deletedAt) {
        return sendError(res, 400, 'Account is already scheduled for deletion', ErrorCodes.INVALID_INPUT);
      }

      const passwordValid = await verifyPassword(password, currentUser.passwordHash);
      if (!passwordValid) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return sendError(res, 403, 'Incorrect password', ErrorCodes.PASSWORD_INCORRECT);
      }

      // Soft-delete: set deleted_at, keep all data for 30-day grace period.
      // Retry once on deadlock (PG 40P01) — concurrent test cleanup can trigger this.
      const performSoftDelete = async () => {
        await stores.users.update(req.user.userId, { deletedAt: new Date().toISOString() });
        invalidateUserCache();
        await invalidateUserSessions(req.user.userId);
        if (stores.refreshTokens) await stores.refreshTokens.revokeAll(req.user.userId);
        if (stores.deviceTokens) await stores.deviceTokens.deleteByUser(req.user.userId);
        if (stores.profiles) await stores.profiles.deleteByUserId(req.user.userId);
        disconnectUserSockets(req.user.userId, io);
      };
      try {
        await performSoftDelete();
      } catch (err) {
        if (err.code === '40P01') {
          await performSoftDelete();
        } else {
          throw err;
        }
      }

      log.warn('account:soft-delete', { userId: req.user.userId, username: currentUser.username, ip: getRequestIp(req) });
      deps.clearUserSessionCookie(res);
      return sendSuccess(res, {
        success: true,
        message: 'Account scheduled for deletion. You have 30 days to reactivate by logging in.',
        deletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch (error) {
      log.error('account soft-delete failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to delete account', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /export — GDPR data export ────────────────────────────────────────
  router.get('/export', userAuth, rateLimit(10, 'account-export'), async (req, res) => {
    try {
      const userId = req.user.userId;

      // Check rate limit: 1 export per 24 hours
      if (!canExportData(userId)) {
        const lastExport = exportRateLimits.get(userId);
        const nextAvailable = new Date(lastExport + EXPORT_RATE_LIMIT_MS);
        return sendError(
          res,
          429,
          `Data export rate limited. Next available: ${nextAvailable.toISOString()}`,
          ErrorCodes.RATE_LIMITED
        );
      }

      // eslint-disable-next-line no-shadow
      const { stores, getProfiles } = deps;
      const currentUser = await getUserById(userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      // Collect user data
      const exportData = {
        exportDate: new Date().toISOString(),
        exportVersion: '1.0',
        user: {
          id: currentUser.id,
          username: currentUser.username,
          createdAt: currentUser.createdAt,
          updatedAt: currentUser.updatedAt,
        },
        profiles: [],
        messages: [],
        deviceTokens: [],
      };

      // Get all profiles for this user
      const allProfiles = getProfiles ? (await getProfiles()) : [];
      const userProfiles = allProfiles.filter((p) => p.userId === userId);

      for (const profile of userProfiles) {
        exportData.profiles.push({
          id: profile.id,
          festivalId: profile.festivalId,
          name: profile.name,
          picks: profile.picks || {},
          notes: profile.notes || {},
          reminders: profile.reminders || {},
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        });
      }

      // Chat feature removed (migration 013) — messages export skipped

      // Get device tokens
      if (stores?.deviceTokens?.listByUser) {
        const tokens = await stores.deviceTokens.listByUser(userId) || [];
        exportData.deviceTokens = tokens.map((t) => ({
          id: t.id,
          platform: t.platform,
          deviceName: t.deviceName,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt,
        }));
      }

      // Get crew memberships
      if (stores?.crews?.listForUser) {
        try {
          const userCrews = await stores.crews.listForUser(userId);
          exportData.crews = (userCrews || []).map((c) => ({
            id: c.id,
            name: c.name,
            festivalId: c.festivalId,
            role: c.role,
            joinedAt: c.joinedAt,
          }));
        } catch (error) {
          log.warn('gdpr-export:partial-failure', { section: 'crews', userId, error: error.message });
          exportData.crews = [];
        }
      }

      // Get active sessions (exclude token hashes)
      if (stores?.sessions?.listUserSessions) {
        try {
          const sessions = await stores.sessions.listUserSessions(userId);
          exportData.sessions = sessions.map((s) => ({
            createdAt: new Date(s.createdAt).toISOString(),
            lastAccess: new Date(s.lastAccess).toISOString(),
          }));
        } catch (error) {
          log.warn('gdpr-export:partial-failure', { section: 'sessions', userId, error: error.message });
          exportData.sessions = [];
        }
      }

      // Get notification preferences (GDPR: include all personal data)
      if (stores?.notificationPrefs?.get) {
        exportData.notificationPreferences = await stores.notificationPrefs.get(userId);
      }

      // Get topic subscriptions per festival
      if (stores?.topicSubscriptions?.getForUser) {
        exportData.topicSubscriptions = [];
        for (const profile of userProfiles) {
          const subs = await stores.topicSubscriptions.getForUser(userId, profile.festivalId);
          if (subs && Object.keys(subs).length > 0) {
            exportData.topicSubscriptions.push({ festivalId: profile.festivalId, subscriptions: subs });
          }
        }
      }

      // Record the export for rate limiting
      recordExport(userId);

      // Set response headers for download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `festie-data-${timestamp}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      log.info('account:gdpr-export', { userId, username: currentUser.username });
      return sendSuccess(res, exportData);
    } catch (error) {
      log.error('account export failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to export data', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
};
