import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCacheHelpers } from '../lib/app-context/cache.js';

// ─── Mock Stores ─────────────────────────────────────────────────────────────

function makeStores(data: any = {}) {
  const users = data.users || [
    { id: 'u1', username: 'Alice' },
    { id: 'u2', username: 'Bob' },
  ];
  const festivals = data.festivals || [
    { id: 'f1', name: 'Bonnaroo' },
    { id: 'f2', name: 'Coachella' },
  ];
  const profiles = data.profiles || [
    { id: 'p1', userId: 'u1', festivalId: 'f1' },
    { id: 'p2', userId: 'u2', festivalId: 'f1' },
  ];

  return {
    users: {
      readAll: async () => [...users],
    },
    festivals: {
      readAll: async () => [...festivals],
    },
    profiles: {
      readAll: async () => [...profiles],
      getById: async (id: string) => profiles.find((p: any) => p.id === id) || null,
      readByUserAndFestival: async (userId: string, festivalId: string) =>
        profiles.find((p: any) => p.userId === userId && p.festivalId === festivalId) || null,
    },
  };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

// ─── Data access helpers ─────────────────────────────────────────────────────

describe('cache: data access helpers', () => {
  it('getFestivals returns festivals from store', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const festivals = await cache.getFestivals();
    assert.equal(festivals.length, 2);
    assert.equal(festivals[0].name, 'Bonnaroo');
  });

  it('getUsers returns users from store', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const users = await cache.getUsers();
    assert.equal(users.length, 2);
  });

  it('getProfiles returns profiles from store', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profiles = await cache.getProfiles();
    assert.equal(profiles.length, 2);
  });

  it('getProfileById returns a specific profile', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getProfileById('p1');
    assert.equal(profile.userId, 'u1');
  });

  it('getProfileById returns null for missing id', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getProfileById('missing');
    assert.equal(profile, null);
  });

  it('getUserFestivalProfile returns profile for user+festival pair', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile('u1', 'f1');
    assert.equal(profile.id, 'p1');
  });

  it('getUserFestivalProfile returns null for missing pair', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile('u1', 'f999');
    assert.equal(profile, null);
  });

  it('getUserFestivalProfile returns null for null userId', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile(null, 'f1');
    assert.equal(profile, null);
  });

  it('getUserFestivalProfile returns null for null festivalId', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile('u1', null);
    assert.equal(profile, null);
  });
});

// ─── User cache ──────────────────────────────────────────────────────────────

describe('cache: user cache', () => {
  it('getUserMap returns a Map keyed by userId', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const map = await cache.getUserMap();
    assert.ok(map instanceof Map);
    assert.equal(map.size, 2);
    assert.equal(map.get('u1').username, 'Alice');
  });

  it('getUserById returns a user by ID', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const user = await cache.getUserById('u2');
    assert.equal(user.username, 'Bob');
  });

  it('getUserById returns null for unknown ID', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const user = await cache.getUserById('unknown');
    assert.equal(user, null);
  });

  it('invalidateUserCache causes next getUserMap to re-fetch', async () => {
    let fetchCount = 0;
    const stores = makeStores();
    const origReadAll = stores.users.readAll;
    stores.users.readAll = async () => { fetchCount++; return origReadAll(); };
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    await cache.getUserMap();
    assert.equal(fetchCount, 1);
    cache.invalidateUserCache();
    await cache.getUserMap();
    assert.equal(fetchCount, 2);
  });
});

// ─── Festival cache ──────────────────────────────────────────────────────────

describe('cache: festival cache', () => {
  it('getFestivalMap returns a Map keyed by festivalId', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const map = await cache.getFestivalMap();
    assert.ok(map instanceof Map);
    assert.equal(map.size, 2);
    assert.equal(map.get('f1').name, 'Bonnaroo');
  });

  it('getFestivalById returns a festival by ID', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const festival = await cache.getFestivalById('f2');
    assert.equal(festival.name, 'Coachella');
  });

  it('getFestivalById returns null for unknown ID', async () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    const festival = await cache.getFestivalById('unknown');
    assert.equal(festival, null);
  });

  it('invalidateFestivalCache causes next getFestivalMap to re-fetch', async () => {
    let fetchCount = 0;
    const stores = makeStores();
    const origReadAll = stores.festivals.readAll;
    stores.festivals.readAll = async () => { fetchCount++; return origReadAll(); };
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    await cache.getFestivalMap();
    assert.equal(fetchCount, 1);
    cache.invalidateFestivalCache();
    await cache.getFestivalMap();
    assert.equal(fetchCount, 2);
  });
});

// ─── cacheBus ────────────────────────────────────────────────────────────────

describe('cache: cacheBus', () => {
  it('cacheBus is null when redis is null', () => {
    const cache = createCacheHelpers({ stores: makeStores(), redis: null, log: noopLog });
    assert.equal(cache.cacheBus, null);
  });
});

// ─── getUserFestivalProfile fallback path (no readByUserAndFestival) ────────

describe('cache: getUserFestivalProfile fallback', () => {
  it('falls back to scanning all profiles when store lacks readByUserAndFestival', async () => {
    const stores = makeStores();
    delete (stores.profiles as any).readByUserAndFestival;
    delete (stores.profiles as any).getById;
    const cache = createCacheHelpers({ stores, redis: null, log: noopLog });
    const profile = await cache.getUserFestivalProfile('u1', 'f1');
    assert.equal(profile.id, 'p1');
  });
});
