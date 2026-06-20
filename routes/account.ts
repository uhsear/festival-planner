// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';

import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { RouteDeps } from '../lib/types';
import type { displayNameChangeSchema, accountDeleteSchema, paymentHandlesSchema } from '../lib/schemas';

/**
 * Collect all user data for GDPR export. Gathers profiles, device tokens,
 * crews, sessions, notification preferences, and topic subscriptions.
 */
async function collectGdprData(
  userId: string,
  currentUser: { id: string; username: string; createdAt?: string; updatedAt?: string },
  deps: RouteDeps,
) {
  const { stores, getProfiles, log } = deps;

  // GDPR dump is an open-ended, section-by-section accumulator over loosely
  // typed store rows; its shape is the export contract, not a domain type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exportData: any = {
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

  // Get profiles for this user — use targeted query when available
  const userProfiles = stores?.profiles?.getByUserId
    ? await stores.profiles.getByUserId(userId)
    : (getProfiles ? await getProfiles() : []).filter((p: { userId: string }) => p.userId === userId);

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
    const tokens = (await stores.deviceTokens.listByUser(userId)) || [];
    exportData.deviceTokens = tokens.map((t: Record<string, unknown>) => ({
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
      exportData.crews = (userCrews || []).map((c: Record<string, unknown>) => ({
        id: c.id,
        name: c.name,
        festivalId: c.festivalId,
        role: c.role,
        joinedAt: c.joinedAt,
      }));
    } catch (error) {
      log.warn('gdpr-export:partial-failure', { section: 'crews', userId, error: (error as Error).message });
      exportData.crews = [];
    }
  }

  // Get active sessions (exclude token hashes)
  if (stores?.sessions?.listUserSessions) {
    try {
      const sessions = await stores.sessions.listUserSessions(userId);
      exportData.sessions = sessions.map((s: { createdAt: string | number; lastAccess: string | number }) => ({
        createdAt: new Date(s.createdAt).toISOString(),
        lastAccess: new Date(s.lastAccess).toISOString(),
      }));
    } catch (error) {
      log.warn('gdpr-export:partial-failure', { section: 'sessions', userId, error: (error as Error).message });
      exportData.sessions = [];
    }
  }

  // Get notification preferences (GDPR: include all personal data)
  if (stores?.notificationPrefs?.get) {
    exportData.notificationPreferences = await stores.notificationPrefs.get(userId);
  }

  // Get topic subscriptions per festival (parallel instead of sequential)
  if (stores?.topicSubscriptions?.getForUser) {
    const results = await Promise.all(
      userProfiles.map(async (profile: { festivalId: string }) => {
        const subs = await stores.topicSubscriptions.getForUser(userId, profile.festivalId);
        return subs && Object.keys(subs).length > 0 ? { festivalId: profile.festivalId, subscriptions: subs } : null;
      }),
    );
    exportData.topicSubscriptions = results.filter(Boolean);
  }

  return exportData;
}

export default function createAccountRoutes(deps: RouteDeps) {
  const {
    express,
    _config,
    log,
    userAuth,
    handleAvatarUpload,
    processAvatarUpload,
    runUserTask,
    getUserById,
    getUsers: _getUsers,
    writeAvatarFile,
    removeAvatarFile,
    createVersionToken,
    emitProfileIdentity,
    setNoStore,
    serializePublicUser,
    sanitizeString,
    rateLimit,
    sendSuccess,
    sendError,
    ErrorCodes,
    schemas,
    validate,
    io,
    stores,
    invalidateUserCache,
  } = deps;

  const router = express.Router();

  // Rate limiter for GDPR data exports (1 per 24 hours per user)
  const exportRateLimits = new Map<string, number>();
  const EXPORT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours
  const MAX_EXPORT_RATE_ENTRIES = 1000;

  function canExportData(userId: string) {
    const lastExport = exportRateLimits.get(userId);
    if (!lastExport) return true;
    return Date.now() - lastExport >= EXPORT_RATE_LIMIT_MS;
  }

  function recordExport(userId: string) {
    exportRateLimits.set(userId, Date.now());
    // Cap Map size with FIFO eviction
    if (exportRateLimits.size > MAX_EXPORT_RATE_ENTRIES) {
      const oldest = exportRateLimits.keys().next().value as string;
      exportRateLimits.delete(oldest);
    }
  }

  // ── POST /avatar — upload avatar ──────────────────────────────────────
  router.post(
    '/avatar',
    userAuth,
    rateLimit(10, 'avatar-upload'),
    handleAvatarUpload,
    async (req: Request, res: Response) => {
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
            throw new Error('Avatar write failed during upload', { cause: err });
          }
        });

        if (!updatedUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        deps.invalidateUserCache();
        emitProfileIdentity(updatedUser, io);
        setNoStore(res);
        return sendSuccess(res, { user: serializePublicUser(updatedUser) });
      } catch (error) {
        const e = error as { statusCode?: number; message: string };
        if (e.statusCode) {
          return sendError(res, e.statusCode, e.message, ErrorCodes.INVALID_INPUT);
        }
        log.error('avatar upload failed', { error: e.message });
        return sendError(res, 400, 'Failed to process avatar image', ErrorCodes.INVALID_INPUT);
      }
    },
  );

  // ── DELETE /avatar — remove avatar ────────────────────────────────────
  router.delete('/avatar', userAuth, rateLimit(60, 'avatar-delete'), async (req: Request, res: Response) => {
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
      log.error('avatar delete failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to remove avatar', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── PUT|PATCH /display-name — change the editable display name ─────────
  // The username is the immutable @handle and is NOT user-editable (only
  // admins can rename via the admin tools). display_name is the friendly name
  // shown across crews/account; clients fall back to @username when it's unset.
  const updateDisplayName = async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const { displayName } = req.validatedBody as z.infer<typeof displayNameChangeSchema>;
      const cleanDisplayName = sanitizeString(displayName, 50);
      if (!cleanDisplayName) {
        return sendError(res, 400, 'Display name must be 1-50 characters', ErrorCodes.INVALID_INPUT);
      }

      const currentUser = await getUserById(req.user.userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      const result = await stores.users.update(req.user.userId, { displayName: cleanDisplayName });
      if (!result) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      invalidateUserCache();

      emitProfileIdentity(result, io);
      return sendSuccess(res, { user: serializePublicUser(result) });
    } catch (error) {
      log.error('display name change failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to change display name', ErrorCodes.INTERNAL_ERROR);
    }
  };
  router.put(
    '/display-name',
    userAuth,
    rateLimit(10, 'display-name-change'),
    validate(schemas.displayNameChange),
    updateDisplayName,
  );
  router.patch(
    '/display-name',
    userAuth,
    rateLimit(10, 'display-name-change'),
    validate(schemas.displayNameChange),
    updateDisplayName,
  );

  // ── PUT|PATCH /payment-handles — set Venmo / Cash App / PayPal handles ─
  // Used to build prefilled settle-up deep links. Each field is independently
  // optional: only the provided keys are updated; an explicit empty string
  // clears that handle (stored as NULL). A leading '@' or '$' is stripped so
  // the deep-link builders get a bare identifier.
  const updatePaymentHandles = async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const body = req.validatedBody as z.infer<typeof paymentHandlesSchema>;

      // Normalize a raw handle: trim, drop a leading @/$, cap length. Empty
      // (or whitespace-only) clears the handle.
      const clean = (raw: string | undefined): string | null | undefined => {
        if (raw === undefined) return undefined; // not provided → leave unchanged
        const trimmed = sanitizeString(raw, 64)
          .replace(/^[@$]+/, '')
          .trim();
        return trimmed.length > 0 ? trimmed : null;
      };

      const fields: Record<string, string | null> = {};
      const venmo = clean(body.venmoHandle);
      const cashapp = clean(body.cashappCashtag);
      const paypal = clean(body.paypalHandle);
      if (venmo !== undefined) fields.venmoHandle = venmo;
      if (cashapp !== undefined) fields.cashappCashtag = cashapp;
      if (paypal !== undefined) fields.paypalHandle = paypal;

      if (Object.keys(fields).length === 0) {
        return sendError(res, 400, 'No payment handles provided', ErrorCodes.INVALID_INPUT);
      }

      const currentUser = await getUserById(req.user.userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      const result = await stores.users.update(req.user.userId, fields);
      if (!result) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      invalidateUserCache();

      return sendSuccess(res, { user: serializePublicUser(result) });
    } catch (error) {
      log.error('payment handles update failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to update payment handles', ErrorCodes.INTERNAL_ERROR);
    }
  };
  router.put(
    '/payment-handles',
    userAuth,
    rateLimit(10, 'payment-handles-change'),
    validate(schemas.paymentHandles),
    updatePaymentHandles,
  );
  router.patch(
    '/payment-handles',
    userAuth,
    rateLimit(10, 'payment-handles-change'),
    validate(schemas.paymentHandles),
    updatePaymentHandles,
  );

  // ── DELETE / — soft-delete account (30-day grace period) ──────────────
  router.delete(
    '/',
    userAuth,
    rateLimit(5, 'account-delete'),
    validate(schemas.accountDelete),
    async (req: Request, res: Response) => {
      try {
        const { password } = req.validatedBody as z.infer<typeof accountDeleteSchema>;

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
          if ((err as { code?: string }).code === '40P01') {
            await performSoftDelete();
          } else {
            throw new Error('Account soft-delete failed', { cause: err });
          }
        }

        log.warn('account:soft-delete', {
          userId: req.user.userId,
          username: currentUser.username,
          ip: getRequestIp(req),
        });
        deps.clearUserSessionCookie(res);
        return sendSuccess(res, {
          success: true,
          message: 'Account scheduled for deletion. You have 30 days to reactivate by logging in.',
          deletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      } catch (error) {
        log.error('account soft-delete failed', { error: (error as Error).message, userId: req.user.userId });
        return sendError(res, 500, 'Failed to delete account', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /export — GDPR data export ────────────────────────────────────────
  router.get('/export', userAuth, rateLimit(10, 'account-export'), async (req: Request, res: Response) => {
    try {
      const userId = req.user.userId;

      // Check rate limit: 1 export per 24 hours
      if (!canExportData(userId)) {
        // canExportData returned false, so an entry exists for this user.
        const lastExport = exportRateLimits.get(userId)!;
        const nextAvailable = new Date(lastExport + EXPORT_RATE_LIMIT_MS);
        return sendError(
          res,
          429,
          `Data export rate limited. Next available: ${nextAvailable.toISOString()}`,
          ErrorCodes.RATE_LIMITED,
        );
      }

      const currentUser = await getUserById(userId);
      if (!currentUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

      const exportData = await collectGdprData(userId, currentUser, deps);

      recordExport(userId);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `festie-data-${timestamp}.json`;
      // The body is the user's full PII dump — never cache it (browser disk
      // cache / shared machine / intermediary proxy).
      setNoStore(res);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      log.info('account:gdpr-export', { userId, username: currentUser.username });
      return sendSuccess(res, exportData);
    } catch (error) {
      log.error('account export failed', { error: (error as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to export data', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
