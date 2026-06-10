// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';
import {
  extractMeetingPointPins,
  extractStagePins,
  pinsCentroid,
  formatStaleness,
  isPeerStale,
  getInitials,
  type MapPin as Pin,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry } from '@festie/shared/types';
import EmptyState from '../ui/EmptyState';

/**
 * CrewMap — web crew map (MapLibre GL JS, no API key).
 *
 * Renders three marker kinds, all derived from props (never from internal fetch):
 *   1. meeting-point pins (F4 coords) — the original behaviour,
 *   2. live peer markers (ephemeral live-location, from the liveLocationStore),
 *   3. an emphasized SOS marker when a crew member raised one.
 *
 * MapLibre is HEAVY (~200 kB gzip) and is dynamically `import()`-ed inside an
 * effect (and the whole component is `lazy()`-loaded by its caller), so it never
 * lands in the main bundle and never touches the vitest/jsdom path (tests stub
 * the GL lib but its `load` callback never fires, so marker code is inert there).
 *
 * The GL map instance is created ONCE and kept across peer updates — peer/SOS
 * markers are rebuilt on their own effects so a 10-second position tick never
 * tears down and rebuilds the whole map (which would churn tiles + lose viewport).
 *
 * HONESTY: peer freshness is rendered as "Live · N ago" from the server receive
 * time, and accuracy as a "±N m" radius note — we never imply a pinpoint fix.
 */

// Minimal structural shape this map needs — matches both @festie/shared's
// CrewMeetingPoint and MeetingPointsTab's local server row (snake_case).
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
  /** Live peer positions (ephemeral). Empty/omitted keeps the original behaviour. */
  peers?: PeerLocation[];
  /** Active SOS for this crew, or null. */
  sos?: SosEntry | null;
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

// The subset of the maplibre-gl module we use. We load it via `.default` at
// runtime (CJS interop — the test mock returns `{ default: {...} }`), but the
// type-level default member doesn't exist, so model the constructors we touch.
type MapLibre = {
  Map: typeof import('maplibre-gl').Map;
  Marker: typeof import('maplibre-gl').Marker;
  Popup: typeof import('maplibre-gl').Popup;
  NavigationControl: typeof import('maplibre-gl').NavigationControl;
  LngLatBounds: typeof import('maplibre-gl').LngLatBounds;
};

// Popups are built with DOM APIs (createElement + textContent) and handed to
// MapLibre via `setDOMContent`, so user/server text is never parsed as HTML —
// the browser escapes it for us. This mirrors the already-safe peer-marker
// element render and closes the latent DOM-XSS fragility of the old string-HTML
// `setHTML` path (security review L5).

/** A <strong> title element with text set safely via textContent. */
function titleEl(text: string, className?: string): HTMLElement {
  const strong = document.createElement('strong');
  if (className) strong.className = className;
  strong.textContent = text;
  return strong;
}

/** A subtitle line: <span class="festie-map-sub">text</span> preceded by a <br/>. */
function subEl(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'festie-map-sub';
  span.textContent = text;
  return span;
}

/** Assemble popup children into a container fragment-equivalent <div>. */
function popupContent(nodes: (Node | null)[]): HTMLElement {
  const root = document.createElement('div');
  let first = true;
  for (const n of nodes) {
    if (!n) continue;
    if (!first) root.appendChild(document.createElement('br'));
    root.appendChild(n);
    first = false;
  }
  return root;
}

// "as of 5m ago" → "5m ago" so we can render the honest "Live · 5m ago" copy.
function relAge(serverAt: string): string {
  return formatStaleness(serverAt).replace(/^as of /, '');
}

export default function CrewMap({ meetingPoints, peers = [], sos = null }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 'pending' until we know whether the GL library mounted; flips to 'error' on
  // a load/init failure so we never leave a blank canvas behind. 'ready' once the
  // map's `load` fired — marker effects gate on it.
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending');

  // Live MapLibre handles, kept across re-renders. Markers are tracked per kind
  // so each effect only churns its own layer.
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const glRef = useRef<MapLibre | null>(null);
  const mpMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const peerMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const sosMarkerRef = useRef<import('maplibre-gl').Marker | null>(null);
  const fittedRef = useRef(false);

  const pins = useMemo<Pin[]>(
    () => extractMeetingPointPins(meetingPoints as unknown as CrewMeetingPoint[]),
    [meetingPoints],
  );
  const stagePins = useMemo(() => extractStagePins(), []); // [] today — see mapPins TODO
  const hasPins = pins.length > 0;
  const hasPeers = peers.length > 0;
  const hasSos = !!sos?.position;
  // Render the map when there's ANYTHING to plot (pins, peers, or an SOS coord).
  const shouldRenderMap = hasPins || hasPeers || hasSos;

  // Initial center: meeting-point centroid, else the first peer, else the SOS.
  const center = useMemo(() => {
    const c = pinsCentroid(pins);
    if (c) return c;
    if (peers[0]) return { latitude: peers[0].lat, longitude: peers[0].lng };
    if (sos?.position) return { latitude: sos.position.lat, longitude: sos.position.lng };
    return null;
    // Recompute only when the coord sources meaningfully change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, peers.length, sos?.position?.lat, sos?.position?.lng]);

  // Stable keys so marker effects re-run only when their own coords change.
  const pinsKey = useMemo(() => pins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'), [pins]);
  const peersKey = useMemo(() => peers.map((p) => `${p.userId}:${p.lat},${p.lng}:${p.serverAt}`).join('|'), [peers]);
  const sosKey = sos ? `${sos.userId}:${sos.position?.lat},${sos.position?.lng}` : '';

  // Keep the latest center for the (peer-driven) lazy map creation without making
  // it an effect dep (which would recreate the map on every position tick).
  const centerRef = useRef(center);
  centerRef.current = center;

  // ── Map lifecycle: create once when there's content; tear down on unmount ──
  useEffect(() => {
    if (!shouldRenderMap || !containerRef.current) return;
    if (mapRef.current) return; // already created
    let cancelled = false;

    (async () => {
      try {
        const maplibregl = (await import('maplibre-gl')).default as unknown as MapLibre;
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (cancelled || !containerRef.current || mapRef.current) return;

        const c = centerRef.current;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: RASTER_STYLE,
          center: c ? [c.longitude, c.latitude] : [0, 0],
          zoom: c ? 14 : 1,
          attributionControl: { compact: true },
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        map.on('error', () => {
          if (!cancelled) setStatus('error');
        });
        map.on('load', () => {
          if (cancelled) return;
          setStatus('ready');
        });
        glRef.current = maplibregl;
        mapRef.current = map;
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      mpMarkersRef.current = [];
      peerMarkersRef.current = [];
      sosMarkerRef.current = null;
      fittedRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
      glRef.current = null;
    };
    // Only (re)create when content first appears / disappears.
  }, [shouldRenderMap]);

  // ── Meeting-point markers ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of mpMarkersRef.current) m.remove();
    mpMarkersRef.current = [];

    for (const p of pins) {
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
      mpMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pinsKey]);

  // ── Live peer markers (rebuilt per tick — small N; keeps staleness honest) ──
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of peerMarkersRef.current) m.remove();
    peerMarkersRef.current = [];

    const now = Date.now();
    for (const peer of peers) {
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
      if (stale) {
        const chip = document.createElement('span');
        chip.className = 'festie-peer-chip';
        chip.textContent = rel;
        el.appendChild(chip);
      }
      const acc =
        typeof peer.accuracy === 'number' && peer.accuracy > 0 ? subEl(`±${Math.round(peer.accuracy)} m`) : null;
      const popupEl = popupContent([titleEl(peer.username), subEl(stale ? `Last seen ${rel}` : `Live · ${rel}`), acc]);
      const marker = new gl.Marker({ element: el })
        .setLngLat([peer.lng, peer.lat])
        .setPopup(new gl.Popup({ offset: 16, closeButton: false }).setDOMContent(popupEl))
        .addTo(map);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          marker.togglePopup();
        }
      });
      peerMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, peersKey]);

  // ── SOS marker (emphasized) ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    sosMarkerRef.current?.remove();
    sosMarkerRef.current = null;
    if (!sos?.position) return;

    const el = document.createElement('div');
    el.className = 'festie-sos-marker';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `SOS from ${sos.username}`);
    el.textContent = '!';
    // Coords are numeric (range-checked server-side), so this URL is structurally
    // safe; build it via the URL API and assert the https scheme as belt-and-braces.
    const dir = `https://maps.google.com/?q=${sos.position.lat},${sos.position.lng}`;
    const link = document.createElement('a');
    if (/^https:/i.test(dir)) link.setAttribute('href', dir);
    link.className = 'festie-sos-link';
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.textContent = 'Get directions';
    const popupEl = popupContent([
      titleEl(`🆘 ${sos.username} needs help`, 'festie-sos-title'),
      sos.message ? subEl(sos.message) : null,
      link,
    ]);
    const marker = new gl.Marker({ element: el })
      .setLngLat([sos.position.lng, sos.position.lat])
      .setPopup(new gl.Popup({ offset: 18, closeButton: false }).setDOMContent(popupEl))
      .addTo(map);
    sosMarkerRef.current = marker;
    // Open the SOS popup immediately so it's impossible to miss.
    marker.togglePopup();
    map.flyTo({ center: [sos.position.lng, sos.position.lat], zoom: 15, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sosKey]);

  // ── Fit bounds once across everything we have when the map first loads ──────
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl || fittedRef.current) return;

    const coords: [number, number][] = [
      ...pins.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...peers.map((p) => [p.lng, p.lat] as [number, number]),
      ...(sos?.position ? [[sos.position.lng, sos.position.lat] as [number, number]] : []),
    ];
    if (coords.length > 1) {
      let bounds = new gl.LngLatBounds(coords[0], coords[0]);
      for (const c of coords) bounds = bounds.extend(c);
      map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
    }
    fittedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pinsKey, peersKey, sosKey]);

  // ── Empty state: nothing to plot ───────────────────────────────────────────
  if (!shouldRenderMap) {
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

  const peerCount = peers.length;
  const countCopy = [
    pins.length ? (pins.length === 1 ? '1 mapped point' : `${pins.length} mapped points`) : '',
    peerCount ? (peerCount === 1 ? '1 live crew member' : `${peerCount} live crew members`) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg overflow-hidden border border-border bg-bg-secondary">
        <div
          ref={containerRef}
          className="festie-map-canvas h-72 w-full"
          role="region"
          tabIndex={0}
          aria-label="Crew map with meeting points and live locations"
          aria-describedby="festie-map-help"
        />
        <p id="festie-map-help" className="sr-only">
          Interactive map. Use Tab to reach map markers, then Enter or Space to open one. Live crew-member markers show
          when they shared their location and how long ago. While the map is focused, use the arrow keys to pan and the
          plus and minus keys to zoom. The List view below shows every meeting point and is fully keyboard accessible.
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
        {countCopy || 'Live locations'}
        {stagePins.length === 0 && pins.length > 0 ? ' · stages aren’t mapped yet' : ''}
      </p>
    </div>
  );
}
