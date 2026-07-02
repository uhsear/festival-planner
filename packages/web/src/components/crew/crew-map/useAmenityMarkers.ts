// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import { amenityGlyph, type MapPin as Pin } from '@festie/shared/utils';
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
 * Amenity markers (festival-mapped; category glyph + color). Keyed off the
 * VISIBLE set so toggling a filter chip re-runs this effect (hide/show); the pin
 * array is read through a ref so the deps stay honest (`[status, amenitiesKey]`).
 */
export function useAmenityMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  visibleAmenityPins: Pin[],
  amenitiesKey: string,
  markersRef: MutableRefObject<GlMarker[]>,
): void {
  const pinsRef = useRef(visibleAmenityPins);
  pinsRef.current = visibleAmenityPins;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const p of pinsRef.current) {
      const { glyph, color } = amenityGlyph(p.amenityType);
      const el = document.createElement('div');
      el.className = 'festie-amenity-marker';
      el.style.setProperty('--amenity-color', color);
      el.setAttribute('aria-label', `${p.amenityType ?? 'Amenity'}: ${p.label}`);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.textContent = glyph;
      const popupEl = popupContent([titleEl(p.label), p.amenityType ? subEl(p.amenityType) : null]);
      const marker = new gl.Marker({ element: el })
        .setLngLat([p.longitude, p.latitude])
        .setPopup(new gl.Popup({ offset: 14, closeButton: false }).setDOMContent(popupEl))
        .addTo(map);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          marker.togglePopup();
        }
      });
      markersRef.current.push(marker);
    }
  }, [status, amenitiesKey, mapRef, glRef, markersRef]);
}
