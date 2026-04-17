// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const crypto = require('crypto');
const https = require('https');
const { loadConfig } = require('../config');

const config = loadConfig();

// External webhook for persistent FCM retry queue
const FCM_RETRY_WEBHOOK_URL = config.FCM_RETRY_WEBHOOK_URL;

// HMAC key for hashing device tokens before transmitting to external webhook
const WEBHOOK_TOKEN_HMAC_KEY = config.WEBHOOK_TOKEN_HMAC_KEY;

// Finding #36: Reminders feature removed (ICS export superior, push notifications unreliable at festivals)
const ALLOWED_NOTIFICATION_TYPES = new Set(['crew_update', 'schedule_change', 'set_reminder']);
const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 200;
const MAX_DATA_KEYS = 10;

// Hash device token with HMAC-SHA256 before transmitting to webhook
function hashDeviceToken(token) {
  return crypto.createHmac('sha256', WEBHOOK_TOKEN_HMAC_KEY).update(String(token)).digest('hex');
}

// Fire-and-forget POST to FCM retry webhook
function postToWebhookRetry(token, payload, attempt) {
  if (!FCM_RETRY_WEBHOOK_URL) return;
  try {
    const url = new URL(FCM_RETRY_WEBHOOK_URL);
    const body = JSON.stringify({ tokenHash: hashDeviceToken(token), payload, attempt: attempt || 0 });
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    }, () => {});
    req.on('error', () => {}); // fire-and-forget
    req.end(body);
  } catch { /* ignore webhook errors */ }
}

/**
 * Clamp notification payload fields to their maximum allowed lengths.
 * @returns {{ safeTitle: string, safeBody: string, safeData: object }}
 */
function enforcePayloadLimits(title, body, data) {
  const safeTitle = String(title || '').slice(0, MAX_TITLE_LENGTH);
  const safeBody = String(body || '').slice(0, MAX_BODY_LENGTH);
  const safeData = {};
  let keyCount = 0;
  for (const [k, v] of Object.entries(data || {})) {
    if (keyCount >= MAX_DATA_KEYS) break;
    safeData[String(k).slice(0, 50)] = String(v).slice(0, 200);
    keyCount++;
  }
  return { safeTitle, safeBody, safeData };
}

module.exports = {
  ALLOWED_NOTIFICATION_TYPES,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_DATA_KEYS,
  FCM_RETRY_WEBHOOK_URL,
  WEBHOOK_TOKEN_HMAC_KEY,
  hashDeviceToken,
  postToWebhookRetry,
  enforcePayloadLimits,
};
