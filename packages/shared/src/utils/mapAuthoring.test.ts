// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it, expect } from 'vitest';
import {
  AMENITY_PALETTE,
  isValidLatLng,
  makeAmenityId,
  buildAmenityFeature,
  humanizeAmenityType,
  appendAmenity,
  removeAmenity,
  moveAmenity,
  setAmenityLabel,
  stageCoordFromTap,
  captureCenter,
  amenityCount,
  type AmenityFeature,
} from './mapAuthoring';
import type { FestivalMapConfig } from '../types/domain';

function feature(over: Partial<{ id: string; lng: number; lat: number; label: string }> = {}): AmenityFeature {
  const { id = 'a1', lng = 10, lat = 20, label = 'Water' } = over;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { id, amenityType: 'water', label },
  };
}

describe('AMENITY_PALETTE', () => {
  it('contains all nine amenity types in display order', () => {
    expect(AMENITY_PALETTE).toEqual([
      'water',
      'medical',
      'toilet',
      'food',
      'atm',
      'entrance',
      'exit',
      'info',
      'charging',
    ]);
  });
});

describe('isValidLatLng', () => {
  it('accepts in-range finite coords', () => {
    expect(isValidLatLng({ latitude: 0, longitude: 0 })).toBe(true);
    expect(isValidLatLng({ latitude: -90, longitude: 180 })).toBe(true);
  });
  it('rejects out-of-range, non-finite, and nullish', () => {
    expect(isValidLatLng({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidLatLng({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidLatLng({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isValidLatLng({ latitude: null, longitude: null })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
    expect(isValidLatLng(undefined)).toBe(false);
  });
});

describe('makeAmenityId', () => {
  it('is prefixed and reasonably unique', () => {
    const a = makeAmenityId();
    const b = makeAmenityId();
    expect(a.startsWith('amenity-')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('humanizeAmenityType', () => {
  it('title-cases the value', () => {
    expect(humanizeAmenityType('water')).toBe('Water');
    expect(humanizeAmenityType('charging')).toBe('Charging');
  });
  it('falls back to Amenity for empty', () => {
    expect(humanizeAmenityType('')).toBe('Amenity');
  });
});

describe('buildAmenityFeature', () => {
  it('builds a GeoJSON Point in [lng, lat] order from {lat, lng}', () => {
    const f = buildAmenityFeature({ latitude: 20, longitude: 10 }, 'medical', 'First aid', 'fixed-id');
    expect(f).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [10, 20] },
      properties: { id: 'fixed-id', amenityType: 'medical', label: 'First aid' },
    });
  });
  it('trims the label and falls back to the humanized type when blank', () => {
    const f = buildAmenityFeature({ latitude: 1, longitude: 2 }, 'toilet', '   ', 'id');
    expect(f?.properties.label).toBe('Toilet');
    const g = buildAmenityFeature({ latitude: 1, longitude: 2 }, 'food', '  Pizza  ', 'id');
    expect(g?.properties.label).toBe('Pizza');
  });
  it('returns null for an out-of-range coord', () => {
    expect(buildAmenityFeature({ latitude: 200, longitude: 0 }, 'water', 'x', 'id')).toBeNull();
  });
  it('auto-generates an id when none is given', () => {
    const f = buildAmenityFeature({ latitude: 1, longitude: 2 }, 'atm', 'Cash');
    expect(f?.properties.id.startsWith('amenity-')).toBe(true);
  });
});

describe('appendAmenity', () => {
  it('starts a fresh version:1 config when none exists', () => {
    const cfg = appendAmenity(null, feature({ id: 'a1' }));
    expect(cfg.version).toBe(1);
    expect(cfg.amenities?.features.map((f) => f.properties.id)).toEqual(['a1']);
  });
  it('appends to an existing collection without disturbing other keys', () => {
    const prior: FestivalMapConfig = {
      version: 1,
      center: [5, 6],
      bounds: [
        [0, 0],
        [1, 1],
      ],
      amenities: { type: 'FeatureCollection', features: [feature({ id: 'a1' })] },
    };
    const cfg = appendAmenity(prior, feature({ id: 'a2' }));
    expect(cfg.amenities?.features.map((f) => f.properties.id)).toEqual(['a1', 'a2']);
    expect(cfg.center).toEqual([5, 6]);
    expect(cfg.bounds).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
  it('does not mutate the input config', () => {
    const prior: FestivalMapConfig = {
      version: 1,
      amenities: { type: 'FeatureCollection', features: [feature({ id: 'a1' })] },
    };
    appendAmenity(prior, feature({ id: 'a2' }));
    expect(prior.amenities?.features).toHaveLength(1);
  });
});

describe('removeAmenity', () => {
  it('drops only the matching id', () => {
    const prior = appendAmenity(appendAmenity(null, feature({ id: 'a1' })), feature({ id: 'a2' }));
    const cfg = removeAmenity(prior, 'a1');
    expect(cfg.amenities?.features.map((f) => f.properties.id)).toEqual(['a2']);
  });
  it('is a no-op for an absent id (keeps the collection)', () => {
    const prior = appendAmenity(null, feature({ id: 'a1' }));
    const cfg = removeAmenity(prior, 'nope');
    expect(cfg.amenities?.features.map((f) => f.properties.id)).toEqual(['a1']);
  });
  it('yields an empty collection (not undefined) on null config', () => {
    const cfg = removeAmenity(null, 'x');
    expect(cfg.amenities?.features).toEqual([]);
  });
});

describe('moveAmenity', () => {
  it('replaces the matching feature coordinate (in [lng, lat])', () => {
    const prior = appendAmenity(null, feature({ id: 'a1', lng: 1, lat: 2 }));
    const cfg = moveAmenity(prior, 'a1', { latitude: 40, longitude: 30 });
    expect(cfg.amenities?.features[0].geometry.coordinates).toEqual([30, 40]);
  });
  it('leaves other features and the label/type untouched', () => {
    const prior = appendAmenity(appendAmenity(null, feature({ id: 'a1', label: 'Keep' })), feature({ id: 'a2' }));
    const cfg = moveAmenity(prior, 'a2', { latitude: 5, longitude: 6 });
    expect(cfg.amenities?.features[0].properties.label).toBe('Keep');
    expect(cfg.amenities?.features[1].geometry.coordinates).toEqual([6, 5]);
  });
  it('rejects an out-of-range coord (config unchanged)', () => {
    const prior = appendAmenity(null, feature({ id: 'a1', lng: 1, lat: 2 }));
    const cfg = moveAmenity(prior, 'a1', { latitude: 999, longitude: 0 });
    expect(cfg.amenities?.features[0].geometry.coordinates).toEqual([1, 2]);
  });
});

describe('setAmenityLabel', () => {
  it('replaces the matching feature label (trimmed)', () => {
    const prior = appendAmenity(null, feature({ id: 'a1', label: 'old' }));
    const cfg = setAmenityLabel(prior, 'a1', '  New  ');
    expect(cfg.amenities?.features[0].properties.label).toBe('New');
  });
  it('falls back to the humanized type for a blank label', () => {
    const prior = appendAmenity(null, feature({ id: 'a1', label: 'old' }));
    const cfg = setAmenityLabel(prior, 'a1', '   ');
    expect(cfg.amenities?.features[0].properties.label).toBe('Water');
  });
});

describe('stageCoordFromTap', () => {
  it('passes through a valid coord', () => {
    expect(stageCoordFromTap({ latitude: 12, longitude: 34 })).toEqual({ latitude: 12, longitude: 34 });
  });
  it('clears to nulls for an invalid coord', () => {
    expect(stageCoordFromTap({ latitude: 999, longitude: 0 })).toEqual({ latitude: null, longitude: null });
    expect(stageCoordFromTap(null)).toEqual({ latitude: null, longitude: null });
  });
});

describe('captureCenter', () => {
  it('sets the center in [lng, lat] order', () => {
    const cfg = captureCenter(null, { latitude: 20, longitude: 10 });
    expect(cfg.center).toEqual([10, 20]);
    expect(cfg.version).toBe(1);
  });
  it('preserves existing amenities and rejects bad coords', () => {
    const prior = appendAmenity(null, feature({ id: 'a1' }));
    const ok = captureCenter(prior, { latitude: 1, longitude: 2 });
    expect(ok.center).toEqual([2, 1]);
    expect(ok.amenities?.features).toHaveLength(1);
    const bad = captureCenter(prior, { latitude: 1000, longitude: 0 });
    expect(bad.center).toBeUndefined();
  });
});

describe('amenityCount', () => {
  it('counts amenities; 0 for null', () => {
    expect(amenityCount(null)).toBe(0);
    expect(amenityCount(appendAmenity(null, feature({ id: 'a1' })))).toBe(1);
  });
});
