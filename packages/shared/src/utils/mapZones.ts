// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * mapZones.ts — pure zone-polygon extraction for the festival map (Phase 4A,
 * shared web + mobile).
 *
 * A festival map-config MAY carry `zones`: a GeoJSON Polygon FeatureCollection
 * describing camping / VIP / no-go / parking areas. The *selection* of which
 * features are renderable (valid Polygon geometry, finite rings), and how each
 * maps to a fill color + a label anchor, is plain business logic, so it lives
 * here (not duplicated per-app) and is unit-testable without any map/DOM/WebView
 * dependency.
 *
 * COORDINATE ORDER: zones are stored GeoJSON [lng, lat]; that order is preserved
 * verbatim in `rings` (MapLibre's fill source wants GeoJSON order). The label
 * `centroid` is exposed as {latitude, longitude} (geo.ts order) like every other
 * shared pin, so the renderer can drop a DOM label marker the same way it does
 * for stages/amenities.
 *
 * ADDITIVE + GRACEFUL: a festival with no `zones` (or only invalid features)
 * yields [] and the map renders exactly as before — no zone layer is added.
 */

import type { Coord } from './geo';
import type { FestivalMapConfig } from '../types/domain';

/** A single zone Feature inside a map-config's `zones` collection. */
export type ZoneFeature = NonNullable<FestivalMapConfig['zones']>['features'][number];

/**
 * Neutral fill/stroke color for a zone whose feature carries no (valid) color.
 * Indigo — reads on the dark basemap and is distinct from the coral meeting
 * pins + aqua peers (mirrors the amenity "info" treatment).
 */
export const ZONE_DEFAULT_COLOR = '#8aa4ff';

/**
 * Suggested zone color presets the admin editor offers (the organizer can still
 * rename each zone freely). Colors are literal hex (not CSS vars) so they read
 * identically on the web map, the web export, and the native WebView document.
 */
export const ZONE_PALETTE = [
  { color: '#3ad29f', label: 'Camping' },
  { color: '#ffd23a', label: 'VIP' },
  { color: '#ff5277', label: 'No-go' },
  { color: '#3aa0ff', label: 'Parking' },
  { color: '#9b8cff', label: 'Staff' },
  { color: '#ffa53a', label: 'Vendors' },
] as const;

/** A zone ready to render: per-zone fill color, label, polygon rings, label anchor. */
export interface MapZone {
  id: string;
  /** Display label (may be empty when the feature carried none). */
  label: string;
  /** Resolved fill/stroke color (hex) — feature color or the neutral default. */
  color: string;
  /** Polygon rings in GeoJSON [lng, lat] order (outer ring first). */
  rings: [number, number][][];
  /** Label anchor (centroid of the outer ring) in {latitude, longitude}, or null. */
  centroid: Coord | null;
}

/** True for a 3- or 6-digit hex color string (#rgb / #rrggbb). */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
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

/** Keep only finite [lng, lat] positions in a ring. */
function cleanRing(ring: unknown): [number, number][] {
  if (!Array.isArray(ring)) return [];
  const out: [number, number][] = [];
  for (const pos of ring) {
    if (isFiniteLngLat(pos)) out.push([pos[0], pos[1]]);
  }
  return out;
}

/**
 * Centroid (mean vertex) of an outer ring, ignoring a trailing point that just
 * closes the ring (equal to the first). Null for a ring with no usable points.
 */
function ringCentroid(ring: [number, number][]): Coord | null {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return null;
  // Drop the closing duplicate so it doesn't bias the mean.
  const closed = ring.length > 1 && first[0] === last[0] && first[1] === last[1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (pts.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of pts) {
    lng += x;
    lat += y;
  }
  return { latitude: lat / pts.length, longitude: lng / pts.length };
}

/** Read a string property (id/label) defensively from a feature's properties. */
function readStringProp(props: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = props?.[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Project a festival map-config's GeoJSON zones into renderable structs. Each
 * Polygon Feature whose OUTER ring has ≥3 finite positions becomes a MapZone
 * carrying its rings (GeoJSON order), a resolved color (`properties.color` when a
 * valid hex, else the neutral default), a label (`properties.label`/`name`), and
 * a centroid for label placement. Invalid/degenerate features are dropped.
 * Null/absent config or zones → [].
 */
export function extractZones(mapConfig: FestivalMapConfig | null | undefined): MapZone[] {
  const features = mapConfig?.zones?.features;
  if (!Array.isArray(features)) return [];
  const zones: MapZone[] = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f || f.geometry?.type !== 'Polygon') continue;
    const rawRings = f.geometry.coordinates;
    if (!Array.isArray(rawRings) || rawRings.length === 0) continue;
    const rings = rawRings.map(cleanRing).filter((r) => r.length >= 3);
    // The OUTER ring must survive cleaning with ≥3 points to be a polygon.
    const outerRing = rings[0];
    if (!outerRing) continue;
    const props = f.properties as Record<string, unknown> | undefined;
    const rawColor = props?.color;
    const id = readStringProp(props, 'id') || `zone-${i}`;
    const label = readStringProp(props, 'label') ?? readStringProp(props, 'name') ?? '';
    zones.push({
      id,
      label,
      color: isHexColor(rawColor) ? rawColor : ZONE_DEFAULT_COLOR,
      rings,
      centroid: ringCentroid(outerRing),
    });
  }
  return zones;
}

/**
 * A GeoJSON FeatureCollection suitable for a MapLibre `geojson` source, with the
 * resolved `color` baked into each feature's properties so a data-driven paint
 * (`['get','color']`) can fill each zone in its own color. Built from the result
 * of `extractZones`, so callers share the exact same validation + color logic
 * across web (CrewMap, OfflineMap.web) and the native WebView document.
 */
export interface ZonesFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Polygon'; coordinates: [number, number][][] };
    properties: { id: string; color: string; label: string };
  }>;
}

/** Build a render-ready GeoJSON FeatureCollection (color baked in) from zones. */
export function zonesGeoJSON(zones: MapZone[]): ZonesFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: z.rings },
      properties: { id: z.id, color: z.color, label: z.label },
    })),
  };
}

/** A label anchor for a zone (centroid + text + color) — for DOM label markers. */
export interface ZoneLabel {
  id: string;
  label: string;
  color: string;
  latitude: number;
  longitude: number;
}

/** Label anchors for zones that have BOTH a centroid and a non-empty label. */
export function zoneLabels(zones: MapZone[]): ZoneLabel[] {
  const out: ZoneLabel[] = [];
  for (const z of zones) {
    if (!z.centroid || !z.label) continue;
    out.push({
      id: z.id,
      label: z.label,
      color: z.color,
      latitude: z.centroid.latitude,
      longitude: z.centroid.longitude,
    });
  }
  return out;
}
