// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { MapPin as Pin } from '@festie/shared/utils';
import {
  popupContent,
  subEl,
  titleEl,
  type GlMarker,
  type GlRefObject,
  type MapRefObject,
  type MapStatus,
} from './mapDom';

/**
 * Meeting-point markers. Rebuilt when the pins' coords change (via `pinsKey`);
 * the live pin array is read through a ref so the effect's deps stay honest
 * (`[status, pinsKey]`) without an exhaustive-deps suppression.
 */
export function useMeetingPointMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  pins: Pin[],
  pinsKey: string,
  markersRef: MutableRefObject<GlMarker[]>,
): void {
  const pinsRef = useRef(pins);
  pinsRef.current = pins;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const p of pinsRef.current) {
      const el = document.createElement('div');
      el.className = 'festie-map-marker';
      // a11y: each marker is a div MapLibre positions over the canvas. Expose it
      // as a focusable button announcing the meeting point.
      el.setAttribute('aria-label', p.label + (p.sublabel ? ' - ' + p.sublabel : ''));
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      const popupEl = popupContent([titleEl(p.label), p.sublabel ? subEl(p.sublabel) : null]);
      const marker = new gl.Marker({ element: el })
        .setLngLat([p.longitude, p.latitude])
        .setPopup(new gl.Popup({ offset: 16, closeButton: false }).setDOMContent(popupEl))
        .addTo(map);
      // Bridge Enter/Space → popup toggle (MapLibre only wires click).
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          marker.togglePopup();
        }
      });
      markersRef.current.push(marker);
    }
  }, [status, pinsKey, mapRef, glRef, markersRef]);
}
