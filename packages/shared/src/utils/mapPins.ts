// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * mapPins.ts — pure pin-extraction for the M6 offline map (shared web + mobile).
 *
 * The offline map (a WebView hosting MapLibre GL JS) renders crew meeting-point
 * pins, stage pins, and festival-amenity pins. The *selection* of which entities
 * become pins — which carry usable coords, how labels/types/colors map to marker
 * copy — is plain business logic, so it lives here (not duplicated in the mobile
 * component) and is unit-testable without any WebView/native dependency.
 *
 * STAGE PINS: as of M6 stages may carry optional `latitude`/`longitude` (see the
 * Phase A backend contract). `extractStagePins(festival)` projects every stage
 * with FINITE coords into a pin; stages without coords are dropped, so a festival
 * that was never mapped yields [] and the map UI keeps its "not mapped yet"
 * fallback. A zero-arg call still returns [] (back-compat for legacy callers).
 *
 * AMENITY PINS come from `festival.mapConfig.amenities` (a GeoJSON Point
 * FeatureCollection in [lng, lat] order). `extractAmenityPins` flips them to the
 * {latitude, longitude} pin shape and carries `amenityType` for glyph/color.
 *
 * All coordinates EXPOSED on MapPin are {latitude, longitude} (geo.ts order);
 * GeoJSON [lng, lat] input is converted at the boundary here.
 */

import type { Coord } from './geo';
import type { CrewMeetingPoint, Stage, Festival, FestivalMapConfig, AmenityType } from '../types/domain';

/**
 * A single map marker. `kind` lets the renderer style meeting-points vs stages
 * vs amenities. For `kind: 'stage'`, `color` is the stage's brand color; for
 * `kind: 'amenity'`, `amenityType` selects the category glyph/color.
 */
export interface MapPin {
  id: string;
  kind: 'meeting-point' | 'stage' | 'amenity';
  label: string;
  /** Secondary line (free-text location for meeting points). */
  sublabel?: string;
  /** Stage brand color (only on `kind: 'stage'`). */
  color?: string;
  /** Amenity category (only on `kind: 'amenity'`) — selects glyph/color. */
  amenityType?: AmenityType;
  latitude: number;
  longitude: number;
}

/** True only when both fields are finite numbers (guards null coords / NaN). */
function hasValidCoords(p: {
  latitude?: number | null;
  longitude?: number | null;
}): p is { latitude: number; longitude: number } {
  return (
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude)
  );
}

/** True for a finite [lng, lat] GeoJSON position. */
function isFiniteLngLat(c: unknown): c is [number, number] {
  return (
    Array.isArray(c) &&
    c.length >= 2 &&
    typeof c[0] === 'number' &&
    typeof c[1] === 'number' &&
    Number.isFinite(c[0]) &&
    Number.isFinite(c[1])
  );
}

/**
 * Project the active crew's meeting points into renderable map pins, keeping
 * ONLY active points that carry valid F4 GPS coords. Meeting points without
 * coords (legacy free-text) are intentionally dropped from the map layer — the
 * caller should still list them in the offline fallback so they're never lost.
 */
export function extractMeetingPointPins(points: CrewMeetingPoint[] | null | undefined): MapPin[] {
  if (!Array.isArray(points)) return [];
  const pins: MapPin[] = [];
  for (const p of points) {
    if (!p || p.active === false) continue;
    if (!hasValidCoords(p)) continue;
    pins.push({
      id: p.id,
      kind: 'meeting-point',
      label: p.label || 'Meeting point',
      sublabel: p.location || undefined,
      latitude: p.latitude,
      longitude: p.longitude,
    });
  }
  return pins;
}

/**
 * Stage pins (M6). Projects every stage carrying FINITE `latitude`/`longitude`
 * into a pin labelled with the stage name and tagged with the stage color.
 * Stages without coords are dropped, so a festival that was never mapped (or a
 * zero-arg call from a legacy caller) yields [] — the map UI must degrade
 * gracefully and never imply unmapped stages are plotted.
 *
 * Accepts either a festival (reads `.stages`) or nothing. Back-compatible with
 * the previous `extractStagePins()` no-arg signature.
 */
export function extractStagePins(festival?: (Festival & { stages?: Stage[] }) | null): MapPin[] {
  const stages = festival?.stages;
  if (!Array.isArray(stages)) return [];
  const pins: MapPin[] = [];
  for (const s of stages) {
    if (!s || !hasValidCoords(s)) continue;
    pins.push({
      id: s.id,
      kind: 'stage',
      label: s.name || 'Stage',
      color: s.color || undefined,
      latitude: s.latitude,
      longitude: s.longitude,
    });
  }
  return pins;
}

/**
 * Amenity pins (M6) from a festival map-config's GeoJSON amenities collection.
 * Each Point Feature ([lng, lat]) becomes a pin carrying `amenityType` (glyph/
 * color) and `label`. Features with non-finite coords are dropped. Null/absent
 * config or amenities → [].
 */
export function extractAmenityPins(mapConfig: FestivalMapConfig | null | undefined): MapPin[] {
  const features = mapConfig?.amenities?.features;
  if (!Array.isArray(features)) return [];
  const pins: MapPin[] = [];
  for (const f of features) {
    if (!f || f.geometry?.type !== 'Point') continue;
    const coords = f.geometry.coordinates;
    if (!isFiniteLngLat(coords)) continue;
    const props = f.properties;
    if (!props) continue;
    pins.push({
      id: props.id,
      kind: 'amenity',
      label: props.label || 'Amenity',
      amenityType: props.amenityType,
      // GeoJSON is [lng, lat]; MapPin is {latitude, longitude}.
      longitude: coords[0],
      latitude: coords[1],
    });
  }
  return pins;
}

/**
 * Visual treatment for an amenity marker — a category glyph (emoji, no icon-font
 * dependency) and a fixed brand color. Shared by every map surface (web CrewMap,
 * web OfflineMap, and the native WebView bridge) so stage/amenity markers look
 * identical across web + mobile. Pure, total: an unknown/absent type falls back
 * to the neutral "info" treatment so the marker is never blank.
 *
 * Colors are literal hex (not CSS vars) because the native WebView document can't
 * read the web theme tokens; the values are picked to read on the dark basemap
 * and are consistent with the app's accent palette.
 */
export interface AmenityGlyph {
  /** Single-grapheme emoji rendered inside the marker disc. */
  glyph: string;
  /** Marker fill color (hex). */
  color: string;
}

const AMENITY_GLYPHS: Record<AmenityType, AmenityGlyph> = {
  water: { glyph: '\u{1F4A7}', color: '#3aa0ff' }, // droplet — blue
  medical: { glyph: '\u{271A}', color: '#ff5277' }, // heavy cross — red
  toilet: { glyph: '\u{1F6BB}', color: '#9b8cff' }, // restroom — violet
  food: { glyph: '\u{1F354}', color: '#ffa53a' }, // burger — amber
  atm: { glyph: '\u{1F4B5}', color: '#3ad29f' }, // banknote — green
  entrance: { glyph: '\u{1F6AA}', color: '#19e3d3' }, // door — aqua (in)
  exit: { glyph: '\u{1F6AA}', color: '#ff8c42' }, // door — orange (out)
  info: { glyph: '\u{2139}', color: '#8aa4ff' }, // info — indigo
  charging: { glyph: '\u{1F50C}', color: '#ffd23a' }, // plug — yellow
};

const AMENITY_FALLBACK: AmenityGlyph = AMENITY_GLYPHS.info;

/**
 * Glyph + color for an amenity category. Total: unknown/undefined → the neutral
 * "info" treatment, so a marker is always renderable even for a future type the
 * client doesn't know yet.
 */
export function amenityGlyph(amenityType: AmenityType | string | null | undefined): AmenityGlyph {
  if (amenityType && Object.prototype.hasOwnProperty.call(AMENITY_GLYPHS, amenityType)) {
    return AMENITY_GLYPHS[amenityType as AmenityType];
  }
  return AMENITY_FALLBACK;
}

/** Geographic centre of a set of pins, for an initial map camera. Null if none. */
export function pinsCentroid(pins: MapPin[]): Coord | null {
  if (pins.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of pins) {
    lat += p.latitude;
    lng += p.longitude;
  }
  return { latitude: lat / pins.length, longitude: lng / pins.length };
}

/**
 * Axis-aligned bounding box of a set of pins as a GeoJSON-order bounds tuple
 * [[west, south], [east, north]] (each corner [lng, lat]). Null for <2 distinct
 * points (a single point / no points has no meaningful box — the caller should
 * centre on the centroid instead).
 */
function pinsBounds(pins: MapPin[]): FestivalMapConfig['bounds'] | null {
  if (pins.length < 2) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of pins) {
    if (p.longitude < west) west = p.longitude;
    if (p.longitude > east) east = p.longitude;
    if (p.latitude < south) south = p.latitude;
    if (p.latitude > north) north = p.latitude;
  }
  // Degenerate box (all pins coincide) → no meaningful bounds.
  if (west === east && south === north) return null;
  return [
    [west, south],
    [east, north],
  ];
}

/** Camera target for the festival map: where to centre and (optionally) how far to fit. */
export interface FestivalCamera {
  /** Initial map centre. Null only when there is nothing to show. */
  center: Coord | null;
  /**
   * GeoJSON-order bounds [[west, south], [east, north]] to fit, or null to just
   * centre (e.g. a single pin or an explicit center with no bounds).
   */
  bounds: FestivalMapConfig['bounds'] | null;
}

/**
 * Pick the initial camera for a festival map, preferring explicit map-config
 * over derived pin geometry. Precedence:
 *   1. `mapConfig.bounds` (fit it; centre = box midpoint),
 *   2. `mapConfig.center` (centre there; no fit),
 *   3. derived from `pins`: their bounding box (fit) when ≥2 distinct points,
 *      else their centroid (centre; no fit).
 * Returns `{ center: null, bounds: null }` when there's nothing to show.
 *
 * Pure: no map/DOM deps. The renderer decides how to apply center vs bounds.
 */
export function pickFestivalCamera(
  festival: Festival | null | undefined,
  pins: MapPin[] = [],
): FestivalCamera {
  const cfg = festival?.mapConfig;

  // 1. Explicit bounds win — derive centre from the box midpoint.
  const cfgBounds = cfg?.bounds;
  if (cfgBounds && isFiniteLngLat(cfgBounds[0]) && isFiniteLngLat(cfgBounds[1])) {
    const [[west, south], [east, north]] = cfgBounds;
    return {
      center: { latitude: (south + north) / 2, longitude: (west + east) / 2 },
      bounds: cfgBounds,
    };
  }

  // 2. Explicit center, no bounds.
  const cfgCenter = cfg?.center;
  if (isFiniteLngLat(cfgCenter)) {
    return {
      center: { latitude: cfgCenter[1], longitude: cfgCenter[0] },
      bounds: null,
    };
  }

  // 3. Fall back to the pins: fit their box when we have one, else centroid.
  const bounds = pinsBounds(pins);
  if (bounds) {
    const [[west, south], [east, north]] = bounds;
    return {
      center: { latitude: (south + north) / 2, longitude: (west + east) / 2 },
      bounds,
    };
  }
  return { center: pinsCentroid(pins), bounds: null };
}
