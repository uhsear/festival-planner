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
