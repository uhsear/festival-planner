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
 * Ensure the festival's PMTiles archive is cached locally; return the local
 * `file://` URI. Idempotent: if the file already exists we return it WITHOUT
 * re-downloading. On ANY failure we return `null` so the caller keeps the remote
 * https URL (graceful fallback — Phase 3A online range-fetch path, unchanged).
 *
 * Only call this for an already-validated https URL (the schema + `hasOfflineBasemap`
 * guarantee https upstream); we re-assert https here as belt-and-braces so a
 * non-https URL can never reach `downloadFileAsync`.
 */
export async function ensureBasemapCached(pmtilesUrl: string): Promise<string | null> {
  if (typeof pmtilesUrl !== 'string' || !/^https:\/\//i.test(pmtilesUrl)) return null;
  try {
    const dir = basemapCacheDir();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

    const file = basemapCacheFile(pmtilesUrl);
    // Idempotent: a prior open already downloaded it → reuse the local copy.
    if (file.exists) return file.uri;

    // Download once. downloadFileAsync writes to the destination File and returns
    // a File handle whose `.uri` is the local file:// path.
    const downloaded = await File.downloadFileAsync(pmtilesUrl, file);
    return downloaded?.uri ?? (file.exists ? file.uri : null);
  } catch {
    // Disk full / offline / bad response — caller falls back to the remote URL.
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
