import { describe, it, expect } from 'vitest';
import { shouldPublishLocation, type LatLng } from './liveLocation';
import { LIVE_LOCATION } from '../constants/config';

const NOW = 1_000_000;
const A: LatLng = { lat: 40.0, lng: -74.0 };

describe('liveLocation.shouldPublishLocation', () => {
  it('publishes the first fix when there is no prior coord', () => {
    expect(shouldPublishLocation(null, A, NOW, NOW)).toBe(true);
    expect(shouldPublishLocation(undefined, A, NOW, NOW)).toBe(true);
  });

  it('publishes the first fix when lastSentAt is missing even with a prior coord', () => {
    expect(shouldPublishLocation(A, A, null, NOW)).toBe(true);
    expect(shouldPublishLocation(A, A, undefined, NOW)).toBe(true);
  });

  it('publishes once the update interval has elapsed even if stationary', () => {
    const last = NOW - LIVE_LOCATION.UPDATE_INTERVAL_MS;
    expect(shouldPublishLocation(A, A, last, NOW)).toBe(true);
  });

  it('does NOT publish a stationary phone before the interval elapses', () => {
    const last = NOW - (LIVE_LOCATION.UPDATE_INTERVAL_MS - 1);
    expect(shouldPublishLocation(A, A, last, NOW)).toBe(false);
  });

  it('publishes early when moved more than MIN_MOVE_METERS within the interval', () => {
    // ~0.01° latitude ≈ 1112 m, far beyond MIN_MOVE_METERS.
    const moved: LatLng = { lat: 40.01, lng: -74.0 };
    const last = NOW - 1_000; // within the interval
    expect(shouldPublishLocation(A, moved, last, NOW)).toBe(true);
  });

  it('does NOT publish for a sub-threshold jitter within the interval', () => {
    // ~1e-5° latitude ≈ 1.1 m, below MIN_MOVE_METERS (15 m).
    const jitter: LatLng = { lat: 40.00001, lng: -74.0 };
    const last = NOW - 1_000;
    expect(shouldPublishLocation(A, jitter, last, NOW)).toBe(false);
  });

  it('treats the interval boundary (>=) as elapsed', () => {
    const last = NOW - LIVE_LOCATION.UPDATE_INTERVAL_MS; // exactly the interval
    expect(shouldPublishLocation(A, A, last, NOW)).toBe(true);
  });
});
