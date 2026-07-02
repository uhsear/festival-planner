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
 * Stage markers (festival-mapped; stage-colored, labelled). Rebuilt when a
 * stage's coord/color changes (via `stagesKey`); the pin array is read through a
 * ref so the deps stay honest (`[status, stagesKey]`).
 */
export function useStageMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  stagePins: Pin[],
  stagesKey: string,
  markersRef: MutableRefObject<GlMarker[]>,
): void {
  const stagePinsRef = useRef(stagePins);
  stagePinsRef.current = stagePins;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const p of stagePinsRef.current) {
      const el = document.createElement('div');
      el.className = 'festie-stage-marker';
      // Tint the marker with the stage's own brand color (falls back to the CSS
      // default in the stylesheet when absent).
      if (p.color) el.style.setProperty('--stage-color', p.color);
      el.setAttribute('aria-label', `Stage: ${p.label}`);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      // A small always-on label tag so stages read at a glance, distinct from the
      // coral meeting dots + aqua peer discs. Text via textContent (injection-safe).
      const tag = document.createElement('span');
      tag.className = 'festie-stage-tag';
      tag.textContent = p.label;
      el.appendChild(tag);
      const popupEl = popupContent([titleEl(p.label), subEl('Stage')]);
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
  }, [status, stagesKey, mapRef, glRef, markersRef]);
}
