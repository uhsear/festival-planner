// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// basemapCache — mobile-LOCAL helper that downloads a festival's offline PMTiles
// vector basemap to the app cache ONCE (idempotent) so the in-WebView map can
// read it from a local `file://` with zero network on subsequent opens.
//
// PRIME DIRECTIVE — ADDITIVE + GRACEFUL FALLBACK: this is a pure optimization on
// top of Phase 3A. If the download fails (offline first run, bad URL, disk full)
// the caller keeps pointing the WebView at the REMOTE https URL — exactly the
// Phase 3A behaviour (pmtiles HTTP range + WebView/CDN cache). Nothing here can
// regress the online path or the no-basemap path.
//
// Mobile import rule: imports ONLY this package's own dep `expo-file-system`. No
// React, no WebView, no @festie/shared transitive deps — keep it unit-testable.

import { File, Directory, Paths } from 'expo-file-system';

// All cached basemaps live under a single subdir of the OS cache directory so
// (a) they're co-located + easy to scope `allowingReadAccessToURL` to, and (b)
// the OS may evict them under storage pressure (cache, not document) — on the
// next open we simply re-download. Mirrors the AccountDataSection cache usage.
const CACHE_SUBDIR = 'festie-basemaps';

/**
 * Deterministic, filesystem-safe filename for a given https PMTiles URL. We hash
 * the URL to a short hex token (no collisions in practice for one festival's one
 * archive) + keep the `.pmtiles` extension. NOT crypto — just a stable cache key,
 * so a tiny FNV-1a is plenty and avoids pulling a crypto dep into the RN bundle.
 */
export function basemapCacheKey(pmtilesUrl: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < pmtilesUrl.length; i++) {
    h ^= pmtilesUrl.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 → unsigned; pad so the name is stable-length.
  return `${(h >>> 0).toString(16).padStart(8, '0')}.pmtiles`;
}

/** The Directory under which all cached basemaps are stored. */
export function basemapCacheDir(): Directory {
  return new Directory(Paths.cache, CACHE_SUBDIR);
}

/**
 * The local File handle a given URL WOULD cache to (whether or not it exists yet).
 * Exposed for the caller's `allowingReadAccessToURL` scoping + tests.
 */
export function basemapCacheFile(pmtilesUrl: string): File {
  return new File(basemapCacheDir(), basemapCacheKey(pmtilesUrl));
}

/**
 * Info about a festival's LOCALLY cached archive, read from the filesystem on
 * every call. Readiness is DERIVED, never remembered: `Paths.cache` is
 * OS-evictable, so a persisted "downloaded" flag would keep claiming the map
 * works long after the OS reclaimed the bytes.
 *
 * A zero-byte file counts as NOT cached — see `ensureBasemapCached`.
 */
export function basemapCacheInfo(pmtilesUrl: string | null | undefined): {
  cached: boolean;
  bytes: number;
  syncedAt: number | null;
} {
  if (!pmtilesUrl) return { cached: false, bytes: 0, syncedAt: null };
  try {
    const file = basemapCacheFile(pmtilesUrl);
    if (!file.exists || file.size <= 0) return { cached: false, bytes: 0, syncedAt: null };
    return { cached: true, bytes: file.size, syncedAt: file.lastModified };
  } catch {
    return { cached: false, bytes: 0, syncedAt: null };
  }
}

/**
 * Expected byte length from a HEAD, or null when the server does not say.
 * Truncation is the failure this guards: expo-file-system documents that a
 * stream dying mid-transfer can leave a short file behind, and a short .pmtiles
 * cached forever silently breaks the map. Reading the archive back to inspect it
 * would pull the whole thing into memory, so compare lengths instead.
 */
async function expectedBytes(pmtilesUrl: string): Promise<number | null> {
  try {
    const res = await fetch(pmtilesUrl, { method: 'HEAD' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    return Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    // Offline or a server that refuses HEAD — fall back to the size>0 gate.
    return null;
  }
}

// Unique per attempt so two concurrent transfers never share a staging path.
let attemptCounter = 0;
function attemptToken(): string {
  attemptCounter += 1;
  return `${attemptCounter}`;
}

// One in-flight download per URL. Both callers (map open, Download button) await
// the same promise instead of racing two transfers for the same archive.
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Ensure the festival's PMTiles archive is cached locally; return the local
 * `file://` URI. Idempotent: if a COMPLETE file already exists we return it
 * WITHOUT re-downloading. On ANY failure we return `null` so the caller keeps
 * the remote https URL (graceful fallback — Phase 3A online range-fetch path,
 * unchanged).
 *
 * DOWNLOAD-TO-`.part`-THEN-RENAME: expo-file-system documents that on Android
 * "the response body streams directly into the target file. If the download
 * fails after it starts, a partially written file may remain at the
 * destination." A truncated .pmtiles at the cache path would then be served
 * forever as a cache hit and silently break the map. Staging the transfer and
 * renaming only after it resolves keeps a failed attempt away from that path.
 *
 * What the rename gate actually proves, stated precisely: the transfer resolved,
 * the staged file is non-empty, and its length matches the Content-Length a HEAD
 * reported. That catches the truncation the docs warn about. When the server
 * refuses HEAD or omits the length we fall back to size>0 and the archive is
 * therefore NOT proven complete; `clearBasemapCache` is the escape hatch.
 *
 * Concurrent callers are de-duplicated in-process (OfflineMap opens the map while
 * the readiness card can press Download), because two transfers staging to one
 * path would interleave and rename each other's bytes.
 *
 * Only call this for an already-validated https URL (the schema + `hasOfflineBasemap`
 * guarantee https upstream); we re-assert https here as belt-and-braces so a
 * non-https URL can never reach `downloadFileAsync`.
 */
export function ensureBasemapCached(pmtilesUrl: string): Promise<string | null> {
  if (typeof pmtilesUrl !== 'string' || !/^https:\/\//i.test(pmtilesUrl)) return Promise.resolve(null);
  const existing = inFlight.get(pmtilesUrl);
  if (existing) return existing;
  const run = downloadOnce(pmtilesUrl).finally(() => inFlight.delete(pmtilesUrl));
  inFlight.set(pmtilesUrl, run);
  return run;
}

async function downloadOnce(pmtilesUrl: string): Promise<string | null> {
  try {
    const dir = basemapCacheDir();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

    const name = basemapCacheKey(pmtilesUrl);
    const file = basemapCacheFile(pmtilesUrl);
    // Idempotent: a prior open already downloaded it → reuse the local copy. A
    // zero-byte file is not a copy; drop it and fetch again.
    if (file.exists) {
      if (file.size > 0) return file.uri;
      file.delete();
    }

    // Stage under a name unique to this attempt. A shared `<key>.part` would let
    // a second caller delete and re-stage under the first one's feet, so the
    // first rename could publish the second's half-written bytes.
    const part = new File(dir, `${name}.${attemptToken()}.part`);
    if (part.exists) part.delete();
    const expected = await expectedBytes(pmtilesUrl);
    let published = false;
    try {
      await File.downloadFileAsync(pmtilesUrl, part, { idempotent: true });
      const short = expected !== null && part.exists && part.size !== expected;
      if (!part.exists || part.size <= 0 || short) return null;
      part.rename(name);
      published = true;
      return part.uri;
    } finally {
      // The staging name is unique per attempt, so nothing later reuses or
      // overwrites it — a failed transfer would orphan the file forever unless
      // it is removed here. Skip once renamed: `part` then POINTS AT the
      // published archive, so deleting would remove the thing we just cached.
      if (!published) {
        try {
          if (part.exists) part.delete();
        } catch {
          // Best effort; an undeletable staged file is not worth failing over.
        }
      }
    }
  } catch {
    // Disk full / offline / bad response / cancelled — caller falls back to the
    // remote URL, and no partial file is left at the cache path.
    return null;
  }
}

/**
 * Best-effort delete of a single festival's cached archive (e.g. to force a
 * refresh). Never throws. Returns true if a file was removed.
 */
export function clearBasemapCache(pmtilesUrl: string): boolean {
  try {
    const file = basemapCacheFile(pmtilesUrl);
    if (file.exists) {
      file.delete();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}
