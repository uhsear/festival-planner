// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * mapStyle.ts — pure MapLibre style selection for the festival map (Phase 3A),
 * shared by web (CrewMap, OfflineMap.web) and the native WebView document.
 *
 * PRIME DIRECTIVE — ADDITIVE + GRACEFUL FALLBACK: a festival with NO
 * `offlineBasemap.pmtilesUrl` MUST render exactly as before — the online OSM
 * raster basemap. Only when a festival carries a valid https PMTiles URL do we
 * switch to a minimal Protomaps-style VECTOR basemap reading `pmtiles://<url>`.
 *
 * This module owns ONLY the style JSON (a plain object MapLibre accepts) + the
 * pmtiles-host extraction used by the security allowlists. It has no map/DOM
 * deps and registers no protocol — the renderer (which holds the maplibre +
 * pmtiles instances) does `addProtocol('pmtiles', new pmtiles.Protocol().tile)`.
 */

import type { FestivalMapConfig } from '../types/domain';

/** OSM raster attribution string, kept identical to today's inline styles. */
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * The online OpenStreetMap raster style (no API key) — TODAY's basemap. Returned
 * verbatim whenever there's no offline basemap so the online path never regresses.
 * `version` is the literal 8 MapLibre requires.
 */
export function osmRasterStyle(): {
  version: 8;
  sources: Record<string, unknown>;
  layers: Array<Record<string, unknown>>;
} {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: OSM_ATTRIBUTION,
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

/**
 * A minimal Protomaps-style VECTOR basemap reading the festival's PMTiles archive
 * via the `pmtiles://` protocol. Deliberately small + standard-layer-named (the
 * Protomaps "basemap" vector schema: `earth`, `water`, `landuse`, `roads`,
 * `buildings`) so a standard Protomaps `.pmtiles` extract renders land/water/
 * roads/buildings without bundling a fonts/sprite server. Layers a vector source
 * lacks simply draw nothing — safe + graceful.
 *
 * `pmtilesUrl` is templated into the source `url` as `pmtiles://<url>`; the
 * caller is responsible for having validated it (https) upstream (schema +
 * host allowlist). No labels (text) layers — those need a glyphs endpoint we
 * don't host; geometry-only keeps the basemap fully self-contained.
 */
export function pmtilesVectorStyle(
  pmtilesUrl: string,
  attribution?: string,
): {
  version: 8;
  sources: Record<string, unknown>;
  layers: Array<Record<string, unknown>>;
} {
  return {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution: attribution || '',
      },
    },
    layers: [
      // Solid backdrop so gaps in coverage read as a neutral field, not black.
      { id: 'background', type: 'background', paint: { 'background-color': '#0c0c14' } },
      {
        id: 'earth',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'earth',
        paint: { 'fill-color': '#15151f' },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'landuse',
        paint: { 'fill-color': '#1a2a1f' },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'water',
        paint: { 'fill-color': '#13263a' },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        paint: { 'line-color': '#3a3a4a', 'line-width': 1 },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'buildings',
        paint: { 'fill-color': '#23232f' },
      },
    ],
  };
}

/**
 * True when the festival map-config carries a usable offline vector basemap: an
 * https PMTiles URL. Anything else (absent config, non-https, empty) is false so
 * the caller keeps the online raster basemap (graceful fallback).
 */
export function hasOfflineBasemap(
  mapConfig: FestivalMapConfig | null | undefined,
): mapConfig is FestivalMapConfig & { offlineBasemap: { pmtilesUrl: string; attribution?: string } } {
  const url = mapConfig?.offlineBasemap?.pmtilesUrl;
  return typeof url === 'string' && /^https:\/\//i.test(url);
}

/**
 * Pick the MapLibre style for a festival: the PMTiles vector basemap when the
 * config carries a valid offline basemap, otherwise TODAY's online OSM raster.
 * Pure + total — the renderer hands the result straight to `new Map({ style })`.
 */
export function pickMapStyle(mapConfig: FestivalMapConfig | null | undefined): ReturnType<typeof osmRasterStyle> {
  if (hasOfflineBasemap(mapConfig)) {
    const { pmtilesUrl, attribution } = mapConfig.offlineBasemap;
    return pmtilesVectorStyle(pmtilesUrl, attribution);
  }
  return osmRasterStyle();
}

/**
 * The hostname of the festival's PMTiles URL, or null when there's no valid
 * offline basemap. Used by the native WebView's host allowlist + CSP to permit
 * EXACTLY the configured archive's origin (and nothing else) — preserving
 * default-deny. Returns null on any parse failure or non-https URL.
 */
export function pmtilesHost(mapConfig: FestivalMapConfig | null | undefined): string | null {
  if (!hasOfflineBasemap(mapConfig)) return null;
  try {
    const u = new URL(mapConfig.offlineBasemap.pmtilesUrl);
    return u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}
