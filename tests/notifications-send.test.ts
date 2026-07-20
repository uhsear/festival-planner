import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import crypto from 'node:crypto';

import { createSendService } from '../lib/notifications/send.js';
import {
  ALLOWED_NOTIFICATION_TYPES,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_DATA_KEYS,
  enforcePayloadLimits,
} from '../lib/notifications/payload.js';
import { isInDndWindow } from '../lib/notifications/dnd.js';
import {
  isApnsConfigured,
  signApnsToken,
  classifyApnsResponse,
  createApnsProvider,
} from '../lib/notifications/apns.js';
import { createNotificationService } from '../lib/notifications/index.js';

// ── enforcePayloadLimits ────────────────────────────────────────────────

describe('notifications/payload: enforcePayloadLimits', () => {
  it('truncates title to MAX_TITLE_LENGTH', () => {
    const { safeTitle } = enforcePayloadLimits('a'.repeat(200), '', {});
    assert.equal(safeTitle.length, MAX_TITLE_LENGTH);
  });

  it('truncates body to MAX_BODY_LENGTH', () => {
    const { safeBody } = enforcePayloadLimits('', 'b'.repeat(500), {});
    assert.equal(safeBody.length, MAX_BODY_LENGTH);
  });

  it('limits data keys to MAX_DATA_KEYS', () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 20; i++) data[`key${i}`] = `val${i}`;
    const { safeData } = enforcePayloadLimits('', '', data);
    assert.equal(Object.keys(safeData).length, MAX_DATA_KEYS);
  });

  it('truncates data key names to 50 chars', () => {
    const data = { ['k'.repeat(100)]: 'value' };
    const { safeData } = enforcePayloadLimits('', '', data);
    const keys = Object.keys(safeData);
    assert.equal(keys[0]!.length, 50);
  });

  it('truncates data values to 200 chars', () => {
    const data = { key: 'v'.repeat(500) };
    const { safeData } = enforcePayloadLimits('', '', data);
    assert.equal(safeData.key!.length, 200);
  });

  it('converts null title/body to empty string', () => {
    const { safeTitle, safeBody } = enforcePayloadLimits(null, null, {});
    assert.equal(safeTitle, '');
    assert.equal(safeBody, '');
  });

  it('handles null data gracefully', () => {
    const { safeData } = enforcePayloadLimits('', '', null);
    assert.deepEqual(safeData, {});
  });

  it('converts non-string data values to strings', () => {
    const { safeData } = enforcePayloadLimits('', '', { num: 42, bool: true } as any);
    assert.equal(safeData.num, '42');
    assert.equal(safeData.bool, 'true');
  });
});

describe('notifications/payload: ALLOWED_NOTIFICATION_TYPES', () => {
  it('includes crew_update, schedule_change, set_reminder', () => {
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('crew_update'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('schedule_change'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('set_reminder'));
  });

  it('does not include unknown types', () => {
    assert.ok(!ALLOWED_NOTIFICATION_TYPES.has('spam'));
    assert.ok(!ALLOWED_NOTIFICATION_TYPES.has(''));
  });
});

// ── isInDndWindow ───────────────────────────────────────────────────────

describe('notifications/dnd: isInDndWindow', () => {
  it('returns false when prefs is null', () => {
    assert.equal(isInDndWindow(null), false);
  });

  it('returns false when prefs is undefined', () => {
    assert.equal(isInDndWindow(undefined), false);
  });

  it('returns false when dndStart is missing', () => {
    assert.equal(isInDndWindow({ dndEnd: '08:00' }), false);
  });

  it('returns false when dndEnd is missing', () => {
    assert.equal(isInDndWindow({ dndStart: '22:00' }), false);
  });

  it('returns false when dndStart equals dndEnd', () => {
    assert.equal(isInDndWindow({ dndStart: '22:00', dndEnd: '22:00' }), false);
  });

  it('returns false for empty prefs object', () => {
    assert.equal(isInDndWindow({}), false);
  });
});

// ── createSendService: buildFcmMessage (tested through send()) ──────────

describe('notifications/send: createSendService', () => {
  function makeStores(overrides: any = {}) {
    return {
      notificationPrefs: { get: mock.fn(async () => null) },
      deviceTokens: { listByUser: mock.fn(async () => []), unregister: mock.fn(async () => {}) },
      notificationCounts: {
        getByUser: mock.fn(async () => []),
        increment: mock.fn(async () => {}),
        reset: mock.fn(async () => {}),
      },
      notificationLog: { insert: mock.fn(async () => null) },
      profiles: { userIdsByFestival: mock.fn(async () => []) },
      ...overrides,
    };
  }

  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };
  const fakeConfig = { PUBLIC_ORIGIN: 'https://festie.us' };

  it('send returns firebase_not_configured when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(),
      config: fakeConfig,
      log: fakeLog,
      messaging: null,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'firebase_not_configured');
  });

  it('send returns invalid_type for unknown notification type', async () => {
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores: makeStores(),
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'unknown_type', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'invalid_type');
  });

  it('send returns user_disabled when prefs disable type', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => ({ crewUpdates: false })) },
    });
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'user_disabled');
  });

  it('send returns no_tokens when user has no device tokens', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => ({ crewUpdates: true })) },
    });
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'no_tokens');
  });

  it('send successfully delivers to a device', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => ({ crewUpdates: true })) },
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: 'valid-token-' + 'x'.repeat(30), platform: 'web' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'msg-id-123') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'Update',
      body: 'New message',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal(messaging.send.mock.calls.length, 1);
    // Verify FCM message structure
    const fcmMsg = (messaging.send.mock.calls as any[])[0]!.arguments[0];
    assert.equal(fcmMsg!.notification.title, 'Update');
    assert.equal(fcmMsg!.notification.body, 'New message');
    assert.equal(fcmMsg!.data.type, 'crew_update');
    assert.ok(fcmMsg!.android);
    assert.ok(fcmMsg!.apns);
    assert.ok(fcmMsg!.webpush);
  });

  it('send skips tokens that are too short', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => null) },
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: 'short', platform: 'web' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'ok') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'hi' });
    assert.equal(result.sent, 0);
    assert.equal(messaging.send.mock.calls.length, 0);
  });

  it('markRead calls notificationCounts.reset', async () => {
    const resetFn = mock.fn(async () => {});
    const stores = makeStores({
      notificationCounts: {
        getByUser: mock.fn(async () => []),
        increment: mock.fn(async () => {}),
        reset: resetFn,
      },
    });
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging: null,
      retryQueue: { enqueue() {} },
    });
    await svc.markRead('u1', 'f1');
    assert.equal(resetFn.mock.calls.length, 1);
    assert.deepEqual(resetFn.mock.calls[0]!.arguments, ['u1', 'f1']);
  });

  it('sendToOfflineUsers returns 0 when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(),
      config: fakeConfig,
      log: fakeLog,
      messaging: null,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1',
      type: 'crew_update',
      title: 'hi',
      body: 'test',
    });
    assert.equal(result.sent, 0);
  });

  it('sendSilentSync returns 0 when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(),
      config: fakeConfig,
      log: fakeLog,
      messaging: null,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.sendSilentSync({ festivalId: 'f1', syncType: 'picks' });
    assert.equal(result.sent, 0);
  });
});

// ── notifications/apns: JWT + response classification ───────────────────

// A throwaway EC P-256 (prime256v1) key — used ONLY to exercise ES256 signing
// in tests. Not a real APNs key; no secret value is embedded.
const { privateKey: testEcKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}) as any;

function decodeJwtPart(part: string) {
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

describe('notifications/apns: signApnsToken', () => {
  it('produces a 3-part ES256 JWT with kid header and iss/iat payload', () => {
    const iat = 1_700_000_000;
    const token = signApnsToken(testEcKey, 'KEY12345AB', 'TEAM98765C', iat);
    const parts = token.split('.');
    assert.equal(parts.length, 3);

    const header = decodeJwtPart(parts[0]!);
    assert.equal(header.alg, 'ES256');
    assert.equal(header.kid, 'KEY12345AB');

    const payload = decodeJwtPart(parts[1]!);
    assert.equal(payload.iss, 'TEAM98765C');
    assert.equal(payload.iat, iat);
  });

  it('produces a verifiable ES256 signature (ieee-p1363 / 64-byte)', () => {
    const token = signApnsToken(testEcKey, 'K', 'T', 123);
    const [h, p, sig] = token.split('.');
    const sigBuf = Buffer.from(sig!.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    assert.equal(sigBuf.length, 64); // raw r||s, not DER

    const pub = crypto.createPublicKey(testEcKey);
    const ok = crypto.verify('SHA256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, sigBuf);
    assert.equal(ok, true);
  });
});

describe('notifications/apns: classifyApnsResponse', () => {
  it('200 → sent, not stale', () => {
    assert.deepEqual(classifyApnsResponse(200, ''), { sent: true, stale: false });
  });
  it('410 Unregistered → stale', () => {
    const r = classifyApnsResponse(410, 'Unregistered');
    assert.equal(r.sent, false);
    assert.equal(r.stale, true);
  });
  it('400 BadDeviceToken → stale', () => {
    assert.equal(classifyApnsResponse(400, 'BadDeviceToken').stale, true);
  });
  it('400 DeviceTokenNotForTopic → stale', () => {
    assert.equal(classifyApnsResponse(400, 'DeviceTokenNotForTopic').stale, true);
  });
  it('400 PayloadTooLarge → NOT stale', () => {
    assert.equal(classifyApnsResponse(400, 'PayloadTooLarge').stale, false);
  });
  it('500 → not stale, carries error', () => {
    const r = classifyApnsResponse(500, 'InternalServerError');
    assert.equal(r.sent, false);
    assert.equal(r.stale, false);
    assert.equal(r.error, 'InternalServerError');
  });
});

describe('notifications/apns: isApnsConfigured', () => {
  const full = { APNS_KEY_PATH: '/k.p8', APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_BUNDLE_ID: 'us.festie.app' };
  it('true when all required keys present', () => assert.equal(isApnsConfigured(full), true));
  it('false when key path missing', () => assert.equal(isApnsConfigured({ ...full, APNS_KEY_PATH: '' }), false));
  it('false when key id missing', () => assert.equal(isApnsConfigured({ ...full, APNS_KEY_ID: '' }), false));
  it('false for null', () => assert.equal(isApnsConfigured(null), false));
});

// Build a fake http2 impl whose request() resolves to the given status + reason body.
function fakeHttp2({ status, reason }: { status: number; reason?: string }) {
  return {
    connect() {
      return {
        closed: false,
        destroyed: false,
        setTimeout() {},
        on() {},
        close() {},
        request(_headers: any) {
          const handlers: Record<string, any> = {};
          const req = {
            setTimeout() {},
            on(ev: string, cb: any) {
              handlers[ev] = cb;
              return req;
            },
            end() {
              // Simulate async APNs response.
              setImmediate(() => {
                handlers.response?.({ ':status': status });
                if (reason) handlers.data?.(Buffer.from(JSON.stringify({ reason })));
                handlers.end?.();
              });
            },
            close() {},
          };
          return req;
        },
      };
    },
  };
}

describe('notifications/apns: createApnsProvider (http2 mocked)', () => {
  const cfg = {
    APNS_KEY_PATH: '/k.p8',
    APNS_KEY_ID: 'K',
    APNS_TEAM_ID: 'T',
    APNS_BUNDLE_ID: 'us.festie.app',
    APNS_PRODUCTION: true,
  };
  const deps = (h: any) => ({ http2: h, keyLoader: () => testEcKey });

  it('200 → { sent: true, stale: false }', async () => {
    const p = createApnsProvider(cfg, console, deps(fakeHttp2({ status: 200 })) as any);
    const r = await p.send('a'.repeat(64), { aps: { alert: { title: 't', body: 'b' } } });
    assert.deepEqual(r, { sent: true, stale: false });
  });

  it('410 Unregistered → stale:true', async () => {
    const p = createApnsProvider(cfg, console, deps(fakeHttp2({ status: 410, reason: 'Unregistered' })) as any);
    const r = await p.send('a'.repeat(64), { aps: {} });
    assert.equal(r.sent, false);
    assert.equal(r.stale, true);
  });

  it('caches the provider token across sends (key loaded once)', async () => {
    let loads = 0;
    const p = createApnsProvider(cfg, console, {
      http2: fakeHttp2({ status: 200 }) as any,
      keyLoader: () => {
        loads++;
        return testEcKey;
      },
    });
    await p.send('a'.repeat(64), { aps: {} });
    await p.send('a'.repeat(64), { aps: {} });
    // Key is read once (lazy) and the JWT is cached within the refresh window.
    assert.equal(loads, 1);
  });
});

// ── notifications/send: platform routing (iOS APNs vs FCM) ──────────────

describe('notifications/send: platform routing', () => {
  function makeStores(overrides: any = {}) {
    return {
      notificationPrefs: { get: mock.fn(async () => ({ crewUpdates: true })) },
      deviceTokens: { listByUser: mock.fn(async () => []), unregister: mock.fn(async () => {}) },
      notificationCounts: {
        getByUser: mock.fn(async () => []),
        increment: mock.fn(async () => {}),
        reset: mock.fn(async () => {}),
      },
      notificationLog: { insert: mock.fn(async () => null) },
      profiles: { userIdsByFestival: mock.fn(async () => []) },
      ...overrides,
    };
  }
  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };
  const apnsConfig = {
    PUBLIC_ORIGIN: 'https://festie.us',
    APNS_KEY_PATH: '/k.p8',
    APNS_KEY_ID: 'K',
    APNS_TEAM_ID: 'T',
    APNS_BUNDLE_ID: 'us.festie.app',
  };
  const validIosToken = 'i'.repeat(64);

  it('ios + APNs configured → APNs sender called, FCM messaging.send NOT called', async () => {
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'fcm-id') };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal((apnsProvider.send.mock.calls as any[]).length, 1);
    assert.equal((messaging.send.mock.calls as any[]).length, 0);
    // aps payload carries alert title/body
    const payload = (apnsProvider.send.mock.calls as any[])[0]!.arguments[1];
    assert.equal(payload.aps.alert.title, 'T');
    assert.equal(payload.aps.alert.body, 'B');
    assert.equal(payload.aps.category, 'CREW_UPDATE');
  });

  it('FCM unconfigured + APNs configured → ios still delivered via APNs', async () => {
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging: null, // ← Firebase NOT configured; APNs is
      retryQueue: { enqueue() {} },
      apnsProvider,
    });
    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal((apnsProvider.send.mock.calls as any[]).length, 1);
  });

  it('ios + APNs NOT configured → token SKIPPED and NOT unregistered (the bug fix)', async () => {
    const unregister = mock.fn(async () => {});
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister,
      },
    });
    const messaging = { send: mock.fn(async () => 'fcm-id') };
    // config WITHOUT apns keys
    const svc = createSendService({
      stores,
      config: { PUBLIC_ORIGIN: 'https://festie.us' },
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 0);
    assert.equal((messaging.send.mock.calls as any[]).length, 0); // never sent via FCM
    assert.equal((unregister.mock.calls as any[]).length, 0); // NOT deleted as stale
    assert.equal(result.staleRemoved, 0);
  });

  it('android → unchanged FCM path (messaging.send called, APNs not)', async () => {
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: 'a'.repeat(64), platform: 'android' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'fcm-id') };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal((messaging.send.mock.calls as any[]).length, 1);
    assert.equal((apnsProvider.send.mock.calls as any[]).length, 0);
  });

  it('ios + APNs 410 stale → token unregistered', async () => {
    const unregister = mock.fn(async () => {});
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister,
      },
    });
    const messaging = { send: mock.fn(async () => 'fcm-id') };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: false, stale: true, error: 'Unregistered' })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 0);
    assert.equal((unregister.mock.calls as any[]).length, 1);
    assert.deepEqual((unregister.mock.calls as any[])[0]!.arguments, [validIosToken, 'u1']);
  });

  it('mixed crew (ios+android) in sendToOfflineUsers → ios via APNs, android via FCM batch', async () => {
    const stores = makeStores({
      profiles: { userIdsByFestival: mock.fn(async () => ['u1', 'u2']) },
      deviceTokens: {
        listByUser: mock.fn(async (uid: string) =>
          uid === 'u1' ? [{ token: validIosToken, platform: 'ios' }] : [{ token: 'a'.repeat(64), platform: 'android' }],
        ),
        unregister: mock.fn(async () => {}),
      },
      topicSubscriptions: { getUnsubscribedUsers: mock.fn(async () => new Set()) },
    });
    const messaging = {
      send: mock.fn(async () => 'x'),
      sendEach: mock.fn(async (batch: any[]) => ({ responses: batch.map(() => ({ success: true })) })),
    };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 2);
    assert.equal((apnsProvider.send.mock.calls as any[]).length, 1); // one ios
    assert.equal((messaging.sendEach.mock.calls as any[]).length, 1); // android via batch
    const batch = (messaging.sendEach.mock.calls as any[])[0]!.arguments[0];
    assert.equal(batch.length, 1); // only the android token batched
  });

  it('sendSilentSync ios → APNs background push (content-available)', async () => {
    const stores = makeStores({
      profiles: { userIdsByFestival: mock.fn(async () => ['u1']) },
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'x') };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.sendSilentSync({ festivalId: 'f1', syncType: 'picks' });
    assert.equal(result.sent, 1);
    assert.equal((messaging.send.mock.calls as any[]).length, 0);
    const [, payload, opts] = (apnsProvider.send.mock.calls as any[])[0]!.arguments;
    assert.equal(payload.aps['content-available'], 1);
    assert.equal(opts.pushType, 'background');
    assert.equal(opts.priority, '5');
  });
});

// ── notifications/index: isConfigured spans both transports ─────────────

describe('notifications/index: createNotificationService isConfigured', () => {
  const makeStores = () => ({
    notificationPrefs: { get: async () => null },
    deviceTokens: { listByUser: async () => [], unregister: async () => {} },
    notificationCounts: { getByUser: async () => [], increment: async () => {}, reset: async () => {} },
    notificationLog: { insert: async () => null },
    profiles: { userIdsByFestival: async () => [] },
  });
  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };

  it('isConfigured=true when APNs is configured and firebase is not', () => {
    const svc = createNotificationService({
      stores: makeStores(),
      config: {
        PUBLIC_ORIGIN: 'https://festie.us',
        FIREBASE_CREDENTIALS_PATH: '',
        APNS_KEY_PATH: '/k.p8',
        APNS_KEY_ID: 'K',
        APNS_TEAM_ID: 'T',
        APNS_BUNDLE_ID: 'us.festie.app',
      },
      log: fakeLog,
    });
    assert.equal(svc.isConfigured, true);
  });
});
