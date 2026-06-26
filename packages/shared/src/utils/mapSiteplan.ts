// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * mapSiteplan.ts — pure georeferenced site-plan extraction + authoring for the
 * festival map (Phase 4B, shared web + mobile).
 *
 * A festival map-config MAY carry `siteplan`: the organizer's paper site-plan
 * image, georeferenced by FOUR corner coordinates, drawn as a translucent raster
 * UNDER the pins + zones so the official map underlays Festie's basemap. The
 * *selection* of a renderable site-plan (https image URL, four finite in-range
 * corners, a clamped opacity) and the *authoring* transforms (build / set /
 * remove on a config) are plain business logic, so they live here (not
 * duplicated per-app) and are unit-testable without any map/DOM/WebView dep.
 *
 * IMAGE HOSTING: like crew photo albums + the festival image + the offline
 * basemap, Festie does NOT host arbitrary uploads — `imageUrl` is an https URL
 * the admin provides (matching `siteplanSchema.imageUrl`, which the backend
 * comment notes "mirrors crewPhotoAlbumSchema"). https-only keeps the renderer
 * safe from javascript:/data: schemes.
 *
 * COORDINATE ORDER: corners are stored GeoJSON [lng, lat] in TL, TR, BR, BL
 * order (the MapLibre `image` source's `coordinates` order). That order is
 * preserved verbatim in `corners`. The authoring builder accepts tapped
 * {latitude, longitude} corners (geo.ts order) and converts at THIS boundary so
 * the stored config stays GeoJSON-correct.
 *
 * ADDITIVE + GRACEFUL: a festival with no `siteplan` (or an invalid one) yields
 * null and the map renders exactly as before — no raster layer is added.
 */

import type { FestivalMapConfig } from '../types/domain';

/** The stored site-plan shape (matches `siteplanSchema` / domain `siteplan`). */
export type SiteplanConfig = NonNullable<FestivalMapConfig['siteplan']>;

/** Default overlay opacity for a freshly-authored site plan (semi-transparent). */
export const SITEPLAN_DEFAULT_OPACITY = 0.6;

/**
 * Human labels for the four corners, in the stored/MapLibre order. The admin
 * editor taps them in this order (top-left, top-right, bottom-right,
 * bottom-left) — the same order a MapLibre `image` source expects.
 */
export const SITEPLAN_CORNER_LABELS = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'] as const;

/** Number of georeferencing corners a site plan needs. */
export const SITEPLAN_CORNER_COUNT = 4;

/** A site plan ready to render: https image URL, four [lng,lat] corners, opacity. */
export interface MapSiteplan {
  /** https image URL (validated). */
  imageUrl: string;
  /** Four corner positions in GeoJSON [lng, lat] order: TL, TR, BR, BL. */
  corners: [number, number][];
  /** Raster opacity in [0, 1]. */
  opacity: number;
}

/** True for an https:// URL no longer than the schema's 2048-char cap. */
export function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && /^https:\/\//i.test(value);
}

/** True only for a finite number in [min, max]. */
function inRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

/** True for a finite, in-range [lng, lat] GeoJSON position. */
function isValidLngLat(c: unknown): c is [number, number] {
  return Array.isArray(c) && c.length >= 2 && inRange(c[0], -180, 180) && inRange(c[1], -90, 90);
}

/** Clamp an opacity into [0, 1]; non-finite falls back to the default. */
export function clampOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SITEPLAN_DEFAULT_OPACITY;
  return Math.min(1, Math.max(0, value));
}

/**
 * Project a festival map-config's `siteplan` into a renderable struct. Requires
 * a valid https `imageUrl`, at least four finite in-range [lng, lat] corners
 * (the first four are used, in stored order), and a clamped opacity. Anything
 * invalid (or absent) → null, so the map adds no raster layer.
 */
export function extractSiteplan(mapConfig: FestivalMapConfig | null | undefined): MapSiteplan | null {
  const sp = mapConfig?.siteplan;
  if (!sp || !isHttpsUrl(sp.imageUrl)) return null;
  const rawCorners = sp.corners;
  if (!Array.isArray(rawCorners) || rawCorners.length < SITEPLAN_CORNER_COUNT) return null;
  const corners: [number, number][] = [];
  for (const c of rawCorners) {
    if (isValidLngLat(c)) corners.push([c[0], c[1]]);
    if (corners.length === SITEPLAN_CORNER_COUNT) break;
  }
  if (corners.length < SITEPLAN_CORNER_COUNT) return null;
  return { imageUrl: sp.imageUrl, corners, opacity: clampOpacity(sp.opacity) };
}

/** True when a config carries a renderable site plan. */
export function hasSiteplan(mapConfig: FestivalMapConfig | null | undefined): boolean {
  return extractSiteplan(mapConfig) != null;
}

/** A render-ready MapLibre `image` source descriptor, or null when absent. */
export interface SiteplanImageSource {
  /** Image URL handed to the `image` source. */
  url: string;
  /** Four [lng, lat] corners in MapLibre order (TL, TR, BR, BL). */
  coordinates: [number, number][];
  /** Raster opacity in [0, 1]. */
  opacity: number;
}

/**
 * Build a MapLibre `image`-source descriptor from a site plan. The `coordinates`
 * are the stored corners verbatim (already in MapLibre's TL/TR/BR/BL order).
 * Null in → null out so the renderer adds nothing.
 */
export function siteplanImageSource(siteplan: MapSiteplan | null | undefined): SiteplanImageSource | null {
  if (!siteplan) return null;
  return { url: siteplan.imageUrl, coordinates: siteplan.corners, opacity: siteplan.opacity };
}

// ── Authoring (Phase 4B) ─────────────────────────────────────────────────────
//
// The admin editor lets a festival admin paste an https image URL, tap the four
// ground corners of that image (TL, TR, BR, BL), and pick an opacity, then
// persists it into `map_config.siteplan` via the SAME PUT /admin/festivals/:id
// write path (alongside stages + amenities + zones). The transforms — building a
// validated siteplan from tapped {latitude, longitude} corners and
// setting/removing it on a config — are pure business logic and live here so
// web + mobile stay in parity. Coordinates convert at THIS boundary: callers
// pass {latitude, longitude}; the stored config is GeoJSON [lng, lat].

/**
 * Build a validated `SiteplanConfig` from an https image URL, four tapped
 * corners ({latitude, longitude} in TL/TR/BR/BL order, converted to GeoJSON
 * [lng, lat]), and an opacity. Out-of-range corners are dropped; returns null
 * unless an https URL AND at least four valid corners remain (the first four are
 * used). The opacity is clamped to [0, 1] (default when omitted). Pure: never
 * mutates inputs.
 */
export function buildSiteplan(
  imageUrl: string,
  corners: Array<{ latitude: number; longitude: number }>,
  opacity: number = SITEPLAN_DEFAULT_OPACITY,
): SiteplanConfig | null {
  if (!isHttpsUrl(imageUrl) || !Array.isArray(corners)) return null;
  const pts: [number, number][] = [];
  for (const c of corners) {
    if (c && inRange(c.longitude, -180, 180) && inRange(c.latitude, -90, 90)) {
      pts.push([c.longitude, c.latitude]);
    }
    if (pts.length === SITEPLAN_CORNER_COUNT) break;
  }
  if (pts.length < SITEPLAN_CORNER_COUNT) return null;
  return {
    imageUrl,
    // Length is guaranteed === SITEPLAN_CORNER_COUNT (4) by the guard above;
    // noUncheckedIndexedAccess can't narrow indexed access, so assert non-null.
    corners: [pts[0]!, pts[1]!, pts[2]!, pts[3]!],
    opacity: clampOpacity(opacity),
  };
}

/**
 * Return a new FestivalMapConfig with its `siteplan` REPLACED by `siteplan`, or
 * the key removed when `siteplan` is null. If the prior config is null/absent, a
 * fresh `version: 1` config is created. Existing amenities/zones/center/bounds/
 * offlineBasemap are preserved untouched. Pure: never mutates the input.
 */
export function setSiteplan(
  config: FestivalMapConfig | null | undefined,
  siteplan: SiteplanConfig | null,
): FestivalMapConfig {
  const base: FestivalMapConfig = config ? { ...config } : { version: 1 };
  base.version = 1;
  if (siteplan) {
    base.siteplan = siteplan;
  } else {
    delete base.siteplan;
  }
  return base;
}

/**
 * Return a new FestivalMapConfig with the site plan removed. No-op-safe (an
 * absent siteplan stays absent). Pure: never mutates the input.
 */
export function removeSiteplan(config: FestivalMapConfig | null | undefined): FestivalMapConfig {
  return setSiteplan(config, null);
}
