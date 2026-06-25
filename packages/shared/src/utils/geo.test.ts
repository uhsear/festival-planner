import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  bearing,
  etaMinutes,
  formatStaleness,
  relativeArrowAngle,
  formatDistance,
  haversineMeters,
  initialBearingDeg,
  compass8,
  etaWalkMinutes,
  formatEta,
  nearestPin,
  buildPursuit,
  type Coord,
  type GeoPoint,
} from './geo';

// Two reference points ~1.11 km apart (0.01° of latitude at the equator-ish).
const A: Coord = { latitude: 40.0, longitude: -74.0 };
const B: Coord = { latitude: 40.01, longitude: -74.0 }; // due north of A

describe('geo.haversineDistance', () => {
  it('returns ~0 for identical coords', () => {
    expect(haversineDistance(A, A)).toBeCloseTo(0, 5);
  });

  it('computes ~1112 m for 0.01° of latitude', () => {
    const d = haversineDistance(A, B);
    // 0.01° latitude ≈ 1111.95 m; allow a small tolerance.
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });

  it('is symmetric', () => {
    expect(haversineDistance(A, B)).toBeCloseTo(haversineDistance(B, A), 6);
  });

  it('returns NaN for null / invalid coords', () => {
    expect(Number.isNaN(haversineDistance(null, B))).toBe(true);
    expect(Number.isNaN(haversineDistance(A, undefined))).toBe(true);
    expect(Number.isNaN(haversineDistance({ latitude: NaN, longitude: 0 }, B))).toBe(true);
  });
});

describe('geo.bearing', () => {
  it('points ~north (0°) when the target is due north', () => {
    const b = bearing(A, B);
    // Allow a tiny tolerance around 0/360.
    expect(b < 1 || b > 359).toBe(true);
  });

  it('points ~east (90°) when the target is due east', () => {
    const east: Coord = { latitude: 40.0, longitude: -73.99 };
    expect(bearing(A, east)).toBeGreaterThan(89);
    expect(bearing(A, east)).toBeLessThan(91);
  });

  it('returns NaN for invalid coords', () => {
    expect(Number.isNaN(bearing(A, null))).toBe(true);
  });
});

describe('geo.etaMinutes', () => {
  it('returns 0 for identical coords', () => {
    expect(etaMinutes(A, A)).toBe(0);
  });

  it('returns a positive whole-minute estimate for a real distance', () => {
    // ~1112 m / 1.25 m/s / 60 ≈ 14.8 min → ceil = 15.
    const eta = etaMinutes(A, B);
    expect(eta).toBe(15);
  });

  it('clamps a tiny non-zero distance up to at least 1 minute', () => {
    const near: Coord = { latitude: 40.00001, longitude: -74.0 };
    expect(etaMinutes(A, near)).toBe(1);
  });

  it('returns null when a coord is missing (no geo ETA available)', () => {
    expect(etaMinutes(A, null)).toBeNull();
    expect(etaMinutes(undefined, B)).toBeNull();
  });
});

describe('geo.relativeArrowAngle', () => {
  it('returns the bearing unchanged when heading is 0 (north-up)', () => {
    expect(relativeArrowAngle(90, 0)).toBe(90);
  });

  it('points the arrow straight up (0°) when facing the target', () => {
    expect(relativeArrowAngle(90, 90)).toBe(0);
  });

  it('normalizes a negative result into [0, 360)', () => {
    // Target due north (0°), device facing east (90°) → arrow at 270° (to the left).
    expect(relativeArrowAngle(0, 90)).toBe(270);
  });

  it('treats a non-finite heading as 0', () => {
    expect(relativeArrowAngle(45, NaN)).toBe(45);
  });

  it('returns NaN when the bearing is not finite (no fix)', () => {
    expect(Number.isNaN(relativeArrowAngle(NaN, 10))).toBe(true);
  });
});

describe('geo.formatDistance', () => {
  it('rounds sub-km distances to the nearest 10 metres', () => {
    expect(formatDistance(123)).toBe('120 m');
    expect(formatDistance(0)).toBe('0 m');
  });

  it('reads km to one decimal at or above 1 km', () => {
    expect(formatDistance(1400)).toBe('1.4 km');
    expect(formatDistance(1000)).toBe('1.0 km');
  });

  it('returns an em-dash for NaN / negative (missing coords)', () => {
    expect(formatDistance(NaN)).toBe('—');
    expect(formatDistance(-5)).toBe('—');
  });
});

describe('geo.haversineMeters (metre-first alias)', () => {
  it('matches haversineDistance exactly', () => {
    expect(haversineMeters(A, B)).toBe(haversineDistance(A, B));
  });

  it('is ~0 for identical coords and ~max for antipodal points', () => {
    expect(haversineMeters(A, A)).toBeCloseTo(0, 5);
    const north: Coord = { latitude: 0, longitude: 0 };
    const anti: Coord = { latitude: 0, longitude: 180 }; // antipodal across the equator
    // Half the Earth's circumference ≈ π · 6 371 000 ≈ 20 015 086 m.
    expect(haversineMeters(north, anti)).toBeCloseTo(Math.PI * 6_371_000, -2);
  });

  it('returns NaN for invalid coords', () => {
    expect(Number.isNaN(haversineMeters(null, B))).toBe(true);
  });
});

describe('geo.initialBearingDeg (alias) + compass8', () => {
  it('aliases bearing', () => {
    expect(initialBearingDeg(A, B)).toBe(bearing(A, B));
  });

  it('snaps the four cardinal quadrants', () => {
    expect(compass8(0)).toBe('N');
    expect(compass8(90)).toBe('E');
    expect(compass8(180)).toBe('S');
    expect(compass8(270)).toBe('W');
  });

  it('snaps the four intercardinal quadrants', () => {
    expect(compass8(45)).toBe('NE');
    expect(compass8(135)).toBe('SE');
    expect(compass8(225)).toBe('SW');
    expect(compass8(315)).toBe('NW');
  });

  it('rounds to the nearest sector (boundary behaviour)', () => {
    expect(compass8(22)).toBe('N'); // just below the NE boundary
    expect(compass8(23)).toBe('NE'); // just above it
    expect(compass8(359)).toBe('N'); // wraps back to north
  });

  it('normalises out-of-range and treats 360 as north', () => {
    expect(compass8(360)).toBe('N');
    expect(compass8(-90)).toBe('W');
    expect(compass8(720 + 90)).toBe('E');
  });

  it('returns null for a non-finite bearing (no fix)', () => {
    expect(compass8(NaN)).toBeNull();
    expect(compass8(Infinity)).toBeNull();
  });
});

describe('geo.etaWalkMinutes (metre-input) + formatEta', () => {
  it('returns 0 for zero distance', () => {
    expect(etaWalkMinutes(0)).toBe(0);
  });

  it('rounds UP and clamps a tiny positive distance to 1 min', () => {
    expect(etaWalkMinutes(1)).toBe(1);
    expect(etaWalkMinutes(60)).toBe(1); // 60 m / 1.3 / 60 ≈ 0.77 → ceil 1
  });

  it('uses the default 1.3 m/s pace', () => {
    // 1300 m / 1.3 / 60 ≈ 16.67 → ceil 17.
    expect(etaWalkMinutes(1300)).toBe(17);
  });

  it('honours a custom pace and falls back when pace is non-positive', () => {
    // 600 m / 2 / 60 = 5 min exactly.
    expect(etaWalkMinutes(600, 2)).toBe(5);
    // pace 0 → default 1.3: 600 / 1.3 / 60 ≈ 7.69 → 8.
    expect(etaWalkMinutes(600, 0)).toBe(8);
    expect(etaWalkMinutes(600, -1)).toBe(8);
  });

  it('returns null for non-finite / negative distance', () => {
    expect(etaWalkMinutes(NaN)).toBeNull();
    expect(etaWalkMinutes(-10)).toBeNull();
  });

  it('formats minutes into human labels', () => {
    expect(formatEta(null)).toBe('—');
    expect(formatEta(NaN)).toBe('—');
    expect(formatEta(0)).toBe('now');
    expect(formatEta(4)).toBe('4 min');
    expect(formatEta(59)).toBe('59 min');
    expect(formatEta(60)).toBe('1h');
    expect(formatEta(75)).toBe('1h 15m');
    expect(formatEta(120)).toBe('2h');
  });
});

describe('geo.nearestPin', () => {
  const from: Coord = { latitude: 40.0, longitude: -74.0 };
  const pins: (GeoPoint & { id: string; kind: string })[] = [
    { id: 'far', kind: 'stage', latitude: 40.05, longitude: -74.0 }, // ~5.5 km north
    { id: 'near', kind: 'amenity', latitude: 40.001, longitude: -74.0 }, // ~111 m north
    { id: 'mid', kind: 'stage', latitude: 40.01, longitude: -74.0 }, // ~1.1 km north
  ];

  it('returns the closest pin and its distance', () => {
    const result = nearestPin(from, pins);
    expect(result?.pin.id).toBe('near');
    expect(result?.distanceM).toBeGreaterThan(100);
    expect(result?.distanceM).toBeLessThan(130);
  });

  it('applies a predicate filter (e.g. only stages)', () => {
    const result = nearestPin(from, pins, (p) => p.kind === 'stage');
    expect(result?.pin.id).toBe('mid'); // 'near' is an amenity, filtered out
  });

  it('skips pins with invalid coords', () => {
    const withBad: (GeoPoint & { id: string })[] = [
      { id: 'bad', latitude: NaN, longitude: -74.0 },
      { id: 'ok', latitude: 40.002, longitude: -74.0 },
    ];
    expect(nearestPin(from, withBad)?.pin.id).toBe('ok');
  });

  it('returns null for invalid origin, empty list, or no predicate match', () => {
    expect(nearestPin(null, pins)).toBeNull();
    expect(nearestPin(from, [])).toBeNull();
    expect(nearestPin(from, undefined)).toBeNull();
    expect(nearestPin(from, pins, () => false)).toBeNull();
  });
});

describe('geo.buildPursuit', () => {
  const self: Coord = { latitude: 40.0, longitude: -74.0 };
  const target: Coord = { latitude: 40.01, longitude: -74.0 }; // due north, ~1.1 km

  it('bundles bearing, distance, label, compass, and ETA for a real target', () => {
    const p = buildPursuit(self, target);
    expect(p.bearingDeg < 1 || p.bearingDeg > 359).toBe(true);
    expect(p.compass).toBe('N');
    expect(p.distanceM).toBeGreaterThan(1100);
    expect(p.distanceM).toBeLessThan(1120);
    expect(p.distanceLabel).toMatch(/km$/);
    // ~1112 m / 1.3 / 60 ≈ 14.3 → 15 min.
    expect(p.etaLabel).toBe('15 min');
  });

  it('reads "now" / "0 m" for a coincident self+target', () => {
    const p = buildPursuit(self, self);
    expect(p.distanceM).toBeCloseTo(0, 5);
    expect(p.distanceLabel).toBe('0 m');
    expect(p.etaLabel).toBe('now');
  });

  it('degrades gracefully when a coord is missing (no fix)', () => {
    const p = buildPursuit(self, null);
    expect(Number.isNaN(p.distanceM)).toBe(true);
    expect(Number.isNaN(p.bearingDeg)).toBe(true);
    expect(p.distanceLabel).toBe('—');
    expect(p.compass).toBeNull();
    expect(p.etaLabel).toBe('—');
  });
});

describe('geo.formatStaleness (honest "as of N ago", never live)', () => {
  it('reads "as of just now" for a fresh timestamp', () => {
    expect(formatStaleness(Date.now())).toBe('as of just now');
  });

  it('reads minutes for a few minutes ago', () => {
    expect(formatStaleness(Date.now() - 5 * 60_000)).toBe('as of 5m ago');
  });

  it('reads hours for a few hours ago', () => {
    expect(formatStaleness(Date.now() - 3 * 3600_000)).toBe('as of 3h ago');
  });

  it('reads days for a couple days ago', () => {
    expect(formatStaleness(Date.now() - 2 * 86_400_000)).toBe('as of 2d ago');
  });

  it('accepts an ISO date string (the backend updated_at shape)', () => {
    const iso = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(formatStaleness(iso)).toBe('as of 10m ago');
  });

  it('collapses a missing / future / invalid timestamp to "as of just now"', () => {
    expect(formatStaleness(null)).toBe('as of just now');
    expect(formatStaleness(undefined)).toBe('as of just now');
    expect(formatStaleness('not-a-date')).toBe('as of just now');
    expect(formatStaleness(Date.now() + 60_000)).toBe('as of just now');
  });

  it('never includes the word "live"', () => {
    expect(formatStaleness(Date.now() - 90 * 60_000)).not.toMatch(/live/i);
  });
});
