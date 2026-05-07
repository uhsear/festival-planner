import { FestivalSet, Artist } from '../types/domain';

export function formatTime(t: string | undefined): string {
  if (!t) return '';
  const [hh = '0', mm = '00'] = t.split(':');
  let hr = parseInt(hh, 10);
  const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${mm} ${ap}`;
}

export function timeToMinutes(t: string | undefined): number {
  if (!t) return 0;
  const [hh = 0, mm = 0] = t.split(':').map((x) => parseInt(x, 10));
  return hh * 60 + mm;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function artistDisplayName(set: FestivalSet, separator?: string): string {
  const sep = separator || 'b2b';
  const joined = set.artists?.length
    ? set.artists.map((a) => a.name).join(` ${sep} `)
    : '';

  if (set.artist && (!joined || set.artist !== joined)) return set.artist;
  if (joined) return joined;
  return set.artist || 'Unknown';
}

export function artistSubtitle(set: FestivalSet, separator?: string): string {
  if (!set.artists || set.artists.length < 2) return '';
  const sep = separator || 'b2b';
  const joined = set.artists.map((a) => a.name).join(` ${sep} `);
  if (!set.artist || set.artist === joined) return '';
  return joined;
}

export function getSetLinks(
  set: FestivalSet,
): Array<{ name: string; links: Record<string, string> }> {
  if (!set.artists?.length) {
    return set.linkUrl ? [{ name: set.artist || 'Unknown', links: { spotify: set.linkUrl } }] : [];
  }
  return set.artists.filter((a) => a.links && Object.keys(a.links).length > 0) as Array<{
    name: string;
    links: Record<string, string>;
  }>;
}

const _hotnessCache = new Map<string, number>();
let _hotnessCacheSecond = -1;

export function getSetHotness(set: FestivalSet): number {
  if (!set.date || !set.startTime) return 0;

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec !== _hotnessCacheSecond) {
    _hotnessCache.clear();
    _hotnessCacheSecond = nowSec;
  }

  const cacheKey = set.id || `${set.date}${set.startTime}`;
  if (_hotnessCache.has(cacheKey)) return _hotnessCache.get(cacheKey) || 0;

  const now = nowSec * 1000;
  const dayDate = new Date(set.date);
  if (isNaN(dayDate.getTime())) return 0;

  const [hh = 0, mm = 0] = (set.startTime || '00:00').split(':').map((x) => parseInt(x, 10));
  dayDate.setHours(hh, mm, 0, 0);
  const setStart = dayDate.getTime();

  const [eh = 0, em = 0] = (set.endTime || set.startTime).split(':').map((x) => parseInt(x, 10));
  const endDate = new Date(set.date);
  endDate.setHours(eh, em, 0, 0);
  if (endDate <= dayDate) endDate.setDate(endDate.getDate() + 1);
  const setEnd = endDate.getTime();

  if (now >= setStart && now < setEnd) {
    _hotnessCache.set(cacheKey, 1000);
    return 1000;
  }

  const minsUntil = (setStart - now) / 60000;
  if (minsUntil > 0 && minsUntil < 720) {
    const v = 500 * Math.exp(-minsUntil / 120);
    _hotnessCache.set(cacheKey, v);
    return v;
  }

  const minsAgo = (now - setEnd) / 60000;
  if (minsAgo > 0 && minsAgo < 120) {
    const v = 100 * Math.exp(-minsAgo / 30);
    _hotnessCache.set(cacheKey, v);
    return v;
  }

  _hotnessCache.set(cacheKey, 0);
  return 0;
}
