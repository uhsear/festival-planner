'use strict';

const assert = require('node:assert/strict');
const { describe, it, mock } = require('node:test');

const { createSendService } = require('../lib/notifications/send');
const {
  ALLOWED_NOTIFICATION_TYPES,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_DATA_KEYS,
  enforcePayloadLimits,
} = require('../lib/notifications/payload');
const { isInDndWindow } = require('../lib/notifications/dnd');

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
    const data = {};
    for (let i = 0; i < 20; i++) data[`key${i}`] = `val${i}`;
    const { safeData } = enforcePayloadLimits('', '', data);
    assert.equal(Object.keys(safeData).length, MAX_DATA_KEYS);
  });

  it('truncates data key names to 50 chars', () => {
    const data = { ['k'.repeat(100)]: 'value' };
    const { safeData } = enforcePayloadLimits('', '', data);
    const keys = Object.keys(safeData);
    assert.equal(keys[0].length, 50);
  });

  it('truncates data values to 200 chars', () => {
    const data = { key: 'v'.repeat(500) };
    const { safeData } = enforcePayloadLimits('', '', data);
    assert.equal(safeData.key.length, 200);
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
    const { safeData } = enforcePayloadLimits('', '', { num: 42, bool: true });
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
  function makeStores(overrides = {}) {
    return {
      notificationPrefs: { get: mock.fn(async () => null) },
      deviceTokens: { listByUser: mock.fn(async () => []), unregister: mock.fn(async () => {}) },
      notificationCounts: { getByUser: mock.fn(async () => []), increment: mock.fn(async () => {}), reset: mock.fn(async () => {}) },
      notificationLog: { insert: mock.fn(async () => null) },
      profiles: { userIdsByFestival: mock.fn(async () => []) },
      ...overrides,
    };
  }

  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };
  const fakeConfig = { PUBLIC_ORIGIN: 'https://festie.us' };

  it('send returns firebase_not_configured when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(), config: fakeConfig, log: fakeLog,
      messaging: null, retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'firebase_not_configured');
  });

  it('send returns invalid_type for unknown notification type', async () => {
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores: makeStores(), config: fakeConfig, log: fakeLog,
      messaging, retryQueue: { enqueue() {} },
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
      stores, config: fakeConfig, log: fakeLog,
      messaging, retryQueue: { enqueue() {} },
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
      stores, config: fakeConfig, log: fakeLog,
      messaging, retryQueue: { enqueue() {} },
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
      stores, config: fakeConfig, log: fakeLog,
      messaging, retryQueue: { enqueue() {} },
    });
    const result = await svc.send({
      userId: 'u1', type: 'crew_update', title: 'Update', body: 'New message',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal(messaging.send.mock.calls.length, 1);
    // Verify FCM message structure
    const fcmMsg = messaging.send.mock.calls[0].arguments[0];
    assert.equal(fcmMsg.notification.title, 'Update');
    assert.equal(fcmMsg.notification.body, 'New message');
    assert.equal(fcmMsg.data.type, 'crew_update');
    assert.ok(fcmMsg.android);
    assert.ok(fcmMsg.apns);
    assert.ok(fcmMsg.webpush);
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
      stores, config: fakeConfig, log: fakeLog,
      messaging, retryQueue: { enqueue() {} },
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
      stores, config: fakeConfig, log: fakeLog,
      messaging: null, retryQueue: { enqueue() {} },
    });
    await svc.markRead('u1', 'f1');
    assert.equal(resetFn.mock.calls.length, 1);
    assert.deepEqual(resetFn.mock.calls[0].arguments, ['u1', 'f1']);
  });

  it('sendToOfflineUsers returns 0 when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(), config: fakeConfig, log: fakeLog,
      messaging: null, retryQueue: { enqueue() {} },
    });
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 'hi', body: 'test',
    });
    assert.equal(result.sent, 0);
  });

  it('sendSilentSync returns 0 when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(), config: fakeConfig, log: fakeLog,
      messaging: null, retryQueue: { enqueue() {} },
    });
    const result = await svc.sendSilentSync({ festivalId: 'f1', syncType: 'picks' });
    assert.equal(result.sent, 0);
  });
});
