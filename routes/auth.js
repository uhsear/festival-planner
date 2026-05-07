/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Authentication Routes
 * POST /register - Register new user (optional email for verification)
 * POST /verify-token - Get CSRF token for login form
 * POST /login - Authenticate user and set session cookie
 * POST /logout - Invalidate session and clear cookie
 * POST /change-password - Change password (authenticated)
 * (Email routes split to email-auth.js: forgot-password, verify-email, update-email, resend-verification)
 */
/**
 * Create a new user, link orphan festival profiles, and optionally send
 * a verification email. Returns the created user record.
 *
 * Callers are responsible for session creation and HTTP response.
 */
async function createUserWithProfile(userData, deps) {
  const { cleanUsername, passwordHash, newUserId, cleanEmail } = userData;
  const {
    stores, config, log, invalidateUserCache,
  } = deps;

  const crypto = require('crypto');
  const { sendVerificationEmail } = require('../lib/email');

  // Create user in database
  const user = await stores.users.create({
    id: newUserId,
    username: cleanUsername,
    passwordHash,
    email: cleanEmail || null,
    createdAt: new Date().toISOString(),
    tosAcceptedAt: new Date().toISOString(),
    tosVersion: 1,
  });
  invalidateUserCache();

  // Auto-link orphan profiles that match the new username
  const profiles = await deps.getProfiles?.() || [];
  for (const profile of profiles) {
    if (!profile.userId && profile.name.toLowerCase() === cleanUsername.toLowerCase()) {
      await stores.profiles.update(profile.id, { userId: user.id });
    }
  }

  // Send verification email if email was provided
  if (cleanEmail) {
    try {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await stores.pool.query(
        'INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || \' hours\')::INTERVAL)',
        [user.id, tokenHash, cleanEmail, config.EMAIL_VERIFY_TOKEN_TTL_HOURS],
      );
      const verifyUrl = `${config.PUBLIC_ORIGIN}/api/v1/auth/verify-email?token=${verifyToken}`;
      await sendVerificationEmail({ to: cleanEmail, username: cleanUsername, verifyUrl, config, log });
    } catch (emailErr) {
      log.error('register:verify-email-send-failed', { error: emailErr.message, userId: user.id });
      // Don't fail registration if email send fails
    }
  }

  return user;
}

module.exports = function createAuthRoutes(deps) {
  const {
    express, config, log,
    sanitizeString, validateUsername, validatePasswordStrength,
    hashPassword, verifyPassword,
    createUserSession, validateUserSession,
    invalidateUserSessions, resolveRequestToken,
    setNoStore, setUserSessionCookie, clearUserSessionCookie,
    userAuth, getUserById, getUsers,
    disconnectUserSockets, createOpaqueId,
    sendSuccess, sendError, ErrorCodes, rateLimit,
    io, DUMMY_PASSWORD_HASH,
    schemas, validate,
    stores, invalidateUserCache,



    // eslint-disable-next-line no-unused-vars
    pool, state, _hashSessionToken, createAuditLog, getRequestIp,
  } = deps;

  const router = express.Router();

  router.post('/register', rateLimit(5, 'register'), validate(schemas.register), async (req, res) => {
    try {
      const { username, password, confirmPassword, email: rawEmail } = req.validatedBody;
      const cleanUsername = sanitizeString(username, 30);
      if (!validateUsername(cleanUsername)) {
        return sendError(res, 400, 'Username must be 2-30 characters (letters, numbers, spaces, hyphens, underscores)', ErrorCodes.INVALID_INPUT);
      }
      if (!validatePasswordStrength(password)) {
        return sendError(res, 400, 'Password must be 8-100 characters', ErrorCodes.INVALID_INPUT);
      }
      if (password !== confirmPassword) {
        return sendError(res, 400, 'Passwords do not match', ErrorCodes.INVALID_INPUT);
      }

      // Create user and auto-link matching profiles atomically by writing
      // users first, then linking profiles only if user creation succeeded
      const passwordHash = await hashPassword(password);
      const newUserId = createOpaqueId('user');

      // Check if username exists and user count
      const existingUsers = await getUsers();
      const existingUser = existingUsers.find((u) => u.username.toLowerCase() === cleanUsername.toLowerCase());
      if (existingUser) {
        return sendError(res, 400, 'Username already taken', ErrorCodes.ALREADY_EXISTS);
      }
      if (existingUsers.length >= config.MAX_USERS) {
        return sendError(res, 400, 'Maximum users reached', ErrorCodes.MAX_LIMIT_REACHED);
      }

      // Validate email uniqueness if provided
      const cleanEmail = rawEmail ? String(rawEmail).trim().toLowerCase() : null;
      if (cleanEmail) {
        const emailExists = await stores.pool.query(
          'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
          [cleanEmail],
        );
        if (emailExists.rows.length > 0) {
          return sendError(res, 400, 'Email address already in use', ErrorCodes.ALREADY_EXISTS);
        }
      }

      const user = await createUserWithProfile(
        { cleanUsername, passwordHash, newUserId, cleanEmail },
        deps,
      );

      const token = await createUserSession(user.id, user.username);
      setNoStore(res);
      setUserSessionCookie(res, token);

      // Issue refresh token for mobile clients
      let refreshToken = null;
      if (stores.refreshTokens) {
        const { hashSessionToken: hashToken } = deps;
        refreshToken = createOpaqueId('rt');
        await stores.refreshTokens.create({
          token: hashToken(refreshToken),
          userId: user.id,
          sessionToken: hashToken(token),
          expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL),
        });
      }

      const { serializePublicUser } = deps;
      const _roles = await stores.roles.getUserRoles(user.id);
      res.status(201);
      return sendSuccess(res, { user: serializePublicUser(user), token, refreshToken, emailVerificationSent: !!cleanEmail });
    } catch (error) {
      log.error('register failed', { error: error.message });
      return sendError(res, 500, 'Registration failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/login', rateLimit(10, 'login'), validate(schemas.login), async (req, res) => {
    try {
      const { username, password } = req.validatedBody;
      if (!username || !password) {
        return sendError(res, 400, 'Username and password required', ErrorCodes.MISSING_FIELD);
      }
      let user = (await getUsers()).find((candidate) => candidate.username.toLowerCase() === String(username).trim().toLowerCase());

      // If not found in active users, check for soft-deleted accounts (reactivation flow)
      if (!user) {
        try {
          const softDeleted = await stores.users.findByUsername?.(String(username).trim());
          if (softDeleted?.deletedAt) user = softDeleted;
        } catch { /* ignored */ }
      }

      // Check account lockout (per-user failure tracking)
      if (user) {
        const failures = await stores.loginFailures?.get(user.id);
        if (failures?.lockedUntil && new Date() < new Date(failures.lockedUntil)) {
          const retryAfterSec = Math.ceil((new Date(failures.lockedUntil) - new Date()) / 1000);
          res.setHeader('Retry-After', String(retryAfterSec));
          return sendError(res, 423, 'Account temporarily locked due to too many failed attempts', ErrorCodes.ACCOUNT_LOCKED);
        }
      }

      // Rate limit by userId (for distributed credential stuffing attacks)
      if (user && !deps.consumeUserAuthRateLimit(user.id, config.AUTH_RATE_LIMIT_MAX)) {
        const jitter = 100 + Math.floor(Math.random() * 100);
        return setTimeout(() => sendError(res, 429, 'Too many login attempts for this account', ErrorCodes.RATE_LIMITED), jitter);
      }

      const passwordValid = await verifyPassword(String(password), user?.passwordHash || DUMMY_PASSWORD_HASH);
      if (!user || !passwordValid) {
        // Track auth failures for brute force detection
        if (deps.state?.metrics) {
          deps.state.metrics.authFailures = (deps.state.metrics.authFailures || 0) + 1;
        }
        // Per-user failure tracking with lockout
        if (user && stores.loginFailures) {
          await stores.loginFailures.record(user.id);
          const failures = await stores.loginFailures.get(user.id);
          if (failures && failures.consecutiveFailures >= config.MAX_LOGIN_FAILURES) {
            const lockUntil = new Date(Date.now() + config.LOGIN_LOCKOUT_MS);
            await stores.loginFailures.lock(user.id, lockUntil);
            log.warn('account locked', { userId: user.id, failures: failures.consecutiveFailures });
          }
        }
        const jitter = 500 + Math.floor(Math.random() * 1000);
        const username_or_user = user ? user.username : 'unknown';
        log.warn('authentication failed', { username: username_or_user, ip: req.ip });
        return setTimeout(() => sendError(res, 401, 'Invalid username or password', ErrorCodes.INVALID_CREDENTIALS), jitter);
      }

      // Reset login failure counter on success
      if (stores.loginFailures) await stores.loginFailures.reset(user.id);

      // Reactivate soft-deleted accounts on successful login (30-day grace period)
      if (user.deletedAt) {
        await stores.users.update(user.id, { deletedAt: null });
        invalidateUserCache();
        log.info('account:reactivated', { userId: user.id, username: user.username });
      }

      const token = await createUserSession(user.id, user.username);
      setNoStore(res);
      setUserSessionCookie(res, token);

      // Issue refresh token for mobile clients (90-day TTL with rotation)
      let refreshToken = null;
      if (stores.refreshTokens) {
        const { hashSessionToken: hashToken } = deps;
        refreshToken = createOpaqueId('rt');
        const refreshTokenHash = hashToken(refreshToken);
        await stores.refreshTokens.create({
          token: refreshTokenHash,
          userId: user.id,
          sessionToken: hashToken(token),
          expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL),
        });
      }

      const { serializePublicUser } = deps;
      const roles = await stores.roles.getUserRoles(user.id);
      return sendSuccess(res, { user: serializePublicUser(user), token, refreshToken, roles });
    } catch (error) {
      log.error('login failed', { error: error.message });
      return sendError(res, 500, 'Login failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/verify', rateLimit(30, 'verify-token'), async (req, res) => {
    try {
      setNoStore(res);
      const { token } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);
      const session = await validateUserSession(token);
      if (!session) return sendError(res, 401, 'Invalid or expired session', ErrorCodes.AUTH_REQUIRED);
      const user = await getUserById(session.userId);
      if (!user) return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
      const { serializePublicUser, stores: depStores } = deps;
      const roles = await depStores.roles.getUserRoles(session.userId);
      return sendSuccess(res, { valid: true, user: serializePublicUser(user), roles });
    } catch (error) {
      log.error('verify failed', { error: error.message });
      return sendError(res, 500, 'Verify failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /me — mobile-friendly current user endpoint (same as verify but GET)
  router.get('/me', userAuth, rateLimit(120, 'get-me'), async (req, res) => {
    try {
      setNoStore(res);
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
      const { serializePublicUser, getProfiles, stores: depStores } = deps;
      const profiles = (await getProfiles()).filter((p) => p.userId === req.user.userId);
      const roles = await depStores.roles.getUserRoles(req.user.userId);
      return sendSuccess(res, {
        user: serializePublicUser(user),
        roles,
        festivals: profiles.map((p) => ({ festivalId: p.festivalId, profileId: p.id })),
      });
    } catch (error) {
      log.error('get user failed', { error: error.message });
      return sendError(res, 500, 'Failed to get user info', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/logout', rateLimit(10, 'logout'), async (req, res) => {
    try {
      setNoStore(res);
      const { token } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);
      // eslint-disable-next-line no-shadow
      const { stores, hashSessionToken } = deps;
      if (token) {
        await stores.sessions.deleteUserSession(hashSessionToken(token));
        const disconnectSessionTokens = deps.disconnectSessionTokens;
        disconnectSessionTokens([token], io);
      }
      clearUserSessionCookie(res);
      return sendSuccess(res, { success: true });
    } catch (error) {
      log.error('logout failed', { error: error.message });
      return sendError(res, 500, 'Logout failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Token refresh — exchange a valid session for a fresh token (mobile apps)
  router.post('/refresh', userAuth, rateLimit(20, 'session-refresh'), async (req, res) => {
    try {
      setNoStore(res);
      // Invalidate the old session, issue a new one
      const { stores: storesRef, hashSessionToken: hashToken, disconnectSessionTokens } = deps;
      if (req.userToken) {
        await storesRef.sessions.deleteUserSession(hashToken(req.userToken));
        // Disconnect sockets still using the old token to prevent stale connections
        disconnectSessionTokens([req.userToken], io);
      }
      const token = await createUserSession(req.user.userId, req.user.username);
      setUserSessionCookie(res, token);
      const { serializePublicUser } = deps;
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
      return sendSuccess(res, { user: serializePublicUser(user), token });
    } catch (error) {
      log.error('token refresh failed', { error: error.message });
      return sendError(res, 500, 'Token refresh failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /refresh-token — exchange refresh token for new session + new refresh token ──
  router.post('/refresh-token', rateLimit(20, 'refresh-token'), validate(schemas.refreshToken), async (req, res) => {
    try {
      setNoStore(res);
      const { refreshToken: incomingRefreshToken } = req.validatedBody;
      if (!stores.refreshTokens) {
        return sendError(res, 501, 'Refresh tokens not supported', ErrorCodes.INTERNAL_ERROR);
      }

      const { hashSessionToken: hashToken } = deps;
      const hashedToken = hashToken(incomingRefreshToken);
      const stored = await stores.refreshTokens.validate(hashedToken);
      if (!stored) {
        return sendError(res, 401, 'Invalid or expired refresh token', ErrorCodes.TOKEN_EXPIRED);
      }

      const user = await getUserById(stored.userId);
      if (!user) {
        return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
      }

      // Issue new session token
      const newSessionToken = await createUserSession(user.id, user.username);
      setUserSessionCookie(res, newSessionToken);

      // Rotate refresh token (old one marked revoked, new one issued)
      const newRefreshToken = createOpaqueId('rt');
      const newRefreshHash = hashToken(newRefreshToken);
      await stores.refreshTokens.rotate(
        hashedToken,
        newRefreshHash,
        hashToken(newSessionToken),
        new Date(Date.now() + config.REFRESH_TOKEN_TTL),
      );

      const { serializePublicUser } = deps;
      const _roles = await stores.roles.getUserRoles(user.id);
      return sendSuccess(res, {
        user: serializePublicUser(user),
        token: newSessionToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      log.error('refresh-token failed', { error: error.message });
      return sendError(res, 500, 'Token refresh failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /sessions — list active sessions for current user ─────────────
  // Session management: Justified. Users need control over active sessions for security on shared devices.
  // Especially important for festival-goer accounts which may be accessed by friends.
  router.get('/sessions', userAuth, rateLimit(60, 'get-sessions'), async (req, res) => {
    try {
      setNoStore(res);
      // eslint-disable-next-line no-shadow
      const { stores, hashSessionToken: hashToken } = deps;
      const crypto = require('crypto');
      const sessions = await stores.sessions.listUserSessions(req.user.userId);
      const currentTokenHash = req.userToken ? hashToken(req.userToken) : null;
      // Use an opaque identifier derived from SHA-256 of the token hash instead
      // of exposing a 24-char prefix of the actual token hash. This prevents
      // any partial-preimage attack surface while remaining stable per-session.
      const items = sessions.map((s) => ({
        id: crypto.createHash('sha256').update(s.token).digest('hex').slice(0, 16),
        createdAt: new Date(s.createdAt).toISOString(),
        lastAccess: new Date(s.lastAccess).toISOString(),
        current: s.token === currentTokenHash,
      }));
      return sendSuccess(res, items);
    } catch (error) {
      log.error('list sessions failed', { error: error.message });
      return sendError(res, 500, 'Failed to list sessions', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /sessions/:id — revoke a specific session ──────────────────
  router.delete('/sessions/:id', userAuth, rateLimit(10, 'del-session'), async (req, res) => {
    try {
      setNoStore(res);
      // eslint-disable-next-line no-shadow
      const { stores, hashSessionToken: hashToken } = deps;
      const crypto = require('crypto');
      const sessionId = req.params.id;
      if (!sessionId || sessionId.length !== 16 || !/^[a-f0-9]+$/i.test(sessionId)) {
        return sendError(res, 400, 'Invalid session ID', ErrorCodes.INVALID_INPUT);
      }

      // Find matching session by opaque id (SHA-256 of token hash, first 16 hex chars)
      const sessions = await stores.sessions.listUserSessions(req.user.userId);
      const target = sessions.find((s) => crypto.createHash('sha256').update(s.token).digest('hex').slice(0, 16) === sessionId);
      if (!target) return sendError(res, 404, 'Session not found', ErrorCodes.NOT_FOUND);

      // Prevent revoking current session (use /logout instead)
      const currentTokenHash = req.userToken ? hashToken(req.userToken) : null;
      if (target.token === currentTokenHash) {
        return sendError(res, 400, 'Cannot revoke current session. Use /logout instead.', ErrorCodes.INVALID_INPUT);
      }

      await stores.sessions.deleteUserSession(target.token);
      // Disconnect sockets using the revoked session
      const disconnectSessionTokens = deps.disconnectSessionTokens;
      if (disconnectSessionTokens) {
        // We need raw token to disconnect sockets, but we only have the hash.
        // Disconnect by scanning sockets for this user — targeted by token hash.
        for (const [, socket] of io.sockets.sockets) {
          if (socket.data?.userId === req.user.userId) {
            const socketTokenHash = socket.data.userSessionToken ? hashToken(socket.data.userSessionToken) : null;
            if (socketTokenHash === target.token) {
              socket.emit('session:revoked', { reason: 'Session revoked by user' });
              socket.disconnect(true);
            }
          }
        }
      }

      log.info('session:revoked', { userId: req.user.userId, sessionId });
      return sendSuccess(res, { success: true });
    } catch (error) {
      log.error('revoke session failed', { error: error.message });
      return sendError(res, 500, 'Failed to revoke session', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /sessions — revoke all sessions except current ─────────────
  router.delete('/sessions', userAuth, rateLimit(5, 'del-all-sessions'), async (req, res) => {
    try {
      setNoStore(res);
      const currentTokenHash = req.userToken ? deps.hashSessionToken(req.userToken) : null;
      await invalidateUserSessions(req.user.userId, req.userToken);

      // Disconnect all sockets for this user except current session
      for (const [, socket] of io.sockets.sockets) {
        if (socket.data?.userId === req.user.userId) {
          const socketTokenHash = socket.data.userSessionToken ? deps.hashSessionToken(socket.data.userSessionToken) : null;
          if (socketTokenHash !== currentTokenHash) {
            socket.emit('session:revoked', { reason: 'All other sessions revoked' });
            socket.disconnect(true);
          }
        }
      }

      log.info('sessions:revoke-all', { userId: req.user.userId });
      return sendSuccess(res, { success: true });
    } catch (error) {
      log.error('revoke all sessions failed', { error: error.message });
      return sendError(res, 500, 'Failed to revoke sessions', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/change-password', userAuth, rateLimit(5, 'change-password'), validate(schemas.changePassword), async (req, res) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.validatedBody;
      if (!currentPassword || !newPassword || !confirmPassword) {
        return sendError(res, 400, 'Current and new password required', ErrorCodes.MISSING_FIELD);
      }
      if (!validatePasswordStrength(newPassword)) {
        return sendError(res, 400, 'New password must be 8-100 characters', ErrorCodes.INVALID_INPUT);
      }
      if (newPassword !== confirmPassword) {
        return sendError(res, 400, 'New passwords do not match', ErrorCodes.INVALID_INPUT);
      }

      // Hash new password outside the write lock to minimize lock time
      const newPasswordHash = await hashPassword(newPassword);

      // Verify current password first
      const user = await getUserById(req.user.userId);
      if (!user) {
        return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      }
      if (!await verifyPassword(currentPassword, user.passwordHash)) {
        return sendError(res, 400, 'Current password incorrect', ErrorCodes.PASSWORD_INCORRECT);
      }

      // Update password in database
      await stores.users.update(req.user.userId, { passwordHash: newPasswordHash });
      invalidateUserCache();
      // Invalidate all existing sessions immediately after password change
      // to close the window where old sessions remain valid
      await invalidateUserSessions(req.user.userId);
      disconnectUserSockets(req.user.userId, io);
      const token = await createUserSession(req.user.userId, req.user.username);
      setNoStore(res);
      setUserSessionCookie(res, token);
      return sendSuccess(res, { success: true, token });
    } catch (error) {
      log.error('change-password failed', { error: error.message });
      return sendError(res, 500, 'Failed to change password', ErrorCodes.INTERNAL_ERROR);
    }
  });


  return router;
};
