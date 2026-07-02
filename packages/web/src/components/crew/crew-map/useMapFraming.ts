// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import { extractSiteplan, extractZones, pickFestivalCamera, type MapPin as Pin } from '@festie/shared/utils';
import type { PeerLocation, SosEntry } from '@festie/shared/types';
import type { GlRefObject, MapRefObject, MapStatus } from './mapDom';

interface FrameData {
  pins: Pin[];
  stagePins: Pin[];
  amenityPins: Pin[];
  zones: ReturnType<typeof extractZones>;
  siteplan: ReturnType<typeof extractSiteplan>;
  peers: PeerLocation[];
  sosList: SosEntry[];
}

interface FrameKeys {
  pinsKey: string;
  stagesKey: string;
  allAmenitiesKey: string;
  zonesKey: string;
  siteplanKey: string;
  peersKey: string;
  sosIdsKey: string;
}

/**
 * Frame the camera EXACTLY once when the map first loads. Precedence (via
 * pickFestivalCamera): explicit map-config bounds win — fit the festival grounds.
 * Otherwise fit the union of everything plottable (meeting points + stages +
 * amenities + zone vertices + site-plan corners + live peers + SOS). Guarded by
 * `fittedRef` so it never re-frames. Coord sources read through a ref so the deps
 * stay honest — the effect responds only to the listed status + content keys.
 */
export function useMapFraming(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  data: FrameData,
  keys: FrameKeys,
  cameraRef: MutableRefObject<ReturnType<typeof pickFestivalCamera>>,
  fittedRef: MutableRefObject<boolean>,
): void {
  const dataRef = useRef(data);
  dataRef.current = data;

  const { pinsKey, stagesKey, allAmenitiesKey, zonesKey, siteplanKey, peersKey, sosIdsKey } = keys;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl || fittedRef.current) return;

    const { pins, stagePins, amenityPins, zones, siteplan, peers, sosList } = dataRef.current;

    // 1. Explicit festival bounds — frame the grounds.
    const cfgBounds = cameraRef.current.bounds;
    if (cfgBounds) {
      const [[west, south], [east, north]] = cfgBounds;
      map.fitBounds(new gl.LngLatBounds([west, south], [east, north]), { padding: 56, maxZoom: 17, duration: 0 });
      fittedRef.current = true;
      return;
    }

    // 2. Fit the union of all plottable coords.
    const coords: [number, number][] = [
      ...pins.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...stagePins.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...amenityPins.map((p) => [p.longitude, p.latitude] as [number, number]),
      // Every zone vertex so the grounds frame includes the drawn areas.
      ...zones.flatMap((z) => z.rings.flat()),
      // Site-plan corners so a siteplan-only festival still frames its grounds.
      ...(siteplan ? siteplan.corners : []),
      ...peers.map((p) => [p.lng, p.lat] as [number, number]),
      ...sosList.filter((s) => s.position).map((s) => [s.position!.lng, s.position!.lat] as [number, number]),
    ];
    if (coords.length > 1) {
      let bounds = new gl.LngLatBounds(coords[0], coords[0]);
      for (const c of coords) bounds = bounds.extend(c);
      map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
    }
    fittedRef.current = true;
  }, [
    status,
    pinsKey,
    stagesKey,
    allAmenitiesKey,
    zonesKey,
    siteplanKey,
    peersKey,
    sosIdsKey,
    mapRef,
    glRef,
    cameraRef,
    fittedRef,
  ]);
}
