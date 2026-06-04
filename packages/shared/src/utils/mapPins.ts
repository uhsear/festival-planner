// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * mapPins.ts — pure pin-extraction for the M6 offline map (shared web + mobile).
 *
 * The offline map (a WebView hosting MapLibre GL JS) renders crew meeting-point
 * pins. The *selection* of which meeting points become pins — which ones carry
 * usable GPS coords (F4), how their labels/types map to marker copy — is plain
 * business logic, so it lives here (not duplicated in the mobile component) and
 * is unit-testable without any WebView/native dependency.
 *
 * STAGE PINS: stages have NO coords in the data model today (see the roadmap M6
 * note — "stages have none today"). `extractStagePins` therefore always returns
 * an empty array; it exists as the documented seam a future stage-coords
 * migration (or festival map-config blob) plugs into. The map UI must show a
 * graceful "no stage map yet" affordance, never a blank layer.
 */

import type { Coord } from './geo';
import type { CrewMeetingPoint } from '../types/domain';

/** A single map marker. `kind` lets the renderer style meeting-points vs stages. */
export interface MapPin {
  id: string;
  kind: 'meeting-point' | 'stage';
  label: string;
  /** Secondary line (free-text location for meeting points). */
  sublabel?: string;
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
 * Stage pins. TODO(stage-coords): stages have no lat/lng in the data model yet
 * (roadmap M6 + migration item #6 — "stages coords (or festival map-config)").
 * Until that migration lands this returns [] by contract; the map UI must
 * degrade gracefully (show meeting-point pins + a "stage map coming" note),
 * NEVER imply stages are plotted.
 */
export function extractStagePins(): MapPin[] {
  return [];
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
