// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it, expect } from 'vitest';
import {
  extractMeetingPointPins,
  extractStagePins,
  extractAmenityPins,
  pinsCentroid,
  pickFestivalCamera,
  type MapPin,
} from './mapPins';
import type { CrewMeetingPoint, Stage, Festival, FestivalMapConfig } from '../types/domain';

function mp(overrides: Partial<CrewMeetingPoint>): CrewMeetingPoint {
  return {
    id: 'm1',
    crew_id: 'c1',
    created_by: 'u1',
    label: 'Front gate',
    location: 'By the ferris wheel',
    type: 'meetup',
    meet_at: null,
    stage_reference: null,
    latitude: null,
    longitude: null,
    active: true,
    created_at: '2026-06-03T00:00:00Z',
    ...overrides,
  };
}

function stage(overrides: Partial<Stage>): Stage {
  return {
    id: 's1',
    name: 'Main Stage',
    color: '#ff3366',
    festivalId: 'f1',
    latitude: null,
    longitude: null,
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
    ...overrides,
  };
}

function festival(overrides: Partial<Festival & { stages?: Stage[] }>): Festival & { stages?: Stage[] } {
  return {
    id: 'f1',
    name: 'Festie Fest',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
    ...overrides,
  };
}

describe('extractMeetingPointPins', () => {
  it('keeps only active points with valid finite coords', () => {
    const points: CrewMeetingPoint[] = [
      mp({ id: 'a', latitude: 41.88, longitude: -87.62 }),
      mp({ id: 'b', latitude: null, longitude: null }), // no coords -> dropped
      mp({ id: 'c', latitude: 41.9, longitude: -87.6, active: false }), // inactive -> dropped
      mp({ id: 'd', latitude: Number.NaN, longitude: -87.6 }), // NaN -> dropped
    ];
    const pins = extractMeetingPointPins(points);
    expect(pins.map((p) => p.id)).toEqual(['a']);
    expect(pins[0]).toMatchObject({
      kind: 'meeting-point',
      label: 'Front gate',
      sublabel: 'By the ferris wheel',
      latitude: 41.88,
      longitude: -87.62,
    });
  });

  it('handles null/undefined/non-array input', () => {
    expect(extractMeetingPointPins(null)).toEqual([]);
    expect(extractMeetingPointPins(undefined)).toEqual([]);
    expect(extractMeetingPointPins([] as CrewMeetingPoint[])).toEqual([]);
  });

  it('falls back to a default label when label is empty', () => {
    const pins = extractMeetingPointPins([mp({ id: 'x', label: '', latitude: 1, longitude: 2 })]);
    expect(pins[0]?.label).toBe('Meeting point');
    expect(pins[0]?.sublabel).toBe('By the ferris wheel');
  });
});

describe('extractStagePins', () => {
  it('returns [] for a zero-arg call (legacy back-compat)', () => {
    expect(extractStagePins()).toEqual([]);
  });

  it('returns [] for null/undefined festival or a festival with no stages', () => {
    expect(extractStagePins(null)).toEqual([]);
    expect(extractStagePins(festival({}))).toEqual([]);
  });

  it('keeps only stages with valid finite coords and carries name + color', () => {
    const f = festival({
      stages: [
        stage({ id: 'a', name: 'Main', color: '#abc', latitude: 41.88, longitude: -87.62 }),
        stage({ id: 'b', latitude: null, longitude: null }), // no coords -> dropped
        stage({ id: 'c', latitude: 41.9, longitude: Number.NaN }), // NaN -> dropped
        stage({ id: 'd', latitude: Number.POSITIVE_INFINITY, longitude: 1 }), // Infinity -> dropped
      ],
    });
    const pins = extractStagePins(f);
    expect(pins.map((p) => p.id)).toEqual(['a']);
    expect(pins[0]).toMatchObject({
      kind: 'stage',
      label: 'Main',
      color: '#abc',
      latitude: 41.88,
      longitude: -87.62,
    });
  });

  it('falls back to a default label when stage name is empty', () => {
    const f = festival({ stages: [stage({ id: 'x', name: '', latitude: 1, longitude: 2 })] });
    expect(extractStagePins(f)[0]?.label).toBe('Stage');
  });
});

describe('extractAmenityPins', () => {
  function cfgWith(features: FestivalMapConfig['amenities']['features']): FestivalMapConfig {
    return { version: 1, amenities: { type: 'FeatureCollection', features } };
  }

  it('returns [] for null/undefined config or absent amenities', () => {
    expect(extractAmenityPins(null)).toEqual([]);
    expect(extractAmenityPins(undefined)).toEqual([]);
    expect(extractAmenityPins({ version: 1 })).toEqual([]);
  });

  it('maps GeoJSON [lng,lat] points to {latitude,longitude} pins with amenityType', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-87.62, 41.88] },
        properties: { id: 'w1', amenityType: 'water', label: 'Water station' },
      },
    ]);
    const pins = extractAmenityPins(cfg);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      id: 'w1',
      kind: 'amenity',
      amenityType: 'water',
      label: 'Water station',
      latitude: 41.88,
      longitude: -87.62,
    });
  });

  it('drops features with non-finite coordinates', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number.NaN, 41.88] },
        properties: { id: 'bad', amenityType: 'toilet', label: 'Restroom' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-87.6, 41.9] },
        properties: { id: 'ok', amenityType: 'medical', label: 'Medical' },
      },
    ]);
    expect(extractAmenityPins(cfg).map((p) => p.id)).toEqual(['ok']);
  });

  it('falls back to a default label when amenity label is empty', () => {
    const cfg = cfgWith([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: { id: 'x', amenityType: 'food', label: '' },
      },
    ]);
    expect(extractAmenityPins(cfg)[0]?.label).toBe('Amenity');
  });
});

describe('pinsCentroid', () => {
  it('returns null for no pins', () => {
    expect(pinsCentroid([])).toBeNull();
  });

  it('averages lat/lng across pins', () => {
    const pins: MapPin[] = [
      { id: 'a', kind: 'meeting-point', label: 'A', latitude: 0, longitude: 0 },
      { id: 'b', kind: 'meeting-point', label: 'B', latitude: 2, longitude: 4 },
    ];
    expect(pinsCentroid(pins)).toEqual({ latitude: 1, longitude: 2 });
  });
});

describe('pickFestivalCamera', () => {
  const pins: MapPin[] = [
    { id: 'a', kind: 'stage', label: 'A', latitude: 0, longitude: 0 },
    { id: 'b', kind: 'stage', label: 'B', latitude: 2, longitude: 4 },
  ];

  it('prefers mapConfig.bounds and derives center from the box midpoint', () => {
    const f = festival({
      mapConfig: {
        version: 1,
        bounds: [
          [-88, 41],
          [-86, 43],
        ],
        center: [10, 10], // present but bounds win
      },
    });
    const cam = pickFestivalCamera(f, pins);
    expect(cam.bounds).toEqual([
      [-88, 41],
      [-86, 43],
    ]);
    expect(cam.center).toEqual({ latitude: 42, longitude: -87 });
  });

  it('uses mapConfig.center (no bounds) when bounds absent', () => {
    const f = festival({ mapConfig: { version: 1, center: [-87.62, 41.88] } });
    const cam = pickFestivalCamera(f, pins);
    expect(cam.bounds).toBeNull();
    expect(cam.center).toEqual({ latitude: 41.88, longitude: -87.62 });
  });

  it('falls back to the pins bounding box (fit) when ≥2 distinct pins and no config', () => {
    const cam = pickFestivalCamera(festival({}), pins);
    expect(cam.bounds).toEqual([
      [0, 0],
      [4, 2],
    ]);
    expect(cam.center).toEqual({ latitude: 1, longitude: 2 });
  });

  it('falls back to the centroid (no bounds) for a single pin', () => {
    const one: MapPin[] = [{ id: 'a', kind: 'stage', label: 'A', latitude: 5, longitude: 7 }];
    const cam = pickFestivalCamera(festival({}), one);
    expect(cam.bounds).toBeNull();
    expect(cam.center).toEqual({ latitude: 5, longitude: 7 });
  });

  it('returns center: null, bounds: null when there is nothing to show', () => {
    expect(pickFestivalCamera(null)).toEqual({ center: null, bounds: null });
    expect(pickFestivalCamera(festival({}), [])).toEqual({ center: null, bounds: null });
  });
});
