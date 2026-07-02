import { useCallback, useState } from 'react';

export interface CurrentPositionCoords {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface UseCurrentPositionReturn {
  /** True while a `getCurrentPosition` call is in flight. */
  locating: boolean;
  /**
   * Request a one-shot device position. Resolves `undefined` (never rejects)
   * on denial/timeout/unsupported device — `onError` is called with a
   * human-readable message so callers can surface it (e.g. via toast).
   */
  getCurrentPosition: (onError?: (message: string) => void) => Promise<CurrentPositionCoords | undefined>;
}

/**
 * Wraps the browser Geolocation one-shot lookup (`navigator.geolocation.getCurrentPosition`)
 * with a `locating` loading flag and an error callback, mirroring the pattern duplicated
 * across web's MeetingPointsTab/CrewStatus/LiveLocationControls. Web-only: guards
 * `typeof navigator` so it's a safe no-op (resolves undefined) on React Native.
 */
export function useCurrentPosition(): UseCurrentPositionReturn {
  const [locating, setLocating] = useState(false);

  const getCurrentPosition = useCallback((onError?: (message: string) => void) => {
    return new Promise<CurrentPositionCoords | undefined>((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        onError?.('Location is not available on this device');
        resolve(undefined);
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
          });
        },
        (err) => {
          setLocating(false);
          onError?.(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission denied'
              : "Couldn't get your location",
          );
          resolve(undefined);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    });
  }, []);

  return { locating, getCurrentPosition };
}
