/**
 * Comprehensive unit tests for lib/notifications.js using dependency injection.
 *
 * Target surface: `createNotificationService({ stores, config, log, _io, pushClient })`
 * returning `{ send, sendToOfflineUsers, sendSilentSync, markRead, retryQueue, isConfigured }`,
 * plus the standalone `isInDndWindow(prefs)` export.
 *
 * DI model: the factory now accepts a `pushClient` override. When provided, it is used
 * as the Firebase messaging client directly — initFirebase() is skipped. This makes the
 * tests hermetic: no require.cache tricks, no Module._resolveFilename hooks, no reliance
 * on the order in which firebase-admin or ./config get loaded by the broader test suite.
 *
 * Pure unit tests — no DB, no network. Node style: `node:test` + `node:assert/strict`.
 */
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createNotificationService, isInDndWindow } = require('../lib/notifications');

// ---------------------------------------------------------------------------
// Test doubles — pushClient, stores, logger, clock
// ---------------------------------------------------------------------------

function makePushClientStub() {
  const stub = {
    sendCalls: [],
    sendEachCalls: [],
    nextError: null,
    nextErrorQueue: [],
    nextSendEachResponse: null,
    async send(msg) {
      stub.sendCalls.push(msg);
      const err = stub.nextErrorQueue.length ? stub.nextErrorQueue.shift() : stub.nextError;
      if (err) throw err;
      return { messageId: `mid-${stub.sendCalls.length}` };
    },
    async sendEach(batch) {
      stub.sendEachCalls.push(batch);
      if (stub.nextSendEachResponse) return stub.nextSendEachResponse;
      return {
        successCount: batch.length,
        failureCount: 0,
        responses: batch.map((_, i) => ({ success: true, messageId: `mid-${i}` })),
      };
    },
    reset() {
      stub.sendCalls.length = 0;
      stub.sendEachCalls.length = 0;
      stub.nextError = null;
      stub.nextErrorQueue.length = 0;
      stub.nextSendEachResponse = null;
    },
  };
  return stub;
}

function makeLogger() {
  const calls = { info: [], warn: [], debug: [], error: [] };
  return {
    info: (...a) => calls.info.push(a),
    warn: (...a) => calls.warn.push(a),
    debug: (...a) => calls.debug.push(a),
    error: (...a) => calls.error.push(a),
    _calls: calls,
  };
}

function makeStores(overrides = {}) {
  const state = {
    prefs: new Map(),
    tokens: new Map(),
    counts: new Map(),
    unregistered: [],
    logInserts: [],
    profiles: [],
    topicUnsub: new Map(), // key: `${festivalId}:${topic}` -> Set<userId>
  };
  const stores = {
    notificationPrefs: {
      get: async (uid) => state.prefs.get(uid) || null,
    },
    deviceTokens: {
      listByUser: async (uid) => state.tokens.get(uid) || [],
      unregister: async (token, uid) => { state.unregistered.push({ token, uid }); },
    },
    notificationCounts: {
      getByUser: async (uid) => state.counts.get(uid) || [],
      increment: async (uid, fid, _field) => {
        const arr = state.counts.get(uid) || [];
        const row = arr.find((r) => r.festivalId === fid) || { festivalId: fid, unreadUpdates: 0 };
        row.unreadUpdates += 1;
        if (!arr.includes(row)) arr.push(row);
        state.counts.set(uid, arr);
      },
      reset: async (uid, fid) => {
        const arr = state.counts.get(uid) || [];
        const row = arr.find((r) => r.festivalId === fid);
        if (row) row.unreadUpdates = 0;
      },
    },
    notificationLog: {
      insert: async (row) => { state.logInserts.push(row); },
    },
    profiles: {
      userIdsByFestival: async (fid) => state.profiles.filter((p) => p.festivalId === fid).map((p) => p.userId),
      readAll: async () => state.profiles,
    },
    topicSubscriptions: {
      getUnsubscribedUsers: async (fid, topic) => state.topicUnsub.get(`${fid}:${topic}`) || new Set(),
    },
    _state: state,
    ...overrides,
  };
  return stores;
}

// Default config — FIREBASE_CREDENTIALS_PATH is irrelevant when pushClient is injected,
// but PUBLIC_ORIGIN is used for webpush link fallback.
function makeConfig(overrides = {}) {
  return {
    FIREBASE_CREDENTIALS_PATH: '',
    PUBLIC_ORIGIN: 'https://festie.test',
    ...overrides,
  };
}

// Freeze Date to a known instant so isInDndWindow is deterministic.
let _realDate = Date;
function freezeTime(iso) {
  const fixed = new _realDate(iso).getTime();
  class FrozenDate extends _realDate {
    constructor(...args) {
      if (args.length === 0) { super(fixed); return; }
      super(...args);
    }
    static now() { return fixed; }
  }
  global.Date = FrozenDate;
}
function unfreezeTime() { global.Date = _realDate; }

// Build a service with DI defaults for the push path.
function buildService({ pushClient, stores, log, config } = {}) {
  return createNotificationService({
    stores: stores || makeStores(),
    config: config || makeConfig(),
    log: log || makeLogger(),
    pushClient: pushClient || makePushClientStub(),
  });
}

// ---------------------------------------------------------------------------
// isInDndWindow — DND window math
// ---------------------------------------------------------------------------

describe('isInDndWindow — DND window math', () => {
  afterEach(() => unfreezeTime());

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

  it('returns false when dndStart === dndEnd (zero-length window)', () => {
    freezeTime('2026-06-05T12:00:00Z');
    assert.equal(isInDndWindow({ dndStart: '12:00', dndEnd: '12:00' }), false);
  });

  const crossMidnight = { dndStart: '22:00', dndEnd: '08:00' };
  it('cross-midnight: 23:30 local is INSIDE 22:00-08:00', () => {
    const d = new _realDate();
    d.setHours(23, 30, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(crossMidnight), true);
  });

  it('cross-midnight: 02:00 local is INSIDE 22:00-08:00', () => {
    const d = new _realDate();
    d.setHours(2, 0, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(crossMidnight), true);
  });

  it('cross-midnight: 08:00 local is OUTSIDE 22:00-08:00 (endpoint exclusive on wrap)', () => {
    const d = new _realDate();
    d.setHours(8, 0, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(crossMidnight), false);
  });

  it('cross-midnight: 21:59 local is OUTSIDE 22:00-08:00', () => {
    const d = new _realDate();
    d.setHours(21, 59, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(crossMidnight), false);
  });

  it('cross-midnight: 22:00 exactly is INSIDE (start boundary inclusive)', () => {
    const d = new _realDate();
    d.setHours(22, 0, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(crossMidnight), true);
  });

  const sameDay = { dndStart: '09:00', dndEnd: '17:00' };
  it('same-day: 12:00 is INSIDE 09:00-17:00', () => {
    const d = new _realDate();
    d.setHours(12, 0, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(sameDay), true);
  });

  it('same-day: 08:59 is OUTSIDE 09:00-17:00', () => {
    const d = new _realDate();
    d.setHours(8, 59, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(sameDay), false);
  });

  it('same-day: 17:00 exactly is INSIDE (end boundary inclusive on same-day)', () => {
    const d = new _realDate();
    d.setHours(17, 0, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(sameDay), true);
  });

  it('same-day: 17:01 is OUTSIDE 09:00-17:00', () => {
    const d = new _realDate();
    d.setHours(17, 1, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow(sameDay), false);
  });

  it('24h-style window: 00:00 - 23:59 covers nearly everything', () => {
    const d = new _realDate();
    d.setHours(12, 30, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow({ dndStart: '00:00', dndEnd: '23:59' }), true);
  });

  it('short window: 14:00 - 14:05 includes 14:02', () => {
    const d = new _realDate();
    d.setHours(14, 2, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow({ dndStart: '14:00', dndEnd: '14:05' }), true);
  });

  it('short window: 14:00 - 14:05 excludes 14:06', () => {
    const d = new _realDate();
    d.setHours(14, 6, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow({ dndStart: '14:00', dndEnd: '14:05' }), false);
  });

  it('TZ note: DND compares LOCAL hhmm of Date — user in EST vs UTC vs PST', () => {
    const d = new _realDate();
    d.setHours(3, 0, 0, 0);
    freezeTime(d.toISOString());
    assert.equal(isInDndWindow({ dndStart: '02:00', dndEnd: '04:00' }), true);
    const d2 = new _realDate();
    d2.setHours(5, 0, 0, 0);
    freezeTime(d2.toISOString());
    assert.equal(isInDndWindow({ dndStart: '02:00', dndEnd: '04:00' }), false);
  });
});

// ---------------------------------------------------------------------------
// send() — type validation, prefs, DND early-return, payload truncation
// ---------------------------------------------------------------------------

describe('send() — core dispatch', () => {
  let svc, stores, log, messaging;

  beforeEach(() => {
    messaging = makePushClientStub();
    stores = makeStores();
    log = makeLogger();
    svc = createNotificationService({ stores, config: makeConfig(), log, pushClient: messaging });
  });

  afterEach(() => { unfreezeTime(); });

  it('returns invalid_type for disallowed notification type', async () => {
    const r = await svc.send({ userId: 'u1', type: 'spam_user', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
    assert.equal(r.reason, 'invalid_type');
    assert.equal(messaging.sendCalls.length, 0);
  });

  it('accepts crew_update', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 1);
  });

  it('accepts schedule_change', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const r = await svc.send({ userId: 'u1', type: 'schedule_change', title: 't', body: 'b' });
    assert.equal(r.sent, 1);
  });

  it('accepts set_reminder', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const r = await svc.send({ userId: 'u1', type: 'set_reminder', title: 't', body: 'b' });
    assert.equal(r.sent, 1);
  });

  it('returns user_disabled when user opted out of this type', async () => {
    stores._state.prefs.set('u1', { crewUpdates: false });
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.reason, 'user_disabled');
    assert.equal(messaging.sendCalls.length, 0);
  });

  it('still sends when prefs is null (user never set preferences)', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 1);
  });

  it('in-DND returns dnd_active WITHOUT calling pushClient.send', async () => {
    const d = new _realDate();
    d.setHours(23, 0, 0, 0);
    freezeTime(d.toISOString());
    stores._state.prefs.set('u1', { crewUpdates: true, dndStart: '22:00', dndEnd: '08:00' });
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.reason, 'dnd_active');
    assert.equal(r.sent, 0);
    assert.equal(messaging.sendCalls.length, 0, 'pushClient.send must NOT be invoked during DND');
  });

  it('returns no_tokens when user has no devices', async () => {
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.reason, 'no_tokens');
    assert.equal(messaging.sendCalls.length, 0);
  });

  it('skips tokens shorter than 20 chars (treats as stale)', async () => {
    stores._state.tokens.set('u1', [{ token: 'short', platform: 'android' }]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
    assert.equal(messaging.sendCalls.length, 0);
  });

  it('skips tokens longer than 4096 chars', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(5000), platform: 'android' }]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
    assert.equal(messaging.sendCalls.length, 0);
  });

  it('skips non-string tokens', async () => {
    stores._state.tokens.set('u1', [{ token: 12345, platform: 'android' }]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
    assert.equal(messaging.sendCalls.length, 0);
  });

  it('truncates title to 100 chars', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const longTitle = 'A'.repeat(500);
    await svc.send({ userId: 'u1', type: 'crew_update', title: longTitle, body: 'b' });
    assert.equal(messaging.sendCalls[0].notification.title.length, 100);
  });

  it('truncates body to 200 chars', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const longBody = 'B'.repeat(1000);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: longBody });
    assert.equal(messaging.sendCalls[0].notification.body.length, 200);
  });

  it('caps data map to 10 keys', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const data = {};
    for (let i = 0; i < 25; i++) data[`k${i}`] = `v${i}`;
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b', data });
    const sentData = messaging.sendCalls[0].data;
    // safeData capped at 10 + `type` = 11 total keys on the emitted message.
    assert.equal(Object.keys(sentData).length, 11);
  });

  it('clamps long data values to 200 chars', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const data = { note: 'z'.repeat(500) };
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b', data });
    assert.equal(messaging.sendCalls[0].data.note.length, 200);
  });

  it('coerces non-string data values to strings', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b', data: { n: 42, b: true } });
    assert.equal(messaging.sendCalls[0].data.n, '42');
    assert.equal(messaging.sendCalls[0].data.b, 'true');
  });

  it('handles null title/body without crashing', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: null, body: null });
    assert.equal(r.sent, 1);
    assert.equal(messaging.sendCalls[0].notification.title, '');
    assert.equal(messaging.sendCalls[0].notification.body, '');
  });

  it('sets FCM priority high for Android', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'android' }]);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(messaging.sendCalls[0].android.priority, 'high');
  });

  it('uses supplied threadId for fine-grained tag/thread-id', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b', threadId: 'crew-fest42' });
    assert.equal(messaging.sendCalls[0].android.notification.tag, 'crew-fest42');
    assert.equal(messaging.sendCalls[0].apns.payload.aps['thread-id'], 'crew-fest42');
  });

  it('falls back to update-{festivalId} when threadId omitted', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b', data: { festivalId: 'f1' } });
    assert.equal(messaging.sendCalls[0].android.notification.tag, 'update-f1');
  });

  it('uses data.deepLink for webpush link when present', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({
      userId: 'u1', type: 'crew_update', title: 't', body: 'b',
      data: { deepLink: 'https://festie.test/deep/abc' },
    });
    assert.equal(messaging.sendCalls[0].webpush.fcmOptions.link, 'https://festie.test/deep/abc');
  });

  it('falls back to PUBLIC_ORIGIN/festival/{id} webpush link', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({
      userId: 'u1', type: 'crew_update', title: 't', body: 'b', data: { festivalId: 'f9' },
    });
    assert.equal(
      messaging.sendCalls[0].webpush.fcmOptions.link,
      'https://festie.test/festival/f9'
    );
  });
});

// ---------------------------------------------------------------------------
// send() — payload size guard (4 KB FCM limit)
// ---------------------------------------------------------------------------

describe('send() — 4 KB payload guard', () => {
  let svc, stores, log, messaging;

  beforeEach(() => {
    messaging = makePushClientStub();
    stores = makeStores();
    log = makeLogger();
    svc = createNotificationService({ stores, config: makeConfig(), log, pushClient: messaging });
  });

  // Intentionally no "triggers 4KB warn" case: enforcePayloadLimits pre-clamps
  // title (100), body (200), and data (10 keys × 200 chars), which means the
  // serialized fcmMessage cannot exceed ~2.5KB from the send() entry path.
  // The post-clamp >4KB guard at lib/notifications.js:~310 is unreachable via
  // this route. The other two cases below still cover the truncation-state
  // invariants (field preservation + unmodified-under-4KB).

  it('preserves required fields (token, type, notification) after truncation', async () => {
    stores._state.tokens.set('u1', [{ token: 'tok-' + 'x'.repeat(40), platform: 'ios' }]);
    const data = {};
    for (let i = 0; i < 10; i++) data[`k${i}`] = 'z'.repeat(200);
    await svc.send({
      userId: 'u1', type: 'crew_update',
      title: 'T'.repeat(100), body: 'B'.repeat(200), data,
    });
    const msg = messaging.sendCalls[0];
    assert.ok(msg.token.startsWith('tok-'));
    assert.equal(msg.data.type, 'crew_update');
    assert.ok(msg.notification.title);
  });

  it('leaves payload unmodified when under 4 KB', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 'short', body: 'short body' });
    assert.equal(messaging.sendCalls[0].notification.body, 'short body');
    assert.ok(!messaging.sendCalls[0].notification.body.endsWith('...'));
  });
});

// ---------------------------------------------------------------------------
// send() — multi-device fanout + error handling
// ---------------------------------------------------------------------------

describe('send() — multi-device fanout', () => {
  let svc, stores, log, messaging;

  beforeEach(() => {
    messaging = makePushClientStub();
    stores = makeStores();
    log = makeLogger();
    svc = createNotificationService({ stores, config: makeConfig(), log, pushClient: messaging });
  });

  it('one user with 3 devices yields 3 pushClient.send calls', async () => {
    stores._state.tokens.set('u1', [
      { token: 'a'.repeat(40), platform: 'ios' },
      { token: 'b'.repeat(40), platform: 'android' },
      { token: 'c'.repeat(40), platform: 'web' },
    ]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 3);
    assert.equal(messaging.sendCalls.length, 3);
  });

  it('one failing device does not cancel others (fanout is isolated)', async () => {
    stores._state.tokens.set('u1', [
      { token: 'a'.repeat(40), platform: 'ios' },
      { token: 'b'.repeat(40), platform: 'android' },
      { token: 'c'.repeat(40), platform: 'web' },
    ]);
    // First send throws a non-retryable error (invalid-argument); others succeed.
    // Using invalid-argument avoids the real withRetry's retry loop consuming more
    // slots than expected.
    messaging.nextErrorQueue.push(Object.assign(new Error('boom'), { code: 'messaging/invalid-argument' }));
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 2);
    assert.equal(messaging.sendCalls.length, 3);
  });

  it('unregisters stale tokens on not-registered error', async () => {
    stores._state.tokens.set('u1', [{ token: 'dead'.repeat(10), platform: 'ios' }]);
    messaging.nextError = Object.assign(new Error('gone'), { code: 'messaging/registration-token-not-registered' });
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
    assert.equal(stores._state.unregistered.length, 1);
    assert.equal(stores._state.unregistered[0].token, 'dead'.repeat(10));
  });

  it('unregisters on invalid-registration error', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextError = Object.assign(new Error('bad'), { code: 'messaging/invalid-registration-token' });
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(stores._state.unregistered.length, 1);
  });

  it('unregisters on invalid-argument error', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextError = Object.assign(new Error('arg'), { code: 'messaging/invalid-argument' });
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(stores._state.unregistered.length, 1);
  });

  it('does NOT unregister on transient unavailable error', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextError = Object.assign(new Error('busy'), { code: 'messaging/server-unavailable' });
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(stores._state.unregistered.length, 0);
  });

  it('does NOT unregister on internal error (transient)', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextError = Object.assign(new Error('oops'), { code: 'messaging/internal' });
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(stores._state.unregistered.length, 0);
  });

  it('cleans up stale tokens from length-validation (too short)', async () => {
    stores._state.tokens.set('u1', [
      { token: 'short', platform: 'ios' },
      { token: 'x'.repeat(40), platform: 'android' },
    ]);
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 1);
    assert.equal(stores._state.unregistered.length, 1);
    assert.equal(stores._state.unregistered[0].token, 'short');
  });

  it('increments unread count on successful send when festivalId present', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({
      userId: 'u1', type: 'crew_update', title: 't', body: 'b',
      data: { festivalId: 'f1' },
    });
    const counts = stores._state.counts.get('u1');
    assert.ok(counts && counts[0].unreadUpdates >= 1);
  });

  it('does NOT increment unread when festivalId missing', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.ok(!stores._state.counts.get('u1'));
  });

  it('reads badge count from notificationCounts store', async () => {
    stores._state.counts.set('u1', [{ festivalId: 'f1', unreadUpdates: 7 }]);
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(messaging.sendCalls[0].apns.payload.aps.badge, 7);
  });

  it('falls back to badge=1 when notificationCounts store absent', async () => {
    const storesNoCounts = makeStores();
    delete storesNoCounts.notificationCounts;
    storesNoCounts._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const localMessaging = makePushClientStub();
    const svc2 = createNotificationService({
      stores: storesNoCounts, config: makeConfig(), log, pushClient: localMessaging,
    });
    await svc2.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(localMessaging.sendCalls[0].apns.payload.aps.badge, 1);
  });
});

// ---------------------------------------------------------------------------
// send() — retry backoff behavior (via real withRetry from lib/helpers.js)
// ---------------------------------------------------------------------------
//
// NOTE: the factory calls `require('./helpers').withRetry` internally; there is
// no withRetry injection point. These tests rely on the real helper, which
// retries up to `maxAttempts=2` with isRetryable checks matching the factory.

describe('send() — retry backoff behavior', () => {
  let svc, stores, log, messaging;

  beforeEach(() => {
    messaging = makePushClientStub();
    stores = makeStores();
    log = makeLogger();
    svc = createNotificationService({ stores, config: makeConfig(), log, pushClient: messaging });
  });

  it('pushClient.send is invoked at least once per device', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.ok(messaging.sendCalls.length >= 1);
  });

  it('retries on FCM_TIMEOUT (transient)', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextErrorQueue.push(new Error('FCM_TIMEOUT'));
    // Second attempt succeeds.
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 1);
    assert.equal(messaging.sendCalls.length, 2);
  });

  it('retries on code "messaging/server-unavailable"', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextErrorQueue.push(Object.assign(new Error('busy'), { code: 'messaging/server-unavailable' }));
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 1);
    assert.equal(messaging.sendCalls.length, 2);
  });

  it('does NOT retry 4xx-equivalent invalid-argument', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextErrorQueue.push(Object.assign(new Error('bad'), { code: 'messaging/invalid-argument' }));
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
    assert.equal(messaging.sendCalls.length, 1);
  });

  it('enqueues transient failure into retry queue', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    // Two identical transient errors so both withRetry attempts fail.
    messaging.nextErrorQueue.push(Object.assign(new Error('u'), { code: 'messaging/server-unavailable' }));
    messaging.nextErrorQueue.push(Object.assign(new Error('u'), { code: 'messaging/server-unavailable' }));
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.ok(svc.retryQueue.pending >= 1, 'retryQueue should hold one retry entry');
  });

  it('does NOT enqueue not-registered failures into retry queue', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextError = Object.assign(new Error('gone'), { code: 'messaging/registration-token-not-registered' });
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(svc.retryQueue.pending, 0);
  });

  it('retry queue has a shutdown() that clears pending entries', async () => {
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextErrorQueue.push(Object.assign(new Error('u'), { code: 'messaging/server-unavailable' }));
    messaging.nextErrorQueue.push(Object.assign(new Error('u'), { code: 'messaging/server-unavailable' }));
    await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(typeof svc.retryQueue.shutdown, 'function');
    svc.retryQueue.shutdown();
    assert.equal(svc.retryQueue.pending, 0);
  });
});

// ---------------------------------------------------------------------------
// sendToOfflineUsers — topic subs filtering, batch cap, DND filtering
// ---------------------------------------------------------------------------

describe('sendToOfflineUsers() — topic subscription + per-user filtering', () => {
  let svc, stores, log, messaging;

  beforeEach(() => {
    messaging = makePushClientStub();
    stores = makeStores();
    log = makeLogger();
    svc = createNotificationService({ stores, config: makeConfig(), log, pushClient: messaging });
  });

  afterEach(() => { unfreezeTime(); });

  it('returns sent=0 for invalid notification type', async () => {
    const r = await svc.sendToOfflineUsers({ festivalId: 'f1', type: 'bogus', title: 't', body: 'b' });
    assert.equal(r.sent, 0);
    assert.equal(r.reason, 'invalid_type');
  });

  it('excludes explicitly excluded users', async () => {
    stores._state.profiles = [
      { userId: 'u1', festivalId: 'f1' },
      { userId: 'u2', festivalId: 'f1' },
    ];
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    stores._state.tokens.set('u2', [{ token: 'y'.repeat(40), platform: 'ios' }]);
    await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
      excludeUserIds: ['u1'],
    });
    const batch = messaging.sendEachCalls[0];
    assert.equal(batch.length, 1);
    assert.ok(batch[0].token.startsWith('y'));
  });

  it('filters users unsubscribed from the topic', async () => {
    stores._state.profiles = [
      { userId: 'u1', festivalId: 'f1' },
      { userId: 'u2', festivalId: 'f1' },
    ];
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    stores._state.tokens.set('u2', [{ token: 'y'.repeat(40), platform: 'ios' }]);
    stores._state.topicUnsub.set('f1:crew', new Set(['u1']));
    await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
      topic: 'crew',
    });
    const batch = messaging.sendEachCalls[0];
    assert.equal(batch.length, 1);
    assert.ok(batch[0].token.startsWith('y'));
  });

  it('ignores unknown topic (VALID_TOPICS guard)', async () => {
    stores._state.profiles = [{ userId: 'u1', festivalId: 'f1' }];
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    stores._state.topicUnsub.set('f1:not-a-topic', new Set(['u1']));
    await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
      topic: 'not-a-topic',
    });
    const batch = messaging.sendEachCalls[0];
    assert.equal(batch.length, 1);
  });

  it('respects per-user prefs (scheduleChanges=false)', async () => {
    stores._state.profiles = [
      { userId: 'u1', festivalId: 'f1' },
      { userId: 'u2', festivalId: 'f1' },
    ];
    stores._state.prefs.set('u1', { scheduleChanges: false });
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    stores._state.tokens.set('u2', [{ token: 'y'.repeat(40), platform: 'ios' }]);
    await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'schedule_change', title: 't', body: 'b',
    });
    const batch = messaging.sendEachCalls[0];
    assert.equal(batch.length, 1);
    assert.ok(batch[0].token.startsWith('y'));
  });

  it('respects per-user DND (active window skips user entirely)', async () => {
    const d = new _realDate();
    d.setHours(23, 30, 0, 0);
    freezeTime(d.toISOString());
    stores._state.profiles = [
      { userId: 'u1', festivalId: 'f1' },
      { userId: 'u2', festivalId: 'f1' },
    ];
    stores._state.prefs.set('u1', { dndStart: '22:00', dndEnd: '08:00' });
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    stores._state.tokens.set('u2', [{ token: 'y'.repeat(40), platform: 'ios' }]);
    await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
    });
    const batch = messaging.sendEachCalls[0] || [];
    assert.equal(batch.length, 1);
    assert.ok(batch[0].token.startsWith('y'), 'only non-DND user should receive');
  });

  it('returns sent=0 when no target users remain after filtering', async () => {
    stores._state.profiles = [{ userId: 'u1', festivalId: 'f1' }];
    const r = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
      excludeUserIds: ['u1'],
    });
    assert.equal(r.sent, 0);
    assert.equal(messaging.sendEachCalls.length, 0);
  });

  it('returns sent=0 when all recipients have zero valid device tokens', async () => {
    stores._state.profiles = [{ userId: 'u1', festivalId: 'f1' }];
    stores._state.tokens.set('u1', [{ token: 'short', platform: 'ios' }]);
    const r = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
    });
    assert.equal(r.sent, 0);
  });

  it('caps batch at MAX_PUSH_BATCH (200) and warns', async () => {
    stores._state.profiles = [];
    for (let i = 0; i < 250; i++) {
      stores._state.profiles.push({ userId: `u${i}`, festivalId: 'f1' });
      stores._state.tokens.set(`u${i}`, [{ token: `t${i}`.padEnd(40, 'x'), platform: 'ios' }]);
    }
    await svc.sendToOfflineUsers({ festivalId: 'f1', type: 'crew_update', title: 't', body: 'b' });
    const warned = log._calls.warn.some((a) => /batch capped/.test(String(a[0])));
    assert.ok(warned);
    assert.ok(messaging.sendEachCalls[0].length <= 200);
  });

  it('packs into multiple FCM batches when exceeding FCM_BATCH_SIZE (500)', async () => {
    stores._state.profiles = [];
    for (let i = 0; i < 200; i++) {
      stores._state.profiles.push({ userId: `u${i}`, festivalId: 'f1' });
      stores._state.tokens.set(`u${i}`, [
        { token: `a${i}`.padEnd(40, 'x'), platform: 'ios' },
        { token: `b${i}`.padEnd(40, 'x'), platform: 'android' },
        { token: `c${i}`.padEnd(40, 'x'), platform: 'web' },
      ]);
    }
    await svc.sendToOfflineUsers({ festivalId: 'f1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(messaging.sendEachCalls.length, 2);
    assert.equal(messaging.sendEachCalls[0].length, 500);
    assert.equal(messaging.sendEachCalls[1].length, 100);
  });

  it('propagates batch-level sendEach failure as failureCount', async () => {
    stores._state.profiles = [{ userId: 'u1', festivalId: 'f1' }];
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextSendEachResponse = null;
    const origSendEach = messaging.sendEach;
    messaging.sendEach = async () => { throw new Error('batch-fail'); };
    try {
      const r = await svc.sendToOfflineUsers({
        festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
      });
      assert.equal(r.sent, 0);
    } finally {
      messaging.sendEach = origSendEach;
    }
  });

  it('collects stale tokens from per-message errors in sendEach response', async () => {
    stores._state.profiles = [
      { userId: 'u1', festivalId: 'f1' },
      { userId: 'u2', festivalId: 'f1' },
    ];
    stores._state.tokens.set('u1', [{ token: 'a'.repeat(40), platform: 'ios' }]);
    stores._state.tokens.set('u2', [{ token: 'b'.repeat(40), platform: 'ios' }]);
    messaging.nextSendEachResponse = {
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true, messageId: 'm1' },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    };
    const r = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
    });
    assert.equal(r.sent, 1);
    // Stale-token cleanup is deferred via setImmediate; wait a tick.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stores._state.unregistered.length, 1);
  });

  it('falls back to profiles.readAll when userIdsByFestival absent', async () => {
    const storesFallback = makeStores();
    delete storesFallback.profiles.userIdsByFestival;
    storesFallback._state.profiles = [
      { userId: 'u1', festivalId: 'f1' },
      { userId: 'u2', festivalId: 'f2' },
    ];
    storesFallback._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    const localMessaging = makePushClientStub();
    const svc2 = createNotificationService({
      stores: storesFallback, config: makeConfig(), log, pushClient: localMessaging,
    });
    await svc2.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 't', body: 'b',
    });
    const batch = localMessaging.sendEachCalls[0];
    assert.equal(batch.length, 1);
  });
});

// ---------------------------------------------------------------------------
// sendSilentSync — data-only push path
// ---------------------------------------------------------------------------

describe('sendSilentSync()', () => {
  let svc, stores, log, messaging;

  beforeEach(() => {
    messaging = makePushClientStub();
    stores = makeStores();
    log = makeLogger();
    svc = createNotificationService({ stores, config: makeConfig(), log, pushClient: messaging });
  });

  afterEach(() => { unfreezeTime(); });

  it('sends data-only message with content-available=1 for iOS background', async () => {
    stores._state.profiles = [{ userId: 'u1', festivalId: 'f1' }];
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.sendSilentSync({ festivalId: 'f1', syncType: 'crew_refresh' });
    const msg = messaging.sendCalls[0];
    assert.equal(msg.apns.payload.aps['content-available'], 1);
    assert.equal(msg.apns.headers['apns-push-type'], 'background');
    assert.equal(msg.data.type, 'silent_sync');
    assert.equal(msg.data.syncType, 'crew_refresh');
    assert.equal(msg.notification, undefined, 'silent sync must NOT include notification field');
  });

  it('bypasses DND (silent sync is not a user-visible notification)', async () => {
    const d = new _realDate();
    d.setHours(23, 30, 0, 0);
    freezeTime(d.toISOString());
    stores._state.profiles = [{ userId: 'u1', festivalId: 'f1' }];
    stores._state.prefs.set('u1', { dndStart: '22:00', dndEnd: '08:00' });
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    await svc.sendSilentSync({ festivalId: 'f1', syncType: 'poke' });
    assert.equal(messaging.sendCalls.length, 1);
  });

  it('unregisters token on not-registered error', async () => {
    stores._state.profiles = [{ userId: 'u1', festivalId: 'f1' }];
    stores._state.tokens.set('u1', [{ token: 'x'.repeat(40), platform: 'ios' }]);
    messaging.nextError = Object.assign(new Error('nope'), { code: 'messaging/registration-token-not-registered' });
    await svc.sendSilentSync({ festivalId: 'f1', syncType: 's' });
    assert.equal(stores._state.unregistered.length, 1);
  });

  it('caps silent-sync targets at MAX_PUSH_BATCH (200)', async () => {
    stores._state.profiles = [];
    for (let i = 0; i < 250; i++) {
      stores._state.profiles.push({ userId: `u${i}`, festivalId: 'f1' });
      stores._state.tokens.set(`u${i}`, [{ token: `t${i}`.padEnd(40, 'x'), platform: 'ios' }]);
    }
    await svc.sendSilentSync({ festivalId: 'f1', syncType: 's' });
    assert.ok(messaging.sendCalls.length <= 200);
  });
});

// ---------------------------------------------------------------------------
// markRead
// ---------------------------------------------------------------------------

describe('markRead()', () => {
  it('resets unread count for user+festival', async () => {
    const stores = makeStores();
    stores._state.counts.set('u1', [{ festivalId: 'f1', unreadUpdates: 5 }]);
    const svc = buildService({ stores });
    await svc.markRead('u1', 'f1');
    assert.equal(stores._state.counts.get('u1')[0].unreadUpdates, 0);
  });

  it('no-ops when notificationCounts store absent', async () => {
    const stores = makeStores();
    delete stores.notificationCounts;
    const svc = buildService({ stores });
    await svc.markRead('u1', 'f1'); // must not throw
  });
});

// ---------------------------------------------------------------------------
// Service-level surface sanity
// ---------------------------------------------------------------------------

describe('createNotificationService — service surface', () => {
  it('exposes { send, sendToOfflineUsers, sendSilentSync, markRead, retryQueue, isConfigured }', () => {
    const svc = buildService();
    assert.equal(typeof svc.send, 'function');
    assert.equal(typeof svc.sendToOfflineUsers, 'function');
    assert.equal(typeof svc.sendSilentSync, 'function');
    assert.equal(typeof svc.markRead, 'function');
    assert.equal(typeof svc.retryQueue, 'object');
    assert.equal(typeof svc.isConfigured, 'boolean');
  });

  it('isConfigured=true when pushClient is injected', () => {
    const svc = buildService();
    assert.equal(svc.isConfigured, true);
  });

  it('isConfigured=false when pushClient is null and FIREBASE_CREDENTIALS_PATH empty', () => {
    // Production path: no pushClient → initFirebase() returns null → isConfigured=false.
    const svc = createNotificationService({
      stores: makeStores(),
      config: makeConfig({ FIREBASE_CREDENTIALS_PATH: '' }),
      log: makeLogger(),
    });
    assert.equal(svc.isConfigured, false);
  });

  it('send() returns firebase_not_configured when pushClient absent and firebase disabled', async () => {
    const svc = createNotificationService({
      stores: makeStores(),
      config: makeConfig(),
      log: makeLogger(),
    });
    const r = await svc.send({ userId: 'u1', type: 'crew_update', title: 't', body: 'b' });
    assert.equal(r.reason, 'firebase_not_configured');
  });
});
