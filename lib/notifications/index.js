// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const { isInDndWindow } = require('./dnd');
const { createRetryQueue } = require('./retry');
const { initFirebase, createSendService } = require('./send');

/**
 * Create the notification service.
 *
 * @param {object} deps
 * @param {object} deps.stores - DB stores (notificationPrefs, deviceTokens, notificationCounts, notificationLog, profiles, topicSubscriptions)
 * @param {object} deps.config - App config (FIREBASE_CREDENTIALS_PATH, PUBLIC_ORIGIN, ...)
 * @param {object} deps.log    - Logger with info/warn/debug/error
 * @param {object} [deps._io]  - Reserved for Socket.IO injection (unused today)
 * @param {object} [deps.pushClient] - OPTIONAL Firebase messaging client override for tests.
 *   When provided, we skip initFirebase() and use this client directly. Must implement
 *   `send(message)` and `sendEach(batch)` to match firebase-admin's Messaging surface.
 *   When NOT provided (production path), behavior is identical to before: initFirebase()
 *   runs, lazily requires firebase-admin, and returns null if FIREBASE_CREDENTIALS_PATH is unset.
 */
function createNotificationService({ stores, config, log, _io, pushClient }) {
  // DI: if a pushClient is provided (not null/undefined), use it directly.
  // Otherwise fall back to the original initFirebase() path for production.
  const messaging = (pushClient !== undefined && pushClient !== null)
    ? pushClient
    : initFirebase(config, log);

  const retryQueue = createRetryQueue({ log });

  const { send, sendToOfflineUsers, sendSilentSync, markRead } =
    createSendService({ stores, config, log, messaging, retryQueue });

  return { send, sendToOfflineUsers, sendSilentSync, markRead, retryQueue, isConfigured: !!messaging };
}

module.exports = { createNotificationService, isInDndWindow };
