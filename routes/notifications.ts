// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { parsePageParams } from '../lib/pagination.js';

export default function createNotificationRoutes(deps: any) {
  const {
    express,
    _config,
    log,
    stores,
    userAuth,
    setNoStore,
    sanitizeString,
    sanitizeIdentifier,
    createOpaqueId,
    getRequestIp,
    sendSuccess,
    sendError,
    ErrorCodes,
    schemas,
    validate,
    rateLimit,
  } = deps;
  const router = express.Router();
  const noopLimit = (_req: any, _res: any, next: any) => next();
  const rl = (max: any, name: any) => (typeof rateLimit === 'function' ? rateLimit(max, name) : noopLimit);

  // ── Validation helpers ──────────────────────────────────────────────
  const ALLOWED_PLATFORMS = new Set(['web', 'ios', 'android']);
  const DND_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const TOKEN_MIN_LENGTH = 20;
  const TOKEN_MAX_LENGTH = 4096;
  const DEVICE_NAME_MAX = 60;
  const MAX_TOKENS_PER_USER = 10;

  // ── POST /token — register a device push token ──────────────────────
  // Rate limit routed through the shared Redis-backed `rl()` helper so limits
  // apply cluster-wide (in-memory limits under PM2 cluster mode multiply the
  // effective cap by the worker count).
  router.post('/token', userAuth, rl(5, 'notif-token-reg'), validate(schemas.pushToken), async (req: any, res: any) => {
    try {
      const { token, platform, deviceName } = req.validatedBody;
      if (!token || typeof token !== 'string' || token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH) {
        return sendError(res, 400, 'Invalid push token', ErrorCodes.INVALID_INPUT);
      }
      if (!token.trim()) return sendError(res, 400, 'Invalid push token (empty)', ErrorCodes.INVALID_INPUT);
      const cleanPlatform = String(platform || 'web').toLowerCase();
      if (!ALLOWED_PLATFORMS.has(cleanPlatform)) {
        return sendError(res, 400, 'Invalid platform (web, ios, android)', ErrorCodes.INVALID_INPUT);
      }
      const cleanDeviceName = deviceName ? sanitizeString(String(deviceName), DEVICE_NAME_MAX) : null;

      // Basic token format validation — reject obviously invalid tokens
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x1f]/.test(token)) {
        return sendError(res, 400, 'Token contains invalid characters', ErrorCodes.INVALID_INPUT);
      }

      // Check if token already exists for a different user (token hijacking prevention)
      const tokenOwner = await stores.deviceTokens.getTokenOwner(token);
      if (tokenOwner && tokenOwner.userId !== req.user.userId) {
        // Token belongs to another user — reject to prevent hijacking
        return sendError(res, 400, 'Invalid push token', ErrorCodes.INVALID_INPUT);
      }

      // Enforce per-user token cap
      const existing = await stores.deviceTokens.listByUser(req.user.userId);
      if (existing.length >= MAX_TOKENS_PER_USER) {
        const oldest = existing[existing.length - 1];
        await stores.deviceTokens.unregister(oldest.token, req.user.userId);
      }

      const id = createOpaqueId('dtoken');
      await stores.deviceTokens.register({
        id,
        userId: req.user.userId,
        token,
        platform: cleanPlatform,
        deviceName: cleanDeviceName,
      });
      log.info('device token registered', { userId: req.user.userId, platform: cleanPlatform, ip: getRequestIp(req) });
      return sendSuccess(res, { success: true, id });
    } catch (error: any) {
      if (error.message && error.message.includes('UNIQUE')) {
        // Token already exists — return success without leaking constraint info
        return sendSuccess(res, { success: true });
      }
      log.error('register device token failed', { error: error.message });
      return sendError(res, 500, 'Failed to register device token', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /token — unregister a device push token ──────────────────
  router.delete(
    '/token',
    userAuth,
    rl(10, 'notif-token-del'),
    validate(schemas.deleteToken),
    async (req: any, res: any) => {
      try {
        const { token } = req.validatedBody;
        if (!token || typeof token !== 'string') {
          return sendError(res, 400, 'Token required', ErrorCodes.MISSING_FIELD);
        }
        // unregister already scopes by userId — only deletes tokens owned by this user
        await stores.deviceTokens.unregister(token, req.user.userId);
        log.info('device token unregistered', { userId: req.user.userId, ip: getRequestIp(req) });
        return sendSuccess(res, { success: true });
      } catch (error: any) {
        log.error('unregister device token failed', { error: error.message });
        return sendError(res, 500, 'Failed to unregister device token', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /prefs — get notification preferences ───────────────────────
  router.get('/prefs', userAuth, rl(120, 'notif-prefs-get'), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const prefs = await stores.notificationPrefs.get(req.user.userId);
      return sendSuccess(res, prefs);
    } catch (error: any) {
      log.error('get notification prefs failed', { error: error.message });
      return sendError(res, 500, 'Failed to get preferences', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /read — mark notifications as read (reset badge count) ─
  router.post('/read', userAuth, rl(60, 'notif-read'), validate(schemas.markRead), async (req: any, res: any) => {
    try {
      const { festivalId } = req.validatedBody;
      if (festivalId) {
        // Reset counts for a specific festival
        const cleanId = sanitizeIdentifier(festivalId, 100);
        if (!cleanId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
        await stores.notificationCounts.reset(req.user.userId, cleanId);
      } else {
        // Reset all counts for this user
        await stores.notificationCounts.resetAll(req.user.userId);
      }
      return sendSuccess(res, { success: true, badgeCount: 0 });
    } catch (error: any) {
      log.error('mark notifications read failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to mark notifications as read', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /unread — get current unread counts ────────────────────────
  router.get('/unread', userAuth, rl(120, 'notif-unread'), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const counts = await stores.notificationCounts.getByUser(req.user.userId);
      const total = counts.reduce((sum: any, c: any) => sum + (c.unreadUpdates || 0), 0);
      return sendSuccess(res, {
        total,
        byFestival: counts.map((c: any) => ({
          festivalId: c.festivalId,
          updates: c.unreadUpdates || 0,
        })),
      });
    } catch (error: any) {
      log.error('get unread counts failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to get unread counts', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /history — notification delivery history ───────────────────
  router.get('/history', userAuth, rl(60, 'notif-history'), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const { limit } = parsePageParams(req.query, { defaultSize: 25, maxSize: 100 });
      const notifications = await stores.notificationLog.listByUser(req.user.userId, limit);
      return sendSuccess(res, notifications, { pagination: { pageSize: limit } });
    } catch (error: any) {
      log.error('get notification history failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to get notification history', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── PUT|PATCH /prefs — update notification preferences ──────────────
  async function updatePrefs(req: any, res: any) {
    try {
      const body = req.validatedBody;
      // Reject requests with unknown fields to prevent abuse
      const allowedKeys = new Set([
        'crewUpdates',
        'setReminders',
        'scheduleChanges',
        'lineupDrops',
        'crewReformed',
        'wrapReady',
        'dndStart',
        'dndEnd',
      ]);
      const bodyKeys = Object.keys(body);
      if (bodyKeys.some((key) => !allowedKeys.has(key))) {
        return sendError(res, 400, 'Invalid preference fields', ErrorCodes.INVALID_INPUT);
      }
      const update: any = {};

      // Boolean toggles. The 3 core categories (crew/reminders/schedule) plus the
      // M3 re-engagement opt-outs (lineup_drop / crew_reformed / wrap_ready).
      for (const key of [
        'crewUpdates',
        'setReminders',
        'scheduleChanges',
        'lineupDrops',
        'crewReformed',
        'wrapReady',
      ]) {
        if (body[key] !== undefined) {
          update[key] = body[key] ? 1 : 0;
        }
      }

      // DND window: Simple HH:MM format prevents notifications during sleep/quiet hours
      if (body.dndStart !== undefined) {
        if (body.dndStart === null || body.dndStart === '') {
          update.dndStart = null;
        } else if (DND_TIME_RE.test(body.dndStart)) {
          update.dndStart = body.dndStart;
        } else {
          return sendError(res, 400, 'dndStart must be HH:MM (24h)', ErrorCodes.INVALID_INPUT);
        }
      }
      if (body.dndEnd !== undefined) {
        if (body.dndEnd === null || body.dndEnd === '') {
          update.dndEnd = null;
        } else if (DND_TIME_RE.test(body.dndEnd)) {
          update.dndEnd = body.dndEnd;
        } else {
          return sendError(res, 400, 'dndEnd must be HH:MM (24h)', ErrorCodes.INVALID_INPUT);
        }
      }

      if (Object.keys(update).length === 0) {
        return sendError(res, 400, 'No valid preference fields provided', ErrorCodes.INVALID_INPUT);
      }

      // Merge with existing prefs since upsert does full INSERT OR REPLACE
      const current = (await stores.notificationPrefs.get(req.user.userId)) || {};
      await stores.notificationPrefs.upsert({
        userId: req.user.userId,
        crewUpdates: update.crewUpdates !== undefined ? update.crewUpdates : (current.crewUpdates ?? true),
        setReminders: update.setReminders !== undefined ? update.setReminders : (current.setReminders ?? true),
        scheduleChanges:
          update.scheduleChanges !== undefined ? update.scheduleChanges : (current.scheduleChanges ?? true),
        lineupDrops: update.lineupDrops !== undefined ? update.lineupDrops : (current.lineupDrops ?? true),
        crewReformed: update.crewReformed !== undefined ? update.crewReformed : (current.crewReformed ?? true),
        wrapReady: update.wrapReady !== undefined ? update.wrapReady : (current.wrapReady ?? true),
        dndStart: update.dndStart !== undefined ? update.dndStart : (current.dndStart ?? null),
        dndEnd: update.dndEnd !== undefined ? update.dndEnd : (current.dndEnd ?? null),
      });
      const prefs = await stores.notificationPrefs.get(req.user.userId);
      log.info('notification prefs updated', { userId: req.user.userId, ip: getRequestIp(req) });
      return sendSuccess(res, prefs);
    } catch (error: any) {
      log.error('update notification prefs failed', { error: error.message });
      return sendError(res, 500, 'Failed to update preferences', ErrorCodes.INTERNAL_ERROR);
    }
  }
  router.put('/prefs', userAuth, rl(20, 'notif-prefs'), validate(schemas.notificationPrefs), updatePrefs);
  router.patch('/prefs', userAuth, rl(20, 'notif-prefs'), validate(schemas.notificationPrefs), updatePrefs);

  // #29: Topic-based subscriptions per festival (reminders removed per Finding #36)
  const ALLOWED_TOPICS = new Set(['crew', 'schedule']);

  // GET /topics/:festivalId — get topic subscriptions for a festival
  router.get('/topics/:festivalId', userAuth, rl(120, 'notif-topics-get'), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = sanitizeIdentifier(req.params.festivalId, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      // Verify user is a member of this festival
      const profile = await stores.profiles.readByUserAndFestival?.(req.user.userId, festivalId);
      if (!profile) return sendError(res, 403, 'Not a member of this festival', ErrorCodes.FORBIDDEN);
      const subs = (await stores.topicSubscriptions?.getForUser(req.user.userId, festivalId)) || {};
      // Default all topics to true if no explicit preference
      const result: any = {};
      for (const topic of ALLOWED_TOPICS) {
        result[topic] = subs[topic] !== undefined ? subs[topic] : true;
      }
      return sendSuccess(res, result);
    } catch (error: any) {
      log.error('get topic subs failed', { error: error.message });
      return sendError(res, 500, 'Failed to get subscriptions', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // PUT /topics/:festivalId — update topic subscriptions
  router.put(
    '/topics/:festivalId',
    userAuth,
    rl(30, 'notif-topics'),
    validate(schemas.topicSubscription),
    async (req: any, res: any) => {
      try {
        const festivalId = sanitizeIdentifier(req.params.festivalId, 100);
        if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
        // Verify user is a member of this festival
        const profile = await stores.profiles.readByUserAndFestival?.(req.user.userId, festivalId);
        if (!profile) return sendError(res, 403, 'Not a member of this festival', ErrorCodes.FORBIDDEN);
        const body = req.validatedBody;
        const updated: any = {};
        for (const [topic, subscribed] of Object.entries(body)) {
          if (!ALLOWED_TOPICS.has(topic)) continue;
          await stores.topicSubscriptions?.setSubscription(req.user.userId, festivalId, topic, subscribed);
          updated[topic] = subscribed;
        }
        if (Object.keys(updated).length === 0) {
          return sendError(res, 400, 'No valid topics provided', ErrorCodes.INVALID_INPUT);
        }
        log.info('topic subscriptions updated', { userId: req.user.userId, festivalId, changes: Object.keys(updated) });
        return sendSuccess(res, updated);
      } catch (error: any) {
        log.error('update topic subs failed', { error: error.message });
        return sendError(res, 500, 'Failed to update subscriptions', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
