// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * liveLocation.ts — publish-throttle math shared by the web + mobile live-location
 * publishers. Keeping this in one place guarantees both platforms throttle GPS
 * publishes identically (and conservatively). Pure: no platform deps.
 */

import { haversineDistance } from './geo';
import { LIVE_LOCATION } from '../constants/config';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Decide whether a freshly-read GPS fix should be published to the crew.
 *
 * Returns true when EITHER:
 *   • this is the first fix (no prior coord / no last-sent time), OR
 *   • at least UPDATE_INTERVAL_MS has elapsed since the last publish, OR
 *   • the device has moved more than MIN_MOVE_METERS since the last publish.
 *
 * This keeps a stationary phone quiet (battery + data) while still relaying
 * meaningful movement promptly. `now` and `lastSentAt` are epoch ms.
 */
export function shouldPublishLocation(
  prev: LatLng | null | undefined,
  next: LatLng,
  lastSentAt: number | null | undefined,
  now: number,
): boolean {
  if (!prev || lastSentAt == null) return true;
  if (now - lastSentAt >= LIVE_LOCATION.UPDATE_INTERVAL_MS) return true;
  const moved = haversineDistance(
    { latitude: prev.lat, longitude: prev.lng },
    { latitude: next.lat, longitude: next.lng },
  );
  return Number.isFinite(moved) && moved > LIVE_LOCATION.MIN_MOVE_METERS;
}

/**
 * Whether a peer's last fix is "stale" — older than the freshness window but not
 * yet swept (peers are removed entirely past STALE_MS). Drives the Snap Map-style
 * desaturated avatar + "last seen N ago" chip vs the pulsing "live" treatment.
 *
 * `serverAt` is the authoritative server-receive time (epoch ms or ISO string).
 * An unknown/invalid timestamp is treated as fresh so we never spuriously grey
 * out a marker we can't age. `now` is epoch ms.
 */
export function isPeerStale(
  serverAt: string | number | null | undefined,
  now: number,
  freshMs: number = LIVE_LOCATION.FRESH_MS,
): boolean {
  let ms: number;
  if (typeof serverAt === 'number') ms = serverAt;
  else if (typeof serverAt === 'string') ms = new Date(serverAt).getTime();
  else return false;
  if (!Number.isFinite(ms)) return false;
  return now - ms > freshMs;
}

// ── Phase 4C presentation helpers (heading / battery / share-window) ──────────
// Pure formatters shared by the web CrewMap + mobile OfflineMap peer renderers so
// a peer's direction-of-travel, battery, and remaining share window read
// identically on every surface. All total/defensive: absent/invalid => null so a
// caller can simply skip the chip.

/** 8-wind arrow glyphs, indexed by 45° sector starting at North (0° = ↑). */
const HEADING_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const;

/**
 * Map a GPS course/heading (degrees clockwise from true north) to an 8-wind arrow
 * glyph for a direction-of-travel indicator. Returns null when heading is absent
 * or non-finite (a stationary fix often reports no heading) so callers render no
 * arrow rather than a misleading one.
 */
export function headingToArrow(heading: number | null | undefined): string | null {
  if (typeof heading !== 'number' || !Number.isFinite(heading)) return null;
  const norm = ((heading % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return HEADING_ARROWS[idx]!; // idx is always 0–7 (% 8); noUncheckedIndexedAccess can't see it
}

/** At/below this battery %, the label nudges the crew to regroup before a dead phone. */
export const LOW_BATTERY_THRESHOLD = 20;

/**
 * Format a peer's battery level (0–100) for the popup, e.g. "85%" or, when low,
 * "8% — regroup". Returns null for absent/invalid/out-of-range so the chip is
 * simply omitted. NOTE: until a native build adds expo-battery, `level` is always
 * undefined on mobile — see the TODO in useLiveLocationPublisher; web reads it
 * from the (non-standard) Battery API only when available.
 */
export function formatBatteryLabel(
  level: number | null | undefined,
  lowThreshold: number = LOW_BATTERY_THRESHOLD,
): string | null {
  if (typeof level !== 'number' || !Number.isFinite(level)) return null;
  const pct = Math.round(level);
  if (pct < 0 || pct > 100) return null;
  return pct <= lowThreshold ? `${pct}% — regroup` : `${pct}%`;
}

/**
 * Countdown for a time-boxed share, e.g. "sharing ends in 4m". `expiresAt` is the
 * ISO timestamp (or epoch ms) the share auto-stops. Returns null when there is no
 * window or it has already elapsed (the peer is swept regardless) so callers show
 * nothing. Always rounds UP to whole minutes (never "ends in 0m" while still live).
 */
export function formatShareWindow(
  expiresAt: string | number | null | undefined,
  now: number,
): string | null {
  if (expiresAt == null) return null;
  let ms: number;
  if (typeof expiresAt === 'number') ms = expiresAt;
  else if (typeof expiresAt === 'string') ms = new Date(expiresAt).getTime();
  else return null;
  if (!Number.isFinite(ms)) return null;
  const remaining = ms - now;
  if (remaining <= 0) return null;
  const mins = Math.max(1, Math.ceil(remaining / 60_000));
  return `sharing ends in ${mins}m`;
}
