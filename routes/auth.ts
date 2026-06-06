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

import crypto from 'crypto';
import type { Request, Response, Router } from 'express';
import { sendVerificationEmail } from '../lib/email';
// Request augmentation (validatedBody, user, userToken, …) now lives centrally
// in lib/types/request.ts. Importing the types barrel pulls in its global
// side-effect so this module sees the augmented Request.
import type {} from '../lib/types';

/**
 * Create a new user, link orphan festival profiles, and optionally send
 * a verification email. Returns the created user record.
 *
 * Callers are responsible for session creation and HTTP response.
 */
async function createUserWithProfile(userData: any, deps: any) {
  const { cleanUsername, passwordHash, newUserId, cleanEmail } = userData;
  const { stores, config, log, invalidateUserCache } = deps;

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

  // Auto-link orphan profiles that match the new username (single batch query)
  await stores.profiles.claimOrphanProfiles(user.id, cleanUsername);

  // Send verification email if email was provided
  if (cleanEmail) {
    try {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await stores.pool.query(
        "INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)",
        [user.id, tokenHash, cleanEmail, config.EMAIL_VERIFY_TOKEN_TTL_HOURS],
      );
      const verifyUrl = `${config.PUBLIC_ORIGIN}/api/v1/auth/verify-email?token=${verifyToken}`;
      await sendVerificationEmail({ to: cleanEmail, username: cleanUsername, verifyUrl, config, log });
    } catch (emailErr: any) {
      log.error('register:verify-email-send-failed', { error: emailErr.message, userId: user.id });
      // Don't fail registration if email send fails
    }
  }

  return user;
}

/**
 * Issue a refresh token for mobile clients and persist it.
 * Returns the raw refresh token string, or null if refresh tokens are disabled.
 */
async function issueRefreshToken(userId: string, sessionToken: string, deps: any) {
  const { stores, config, createOpaqueId } = deps;
  if (!stores.refreshTokens) return null;
  const { hashSessionToken: hashToken } = deps;
  const refreshToken = createOpaqueId('rt');
  await stores.refreshTokens.create({
    token: hashToken(refreshToken),
    userId,
    sessionToken: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL),
  });
  return refreshToken;
}

/**
 * Track a failed login attempt: increment metrics, record per-user failure,
 * and lock the account if the failure threshold is reached.
 */
async function handleLoginFailure(user: any, deps: any) {
  const { stores, config, log, state } = deps;
  if (state?.metrics) {
    state.metrics.authFailures = (state.metrics.authFailures || 0) + 1;
  }
  if (user && stores.loginFailures) {
    await stores.loginFailures.record(user.id);
    const failures = await stores.loginFailures.get(user.id);
    if (failures && failures.consecutiveFailures >= config.MAX_LOGIN_FAILURES) {
      const lockUntil = new Date(Date.now() + config.LOGIN_LOCKOUT_MS);
      await stores.loginFailures.lock(user.id, lockUntil);
      log.warn('account locked', { userId: user.id, failures: failures.consecutiveFailures });
    }
  }
}

/**
 * Compute the opaque session identifier (SHA-256 of token hash, first 16 hex chars).
 */
function computeSessionOpaqueId(tokenHash: string) {
  return crypto.createHash('sha256').update(tokenHash).digest('hex').slice(0, 16);
}

/**
 * Disconnect sockets belonging to a user whose session token hash matches
 * `targetTokenHash`, emitting a revocation event before disconnecting.
 */
function disconnectSessionSockets(userId: string, targetTokenHash: string, reason: string, deps: any) {
  const { io, hashSessionToken: hashToken } = deps;
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data?.userId === userId) {
      const socketTokenHash = socket.data.userSessionToken ? hashToken(socket.data.userSessionToken) : null;
      if (socketTokenHash === targetTokenHash) {
        socket.emit('session:revoked', { reason });
        socket.disconnect(true);
      }
    }
  }
}

export default function createAuthRoutes(deps: any): Router {
  const {
    express,
    config,
    log,
    sanitizeString,
    validateUsername,
    checkPasswordPolicy,
    hashPassword,
    verifyPassword,
    createUserSession,
    validateUserSession,
    invalidateUserSessions,
    resolveRequestToken,
    setNoStore,
    setUserSessionCookie,
    clearUserSessionCookie,
    userAuth,
    getUserById,
    getUsers: _getUsers,
    disconnectUserSockets,
    createOpaqueId,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    io,
    DUMMY_PASSWORD_HASH,
    schemas,
    validate,
    stores,
    invalidateUserCache,

    _pool,
    _state,
    _hashSessionToken,
    _createAuditLog,
    _getRequestIp,
  } = deps;

  const router = express.Router();

  async function validateRegistrationInput(body: any) {
    const { username, password, confirmPassword, email: rawEmail } = body;
    const cleanUsername = sanitizeString(username, 30);
    if (!validateUsername(cleanUsername)) {
      return { error: 'Username must be 2-30 characters (letters, numbers, spaces, hyphens, underscores)' };
    }
    const pwError = checkPasswordPolicy(password, { username: cleanUsername, email: rawEmail });
    if (pwError) {
      return { error: pwError };
    }
    if (password !== confirmPassword) {
      return { error: 'Passwords do not match' };
    }
    return { cleanUsername, cleanEmail: rawEmail ? String(rawEmail).trim().toLowerCase() : null };
  }

  async function checkRegistrationConflicts(cleanUsername: string, cleanEmail: string | null) {
    const [existingUser, userCount] = await Promise.all([
      stores.users.getByUsername(cleanUsername),
      stores.users.countActive(),
    ]);
    if (existingUser) return 'Username already taken';
    if (userCount >= config.MAX_USERS) return 'Maximum users reached';

    if (cleanEmail) {
      const emailExists = await stores.pool.query(
        'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
        [cleanEmail],
      );
      if (emailExists.rows.length > 0) return 'Email address already in use';
    }
    return null;
  }

  router.post(
    '/register',
    rateLimit(5, 'register'),
    validate(schemas.register),
    async (req: Request, res: Response) => {
      try {
        const validated = await validateRegistrationInput(req.validatedBody as any);
        if (validated.error) return sendError(res, 400, validated.error, ErrorCodes.INVALID_INPUT);
        const { cleanUsername, cleanEmail } = validated;

        const conflict = await checkRegistrationConflicts(cleanUsername!, cleanEmail!);
        if (conflict) {
          const code = conflict === 'Maximum users reached' ? ErrorCodes.MAX_LIMIT_REACHED : ErrorCodes.ALREADY_EXISTS;
          return sendError(res, 400, conflict, code);
        }

        const passwordHash = await hashPassword((req.validatedBody as any).password);
        const newUserId = createOpaqueId('user');
        const user = await createUserWithProfile({ cleanUsername, passwordHash, newUserId, cleanEmail }, deps);

        const token = await createUserSession(user.id, user.username);
        setNoStore(res);
        setUserSessionCookie(res, token);
        const refreshToken = await issueRefreshToken(user.id, token, deps);

        const { serializePublicUser } = deps;
        const _roles = await stores.roles.getUserRoles(user.id);
        res.status(201);
        // TODO (H4): token/refreshToken are returned in the body for the mobile
        // (bearer-mode) client; the web (cookie-mode) client must NOT persist
        // them. There is no clean server-side signal to distinguish the two at
        // register time (no auth header exists yet on the request), so omitting
        // them here would break mobile. The primary mitigation is the WEB
        // client dropping client-side persistence; revisit if an explicit
        // client-mode flag (e.g. header/query param) is introduced.
        return sendSuccess(res, {
          user: serializePublicUser(user),
          token,
          refreshToken,
          emailVerificationSent: !!cleanEmail,
        });
      } catch (error: any) {
        log.error('register failed', { error: error.message });
        return sendError(res, 500, 'Registration failed', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  async function resolveLoginUser(username: string) {
    let user = await stores.users.getByUsername(String(username).trim());
    if (!user) {
      try {
        const softDeleted = await stores.users.findByUsername?.(String(username).trim());
        if (softDeleted?.deletedAt) user = softDeleted;
      } catch {
        /* ignored */
      }
    }
    return user;
  }

  async function checkAccountLockout(user: any, res: Response) {
    if (!user) return false;
    const failures = await stores.loginFailures?.get(user.id);
    if (failures?.lockedUntil && new Date() < new Date(failures.lockedUntil)) {
      const retryAfterSec = Math.ceil((new Date(failures.lockedUntil).getTime() - new Date().getTime()) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      sendError(res, 423, 'Account temporarily locked due to too many failed attempts', ErrorCodes.ACCOUNT_LOCKED);
      return true;
    }
    return false;
  }

  router.post('/login', rateLimit(10, 'login'), validate(schemas.login), async (req: Request, res: Response) => {
    try {
      const { username, password } = req.validatedBody as any;
      if (!username || !password) {
        return sendError(res, 400, 'Username and password required', ErrorCodes.MISSING_FIELD);
      }
      const user = await resolveLoginUser(username);

      if (await checkAccountLockout(user, res)) return;

      if (user && !deps.consumeUserAuthRateLimit(user.id, config.AUTH_RATE_LIMIT_MAX)) {
        const jitter = 100 + Math.floor(Math.random() * 100);
        return setTimeout(
          () => sendError(res, 429, 'Too many login attempts for this account', ErrorCodes.RATE_LIMITED),
          jitter,
        );
      }

      const passwordValid = await verifyPassword(String(password), user?.passwordHash || DUMMY_PASSWORD_HASH);
      if (!user || !passwordValid) {
        await handleLoginFailure(user, deps);
        const jitter = 500 + Math.floor(Math.random() * 1000);
        log.warn('authentication failed', { username: user ? user.username : 'unknown', ip: req.ip });
        return setTimeout(
          () => sendError(res, 401, 'Invalid username or password', ErrorCodes.INVALID_CREDENTIALS),
          jitter,
        );
      }

      if (stores.loginFailures) await stores.loginFailures.reset(user.id);

      if (user.deletedAt) {
        await stores.users.update(user.id, { deletedAt: null });
        invalidateUserCache();
        log.info('account:reactivated', { userId: user.id, username: user.username });
      }

      const token = await createUserSession(user.id, user.username);
      setNoStore(res);
      setUserSessionCookie(res, token);
      const refreshToken = await issueRefreshToken(user.id, token, deps);

      const { serializePublicUser } = deps;
      const roles = await stores.roles.getUserRoles(user.id);
      // TODO (H4): token/refreshToken are returned in the body for the mobile
      // (bearer-mode) client; the web (cookie-mode) client must NOT persist
      // them. No clean server-side signal distinguishes the two at login time
      // (no auth header on the request yet), so omitting them would break
      // mobile. Primary mitigation is the WEB client dropping client-side
      // persistence; revisit if an explicit client-mode flag is introduced.
      return sendSuccess(res, { user: serializePublicUser(user), token, refreshToken, roles });
    } catch (error: any) {
      log.error('login failed', { error: error.message });
      return sendError(res, 500, 'Login failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/verify', rateLimit(30, 'verify-token'), async (req: Request, res: Response) => {
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
    } catch (error: any) {
      log.error('verify failed', { error: error.message });
      return sendError(res, 500, 'Verify failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /me — mobile-friendly current user endpoint (same as verify but GET)
  router.get('/me', userAuth, rateLimit(120, 'get-me'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
      const { serializePublicUser, stores: depStores } = deps;
      const profiles = depStores.profiles.getByUserId
        ? await depStores.profiles.getByUserId(req.user.userId)
        : (await deps.getProfiles()).filter((p: any) => p.userId === req.user.userId);
      const roles = await depStores.roles.getUserRoles(req.user.userId);
      return sendSuccess(res, {
        user: serializePublicUser(user),
        roles,
        festivals: profiles.map((p: any) => ({ festivalId: p.festivalId, profileId: p.id })),
      });
    } catch (error: any) {
      log.error('get user failed', { error: error.message });
      return sendError(res, 500, 'Failed to get user info', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/logout', rateLimit(10, 'logout'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const { token } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);

      const { hashSessionToken } = deps;
      if (token) {
        await stores.sessions.deleteUserSession(hashSessionToken(token));
        const disconnectSessionTokens = deps.disconnectSessionTokens;
        disconnectSessionTokens([token], io);
      }
      clearUserSessionCookie(res);
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      log.error('logout failed', { error: error.message });
      return sendError(res, 500, 'Logout failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Token refresh — exchange a valid session for a fresh token (mobile apps)
  router.post('/refresh', userAuth, rateLimit(20, 'session-refresh'), async (req: Request, res: Response) => {
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
    } catch (error: any) {
      log.error('token refresh failed', { error: error.message });
      return sendError(res, 500, 'Token refresh failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /refresh-token — exchange refresh token for new session + new refresh token ──
  router.post(
    '/refresh-token',
    rateLimit(20, 'refresh-token'),
    validate(schemas.refreshToken),
    async (req: Request, res: Response) => {
      try {
        setNoStore(res);
        const { refreshToken: incomingRefreshToken } = req.validatedBody as any;
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
      } catch (error: any) {
        log.error('refresh-token failed', { error: error.message });
        return sendError(res, 500, 'Token refresh failed', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /sessions — list active sessions for current user ─────────────
  // Session management: Justified. Users need control over active sessions for security on shared devices.
  // Especially important for festival-goer accounts which may be accessed by friends.
  router.get('/sessions', userAuth, rateLimit(60, 'get-sessions'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);

      const { hashSessionToken: hashToken } = deps;
      const sessions = await stores.sessions.listUserSessions(req.user.userId);
      const currentTokenHash = req.userToken ? hashToken(req.userToken) : null;
      const items = sessions.map((s: any) => ({
        id: computeSessionOpaqueId(s.token),
        createdAt: new Date(s.createdAt).toISOString(),
        lastAccess: new Date(s.lastAccess).toISOString(),
        current: s.token === currentTokenHash,
      }));
      return sendSuccess(res, items);
    } catch (error: any) {
      log.error('list sessions failed', { error: error.message });
      return sendError(res, 500, 'Failed to list sessions', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /sessions/:id — revoke a specific session ──────────────────
  router.delete('/sessions/:id', userAuth, rateLimit(10, 'del-session'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);

      const { hashSessionToken: hashToken } = deps;
      const sessionId = req.params.id as string;
      if (!sessionId || sessionId.length !== 16 || !/^[a-f0-9]+$/i.test(sessionId)) {
        return sendError(res, 400, 'Invalid session ID', ErrorCodes.INVALID_INPUT);
      }

      const sessions = await stores.sessions.listUserSessions(req.user.userId);
      const target = sessions.find((s: any) => computeSessionOpaqueId(s.token) === sessionId);
      if (!target) return sendError(res, 404, 'Session not found', ErrorCodes.NOT_FOUND);

      const currentTokenHash = req.userToken ? hashToken(req.userToken) : null;
      if (target.token === currentTokenHash) {
        return sendError(res, 400, 'Cannot revoke current session. Use /logout instead.', ErrorCodes.INVALID_INPUT);
      }

      await stores.sessions.deleteUserSession(target.token);
      disconnectSessionSockets(req.user.userId, target.token, 'Session revoked by user', deps);

      log.info('session:revoked', { userId: req.user.userId, sessionId });
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      log.error('revoke session failed', { error: error.message });
      return sendError(res, 500, 'Failed to revoke session', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /sessions — revoke all sessions except current ─────────────
  router.delete('/sessions', userAuth, rateLimit(5, 'del-all-sessions'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const { hashSessionToken: hashToken } = deps;
      const currentTokenHash = req.userToken ? hashToken(req.userToken) : null;
      await invalidateUserSessions(req.user.userId, req.userToken);

      // Disconnect all sockets for this user except current session
      for (const [, socket] of io.sockets.sockets) {
        if (socket.data?.userId === req.user.userId) {
          const socketTokenHash = socket.data.userSessionToken ? hashToken(socket.data.userSessionToken) : null;
          if (socketTokenHash !== currentTokenHash) {
            socket.emit('session:revoked', { reason: 'All other sessions revoked' });
            socket.disconnect(true);
          }
        }
      }

      log.info('sessions:revoke-all', { userId: req.user.userId });
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      log.error('revoke all sessions failed', { error: error.message });
      return sendError(res, 500, 'Failed to revoke sessions', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post(
    '/change-password',
    userAuth,
    rateLimit(5, 'change-password'),
    validate(schemas.changePassword),
    async (req: Request, res: Response) => {
      try {
        const { currentPassword, newPassword, confirmPassword } = req.validatedBody as any;
        if (!currentPassword || !newPassword || !confirmPassword) {
          return sendError(res, 400, 'Current and new password required', ErrorCodes.MISSING_FIELD);
        }
        const pwError = checkPasswordPolicy(newPassword, { username: req.user?.username });
        if (pwError) {
          return sendError(res, 400, pwError, ErrorCodes.INVALID_INPUT);
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
        if (!(await verifyPassword(currentPassword, user.passwordHash))) {
          return sendError(res, 400, 'Current password incorrect', ErrorCodes.PASSWORD_INCORRECT);
        }

        // Update password in database
        await stores.users.update(req.user.userId, { passwordHash: newPasswordHash });
        invalidateUserCache();
        // Invalidate all existing sessions immediately after password change
        // to close the window where old sessions remain valid
        await invalidateUserSessions(req.user.userId);
        // Also revoke long-lived refresh tokens so a held token chain cannot
        // mint new sessions after the credential change (H2).
        if (stores.refreshTokens) await stores.refreshTokens.revokeAll(req.user.userId);
        disconnectUserSockets(req.user.userId, io);
        const token = await createUserSession(req.user.userId, req.user.username);
        setNoStore(res);
        setUserSessionCookie(res, token);
        return sendSuccess(res, { success: true, token });
      } catch (error: any) {
        log.error('change-password failed', { error: error.message });
        return sendError(res, 500, 'Failed to change password', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
