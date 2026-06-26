// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it, expect } from 'vitest';
import {
  extractZones,
  zonesGeoJSON,
  zoneLabels,
  isHexColor,
  ZONE_DEFAULT_COLOR,
} from './mapZones';
import { buildZoneFeature, appendZone, removeZone, zoneCount } from './mapAuthoring';
import type { FestivalMapConfig } from '../types/domain';

// A closed square ring (GeoJSON [lng,lat]) centred on (lng 0, lat 0).
const SQUARE: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

function cfgWith(features: NonNullable<FestivalMapConfig['zones']>['features']): FestivalMapConfig {
  return { version: 1, zones: { type: 'FeatureCollection', features } };
}

describe('isHexColor', () => {
  it('accepts #rgb and #rrggbb, rejects everything else', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#AABBCC')).toBe(true);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#12')).toBe(false);
    expect(isHexColor('rgb(0,0,0)')).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(123 as unknown)).toBe(false);
  });
});

describe('extractZones', () => {
  it('returns [] for null/undefined config or absent zones', () => {
    expect(extractZones(null)).toEqual([]);
    expect(extractZones(undefined)).toEqual([]);
    expect(extractZones({ version: 1 })).toEqual([]);
  });

  it('projects a Polygon feature with color + label + centroid', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [SQUARE] },
        properties: { id: 'camp', color: '#3ad29f', label: 'Camping' },
      },
    ]);
    const zones = extractZones(cfg);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ id: 'camp', label: 'Camping', color: '#3ad29f' });
    // Centroid ignores the closing duplicate → mean of the 4 corners = (0,0).
    expect(zones[0].centroid).toEqual({ latitude: 0, longitude: 0 });
    expect(zones[0].rings[0]).toEqual(SQUARE);
  });

  it('falls back to the default color when color is missing/invalid', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [SQUARE] },
        properties: { id: 'z1', color: 'not-a-hex' },
      },
    ]);
    expect(extractZones(cfg)[0].color).toBe(ZONE_DEFAULT_COLOR);
  });

  it('reads `name` when `label` is absent and generates an id when missing', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [SQUARE] },
        properties: { name: 'VIP' },
      },
    ]);
    const z = extractZones(cfg)[0];
    expect(z.label).toBe('VIP');
    expect(z.id).toBe('zone-0');
  });

  it('drops degenerate rings (fewer than 3 finite positions) and non-Polygon geometry', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [Number.NaN, 1], [2, 2]]] },
        properties: { id: 'bad-nan' }, // only 2 finite points -> dropped
      },
      {
        // A point smuggled in as the wrong geometry type -> dropped.
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] } as unknown as { type: 'Polygon'; coordinates: [number, number][][] },
        properties: { id: 'bad-type' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [SQUARE] },
        properties: { id: 'ok' },
      },
    ]);
    expect(extractZones(cfg).map((z) => z.id)).toEqual(['ok']);
  });
});

describe('zonesGeoJSON', () => {
  it('bakes color into each feature for a data-driven fill', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [SQUARE] },
        properties: { id: 'z', color: '#ffd23a', label: 'VIP' },
      },
    ]);
    const fc = zonesGeoJSON(extractZones(cfg));
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features[0].properties).toEqual({ id: 'z', color: '#ffd23a', label: 'VIP' });
    expect(fc.features[0].geometry.coordinates).toEqual([SQUARE]);
  });
});

describe('zoneLabels', () => {
  it('emits label anchors only for zones with a centroid AND a non-empty label', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [SQUARE] },
        properties: { id: 'labelled', label: 'Camping' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [SQUARE] },
        properties: { id: 'unlabelled' }, // no label -> no anchor
      },
    ]);
    const labels = zoneLabels(extractZones(cfg));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ id: 'labelled', label: 'Camping', latitude: 0, longitude: 0 });
  });
});

describe('buildZoneFeature', () => {
  it('builds a closed-ring Polygon from {latitude,longitude} vertices', () => {
    const f = buildZoneFeature(
      [
        { latitude: -1, longitude: -1 },
        { latitude: -1, longitude: 1 },
        { latitude: 1, longitude: 1 },
      ],
      { color: '#3ad29f', label: '  Camping  ' },
      'zone-fixed',
    );
    expect(f).not.toBeNull();
    expect(f!.geometry.type).toBe('Polygon');
    const ring = f!.geometry.coordinates[0];
    // Converted to [lng,lat] and closed (first === last).
    expect(ring[0]).toEqual([-1, -1]);
    expect(ring[ring.length - 1]).toEqual([-1, -1]);
    expect(ring).toHaveLength(4); // 3 verts + closing point
    expect(f!.properties).toEqual({ id: 'zone-fixed', color: '#3ad29f', label: 'Camping' });
  });

  it('returns null when fewer than 3 valid vertices remain', () => {
    expect(
      buildZoneFeature([
        { latitude: 0, longitude: 0 },
        { latitude: Number.NaN, longitude: 1 }, // dropped
        { latitude: 200, longitude: 0 }, // out of range -> dropped
      ]),
    ).toBeNull();
    expect(buildZoneFeature([])).toBeNull();
  });

  it('falls back to the default color for an invalid color', () => {
    const f = buildZoneFeature(
      [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
        { latitude: 1, longitude: 1 },
      ],
      { color: 'green' },
    );
    expect(f!.properties).toMatchObject({ color: ZONE_DEFAULT_COLOR, label: '' });
  });
});

describe('appendZone / removeZone / zoneCount', () => {
  const feature = buildZoneFeature(
    [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
    ],
    { label: 'A' },
    'z-a',
  )!;

  it('appendZone starts a fresh config from null and preserves amenities', () => {
    const cfg = appendZone(
      { version: 1, amenities: { type: 'FeatureCollection', features: [] } },
      feature,
    );
    expect(cfg.version).toBe(1);
    expect(cfg.amenities).toBeDefined();
    expect(zoneCount(cfg)).toBe(1);
  });

  it('removeZone drops only the matching id and is a no-op for unknown ids', () => {
    const cfg = appendZone(null, feature);
    expect(zoneCount(removeZone(cfg, 'z-a'))).toBe(0);
    expect(zoneCount(removeZone(cfg, 'nope'))).toBe(1);
  });

  it('zoneCount is 0 for null/absent', () => {
    expect(zoneCount(null)).toBe(0);
    expect(zoneCount({ version: 1 })).toBe(0);
  });
});
