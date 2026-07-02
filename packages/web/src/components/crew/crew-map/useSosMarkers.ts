// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { SosEntry } from '@festie/shared/types';
import {
  popupContent,
  subEl,
  titleEl,
  type GlMarker,
  type GlRefObject,
  type MapRefObject,
  type MapStatus,
  type PursueTarget,
} from './mapDom';

/**
 * SOS markers (emphasized; one per active SOS). Two effects, cohesive:
 *  1. build/reconcile keyed on the IDENTITY set (`sosIdsKey`) — add new, drop
 *     cleared, and frame each EXACTLY once on first appearance (fly + open);
 *  2. reposition keyed on the COORD set (`sosCoordsKey`) — slide existing
 *     markers to the latest coord without re-flying/re-opening.
 *
 * The live `sosList` is read through a ref so both effects keep honest deps.
 */
export function useSosMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  sosList: SosEntry[],
  sosIdsKey: string,
  sosCoordsKey: string,
  markersRef: MutableRefObject<Map<string, GlMarker>>,
  framedRef: MutableRefObject<Set<string>>,
  selectPursue: (next: PursueTarget) => void,
): void {
  const sosListRef = useRef(sosList);
  sosListRef.current = sosList;

  // ── Build / reconcile (identity set) ──
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    const markers = markersRef.current;
    const list = sosListRef.current;
    const present = new Set(list.filter((s) => s.position).map((s) => s.userId));

    // Remove markers for SOS that cleared (and forget their framed flag so a
    // later re-raise from the same user frames again).
    for (const [uid, marker] of markers) {
      if (!present.has(uid)) {
        marker.remove();
        markers.delete(uid);
        framedRef.current.delete(uid);
      }
    }

    // Add a marker for each newly-present SOS.
    for (const s of list) {
      if (!s.position || markers.has(s.userId)) continue;
      const { lat, lng } = s.position;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const el = document.createElement('div');
      el.className = 'festie-sos-marker';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `SOS from ${s.username}`);
      el.textContent = '!';
      // Coords are numeric (range-checked server-side), so this URL is structurally
      // safe; build it via the URL API and assert the https scheme as belt-and-braces.
      const dir = `https://maps.google.com/?q=${lat},${lng}`;
      const link = document.createElement('a');
      if (/^https:/i.test(dir)) link.setAttribute('href', dir);
      link.className = 'festie-sos-link';
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.textContent = 'Get directions';
      const popupEl = popupContent([
        titleEl(`🆘 ${s.username} needs help`, 'festie-sos-title'),
        s.message ? subEl(s.message) : null,
        link,
      ]);
      const marker = new gl.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(new gl.Popup({ offset: 18, closeButton: false }).setDOMContent(popupEl))
        .addTo(map);
      // Tapping the SOS marker pursues it (arrow + ETA toward the person in need).
      const sosTarget: PursueTarget = {
        id: `sos:${s.userId}`,
        label: `${s.username} — SOS`,
        coord: { latitude: lat, longitude: lng },
      };
      el.addEventListener('click', () => selectPursue(sosTarget));
      markers.set(s.userId, marker);
      // Open the popup + fly to it ONCE on first appearance so it's impossible to
      // miss. Subsequent coord ticks reposition via the effect below — they never
      // re-fly or re-open. With several at once the last-framed wins the camera.
      if (!framedRef.current.has(s.userId)) {
        framedRef.current.add(s.userId);
        marker.togglePopup();
        map.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
      }
    }
  }, [status, sosIdsKey, selectPursue, mapRef, glRef, markersRef, framedRef]);

  // ── Reposition (coord ticks only — no re-fly/re-open) ──
  useEffect(() => {
    if (status !== 'ready') return;
    const markers = markersRef.current;
    for (const s of sosListRef.current) {
      if (!s.position) continue;
      const marker = markers.get(s.userId);
      if (!marker) continue;
      const { lat, lng } = s.position;
      if (Number.isFinite(lat) && Number.isFinite(lng)) marker.setLngLat([lng, lat]);
    }
  }, [status, sosCoordsKey, markersRef]);
}
