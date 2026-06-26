// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, AlertTriangle, Navigation, X } from 'lucide-react';
import {
  extractMeetingPointPins,
  extractStagePins,
  extractAmenityPins,
  extractZones,
  zonesGeoJSON,
  zoneLabels,
  extractSiteplan,
  siteplanImageSource,
  amenityGlyph,
  pickFestivalCamera,
  formatStaleness,
  isPeerStale,
  headingToArrow,
  formatBatteryLabel,
  formatShareWindow,
  getInitials,
  buildPursuit,
  nearestPin,
  pickMapStyle,
  hasOfflineBasemap,
  type MapPin as Pin,
  type Coord,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry, Festival, Stage, AmenityType } from '@festie/shared/types';
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
  /**
   * Active SOS for this crew, or null. Back-compat single-SOS input — when
   * `activeSosList` is omitted this is the only SOS plotted.
   */
  sos?: SosEntry | null;
  /**
   * All currently-active crew SOS (newest first), from the liveLocationStore's
   * `activeSosList`. When provided it supersedes the single `sos` prop and a
   * marker is rendered for EACH entry (each framed once on first appearance).
   * Omitted ⇒ falls back to `[sos]` so existing single-SOS callers are unchanged.
   */
  activeSosList?: SosEntry[];
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
  /**
   * In-progress authoring vertices/corners (web-parity with the native
   * OfflineMap). While an admin draws a zone or places the 4 site-plan corners,
   * each tapped point is pushed here so a small aqua dot renders at it — giving
   * per-tap feedback BELOW the threshold where the polygon/overlay can render.
   * Omitted/empty in normal crew use — no dots drawn. Backward-compatible.
   */
  draftPoints?: { latitude: number; longitude: number }[];
}

// Amenity categories the filter chips can toggle, in display order. Mirrors the
// AmenityType union; each renders a token chip carrying its shared glyph.
const AMENITY_CATEGORIES: AmenityType[] = [
  'water',
  'medical',
  'toilet',
  'food',
  'atm',
  'entrance',
  'exit',
  'info',
  'charging',
];

// The "nearest X" quick targets — the amenity categories crew most often need to
// reach fast. Each finds the closest pin of that type and pursues it.
const NEAREST_TARGETS: { type: AmenityType; label: string }[] = [
  { type: 'medical', label: 'medical' },
  { type: 'water', label: 'water' },
  { type: 'toilet', label: 'toilet' },
];

/** A live pursue target: a peer, the SOS, or a nearest-amenity pin. */
interface PursueTarget {
  id: string;
  label: string;
  coord: Coord;
}

// Basemap style is chosen by the shared `pickMapStyle` (Phase 3A): a festival
// with an `offlineBasemap.pmtilesUrl` gets a PMTiles VECTOR basemap; every other
// festival keeps TODAY's online OSM raster (graceful fallback, never regressed).

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

export default function CrewMap({
  meetingPoints,
  peers = [],
  sos = null,
  activeSosList,
  festival = null,
  onMapClick,
  draftPoints,
}: Props) {
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
  const zoneLabelMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const peerMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  // SOS markers keyed by raiser userId (one per active SOS) + a framed-once set
  // so each new SOS flies/opens exactly once on first appearance.
  const sosMarkersRef = useRef<Map<string, import('maplibre-gl').Marker>>(new Map());
  const sosFramedRef = useRef<Set<string>>(new Set());
  // Draft authoring dots (in-progress zone vertices / site-plan corners).
  const draftMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const fittedRef = useRef(false);

  // ── Pursue / filter / nearest state (Phase 2B) ─────────────────────────────
  // The user's own GPS fix (browser geolocation), used to compute pursuit +
  // nearest-X. Null until they enable location; failure leaves it null and the
  // UI shows an "enable location to pursue" affordance.
  const [selfCoord, setSelfCoord] = useState<Coord | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied' | 'on'>('idle');
  // The current pursue target (a peer, the SOS, or a nearest-amenity pin) or null.
  const [pursue, setPursue] = useState<PursueTarget | null>(null);
  // Hidden amenity categories — toggled off via the filter chips. Default: all
  // shown (empty set). Component-local only, never persisted to the backend.
  const [hiddenAmenities, setHiddenAmenities] = useState<Set<AmenityType>>(() => new Set());

  // Select (or toggle off) a pursue target. Stable identity so the marker
  // effects don't re-run just because this changed.
  const selectPursue = useCallback((next: PursueTarget) => {
    setPursue((prev) => (prev && prev.id === next.id ? null : next));
  }, []);
  const clearPursue = useCallback(() => setPursue(null), []);

  // Enable browser geolocation for pursue / nearest. A continuous watch keeps
  // `selfCoord` fresh as the user moves so the arrow + ETA recompute live.
  const watchIdRef = useRef<number | null>(null);
  const enableLocation = useCallback(() => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      setGeoState('denied');
      return;
    }
    if (watchIdRef.current != null) return; // already watching
    setGeoState('locating');
    watchIdRef.current = geo.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setSelfCoord({ latitude, longitude });
          setGeoState('on');
        }
      },
      () => {
        setGeoState('denied');
        if (watchIdRef.current != null) {
          geo.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  }, []);
  // Tear the geolocation watch down on unmount.
  useEffect(() => {
    return () => {
      const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
      if (geo && watchIdRef.current != null) {
        geo.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  const pins = useMemo<Pin[]>(
    () => extractMeetingPointPins(meetingPoints as unknown as CrewMeetingPoint[]),
    [meetingPoints],
  );
  // Stage + amenity pins from the festival's map data (Phase A/B contract).
  // Empty for festivals that were never mapped — the "not mapped yet" note stays.
  const stagePins = useMemo<Pin[]>(() => extractStagePins(festival), [festival]);
  const amenityPins = useMemo<Pin[]>(() => extractAmenityPins(festival?.mapConfig), [festival]);
  // Zone polygons (Phase 4A): filled translucent areas (camping/VIP/no-go) drawn
  // UNDER the pins. Empty for festivals with no zones — no zone layer is added.
  const zones = useMemo(() => extractZones(festival?.mapConfig), [festival]);
  // Site-plan raster overlay (Phase 4B): the organizer's georeferenced paper map,
  // drawn UNDER zones + pins. Null for festivals with no site plan — no raster
  // layer is added (graceful, unchanged).
  const siteplan = useMemo(() => extractSiteplan(festival?.mapConfig), [festival]);
  // Amenity pins after the filter chips: a category in `hiddenAmenities` is
  // dropped from the rendered set. The full `amenityPins` is still used for the
  // camera + nearest-X search (so "nearest medical" works even when hidden).
  const visibleAmenityPins = useMemo<Pin[]>(
    () => amenityPins.filter((p) => !(p.amenityType && hiddenAmenities.has(p.amenityType))),
    [amenityPins, hiddenAmenities],
  );
  // Effective SOS list: prefer the multi-SOS `activeSosList`, else the single
  // `sos` prop (back-compat). A marker is rendered for EACH entry below.
  const sosList = useMemo<SosEntry[]>(() => activeSosList ?? (sos ? [sos] : []), [activeSosList, sos]);
  const hasPins = pins.length > 0;
  const hasStages = stagePins.length > 0;
  const hasAmenities = amenityPins.length > 0;
  const hasZones = zones.length > 0;
  const hasSiteplan = !!siteplan;
  const hasPeers = peers.length > 0;
  const hasSos = sosList.some((s) => !!s.position);
  // Render the map when there's ANYTHING to plot (meeting points, stage/amenity
  // map data, zone polygons, a site-plan overlay, live peers, or an SOS coord).
  const shouldRenderMap = hasPins || hasStages || hasAmenities || hasZones || hasSiteplan || hasPeers || hasSos;

  // Initial camera: prefer the festival's explicit map-config (bounds/center),
  // then fall back to framing the static pins (meeting points + stages +
  // amenities), then live peers / SOS. pickFestivalCamera owns the static-pin
  // precedence; we extend its fallback with the ephemeral peer/SOS coord.
  // Zone centroids feed the camera-fit fallback as pseudo-pins so a zones-only
  // festival still frames its grounds (pickFestivalCamera's explicit config
  // bounds/center still win when present).
  const zoneCentroidPins = useMemo<Pin[]>(
    () =>
      zones
        .filter((z) => z.centroid)
        .map((z) => ({
          id: `zone:${z.id}`,
          kind: 'amenity' as const,
          label: z.label || 'Zone',
          latitude: z.centroid!.latitude,
          longitude: z.centroid!.longitude,
        })),
    [zones],
  );
  const staticPins = useMemo(
    () => [...pins, ...stagePins, ...amenityPins, ...zoneCentroidPins],
    [pins, stagePins, amenityPins, zoneCentroidPins],
  );
  const camera = useMemo(() => pickFestivalCamera(festival, staticPins), [festival, staticPins]);
  const center = useMemo(() => {
    if (camera.center) return camera.center;
    if (peers[0]) return { latitude: peers[0].lat, longitude: peers[0].lng };
    const sp = sosList.find((s) => s.position)?.position;
    if (sp) return { latitude: sp.lat, longitude: sp.lng };
    return null;
    // Recompute only when the coord sources meaningfully change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, peers.length, sosList]);

  // Stable keys so marker effects re-run only when their own coords change.
  const pinsKey = useMemo(() => pins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'), [pins]);
  const stagesKey = useMemo(
    () => stagePins.map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.color ?? ''}`).join('|'),
    [stagePins],
  );
  // Keyed off the VISIBLE set so toggling a chip re-runs the amenity marker
  // effect (hide/show), while the camera-fit effect keys off the full set below.
  const amenitiesKey = useMemo(
    () => visibleAmenityPins.map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.amenityType ?? ''}`).join('|'),
    [visibleAmenityPins],
  );
  const allAmenitiesKey = useMemo(
    () => amenityPins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'),
    [amenityPins],
  );
  // Re-run the zone effect when a zone's color/label/geometry changes (the
  // centroid + per-ring point counts capture a live admin draw adding vertices).
  const zonesKey = useMemo(
    () =>
      zones
        .map(
          (z) =>
            `${z.id}:${z.color}:${z.label}:${z.rings.map((r) => r.length).join(',')}:${z.centroid?.latitude ?? ''},${z.centroid?.longitude ?? ''}`,
        )
        .join('|'),
    [zones],
  );
  const peersKey = useMemo(() => peers.map((p) => `${p.userId}:${p.lat},${p.lng}:${p.serverAt}`).join('|'), [peers]);
  // SOS keys are SPLIT: the IDENTITY set (which raisers have a plotted SOS) drives
  // the build/reconcile + one-shot fly/open per new SOS, while the COORD set only
  // repositions the existing markers (no re-fly/re-open every tick). Keying the
  // build effect on lat/lng would yank the camera + reopen the popup on every tick.
  const sosIdsKey = useMemo(
    () => sosList.filter((s) => s.position).map((s) => s.userId).join('|'),
    [sosList],
  );
  const sosCoordsKey = useMemo(
    () => sosList.map((s) => (s.position ? `${s.userId}:${s.position.lat},${s.position.lng}` : '')).join('|'),
    [sosList],
  );
  // Draft authoring dots re-render only when a vertex/corner is added/removed/moved.
  const draftPointsKey = useMemo(
    () => (draftPoints ?? []).map((p) => `${p.latitude},${p.longitude}`).join('|'),
    [draftPoints],
  );
  // Re-run the site-plan effect when the image URL, corners, or opacity change.
  const siteplanKey = siteplan
    ? `${siteplan.imageUrl}:${siteplan.corners.map((c) => c.join(',')).join('|')}:${siteplan.opacity}`
    : '';

  // Resolve the pursue target's LIVE coord: a peer/SOS target tracks the latest
  // position from props (so the arrow follows them), while a nearest-amenity
  // target is static (uses its captured coord). Returns null if the target
  // vanished (e.g. the peer stopped sharing) so the overlay clears itself.
  const liveTarget = useMemo<PursueTarget | null>(() => {
    if (!pursue) return null;
    if (pursue.id.startsWith('peer:')) {
      const uid = pursue.id.slice('peer:'.length);
      const p = peers.find((x) => x.userId === uid);
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
      return { id: pursue.id, label: p.username || pursue.label, coord: { latitude: p.lat, longitude: p.lng } };
    }
    if (pursue.id.startsWith('sos:')) {
      const uid = pursue.id.slice('sos:'.length);
      const s = sosList.find((x) => x.userId === uid);
      if (!s?.position) return null;
      return {
        id: pursue.id,
        label: `${s.username} — SOS`,
        coord: { latitude: s.position.lat, longitude: s.position.lng },
      };
    }
    return pursue; // nearest-amenity: static captured coord
  }, [pursue, peers, sosList]);

  // The pursuit bundle (bearing + distance + compass + ETA) self → target.
  // Recomputed whenever self GPS or the target's live coord changes.
  const pursuit = useMemo(
    () => (selfCoord && liveTarget ? buildPursuit(selfCoord, liveTarget.coord) : null),
    [selfCoord, liveTarget],
  );

  // "Nearest X": find the closest amenity of a category to self, select it as the
  // pursue target. Searches the FULL amenity set (ignores filter visibility) so
  // "nearest medical" still works when medical is toggled off.
  const pursueNearest = useCallback(
    (type: AmenityType, label: string) => {
      if (!selfCoord) {
        enableLocation();
        return;
      }
      const found = nearestPin(selfCoord, amenityPins, (p) => p.amenityType === type);
      if (!found) return;
      setPursue({
        id: `amenity:${found.pin.id}`,
        label: found.pin.label || label,
        coord: { latitude: found.pin.latitude, longitude: found.pin.longitude },
      });
      // Frame the chosen pin if the map is up.
      const map = mapRef.current;
      if (map) map.flyTo({ center: [found.pin.longitude, found.pin.latitude], zoom: 16, duration: 600 });
    },
    [selfCoord, amenityPins, enableLocation],
  );

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
  // Latest festival map-config for the lazy map creation (style choice), without
  // making it a creation dep. The style is picked once at map creation.
  const mapConfigRef = useRef(festival?.mapConfig);
  mapConfigRef.current = festival?.mapConfig;

  // ── Map lifecycle: create once when there's content; tear down on unmount ──
  useEffect(() => {
    if (!shouldRenderMap || !containerRef.current) return;
    if (mapRef.current) return; // already created
    let cancelled = false;

    (async () => {
      try {
        const maplibregl = (await import('maplibre-gl')).default as unknown as MapLibre;
        await import('maplibre-gl/dist/maplibre-gl.css');

        const cfg = mapConfigRef.current;
        // Phase 3A: only when this festival carries a valid offline basemap do we
        // register the pmtiles protocol + read it from a vector style. Otherwise
        // pickMapStyle returns the unchanged online OSM raster. addProtocol is a
        // process-global registration on the maplibre module; guard so repeated
        // map mounts don't double-register (maplibre warns on a duplicate). Done
        // BEFORE the final mounted-guard so no await sits between that guard and
        // the mapRef assignment (keeps the atomic-update lint happy).
        if (hasOfflineBasemap(cfg)) {
          const gAny = maplibregl as unknown as {
            __festiePmtilesRegistered?: boolean;
            addProtocol?: (id: string, fn: unknown) => void;
          };
          if (!gAny.__festiePmtilesRegistered && typeof gAny.addProtocol === 'function') {
            const { Protocol } = await import('pmtiles');
            const protocol = new Protocol();
            gAny.addProtocol('pmtiles', protocol.tile);
            gAny.__festiePmtilesRegistered = true;
          }
        }
        if (cancelled || !containerRef.current || mapRef.current) return;

        const c = centerRef.current;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: pickMapStyle(cfg) as unknown as import('maplibre-gl').StyleSpecification,
          center: c ? [c.longitude, c.latitude] : [0, 0],
          zoom: c ? 14 : 1,
          attributionControl: { compact: true },
          // North-locked: the pursue arrow + heading carets are north-referenced,
          // so disable rotation/pitch — a rotated basemap would desync them.
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        // Also kill two-finger / keyboard rotation (not covered by dragRotate).
        try {
          map.touchZoomRotate?.disableRotation?.();
          map.keyboard?.disableRotation?.();
        } catch {
          // Older GL builds may lack these handlers — never fatal.
        }
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
      zoneLabelMarkersRef.current = [];
      peerMarkersRef.current = [];
      sosMarkersRef.current = new Map();
      sosFramedRef.current = new Set();
      draftMarkersRef.current = [];
      fittedRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
      glRef.current = null;
    };
    // Only (re)create when content first appears / disappears.
  }, [shouldRenderMap]);

  // ── Site-plan raster overlay (festival-mapped; UNDER zones + every marker) ──
  // The organizer's georeferenced paper site-plan, drawn as a MapLibre `image`
  // source + raster layer positioned by its 4 corners at the configured opacity.
  // Declared BEFORE the zones effect so, on first load, this layer is added to
  // the stack first and the zone fill/outline layers (added next) sit on top —
  // and DOM markers (meeting/stage/amenity/peer/SOS) are always above all GL
  // layers. Graceful: no siteplan ⇒ nothing added; clearing it removes the layer.
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    const SRC = 'festie-siteplan';
    const LAYER = 'festie-siteplan-layer';
    const src = siteplanImageSource(siteplan);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, siteplanKey]);

  // ── Zone polygons (festival-mapped; filled translucent, UNDER every marker) ──
  // Rendered as a single GeoJSON source + a fill + outline GL layer (data-driven
  // color via ['get','color']) so they always sit beneath the DOM markers
  // (meeting points / stages / amenities / peers / SOS). Zone labels are DOM
  // markers at each centroid (no glyphs endpoint needed — same approach as the
  // stage tag). The source/layers are added once, then `setData` updates them.
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    // Typed via maplibre's own setData param so we don't depend on the ambient
    // GeoJSON namespace (not in scope in the web tsconfig). The struct from
    // zonesGeoJSON is a GeoJSON FeatureCollection in all but nominal type.
    type ZoneData = Parameters<import('maplibre-gl').GeoJSONSource['setData']>[0];
    const data = zonesGeoJSON(zones) as unknown as ZoneData;
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
    for (const m of zoneLabelMarkersRef.current) m.remove();
    zoneLabelMarkersRef.current = [];
    for (const z of zoneLabels(zones)) {
      const el = document.createElement('div');
      el.className = 'festie-zone-label';
      el.style.setProperty('--zone-color', z.color);
      el.setAttribute('aria-hidden', 'true');
      el.textContent = z.label;
      const marker = new gl.Marker({ element: el }).setLngLat([z.longitude, z.latitude]).addTo(map);
      zoneLabelMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, zonesKey]);

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

    for (const p of visibleAmenityPins) {
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
      peerMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, peersKey, selectPursue]);

  // ── SOS markers (emphasized; one per active SOS) ────────────────────────────
  // Reconcile a marker per active SOS keyed by raiser userId: build new ones,
  // drop cleared ones, and frame each EXACTLY once on first appearance (fly +
  // open popup). Keyed on the identity set so adding/removing an SOS rebuilds,
  // while coord ticks only reposition (the effect below).
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    const markers = sosMarkersRef.current;
    const present = new Set(sosList.filter((s) => s.position).map((s) => s.userId));

    // Remove markers for SOS that cleared (and forget their framed flag so a
    // later re-raise from the same user frames again).
    for (const [uid, marker] of markers) {
      if (!present.has(uid)) {
        marker.remove();
        markers.delete(uid);
        sosFramedRef.current.delete(uid);
      }
    }

    // Add a marker for each newly-present SOS.
    for (const s of sosList) {
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
      if (!sosFramedRef.current.has(s.userId)) {
        sosFramedRef.current.add(s.userId);
        marker.togglePopup();
        map.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sosIdsKey, selectPursue]);

  // ── SOS marker reposition (coord ticks only — no re-fly/re-open) ────────────
  // The build effect above keys on the identity set, so it doesn't rebuild when an
  // SOS person moves. Slide each existing marker to the latest coord here.
  useEffect(() => {
    if (status !== 'ready') return;
    const markers = sosMarkersRef.current;
    for (const s of sosList) {
      if (!s.position) continue;
      const marker = markers.get(s.userId);
      if (!marker) continue;
      const { lat, lng } = s.position;
      if (Number.isFinite(lat) && Number.isFinite(lng)) marker.setLngLat([lng, lat]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sosCoordsKey]);

  // ── Draft authoring dots (web-parity with native OfflineMap) ────────────────
  // A small aqua dot at each in-progress zone vertex / site-plan corner so taps
  // give feedback below the polygon/overlay render threshold. Re-rendered
  // wholesale on each change (tiny N). Empty/omitted ⇒ no dots.
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of draftMarkersRef.current) m.remove();
    draftMarkersRef.current = [];
    for (const p of draftPoints ?? []) {
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
      const el = document.createElement('div');
      el.style.cssText = [
        'width:12px',
        'height:12px',
        'border-radius:50%',
        'background:#19e3d3',
        'border:2px solid #fff',
        'box-shadow:0 0 6px rgba(25,227,211,0.85)',
        'pointer-events:none',
      ].join(';');
      el.setAttribute('aria-hidden', 'true');
      const marker = new gl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map);
      draftMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, draftPointsKey]);

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
      // Every zone vertex so the grounds frame includes the drawn areas.
      ...zones.flatMap((z) => z.rings.flat()),
      // Site-plan corners so a siteplan-only festival still frames its grounds.
      ...(siteplan ? siteplan.corners : []),
      ...peers.map((p) => [p.lng, p.lat] as [number, number]),
      ...sosList
        .filter((s) => s.position)
        .map((s) => [s.position!.lng, s.position!.lat] as [number, number]),
    ];
    if (coords.length > 1) {
      let bounds = new gl.LngLatBounds(coords[0], coords[0]);
      for (const c of coords) bounds = bounds.extend(c);
      map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
    }
    fittedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pinsKey, stagesKey, allAmenitiesKey, zonesKey, siteplanKey, peersKey, sosIdsKey]);

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

  // Pursue is SOS-flavored (coral) only for the SOS target; peers + amenities
  // use the aqua selection accent.
  const pursueIsSos = !!liveTarget && liveTarget.id.startsWith('sos:');
  const showPursueOverlay = status === 'ready' && !!liveTarget;

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
          when they shared their location and how long ago. Tap a live crew member or the SOS marker to pursue them — a
          direction arrow, distance and walking ETA appear. While the map is focused, use the arrow keys to pan and the
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

        {/* ── Pursue overlay: directional arrow + label "Alex · 210 m NE · ~3 min". */}
        {showPursueOverlay && (
          <div
            className="absolute left-2 bottom-2 right-2 z-10 flex items-center gap-3 rounded-lg border bg-bg-elevated/95 px-3 py-2 shadow-lg"
            style={{ borderColor: pursueIsSos ? 'var(--color-accent-coral)' : 'var(--color-accent-aqua)' }}
            role="status"
            aria-live="polite"
          >
            {selfCoord && pursuit && Number.isFinite(pursuit.bearingDeg) ? (
              <Navigation
                className="w-7 h-7 shrink-0"
                aria-hidden="true"
                style={{
                  color: pursueIsSos ? 'var(--color-accent-coral)' : 'var(--color-accent-aqua)',
                  // lucide's Navigation glyph points NE (45°) at rotation 0, so
                  // subtract 45° so a due-north target points straight up.
                  transform: `rotate(${pursuit.bearingDeg - 45}deg)`,
                  transition: 'transform 300ms ease-out',
                }}
              />
            ) : (
              <Navigation className="w-7 h-7 shrink-0 text-text-muted opacity-50" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              {selfCoord && pursuit ? (
                <p className="truncate text-sm text-text-primary">
                  <span className="font-semibold">{liveTarget.label}</span>
                  <span className="text-text-secondary">
                    {' · '}
                    {pursuit.distanceLabel}
                    {pursuit.compass ? ` ${pursuit.compass}` : ''}
                    {pursuit.etaLabel !== '—' ? ` · ~${pursuit.etaLabel}` : ''}
                  </span>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={enableLocation}
                  className="text-left text-sm text-accent-aqua underline-offset-2 hover:underline"
                >
                  {geoState === 'denied'
                    ? 'Location blocked — enable it to pursue'
                    : geoState === 'locating'
                      ? 'Locating you…'
                      : `Enable location to pursue ${liveTarget.label}`}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={clearPursue}
              className="shrink-0 rounded p-1 text-text-muted hover:text-text-primary"
              aria-label="Stop pursuing"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* ── Nearest-X quick controls: pursue the closest medical / water / toilet. */}
      {hasAmenities && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-muted">Nearest</span>
          {NEAREST_TARGETS.map(({ type, label }) => {
            const { glyph } = amenityGlyph(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => pursueNearest(type, label)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-secondary px-2.5 py-1 text-xs text-text-secondary hover:border-accent-aqua hover:text-text-primary"
                aria-label={`Find and pursue the nearest ${label}`}
              >
                <span aria-hidden="true">{glyph}</span>
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Amenity filter chips: toggle each category on/off (local only). */}
      {hasAmenities && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter amenities by category">
          {AMENITY_CATEGORIES.filter((type) => amenityPins.some((p) => p.amenityType === type)).map((type) => {
            const { glyph } = amenityGlyph(type);
            const on = !hiddenAmenities.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() =>
                  setHiddenAmenities((prev) => {
                    const next = new Set(prev);
                    if (next.has(type)) next.delete(type);
                    else next.add(type);
                    return next;
                  })
                }
                aria-pressed={on}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                  on
                    ? 'border-accent-aqua bg-accent-aqua/10 text-text-primary'
                    : 'border-border bg-bg-secondary text-text-muted'
                }`}
              >
                <span aria-hidden="true" className={on ? '' : 'opacity-40'}>
                  {glyph}
                </span>
                {type}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-text-muted text-center">
        {countCopy || 'Live locations'}
        {!hasStages && !hasAmenities && pins.length > 0 ? ' · this festival isn’t mapped yet' : ''}
      </p>
    </div>
  );
}
