'use strict';
/**
 * Cache management — user/festival in-memory caches + invalidation bus.
 *
 * Extracted from `lib/app-context/index.js`. These functions close over
 * the version counters (`_userDataVersion`, `_festivalDataVersion`) and
 * the data-access stores. The cache invalidation bus (Redis pub/sub) is
 * also wired here because its callbacks mutate the same counters.
 *
 * Data-access helpers (`getFestivals`, `getProfiles`, `getUsers`,
 * `getProfileById`, `getUserFestivalProfile`) are included because they
 * are the building blocks of the cache population logic and the map
 * lookups that consume it.
 */

const { createCacheInvalidationBus } = require('../redis');

const CACHE_TTL_MS = 60_000;

/**
 * Build cache helpers + data-access helpers bound to the supplied deps.
 * @param {object} args
 * @param {object} args.stores  - data-access stores (users, festivals, profiles)
 * @param {object} args.redis   - Redis client (may be null)
 * @param {object} args.log     - Pino logger
 * @returns {object} cache helpers, data-access helpers, cacheBus
 */
function createCacheHelpers({ stores, redis, log }) {
  // ── Version counters ───────────────────────────────────────────────
  let _userDataVersion = 0;
  let _festivalDataVersion = 0;

  // ── Cache invalidation bus ─────────────────────────────────────────
  let _festivalMapCache = null;

  const cacheBus = redis ? createCacheInvalidationBus(redis, {
    log,
    onInvalidateUsers() {
      _userDataVersion += 1;
      log.debug('cache-bus: user cache invalidated by peer worker');
    },
    onInvalidateFestivals() {
      _festivalDataVersion += 1;
      _festivalMapCache = null;
      log.debug('cache-bus: festival cache invalidated by peer worker');
    },
  }) : null;

  // ── Data access helpers ────────────────────────────────────────────
  async function getFestivals() {
    return (await stores.festivals.readAll()) || [];
  }

  async function getProfiles() {
    return (await stores.profiles.readAll()) || [];
  }

  async function getUsers() {
    return (await stores.users.readAll()) || [];
  }

  async function getProfileById(id) {
    if (stores.profiles.getById) return stores.profiles.getById(id);
    const profiles = await getProfiles();
    return profiles.find((profile) => profile.id === id) || null;
  }

  async function getUserFestivalProfile(userId, festivalId) {
    if (!userId || !festivalId) return null;
    if (stores.profiles.readByUserAndFestival) {
      const row = await stores.profiles.readByUserAndFestival(userId, festivalId);
      if (!row) return null;
      return stores.profiles.getById(row.id);
    }
    const profiles = await getProfiles();
    return profiles.find((profile) => profile.userId === userId && profile.festivalId === festivalId) || null;
  }

  // ── User cache ─────────────────────────────────────────────────────
  let _userMapCache = null;
  let _userMapCacheVersion = 0;
  let _userMapCacheAt = 0;

  async function getUserMap() {
    if (_userMapCache && (Date.now() - _userMapCacheAt > CACHE_TTL_MS)) {
      _userDataVersion += 1;
    }
    if (_userMapCache && _userMapCacheVersion === _userDataVersion) return _userMapCache;
    const users = await getUsers();
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _userMapCache = new Map(users.map((user) => [user.id, user]));
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _userMapCacheVersion = _userDataVersion;
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _userMapCacheAt = Date.now();
    return _userMapCache;
  }

  async function getUserById(userId) {
    const userMap = await getUserMap();
    return userMap.get(userId) || null;
  }

  function invalidateUserCache() {
    _userDataVersion += 1;
    if (cacheBus) cacheBus.publishUserInvalidation();
  }

  // ── Festival cache ─────────────────────────────────────────────────
  let _festivalMapCacheVersion = 0;
  let _festivalMapCacheAt = 0;

  async function getFestivalMap() {
    if (_festivalMapCache && (Date.now() - _festivalMapCacheAt > CACHE_TTL_MS)) {
      _festivalDataVersion += 1;
      _festivalMapCache = null;
    }
    if (_festivalMapCache && _festivalMapCacheVersion === _festivalDataVersion) return _festivalMapCache;
    const festivals = await getFestivals();
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _festivalMapCache = new Map(festivals.map((festival) => [festival.id, festival]));
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _festivalMapCacheVersion = _festivalDataVersion;
    // eslint-disable-next-line require-atomic-updates -- socket.data is not a shared race target
    _festivalMapCacheAt = Date.now();
    return _festivalMapCache;
  }

  async function getFestivalById(id) {
    const festivalMap = await getFestivalMap();
    return festivalMap.get(id) || null;
  }

  function invalidateFestivalCache() {
    _festivalDataVersion += 1;
    _festivalMapCache = null;
    if (cacheBus) cacheBus.publishFestivalInvalidation();
  }

  return {
    cacheBus,
    getUserMap,
    getUserById,
    invalidateUserCache,
    getFestivalMap,
    getFestivalById,
    invalidateFestivalCache,
    getFestivals,
    getProfiles,
    getUsers,
    getProfileById,
    getUserFestivalProfile,
  };
}

module.exports = { createCacheHelpers };
