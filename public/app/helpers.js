/**
 * Pure utility functions shared across views
 * No dependencies on state (S) — these are stateless helpers
 */

export function getIdentityHash(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash);
}

const _colorCache = new Map();
export function getAvatarColor(name) {
  if (_colorCache.has(name)) {
    const v = _colorCache.get(name);
    _colorCache.delete(name);
    _colorCache.set(name, v);
    return v;
  }
  const hash = getIdentityHash(name);
  const hue = hash % 360;
  const saturation = 62 + (hash % 12);
  const lightness = 46 + (hash % 10);
  const color = `hsl(${hue} ${saturation}% ${lightness}%)`;
  _colorCache.set(name, color);
  if (_colorCache.size > 200)
    _colorCache.delete(_colorCache.keys().next().value);
  return color;
}

const _initialsCache = new Map();
export function getInitials(name) {
  if (_initialsCache.has(name)) {
    const v = _initialsCache.get(name);
    _initialsCache.delete(name);
    _initialsCache.set(name, v);
    return v;
  }
  const result = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  _initialsCache.set(name, result);
  if (_initialsCache.size > 200)
    _initialsCache.delete(_initialsCache.keys().next().value);
  return result;
}

export function normalizeIdentityName(name) {
  const value = String(name || '').trim();
  return value || 'User';
}

export function formatTime(t) {
  if (!t) return '';
  const [hh, mm] = t.split(':');
  let hr = parseInt(hh);
  const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${mm} ${ap}`;
}

export function timeToMinutes(t) {
  if (!t) return 0;
  const [hh, mm] = t.split(':').map(Number);
  return hh * 60 + mm;
}

/**
 * Derive display name from artists array. Falls back to set.artist for backward compat.
 * @param {Object} set - Set object with artists[] and/or artist string
 * @param {string} separator - B2B separator (default: 'b2b')
 * @returns {string}
 */
export function artistDisplayName(set, separator) {
  const sep = separator || 'b2b';
  const joined = set.artists?.length
    ? set.artists.map((a) => a.name).join(` ${sep} `)
    : '';
  // If set.artist is an explicit group/primary name that differs from the
  // joined members, prefer it as the display title (e.g. "The Masquerade").
  if (set.artist && (!joined || set.artist !== joined)) return set.artist;
  if (joined) return joined;
  return set.artist || 'Unknown';
}

/**
 * Returns the member-list subtitle for a collective / group set.
 * Empty string when the set is a solo artist, a simple b2b where artist==joined,
 * or has no artists array. Use alongside artistDisplayName to render a
 * two-line card label: title = group name, subtitle = members.
 */
export function artistSubtitle(set, separator) {
  if (!set.artists || set.artists.length < 2) return '';
  const sep = separator || 'b2b';
  const joined = set.artists.map((a) => a.name).join(` ${sep} `);
  if (!set.artist || set.artist === joined) return '';
  return joined;
}

/**
 * Get the link platforms map for a set. Returns { spotify: url, instagram: url, ... }
 * For solo artists returns flat map. For B2B returns array of { name, links }.
 */
export function getSetLinks(set) {
  if (!set.artists?.length) {
    return set.linkUrl ? [{ name: set.artist || 'Unknown', links: { spotify: set.linkUrl } }] : [];
  }
  return set.artists.filter((a) => a.links && Object.keys(a.links).length > 0);
}

// Memoize hotness scores — invalidate once per second to avoid recalculating
// hundreds of sets on every Festival Mode 60s refresh
let _hotnessCache = new Map();
let _hotnessCacheSecond = -1;
export function getSetHotness(set) {
  if (!set.date || !set.startTime) return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec !== _hotnessCacheSecond) { _hotnessCache = new Map(); _hotnessCacheSecond = nowSec; }
  const cacheKey = set.id || (set.date + set.startTime);
  if (_hotnessCache.has(cacheKey)) return _hotnessCache.get(cacheKey);
  const now = nowSec * 1000;
  const dayDate = new Date(set.date);
  if (isNaN(dayDate)) return 0;
  const [hh, mm] = (set.startTime || '00:00').split(':').map(Number);
  dayDate.setHours(hh, mm, 0, 0);
  const setStart = dayDate.getTime();
  const [eh, em] = (set.endTime || set.startTime).split(':').map(Number);
  const endDate = new Date(set.date);
  endDate.setHours(eh, em, 0, 0);
  if (endDate <= dayDate) endDate.setDate(endDate.getDate() + 1);
  const setEnd = endDate.getTime();
  if (now >= setStart && now < setEnd) { _hotnessCache.set(cacheKey, 1000); return 1000; }
  const minsUntil = (setStart - now) / 60000;
  if (minsUntil > 0 && minsUntil < 720) { const v = 500 * Math.exp(-minsUntil / 120); _hotnessCache.set(cacheKey, v); return v; }
  const minsAgo = (now - setEnd) / 60000;
  if (minsAgo > 0 && minsAgo < 120) { const v = 100 * Math.exp(-minsAgo / 30); _hotnessCache.set(cacheKey, v); return v; }
  _hotnessCache.set(cacheKey, 0); return 0;
}
