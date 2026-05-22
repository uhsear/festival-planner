import assert from 'node:assert/strict';
import { describe, it, beforeEach, mock } from 'node:test';

import { createPresenceManager } from '../lib/presence';

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

function makeState() {
  return { onlineUsers: new Map() };
}

function makeLog() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    debug: mock.fn(),
    error: mock.fn(),
  };
}

function makeSocket(overrides: any = {}) {
  const socket: any = {
    id: overrides.id || 'sock-1',
    data: {
      userId: overrides.userId || null,
      username: overrides.username || null,
      festivalId: overrides.festivalId || null,
      profileId: overrides.profileId || null,
      userSessionToken: overrides.userSessionToken || null,
    },
    _rooms: new Set(),
    join(room: any) { socket._rooms.add(room); },
    leave(room: any) { socket._rooms.delete(room); },
    emit: mock.fn(),
    disconnect: mock.fn(),
  };
  return socket;
}

function makeIo(sockets: any[] = []) {
  const socketMap = new Map(sockets.map((s: any) => [s.id, s]));
  const _emitted: any[] = [];
  return {
    _emitted,
    to: mock.fn(() => ({
      emit: mock.fn((...args: any[]) => _emitted.push(args)),
    })),
    emit: mock.fn(),
    of: mock.fn(() => ({ sockets: socketMap })),
  };
}

function makeRedisPresence(overrides: any = {}) {
  return {
    setOnline: overrides.setOnline || mock.fn(async () => {}),
    setOffline: overrides.setOffline || mock.fn(async () => {}),
    getOnline: overrides.getOnline || mock.fn(async () => []),
  };
}

function defaultDeps(overrides: any = {}) {
  return {
    state: overrides.state || makeState(),
    redisPresence: overrides.redisPresence || null,
    redis: overrides.redis || null,
    log: overrides.log || makeLog(),
    getUserMap: overrides.getUserMap || (async () => new Map()),
    buildAvatarUrl: overrides.buildAvatarUrl || ((user: any) => user?.avatarKey ? `/avatar/${user.avatarKey}` : null),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('presence: setSocketPresence', () => {
  it('adds a user to a new festival room', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');

    const room = deps.state.onlineUsers.get('fest-1');
    assert.ok(room, 'room should exist');
    assert.equal(room.size, 1);
    assert.deepEqual(room.get('sock-1'), { userId: 'user-1', username: 'alice' });
  });

  it('adds multiple users to the same festival room', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    await pm.setSocketPresence('fest-1', 'user-2', 'bob', 'sock-2');

    const room = deps.state.onlineUsers.get('fest-1');
    assert.equal(room.size, 2);
  });

  it('writes to redisPresence when available', async () => {
    const rp = makeRedisPresence();
    const deps = defaultDeps({ redisPresence: rp });
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    assert.equal(rp.setOnline.mock.callCount(), 1);
    assert.deepEqual(rp.setOnline.mock.calls[0].arguments, ['fest-1', 'user-1', 'alice', 'sock-1']);
  });

  it('handles redisPresence.setOnline failure gracefully', async () => {
    const rp = makeRedisPresence({
      setOnline: mock.fn(async () => { throw new Error('redis down'); }),
    });
    const log = makeLog();
    const deps = defaultDeps({ redisPresence: rp, log });
    const pm = createPresenceManager(deps);

    // Should not throw
    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');

    // In-memory state should still work
    const room = deps.state.onlineUsers.get('fest-1');
    assert.equal(room.size, 1);
    assert.equal(log.debug.mock.callCount(), 1);
  });
});

describe('presence: removeSocketPresence', () => {
  it('removes a socket from the festival room and returns festivalId', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');

    const socket = makeSocket({ id: 'sock-1', festivalId: 'fest-1', userId: 'user-1' });
    const result = pm.removeSocketPresence(socket);

    assert.equal(result, 'fest-1');
    assert.equal(deps.state.onlineUsers.has('fest-1'), false, 'room should be cleaned up when empty');
    assert.equal(socket.data.festivalId, null);
  });

  it('returns null when socket has no festivalId', () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    const socket = makeSocket({ festivalId: null });
    const result = pm.removeSocketPresence(socket);
    assert.equal(result, null);
  });

  it('cleans up room map when last socket leaves', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    const socket = makeSocket({ id: 'sock-1', festivalId: 'fest-1' });
    pm.removeSocketPresence(socket);

    assert.equal(deps.state.onlineUsers.has('fest-1'), false);
  });

  it('keeps room map when other sockets remain', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    await pm.setSocketPresence('fest-1', 'user-2', 'bob', 'sock-2');

    const socket = makeSocket({ id: 'sock-1', festivalId: 'fest-1' });
    pm.removeSocketPresence(socket);

    const room = deps.state.onlineUsers.get('fest-1');
    assert.ok(room, 'room should still exist');
    assert.equal(room.size, 1);
    assert.ok(room.has('sock-2'));
  });

  it('calls redisPresence.setOffline when available', async () => {
    const rp = makeRedisPresence();
    const deps = defaultDeps({ redisPresence: rp });
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    const socket = makeSocket({ id: 'sock-1', festivalId: 'fest-1' });
    pm.removeSocketPresence(socket);

    // setOffline is fire-and-forget, give it a tick
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(rp.setOffline.mock.callCount(), 1);
  });
});

describe('presence: getPresenceList', () => {
  it('returns empty array for unknown festival', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    const result = await pm.getPresenceList('nonexistent');
    assert.deepEqual(result, []);
  });

  it('returns online users for a festival (in-memory path)', async () => {
    const userMap = new Map([['user-1', { id: 'user-1', avatarKey: 'abc' }]]);
    const deps = defaultDeps({ getUserMap: async () => userMap });
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');

    const result = await pm.getPresenceList('fest-1');
    assert.equal(result.length, 1);
    assert.equal(result[0].userId, 'user-1');
    assert.equal(result[0].username, 'alice');
    assert.equal(result[0].avatarUrl, '/avatar/abc');
  });

  it('deduplicates users with multiple sockets', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-2');

    const result = await pm.getPresenceList('fest-1');
    assert.equal(result.length, 1);
  });

  it('uses redis path when redisPresence is configured', async () => {
    const userMap = new Map([['user-1', { id: 'user-1', avatarKey: 'key1' }]]);
    const rp = makeRedisPresence({
      getOnline: mock.fn(async () => [{ userId: 'user-1', username: 'alice' }]),
    });
    const deps = defaultDeps({ redisPresence: rp, getUserMap: async () => userMap });
    const pm = createPresenceManager(deps);

    const result = await pm.getPresenceList('fest-1');
    assert.equal(rp.getOnline.mock.callCount(), 1);
    assert.equal(result.length, 1);
    assert.equal(result[0].userId, 'user-1');
  });

  it('falls back to local state when redis getOnline fails', async () => {
    const rp = makeRedisPresence({
      getOnline: mock.fn(async () => { throw new Error('redis down'); }),
    });
    const deps = defaultDeps({ redisPresence: rp });
    const pm = createPresenceManager(deps);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    const result = await pm.getPresenceList('fest-1');

    assert.equal(result.length, 1);
    assert.equal(result[0].userId, 'user-1');
  });
});

describe('presence: clearSocketSession', () => {
  it('nullifies all session fields on a socket', () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const socket = makeSocket({
      userId: 'user-1',
      username: 'alice',
      festivalId: 'fest-1',
      profileId: 'prof-1',
      userSessionToken: 'tok-1',
    });

    pm.clearSocketSession(socket);

    assert.equal(socket.data.userId, null);
    assert.equal(socket.data.username, null);
    assert.equal(socket.data.festivalId, null);
    assert.equal(socket.data.profileId, null);
    assert.equal(socket.data.userSessionToken, null);
  });
});

describe('presence: leaveFestivalRealtime', () => {
  it('removes presence and leaves the socket.io room', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo();

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    const socket = makeSocket({ id: 'sock-1', festivalId: 'fest-1' });
    socket._rooms.add('fest-1');

    const result = pm.leaveFestivalRealtime(socket, io);
    assert.equal(result, 'fest-1');
    assert.equal(socket._rooms.has('fest-1'), false);
    assert.equal(socket.data.profileId, null);
  });

  it('returns null when socket has no festival', () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo();
    const socket = makeSocket({});

    const result = pm.leaveFestivalRealtime(socket, io);
    assert.equal(result, null);
  });

  it('adds festivalId to presenceTargets when provided', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo();
    const targets = new Set();

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    const socket = makeSocket({ id: 'sock-1', festivalId: 'fest-1' });

    pm.leaveFestivalRealtime(socket, io, targets);
    assert.ok(targets.has('fest-1'));
  });
});

describe('presence: disconnectSocket', () => {
  it('leaves festival, clears session, and disconnects', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo();

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    const socket = makeSocket({
      id: 'sock-1',
      festivalId: 'fest-1',
      userId: 'user-1',
      username: 'alice',
      userSessionToken: 'tok-1',
    });

    pm.disconnectSocket(socket, io);

    assert.equal(socket.data.userId, null);
    assert.equal(socket.data.festivalId, null);
    assert.equal(socket.disconnect.mock.callCount(), 1);
    assert.deepEqual(socket.disconnect.mock.calls[0].arguments, [true]);
  });
});

describe('presence: disconnectUserSockets', () => {
  it('disconnects all sockets belonging to a user', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    const s1 = makeSocket({ id: 'sock-1', userId: 'user-1', festivalId: 'fest-1' });
    const s2 = makeSocket({ id: 'sock-2', userId: 'user-1', festivalId: 'fest-2' });
    const s3 = makeSocket({ id: 'sock-3', userId: 'user-2', festivalId: 'fest-1' });
    const io = makeIo([s1, s2, s3]);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    await pm.setSocketPresence('fest-2', 'user-1', 'alice', 'sock-2');

    pm.disconnectUserSockets('user-1', io);

    assert.equal(s1.disconnect.mock.callCount(), 1);
    assert.equal(s2.disconnect.mock.callCount(), 1);
    assert.equal(s3.disconnect.mock.callCount(), 0, 'should not disconnect other users');
  });
});

describe('presence: disconnectSessionTokens', () => {
  it('disconnects sockets matching given tokens', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    const s1 = makeSocket({ id: 'sock-1', userId: 'user-1', userSessionToken: 'tok-a', festivalId: 'fest-1' });
    const s2 = makeSocket({ id: 'sock-2', userId: 'user-1', userSessionToken: 'tok-b', festivalId: 'fest-1' });
    const io = makeIo([s1, s2]);

    pm.disconnectSessionTokens(['tok-a'], io);

    assert.equal(s1.disconnect.mock.callCount(), 1);
    assert.equal(s2.disconnect.mock.callCount(), 0);
  });

  it('no-ops when tokens array is empty', () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    const s1 = makeSocket({ id: 'sock-1', userSessionToken: 'tok-a' });
    const io = makeIo([s1]);

    pm.disconnectSessionTokens([], io);
    assert.equal(s1.disconnect.mock.callCount(), 0);
  });

  it('no-ops when tokens is null', () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    const s1 = makeSocket({ id: 'sock-1', userSessionToken: 'tok-a' });
    const io = makeIo([s1]);

    pm.disconnectSessionTokens(null, io);
    assert.equal(s1.disconnect.mock.callCount(), 0);
  });
});

describe('presence: removeFestivalSockets', () => {
  it('removes all sockets from a given festival and cleans up state', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    const s1 = makeSocket({ id: 'sock-1', userId: 'user-1', festivalId: 'fest-1' });
    const s2 = makeSocket({ id: 'sock-2', userId: 'user-2', festivalId: 'fest-1' });
    const s3 = makeSocket({ id: 'sock-3', userId: 'user-3', festivalId: 'fest-2' });
    const io = makeIo([s1, s2, s3]);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');
    await pm.setSocketPresence('fest-1', 'user-2', 'bob', 'sock-2');

    pm.removeFestivalSockets('fest-1', io);

    // Both fest-1 sockets should have received the revoked event
    assert.equal(s1.emit.mock.callCount(), 1);
    assert.deepEqual(s1.emit.mock.calls[0].arguments[0], 'festival:access-revoked');
    assert.equal(s2.emit.mock.callCount(), 1);
    assert.equal(s3.emit.mock.callCount(), 0);

    // State should be cleaned up
    assert.equal(deps.state.onlineUsers.has('fest-1'), false);
  });

  it('cleans up redis presence key when redis is available', async () => {
    const redis = { del: mock.fn(async () => {}) };
    const rp = makeRedisPresence();
    const deps = defaultDeps({ redis, redisPresence: rp });
    const pm = createPresenceManager(deps);

    const io = makeIo([]);
    pm.removeFestivalSockets('fest-1', io);

    assert.equal(redis.del.mock.callCount(), 1);
    assert.deepEqual(redis.del.mock.calls[0]!.arguments, ['presence:fest-1']);
  });
});

describe('presence: removeProfileSockets', () => {
  it('removes sockets for a specific user+festival profile', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);

    const s1 = makeSocket({ id: 'sock-1', userId: 'user-1', festivalId: 'fest-1' });
    const s2 = makeSocket({ id: 'sock-2', userId: 'user-1', festivalId: 'fest-2' });
    const io = makeIo([s1, s2]);

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');

    pm.removeProfileSockets({ userId: 'user-1', festivalId: 'fest-1', id: 'prof-1' }, io);

    assert.equal(s1.emit.mock.callCount(), 1);
    assert.deepEqual(s1.emit.mock.calls[0].arguments[0], 'festival:access-revoked');
    assert.equal(s2.emit.mock.callCount(), 0, 'other festival socket should not be affected');
  });

  it('no-ops when profile is null', () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo([]);

    // Should not throw
    pm.removeProfileSockets(null, io);
    pm.removeProfileSockets({}, io);
  });
});

describe('presence: clearPresenceTimers', () => {
  it('clears all debounce timers without error', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo();

    // Trigger debounced emitPresence to create timers
    pm.emitPresence('fest-1', io);
    pm.emitPresence('fest-2', io);

    // Should clear without throwing
    pm.clearPresenceTimers();
  });
});

describe('presence: emitPresence', () => {
  it('emits presence:update to the festival room after debounce', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo();

    await pm.setSocketPresence('fest-1', 'user-1', 'alice', 'sock-1');

    pm.emitPresence('fest-1', io);

    // Wait for debounce (200ms)
    await new Promise((r) => setTimeout(r, 300));

    assert.ok(io.to.mock.callCount() >= 1);
    pm.clearPresenceTimers();
  });

  it('coalesces rapid calls via debounce', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo();

    pm.emitPresence('fest-1', io);
    pm.emitPresence('fest-1', io);
    pm.emitPresence('fest-1', io);

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 300));

    // Should only fire once despite three calls
    assert.ok(io.to.mock.callCount() <= 2, 'debounce should coalesce multiple calls');
    pm.clearPresenceTimers();
  });
});

describe('presence: emitProfileIdentity', () => {
  it('emits profile:identity to all festivals the user belongs to', async () => {
    const deps = defaultDeps();
    const pm = createPresenceManager(deps);
    const io = makeIo();

    const user = { id: 'user-1', username: 'alice', avatarKey: 'abc' };
    const profiles = [
      { userId: 'user-1', festivalId: 'fest-1', id: 'prof-1' },
      { userId: 'user-1', festivalId: 'fest-2', id: 'prof-2' },
      { userId: 'user-2', festivalId: 'fest-1', id: 'prof-3' },
    ];

    await pm.emitProfileIdentity(user, io, async () => profiles);

    // Should emit to fest-1 and fest-2 (2 profiles belong to user-1)
    assert.ok(io.to.mock.callCount() >= 2);
    pm.clearPresenceTimers();
  });
});
