// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * liveLocation.ts — publish-throttle math shared by the web + mobile live-location
 * publishers. Keeping this in one place guarantees both platforms throttle GPS
 * publishes identically (and conservatively). Pure: no platform deps.
 */

import { haversineDistance } from './geo';
import { LIVE_LOCATION } from '../constants/config';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Decide whether a freshly-read GPS fix should be published to the crew.
 *
 * Returns true when EITHER:
 *   • this is the first fix (no prior coord / no last-sent time), OR
 *   • at least UPDATE_INTERVAL_MS has elapsed since the last publish, OR
 *   • the device has moved more than MIN_MOVE_METERS since the last publish.
 *
 * This keeps a stationary phone quiet (battery + data) while still relaying
 * meaningful movement promptly. `now` and `lastSentAt` are epoch ms.
 */
export function shouldPublishLocation(
  prev: LatLng | null | undefined,
  next: LatLng,
  lastSentAt: number | null | undefined,
  now: number,
): boolean {
  if (!prev || lastSentAt == null) return true;
  if (now - lastSentAt >= LIVE_LOCATION.UPDATE_INTERVAL_MS) return true;
  const moved = haversineDistance(
    { latitude: prev.lat, longitude: prev.lng },
    { latitude: next.lat, longitude: next.lng },
  );
  return Number.isFinite(moved) && moved > LIVE_LOCATION.MIN_MOVE_METERS;
}
