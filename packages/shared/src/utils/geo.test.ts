import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  bearing,
  etaMinutes,
  formatStaleness,
  relativeArrowAngle,
  formatDistance,
  type Coord,
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
