// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Unit tests for the Phase 3C live-location late-joiner snapshot cache
 * (lib/live-location-cache.ts).
 *
 * Focus is the PURE `assembleSnapshot` policy — the privacy/staleness filter
 * that turns raw Redis-hash entries into the `location:sync` ack payload:
 *   - parses JSON (or accepts pre-parsed objects) and drops malformed entries
 *   - drops entries missing required fields (userId / crewId / serverAt / lat,lng)
 *   - excludes the requester's own entry (selfUserId)
 *   - drops stale fixes (serverAt older than freshMs) so a lingering, un-HDEL'd
 *     field is never served as if live
 *   - emits only whitelisted fields (no extra cache key leaks through)
 *
 * Plus a write→read round-trip + fail-open behavior against a fake Redis.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assembleSnapshot,
  writeLivePosition,
  dropLivePosition,
  readLiveSnapshot,
} from '../lib/live-location-cache.js';

const NOW = Date.parse('2026-06-25T18:00:00.000Z');

/** A well-formed cached peer-update payload, freshly stamped relative to NOW. */
function freshPayload(over: Record<string, unknown> = {}) {
  return {
    _v: 1,
    crewId: 'crew-1',
    userId: 'user-a',
    username: 'Alice',
    lat: 41.8781,
    lng: -87.6298,
    accuracy: 8,
    capturedAt: new Date(NOW - 1000).toISOString(),
    serverAt: new Date(NOW - 1000).toISOString(),
    ...over,
  };
}

/** Build the raw {userId,value} entries as readLiveSnapshot would from HGETALL. */
function entriesFrom(...payloads: Record<string, any>[]) {
  return payloads.map((p) => ({ userId: String(p.userId), value: JSON.stringify(p) }));
}

/** Minimal fake ioredis with a real backing hash store + chainable pipeline. */
function fakeRedis() {
  const store = new Map<string, Record<string, string>>();
  const api: any = {
    _store: store,
    _throw: false,
    async hset(key: string, field: string, val: string) {
      if (api._throw) throw new Error('redis down');
      if (!store.has(key)) store.set(key, {});
      store.get(key)![field] = val;
      return 1;
    },
    async hdel(key: string, field: string) {
      if (api._throw) throw new Error('redis down');
      if (store.has(key)) delete store.get(key)![field];
      return 1;
    },
    async hgetall(key: string) {
      if (api._throw) throw new Error('redis down');
      return store.has(key) ? { ...store.get(key)! } : {};
    },
    async pexpire() {
      if (api._throw) throw new Error('redis down');
      return 1;
    },
    pipeline() {
      const ops: Array<() => Promise<unknown>> = [];
      const chain: any = {
        hset: (...a: [string, string, string]) => {
          ops.push(() => api.hset(...a));
          return chain;
        },
        pexpire: (...a: [string, number]) => {
          ops.push(() => api.pexpire(...a));
          return chain;
        },
        async exec() {
          const out: Array<[null, unknown]> = [];
          for (const op of ops) out.push([null, await op()]);
          return out;
        },
      };
      return chain;
    },
  };
  return api;
}

describe('live-location-cache — assembleSnapshot (pure)', () => {
  it('returns well-formed peers with only whitelisted fields', () => {
    const peers = assembleSnapshot(entriesFrom(freshPayload({ heading: 90, speed: 1.2 })), { now: NOW });
    assert.equal(peers.length, 1);
    const p = peers[0]!;
    assert.deepEqual(Object.keys(p).sort(), [
      '_v',
      'accuracy',
      'capturedAt',
      'crewId',
      'heading',
      'lat',
      'lng',
      'serverAt',
      'speed',
      'userId',
      'username',
    ]);
    assert.equal(p.userId, 'user-a');
    assert.equal(p.lat, 41.8781);
    assert.equal(p._v, 1);
  });

  it('excludes the requester (selfUserId)', () => {
    const peers = assembleSnapshot(entriesFrom(freshPayload({ userId: 'me' }), freshPayload({ userId: 'other' })), {
      now: NOW,
      selfUserId: 'me',
    });
    assert.deepEqual(
      peers.map((p) => p.userId),
      ['other'],
    );
  });

  it('drops stale fixes older than freshMs', () => {
    const stale = freshPayload({ userId: 'old', serverAt: new Date(NOW - 200_000).toISOString() });
    const fresh = freshPayload({ userId: 'new' });
    const peers = assembleSnapshot(entriesFrom(stale, fresh), { now: NOW });
    assert.deepEqual(
      peers.map((p) => p.userId),
      ['new'],
    );
  });

  it('honors a custom freshMs window', () => {
    const p = freshPayload({ serverAt: new Date(NOW - 20_000).toISOString() });
    assert.equal(assembleSnapshot(entriesFrom(p), { now: NOW, freshMs: 30_000 }).length, 1);
    assert.equal(assembleSnapshot(entriesFrom(p), { now: NOW, freshMs: 10_000 }).length, 0);
  });

  it('drops malformed JSON and non-object values', () => {
    const entries = [
      { userId: 'bad', value: '{not json' },
      { userId: 'nul', value: null },
      { userId: 'num', value: '42' },
      ...entriesFrom(freshPayload({ userId: 'ok' })),
    ];
    const peers = assembleSnapshot(entries, { now: NOW });
    assert.deepEqual(
      peers.map((p) => p.userId),
      ['ok'],
    );
  });

  it('drops entries missing required fields (lat/lng, crewId, serverAt)', () => {
    const noLat = freshPayload({ userId: 'no-lat' }) as any;
    delete noLat.lat;
    const badLng = freshPayload({ userId: 'bad-lng', lng: 'x' });
    const noCrew = freshPayload({ userId: 'no-crew', crewId: '' });
    const noServerAt = freshPayload({ userId: 'no-srv', serverAt: '' });
    const peers = assembleSnapshot(entriesFrom(noLat, badLng, noCrew, noServerAt, freshPayload({ userId: 'good' })), {
      now: NOW,
    });
    assert.deepEqual(
      peers.map((p) => p.userId),
      ['good'],
    );
  });

  it('treats an unparseable serverAt as stale (dropped)', () => {
    const peers = assembleSnapshot(entriesFrom(freshPayload({ serverAt: 'not-a-date' })), { now: NOW });
    assert.equal(peers.length, 0);
  });

  it('falls back to the hash field key when payload.userId is absent', () => {
    const p = freshPayload() as any;
    delete p.userId;
    const peers = assembleSnapshot([{ userId: 'field-key', value: JSON.stringify(p) }], { now: NOW });
    assert.equal(peers.length, 1);
    assert.equal(peers[0]!.userId, 'field-key');
  });

  it('drops non-finite optional numbers rather than emitting NaN', () => {
    const peers = assembleSnapshot(entriesFrom(freshPayload({ accuracy: 'huge', heading: null })), { now: NOW });
    assert.equal(peers[0]!.accuracy, undefined);
    assert.equal(peers[0]!.heading, undefined);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(assembleSnapshot([], { now: NOW }), []);
  });
});

describe('live-location-cache — Redis round-trip + fail-open', () => {
  it('write → read returns the cached peer (excluding self)', async () => {
    const redis = fakeRedis();
    await writeLivePosition(redis, 'crew-1', freshPayload({ userId: 'alice' }) as any);
    await writeLivePosition(redis, 'crew-1', freshPayload({ userId: 'bob', username: 'Bob' }) as any);

    const peers = await readLiveSnapshot(redis, 'crew-1', { now: NOW, selfUserId: 'alice' });
    assert.deepEqual(
      peers.map((p) => p.userId).sort(),
      ['bob'],
    );
    assert.equal(peers[0]!.username, 'Bob');
  });

  it('dropLivePosition removes a sharer from a later snapshot', async () => {
    const redis = fakeRedis();
    await writeLivePosition(redis, 'crew-1', freshPayload({ userId: 'alice' }) as any);
    await dropLivePosition(redis, 'crew-1', 'alice');
    const peers = await readLiveSnapshot(redis, 'crew-1', { now: NOW });
    assert.deepEqual(peers, []);
  });

  it('fails open to [] when Redis throws', async () => {
    const redis = fakeRedis();
    redis._throw = true;
    const peers = await readLiveSnapshot(redis, 'crew-1', { now: NOW });
    assert.deepEqual(peers, []);
  });

  it('write is a no-op (no throw) when redis is null or payload lacks userId', async () => {
    await writeLivePosition(null, 'crew-1', freshPayload() as any);
    const redis = fakeRedis();
    await writeLivePosition(redis, 'crew-1', { crewId: 'crew-1' } as any);
    assert.deepEqual(await readLiveSnapshot(redis, 'crew-1', { now: NOW }), []);
  });

  it('readLiveSnapshot returns [] when redis is null (fail-open)', async () => {
    assert.deepEqual(await readLiveSnapshot(null, 'crew-1', { now: NOW }), []);
  });
});
