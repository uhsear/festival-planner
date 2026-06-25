import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  /** Active crew SOS, if any (ephemeral; from liveLocationStore). */
  sos?: SosEntry | null;
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

// A free OpenStreetMap raster style (no API key). Online-only basemap — mirrors
// CrewMap.tsx so the web map and this map render identically.
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

export default function OfflineMap({ meetingPoints, peers, sos, onMapPress, festival = null }: OfflineMapProps) {
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

  // The DOM node MapLibre mounts into. On react-native-web a View renders a div,
  // and `ref` resolves to that DOM element.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const glRef = useRef<MapLibre | null>(null);
  const mpMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const stageMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const amenityMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const peerMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const sosMarkerRef = useRef<import('maplibre-gl').Marker | null>(null);
  const fittedRef = useRef(false);
  // The map's click handler is bound once at creation, so it reads placement +
  // the live onMapPress callback through refs rather than stale closure values.
  const placingRef = useRef(false);
  const onMapPressRef = useRef<OfflineMapProps['onMapPress']>(onMapPress);

  const pins = useMemo<Pin[]>(() => extractMeetingPointPins(meetingPoints), [meetingPoints]);
  // Stage + amenity pins from the festival's map data (Phase A/B contract).
  const stagePins = useMemo<Pin[]>(() => extractStagePins(festival), [festival]);
  const amenityPins = useMemo<Pin[]>(() => extractAmenityPins(festival?.mapConfig), [festival]);

  // `now` ticks via useNow so staleness recomputes without an impure Date.now()
  // in the memo factory (react-hooks/purity) — same pattern as OfflineMap.tsx.
  const now = useNow();

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
    if (sos?.position && Number.isFinite(sos.position.lat) && Number.isFinite(sos.position.lng)) {
      items.push({
        id: `sos:${sos.userId}`,
        label: `${sos.username} — SOS`,
        sublabel: sos.message || 'Needs help',
        initial: '!',
        latitude: sos.position.lat,
        longitude: sos.position.lng,
        kind: 'sos',
      });
    }
    return items;
  }, [peers, sos, now]);

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
  const hasPeers = peerList.length > 0;
  const hasSos = !!sos?.position;
  // Render the map when there's ANYTHING to plot (meeting points, stage/amenity
  // map data, live peers, or an SOS coord).
  const shouldRenderMap = hasPins || hasStages || hasAmenities || hasPeers || hasSos;

  // Initial camera: prefer the festival's explicit map-config (bounds/center),
  // then frame the static pins, then live peers / SOS. pickFestivalCamera owns
  // the static-pin precedence; we extend its fallback with the ephemeral coords.
  const staticPins = useMemo(() => [...pins, ...stagePins, ...amenityPins], [pins, stagePins, amenityPins]);
  const camera = useMemo(() => pickFestivalCamera(festival, staticPins), [festival, staticPins]);
  const center = useMemo(() => {
    if (camera.center) return camera.center;
    if (peerList[0]) return { latitude: peerList[0].lat, longitude: peerList[0].lng };
    if (sos?.position) return { latitude: sos.position.lat, longitude: sos.position.lng };
    return null;
    // Recompute only when the coord sources meaningfully change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, peerList.length, sos?.position?.lat, sos?.position?.lng]);

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
  const peersKey = useMemo(
    () => peerList.map((p) => `${p.userId}:${p.lat},${p.lng}:${p.serverAt}`).join('|'),
    [peerList],
  );
  const sosKey = sos ? `${sos.userId}:${sos.position?.lat},${sos.position?.lng}` : '';

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

    for (const p of amenityPins) {
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
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${peer.username} — ${stale ? `last seen ${rel}` : `live location, ${rel}`}`);
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
    // safe; assert the https scheme as belt-and-braces (mirrors CrewMap).
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
      ...peerList
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => [p.lng, p.lat] as [number, number]),
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

      {/* SOS first — safety-critical, even with no map. */}
      {sos ? (
        <View
          style={styles.sosRow}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={`SOS from ${sos.username}${sos.message ? ', ' + sos.message : ''}`}
        >
          <Ionicons name="warning" size={20} color={t.colors.accent.coral} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{sos.username} — SOS</Text>
            <Text style={styles.rowSub}>
              {sos.message || (sos.position ? 'Shared their location' : 'No location — reach them directly')}
            </Text>
            {sos.position ? (
              <Text style={styles.rowCoord}>
                {sos.position.lat.toFixed(5)}, {sos.position.lng.toFixed(5)}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

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
