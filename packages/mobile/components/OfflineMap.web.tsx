import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';

// MapLibre's stylesheet is imported for its side effect on the web export (metro
// injects the CSS). The `maplibre-gl/dist/maplibre-gl.css` side-effect module is
// typed ambiently in `types/css.d.ts` (web gets the same from vite/client).
// Native never resolves this `.web.tsx`, so the import never reaches the native
// bundle.

/**
 * OfflineMap (web platform extension) — `expo export -p web` build.
 *
 * The native OfflineMap (`OfflineMap.tsx`) hosts MapLibre inside a
 * `react-native-webview`. That dependency has no web implementation, so on the
 * web export metro's platform-extension resolution picks up THIS `.web.tsx`
 * instead (the consumer's `import OfflineMap from '../components/OfflineMap'` is
 * unchanged). Native therefore never bundles `maplibre-gl` — it lives only in
 * this file, which native metro never resolves.
 *
 * What it renders: a LIVE MapLibre GL JS map (no API key, OSM raster basemap),
 * the same three marker kinds web's `CrewMap.tsx` plots — meeting-point pins,
 * live peers, and an emphasized SOS — ported to the OfflineMap props. MapLibre is
 * heavy and is `import()`-ed dynamically inside an effect (mirroring CrewMap) so
 * SSR / initial parse stays safe and the GL chunk is split out.
 *
 * HONEST FALLBACK: if the GL library fails to load/init (truly offline, no CDN
 * tiles) we render the previous offline-honest meeting-points + live-peer + SOS
 * list — the same data, reusing the shared pin extractors and staleness helpers
 * so the offline contract is unchanged. We never leave a blank canvas behind.
 */

interface OfflineMapProps {
  meetingPoints: CrewMeetingPoint[];
  /** Live crew peers currently sharing (ephemeral; from liveLocationStore). */
  peers?: PeerLocation[];
  /**
   * Active crew SOS, if any (ephemeral; from liveLocationStore). Back-compat
   * single-SOS input — superseded by `activeSosList` when that's provided.
   */
  sos?: SosEntry | null;
  /**
   * All currently-active crew SOS (newest first), from the store's
   * `activeSosList`. When provided it supersedes `sos` and a marker is rendered
   * for EACH entry (each framed once on first appearance). Omitted ⇒ falls back
   * to `[sos]` so existing single-SOS callers are unchanged.
   */
  activeSosList?: SosEntry[];
  /**
   * In-progress authoring vertices/corners (web-parity with the native
   * OfflineMap's draftPoints): a small aqua dot renders at each tapped zone
   * vertex / site-plan corner. Omitted/empty in normal crew use — no dots.
   */
  draftPoints?: { latitude: number; longitude: number }[];
  /**
   * Tap-to-create: fired when the user drops a pin on the interactive map, with
   * the chosen coordinate. Web parity with the native OfflineMap — the screen
   * wires this to the meeting-point create flow. Omit to disable the affordance.
   * The map enters "placement mode" via the on-map "Drop pin" toggle; the next
   * single map click emits the coord, matching the native one-tap behavior.
   */
  onMapPress?: (coord: { latitude: number; longitude: number }) => void;
  /**
   * Current festival carrying `mapConfig` (amenities + camera) and, when the
   * caller folds in the store's separate `stages` array, `stages[]`. Omitted/null
   * keeps the original behaviour + "not mapped yet" fallback. Backward-compatible.
   */
  festival?: (Festival & { stages?: Stage[] }) | null;
}

// Basemap style is chosen by the shared `pickMapStyle` (Phase 3A): a festival
// with an `offlineBasemap.pmtilesUrl` gets a PMTiles VECTOR basemap; every other
// festival keeps TODAY's online OSM raster (graceful fallback, never regressed) —
// mirrors CrewMap.tsx so the web surfaces render identically.
//
// Phase 3B caching (web): the PMTiles JS client byte-range fetches the archive
// over HTTPS, and the browser's HTTP cache (the archive is served immutable +
// long-max-age, see lib/middleware.ts /uploads/basemaps) keeps the read warm
// across reloads — no extra code needed here. FUTURE OPTIMIZATION (not built):
// persist the archive to OPFS (Origin Private File System) + a Cache Storage /
// Service Worker range-shim so the web map works fully offline like native's
// file:// cache. Deliberately deferred — the HTTP-cache path is sufficient today
// and OPFS range-serving is a meaningful build we shouldn't over-invest in now.

// The subset of the maplibre-gl module we use. Loaded via `.default` at runtime
// (CJS interop); the type-level default member doesn't exist, so model the
// constructors we touch — same shape as CrewMap.tsx.
type MapLibre = {
  Map: typeof import('maplibre-gl').Map;
  Marker: typeof import('maplibre-gl').Marker;
  Popup: typeof import('maplibre-gl').Popup;
  NavigationControl: typeof import('maplibre-gl').NavigationControl;
  LngLatBounds: typeof import('maplibre-gl').LngLatBounds;
};

// Popups are built with DOM APIs (createElement + textContent) and handed to
// MapLibre via `setDOMContent`, so user/server text is never parsed as HTML —
// the browser escapes it for us (mirrors CrewMap's already-safe path).

/** A <strong> title element with text set safely via textContent. */
function titleEl(text: string, className?: string): HTMLElement {
  const strong = document.createElement('strong');
  if (className) strong.className = className;
  strong.textContent = text;
  return strong;
}

/** A subtitle line: <span class="festie-map-sub">text</span>. */
function subEl(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'festie-map-sub';
  span.textContent = text;
  return span;
}

/** Assemble popup children into a container <div>, <br/>-separated. */
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


/** A peer/SOS row resolved from live-location props (for the fallback list). */
interface LivePin {
  id: string;
  label: string;
  sublabel?: string;
  initial: string;
  latitude: number;
  longitude: number;
  kind: 'peer' | 'sos';
  stale?: boolean;
  age?: string;
}

/** A live pursue target: a peer, the SOS, or a nearest-amenity pin. */
interface PursueTarget {
  id: string;
  label: string;
  coord: Coord;
}

// Amenity categories the filter chips can toggle, in display order.
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

// The "nearest X" quick targets.
const NEAREST_TARGETS: { type: AmenityType; label: string }[] = [
  { type: 'medical', label: 'medical' },
  { type: 'water', label: 'water' },
  { type: 'toilet', label: 'toilet' },
];

export default function OfflineMap({
  meetingPoints,
  peers,
  sos,
  activeSosList,
  draftPoints,
  onMapPress,
  festival = null,
}: OfflineMapProps) {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset();

  // 'pending' until the GL lib mounts; 'ready' once the map's `load` fired
  // (marker effects gate on it); 'error' on a load/init failure → list fallback.
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending');
  // Placement mode (web parity with native): when on, the next single map click
  // drops a meeting point at that coord and auto-exits.
  const [placing, setPlacing] = useState(false);
  // Guards a single in-flight "find me" geolocation request.
  const [locating, setLocating] = useState(false);

  // ── Pursue / filter / nearest state (Phase 2B) ─────────────────────────────
  const [selfCoord, setSelfCoord] = useState<Coord | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied' | 'on'>('idle');
  const [pursue, setPursue] = useState<PursueTarget | null>(null);
  const [hiddenAmenities, setHiddenAmenities] = useState<Set<AmenityType>>(() => new Set());

  // The DOM node MapLibre mounts into. On react-native-web a View renders a div,
  // and `ref` resolves to that DOM element.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const glRef = useRef<MapLibre | null>(null);
  const mpMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const stageMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const amenityMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const zoneLabelMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const peerMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  // SOS markers keyed by raiser userId (one per active SOS) + a framed-once set.
  const sosMarkersRef = useRef<Map<string, import('maplibre-gl').Marker>>(new Map());
  const sosFramedRef = useRef<Set<string>>(new Set());
  // Draft authoring dots (in-progress zone vertices / site-plan corners).
  const draftMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const fittedRef = useRef(false);
  // The map's click handler is bound once at creation, so it reads placement +
  // the live onMapPress callback through refs rather than stale closure values.
  const placingRef = useRef(false);
  const onMapPressRef = useRef<OfflineMapProps['onMapPress']>(onMapPress);

  const pins = useMemo<Pin[]>(() => extractMeetingPointPins(meetingPoints), [meetingPoints]);
  // Stage + amenity pins from the festival's map data (Phase A/B contract).
  const stagePins = useMemo<Pin[]>(() => extractStagePins(festival), [festival]);
  const amenityPins = useMemo<Pin[]>(() => extractAmenityPins(festival?.mapConfig), [festival]);
  // Zone polygons (Phase 4A): filled translucent areas drawn UNDER the markers.
  const zones = useMemo(() => extractZones(festival?.mapConfig), [festival]);
  // Site-plan raster overlay (Phase 4B): the organizer's georeferenced paper map,
  // drawn UNDER zones + pins. Null for festivals with no site plan (unchanged).
  const siteplan = useMemo(() => extractSiteplan(festival?.mapConfig), [festival]);
  // Amenity pins after the filter chips — hidden categories are dropped from the
  // rendered set. The full `amenityPins` still drives camera-fit + nearest-X.
  const visibleAmenityPins = useMemo<Pin[]>(
    () => amenityPins.filter((p) => !(p.amenityType && hiddenAmenities.has(p.amenityType))),
    [amenityPins, hiddenAmenities],
  );

  // `now` ticks via useNow so staleness recomputes without an impure Date.now()
  // in the memo factory (react-hooks/purity) — same pattern as OfflineMap.tsx.
  const now = useNow();

  // Effective SOS list: prefer the multi-SOS `activeSosList`, else the single
  // `sos` prop (back-compat). A marker is rendered for EACH entry.
  const sosList = useMemo<SosEntry[]>(() => activeSosList ?? (sos ? [sos] : []), [activeSosList, sos]);

  // Live peer + SOS rows (used by both the GL markers and the fallback list).
  const livePins = useMemo<LivePin[]>(() => {
    const items: LivePin[] = [];
    for (const p of peers ?? []) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const age = relAge(p.serverAt);
      const stale = isPeerStale(p.serverAt, now);
      items.push({
        id: `peer:${p.userId}`,
        label: p.username || 'Crew member',
        sublabel: stale ? `last seen ${age}` : `live · ${age}`,
        initial: getInitials(p.username ?? '') || '?',
        latitude: p.lat,
        longitude: p.lng,
        kind: 'peer',
        stale,
        age,
      });
    }
    for (const s of sosList) {
      if (s.position && Number.isFinite(s.position.lat) && Number.isFinite(s.position.lng)) {
        items.push({
          id: `sos:${s.userId}`,
          label: `${s.username} — SOS`,
          sublabel: s.message || 'Needs help',
          initial: '!',
          latitude: s.position.lat,
          longitude: s.position.lng,
          kind: 'sos',
        });
      }
    }
    return items;
  }, [peers, sosList, now]);

  // Meeting points present but without coords — listed so they're never lost.
  const uncoordedPoints = useMemo(
    () =>
      (meetingPoints ?? []).filter(
        (p) => p && p.active !== false && !(Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      ),
    [meetingPoints],
  );

  const peerList = useMemo(() => peers ?? [], [peers]);
  const hasPins = pins.length > 0;
  const hasStages = stagePins.length > 0;
  const hasAmenities = amenityPins.length > 0;
  const hasZones = zones.length > 0;
  const hasSiteplan = !!siteplan;
  const hasPeers = peerList.length > 0;
  const hasSos = sosList.some((s) => !!s.position);
  // Render the map when there's ANYTHING to plot (meeting points, stage/amenity
  // map data, zone polygons, a site-plan overlay, live peers, or an SOS coord).
  const shouldRenderMap = hasPins || hasStages || hasAmenities || hasZones || hasSiteplan || hasPeers || hasSos;

  // Initial camera: prefer the festival's explicit map-config (bounds/center),
  // then frame the static pins, then live peers / SOS. pickFestivalCamera owns
  // the static-pin precedence; we extend its fallback with the ephemeral coords.
  // Zone centroids feed the camera fallback so a zones-only festival still frames.
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
    if (peerList[0]) return { latitude: peerList[0].lat, longitude: peerList[0].lng };
    const sp = sosList.find((s) => s.position)?.position;
    if (sp) return { latitude: sp.lat, longitude: sp.lng };
    return null;
    // Recompute only when the coord sources meaningfully change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, peerList.length, sosList]);

  // Stable keys so marker effects re-run only when their own coords change.
  const pinsKey = useMemo(() => pins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'), [pins]);
  const stagesKey = useMemo(
    () => stagePins.map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.color ?? ''}`).join('|'),
    [stagePins],
  );
  const amenitiesKey = useMemo(
    () => visibleAmenityPins.map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.amenityType ?? ''}`).join('|'),
    [visibleAmenityPins],
  );
  const allAmenitiesKey = useMemo(
    () => amenityPins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'),
    [amenityPins],
  );
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
  const peersKey = useMemo(
    () => peerList.map((p) => `${p.userId}:${p.lat},${p.lng}:${p.serverAt}`).join('|'),
    [peerList],
  );
  // SOS keys are SPLIT: the IDENTITY set drives the build/reconcile + one-shot
  // fly/open per new SOS; the COORD set only repositions existing markers (no
  // re-fly/re-open every tick). Keying the build effect on lat/lng would yank the
  // camera + reopen the popup on every SOS position update.
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

  // Keep the latest center for the (peer-driven) lazy map creation without making
  // it an effect dep (which would recreate the map on every position tick). The
  // write lives in an effect (not render) so it never trips the refs-in-render rule.
  const centerRef = useRef(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  // Latest festival map-config for the lazy map creation (style choice). The
  // style is picked once at creation; the write lives in an effect (not render)
  // so it never trips the refs-in-render rule.
  const mapConfigRef = useRef(festival?.mapConfig);
  useEffect(() => {
    mapConfigRef.current = festival?.mapConfig;
  }, [festival]);

  // Keep the click-handler refs current without re-binding the map listener.
  useEffect(() => {
    onMapPressRef.current = onMapPress;
  }, [onMapPress]);
  useEffect(() => {
    placingRef.current = placing;
    // Reflect placement mode in the cursor (desktop web) once the map exists.
    const map = mapRef.current;
    if (!map) return;
    try {
      map.getCanvas().style.cursor = placing ? 'crosshair' : '';
    } catch {
      // Canvas not ready yet — the next placement toggle will set it.
    }
  }, [placing]);

  // ── Pursue / geolocation / nearest (Phase 2B) ──────────────────────────────
  // Select (or toggle off) a pursue target. Stable identity so the marker
  // effects don't re-run just because this changed.
  const selectPursue = useCallback((next: PursueTarget) => {
    setPursue((prev) => (prev && prev.id === next.id ? null : next));
  }, []);
  const clearPursue = useCallback(() => setPursue(null), []);

  // Continuous browser-geolocation watch keeping `selfCoord` fresh as the user
  // moves so the arrow + ETA recompute live. Permission denial is non-destructive.
  const watchIdRef = useRef<number | null>(null);
  const enableLocation = useCallback(() => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      setGeoState('denied');
      return;
    }
    if (watchIdRef.current != null) return;
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
  useEffect(() => {
    return () => {
      const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
      if (geo && watchIdRef.current != null) {
        geo.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // Resolve the pursue target's LIVE coord (peer/SOS track props; nearest-amenity
  // is static). Null when the target vanished so the overlay clears itself.
  const liveTarget = useMemo<PursueTarget | null>(() => {
    if (!pursue) return null;
    if (pursue.id.startsWith('peer:')) {
      const uid = pursue.id.slice('peer:'.length);
      const p = peerList.find((x) => x.userId === uid);
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
  }, [pursue, peerList, sosList]);

  const pursuit = useMemo(
    () => (selfCoord && liveTarget ? buildPursuit(selfCoord, liveTarget.coord) : null),
    [selfCoord, liveTarget],
  );
  const pursueIsSos = !!liveTarget && liveTarget.id.startsWith('sos:');

  // "Nearest X": closest amenity of a category to self → pursue + frame it.
  // Searches the FULL amenity set (ignores chip visibility).
  const pursueNearest = useCallback(
    (type: AmenityType) => {
      if (!selfCoord) {
        enableLocation();
        return;
      }
      const found = nearestPin(selfCoord, amenityPins, (p) => p.amenityType === type);
      if (!found) return;
      setPursue({
        id: `amenity:${found.pin.id}`,
        label: found.pin.label || type,
        coord: { latitude: found.pin.latitude, longitude: found.pin.longitude },
      });
      if (mapRef.current) {
        mapRef.current.flyTo({ center: [found.pin.longitude, found.pin.latitude], zoom: 16, duration: 600 });
      }
    },
    [selfCoord, amenityPins, enableLocation],
  );

  const toggleAmenity = useCallback((type: AmenityType) => {
    setHiddenAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

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
        // Phase 3A: register the pmtiles protocol + read the vector style only
        // when this festival carries a valid offline basemap; otherwise
        // pickMapStyle returns the unchanged online OSM raster. addProtocol is a
        // process-global on the maplibre module — guard against double-register.
        // Done BEFORE the final mounted-guard so no await sits between it and the
        // mapRef assignment.
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
          // Older GL builds may lack these handlers — rotation stays at the
          // constructor defaults above; never fatal.
        }
        map.on('error', () => {
          if (!cancelled) setStatus('error');
        });
        map.on('load', () => {
          if (cancelled) return;
          setStatus('ready');
        });
        // Tap-to-create (web parity): while placement mode is armed, the next
        // single click drops a meeting point and auto-exits. Reads live values
        // through refs so the once-bound listener never goes stale.
        map.on('click', (e) => {
          if (!placingRef.current) return;
          const cb = onMapPressRef.current;
          const { lng, lat } = e.lngLat;
          // Auto-exit placement (one-shot), mirroring native.
          placingRef.current = false;
          setPlacing(false);
          if (cb && Number.isFinite(lat) && Number.isFinite(lng)) {
            cb({ latitude: lat, longitude: lng });
          }
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
  // The organizer's georeferenced paper site-plan as a MapLibre `image` source +
  // raster layer, positioned by its 4 corners at the configured opacity. Declared
  // BEFORE the zones effect so it's added to the layer stack first (zones + DOM
  // markers sit on top). Graceful: no siteplan ⇒ nothing added; clearing removes.
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    const SRC = 'festie-siteplan';
    const LAYER = 'festie-siteplan-layer';
    const src = siteplanImageSource(siteplan);
    try {
      if (!src) {
        if (map.getLayer(LAYER)) map.removeLayer(LAYER);
        if (map.getSource(SRC)) map.removeSource(SRC);
        return;
      }
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, siteplanKey]);

  // ── Zone polygons (festival-mapped; filled translucent, UNDER every marker) ──
  // GeoJSON source + fill + outline GL layer (data-driven color) beneath all DOM
  // markers; labels are DOM markers at each centroid. The web EXPORT doesn't load
  // web's components.css, so the label tag is styled inline (self-contained).
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

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
      // Transient style-not-ready race: a later zonesKey change re-attempts.
    }

    for (const m of zoneLabelMarkersRef.current) m.remove();
    zoneLabelMarkersRef.current = [];
    for (const z of zoneLabels(zones)) {
      const el = document.createElement('div');
      el.style.cssText = [
        'white-space:nowrap',
        'max-width:140px',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'background:rgba(8,8,16,0.7)',
        'color:#eaeaf2',
        'font:700 10px/1.3 -apple-system,system-ui,sans-serif',
        'letter-spacing:0.02em',
        'text-transform:uppercase',
        'padding:2px 7px',
        'border-radius:8px',
        `border:1px solid ${z.color}`,
        'pointer-events:none',
      ].join(';');
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
      el.setAttribute('aria-label', p.label + (p.sublabel ? ' - ' + p.sublabel : ''));
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      const popupEl = popupContent([titleEl(p.label), p.sublabel ? subEl(p.sublabel) : null]);
      const marker = new gl.Marker({ element: el })
        .setLngLat([p.longitude, p.latitude])
        .setPopup(new gl.Popup({ offset: 16, closeButton: false }).setDOMContent(popupEl))
        .addTo(map);
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
  // The web EXPORT doesn't load web's components.css, so marker visuals are
  // styled inline here (self-contained) — same shape as web CrewMap's CSS
  // classes, so the two surfaces look alike.
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of stageMarkersRef.current) m.remove();
    stageMarkersRef.current = [];

    for (const p of stagePins) {
      const color = p.color || '#19e3d3';
      const el = document.createElement('div');
      el.style.cssText = [
        'position:relative',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:14px',
        'height:14px',
        'border-radius:50%',
        `background:${color}`,
        'border:2px solid #fff',
        'box-shadow:0 0 6px rgba(0,0,0,0.5)',
        'cursor:pointer',
      ].join(';');
      el.setAttribute('aria-label', `Stage: ${p.label}`);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      const tag = document.createElement('span');
      tag.style.cssText = [
        'position:absolute',
        'top:calc(100% + 3px)',
        'left:50%',
        'transform:translateX(-50%)',
        'white-space:nowrap',
        'max-width:120px',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'background:rgba(8,8,16,0.82)',
        'color:#eaeaf2',
        'font:700 10px/1.4 -apple-system,system-ui,sans-serif',
        'padding:1px 6px',
        'border-radius:8px',
        `border:1px solid ${color}`,
        'pointer-events:none',
      ].join(';');
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
      el.style.cssText = [
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:24px',
        'height:24px',
        'border-radius:50%',
        `background:${color}`,
        'border:2px solid #fff',
        'box-shadow:0 0 6px rgba(0,0,0,0.5)',
        'font-size:13px',
        'line-height:1',
        'cursor:pointer',
      ].join(';');
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

    const nowMs = Date.now();
    for (const peer of peerList) {
      if (!Number.isFinite(peer.lat) || !Number.isFinite(peer.lng)) continue;
      const rel = relAge(peer.serverAt);
      const stale = isPeerStale(peer.serverAt, nowMs);
      const initials = getInitials(peer.username || 'User') || '?';
      const el = document.createElement('div');
      el.className = stale ? 'festie-peer-marker festie-peer-marker--stale' : 'festie-peer-marker';
      // This export ships no components.css, so anchor the heading caret + stale
      // chip to the avatar explicitly (relative positioning) rather than the
      // MapLibre-transformed wrapper.
      el.style.position = 'relative';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${peer.username} — ${stale ? `last seen ${rel}` : `live location, ${rel}`}`);
      const iniEl = document.createElement('span');
      iniEl.textContent = initials;
      el.appendChild(iniEl);
      // Phase 4C: direction-of-travel pointer rotated by the GPS course (live peers
      // with a real heading only). Inline-styled — this surface ships no CSS file.
      const arrowGlyph = stale ? null : headingToArrow(peer.heading);
      if (arrowGlyph && typeof peer.heading === 'number') {
        const dir = document.createElement('span');
        dir.setAttribute('aria-hidden', 'true');
        dir.textContent = '▲';
        dir.style.cssText = [
          'position:absolute',
          'bottom:calc(100% - 1px)',
          'left:50%',
          'transform-origin:50% 14px',
          `transform:translateX(-50%) rotate(${peer.heading}deg)`,
          'font-size:9px',
          'line-height:1',
          'color:#19e3d3',
          'text-shadow:0 0 2px rgba(8,8,16,0.9)',
          'pointer-events:none',
        ].join(';');
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
      // Phase 4C popup chips: heading arrow, battery, remaining share window.
      const headingLabel = arrowGlyph ? subEl(`Heading ${arrowGlyph}`) : null;
      const batteryLabel = !stale ? formatBatteryLabel(peer.battery) : null;
      const batteryEl = batteryLabel ? subEl(`Battery ${batteryLabel}`) : null;
      // Peer low-power flag (#5): cue a live (non-stale) peer in battery-saver mode, next to battery.
      const lowPowerEl = !stale && peer.lowPower === true ? subEl('🍃 Low Power') : null;
      const windowLabel = !stale ? formatShareWindow(peer.expiresAt, nowMs) : null;
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
      // Click/Enter selects this peer as the pursue target (arrow + ETA).
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
  // drop cleared ones, and frame each EXACTLY once on first appearance. Keyed on
  // the identity set; coord ticks only reposition (the effect below).
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    const markers = sosMarkersRef.current;
    const present = new Set(sosList.filter((s) => s.position).map((s) => s.userId));

    // Remove markers for SOS that cleared (and forget their framed flag).
    for (const [uid, marker] of markers) {
      if (!present.has(uid)) {
        marker.remove();
        markers.delete(uid);
        sosFramedRef.current.delete(uid);
      }
    }

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
      // safe; assert the https scheme as belt-and-braces (mirrors CrewMap).
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
      // miss. Subsequent coord ticks reposition via the effect below.
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
  // A small aqua dot at each in-progress zone vertex / site-plan corner. Empty/
  // omitted ⇒ no dots. Re-rendered wholesale on each change (tiny N).
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
  // Explicit festival map-config bounds win (frame the grounds); otherwise fit
  // the union of everything plottable (meeting points + stages + amenities +
  // peers + SOS). The map was already centered on camera.center at creation.
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl || fittedRef.current) return;

    const cfgBounds = cameraRef.current.bounds;
    if (cfgBounds) {
      const [[west, south], [east, north]] = cfgBounds;
      map.fitBounds(new gl.LngLatBounds([west, south], [east, north]), { padding: 56, maxZoom: 17, duration: 0 });
      fittedRef.current = true;
      return;
    }

    const coords: [number, number][] = [
      ...pins.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...stagePins.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...amenityPins.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...zones.flatMap((z) => z.rings.flat()),
      ...(siteplan ? siteplan.corners : []),
      ...peerList
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => [p.lng, p.lat] as [number, number]),
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

  // Toggle placement mode: the next single map click drops a meeting point and
  // auto-exits (web parity with native's "Drop pin"). The click handler reads
  // placement through placingRef, kept in sync by the effect above.
  const togglePlacement = useCallback(() => {
    setPlacing((prev) => !prev);
  }, []);

  // "Find me": recenter the map to the browser's geolocation fix. Uses the web
  // navigator.geolocation API (no native module) — permission denial / failure
  // is silent, leaving the map where it is. Mirrors native recenterToMe.
  const recenterToMe = useCallback(() => {
    if (locating) return;
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) return;
    setLocating(true);
    geo.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        if (mapRef.current) mapRef.current.flyTo({ center: [longitude, latitude], zoom: 16, duration: 600 });
      },
      () => {
        // Best-effort: leave the map where it is on any failure.
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [locating, status]);

  // ── Live map (DOM container; markers are mounted via the effects above) ─────
  // We render the map UNLESS the GL lib errored out — then we drop to the honest
  // list below. The list is also used as the empty state (nothing to plot).
  if (shouldRenderMap && status !== 'error') {
    const peerCount = peerList.length;
    const countCopy = [
      pins.length ? (pins.length === 1 ? '1 mapped point' : `${pins.length} mapped points`) : '',
      stagePins.length ? (stagePins.length === 1 ? '1 stage' : `${stagePins.length} stages`) : '',
      amenityPins.length ? (amenityPins.length === 1 ? '1 amenity' : `${amenityPins.length} amenities`) : '',
      peerCount ? (peerCount === 1 ? '1 live crew member' : `${peerCount} live crew members`) : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <View style={styles.screen}>
        {/* The map mounts into this DOM node. On react-native-web a View is a div,
            and the ref resolves to that element MapLibre can attach to. */}
        <View
          // @ts-expect-error react-native-web forwards the DOM node to ref; RN's
          // View ref type doesn't model HTMLDivElement but at runtime it is one.
          ref={containerRef}
          style={styles.mapCanvas}
          accessibilityRole="none"
          accessibilityLabel="Crew map with meeting points and live locations"
        />
        {status === 'pending' ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <Text style={styles.loadingText}>Loading map…</Text>
          </View>
        ) : null}

        {/* On-map controls (parity with native): "Drop pin" placement toggle +
            "find me" recenter. Shown once the map is interactive. */}
        {status === 'ready' ? (
          <>
            {onMapPress ? (
              <>
                {placing ? (
                  <View style={styles.mapHint} pointerEvents="none">
                    <Ionicons name="locate-outline" size={14} color={t.colors.text.onAccent} />
                    <Text style={styles.mapHintText} numberOfLines={1}>
                      Click the map to drop a meeting point
                    </Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  testID="map-drop-pin-toggle"
                  style={[styles.dropPinButton, placing ? styles.dropPinButtonActive : null]}
                  onPress={togglePlacement}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={placing ? 'Cancel dropping a meeting point' : 'Drop a meeting point on the map'}
                  accessibilityState={{ selected: placing }}
                >
                  <Ionicons
                    name={placing ? 'close' : 'add-circle-outline'}
                    size={16}
                    color={placing ? t.colors.text.onAccent : t.colors.accent.aqua}
                  />
                  <Text style={[styles.dropPinText, placing ? styles.dropPinTextActive : null]} numberOfLines={1}>
                    {placing ? 'Cancel' : 'Drop pin'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity
              testID="map-recenter-fab"
              style={styles.recenterFab}
              onPress={recenterToMe}
              disabled={locating}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Recenter the map on my location"
              accessibilityState={{ disabled: locating }}
            >
              {locating ? (
                <ActivityIndicator size="small" color={t.colors.accent.aqua} />
              ) : (
                <Ionicons name="locate" size={20} color={t.colors.accent.aqua} />
              )}
            </TouchableOpacity>

            {/* Pursue overlay: directional arrow + "Alex · 210 m NE · ~3 min". */}
            {liveTarget ? (
              <View
                style={[styles.pursueBar, pursueIsSos ? styles.pursueBarSos : null]}
                accessibilityRole="text"
                accessibilityLabel={
                  pursuit
                    ? `Pursuing ${liveTarget.label}, ${pursuit.distanceLabel}${pursuit.compass ? ' ' + pursuit.compass : ''}${pursuit.etaLabel !== '—' ? ', about ' + pursuit.etaLabel : ''}`
                    : `Enable location to pursue ${liveTarget.label}`
                }
              >
                {selfCoord && pursuit && Number.isFinite(pursuit.bearingDeg) ? (
                  <Ionicons
                    name="navigate"
                    size={24}
                    color={pursueIsSos ? t.colors.accent.coral : t.colors.accent.aqua}
                    // The Ionicons "navigate" glyph points NE (45°) at rotation 0,
                    // so subtract 45° so a due-north target points straight up.
                    style={{ transform: [{ rotate: `${pursuit.bearingDeg - 45}deg` }] }}
                  />
                ) : (
                  <Ionicons name="navigate-outline" size={24} color={t.colors.text.muted} />
                )}
                <View style={styles.pursueBody}>
                  {selfCoord && pursuit ? (
                    <Text style={styles.pursueLabel} numberOfLines={1}>
                      <Text style={styles.pursueName}>{liveTarget.label}</Text>
                      {`  ${pursuit.distanceLabel}${pursuit.compass ? ' ' + pursuit.compass : ''}${pursuit.etaLabel !== '—' ? ' · ~' + pursuit.etaLabel : ''}`}
                    </Text>
                  ) : (
                    <TouchableOpacity onPress={enableLocation} accessibilityRole="button">
                      <Text style={styles.pursueEnable} numberOfLines={2}>
                        {geoState === 'denied'
                          ? 'Location blocked — enable it to pursue'
                          : geoState === 'locating'
                            ? 'Locating you…'
                            : `Enable location to pursue ${liveTarget.label}`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity
                  onPress={clearPursue}
                  style={styles.pursueClose}
                  accessibilityRole="button"
                  accessibilityLabel="Stop pursuing"
                >
                  <Ionicons name="close" size={16} color={t.colors.text.muted} />
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Nearest-X + amenity filter chips. */}
            {hasAmenities ? (
              <View style={styles.chipDock} pointerEvents="box-none">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                  keyboardShouldPersistTaps="handled"
                >
                  {NEAREST_TARGETS.filter((nt) => amenityPins.some((p) => p.amenityType === nt.type)).map((nt) => {
                    const { glyph } = amenityGlyph(nt.type);
                    return (
                      <TouchableOpacity
                        key={`near-${nt.type}`}
                        style={styles.nearestChip}
                        onPress={() => pursueNearest(nt.type)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel={`Find and pursue the nearest ${nt.label}`}
                      >
                        <Text style={styles.chipGlyph}>{glyph}</Text>
                        <Text style={styles.nearestChipText}>{`Nearest ${nt.label}`}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {AMENITY_CATEGORIES.filter((type) => amenityPins.some((p) => p.amenityType === type)).map((type) => {
                    const { glyph } = amenityGlyph(type);
                    const on = !hiddenAmenities.has(type);
                    return (
                      <TouchableOpacity
                        key={`filter-${type}`}
                        style={[styles.filterChip, on ? styles.filterChipOn : styles.filterChipOff]}
                        onPress={() => toggleAmenity(type)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${on ? 'Hide' : 'Show'} ${type} amenities`}
                      >
                        <Text style={[styles.chipGlyph, on ? null : styles.chipGlyphOff]}>{glyph}</Text>
                        <Text style={[styles.filterChipText, on ? styles.filterChipTextOn : null]}>{type}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </>
        ) : null}

        {countCopy ? <Text style={styles.countCopy}>{countCopy}</Text> : null}
      </View>
    );
  }

  // ── Honest fallback list (GL failed, or nothing to plot) ────────────────────
  const coorded = pins;
  const livePeerPins = livePins.filter((p) => p.kind === 'peer');
  const hasAny = coorded.length > 0 || uncoordedPoints.length > 0 || livePins.length > 0;
  const failed = status === 'error';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.fallbackContent, { paddingBottom: bottomPad }]}>
      <View style={[styles.banner, failed ? styles.bannerOffline : null]}>
        <Ionicons
          name={failed ? 'cloud-offline-outline' : 'map-outline'}
          size={18}
          color={failed ? t.colors.accent.amber : t.colors.accent.aqua}
        />
        <Text style={styles.bannerText}>
          {failed
            ? 'Map needs signal to load. Showing your saved meeting points and live crew.'
            : 'The interactive map is available in the Festie app. Showing your meeting points and live crew here.'}
        </Text>
      </View>

      {/* SOS first — safety-critical, even with no map. One row per active SOS. */}
      {sosList.map((s) => (
        <View
          key={`sos:${s.userId}`}
          style={styles.sosRow}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={`SOS from ${s.username}${s.message ? ', ' + s.message : ''}`}
        >
          <Ionicons name="warning" size={20} color={t.colors.accent.coral} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{s.username} — SOS</Text>
            <Text style={styles.rowSub}>
              {s.message || (s.position ? 'Shared their location' : 'No location — reach them directly')}
            </Text>
            {s.position ? (
              <Text style={styles.rowCoord}>
                {s.position.lat.toFixed(5)}, {s.position.lng.toFixed(5)}
              </Text>
            ) : null}
          </View>
        </View>
      ))}

      {/* Live peers — honest "last seen N ago" with no map. */}
      {livePeerPins.map((p) => (
        <View
          key={p.id}
          style={styles.row}
          accessible
          // Non-interactive info row (no onPress) — 'text', not 'button', so
          // screen readers don't announce a phantom actionable control.
          accessibilityRole="text"
          accessibilityLabel={`${p.label}, ${p.sublabel}`}
          accessibilityHint={`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}
        >
          <Ionicons name="navigate-circle" size={18} color={t.colors.accent.aqua} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{p.label}</Text>
            <Text style={styles.rowSub}>{p.sublabel}</Text>
            <Text style={styles.rowCoord}>
              {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
            </Text>
          </View>
        </View>
      ))}

      {!hasAny ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="location-outline" size={32} color={t.colors.text.muted} />
          <Text style={styles.emptyTitle}>No meeting points yet</Text>
          <Text style={styles.emptyMsg}>
            Add a meeting point with a location in the Crew tab and it'll show here.
          </Text>
        </View>
      ) : null}

      {coorded.map((pin) => (
        <View
          key={pin.id}
          style={styles.row}
          // a11y: announce the whole row as one meeting-point entry so the
          // coords read as metadata, not a separate flat list item.
          accessible={true}
          // Non-interactive info row (no onPress) — 'text', not 'button'.
          accessibilityRole="text"
          accessibilityLabel={`Meeting point: ${pin.label}${pin.sublabel ? ', ' + pin.sublabel : ''}`}
          accessibilityHint={`${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
        >
          <Ionicons name="location" size={18} color={t.colors.accent.coral} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{pin.label}</Text>
            {pin.sublabel ? <Text style={styles.rowSub}>{pin.sublabel}</Text> : null}
            <Text style={styles.rowCoord}>
              {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
            </Text>
          </View>
        </View>
      ))}

      {uncoordedPoints.map((p) => (
        <View
          key={p.id}
          style={styles.row}
          accessible={true}
          // Non-interactive info row (no onPress) — 'text', not 'button'.
          accessibilityRole="text"
          accessibilityLabel={`Meeting point: ${p.label}${p.location ? ', ' + p.location : ''}`}
          accessibilityHint="No coordinates pinned"
        >
          <Ionicons name="location-outline" size={18} color={t.colors.text.muted} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{p.label}</Text>
            {p.location ? <Text style={styles.rowSub}>{p.location}</Text> : null}
            <Text style={styles.rowCoordMuted}>No pinned location</Text>
          </View>
        </View>
      ))}

      {/* Stage/amenity map data: honest note when this festival was never mapped. */}
      {!hasStages && !hasAmenities ? (
        <Text style={styles.stageNote}>This festival isn't mapped yet.</Text>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  mapCanvas: {
    flex: 1,
    backgroundColor: t.colors.bg.secondary,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    backgroundColor: t.colors.bg.secondary,
  },
  loadingText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // Floating placement hint, top-centered, non-interactive (parity with native).
  mapHint: {
    position: 'absolute',
    top: t.spacing[3],
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.shade[10],
  },
  mapHintText: {
    ...typeStyle('micro'),
    color: t.colors.text.onAccent,
  },
  // ── Pursue overlay (arrow + label), top of the map below the tap hint ──────
  pursueBar: {
    position: 'absolute',
    top: t.spacing[3],
    left: t.spacing[4],
    right: t.spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.elevated,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  pursueBarSos: {
    borderColor: t.colors.accent.coral,
  },
  pursueBody: {
    flex: 1,
    minWidth: 0,
  },
  pursueLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  pursueName: {
    ...typeStyle('caption', 700),
    color: t.colors.text.primary,
  },
  pursueEnable: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  pursueClose: {
    padding: t.spacing[1],
  },
  // ── Nearest-X + amenity filter chip dock, just above the bottom FABs ───────
  chipDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: t.spacing[5] + 56 + 48,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
  },
  chipGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  chipGlyphOff: {
    opacity: 0.4,
  },
  nearestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  nearestChipText: {
    ...typeStyle('micro', 600),
    color: t.colors.text.primary,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
  },
  filterChipOn: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  filterChipOff: {
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  filterChipText: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  filterChipTextOn: {
    color: t.colors.text.primary,
  },
  // "Drop pin" placement toggle, pinned bottom-right just above the "find me" FAB.
  dropPinButton: {
    position: 'absolute',
    right: t.spacing[4],
    bottom: t.spacing[5] + 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    minHeight: 40,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  dropPinButtonActive: {
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.accent.coralStrong,
  },
  dropPinText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  dropPinTextActive: {
    color: t.colors.text.onAccent,
  },
  // Round "find me" control, pinned bottom-right (parity with native).
  recenterFab: {
    position: 'absolute',
    right: t.spacing[4],
    bottom: t.spacing[5],
    width: 48,
    height: 48,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  countCopy: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
    padding: t.spacing[2],
  },
  fallbackContent: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  bannerOffline: {
    borderColor: t.colors.accent.amber,
    backgroundColor: t.colors.amberAlpha[12],
  },
  bannerText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  emptyBlock: {
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[6],
  },
  emptyTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  emptyMsg: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  sosRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowLabel: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  rowSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  rowCoord: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  rowCoordMuted: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  stageNote: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
    paddingTop: t.spacing[2],
  },
}));
