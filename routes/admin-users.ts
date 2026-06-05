// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
/**
 * Admin user/role management routes
 * Extracted from routes/admin.js during the 2026-04-14 file-size split.
 * Mounts: /users, /users/:id/roles, /users/:id/reset-link, /users/:id/reset-password, /users/:id
 *
 * Called by routes/admin.js::createAdminRoutes() with { router, deps, ctx } where
 * ctx carries: adminWriteLimit, crypto, parsePageParams, paginateArray
 */
export default function mountAdminUserRoutes({ router, deps, ctx }: any): void {
  const {
    config,
    log,
    checkPasswordPolicy,
    hashPassword,
    getUsers,
    getProfiles,
    getUserById,
    invalidateUserSessions,
    disconnectUserSockets,
    removeAvatarFile,
    removeProfileSockets,
    setNoStore,
    sendSuccess,
    sendError,
    ErrorCodes,
    adminAuth,
    getRequestIp,
    buildAvatarUrl,
    io,
    stores,
    schemas,
    validate,
    validateQuery,
    validateParams,
    createAuditLog,
    invalidateUserCache,
  } = deps;
  const { adminWriteLimit, passwordResetRateLimit, crypto, parsePageParams, paginateArray } = ctx;

  // ── GET /users — list users with roles and optional search ────────────
  router.get('/users', adminAuth, validateQuery(schemas.adminUserSearchQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const users = await getUsers();
      const profiles = await getProfiles();
      const search = req.validatedQuery.search ? req.validatedQuery.search.toLowerCase() : null;

      // Pre-index profiles by userId
      const profilesByUser = new Map();
      for (const profile of profiles) {
        if (!profile.userId) continue;
        if (!profilesByUser.has(profile.userId)) profilesByUser.set(profile.userId, []);
        profilesByUser.get(profile.userId).push(profile);
      }

      const rolesByUser = await stores.roles.getUserRolesBatch(users.map((u: any) => u.id));

      let items = users.map((user: any) => {
        const userProfiles = profilesByUser.get(user.id) || [];
        return {
          id: user.id,
          username: user.username,
          email: user.email || null,
          avatarUrl: buildAvatarUrl(user),
          createdAt: user.createdAt,
          profileCount: userProfiles.length,
          totalPicks: userProfiles.reduce(
            (count: number, profile: any) => count + Object.keys(profile.picks || {}).length,
            0,
          ),
          roles: rolesByUser.get(user.id) || [],
        };
      });

      // Apply search filter
      if (search) {
        items = items.filter(
          (u: any) => u.username.toLowerCase().includes(search) || (u.email && u.email.toLowerCase().includes(search)),
        );
      }

      const { limit, cursor } = parsePageParams(req.query);
      const result = paginateArray(items, { limit, cursor });
      return sendSuccess(res, result.items, { pagination: result.pagination });
    } catch (error: any) {
      log.error('admin users load failed', { error: error.message });
      return sendError(res, 500, 'Failed to load users', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /users/:id/roles — grant a role to a user ────────────
  router.post(
    '/users/:id/roles',
    adminAuth,
    adminWriteLimit,
    validateParams(schemas.genericIdParams),
    validate(schemas.adminAddRole),
    async (req: any, res: any) => {
      try {
        const targetUserId = deps.sanitizeIdentifier(req.validatedParams.id, 100);
        if (!targetUserId) return sendError(res, 400, 'Invalid user ID', ErrorCodes.INVALID_INPUT);

        const { role } = req.validatedBody;
        const roleName = role.trim().toLowerCase();
        if (!['admin', 'user'].includes(roleName)) {
          return sendError(res, 400, 'Invalid role name', ErrorCodes.INVALID_INPUT);
        }

        const user = await getUserById(targetUserId);
        if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

        // Get the acting admin's userId from the request session
        const actorId = req.user?.userId || req.userId;
        if (!actorId) return sendError(res, 401, 'Unauthorized', ErrorCodes.UNAUTHORIZED);

        await stores.roles.grantRole(targetUserId, roleName, actorId);

        if (stores.auditLog) {
          await stores.auditLog.insert({
            actorType: 'admin',
            actorId,
            action: 'role_grant',
            targetType: 'user',
            targetId: targetUserId,
            detailsJson: JSON.stringify({ role: roleName, targetUsername: user.username }),
            ip: getRequestIp(req),
          });
        }

        log.warn('admin:role-grant', { targetUserId, targetUsername: user.username, role: roleName, actorId });
        const updatedRoles = await stores.roles.getUserRoles(targetUserId);
        return sendSuccess(res, { userId: targetUserId, username: user.username, roles: updatedRoles });
      } catch (error: any) {
        log.error('admin role grant failed', { error: error.message, targetUserId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to grant role', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /users/:id/roles/:role — revoke a role from a user ────────────
  router.delete(
    '/users/:id/roles/:role',
    adminAuth,
    adminWriteLimit,
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const targetUserId = deps.sanitizeIdentifier(req.validatedParams.id, 100);
        if (!targetUserId) return sendError(res, 400, 'Invalid user ID', ErrorCodes.INVALID_INPUT);

        const roleName = (req.params.role || '').trim().toLowerCase();
        if (!['admin', 'user'].includes(roleName)) {
          return sendError(res, 400, 'Invalid role name', ErrorCodes.INVALID_INPUT);
        }

        const user = await getUserById(targetUserId);
        if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

        // Prevent revoking own admin role
        const actorId = req.user?.userId || req.userId;
        if (!actorId) return sendError(res, 401, 'Unauthorized', ErrorCodes.UNAUTHORIZED);
        if (roleName === 'admin' && targetUserId === actorId) {
          return sendError(res, 400, 'Cannot revoke your own admin role', ErrorCodes.INVALID_INPUT);
        }

        await stores.roles.revokeRole(targetUserId, roleName);

        if (stores.auditLog) {
          await stores.auditLog.insert({
            actorType: 'admin',
            actorId,
            action: 'role_revoke',
            targetType: 'user',
            targetId: targetUserId,
            detailsJson: JSON.stringify({ role: roleName, targetUsername: user.username }),
            ip: getRequestIp(req),
          });
        }

        log.warn('admin:role-revoke', { targetUserId, targetUsername: user.username, role: roleName, actorId });
        const updatedRoles = await stores.roles.getUserRoles(targetUserId);
        return sendSuccess(res, { userId: targetUserId, username: user.username, roles: updatedRoles });
      } catch (error: any) {
        log.error('admin role revoke failed', { error: error.message, targetUserId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to revoke role', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // SECURITY: All admin mutations create audit log entries for compliance and security monitoring
  // AUDIT FIX (2026-04-14): `passwordResetRateLimit` added as outer gate. PUBLIC_ORIGIN
  // throw preserved from Agent E's earlier edit.
  router.post(
    '/users/:id/reset-link',
    adminAuth,
    adminWriteLimit,
    passwordResetRateLimit,
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const targetUserId = deps.sanitizeIdentifier(req.validatedParams.id, 100);
        if (!targetUserId) return sendError(res, 400, 'Invalid user ID', ErrorCodes.INVALID_INPUT);

        const user = await getUserById(targetUserId);
        if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

        if (!config.PUBLIC_ORIGIN) {
          throw new Error('PUBLIC_ORIGIN is required for password-reset email links');
        }

        // Generate a one-time reset token (stored in DB for cross-worker access)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const _expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

        // Store reset token in password_reset_tokens (proper table for this purpose)
        const expiresAt = new Date(Date.now() + config.RESET_TOKEN_TTL);
        await stores.pool.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (token_hash) DO UPDATE SET expires_at = $3`,
          [targetUserId, tokenHash, expiresAt.toISOString()],
        );
        // Also store in memory for same-worker fast path (keyed by hash, not raw token)
        deps.state._adminResetTokens.set(tokenHash, { userId: targetUserId, expiresAt: expiresAt.getTime() });

        const resetUrl = `${config.PUBLIC_ORIGIN}/reset/${resetToken}`;
        const auditLog = createAuditLog('admin_reset_link', 'admin', {
          targetUserId,
          targetUsername: user.username,
          ipAddress: getRequestIp(req),
        });
        log.warn('admin:reset-link', { ...auditLog });
        return sendSuccess(res, { resetUrl, username: user.username });
      } catch (error: any) {
        log.error('admin reset-link failed', { error: error.message, targetUserId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to generate reset link', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // AUDIT FIX (2026-04-14): `passwordResetRateLimit` added to admin in-place
  // password reset as well — same per-email tier as /users/:id/reset-link.
  router.put(
    '/users/:id/reset-password',
    adminAuth,
    adminWriteLimit,
    passwordResetRateLimit,
    validateParams(schemas.genericIdParams),
    validate(schemas.resetPassword),
    async (req: any, res: any) => {
      try {
        const targetUserId = deps.sanitizeIdentifier(req.validatedParams.id, 100);
        if (!targetUserId) return sendError(res, 400, 'Invalid user ID', ErrorCodes.INVALID_INPUT);
        const { newPassword } = req.validatedBody;
        const pwError = checkPasswordPolicy(newPassword);
        if (pwError) {
          return sendError(res, 400, pwError, ErrorCodes.INVALID_INPUT);
        }

        // Get the user first
        const user = await getUserById(targetUserId);
        if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

        // Update password
        await stores.users.update(targetUserId, { passwordHash: await hashPassword(newPassword) });
        invalidateUserCache();
        const username = user.username;
        await invalidateUserSessions(targetUserId);
        disconnectUserSockets(targetUserId, io);
        const auditLog = createAuditLog('admin_reset_password', 'admin', {
          targetUserId,
          targetUsername: username,
          ipAddress: getRequestIp(req),
        });
        log.warn('admin:reset-password', { ...auditLog });
        return sendSuccess(res, { success: true, username });
      } catch (error: any) {
        log.error('admin reset-password failed', { error: error.message, targetUserId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to reset password', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.delete(
    '/users/:id',
    adminAuth,
    adminWriteLimit,
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const targetUserId = deps.sanitizeIdentifier(req.validatedParams.id, 100);
        if (!targetUserId) return sendError(res, 400, 'Invalid user ID', ErrorCodes.INVALID_INPUT);

        // Prevent self-deletion
        const actorId = req.user?.userId || req.userId;
        if (targetUserId === actorId) {
          return sendError(res, 400, 'Cannot delete your own account', ErrorCodes.INVALID_INPUT);
        }

        // Verify user exists before proceeding
        const existingUser = await getUserById(targetUserId);
        if (!existingUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

        // Delete profiles first — to capture them for socket cleanup
        const removedProfiles = await stores.profiles.deleteByUserId(targetUserId);

        // Hard-delete the user — admin deletions are permanent (no reactivation grace period)
        const removedUser = await (stores.users.hardDelete || stores.users.delete).call(stores.users, targetUserId);
        invalidateUserCache();
        if (!removedUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        const auditLog = createAuditLog('admin_delete_user', 'admin', {
          targetUserId: removedUser.id,
          targetUsername: removedUser.username,
          ipAddress: getRequestIp(req),
        });
        log.warn('admin:delete-user', { ...auditLog });

        await removeAvatarFile(removedUser.avatarKey).catch(() => {});
        for (const profile of removedProfiles || []) {
          removeProfileSockets(profile, io);
          io.to(profile.festivalId).emit('profile:deleted', { festivalId: profile.festivalId, profileId: profile.id });
        }
        await invalidateUserSessions(targetUserId);
        disconnectUserSockets(targetUserId, io);
        return sendSuccess(res, { success: true });
      } catch (error: any) {
        log.error('admin delete-user failed', { error: error.message, targetUserId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to delete user', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );
}
