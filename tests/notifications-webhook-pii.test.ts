// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Finding #8 — a transient push-send failure must not forward GPS coords or
// identifying text (title/body/data) to the external, operator-configured
// FCM retry webhook.
//
// This MUST be its own file, not appended to tests/notifications-send.test.ts:
// lib/notifications/payload.ts reads FCM_RETRY_WEBHOOK_URL/WEBHOOK_TOKEN_HMAC_KEY
// once at module-eval time via loadConfig(). tests/notifications-send.test.ts
// already has a static top-level `import ... from '../lib/notifications/send.js'`
// (used by its other 46 tests) — ES `import` declarations are hoisted above a
// module's own statements, so that import (and payload.ts's frozen config)
// resolves before ANY in-file `process.env.X = ...` assignment could run,
// regardless of where it's textually placed. Setting the env vars here works
// only because THIS file never statically imports send.js/payload.js — it
// reaches createSendService via a dynamic import() inside the test body,
// which (unlike a static import) executes in program order, after these two
// assignments.
process.env.FCM_RETRY_WEBHOOK_URL = 'https://example.invalid/fcm-retry-webhook'; // gitleaks:allow
process.env.WEBHOOK_TOKEN_HMAC_KEY = 'test-hmac-key-do-not-use-in-prod'; // gitleaks:allow — fake test value

import assert from 'node:assert/strict';
import https from 'node:https';
import { describe, it, mock } from 'node:test';

describe('notifications/send: postToWebhookRetry payload (finding #8 — no PII/GPS to external webhook)', () => {
  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };

  function makeStores(overrides: any = {}) {
    return {
      notificationPrefs: { get: mock.fn(async () => null) },
      deviceTokens: { listByUser: mock.fn(async () => []), unregister: mock.fn(async () => {}) },
      notificationCounts: { getByUser: mock.fn(async () => []), increment: mock.fn(async () => {}) },
      notificationLog: { insert: mock.fn(async () => null) },
      profiles: { userIdsByFestival: mock.fn(async () => []) },
      ...overrides,
    };
  }

  it('transient FCM failure -> webhook payload carries only { type }, never title/body/lat/lng', async (t) => {
    const { createSendService } = await import('../lib/notifications/send.js');

    let capturedBody: any = null;
    t.mock.method(https, 'request', (_opts: any, _cb: any) => ({
      on() {},
      end(body: any) {
        capturedBody = JSON.parse(body);
      },
    }));

    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: 'a'.repeat(30), platform: 'android' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = {
      send: mock.fn(async () => {
        throw Object.assign(new Error('internal error'), { code: 'messaging/internal-error' });
      }),
    };
    const svc = createSendService({
      stores,
      config: { PUBLIC_ORIGIN: 'https://festie.us' },
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });

    // crew_sos mirrors the real leak path: title embeds the raiser's name,
    // data carries live lat/lng (routes/crew-sos.ts fanoutSosPush).
    await svc.send({
      userId: 'u1',
      type: 'crew_sos',
      title: 'alice raised an SOS',
      body: 'Tap to see their location',
      data: { crewId: 'c1', userId: 'raiser-1', lat: '28.5384', lng: '-81.3789' },
    });

    assert.ok(capturedBody, 'webhook should have been hit for a transient failure');
    assert.equal(capturedBody.payload.lat, undefined);
    assert.equal(capturedBody.payload.lng, undefined);
    assert.equal(capturedBody.payload.title, undefined);
    assert.equal(capturedBody.payload.body, undefined);
    assert.equal(capturedBody.payload.type, 'crew_sos');
  });
});
