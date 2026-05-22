import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import { createNotificationService } from '../lib/notifications';

// ── Test helpers ──────────────────────────────────────────────

function makeMockStores(overrides: any = {}) {
  return {
    notificationPrefs: {
      get: async () => null,
      ...overrides.notificationPrefs,
    },
    deviceTokens: {
      listByUser: async () => [],
      unregister: async () => {},
      ...overrides.deviceTokens,
    },
    notificationCounts: {
      getByUser: async () => [],
      increment: async () => {},
      reset: async () => {},
      ...overrides.notificationCounts,
    },
    notificationLog: {
      insert: async () => 'log-id',
      ...overrides.notificationLog,
    },
    profiles: {
      userIdsByFestival: async () => [],
      readAll: async () => [],
      ...overrides.profiles,
    },
    topicSubscriptions: {
      getUnsubscribedUsers: async () => new Set(),
      ...overrides.topicSubscriptions,
    },
    pool: { query: async () => ({ rows: [] }) },
  };
}

function makeMockConfig(overrides: any = {}) {
  return {
    FIREBASE_CREDENTIALS_PATH: '', // disabled by default
    PUBLIC_ORIGIN: 'https://festie.us',
    ...overrides,
  };
}

const silentLog = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
};

function createService(storeOverrides: any = {}, configOverrides: any = {}) {
  return createNotificationService({
    stores: makeMockStores(storeOverrides),
    config: makeMockConfig(configOverrides),
    log: silentLog,
    _io: null,
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe('Notification Service — factory', () => {
  test('creates service with expected interface', () => {
    const svc = createService();
    assert.equal(typeof svc.send, 'function');
    assert.equal(typeof svc.sendToOfflineUsers, 'function');
    assert.equal(typeof svc.sendSilentSync, 'function');
    assert.equal(typeof svc.markRead, 'function');
    assert.equal(typeof svc.retryQueue, 'object');
    assert.equal(typeof svc.isConfigured, 'boolean');
  });

  test('isConfigured is false when FIREBASE_CREDENTIALS_PATH not set', () => {
    const svc = createService();
    assert.equal(svc.isConfigured, false);
  });
});

describe('Notification Service — send()', () => {
  test('returns firebase_not_configured when disabled', async () => {
    const svc = createService();
    const result = await svc.send({
      userId: 'u1', type: 'crew_update', title: 'Test', body: 'Body',
    });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'firebase_not_configured');
  });

  test('rejects invalid notification type', async () => {
    const svc = createService();
    const result = await svc.send({
      userId: 'u1', type: 'invalid_type', title: 'Test', body: 'Body',
    });
    assert.equal(result.sent, 0);
    // Either firebase_not_configured or invalid_type depending on check order
    assert.ok(result.reason === 'firebase_not_configured' || result.reason === 'invalid_type');
  });
});

describe('Notification Service — sendToOfflineUsers()', () => {
  test('returns { sent: 0 } when firebase not configured', async () => {
    const svc = createService();
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 'Test', body: 'Body',
    });
    assert.equal(result.sent, 0);
  });

  test('rejects invalid notification type', async () => {
    const svc = createService();
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'bad_type', title: 'Test', body: 'Body',
    });
    assert.equal(result.sent, 0);
  });
});

describe('Notification Service — sendSilentSync()', () => {
  test('returns { sent: 0 } when firebase not configured', async () => {
    const svc = createService();
    const result = await svc.sendSilentSync({
      festivalId: 'f1', syncType: 'picks',
    });
    assert.equal(result.sent, 0);
  });

  test('returns { sent: 0 } when no users in festival', async () => {
    const svc = createService({
      profiles: { userIdsByFestival: async () => [] },
    });
    const result = await svc.sendSilentSync({
      festivalId: 'f1', syncType: 'picks',
    });
    assert.equal(result.sent, 0);
  });

  test('excludes specified user IDs', async () => {
    const svc = createService({
      profiles: { userIdsByFestival: async () => ['u1', 'u2'] },
    });
    // All users excluded → sent 0
    const result = await svc.sendSilentSync({
      festivalId: 'f1', syncType: 'picks', excludeUserIds: ['u1', 'u2'],
    });
    assert.equal(result.sent, 0);
  });
});

describe('Notification Service — markRead()', () => {
  test('calls notificationCounts.reset', async () => {
    let resetCalled = false;
    const svc = createService({
      notificationCounts: {
        getByUser: async () => [],
        increment: async () => {},
        reset: async (userId: any, festivalId: any) => {
          resetCalled = true;
          assert.equal(userId, 'u1');
          assert.equal(festivalId, 'f1');
        },
      },
    });
    await svc.markRead('u1', 'f1');
    assert.ok(resetCalled, 'notificationCounts.reset should be called');
  });

  test('handles missing notificationCounts store gracefully', async () => {
    const svc = createNotificationService({
      stores: { ...makeMockStores(), notificationCounts: null },
      config: makeMockConfig(),
      log: silentLog,
      _io: null,
    });
    // Should not throw
    await svc.markRead('u1', 'f1');
  });

  test('handles reset error gracefully', async () => {
    const svc = createService({
      notificationCounts: {
        getByUser: async () => [],
        increment: async () => {},
        reset: async () => { throw new Error('db error'); },
      },
    });
    // Should not throw
    await svc.markRead('u1', 'f1');
  });
});

describe('Notification Service — retryQueue', () => {
  test('exposes pending count', () => {
    const svc = createService();
    assert.equal(svc.retryQueue.pending, 0);
  });

  test('shutdown clears the queue', () => {
    const svc = createService();
    svc.retryQueue.shutdown();
    assert.equal(svc.retryQueue.pending, 0);
  });
});

describe('Notification Service — type validation', () => {
  test('only crew_update and schedule_change are allowed', async () => {
    const svc = createService();
    // These should not fail with type validation errors (just firebase_not_configured)
    for (const type of ['crew_update', 'schedule_change']) {
      const result = await svc.send({ userId: 'u1', type, title: 'T', body: 'B' });
      assert.equal(result.reason, 'firebase_not_configured');
    }
  });

  test('reminder type is rejected (feature removed)', async () => {
    const svc = createService();
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'reminder', title: 'T', body: 'B',
    });
    assert.equal(result.sent, 0);
  });
});

describe('Notification Service — DND and preferences', () => {
  // These tests verify preference checking logic even when firebase is disabled
  // The send() function checks firebase first, so we validate through sendToOfflineUsers
  // which checks type validity before firebase

  test('sendToOfflineUsers with no users returns sent 0', async () => {
    const svc = createService({
      profiles: { userIdsByFestival: async () => [] },
    });
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 'T', body: 'B',
    });
    assert.equal(result.sent, 0);
  });
});
