// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * lastSynced.ts — pure "last-synced" labelling for offline-honest surfaces.
 *
 * Festivals = no signal, so every cached surface (crew, schedule) must tell the
 * user how fresh the data is and whether it's usable offline. This composes the
 * existing `timeAgo` bucketing into a single honest line the surfaces render
 * from a cache timestamp.
 *
 * Pure + platform-agnostic (no window/document/node): `Date.now()` behaves the
 * same on web and React Native. Keep it side-effect free so both consumers wire
 * their own re-render tick (the value advances from the device clock even with
 * no network — the cardinal offline-honesty requirement).
 */

import { timeAgo } from './timeAgo';

/** A surface that has never been cached has no honest claim to make. */
export type LastSyncedLabel = 'offline-ready';

/**
 * Honest "Updated Xm ago" label from an **epoch-ms** cache timestamp.
 *
 * - `null`/`undefined`/non-finite timestamp → `null` (caller renders nothing —
 *   no timestamp, no claim).
 * - otherwise → `"Updated <timeAgo>"` (e.g. "Updated 4m ago", "Updated just now").
 *
 * For the offline badge, pair with `offlineReadyLabel` (below) once data is
 * cached; consumers typically show "Updated 4m ago · offline-ready" when the
 * device is offline but the surface was cached at least once.
 */
export function formatLastSynced(cachedAt: number | null | undefined): string | null {
  if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) return null;
  return `Updated ${timeAgo(cachedAt)}`;
}

/**
 * The "offline-ready" affordance: returns `'offline-ready'` once the surface has
 * been cached at least once (a real `cachedAt`), else `null`. Lets a surface
 * render "Updated 4m ago · offline-ready" — the cached data is safe to use with
 * no signal. Kept separate from `formatLastSynced` so callers compose the two
 * (online: just the time; offline-but-cached: time + offline-ready).
 */
export function offlineReadyLabel(cachedAt: number | null | undefined): LastSyncedLabel | null {
  if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) return null;
  return 'offline-ready';
}
