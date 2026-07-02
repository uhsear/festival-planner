// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import { extractZones, zoneLabels, zonesGeoJSON } from '@festie/shared/utils';
import type { GlMarker, GlRefObject, MapRefObject, MapStatus } from './mapDom';

type Zones = ReturnType<typeof extractZones>;

/**
 * Zone polygons (festival-mapped; filled translucent, UNDER every marker).
 * Rendered as a single GeoJSON source + fill + outline GL layer (data-driven
 * color) plus DOM label markers at each centroid. Source/layers added once, then
 * `setData` updates them. Zones read through a ref so deps stay honest
 * (`[status, zonesKey]`).
 */
export function useZoneLayer(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  zones: Zones,
  zonesKey: string,
  labelMarkersRef: MutableRefObject<GlMarker[]>,
): void {
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    const zoneList = zonesRef.current;
    // Typed via maplibre's own setData param so we don't depend on the ambient
    // GeoJSON namespace (not in scope in the web tsconfig). The struct from
    // zonesGeoJSON is a GeoJSON FeatureCollection in all but nominal type.
    type ZoneData = Parameters<import('maplibre-gl').GeoJSONSource['setData']>[0];
    const data = zonesGeoJSON(zoneList) as unknown as ZoneData;
    try {
      const existing = map.getSource('festie-zones') as import('maplibre-gl').GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource('festie-zones', { type: 'geojson', data });
        map.addLayer({
          id: 'festie-zones-fill',
          type: 'fill',
          source: 'festie-zones',
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
        });
        map.addLayer({
          id: 'festie-zones-line',
          type: 'line',
          source: 'festie-zones',
          paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.85 },
        });
      }
    } catch {
      // A transient style-not-ready race: the next zonesKey change (or the fit
      // effect) will re-attempt. Never tear the map down for a zone glitch.
    }

    // Rebuild the centroid label markers (DOM) for zones that carry a label.
    for (const m of labelMarkersRef.current) m.remove();
    labelMarkersRef.current = [];
    for (const z of zoneLabels(zoneList)) {
      const el = document.createElement('div');
      el.className = 'festie-zone-label';
      el.style.setProperty('--zone-color', z.color);
      el.setAttribute('aria-hidden', 'true');
      el.textContent = z.label;
      const marker = new gl.Marker({ element: el }).setLngLat([z.longitude, z.latitude]).addTo(map);
      labelMarkersRef.current.push(marker);
    }
  }, [status, zonesKey, mapRef, glRef, labelMarkersRef]);
}
