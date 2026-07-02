// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef } from 'react';
import { extractSiteplan, siteplanImageSource } from '@festie/shared/utils';
import type { GlRefObject, MapRefObject, MapStatus } from './mapDom';

type Siteplan = ReturnType<typeof extractSiteplan>;

/**
 * Site-plan raster overlay (festival-mapped; UNDER zones + every marker). A
 * MapLibre `image` source + raster layer positioned by its 4 corners at the
 * configured opacity. Graceful: no siteplan ⇒ nothing added; clearing it removes
 * the layer. The siteplan is read through a ref so deps stay honest
 * (`[status, siteplanKey]`).
 */
export function useSiteplanLayer(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  siteplan: Siteplan,
  siteplanKey: string,
): void {
  const siteplanRef = useRef(siteplan);
  siteplanRef.current = siteplan;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    const SRC = 'festie-siteplan';
    const LAYER = 'festie-siteplan-layer';
    const src = siteplanImageSource(siteplanRef.current);
    try {
      if (!src) {
        // Cleared (or never present): tear down the layer + source if we added them.
        if (map.getLayer(LAYER)) map.removeLayer(LAYER);
        if (map.getSource(SRC)) map.removeSource(SRC);
        return;
      }
      // MapLibre's ImageSource wants a 4-tuple of [lng,lat]; our corners are
      // already in TL/TR/BR/BL order — assert the tuple shape for the typings.
      const coordinates = src.coordinates as unknown as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
      const existing = map.getSource(SRC) as import('maplibre-gl').ImageSource | undefined;
      if (existing) {
        existing.updateImage({ url: src.url, coordinates });
        if (map.getLayer(LAYER)) map.setPaintProperty(LAYER, 'raster-opacity', src.opacity);
      } else {
        map.addSource(SRC, { type: 'image', url: src.url, coordinates });
        map.addLayer({
          id: LAYER,
          type: 'raster',
          source: SRC,
          paint: { 'raster-opacity': src.opacity, 'raster-fade-duration': 0 },
        });
      }
    } catch {
      // Transient style-not-ready race: a later siteplanKey change re-attempts.
      // Never tear the map down for a site-plan glitch.
    }
  }, [status, siteplanKey, mapRef, glRef]);
}
