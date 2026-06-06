import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import {
  extractMeetingPointPins,
  extractStagePins,
  pinsCentroid,
  formatStaleness,
  type MapPin,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';

/** A peer/SOS marker pushed into the WebView via window.__festieSetPeers. */
interface LivePin {
  id: string;
  label: string;
  sublabel?: string;
  initial: string;
  latitude: number;
  longitude: number;
  kind: 'peer' | 'sos';
}

/** Two-letter-ish initial for a peer dot (fallback "?"). */
function initialFor(name: string | undefined): string {
  const c = (name ?? '').trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

/**
 * OfflineMap — M6 offline map via WebView (lowest native risk: react-native-webview
 * is already a dep, no native maps module added).
 *
 * The WebView hosts MapLibre GL JS loaded from a CDN. Meeting-point pins (F4
 * coords) are passed RN -> WebView via postMessage and rendered as markers.
 *
 * OFFLINE-HONEST: MapLibre's script/style + the basemap tiles are CDN-hosted, so
 * the *interactive* map only renders with signal. When it can't load (truly
 * offline, no CDN) we DO NOT show a blank WebView — `onError` / a JS load-timeout
 * flips us to a graceful fallback list of the same pins + the honest copy
 * "map needs the festival downloaded for offline". This component never implies
 * a live map is available with no signal.
 *
 * TRUE-OFFLINE TODO (F5): bundle/ download the basemap as PMTiles + the MapLibre
 * assets so the interactive map works with zero network. Today the fallback list
 * is the offline path; the WebView map is the online enhancement.
 */

const MAPLIBRE_VERSION = '4.7.1';
const MAPLIBRE_JS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_CSS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
// A free OpenStreetMap raster style (no API key). CDN-hosted tiles — online-only
// today; F5 swaps this for a downloaded PMTiles source for true offline.
const RASTER_STYLE_JSON = JSON.stringify({
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
});

// If MapLibre's script hasn't signalled "ready" within this window we assume no
// CDN (offline) and fall back to the list. Generous to tolerate a slow venue link.
const LOAD_TIMEOUT_MS = 8000;

interface OfflineMapProps {
  meetingPoints: CrewMeetingPoint[];
  /** Live crew peers currently sharing (ephemeral; from liveLocationStore). */
  peers?: PeerLocation[];
  /** Active crew SOS, if any (ephemeral; from liveLocationStore). */
  sos?: SosEntry | null;
}

/**
 * Build the HTML document hosting MapLibre. Pins are injected up front as a JSON
 * blob (and can also be pushed later via postMessage). The page posts back
 * `{type:'ready'}` once the map style loads and `{type:'error'}` if the script
 * never arrives — RN uses those to decide map vs fallback.
 */
function buildHtml(pins: MapPin[], center: { latitude: number; longitude: number } | null): string {
  const pinsJson = JSON.stringify(pins);
  const centerJson = JSON.stringify(center ?? { latitude: 0, longitude: 0 });
  const hasCenter = center != null;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="${MAPLIBRE_CSS}" rel="stylesheet" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #080810; }
    .festie-marker {
      width: 18px; height: 18px; border-radius: 50%;
      background: #ff3366; border: 2px solid #fff;
      box-shadow: 0 0 8px rgba(255,51,102,0.6);
    }
    /* Live peer: aqua dot with the member's initial + a pulsing ring, visually
       distinct from the coral meeting-point pins. */
    .festie-peer {
      width: 26px; height: 26px; border-radius: 50%;
      background: #00e8d0; color: #080810; border: 2px solid #fff;
      font: 700 12px -apple-system, system-ui, sans-serif;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 4px rgba(0,232,208,0.25);
      animation: festiePulse 2s ease-out infinite;
    }
    /* SOS: emphasized, larger coral marker with a stronger pulse. */
    .festie-sos {
      width: 30px; height: 30px; border-radius: 50%;
      background: #ff3366; color: #fff; border: 3px solid #fff;
      font: 700 16px -apple-system, system-ui, sans-serif;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 6px rgba(255,51,102,0.35);
      animation: festiePulse 1.2s ease-out infinite;
    }
    @keyframes festiePulse {
      0% { box-shadow: 0 0 0 0 rgba(0,232,208,0.45); }
      100% { box-shadow: 0 0 0 14px rgba(0,232,208,0); }
    }
    .maplibregl-popup-content { font-family: -apple-system, system-ui, sans-serif; font-size: 13px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var PINS = ${pinsJson};
    var CENTER = ${centerJson};
    var HAS_CENTER = ${hasCenter};
    var HAD_PINS = PINS.length > 0;

    function post(msg) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    }

    function renderPins(map, pins) {
      var bounds = null;
      pins.forEach(function (p) {
        var el = document.createElement('div');
        el.className = 'festie-marker';
        // a11y: expose marker label to screen readers + automation (the marker
        // is otherwise a bare styled div with no accessible name).
        var aLabel = p.label + (p.sublabel ? ' - ' + p.sublabel : '');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', aLabel);
        el.setAttribute('title', aLabel);
        var popupHtml = '<strong>' + escapeHtml(p.label) + '</strong>' +
          (p.sublabel ? '<br/>' + escapeHtml(p.sublabel) : '');
        var marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.longitude, p.latitude])
          .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(popupHtml))
          .addTo(map);
        if (!bounds) {
          bounds = new maplibregl.LngLatBounds([p.longitude, p.latitude], [p.longitude, p.latitude]);
        } else {
          bounds.extend([p.longitude, p.latitude]);
        }
      });
      if (bounds && pins.length > 1) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
      }
    }

    // Live peer + SOS markers are pushed separately from meeting points and are
    // fully re-rendered on every update (peers move), so we track + remove the
    // previous batch instead of stacking duplicates.
    var LIVE_MARKERS = [];
    function renderLive(map, live) {
      LIVE_MARKERS.forEach(function (m) { try { m.remove(); } catch (e) {} });
      LIVE_MARKERS = [];
      var items = (live && live.items) || [];
      var bounds = null;
      items.forEach(function (p) {
        var el = document.createElement('div');
        el.className = p.kind === 'sos' ? 'festie-sos' : 'festie-peer';
        el.textContent = p.kind === 'sos' ? '!' : (p.initial || '?');
        var aLabel = p.label + (p.sublabel ? ' - ' + p.sublabel : '');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', aLabel);
        el.setAttribute('title', aLabel);
        var popupHtml = '<strong>' + escapeHtml(p.label) + '</strong>' +
          (p.sublabel ? '<br/>' + escapeHtml(p.sublabel) : '');
        var marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.longitude, p.latitude])
          .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(popupHtml))
          .addTo(map);
        LIVE_MARKERS.push(marker);
        if (!bounds) {
          bounds = new maplibregl.LngLatBounds([p.longitude, p.latitude], [p.longitude, p.latitude]);
        } else {
          bounds.extend([p.longitude, p.latitude]);
        }
      });
      // Only auto-frame live markers when there were no meeting-point pins to
      // anchor the view; otherwise respect the meeting-point framing.
      if (bounds && !HAD_PINS && items.length > 0) {
        map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 300 });
      }
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function init() {
      if (typeof maplibregl === 'undefined') { post({ type: 'error', reason: 'no-maplibre' }); return; }
      try {
        var map = new maplibregl.Map({
          container: 'map',
          style: ${RASTER_STYLE_JSON},
          center: HAS_CENTER ? [CENTER.longitude, CENTER.latitude] : [0, 0],
          zoom: HAS_CENTER ? 15 : 1,
          attributionControl: { compact: true }
        });
        map.on('load', function () {
          renderPins(map, PINS);
          post({ type: 'ready', pins: PINS.length });
        });
        map.on('error', function (e) { post({ type: 'error', reason: 'map-error' }); });

        // Allow RN to push fresh pins later without a reload.
        window.__festieSetPins = function (next) {
          try {
            renderPins(map, next || []);
            post({ type: 'pins-updated', pins: (next || []).length });
          } catch (err) { post({ type: 'error', reason: 'pin-update' }); }
        };

        // Push live peers + SOS markers (re-rendered each call).
        window.__festieSetPeers = function (live) {
          try {
            renderLive(map, live || { items: [] });
            post({ type: 'peers-updated', peers: ((live && live.items) || []).length });
          } catch (err) { post({ type: 'error', reason: 'peer-update' }); }
        };
      } catch (err) {
        post({ type: 'error', reason: 'init-throw' });
      }
    }

    var script = document.createElement('script');
    script.src = '${MAPLIBRE_JS}';
    script.onload = init;
    script.onerror = function () { post({ type: 'error', reason: 'script-load' }); };
    document.head.appendChild(script);
  </script>
</body>
</html>`;
}

export default function OfflineMap({ meetingPoints, peers, sos }: OfflineMapProps) {
  const t = useTokens();
  const styles = useStyles();
  const webRef = useRef<WebView>(null);

  const pins = useMemo(() => extractMeetingPointPins(meetingPoints), [meetingPoints]);
  const stagePins = useMemo(() => extractStagePins(), []); // [] today — see mapPins TODO
  const center = useMemo(() => pinsCentroid(pins), [pins]);

  const hasLive = (peers?.length ?? 0) > 0 || !!sos;

  // Live peer + SOS markers pushed into the WebView (and listed in the fallback).
  const livePins = useMemo<LivePin[]>(() => {
    const items: LivePin[] = [];
    for (const p of peers ?? []) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      items.push({
        id: `peer:${p.userId}`,
        label: p.username || 'Crew member',
        sublabel: `live · ${formatStaleness(p.serverAt).replace(/^as of /, '')}`,
        initial: initialFor(p.username),
        latitude: p.lat,
        longitude: p.lng,
        kind: 'peer',
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
  }, [peers, sos]);

  // Meeting points present but without coords — listed so they're never lost,
  // even though they can't be plotted.
  const uncoordedPoints = useMemo(
    () =>
      (meetingPoints ?? []).filter(
        (p) => p && p.active !== false && !(Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      ),
    [meetingPoints],
  );

  const html = useMemo(() => buildHtml(pins, center), [pins, center]);

  // 'loading' → WebView mounted, waiting for MapLibre; 'map' → interactive map up;
  // 'fallback' → CDN/offline failure, render the honest list instead. Start in
  // loading whenever there's anything to plot (meeting points OR live markers).
  const [phase, setPhase] = useState<'loading' | 'map' | 'fallback'>(
    pins.length === 0 && !hasLive ? 'fallback' : 'loading',
  );

  const fellBackRef = useRef(false);
  const fallBack = useCallback(() => {
    if (fellBackRef.current) return;
    fellBackRef.current = true;
    setPhase('fallback');
  }, []);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { type?: string; reason?: string } = {};
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        if (!fellBackRef.current) setPhase('map');
      } else if (msg.type === 'error') {
        // Only a load/init failure means "no map" → fall back. A transient
        // pin/peer re-render glitch must NOT tear the whole map down.
        if (msg.reason !== 'pin-update' && msg.reason !== 'peer-update') fallBack();
      }
    },
    [fallBack],
  );

  // Arm an offline timeout on load start: if MapLibre never signals 'ready'
  // within the window we assume no CDN (truly offline) and fall back to the list.
  const armTimeout = useCallback(() => {
    setTimeout(() => {
      setPhase((p) => {
        if (p === 'loading') {
          fellBackRef.current = true;
          return 'fallback';
        }
        return p;
      });
    }, LOAD_TIMEOUT_MS);
  }, []);

  // If we fell back only because there was nothing to plot (NOT a CDN/offline
  // error — fellBackRef tracks real failures), try the map once live markers or
  // meeting points show up.
  useEffect(() => {
    if (phase === 'fallback' && !fellBackRef.current && (pins.length > 0 || hasLive)) {
      setPhase('loading');
    }
  }, [phase, pins.length, hasLive]);

  // Push live peer + SOS markers into the WebView whenever they change and the
  // map is up. injectJavaScript re-renders the live layer (peers move).
  const liveJson = useMemo(() => JSON.stringify({ items: livePins }), [livePins]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetPeers && window.__festieSetPeers(${liveJson}); true;`);
  }, [phase, liveJson]);

  // ── Fallback list (offline-honest) ─────────────────────────────────────────
  if (phase === 'fallback') {
    const coorded = pins;
    const livePeerPins = livePins.filter((p) => p.kind === 'peer');
    const hasAny = coorded.length > 0 || uncoordedPoints.length > 0 || livePins.length > 0;
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.fallbackContent}>
        <View style={styles.banner}>
          <Ionicons name="cloud-offline-outline" size={18} color={t.colors.accent.amber} />
          <Text style={styles.bannerText}>
            Map needs the festival downloaded for offline. Showing your saved meeting points.
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
            accessibilityRole="button"
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
            accessibilityRole="button"
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
            accessibilityRole="button"
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

        {/* Stages: no coords in the data model today (see mapPins TODO). */}
        {stagePins.length === 0 ? <Text style={styles.stageNote}>Stage locations aren't mapped yet.</Text> : null}
      </ScrollView>
    );
  }

  // ── Map (WebView) ───────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.web}
        onMessage={onMessage}
        onLoadStart={armTimeout}
        onError={fallBack}
        onHttpError={fallBack}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
      />
      {phase === 'loading' ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color={t.colors.accent.aqua} />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  web: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
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
    backgroundColor: t.colors.bg.primary,
  },
  loadingText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
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
    borderColor: t.colors.accent.amber,
    backgroundColor: t.colors.amberAlpha[12],
  },
  bannerText: {
    ...typeStyle('caption'),
    // Neutral tone: amber icon + border already signal "offline"; muted text
    // keeps this informational ("here's what you get offline") rather than
    // reading as an error/warning.
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
    ...typeStyle('body'),
    color: t.colors.text.primary,
    fontWeight: '600',
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
