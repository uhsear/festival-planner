// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';
import https from 'https';
import { createRequire } from 'module';
import { isInDndWindow } from './dnd.js';
import {
  ALLOWED_NOTIFICATION_TYPES,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  enforcePayloadLimits,
  postToWebhookRetry,
} from './payload.js';
import { loadConfig as _loadSendConfig } from '../config.js';
import { withRetry } from '../helpers.js';
import { isApnsConfigured, getApnsProvider } from './apns.js';

const require = createRequire(import.meta.url);

// Reusable HTTPS agent for FCM — prevents TLS session corruption under load (from promptfoo pattern)
const _fcmAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  timeout: _loadSendConfig().FCM_REQUEST_TIMEOUT_MS,
});

// Firebase Admin SDK - loaded lazily only when credentials are configured
let firebaseAdmin: any = null;
let firebaseMessaging: any = null;

export function initFirebase(config: any, log: any) {
  if (firebaseMessaging) return firebaseMessaging;
  if (!config.FIREBASE_CREDENTIALS_PATH) {
    log.info('push notifications disabled — FIREBASE_CREDENTIALS_PATH not set');
    return null;
  }
  try {
    firebaseAdmin = require('firebase-admin');
    const serviceAccount = require(config.FIREBASE_CREDENTIALS_PATH);
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount),
    });
    firebaseMessaging = firebaseAdmin.messaging();
    log.info('Firebase Cloud Messaging initialized');
    return firebaseMessaging;
  } catch (error: any) {
    log.warn('Firebase init failed — push notifications disabled', { error: error.message });
    return null;
  }
}

/**
 * Validate that a device token is a non-empty string within acceptable length bounds.
 * Replaces three inline checks throughout the send pipeline.
 */
function isValidDeviceToken(device: any) {
  return device?.token && typeof device.token === 'string' && device.token.length >= 20 && device.token.length <= 4096;
}

/**
 * Truncate an FCM message body if the serialized payload exceeds 4KB.
 * Mutates msg.notification.body in place when needed.
 */
function enforcePayloadSize(msg: any, log: any, context = '') {
  const serialized = JSON.stringify(msg);
  if (serialized.length > 4096) {
    log.warn(`FCM payload exceeds 4KB${context ? ' in ' + context : ''}`, { size: serialized.length });
    if (msg.notification?.body) {
      msg.notification.body = msg.notification.body.slice(0, 200) + '...';
    }
  }
}

/** Map notification type -> user pref key */
const PREF_MAP: Record<string, string> = {
  crew_update: 'crewUpdates',
  schedule_change: 'scheduleChanges',
  set_reminder: 'setReminders',
  // M3 re-engagement triggers — each has its own per-type opt-out column.
  lineup_drop: 'lineupDrops',
  crew_reformed: 'crewReformed',
  wrap_ready: 'wrapReady',
};

/**
 * Safety-critical notification types. These BYPASS the DND window and have NO
 * per-type opt-out (they are intentionally absent from PREF_MAP) — an emergency
 * must reach people. They also route to a dedicated high-priority push channel.
 */
const CRITICAL_TYPES = new Set(['crew_sos']);

/** Per-type push channel/category overrides for critical alerts. */
const CRITICAL_CHANNEL: Record<string, { channelId: string; category: string }> = {
  crew_sos: { channelId: 'sos', category: 'CREW_SOS' },
};

/**
 * DC7: Non-critical type → Android channel mapping.
 * crew_* types route to the 'crew' channel (DEFAULT importance) so users can
 * silence crew pings without losing their 'set-reminders' (HIGH) channel.
 * Types not listed here fall back to 'updates' (the default in buildFcmMessage).
 */
const TYPE_CHANNEL_MAP: Record<string, string> = {
  crew_update: 'crew',
  crew_reformed: 'crew',
};

/** Check if a stale token error code signals the device is no longer registered */
function isStaleTokenError(code: any) {
  return code.includes('not-registered') || code.includes('invalid-registration') || code.includes('invalid-argument');
}

/**
 * Resolve target user IDs for a festival, excluding specified IDs.
 * Shared by sendToOfflineUsers and sendSilentSync.
 */
async function resolveFestivalTargets(stores: any, festivalId: any, excludeUserIds: any) {
  const festivalUserIds = stores.profiles.userIdsByFestival
    ? await stores.profiles.userIdsByFestival(festivalId)
    : (await stores.profiles.readAll())
        .filter((p: any) => p.festivalId === festivalId && p.userId)
        .map((p: any) => p.userId);
  const excludeSet = new Set(excludeUserIds);
  return festivalUserIds.filter((uid: any) => !excludeSet.has(uid));
}

/**
 * Build the send-path surface: { send, sendToOfflineUsers, sendSilentSync, markRead }.
 * Takes a resolved `messaging` client (may be null when FCM is not configured) plus
 * the shared deps from the composer.
 */
// Threshold for declaring a provider outage: if more than this fraction of
// sends in a batch fail (and at least one send was attempted), we emit a WARN
// and increment the outage counter. Benign zero-recipient / all-opt-out batches
// are never passed to sendBatch, so they never trigger this check.
const OUTAGE_ERROR_RATIO = 0.5;

export function createSendService({ stores, config, log, messaging, retryQueue, apnsProvider, promMetrics }: any) {
  // Direct APNs provider for iOS device tokens (raw APNs tokens that firebase-admin
  // cannot send). Guarded entirely by isApnsConfigured: when APNs is NOT configured
  // this stays null and iOS tokens are skipped (NOT deleted as stale).
  // `apnsProvider` may be injected for tests; otherwise resolved lazily from config.
  const apnsConfigured = isApnsConfigured(config);
  function getApns() {
    if (!apnsConfigured) return null;
    if (apnsProvider !== undefined) return apnsProvider; // DI (tests); null disables
    return getApnsProvider(config, log);
  }

  // Badge count management for iOS
  async function getUnreadCount(userId: any) {
    if (!stores.notificationCounts) return 1;
    try {
      const counts = await stores.notificationCounts.getByUser(userId);
      return counts.reduce((sum: any, c: any) => sum + (c.unreadUpdates || 0), 0) || 1;
    } catch {
      return 1;
    }
  }

  async function incrementUnread(userId: any, festivalId: any, _type: any) {
    if (!stores.notificationCounts) return;
    try {
      await stores.notificationCounts.increment(userId, festivalId, 'updates');
    } catch (err: any) {
      log.debug('incrementUnread failed', { userId, error: err.message });
    }
  }

  // Delivery tracking
  async function logNotification({ userId, type, title, body, data, status, platform, errorMessage }: any) {
    if (!stores.notificationLog) return null;
    try {
      const id = crypto.randomUUID();
      await stores.notificationLog.insert({
        id,
        userId,
        type,
        title: String(title || '').slice(0, MAX_TITLE_LENGTH),
        body: String(body || '').slice(0, MAX_BODY_LENGTH),
        dataJson: data ? JSON.stringify(data) : null,
        status: status || 'sent',
        platform: platform || null,
        errorMessage: errorMessage || null,
      });
      return id;
    } catch (err: any) {
      log.debug('notification log failed', { error: err.message });
      return null;
    }
  }

  /**
   * Build a complete FCM message object for a single device.
   * Shared by send() and sendToOfflineUsers() to avoid duplication.
   */
  function buildFcmMessage({
    token,
    title,
    body,
    data,
    type,
    badgeCount,
    threadId,
    channelId = 'updates',
    category = 'CREW_UPDATE',
  }: any) {
    return {
      token,
      notification: { title, body },
      data: { type, ...data },
      android: {
        priority: 'high',
        notification: {
          channelId,
          tag: threadId || `update-${data.festivalId || ''}`,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: badgeCount,
            'mutable-content': 1,
            'thread-id': threadId || 'updates',
            category,
          },
        },
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      },
      webpush: {
        headers: { Urgency: 'normal' },
        fcmOptions: {
          link: data.deepLink || `${config.PUBLIC_ORIGIN}/festival/${data.festivalId || ''}`,
        },
      },
    };
  }

  /**
   * Build the APNs `aps` payload for an alert. Mirrors buildFcmMessage's
   * apns.payload.aps EXACTLY (sound/badge/mutable-content/thread-id/category),
   * plus the visible `alert` block — FCM injects title/body from `notification`,
   * but direct APNs requires them in the aps body. Custom data is sent as
   * sibling keys alongside `aps` (the standard APNs convention).
   */
  function buildApnsAlertPayload({ title, body, data, type, badgeCount, threadId, category = 'CREW_UPDATE' }: any) {
    return {
      aps: {
        alert: { title, body },
        sound: 'default',
        badge: badgeCount,
        'mutable-content': 1,
        'thread-id': threadId || 'updates',
        category,
      },
      type,
      ...data,
    };
  }

  /**
   * Send an alert to a single iOS device via direct APNs. Returns the same
   * { sent, stale } shape as sendToDevice so callers stay symmetric. Logs the
   * notification and never throws.
   */
  async function sendToIosDevice({ apns, device, payload, opts, userId, type, safeTitle, safeBody, safeData }: any) {
    try {
      const result = await apns.send(device.token, payload, opts);
      await logNotification({
        userId,
        type,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        status: result.sent ? 'sent' : 'failed',
        platform: device.platform,
        errorMessage: result.sent ? null : result.error,
      });
      if (!result.sent) log.debug('apns send failed', { userId, error: result.error });
      return { sent: result.sent, stale: result.stale };
    } catch (error: any) {
      log.debug('apns send threw', { userId, error: error.message });
      await logNotification({
        userId,
        type,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        status: 'failed',
        platform: device.platform,
        errorMessage: error.message,
      });
      return { sent: false, stale: false };
    }
  }

  /**
   * Handle sending to a single device — retry logic, stale token detection, logging.
   * Returns { sent: boolean, stale: boolean }.
   */
  async function sendToDevice({
    device,
    fcmMessage,
    userId,
    type,
    safeTitle,
    safeBody,
    safeData,
    retryQueue: deviceRetryQueue,
  }: any) {
    const sendStartTime = Date.now();
    try {
      await Promise.race([
        withRetry(() => messaging.send(fcmMessage), {
          maxAttempts: 2,
          baseDelay: 300,
          maxDelay: 2000,
          isRetryable: (err: any) => {
            const code = err.code || '';
            return err.message === 'FCM_TIMEOUT' || code.includes('unavailable') || code.includes('internal');
          },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('FCM_TIMEOUT')), 8000)),
      ]);
      await logNotification({
        userId,
        type,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        status: 'sent',
        platform: device.platform,
      });
      return { sent: true, stale: false };
    } catch (error: any) {
      const code = error.code || '';
      const isTimeout = error.message === 'FCM_TIMEOUT' || Date.now() - sendStartTime > 5000;
      const stale = isStaleTokenError(code);

      // Enqueue transient failures for retry (timeouts, 5xx, unavailable)
      const isTransient = isTimeout || code.includes('unavailable') || code.includes('internal');
      if (isTransient && !code.includes('not-registered') && !code.includes('invalid-registration')) {
        const fcmMsg = {
          token: device.token,
          notification: { title: safeTitle, body: safeBody },
          data: { type, ...safeData },
        };
        deviceRetryQueue.enqueue({ userId, sendFn: () => messaging.send(fcmMsg) });
        // Never forward notification content to this external, operator-configured
        // webhook — title/body/data may carry GPS coords or a username (e.g.
        // crew_sos embeds the raiser's name in the title and lat/lng in data).
        // The in-process deviceRetryQueue above already re-sends the real payload;
        // this call only needs to tell the external system WHICH notification
        // type needs attention.
        postToWebhookRetry(device.token, { type }, 0);
      }

      log.debug('push send failed', { userId, platform: device.platform, error: error.message });
      await logNotification({
        userId,
        type,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        status: 'failed',
        platform: device.platform,
        errorMessage: error.message,
      });
      return { sent: false, stale };
    }
  }

  async function send({ userId, type, title, body, data = {}, threadId = null }: any) {
    if (!messaging) return { sent: 0, reason: 'firebase_not_configured' };
    if (!ALLOWED_NOTIFICATION_TYPES.has(type)) {
      log.warn('invalid notification type rejected', { type, userId });
      return { sent: 0, reason: 'invalid_type' };
    }

    const { safeTitle, safeBody, safeData } = enforcePayloadLimits(title, body, data);
    const isCritical = CRITICAL_TYPES.has(type);
    // DC7: critical types override channel; non-critical types may have a per-type
    // channel (e.g. crew_* → 'crew'); everything else falls back to 'updates'.
    const { channelId: criticalChannelId, category = 'CREW_UPDATE' } = CRITICAL_CHANNEL[type] || {};
    const channelId = criticalChannelId ?? TYPE_CHANNEL_MAP[type] ?? 'updates';
    const prefs = await stores.notificationPrefs.get(userId);
    const prefKey = PREF_MAP[type];
    // Safety-critical types (crew_sos) bypass the per-type opt-out and the DND
    // window — an emergency must reach people. prefKey is undefined for these
    // (omitted from PREF_MAP), but guard explicitly so intent is unmistakable.
    if (!isCritical) {
      if (prefs && prefKey && !prefs[prefKey]) return { sent: 0, reason: 'user_disabled' };
      if (isInDndWindow(prefs)) return { sent: 0, reason: 'dnd_active' };
    }

    const tokens = await stores.deviceTokens.listByUser(userId);
    if (tokens.length === 0) return { sent: 0, reason: 'no_tokens' };

    const badgeCount = await getUnreadCount(userId);
    const apns = getApns();
    let sent = 0;
    const staleTokens: any[] = [];

    for (const device of tokens) {
      if (!isValidDeviceToken(device)) {
        staleTokens.push(device.token);
        continue;
      }

      // iOS device tokens are RAW APNs tokens that firebase-admin cannot send.
      if (device.platform === 'ios') {
        if (!apns) {
          // APNs not configured: skip (counted as not-sent), do NOT unregister.
          log.debug('apns not configured — skipping ios token', { userId });
          continue;
        }
        const payload = buildApnsAlertPayload({
          title: safeTitle,
          body: safeBody,
          data: safeData,
          type,
          badgeCount,
          threadId,
          category,
        });
        const result = await sendToIosDevice({
          apns,
          device,
          payload,
          opts: { pushType: 'alert', priority: '10', collapseId: threadId },
          userId,
          type,
          safeTitle,
          safeBody,
          safeData,
        });
        if (result.sent) sent += 1;
        if (result.stale) staleTokens.push(device.token);
        continue;
      }

      // Android / web (or unknown) → unchanged FCM path.
      const fcmMessage = buildFcmMessage({
        token: device.token,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        type,
        badgeCount,
        threadId,
        channelId,
        category,
      });
      enforcePayloadSize(fcmMessage, log);

      const result = await sendToDevice({
        device,
        fcmMessage,
        userId,
        type,
        safeTitle,
        safeBody,
        safeData,
        retryQueue,
      });
      if (result.sent) sent += 1;
      if (result.stale) staleTokens.push(device.token);
    }

    if (sent > 0 && safeData.festivalId) {
      await incrementUnread(userId, safeData.festivalId, type);
    }

    // Clean up stale tokens (filter out null/undefined tokens that can't match DB rows)
    for (const staleToken of staleTokens) {
      if (staleToken) await stores.deviceTokens.unregister(staleToken, userId);
    }

    return { sent, staleRemoved: staleTokens.length };
  }

  const MAX_PUSH_BATCH = 200;
  const FCM_BATCH_SIZE = 500;

  async function sendBatch(messages: any) {
    if (!messaging || messages.length === 0) return { successCount: 0, failureCount: 0, staleTokens: [] };
    const staleTokens: any[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < messages.length; i += FCM_BATCH_SIZE) {
      const batch = messages.slice(i, i + FCM_BATCH_SIZE);

      for (const msg of batch) {
        enforcePayloadSize(msg, log, 'batch');
      }

      try {
        const response = await messaging.sendEach(batch);
        response.responses.forEach((resp: any, idx: any) => {
          if (resp.success) {
            successCount++;
          } else {
            failureCount++;
            if (isStaleTokenError(resp.error?.code || '')) {
              staleTokens.push(batch[idx].token);
            }
          }
        });
      } catch (err: any) {
        log.warn('sendBatch: batch send failed', { batchSize: batch.length, error: err.message });
        failureCount += batch.length;
      }
    }
    // Provider-outage signal: if errors dominate the batch (high failure ratio,
    // at least one send attempted) this is likely a FCM-side outage, not benign
    // per-user opt-outs (those are filtered before buildFcmMessage ever runs).
    const totalAttempted = successCount + failureCount;
    if (totalAttempted > 0 && failureCount / totalAttempted > OUTAGE_ERROR_RATIO) {
      log.warn('push-provider outage suspected: high FCM error ratio', {
        successCount,
        failureCount,
        total: totalAttempted,
        ratio: (failureCount / totalAttempted).toFixed(2),
      });
      try {
        promMetrics?.pushProviderOutageCounter?.inc({ provider: 'fcm' });
      } catch { /* ignore metric errors */ }
    }

    return { successCount, failureCount, staleTokens };
  }

  async function sendToOfflineUsers({
    festivalId,
    type,
    title,
    body,
    data = {},
    excludeUserIds = [],
    topic = null,
    threadId = null,
  }: any) {
    if (!messaging) return { sent: 0 };
    if (!ALLOWED_NOTIFICATION_TYPES.has(type)) return { sent: 0, reason: 'invalid_type' };

    const targetUserIds = await resolveFestivalTargets(stores, festivalId, excludeUserIds);

    // Filter out topic-unsubscribed users
    const VALID_TOPICS = new Set(['crew', 'schedule']);
    let topicUnsubscribed: any = new Set();
    if (topic && VALID_TOPICS.has(topic) && stores.topicSubscriptions?.getUnsubscribedUsers) {
      topicUnsubscribed = await stores.topicSubscriptions.getUnsubscribedUsers(festivalId, topic);
    }
    const filteredIds = targetUserIds.filter((uid: any) => !topicUnsubscribed.has(uid));
    if (filteredIds.length === 0) return { sent: 0 };

    const batch = filteredIds.slice(0, MAX_PUSH_BATCH);
    if (filteredIds.length > MAX_PUSH_BATCH) {
      log.warn('sendToOfflineUsers: batch capped', { festivalId, total: filteredIds.length, capped: MAX_PUSH_BATCH });
    }

    const { safeTitle, safeBody, safeData } = enforcePayloadLimits(title, body, data);
    const prefKey = PREF_MAP[type];
    const apns = getApns();
    const fcmMessages: any[] = [];
    const tokenUserMap = new Map();
    // iOS device tokens routed to per-device APNs (APNs has no multicast).
    const iosSends: any[] = [];

    for (const userId of batch) {
      const prefs = await stores.notificationPrefs.get(userId);
      if (prefs && prefKey && !prefs[prefKey]) continue;
      if (isInDndWindow(prefs)) continue;

      const tokens = await stores.deviceTokens.listByUser(userId);
      const badgeCount = await getUnreadCount(userId);

      for (const device of tokens) {
        if (!isValidDeviceToken(device)) continue;

        if (device.platform === 'ios') {
          // APNs not configured → skip iOS token (do NOT unregister).
          if (!apns) continue;
          tokenUserMap.set(device.token, userId);
          iosSends.push({
            userId,
            device,
            payload: buildApnsAlertPayload({
              title: safeTitle,
              body: safeBody,
              data: safeData,
              type,
              badgeCount,
              threadId,
            }),
          });
          continue;
        }

        // Android / web → FCM batch (unchanged).
        tokenUserMap.set(device.token, userId);
        const msg = buildFcmMessage({
          token: device.token,
          title: safeTitle,
          body: safeBody,
          data: safeData,
          type,
          badgeCount,
          threadId,
        });
        enforcePayloadSize(msg, log, 'sendToOfflineUsers');
        fcmMessages.push(msg);
      }
    }

    if (fcmMessages.length === 0 && iosSends.length === 0) return { sent: 0 };

    const result =
      fcmMessages.length > 0
        ? await sendBatch(fcmMessages)
        : { successCount: 0, failureCount: 0, staleTokens: [] as any[] };

    // Per-device APNs sends for iOS (no multicast).
    const apnsStaleTokens: any[] = [];
    let apnsSent = 0;
    for (const { userId, device, payload } of iosSends) {
      const r = await sendToIosDevice({
        apns,
        device,
        payload,
        opts: { pushType: 'alert', priority: '10', collapseId: threadId },
        userId,
        type,
        safeTitle,
        safeBody,
        safeData,
      });
      if (r.sent) apnsSent += 1;
      if (r.stale) apnsStaleTokens.push(device.token);
    }

    // APNs provider-outage signal: same ratio check as FCM sendBatch.
    const apnsAttempted = iosSends.length;
    const apnsFailed = apnsAttempted - apnsSent;
    if (apnsAttempted > 0 && apnsFailed / apnsAttempted > OUTAGE_ERROR_RATIO) {
      log.warn('push-provider outage suspected: high APNs error ratio', {
        sent: apnsSent,
        failed: apnsFailed,
        total: apnsAttempted,
        ratio: (apnsFailed / apnsAttempted).toFixed(2),
      });
      try {
        promMetrics?.pushProviderOutageCounter?.inc({ provider: 'apns' });
      } catch { /* ignore metric errors */ }
    }

    // Track unread counts for users who received notifications
    const notifiedUsers = new Set();
    for (const msg of fcmMessages) {
      const uid = tokenUserMap.get(msg.token);
      if (uid) notifiedUsers.add(uid);
    }
    for (const { userId } of iosSends) {
      notifiedUsers.add(userId);
    }
    for (const uid of notifiedUsers) {
      if (safeData.festivalId) await incrementUnread(uid, safeData.festivalId, type);
    }

    // Clean up stale tokens (deferred to avoid blocking the request path)
    const allStaleTokens = [...result.staleTokens, ...apnsStaleTokens];
    if (allStaleTokens.length > 0) {
      const staleTokensCopy = [...allStaleTokens];
      const tokenUserMapCopy = new Map(tokenUserMap);
      setImmediate(async () => {
        for (const t of staleTokensCopy) {
          try {
            const uid = tokenUserMapCopy.get(t);
            if (uid && t) await stores.deviceTokens.unregister(t, uid);
          } catch (err: any) {
            log.warn('stale token cleanup failed', { error: err.message });
          }
        }
      });
    }

    log.info('sendToOfflineUsers: batch complete', {
      festivalId,
      type,
      messages: fcmMessages.length + iosSends.length,
      sent: result.successCount + apnsSent,
      failed: result.failureCount + (iosSends.length - apnsSent),
      stale: allStaleTokens.length,
    });

    return { sent: result.successCount + apnsSent };
  }

  // #30: Silent push for background data sync — data-only, no visible notification
  async function sendSilentSync({ festivalId, syncType, excludeUserIds = [] }: any) {
    if (!messaging) return { sent: 0 };

    const allTargetIds = await resolveFestivalTargets(stores, festivalId, excludeUserIds);
    const targetUserIds = allTargetIds.slice(0, MAX_PUSH_BATCH);
    if (targetUserIds.length === 0) return { sent: 0 };
    if (allTargetIds.length > MAX_PUSH_BATCH) {
      log.warn('sendSilentSync: batch capped', {
        festivalId,
        syncType,
        total: allTargetIds.length,
        capped: MAX_PUSH_BATCH,
      });
    }

    const apns = getApns();
    let totalSent = 0;
    for (const userId of targetUserIds) {
      const tokens = await stores.deviceTokens.listByUser(userId);
      for (const device of tokens) {
        if (!isValidDeviceToken(device)) continue;

        // iOS device tokens → direct APNs background push (content-available:1).
        if (device.platform === 'ios') {
          if (!apns) continue; // not configured → skip, do NOT unregister
          try {
            const result = await apns.send(
              device.token,
              {
                aps: { 'content-available': 1 },
                type: 'silent_sync',
                syncType,
                festivalId,
                timestamp: new Date().toISOString(),
              },
              { pushType: 'background', priority: '5' },
            );
            if (result.sent) totalSent += 1;
            if (result.stale) await stores.deviceTokens.unregister(device.token, userId);
          } catch (error: any) {
            log.debug('sendSilentSync: apns error', { userId, error: error.message });
          }
          continue;
        }

        // Android / web → unchanged FCM path.
        try {
          await messaging.send({
            token: device.token,
            data: { type: 'silent_sync', syncType, festivalId, timestamp: new Date().toISOString() },
            android: { priority: 'high' },
            apns: {
              payload: { aps: { 'content-available': 1 } },
              headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
            },
            webpush: { headers: { Urgency: 'low' } },
          });
          totalSent += 1;
        } catch (error: any) {
          const code = error.code || '';
          if (code.includes('not-registered') || code.includes('invalid-registration')) {
            await stores.deviceTokens.unregister(device.token, userId);
          }
          log.debug('sendSilentSync: device error', { userId, platform: device.platform, error: error.message });
        }
      }
    }
    return { sent: totalSent };
  }

  // Mark notifications as read (badge reset)
  async function markRead(userId: any, festivalId: any) {
    if (!stores.notificationCounts) return;
    try {
      await stores.notificationCounts.reset(userId, festivalId);
    } catch (err: any) {
      log.debug('markRead failed', { userId, error: err.message });
    }
  }

  return { send, sendToOfflineUsers, sendSilentSync, markRead };
}

export { _fcmAgent };
