/**
 * Cache helpers — extracted from app-context.js
 * User/festival/profile caching with TTL-based invalidation.
 */
'use strict';

function createCacheHelpers({ stores, pool: _pool, log: _log, config: _config }) {
  let _userMapCache = null;
  let _userMapCacheTime = 0;
  let _festivalMapCache = null;
  let _festivalMapCacheTime = 0;
  const CACHE_TTL = 10_000; // 10 seconds

  async function getUserMap() {
    const now = Date.now();
    if (_userMapCache && (now - _userMapCacheTime) < CACHE_TTL) return _userMapCache;
    const rows = await stores.users.listAll();
    const map = new Map();
    for (const u of rows) map.set(u.id, u);
    _userMapCache = map; // eslint-disable-line require-atomic-updates
    _userMapCacheTime = now; // eslint-disable-line require-atomic-updates
    return map;
  }

  async function getUserById(userId) {
    const map = await getUserMap();
    return map.get(userId) || null;
  }

  function invalidateUserCache() {
    _userMapCache = null;
    _userMapCacheTime = 0;
  }

  async function getFestivalMap() {
    const now = Date.now();
    if (_festivalMapCache && (now - _festivalMapCacheTime) < CACHE_TTL) return _festivalMapCache;
    const rows = await stores.festivals.listAll();
    const map = new Map();
    for (const f of rows) map.set(f.id, f);
    _festivalMapCache = map; // eslint-disable-line require-atomic-updates
    _festivalMapCacheTime = now; // eslint-disable-line require-atomic-updates
    return map;
  }

  async function getFestivalById(id) {
    const map = await getFestivalMap();
    return map.get(id) || null;
  }

  function invalidateFestivalCache() {
    _festivalMapCache = null;
    _festivalMapCacheTime = 0;
  }

  async function getFestivals() { return stores.festivals.listAll(); }
  async function getProfiles() { return stores.profiles.listAll(); }
  async function getUsers() { return stores.users.listAll(); }
  async function getProfileById(id) { return stores.profiles.getById(id); }

  async function getUserFestivalProfile(userId, festivalId) {
    return stores.profiles.getByUserAndFestival(userId, festivalId);
  }

  return {
    getUserMap, getUserById, invalidateUserCache,
    getFestivalMap, getFestivalById, invalidateFestivalCache,
    getFestivals, getProfiles, getUsers,
    getProfileById, getUserFestivalProfile,
  };
}

module.exports = { createCacheHelpers };
