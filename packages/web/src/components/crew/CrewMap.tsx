// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';
import { extractMeetingPointPins, extractStagePins, pinsCentroid, type MapPin as Pin } from '@festie/shared/utils';
import type { CrewMeetingPoint } from '@festie/shared/types';
import EmptyState from '../ui/EmptyState';

/**
 * CrewMap — web meeting-point map (MapLibre GL JS, no API key).
 *
 * MapLibre is HEAVY (~200 kB gzip). It MUST NOT land in the main bundle, so:
 *   1. This component is `lazy()`-loaded by its caller (its own chunk), and
 *   2. `maplibre-gl` + its CSS are themselves `import()`-ed at runtime inside an
 *      effect, so even the map chunk only pulls the GL library once it mounts.
 *      That `import()` is also what keeps it out of the vitest/jsdom path —
 *      tests never mount the GL map, so WebGL is never touched.
 *
 * BASEMAP: a free OpenStreetMap raster style (no key). CDN-hosted tiles, so the
 * interactive basemap only renders with signal. If the GL library or tiles fail
 * we don't show a blank canvas — we surface an honest error state. Pins are
 * derived from F4 coords; meeting points without coords are simply not plotted
 * (the list view still shows them, so they're never lost).
 *
 * STAGES: stages have no coords in the data model today (see mapPins TODO) —
 * `extractStagePins()` returns [] by contract and we show an honest note rather
 * than implying stages are plotted.
 */

// Minimal structural shape this map needs — matches both @festie/shared's
// CrewMeetingPoint and MeetingPointsTab's local server row (snake_case). We only
// read the fields extractMeetingPointPins/the renderer use.
export interface MappableMeetingPoint {
  id: string;
  label: string;
  location?: string | null;
  active?: boolean;
  latitude?: number | null;
  longitude?: number | null;
}

interface Props {
  meetingPoints: MappableMeetingPoint[];
}

// A free OpenStreetMap raster style (no API key). Online-only basemap.
const RASTER_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function CrewMap({ meetingPoints }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 'pending' until we know whether the GL library mounted; flips to 'error' on
  // a load/init failure so we never leave a blank canvas behind.
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending');

  // Pins are pure business logic (shared util) — only active points with valid
  // F4 coords. Memoized by identity so the map effect doesn't churn.
  // extractMeetingPointPins only reads id/active/label/location/lat/lng; our
  // MappableMeetingPoint is that structural subset (matches both CrewMeetingPoint
  // and MeetingPointsTab's server row), so the cast is sound at runtime.
  const pins = useMemo<Pin[]>(
    () => extractMeetingPointPins(meetingPoints as unknown as CrewMeetingPoint[]),
    [meetingPoints],
  );
  const stagePins = useMemo(() => extractStagePins(), []); // [] today — see mapPins TODO
  const center = useMemo(() => pinsCentroid(pins), [pins]);
  const hasPins = pins.length > 0;

  // Stable key so the effect re-runs only when the actual coords change, not on
  // every parent render that produces a new array identity.
  const pinsKey = useMemo(() => pins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'), [pins]);

  useEffect(() => {
    if (!hasPins || !containerRef.current) return;
    let map: import('maplibre-gl').Map | null = null;
    let cancelled = false;

    (async () => {
      try {
        // Dynamic import: keeps maplibre-gl out of the main + even this chunk's
        // synchronous graph, and out of the jsdom test path entirely.
        const maplibregl = (await import('maplibre-gl')).default;
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (cancelled || !containerRef.current) return;

        map = new maplibregl.Map({
          container: containerRef.current,
          style: RASTER_STYLE,
          center: center ? [center.longitude, center.latitude] : [0, 0],
          zoom: center ? 14 : 1,
          attributionControl: { compact: true },
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        map.on('error', () => {
          if (!cancelled) setStatus('error');
        });

        map.on('load', () => {
          if (cancelled || !map) return;
          let bounds: import('maplibre-gl').LngLatBounds | null = null;
          for (const p of pins) {
            const el = document.createElement('div');
            el.className = 'festie-map-marker';
            // a11y: each marker is a DOM div MapLibre positions over the canvas.
            // Without a label/role/tabindex it's invisible to screen readers and
            // unreachable by keyboard. Expose it as a focusable button announcing
            // the meeting point (and its sublabel/location when present).
            el.setAttribute('aria-label', p.label + (p.sublabel ? ' - ' + p.sublabel : ''));
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            const popupHtml =
              `<strong>${escapeHtml(p.label)}</strong>` +
              (p.sublabel ? `<br/><span class="festie-map-sub">${escapeHtml(p.sublabel)}</span>` : '');
            const marker = new maplibregl.Marker({ element: el })
              .setLngLat([p.longitude, p.latitude])
              .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(popupHtml))
              .addTo(map);
            // a11y/keyboard: the marker advertises role=button + tabindex, so it
            // MUST be activatable by keyboard. MapLibre only wires a click handler,
            // leaving Enter/Space dead for keyboard users. Bridge them to the
            // popup toggle so focus-then-Enter opens the point, matching the
            // sr-only help text's promise.
            el.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                marker.togglePopup();
              }
            });
            const lngLat: [number, number] = [p.longitude, p.latitude];
            bounds = bounds ? bounds.extend(lngLat) : new maplibregl.LngLatBounds(lngLat, lngLat);
          }
          // Fit bounds to the pins. Single pin: keep the centered zoom above.
          if (bounds && pins.length > 1) {
            map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
          }
          setStatus('ready');
        });
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
    // pinsKey captures coord changes; center/pins are derived from the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey, hasPins]);

  // ── Empty state: no coord-bearing meeting points ────────────────────────────
  if (!hasPins) {
    return (
      <div className="px-1">
        <EmptyState
          icon={<MapPin className="w-12 h-12" aria-hidden="true" />}
          title="No mapped meeting points yet"
          description="Add a location to a meeting point to see it here."
        />
        {stagePins.length === 0 && (
          <p className="text-xs text-text-muted text-center mt-2">Stage locations aren&apos;t mapped yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg overflow-hidden border border-border bg-bg-secondary">
        <div
          ref={containerRef}
          className="festie-map-canvas h-72 w-full"
          role="region"
          tabIndex={0}
          aria-label="Crew meeting points map"
          aria-describedby="festie-map-help"
        />
        {/* a11y: MapLibre is canvas-based with no native focusable host. role=region
            + tabindex make the map area reachable; this sr-only note documents the
            library's keyboard shortcuts and points users to the list view (which
            shows every point, including ones without coords) as the accessible
            surface. */}
        <p id="festie-map-help" className="sr-only">
          Interactive map. Use Tab to reach map markers, then Enter or Space to open a point. While the map is focused,
          use the arrow keys to pan and the plus and minus keys to zoom. The List view below shows every meeting point
          and is fully keyboard accessible.
        </p>
        {status === 'pending' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-text-secondary bg-bg-secondary/80">
            Loading map…
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center bg-bg-secondary">
            <AlertTriangle className="w-8 h-8 text-accent-amber" aria-hidden="true" />
            <p className="text-sm text-text-secondary">
              Map needs signal to load. Your pinned points are still listed below.
            </p>
          </div>
        )}
      </div>
      <p className="text-xs text-text-muted text-center">
        {pins.length === 1 ? '1 mapped point' : `${pins.length} mapped points`}
        {stagePins.length === 0 ? ' · stages aren’t mapped yet' : ''}
      </p>
    </div>
  );
}
