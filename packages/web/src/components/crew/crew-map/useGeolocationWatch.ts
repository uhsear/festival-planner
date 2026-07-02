// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coord } from '@festie/shared/utils';

export type GeoState = 'idle' | 'locating' | 'denied' | 'on';

export interface GeolocationWatch {
  /** The user's own GPS fix, or null until they enable location / on failure. */
  selfCoord: Coord | null;
  geoState: GeoState;
  /** Start a continuous browser geolocation watch (idempotent while active). */
  enableLocation: () => void;
}

/**
 * Browser geolocation watch for pursue / nearest-X. A continuous `watchPosition`
 * keeps `selfCoord` fresh as the user moves so the arrow + ETA recompute live;
 * the watch is torn down on unmount. Extracted verbatim from CrewMap.
 */
export function useGeolocationWatch(): GeolocationWatch {
  const [selfCoord, setSelfCoord] = useState<Coord | null>(null);
  const [geoState, setGeoState] = useState<GeoState>('idle');
  const watchIdRef = useRef<number | null>(null);

  const enableLocation = useCallback(() => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      setGeoState('denied');
      return;
    }
    if (watchIdRef.current != null) return; // already watching
    setGeoState('locating');
    watchIdRef.current = geo.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setSelfCoord({ latitude, longitude });
          setGeoState('on');
        }
      },
      () => {
        setGeoState('denied');
        if (watchIdRef.current != null) {
          geo.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  }, []);

  // Tear the geolocation watch down on unmount.
  useEffect(() => {
    return () => {
      const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
      if (geo && watchIdRef.current != null) {
        geo.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return { selfCoord, geoState, enableLocation };
}
