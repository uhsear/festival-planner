// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * geo.ts — pure lat/lng math shared by web + mobile (F3 / M5).
 *
 * Powers last-synced ETA and (later) the proximity compass. No platform deps —
 * works identically on web and React Native. The ETA + staleness helpers here
 * exist to support the M5 "on my way / ETA to [meeting point]" feature, which is
 * an offline-DEGRADED-SYNCS snapshot, NOT live GPS. `formatStaleness` is the
 * honest "as of N ago" copy the UI must show — never "live".
 */

/** A latitude/longitude pair in decimal degrees. */
export interface Coord {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_371_000; // mean Earth radius in metres

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** True only when both fields are finite numbers (guards null coords / NaN). */
function isValidCoord(c: Coord | null | undefined): c is Coord {
  return (
    !!c &&
    typeof c.latitude === 'number' &&
    typeof c.longitude === 'number' &&
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude)
  );
}

/**
 * Great-circle distance between two coords in METRES (haversine). Returns NaN if
 * either coord is invalid so callers can branch instead of rendering a bogus 0.
 */
export function haversineDistance(from: Coord | null | undefined, to: Coord | null | undefined): number {
  if (!isValidCoord(from) || !isValidCoord(to)) return NaN;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Initial bearing FROM → TO in degrees clockwise from true north [0, 360).
 * Returns NaN for invalid coords. Used by the (later) proximity compass.
 */
export function bearing(from: Coord | null | undefined, to: Coord | null | undefined): number {
  if (!isValidCoord(from) || !isValidCoord(to)) return NaN;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/**
 * Average walking speed used to turn distance into an ETA. Festival crowds are
 * slow + non-direct; 1.25 m/s (~4.5 km/h) is a deliberately conservative
 * pedestrian pace so the ETA reads as a floor, not an over-promise.
 */
const WALK_SPEED_M_PER_S = 1.25;

/**
 * Rough ETA in whole MINUTES to walk from one coord to another, via straight-line
 * distance ÷ a conservative walking speed. Returns null when either coord is
 * missing/invalid (no target coord → no computed ETA; the member's self-reported
 * etaMinutes is used instead). Always rounds UP and clamps to a minimum of 1
 * minute when the two points differ, so a non-zero distance never shows "0 min".
 *
 * NOTE: this is a coarse estimate for a degraded-sync snapshot — it is NOT a
 * live routed ETA and must never be presented as real-time.
 */
export function etaMinutes(from: Coord | null | undefined, to: Coord | null | undefined): number | null {
  const meters = haversineDistance(from, to);
  if (!Number.isFinite(meters)) return null;
  if (meters <= 0) return 0;
  const minutes = meters / WALK_SPEED_M_PER_S / 60;
  return Math.max(1, Math.ceil(minutes));
}

/**
 * Arrow rotation (degrees, clockwise) for a proximity compass: how far to spin
 * an UP-pointing arrow so it points at the target, given the target's true
 * bearing from the viewer and the device's current heading (both degrees CW
 * from true north). When deviceHeading is 0 (north-up / no compass), the arrow
 * just shows the absolute bearing. Result is normalized to [0, 360); returns
 * NaN if the bearing is not finite so callers can show a "no fix" state.
 *
 * This is pure presentation math — the M5 compass is on-device + offline; it
 * derives direction from a SAVED coord, never a live remote position.
 */
export function relativeArrowAngle(bearingDeg: number, deviceHeadingDeg: number): number {
  if (!Number.isFinite(bearingDeg)) return NaN;
  const heading = Number.isFinite(deviceHeadingDeg) ? deviceHeadingDeg : 0;
  return (((bearingDeg - heading) % 360) + 360) % 360;
}

/**
 * Human-readable distance label from metres. Sub-1 km reads in metres rounded
 * to the nearest 10 (e.g. "120 m"); ≥1 km reads in kilometres to one decimal
 * (e.g. "1.4 km"). Returns "—" for NaN/invalid so the compass never prints a
 * bogus "0 m" when coords are missing.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) {
    const rounded = Math.max(0, Math.round(meters / 10) * 10);
    return `${rounded} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/* ------------------------------------------------------------------------- *
 * Pursuit compass (Phase 2A) — metre-first helpers layered on the primitives
 * above. These power the "head this way to your crew/meeting point" compass:
 * a live bearing + distance + 8-point heading + walking ETA. All pure, all
 * NaN/empty-safe. They REUSE haversineDistance/bearing rather than re-deriving
 * the trig so web + mobile share one implementation.
 * ------------------------------------------------------------------------- */

/**
 * Great-circle distance in METRES — metre-first alias of `haversineDistance`
 * for the pursuit API. Same semantics (NaN for invalid coords).
 */
export function haversineMeters(a: Coord | null | undefined, b: Coord | null | undefined): number {
  return haversineDistance(a, b);
}

/**
 * Initial bearing a→b in degrees CW from true north [0, 360) — alias of
 * `bearing` for the pursuit API. NaN for invalid coords.
 */
export function initialBearingDeg(a: Coord | null | undefined, b: Coord | null | undefined): number {
  return bearing(a, b);
}

/** The eight principal compass points, clockwise from north. */
export type Compass8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

const COMPASS_8: readonly Compass8[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Snap a bearing (degrees CW from north) to the nearest of the 8 principal
 * compass points. Each sector spans 45°; north owns [337.5°, 22.5°). Negative
 * or >360 inputs are normalised first. Returns null for a non-finite bearing
 * (no fix) so the UI can show a "locating…" state instead of a bogus arrow.
 */
export function compass8(bearingDeg: number): Compass8 | null {
  if (!Number.isFinite(bearingDeg)) return null;
  const norm = ((bearingDeg % 360) + 360) % 360;
  const index = Math.round(norm / 45) % 8;
  return COMPASS_8[index] ?? 'N';
}

/**
 * Average walking pace (m/s) for festival-floor pursuit ETAs. 1.3 m/s
 * (~4.7 km/h) is a brisk-but-realistic walking default; callers can override
 * (e.g. a denser crowd → slower) via the second arg.
 */
export const DEFAULT_WALK_M_PER_S = 1.3;

/**
 * Walking ETA in whole MINUTES for a straight-line distance in metres, at
 * `mPerSec` (default 1.3). Returns null for a non-finite/negative distance.
 * 0 m → 0 min; any positive distance rounds UP and clamps to ≥1 min so a few
 * metres never reads "0 min". A non-positive speed is treated as the default
 * so a caller passing 0 can't divide by zero.
 *
 * NOTE: coarse straight-line estimate, NOT a routed ETA — never present as
 * real-time turn-by-turn.
 */
export function etaWalkMinutes(meters: number, mPerSec: number = DEFAULT_WALK_M_PER_S): number | null {
  if (!Number.isFinite(meters) || meters < 0) return null;
  if (meters === 0) return 0;
  const speed = Number.isFinite(mPerSec) && mPerSec > 0 ? mPerSec : DEFAULT_WALK_M_PER_S;
  return Math.max(1, Math.ceil(meters / speed / 60));
}

/**
 * Human ETA label from a minutes count (e.g. from `etaWalkMinutes`). null →
 * "—" (no fix); 0 → "now"; <60 → "N min"; else "Hh Mm" / "Hh". This is a
 * floor-style estimate label, never a live promise.
 */
export function formatEta(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—';
  const m = Math.round(minutes);
  if (m === 0) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/** A point carrying geo coords — the minimum `nearestPin` needs (a MapPin satisfies this). */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Result of `nearestPin`: the closest candidate and its distance in metres. */
export interface NearestPin<T> {
  pin: T;
  distanceM: number;
}

/**
 * Closest pin to `from` among `pins`, optionally filtered by `predicate`.
 * Skips candidates with invalid coords (haversine NaN). Returns null when
 * `from` is invalid, the list is empty, or nothing passes the predicate /
 * has a finite distance. Generic over any `{latitude, longitude}` shape so a
 * MapPin (meeting-point/stage/amenity/peer) works directly without importing
 * the union here (keeps geo.ts a dependency-free leaf module).
 */
export function nearestPin<T extends GeoPoint>(
  from: Coord | null | undefined,
  pins: readonly T[] | null | undefined,
  predicate?: (pin: T) => boolean,
): NearestPin<T> | null {
  if (!isValidCoord(from) || !Array.isArray(pins) || pins.length === 0) return null;
  let best: NearestPin<T> | null = null;
  for (const pin of pins) {
    if (!pin) continue;
    if (predicate && !predicate(pin)) continue;
    const distanceM = haversineDistance(from, { latitude: pin.latitude, longitude: pin.longitude });
    if (!Number.isFinite(distanceM)) continue;
    if (best === null || distanceM < best.distanceM) best = { pin, distanceM };
  }
  return best;
}

/**
 * A computed pursuit toward a target: how far, which way, and roughly how long
 * to walk. Distances/labels degrade gracefully ("—") when self or target lacks
 * a fix; `compass` is null when there's no usable bearing.
 */
export interface Pursuit {
  /** Initial bearing self→target, degrees CW from north [0,360), or NaN if no fix. */
  bearingDeg: number;
  /** Straight-line distance in metres, or NaN if no fix. */
  distanceM: number;
  /** Human distance label, e.g. "210 m" / "1.3 km", or "—". */
  distanceLabel: string;
  /** 8-point compass heading, or null if no bearing. */
  compass: Compass8 | null;
  /** Walking ETA label, e.g. "4 min", or "—". */
  etaLabel: string;
}

/**
 * Build the pursuit bundle from `self` → `target` in one call: bearing,
 * distance, distance label, 8-point compass, and walking ETA label. Pure and
 * total — invalid/missing coords yield NaN distance/bearing, "—" labels, and a
 * null compass so the UI can render a graceful "locating…" state.
 */
export function buildPursuit(self: Coord | null | undefined, target: Coord | null | undefined): Pursuit {
  const distanceM = haversineDistance(self, target);
  const bearingDeg = bearing(self, target);
  const etaLabel = formatEta(etaWalkMinutes(distanceM));
  return {
    bearingDeg,
    distanceM,
    distanceLabel: formatDistance(distanceM),
    compass: compass8(bearingDeg),
    etaLabel,
  };
}

/**
 * Honest "as of N ago" staleness label for a last-synced status. Accepts an
 * epoch-ms number OR an ISO/parseable date string (the backend serializes
 * `updated_at` as a timestamp string). This is the M5 cardinal-rule copy: it
 * frames the status as a past snapshot, never as a live position.
 *
 * Buckets mirror `timeAgo`: <45s → "as of just now", <60m → "as of Nm ago",
 * <24h → "as of Nh ago", else "as of Nd ago". A missing/invalid/ future
 * timestamp collapses to "as of just now" so the UI never shows "-3m ago".
 */
export function formatStaleness(updatedAt: number | string | null | undefined): string {
  let ms: number;
  if (typeof updatedAt === 'number') {
    ms = updatedAt;
  } else if (typeof updatedAt === 'string') {
    ms = new Date(updatedAt).getTime();
  } else {
    ms = NaN;
  }
  if (!Number.isFinite(ms)) return 'as of just now';
  const diff = Date.now() - ms;
  if (diff < 0 || !Number.isFinite(diff)) return 'as of just now';
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'as of just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `as of ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `as of ${h}h ago`;
  return `as of ${Math.floor(h / 24)}d ago`;
}
