// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const https = require('https');
const { isInDndWindow } = require('./dnd');
const {
  ALLOWED_NOTIFICATION_TYPES,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  enforcePayloadLimits,
  postToWebhookRetry,
} = require('./payload');

// Reusable HTTPS agent for FCM — prevents TLS session corruption under load (from promptfoo pattern)
const _fcmAgent = new https.Agent({ keepAlive: true, maxSockets: 10, timeout: 10000 });

// Firebase Admin SDK - loaded lazily only when credentials are configured
let firebaseAdmin = null;
let firebaseMessaging = null;

function initFirebase(config, log) {
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
  } catch (error) {
    log.warn('Firebase init failed — push notifications disabled', { error: error.message });
    return null;
  }
}

/**
 * Build the send-path surface: { send, sendToOfflineUsers, sendSilentSync, markRead }.
 * Takes a resolved `messaging` client (may be null when FCM is not configured) plus
 * the shared deps from the composer.
 */
function createSendService({ stores, config, log, messaging, retryQueue }) {
  // Badge count management for iOS
  async function getUnreadCount(userId) {
    if (!stores.notificationCounts) return 1;
    try {
      const counts = await stores.notificationCounts.getByUser(userId);
      return counts.reduce((sum, c) => sum + (c.unreadUpdates || 0), 0) || 1;
    } catch {
      return 1;
    }
  }

  async function incrementUnread(userId, festivalId, _type) {
    if (!stores.notificationCounts) return;
    try {
      const field = 'updates';
      await stores.notificationCounts.increment(userId, festivalId, field);
    } catch (err) {
      log.debug('incrementUnread failed', { userId, error: err.message });
    }
  }

  // Delivery tracking
  async function logNotification({ userId, type, title, body, data, status, platform, errorMessage }) {
    if (!stores.notificationLog) return null;
    try {
      const id = require('crypto').randomUUID();
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
    } catch (err) {
      log.debug('notification log failed', { error: err.message });
      return null;
    }
  }

  /**
   * Build a complete FCM message object for a single device.
   * Shared by send() and sendToOfflineUsers() to avoid duplication.
   */
  function buildFcmMessage({ token, title, body, data, type, badgeCount, threadId }) {
    return {
      token,
      notification: { title, body },
      data: { type, ...data },
      android: {
        priority: 'high',
        notification: {
          channelId: 'updates',
          clickAction: 'OPEN_DEEP_LINK',
          // #32: Fine-grained tags per festival per type
          tag: threadId || `update-${data.festivalId || ''}`,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: badgeCount,
            'mutable-content': 1,
            // #32: Fine-grained thread IDs: crew-{festId}, schedule-{festId}
            'thread-id': threadId || 'updates',
            'category': 'CREW_UPDATE',
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

  async function send({ userId, type, title, body, data = {}, threadId = null }) {
    if (!messaging) return { sent: 0, reason: 'firebase_not_configured' };

    // Validate notification type
    if (!ALLOWED_NOTIFICATION_TYPES.has(type)) {
      log.warn('invalid notification type rejected', { type, userId });
      return { sent: 0, reason: 'invalid_type' };
    }

    const { safeTitle, safeBody, safeData } = enforcePayloadLimits(title, body, data);

    const prefs = await stores.notificationPrefs.get(userId);
    // Check notification type preference (prefs may be null for users who never set preferences)
    const prefMap = {
      crew_update: 'crewUpdates',
      schedule_change: 'scheduleChanges',
      set_reminder: 'setReminders',
    };
    const prefKey = prefMap[type];
    if (prefs && prefKey && !prefs[prefKey]) return { sent: 0, reason: 'user_disabled' };
    if (isInDndWindow(prefs)) return { sent: 0, reason: 'dnd_active' };

    const tokens = await stores.deviceTokens.listByUser(userId);
    if (tokens.length === 0) return { sent: 0, reason: 'no_tokens' };

    // Get badge count for iOS
    const badgeCount = await getUnreadCount(userId);

    let sent = 0;
    const staleTokens = [];

    for (const device of tokens) {
      if (!device.token || typeof device.token !== 'string' || device.token.length < 20 || device.token.length > 4096) {
        staleTokens.push(device.token);
        continue;
      }

      const sendStartTime = Date.now();
      let _fcmSent = false;

      try {
        const fcmMessage = buildFcmMessage({
          token: device.token,
          title: safeTitle,
          body: safeBody,
          data: safeData,
          type,
          badgeCount,
          threadId,
        });

        // Validate FCM payload size (4KB limit)
        const serialized = JSON.stringify(fcmMessage);
        if (serialized.length > 4096) {
          log.warn('FCM payload exceeds 4KB', { size: serialized.length, userId });
          // Truncate notification body to fit
          if (fcmMessage.notification?.body) {
            fcmMessage.notification.body = fcmMessage.notification.body.slice(0, 200) + '...';
          }
        }

        await Promise.race([
          (async () => {
            // Retry transient FCM failures (timeouts, 5xx) up to 2 times
            const { withRetry } = require('../helpers');
            return withRetry(
              () => messaging.send(fcmMessage),
              {
                maxAttempts: 2,
                baseDelay: 300,
                maxDelay: 2000,
                isRetryable: (err) => {
                  const code = err.code || '';
                  return err.message === 'FCM_TIMEOUT' || code.includes('unavailable') || code.includes('internal');
                },
              }
            );
          })(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('FCM_TIMEOUT')), 8000)),
        ]);
        sent += 1;
        _fcmSent = true;
        await logNotification({ userId, type, title: safeTitle, body: safeBody, data: safeData, status: 'sent', platform: device.platform });
      } catch (error) {
        const code = error.code || '';
        const isTimeout = error.message === 'FCM_TIMEOUT' || (Date.now() - sendStartTime) > 5000;

        if (code.includes('not-registered') || code.includes('invalid-registration') || code.includes('invalid-argument')) {
          staleTokens.push(device.token);
        }

        // Enqueue transient failures for retry (timeouts, 5xx, unavailable)
        const isTransient = isTimeout || code.includes('unavailable') || code.includes('internal');
        if (isTransient && !code.includes('not-registered') && !code.includes('invalid-registration')) {
          const deviceToken = device.token;
          const fcmMsg = { token: deviceToken, notification: { title: safeTitle, body: safeBody }, data: { type, ...safeData } };
          retryQueue.enqueue({ userId, sendFn: () => messaging.send(fcmMsg) });
          postToWebhookRetry(deviceToken, { title: safeTitle, body: safeBody, type, ...safeData }, 0);
        }

        log.debug('push send failed', { userId, platform: device.platform, error: error.message });
        await logNotification({ userId, type, title: safeTitle, body: safeBody, data: safeData, status: 'failed', platform: device.platform, errorMessage: error.message });
      }
    }

    // Track unread count
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

  // Best-fit packing: collect FCM messages and send in batches of up to 500 (FCM limit)
  const FCM_BATCH_SIZE = 500;

  async function sendBatch(messages) {
    if (!messaging || messages.length === 0) return { successCount: 0, failureCount: 0, staleTokens: [] };
    const staleTokens = [];
    let successCount = 0;
    let failureCount = 0;

    // Pack messages into FCM-sized batches
    for (let i = 0; i < messages.length; i += FCM_BATCH_SIZE) {
      const batch = messages.slice(i, i + FCM_BATCH_SIZE);

      // Validate FCM payload sizes
      for (const msg of batch) {
        const serialized = JSON.stringify(msg);
        if (serialized.length > 4096) {
          log.warn('FCM payload exceeds 4KB in batch', { size: serialized.length });
          // Truncate notification body to fit
          if (msg.notification?.body) {
            msg.notification.body = msg.notification.body.slice(0, 200) + '...';
          }
        }
      }

      try {
        const response = await messaging.sendEach(batch);
        response.responses.forEach((resp, idx) => {
          if (resp.success) {
            successCount++;
          } else {
            failureCount++;
            const code = resp.error?.code || '';
            if (code.includes('not-registered') || code.includes('invalid-registration') || code.includes('invalid-argument')) {
              staleTokens.push(batch[idx].token);
            }
          }
        });
      } catch (err) {
        log.warn('sendBatch: batch send failed', { batchSize: batch.length, error: err.message });
        failureCount += batch.length;
      }
    }
    return { successCount, failureCount, staleTokens };
  }

  async function sendToOfflineUsers({ festivalId, type, title, body, data = {}, excludeUserIds = [], topic = null, threadId = null }) {
    if (!messaging) return { sent: 0 };

    // Validate notification type
    if (!ALLOWED_NOTIFICATION_TYPES.has(type)) return { sent: 0, reason: 'invalid_type' };

    // Get user IDs in this festival
    const festivalUserIds = stores.profiles.userIdsByFestival
      ? await stores.profiles.userIdsByFestival(festivalId)
      : (await stores.profiles.readAll()).filter((p) => p.festivalId === festivalId && p.userId).map((p) => p.userId);
    const excludeSet = new Set(excludeUserIds);

    // Filter out topic-unsubscribed users
    const VALID_TOPICS = new Set(['crew', 'schedule']);
    let topicUnsubscribed = new Set();
    if (topic && VALID_TOPICS.has(topic) && stores.topicSubscriptions?.getUnsubscribedUsers) {
      topicUnsubscribed = await stores.topicSubscriptions.getUnsubscribedUsers(festivalId, topic);
    }

    const targetUserIds = festivalUserIds.filter((uid) => !excludeSet.has(uid) && !topicUnsubscribed.has(uid));
    if (targetUserIds.length === 0) return { sent: 0 };

    // Cap to prevent stalling
    const batch = targetUserIds.slice(0, MAX_PUSH_BATCH);
    if (targetUserIds.length > MAX_PUSH_BATCH) {
      log.warn('sendToOfflineUsers: batch capped', { festivalId, total: targetUserIds.length, capped: MAX_PUSH_BATCH });
    }

    const { safeTitle, safeBody, safeData } = enforcePayloadLimits(title, body, data);

    // Build FCM messages for all eligible users, filtering by prefs/DND per user
    const prefMap = { crew_update: 'crewUpdates', schedule_change: 'scheduleChanges', set_reminder: 'setReminders' };
    const prefKey = prefMap[type];
    const fcmMessages = [];
    const tokenUserMap = new Map(); // token -> userId for tracking

    for (const userId of batch) {
      const prefs = await stores.notificationPrefs.get(userId);
      if (prefs && prefKey && !prefs[prefKey]) continue;
      if (isInDndWindow(prefs)) continue;

      const tokens = await stores.deviceTokens.listByUser(userId);
      const badgeCount = await getUnreadCount(userId);

      for (const device of tokens) {
        if (!device.token || typeof device.token !== 'string' || device.token.length < 20 || device.token.length > 4096) continue;

        tokenUserMap.set(device.token, userId);
        fcmMessages.push(buildFcmMessage({
          token: device.token,
          title: safeTitle,
          body: safeBody,
          data: safeData,
          type,
          badgeCount,
          threadId,
        }));
      }
    }

    if (fcmMessages.length === 0) return { sent: 0 };

    // Validate FCM payload sizes before sending
    for (const msg of fcmMessages) {
      const serialized = JSON.stringify(msg);
      if (serialized.length > 4096) {
        log.warn('FCM payload exceeds 4KB in sendToOfflineUsers', { size: serialized.length });
        // Truncate notification body to fit
        if (msg.notification?.body) {
          msg.notification.body = msg.notification.body.slice(0, 200) + '...';
        }
      }
    }

    // Send in packed batches
    const result = await sendBatch(fcmMessages);

    // Track unread counts for users who received notifications
    const notifiedUsers = new Set();
    for (const msg of fcmMessages) {
      const uid = tokenUserMap.get(msg.token);
      if (uid) notifiedUsers.add(uid);
    }
    for (const uid of notifiedUsers) {
      if (safeData.festivalId) await incrementUnread(uid, safeData.festivalId, type);
    }

    // Clean up stale tokens (deferred to avoid blocking the request path)
    if (result.staleTokens.length > 0) {
      const staleTokensCopy = [...result.staleTokens];
      const tokenUserMapCopy = new Map(tokenUserMap);
      setImmediate(async () => {
        for (const t of staleTokensCopy) {
          try {
            const uid = tokenUserMapCopy.get(t);
            if (uid && t) await stores.deviceTokens.unregister(t, uid);
          } catch (err) {
            log.warn('stale token cleanup failed', { error: err.message });
          }
        }
      });
    }

    log.info('sendToOfflineUsers: batch complete', {
      festivalId, type, messages: fcmMessages.length,
      sent: result.successCount, failed: result.failureCount, stale: result.staleTokens.length,
    });

    return { sent: result.successCount };
  }

  // #30: Silent push for background data sync — data-only, no visible notification
  async function sendSilentSync({ festivalId, syncType, excludeUserIds = [] }) {
    if (!messaging) return { sent: 0 };

    const festivalUserIds = stores.profiles.userIdsByFestival
      ? await stores.profiles.userIdsByFestival(festivalId)
      : (await stores.profiles.readAll()).filter((p) => p.festivalId === festivalId && p.userId).map((p) => p.userId);
    const excludeSet = new Set(excludeUserIds);
    const allTargetIds = festivalUserIds.filter((uid) => !excludeSet.has(uid));
    const targetUserIds = allTargetIds.slice(0, MAX_PUSH_BATCH);
    if (targetUserIds.length === 0) return { sent: 0 };
    if (allTargetIds.length > MAX_PUSH_BATCH) {
      log.warn('sendSilentSync: batch capped', { festivalId, syncType, total: allTargetIds.length, capped: MAX_PUSH_BATCH });
    }

    let totalSent = 0;
    for (const userId of targetUserIds) {
      const tokens = await stores.deviceTokens.listByUser(userId);
      for (const device of tokens) {
        if (!device.token || device.token.length < 20 || device.token.length > 4096) continue;
        try {
          await messaging.send({
            token: device.token,
            // Data-only message — no notification field
            data: {
              type: 'silent_sync',
              syncType,
              festivalId,
              timestamp: new Date().toISOString(),
            },
            android: {
              priority: 'high',
            },
            apns: {
              payload: {
                aps: {
                  // content-available triggers background processing on iOS
                  'content-available': 1,
                },
              },
              headers: {
                'apns-priority': '5',
                'apns-push-type': 'background',
              },
            },
            webpush: {
              headers: { Urgency: 'low' },
            },
          });
          totalSent += 1;
        } catch (error) {
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
  async function markRead(userId, festivalId) {
    if (!stores.notificationCounts) return;
    try {
      await stores.notificationCounts.reset(userId, festivalId);
    } catch (err) {
      log.debug('markRead failed', { userId, error: err.message });
    }
  }

  return { send, sendToOfflineUsers, sendSilentSync, markRead };
}

module.exports = { initFirebase, createSendService, _fcmAgent };
