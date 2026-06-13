import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { Ionicons } from '@expo/vector-icons';
import {
  extractMeetingPointPins,
  extractStagePins,
  pinsCentroid,
  formatStaleness,
  isPeerStale,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';

/** A peer/SOS marker pushed into the WebView via window.__festieSetPeers. */
interface LivePin {
  id: string;
  label: string;
  sublabel?: string;
  initial: string;
  latitude: number;
  longitude: number;
  kind: 'peer' | 'sos';
  /** Peer's last fix has aged past the freshness window (desaturate + chip). */
  stale?: boolean;
  /** Short "N ago" age shown on the stale chip (no "as of" prefix). */
  age?: string;
}

/** Up-to-two-letter initials for an avatar marker (fallback "?"). */
function initialsFor(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Context-aware serializer for values pushed INTO the WebView's JS context via
 * injectJavaScript. `JSON.stringify` alone is NOT safe to splice into a script
 * context: it does not escape `<` (so a `</script>`-style payload could break
 * out if the result were ever placed in an inline <script>), nor the JS line
 * terminators U+2028 / U+2029 (which are literal newlines inside a JS string
 * and would produce a syntax error / injection seam). We escape all three to
 * `\uXXXX` so the result is safe in both JS-string and HTML contexts. This is
 * the single hardened transport for ALL user-controlled pin/peer/SOS data
 * (security-review-2026-06-06 H3 + L6).
 */
// U+2028 / U+2029 are valid whitespace in JSON output but are literal line
// terminators inside a JS string literal — they must be \u-escaped before the
// JSON is spliced into the WebView's JS context. Built from char codes so this
// source file stays plain-ASCII.
const LS_RE = new RegExp(String.fromCharCode(0x2028), 'g');
const PS_RE = new RegExp(String.fromCharCode(0x2029), 'g');

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(LS_RE, '\\u2028').replace(PS_RE, '\\u2029');
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

// Origins the inline map document is allowed to load/navigate to. The page is
// served as inline HTML (about:blank origin) and only pulls MapLibre from unpkg
// + raster tiles from OpenStreetMap. Narrowed off the old ['*'] so the WebView
// can't be navigated to an arbitrary attacker origin (security-review H3 / I4).
const MAP_ORIGIN_WHITELIST = [
  'about:',
  'https://unpkg.com',
  'https://tile.openstreetmap.org',
  'https://*.tile.openstreetmap.org',
];

// Hosts permitted for in-WebView resource/navigation loads. Anything else is
// blocked (default-deny), mirroring the hardened Spotify embed WebView.
function isAllowedMapHost(host: string): boolean {
  return host === 'unpkg.com' || /(^|\.)tile\.openstreetmap\.org$/.test(host);
}

/**
 * Default-DENY navigation guard. Allows the inline document's own load
 * (about:blank / data:) and resource loads from the map's CDN + tile hosts;
 * blocks every other origin so an injected payload cannot redirect the WebView
 * off to an attacker host. The map never legitimately navigates elsewhere.
 */
function onShouldStartLoadWithRequest(req: ShouldStartLoadRequest): boolean {
  const url = req.url || '';
  // The inline HTML document itself (no real origin) + data URIs MapLibre uses.
  if (url === 'about:blank' || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) {
    return true;
  }
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return isAllowedMapHost(host);
}

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
 * Build the HTML document hosting MapLibre.
 *
 * SECURITY (security-review-2026-06-06 H3 + L6): NO user-controlled data is ever
 * interpolated into this document. The page bootstraps with an EMPTY pin set;
 * meeting-point pins, live peers and SOS markers are all pushed in AFTER load
 * via `injectJavaScript` (window.__festieSetPins / __festieSetPeers) using the
 * `safeJsonForScript` serializer, which escapes for both JS-string and HTML
 * contexts. Only the numeric map center (non-user-controlled, range-checked
 * coords) is templated in here. An in-document CSP + the WebView's
 * `originWhitelist` + `onShouldStartLoadWithRequest` provide defense in depth.
 *
 * The page posts back `{type:'ready'}` once the map style loads and
 * `{type:'error'}` if the script never arrives — RN uses those to decide map vs
 * fallback.
 */
function buildHtml(center: { latitude: number; longitude: number } | null): string {
  // center is numeric, non-user-controlled coords — safe to template. Still run
  // it through the hardened serializer for uniformity.
  const centerJson = safeJsonForScript(center ?? { latitude: 0, longitude: 0 });
  const hasCenter = center != null;
  // CSP confines what the document may load/connect to: MapLibre JS/CSS from
  // unpkg, raster tiles from OpenStreetMap, inline styles/scripts and blob/data
  // workers MapLibre needs. No other origins — so an injected payload (defense
  // in depth behind H3's transport fix) cannot exfiltrate to an attacker host.
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://unpkg.com blob:",
    "style-src 'unsafe-inline' https://unpkg.com",
    'img-src data: blob: https://*.tile.openstreetmap.org https://unpkg.com',
    'connect-src https://unpkg.com https://*.tile.openstreetmap.org',
    'worker-src blob:',
    'font-src data:',
  ].join('; ');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="${MAPLIBRE_CSS}" rel="stylesheet" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #080810; }
    .festie-marker {
      width: 18px; height: 18px; border-radius: 50%;
      background: #ff3366; border: 2px solid #fff;
      box-shadow: 0 0 8px rgba(255,51,102,0.6);
    }
    /* Live peer: aqua avatar disc with the member's initials + a pulsing ring,
       visually distinct from the coral meeting-point pins. */
    .festie-peer {
      position: relative;
      width: 26px; height: 26px; border-radius: 50%;
      background: #00e8d0; color: #080810; border: 2px solid #fff;
      font: 700 11px -apple-system, system-ui, sans-serif;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 4px rgba(0,232,208,0.25);
      animation: festiePulse 2s ease-out infinite;
    }
    /* Stale peer (Snap Map-style): desaturated, no pulse, "last seen N ago" chip
       so an out-of-date dot can't be mistaken for a live one. */
    .festie-peer-stale {
      background: #6b6b80; color: #0c0c12; border-color: #cfcfe0;
      box-shadow: none; animation: none; opacity: 0.9; filter: grayscale(1);
    }
    .festie-chip {
      position: absolute; top: 28px; left: 50%; transform: translateX(-50%);
      white-space: nowrap; background: rgba(8,8,16,0.9); color: #cfcfe0;
      font: 600 10px -apple-system, system-ui, sans-serif;
      padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.14);
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
    // SECURITY: bootstrap EMPTY. Meeting-point pins are pushed in via
    // window.__festieSetPins AFTER 'ready' (see RN side) — never templated here,
    // so user-controlled label/sublabel text can never reach this script context
    // (security-review-2026-06-06 H3). CENTER is numeric coords only.
    var PINS = [];
    var CENTER = ${centerJson};
    var HAS_CENTER = ${hasCenter};
    // Tracks whether meeting-point pins exist, so live peer/SOS auto-framing only
    // kicks in when there are no pins to anchor the view. Updated by __festieSetPins.
    var HAD_PINS = false;

    function post(msg) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    }

    // Meeting-point markers. renderPins is now called repeatedly (pins are pushed
    // in after load via __festieSetPins), so we track + remove the previous batch
    // to avoid stacking duplicates on re-push.
    var PIN_MARKERS = [];
    function renderPins(map, pins) {
      PIN_MARKERS.forEach(function (m) { try { m.remove(); } catch (e) {} });
      PIN_MARKERS = [];
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
        PIN_MARKERS.push(marker);
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
        if (p.kind === 'sos') {
          el.className = 'festie-sos';
          el.textContent = '!';
        } else {
          // Avatar disc: greyed + chipped when stale, pulsing aqua when live. All
          // text via textContent — never parsed as HTML (security-review H3/L6).
          el.className = p.stale ? 'festie-peer festie-peer-stale' : 'festie-peer';
          var ini = document.createElement('span');
          ini.textContent = p.initial || '?';
          el.appendChild(ini);
          if (p.stale && p.age) {
            var chip = document.createElement('span');
            chip.className = 'festie-chip';
            chip.textContent = p.age;
            el.appendChild(chip);
          }
        }
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

        // RN pushes meeting-point pins here (after 'ready', and on any change).
        // This is the ONLY way pin data enters the document — never templated.
        window.__festieSetPins = function (next) {
          try {
            var arr = next || [];
            HAD_PINS = arr.length > 0;
            renderPins(map, arr);
            post({ type: 'pins-updated', pins: arr.length });
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
  const bottomPad = useListBottomInset();
  const webRef = useRef<WebView>(null);

  const pins = useMemo(() => extractMeetingPointPins(meetingPoints), [meetingPoints]);
  const stagePins = useMemo(() => extractStagePins(), []); // [] today — see mapPins TODO
  const center = useMemo(() => pinsCentroid(pins), [pins]);

  const hasLive = (peers?.length ?? 0) > 0 || !!sos;

  // Live peer + SOS markers pushed into the WebView (and listed in the fallback).
  // `now` ticks via useNow so staleness recomputes without an impure Date.now()
  // in the memo factory (react-hooks/purity).
  const now = useNow();
  const livePins = useMemo<LivePin[]>(() => {
    const items: LivePin[] = [];
    for (const p of peers ?? []) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const age = formatStaleness(p.serverAt).replace(/^as of /, '');
      const stale = isPeerStale(p.serverAt, now);
      items.push({
        id: `peer:${p.userId}`,
        label: p.username || 'Crew member',
        sublabel: stale ? `last seen ${age}` : `live · ${age}`,
        initial: initialsFor(p.username),
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

  // Meeting points present but without coords — listed so they're never lost,
  // even though they can't be plotted.
  const uncoordedPoints = useMemo(
    () =>
      (meetingPoints ?? []).filter(
        (p) => p && p.active !== false && !(Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      ),
    [meetingPoints],
  );

  // The HTML doc carries NO pin data — only the numeric center — so it only
  // rebuilds when the center changes (pins flow in via injectJavaScript below).
  const html = useMemo(() => buildHtml(center), [center]);

  // 'loading' → WebView mounted, waiting for MapLibre; 'map' → interactive map up;
  // 'fallback' → CDN/offline failure, render the honest list instead. Start in
  // loading whenever there's anything to plot (meeting points OR live markers).
  const [phase, setPhase] = useState<'loading' | 'map' | 'fallback'>(
    pins.length === 0 && !hasLive ? 'fallback' : 'loading',
  );

  const fellBackRef = useRef(false);
  // Holds the in-flight offline-fallback timer so a new onLoadStart (the WebView
  // can fire it repeatedly) clears the prior one instead of stacking timers, and
  // so we can clear it on unmount. Behavior is unchanged — only the leak is fixed.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setPhase((p) => {
        if (p === 'loading') {
          fellBackRef.current = true;
          return 'fallback';
        }
        return p;
      });
    }, LOAD_TIMEOUT_MS);
  }, []);

  // Clear any pending fallback timer when the component unmounts.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // If we fell back only because there was nothing to plot (NOT a CDN/offline
  // error — fellBackRef tracks real failures), try the map once live markers or
  // meeting points show up.
  useEffect(() => {
    if (phase === 'fallback' && !fellBackRef.current && (pins.length > 0 || hasLive)) {
      setPhase('loading');
    }
  }, [phase, pins.length, hasLive]);

  // Push meeting-point pins into the WebView once the map is up and whenever they
  // change. This is the ONLY path pin data enters the document — serialized with
  // the hardened context-aware serializer, never templated into the HTML (H3).
  const pinsJson = useMemo(() => safeJsonForScript(pins), [pins]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetPins && window.__festieSetPins(${pinsJson}); true;`);
  }, [phase, pinsJson]);

  // Push live peer + SOS markers into the WebView whenever they change and the
  // map is up. injectJavaScript re-renders the live layer (peers move). Same
  // hardened serializer — peer username / SOS message are user-controlled (L6).
  const liveJson = useMemo(() => safeJsonForScript({ items: livePins }), [livePins]);
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
      <ScrollView style={styles.screen} contentContainerStyle={[styles.fallbackContent, { paddingBottom: bottomPad }]}>
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
        // Default-deny navigation: the document is an inline (about:blank) page;
        // only its own load + MapLibre/CSS from unpkg + OSM raster tiles are
        // expected. Anything else (e.g. an injected redirect) is blocked so a
        // payload can't navigate the WebView off to an attacker host. Pairs with
        // the in-document CSP for defense in depth behind the H3 transport fix.
        originWhitelist={MAP_ORIGIN_WHITELIST}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
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
