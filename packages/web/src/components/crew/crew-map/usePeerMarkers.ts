// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  formatBatteryLabel,
  formatShareWindow,
  getInitials,
  headingToArrow,
  isPeerStale,
} from '@festie/shared/utils';
import type { PeerLocation } from '@festie/shared/types';
import {
  popupContent,
  relAge,
  subEl,
  titleEl,
  type GlMarker,
  type GlRefObject,
  type MapRefObject,
  type MapStatus,
  type PursueTarget,
} from './mapDom';

/**
 * Live peer markers (rebuilt per tick — small N; keeps staleness honest). The
 * peers array is read through a ref so the effect deps stay honest
 * (`[status, peersKey, selectPursue]`) without an exhaustive-deps suppression.
 */
export function usePeerMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  peers: PeerLocation[],
  peersKey: string,
  markersRef: MutableRefObject<GlMarker[]>,
  selectPursue: (next: PursueTarget) => void,
): void {
  const peersRef = useRef(peers);
  peersRef.current = peers;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const now = Date.now();
    for (const peer of peersRef.current) {
      const rel = relAge(peer.serverAt);
      const stale = isPeerStale(peer.serverAt, now);
      const initials = getInitials(peer.username || 'User') || '?';
      const el = document.createElement('div');
      // Stale (Snap Map-style): desaturated, no pulse, "last seen N ago" chip.
      el.className = stale ? 'festie-peer-marker festie-peer-marker--stale' : 'festie-peer-marker';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${peer.username} — ${stale ? `last seen ${rel}` : `live location, ${rel}`}`);
      // Pulsing ring (CSS ::before) + initials, then a chip for stale peers. All
      // text via textContent keeps it injection-safe.
      const iniEl = document.createElement('span');
      iniEl.textContent = initials;
      el.appendChild(iniEl);
      // Phase 4C: direction-of-travel pointer — a caret rotated by the GPS course.
      // Only for live peers with a real heading (a stationary fix reports none).
      const arrowGlyph = stale ? null : headingToArrow(peer.heading);
      if (arrowGlyph && typeof peer.heading === 'number') {
        const dir = document.createElement('span');
        dir.className = 'festie-peer-heading';
        dir.setAttribute('aria-hidden', 'true');
        dir.textContent = '▲';
        dir.style.transform = `translateX(-50%) rotate(${peer.heading}deg)`;
        el.appendChild(dir);
      }
      if (stale) {
        const chip = document.createElement('span');
        chip.className = 'festie-peer-chip';
        chip.textContent = rel;
        el.appendChild(chip);
      }
      const acc =
        typeof peer.accuracy === 'number' && peer.accuracy > 0 ? subEl(`±${Math.round(peer.accuracy)} m`) : null;
      // Phase 4C popup chips: heading arrow, battery ("8% — regroup"), and the
      // remaining share window ("sharing ends in Nm"). Each omitted when absent.
      const headingLabel = arrowGlyph ? subEl(`Heading ${arrowGlyph}`) : null;
      const batteryLabel = !stale ? (formatBatteryLabel(peer.battery) ?? null) : null;
      const batteryEl = batteryLabel ? subEl(`Battery ${batteryLabel}`) : null;
      // Low-power cue (#5): mirrors the mobile OfflineMap "🍃 Low Power" chip —
      // shown next to the battery chip when the sharer's device is in battery-saver
      // mode. Omitted for stale peers and when the flag is absent.
      const lowPowerEl = !stale && peer.lowPower === true ? subEl('🍃 Low Power') : null;
      const windowLabel = !stale ? formatShareWindow(peer.expiresAt, now) : null;
      const windowEl = windowLabel ? subEl(windowLabel) : null;
      const popupEl = popupContent([
        titleEl(peer.username),
        subEl(stale ? `Last seen ${rel}` : `Live · ${rel}`),
        headingLabel,
        batteryEl,
        lowPowerEl,
        windowEl,
        acc,
      ]);
      const marker = new gl.Marker({ element: el })
        .setLngLat([peer.lng, peer.lat])
        .setPopup(new gl.Popup({ offset: 16, closeButton: false }).setDOMContent(popupEl))
        .addTo(map);
      // Click/Enter selects this peer as the pursue target (arrow + ETA toward
      // them). Tapping the same target again clears it (handled in selectPursue).
      const target: PursueTarget = {
        id: `peer:${peer.userId}`,
        label: peer.username || 'Crew member',
        coord: { latitude: peer.lat, longitude: peer.lng },
      };
      el.addEventListener('click', () => selectPursue(target));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          marker.togglePopup();
          selectPursue(target);
        }
      });
      markersRef.current.push(marker);
    }
  }, [status, peersKey, selectPursue, mapRef, glRef, markersRef]);
}
