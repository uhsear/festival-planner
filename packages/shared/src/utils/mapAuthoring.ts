// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * mapAuthoring.ts — pure authoring transforms for the admin festival-map editor
 * (Phase D, shared web + mobile).
 *
 * The admin editor lets a festival admin place/move stage pins and drop amenity
 * markers, then persist them via the existing PUT /admin/festivals/:id write
 * path. The *transforms* — generating ids, building an amenity GeoJSON Feature,
 * appending/removing/relocating amenity features in a map-config, setting a
 * stage's lat/lng, and capturing the current map view as a camera center —
 * are plain business logic, so they live here (not duplicated per-app) and are
 * unit-testable without any map/DOM/WebView dependency.
 *
 * COORDINATE ORDER: the editor surfaces (web maplibre, mobile WebView bridge)
 * report a tapped/dragged coordinate as {latitude, longitude} (geo.ts order).
 * Amenity Features stored in map_config are GeoJSON [lng, lat]. We convert at
 * THIS boundary so callers always pass/receive {latitude, longitude} and the
 * stored config stays GeoJSON-correct (matching the Phase A backend contract +
 * extractAmenityPins, which reads [lng, lat]).
 *
 * All functions are PURE: they take prior state + a coord and return new state
 * (callers own their own React state). Inputs are defended (non-finite coords
 * dropped) so a bad bridge payload can never corrupt the persisted config.
 */

import type { AmenityType, FestivalMapConfig } from '../types/domain';
import type { ZoneFeature } from './mapZones';
import { isHexColor, ZONE_DEFAULT_COLOR } from './mapZones';

/** A single amenity Feature inside a map-config's `amenities` collection. */
export type AmenityFeature = NonNullable<FestivalMapConfig['amenities']>['features'][number];

/**
 * Fixed palette the editor offers, in display order. Mirrors the backend
 * `AMENITY_TYPES` enum (lib/schemas.ts) + the AmenityType union in domain.ts.
 * Kept as a `satisfies` tuple so a drift between this list and the AmenityType
 * union is a compile error.
 */
export const AMENITY_PALETTE = [
  'water',
  'medical',
  'toilet',
  'food',
  'atm',
  'entrance',
  'exit',
  'info',
  'charging',
] as const satisfies readonly AmenityType[];

/** True only for a finite number in [min, max]. */
function inRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

/** True when a {latitude, longitude} pair is finite and within valid degrees. */
export function isValidLatLng(coord: { latitude?: number | null; longitude?: number | null } | null | undefined): coord is {
  latitude: number;
  longitude: number;
} {
  return !!coord && inRange(coord.latitude, -90, 90) && inRange(coord.longitude, -180, 180);
}

/**
 * Generate a collision-resistant id for a freshly-placed amenity. Prefixed so
 * it's distinguishable from stage/day/set ids in logs. Pure-enough for the
 * editor (the caller passes the result straight into the feature); not a
 * security primitive.
 */
export function makeAmenityId(): string {
  return `amenity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a single amenity GeoJSON Point Feature from a {latitude, longitude}
 * coord (converted to GeoJSON [lng, lat]), an amenity type, and a label. The
 * label is trimmed; an empty label falls back to a humanized type name so a
 * placed marker is never blank. Returns null for an out-of-range coord so a bad
 * tap can't append a corrupt feature.
 */
export function buildAmenityFeature(
  coord: { latitude: number; longitude: number },
  amenityType: AmenityType,
  label: string,
  id: string = makeAmenityId(),
): AmenityFeature | null {
  if (!isValidLatLng(coord)) return null;
  const trimmed = (label ?? '').trim();
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [coord.longitude, coord.latitude] },
    properties: {
      id,
      amenityType,
      label: trimmed || humanizeAmenityType(amenityType),
    },
  };
}

/** Title-case the enum value for a default label ('water' → 'Water'). */
export function humanizeAmenityType(amenityType: AmenityType | string): string {
  const s = String(amenityType || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Amenity';
}

/**
 * Return a new FestivalMapConfig with `feature` appended to its amenities
 * collection. If the prior config is null/absent, a fresh `version: 1` config
 * with just this amenity is created (so the first placement on an unmapped
 * festival "starts" the map). Existing zones/siteplan/center/bounds are
 * preserved untouched. Pure: never mutates the input.
 */
export function appendAmenity(
  config: FestivalMapConfig | null | undefined,
  feature: AmenityFeature,
): FestivalMapConfig {
  const base: FestivalMapConfig = config ? { ...config } : { version: 1 };
  const prevFeatures = base.amenities?.features ?? [];
  return {
    ...base,
    version: 1,
    amenities: {
      type: 'FeatureCollection',
      features: [...prevFeatures, feature],
    },
  };
}

/**
 * Return a new FestivalMapConfig with the amenity whose `properties.id` matches
 * removed. No-op (returns an equivalent config) when the id isn't present or
 * there are no amenities. Pure: never mutates the input. The collection is kept
 * (possibly empty) so the rest of the config is preserved verbatim.
 */
export function removeAmenity(
  config: FestivalMapConfig | null | undefined,
  amenityId: string,
): FestivalMapConfig {
  const base: FestivalMapConfig = config ? { ...config } : { version: 1 };
  const prevFeatures = base.amenities?.features ?? [];
  return {
    ...base,
    version: 1,
    amenities: {
      type: 'FeatureCollection',
      features: prevFeatures.filter((f) => f?.properties?.id !== amenityId),
    },
  };
}

/**
 * Return a new FestivalMapConfig with the matching amenity's coordinate replaced
 * (drag-to-move). Out-of-range coords are rejected (returns the config
 * unchanged) so a bad drag can't corrupt a stored feature. Other features and
 * the matched feature's label/type are untouched. Pure.
 */
export function moveAmenity(
  config: FestivalMapConfig | null | undefined,
  amenityId: string,
  coord: { latitude: number; longitude: number },
): FestivalMapConfig {
  const base: FestivalMapConfig = config ? { ...config } : { version: 1 };
  if (!isValidLatLng(coord)) {
    return { ...base, version: 1 };
  }
  const prevFeatures = base.amenities?.features ?? [];
  return {
    ...base,
    version: 1,
    amenities: {
      type: 'FeatureCollection',
      features: prevFeatures.map((f) =>
        f?.properties?.id === amenityId
          ? { ...f, geometry: { type: 'Point', coordinates: [coord.longitude, coord.latitude] } }
          : f,
      ),
    },
  };
}

/**
 * Return a new FestivalMapConfig with the matching amenity's label replaced
 * (trimmed; empty falls back to the humanized type). No-op when the id is
 * absent. Pure.
 */
export function setAmenityLabel(
  config: FestivalMapConfig | null | undefined,
  amenityId: string,
  label: string,
): FestivalMapConfig {
  const base: FestivalMapConfig = config ? { ...config } : { version: 1 };
  const prevFeatures = base.amenities?.features ?? [];
  return {
    ...base,
    version: 1,
    amenities: {
      type: 'FeatureCollection',
      features: prevFeatures.map((f) => {
        if (f?.properties?.id !== amenityId) return f;
        const trimmed = (label ?? '').trim();
        return {
          ...f,
          properties: { ...f.properties, label: trimmed || humanizeAmenityType(f.properties.amenityType) },
        };
      }),
    },
  };
}

/**
 * Normalize a placed/moved coordinate into the nullable {latitude, longitude}
 * the stage write path expects. A valid in-range coord passes through; anything
 * else clears the pin (both null). This is the single helper a stage "Set
 * location" handler calls so an out-of-range bridge payload can never write a
 * bogus stage coord.
 */
export function stageCoordFromTap(
  coord: { latitude?: number | null; longitude?: number | null } | null | undefined,
): { latitude: number | null; longitude: number | null } {
  if (isValidLatLng(coord)) {
    return { latitude: coord.latitude, longitude: coord.longitude };
  }
  return { latitude: null, longitude: null };
}

/**
 * Return a new FestivalMapConfig whose explicit `center` is set to the given
 * coordinate (stored GeoJSON [lng, lat]) — used by the editor's "Use this view
 * as the map centre" capture. Out-of-range coords are rejected (config returned
 * unchanged). Existing bounds/amenities/zones/siteplan are preserved. Pure.
 */
export function captureCenter(
  config: FestivalMapConfig | null | undefined,
  coord: { latitude: number; longitude: number },
): FestivalMapConfig {
  const base: FestivalMapConfig = config ? { ...config } : { version: 1 };
  if (!isValidLatLng(coord)) {
    return { ...base, version: 1 };
  }
  return { ...base, version: 1, center: [coord.longitude, coord.latitude] };
}

/**
 * Count amenities in a config (0 for null/absent). Small convenience for the
 * editor's "N amenities placed" summary copy.
 */
export function amenityCount(config: FestivalMapConfig | null | undefined): number {
  return config?.amenities?.features?.length ?? 0;
}

// ── Zone polygons (Phase 4A) ─────────────────────────────────────────────────
//
// The admin editor lets a festival admin draw zone polygons (camping / VIP /
// no-go / parking) with a tap-to-add-vertex builder, then persists them into
// `map_config.zones` via the SAME PUT /admin/festivals/:id write path. The
// transforms — generating an id, building a CLOSED-ring Polygon Feature from a
// list of tapped {latitude, longitude} vertices, and appending/removing a zone
// in a config — are pure business logic and live here so web + mobile stay in
// parity. Coordinates are converted at THIS boundary: callers pass/receive
// {latitude, longitude}; the stored Feature is GeoJSON [lng, lat].

/**
 * Generate a collision-resistant id for a freshly-drawn zone. Prefixed so it's
 * distinguishable from amenity/stage/day/set ids in logs. Pure-enough for the
 * editor; not a security primitive.
 */
export function makeZoneId(): string {
  return `zone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a single zone GeoJSON Polygon Feature from a list of tapped vertices
 * ({latitude, longitude}, converted to GeoJSON [lng, lat]). Out-of-range
 * vertices are dropped; the ring is CLOSED (the first point is appended as the
 * last when not already closed) as GeoJSON Polygons require. Returns null when
 * fewer than 3 valid vertices remain (no polygon). The color is validated to a
 * hex string (falls back to the neutral default); a blank label is stored as ''
 * (the renderer falls back to no label tag). Pure: never mutates inputs.
 */
export function buildZoneFeature(
  vertices: Array<{ latitude: number; longitude: number }>,
  opts: { color?: string; label?: string } = {},
  id: string = makeZoneId(),
): ZoneFeature | null {
  if (!Array.isArray(vertices)) return null;
  const ring: [number, number][] = [];
  for (const v of vertices) {
    if (isValidLatLng(v)) ring.push([v.longitude, v.latitude]);
  }
  if (ring.length < 3) return null;
  // Close the ring if the caller didn't (GeoJSON Polygon rings are closed).
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return null; // unreachable (length ≥ 3) — narrows for TS
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  const color = isHexColor(opts.color) ? opts.color : ZONE_DEFAULT_COLOR;
  const label = (opts.label ?? '').trim();
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { id, color, label },
  };
}

/**
 * Return a new FestivalMapConfig with `feature` appended to its zones
 * collection. If the prior config is null/absent, a fresh `version: 1` config
 * with just this zone is created. Existing amenities/siteplan/center/bounds are
 * preserved untouched. Pure: never mutates the input.
 */
export function appendZone(config: FestivalMapConfig | null | undefined, feature: ZoneFeature): FestivalMapConfig {
  const base: FestivalMapConfig = config ? { ...config } : { version: 1 };
  const prevFeatures = base.zones?.features ?? [];
  return {
    ...base,
    version: 1,
    zones: {
      type: 'FeatureCollection',
      features: [...prevFeatures, feature],
    },
  };
}

/**
 * Return a new FestivalMapConfig with the zone whose `properties.id` matches
 * removed. No-op (returns an equivalent config) when the id isn't present or
 * there are no zones. Pure: never mutates the input.
 */
export function removeZone(config: FestivalMapConfig | null | undefined, zoneId: string): FestivalMapConfig {
  const base: FestivalMapConfig = config ? { ...config } : { version: 1 };
  const prevFeatures = base.zones?.features ?? [];
  return {
    ...base,
    version: 1,
    zones: {
      type: 'FeatureCollection',
      features: prevFeatures.filter((f) => (f?.properties as { id?: unknown } | undefined)?.id !== zoneId),
    },
  };
}

/**
 * Count zones in a config (0 for null/absent). Small convenience for the
 * editor's "N zones drawn" summary copy.
 */
export function zoneCount(config: FestivalMapConfig | null | undefined): number {
  return config?.zones?.features?.length ?? 0;
}
