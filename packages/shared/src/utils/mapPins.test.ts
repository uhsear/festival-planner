// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it, expect } from 'vitest';
import { extractMeetingPointPins, extractStagePins, pinsCentroid, type MapPin } from './mapPins';
import type { CrewMeetingPoint } from '../types/domain';

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
  it('returns [] today (stages have no coords in the model yet)', () => {
    expect(extractStagePins()).toEqual([]);
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
