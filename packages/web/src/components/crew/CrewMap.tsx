// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';
import {
  extractMeetingPointPins,
  extractStagePins,
  extractAmenityPins,
  amenityGlyph,
  pickFestivalCamera,
  formatStaleness,
  isPeerStale,
  getInitials,
  type MapPin as Pin,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry, Festival, Stage } from '@festie/shared/types';
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
  /**
   * The current festival, carrying `mapConfig` (amenities + camera) and — when
   * the caller folds the store's separate `stages` array in — `stages[]` for
   * stage pins. Omitted/null keeps the original meeting-points-only behaviour and
   * the "not mapped yet" fallback. Backward-compatible: a festival with no map
   * data yields no stage/amenity pins and no map-config camera.
   */
  festival?: (Festival & { stages?: Stage[] }) | null;
  /**
   * Admin authoring hook (Phase D). When provided, a click anywhere on the map
   * reports its coordinate so the festival-map editor can place/move a stage pin
   * or drop an amenity. Omitted (the default) leaves the map read-only — exactly
   * the prior behaviour. Web uses maplibre's native `click` event directly; no
   * WebView bridge involved (that's mobile-only).
   */
  onMapClick?: (coord: { latitude: number; longitude: number }) => void;
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

export default function CrewMap({ meetingPoints, peers = [], sos = null, festival = null, onMapClick }: Props) {
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
  const stageMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const amenityMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const peerMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const sosMarkerRef = useRef<import('maplibre-gl').Marker | null>(null);
  const fittedRef = useRef(false);

  const pins = useMemo<Pin[]>(
    () => extractMeetingPointPins(meetingPoints as unknown as CrewMeetingPoint[]),
    [meetingPoints],
  );
  // Stage + amenity pins from the festival's map data (Phase A/B contract).
  // Empty for festivals that were never mapped — the "not mapped yet" note stays.
  const stagePins = useMemo<Pin[]>(() => extractStagePins(festival), [festival]);
  const amenityPins = useMemo<Pin[]>(() => extractAmenityPins(festival?.mapConfig), [festival]);
  const hasPins = pins.length > 0;
  const hasStages = stagePins.length > 0;
  const hasAmenities = amenityPins.length > 0;
  const hasPeers = peers.length > 0;
  const hasSos = !!sos?.position;
  // Render the map when there's ANYTHING to plot (meeting points, stage/amenity
  // map data, live peers, or an SOS coord).
  const shouldRenderMap = hasPins || hasStages || hasAmenities || hasPeers || hasSos;

  // Initial camera: prefer the festival's explicit map-config (bounds/center),
  // then fall back to framing the static pins (meeting points + stages +
  // amenities), then live peers / SOS. pickFestivalCamera owns the static-pin
  // precedence; we extend its fallback with the ephemeral peer/SOS coord.
  const staticPins = useMemo(() => [...pins, ...stagePins, ...amenityPins], [pins, stagePins, amenityPins]);
  const camera = useMemo(() => pickFestivalCamera(festival, staticPins), [festival, staticPins]);
  const center = useMemo(() => {
    if (camera.center) return camera.center;
    if (peers[0]) return { latitude: peers[0].lat, longitude: peers[0].lng };
    if (sos?.position) return { latitude: sos.position.lat, longitude: sos.position.lng };
    return null;
    // Recompute only when the coord sources meaningfully change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, peers.length, sos?.position?.lat, sos?.position?.lng]);

  // Stable keys so marker effects re-run only when their own coords change.
  const pinsKey = useMemo(() => pins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'), [pins]);
  const stagesKey = useMemo(
    () => stagePins.map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.color ?? ''}`).join('|'),
    [stagePins],
  );
  const amenitiesKey = useMemo(
    () => amenityPins.map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.amenityType ?? ''}`).join('|'),
    [amenityPins],
  );
  const peersKey = useMemo(() => peers.map((p) => `${p.userId}:${p.lat},${p.lng}:${p.serverAt}`).join('|'), [peers]);
  const sosKey = sos ? `${sos.userId}:${sos.position?.lat},${sos.position?.lng}` : '';

  // Keep the latest camera for the lazy map creation without making it an effect
  // dep (which would recreate the map on every position tick).
  const centerRef = useRef(center);
  centerRef.current = center;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  // Keep the latest authoring click handler in a ref so the map's click listener
  // (wired once at creation) always calls the current callback without making the
  // handler a map-creation dep (which would recreate the map on every render).
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

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
        // Authoring: report each map click's coord to the current handler (if
        // any). Wired once; the ref keeps it pointing at the latest callback.
        map.on('click', (e) => {
          const cb = onMapClickRef.current;
          if (!cb) return;
          const { lng, lat } = e.lngLat;
          if (Number.isFinite(lat) && Number.isFinite(lng)) cb({ latitude: lat, longitude: lng });
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
      stageMarkersRef.current = [];
      amenityMarkersRef.current = [];
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

  // ── Stage markers (festival-mapped; stage-colored, labelled) ────────────────
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of stageMarkersRef.current) m.remove();
    stageMarkersRef.current = [];

    for (const p of stagePins) {
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
      stageMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, stagesKey]);

  // ── Amenity markers (festival-mapped; category glyph + color) ───────────────
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of amenityMarkersRef.current) m.remove();
    amenityMarkersRef.current = [];

    for (const p of amenityPins) {
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
      amenityMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, amenitiesKey]);

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

  // ── Frame once when the map first loads ─────────────────────────────────────
  // Precedence (via pickFestivalCamera): explicit map-config bounds win — fit the
  // festival grounds exactly. Otherwise fit the union of everything we can plot
  // (meeting points + stages + amenities + live peers + SOS) so nothing's off
  // screen. The map was already centered on camera.center at creation.
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl || fittedRef.current) return;

    // 1. Explicit festival bounds — frame the grounds.
    const cfgBounds = cameraRef.current.bounds;
    if (cfgBounds) {
      const [[west, south], [east, north]] = cfgBounds;
      map.fitBounds(
        new gl.LngLatBounds([west, south], [east, north]),
        { padding: 56, maxZoom: 17, duration: 0 },
      );
      fittedRef.current = true;
      return;
    }

    // 2. Fit the union of all plottable coords.
    const coords: [number, number][] = [
      ...pins.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...stagePins.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...amenityPins.map((p) => [p.longitude, p.latitude] as [number, number]),
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
  }, [status, pinsKey, stagesKey, amenitiesKey, peersKey, sosKey]);

  // ── Empty state: nothing to plot ───────────────────────────────────────────
  if (!shouldRenderMap) {
    return (
      <div className="px-1">
        <EmptyState
          icon={<MapPin className="w-12 h-12" aria-hidden="true" />}
          title="No mapped meeting points yet"
          description="Add a location to a meeting point to see it here."
        />
        {!hasStages && !hasAmenities && (
          <p className="text-xs text-text-muted text-center mt-2">This festival isn&apos;t mapped yet.</p>
        )}
      </div>
    );
  }

  const peerCount = peers.length;
  const countCopy = [
    pins.length ? (pins.length === 1 ? '1 mapped point' : `${pins.length} mapped points`) : '',
    stagePins.length ? (stagePins.length === 1 ? '1 stage' : `${stagePins.length} stages`) : '',
    amenityPins.length ? (amenityPins.length === 1 ? '1 amenity' : `${amenityPins.length} amenities`) : '',
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
        {!hasStages && !hasAmenities && pins.length > 0 ? ' · this festival isn’t mapped yet' : ''}
      </p>
    </div>
  );
}
