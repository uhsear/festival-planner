import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
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
  buildPursuit,
  nearestPin,
  type Coord,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry, Festival, Stage, AmenityType } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';
import { safeJsonForScript, isAllowedMapHost, buildSetAuthoringScript } from '../lib/webviewBridge';
import type { AuthoringMode } from '../lib/webviewBridge';

/**
 * A static festival map-data marker (stage or amenity) pushed into the WebView
 * via window.__festieSetMapData. Glyph + color are resolved on the RN side from
 * the shared `amenityGlyph` map (single source of truth) so the inline document
 * needs no category logic of its own.
 */
interface MapMarker {
  id: string;
  kind: 'stage' | 'amenity';
  label: string;
  latitude: number;
  longitude: number;
  /** Fill color: stage brand color, or the amenity category color. */
  color: string;
  /** Emoji glyph for amenities; empty for stages (which show a label tag). */
  glyph?: string;
}

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

// Amenity categories the filter chips can toggle, in display order (mirrors the
// AmenityType union). Each renders a token chip carrying its shared glyph.
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

// The "nearest X" quick targets — the categories crew most need to reach fast.
const NEAREST_TARGETS: { type: AmenityType; label: string }[] = [
  { type: 'medical', label: 'medical' },
  { type: 'water', label: 'water' },
  { type: 'toilet', label: 'toilet' },
];

interface OfflineMapProps {
  meetingPoints: CrewMeetingPoint[];
  /** Live crew peers currently sharing (ephemeral; from liveLocationStore). */
  peers?: PeerLocation[];
  /** Active crew SOS, if any (ephemeral; from liveLocationStore). */
  sos?: SosEntry | null;
  /**
   * Tap-to-create: fired when the user long-presses the interactive map, with
   * the pressed coordinate. The screen wires this to the existing meeting-point
   * create flow (prefilled with these coords). Omit to disable the affordance.
   */
  onMapPress?: (coord: { latitude: number; longitude: number }) => void;
  /**
   * Current festival carrying `mapConfig` (amenities + camera) and, when the
   * caller folds in the store's separate `stages` array, `stages[]`. Omitted/null
   * keeps the original behaviour + "not mapped yet" fallback. Backward-compatible.
   */
  festival?: (Festival & { stages?: Stage[] }) | null;
  /**
   * Authoring mode for the admin map editor (Phase D). 'off' (default) is the
   * normal crew-map behaviour. 'stage' / 'amenity' tint the map cursor so the
   * admin knows the next placement tap will set a stage location or drop an
   * amenity. The tap itself still flows through `onMapPress` (the existing
   * placement/`map-longpress` path) — authoring only annotates intent.
   */
  authoringMode?: AuthoringMode;
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
    /* Respect the OS Reduce Motion setting inside the WebView (the RN reduce-motion
       hook can't reach this document) — drop the infinite pulse, keep the dot. */
    @media (prefers-reduced-motion: reduce) {
      .festie-peer, .festie-sos { animation: none; }
    }
    /* Festival map data (Phase C). Stage = small brand-colored dot + always-on
       label tag; amenity = larger disc carrying the category glyph. Both visually
       distinct from the coral meeting dots + aqua peer discs. Color is set inline
       per-marker from the shared amenityGlyph/stage-color source on the RN side. */
    .festie-stage {
      position: relative;
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid #fff; box-shadow: 0 0 6px rgba(0,0,0,0.5);
    }
    .festie-stage-tag {
      position: absolute; top: calc(100% + 3px); left: 50%; transform: translateX(-50%);
      white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis;
      background: rgba(8,8,16,0.82); color: #eaeaf2;
      font: 700 10px/1.4 -apple-system, system-ui, sans-serif;
      padding: 1px 6px; border-radius: 8px;
    }
    .festie-amenity {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 50%;
      border: 2px solid #fff; box-shadow: 0 0 6px rgba(0,0,0,0.5);
      font-size: 13px; line-height: 1;
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
        // Tapping a live peer or the SOS marker selects it as the pursue target.
        // RN owns the arrow/ETA overlay; the document just reports the id + label.
        (function (pin) {
          el.addEventListener('click', function () {
            post({ type: 'pursue-select', id: pin.id, label: pin.label, latitude: pin.latitude, longitude: pin.longitude });
          });
        })(p);
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

    // Static festival map data: stage + amenity markers. Re-rendered wholesale on
    // each push (small N), tracked so a re-push doesn't stack duplicates. Glyph +
    // color arrive resolved from the RN side (shared amenityGlyph) — no category
    // logic here. All text via textContent — never parsed as HTML.
    var MAPDATA_MARKERS = [];
    function renderMapData(map, markers) {
      MAPDATA_MARKERS.forEach(function (m) { try { m.remove(); } catch (e) {} });
      MAPDATA_MARKERS = [];
      (markers || []).forEach(function (p) {
        var el = document.createElement('div');
        if (p.kind === 'stage') {
          el.className = 'festie-stage';
          el.style.background = p.color || '#19e3d3';
          var tag = document.createElement('span');
          tag.className = 'festie-stage-tag';
          tag.style.border = '1px solid ' + (p.color || 'rgba(255,255,255,0.18)');
          tag.textContent = p.label;
          el.appendChild(tag);
        } else {
          el.className = 'festie-amenity';
          el.style.background = p.color || '#8787a8';
          el.textContent = p.glyph || '';
        }
        var aLabel = (p.kind === 'stage' ? 'Stage: ' : 'Amenity: ') + p.label;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', aLabel);
        el.setAttribute('title', aLabel);
        var popupHtml = '<strong>' + escapeHtml(p.label) + '</strong>';
        var marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.longitude, p.latitude])
          .setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(popupHtml))
          .addTo(map);
        MAPDATA_MARKERS.push(marker);
      });
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

        // Tap-to-create: a long-press (contextmenu) is unreliable on touch, so we
        // use an explicit "placement mode" instead. RN toggles PLACEMENT via
        // window.__festieSetPlacement; while it's on, the NEXT single map click
        // emits the coord and auto-exits placement. Far more reliable than
        // contextmenu on a finger long-press across iOS/Android WebViews.
        var PLACEMENT = false;
        window.__festieSetPlacement = function (on) {
          PLACEMENT = !!on;
          try { map.getCanvas().style.cursor = PLACEMENT ? 'crosshair' : ''; } catch (e) {}
          post({ type: 'placement', on: PLACEMENT });
        };

        // Authoring mode (Phase D, admin map editor). Cosmetic only: it records
        // which kind of feature the next placement tap will create ('stage' /
        // 'amenity') and tints the canvas accordingly, then confirms back to RN.
        // It does NOT open a second tap channel — placement still drives the
        // one-shot 'map-longpress' message exactly like the crew-map drop. The
        // mode value is whitelisted on the RN side before injection.
        var AUTHORING = 'off';
        window.__festieSetAuthoring = function (mode) {
          AUTHORING = (mode === 'stage' || mode === 'amenity') ? mode : 'off';
          post({ type: 'authoring', mode: AUTHORING });
        };
        map.on('click', function (e) {
          if (!PLACEMENT || !e || !e.lngLat) return;
          // One-shot: drop the pin, then exit placement so a stray tap can't
          // keep firing creates.
          PLACEMENT = false;
          try { map.getCanvas().style.cursor = ''; } catch (err) {}
          post({ type: 'map-longpress', longitude: e.lngLat.lng, latitude: e.lngLat.lat });
        });

        // RN-driven recenter ("find me"): smoothly fly the map to a coordinate.
        // Coords are numeric + range-checked on the RN side before injection.
        window.__festieFlyTo = function (lng, lat, zoom) {
          try {
            map.flyTo({ center: [lng, lat], zoom: zoom || 16, duration: 600 });
            post({ type: 'recentered' });
          } catch (err) { post({ type: 'error', reason: 'flyto' }); }
        };

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

        // Push static festival map data (stage + amenity markers). Independent of
        // the meeting/peer/SOS layers above — does not touch them.
        window.__festieSetMapData = function (markers) {
          try {
            renderMapData(map, markers || []);
            post({ type: 'mapdata-updated', markers: (markers || []).length });
          } catch (err) { post({ type: 'error', reason: 'mapdata-update' }); }
        };

        // RN-driven framing to explicit festival map-config bounds
        // ([[west,south],[east,north]] in GeoJSON [lng,lat]). Numeric, range-
        // checked on the RN side before injection.
        window.__festieFitBounds = function (west, south, east, north) {
          try {
            map.fitBounds([[west, south], [east, north]], { padding: 48, maxZoom: 17, duration: 0 });
            post({ type: 'fitted' });
          } catch (err) { post({ type: 'error', reason: 'fitbounds' }); }
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

export default function OfflineMap({
  meetingPoints,
  peers,
  sos,
  onMapPress,
  festival = null,
  authoringMode = 'off',
}: OfflineMapProps) {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset();
  const webRef = useRef<WebView>(null);
  // Guards a single in-flight "find me" GPS request so a double-tap can't stack
  // permission prompts / location fixes.
  const [locating, setLocating] = useState(false);
  // Placement mode: when on, the next single map tap drops a meeting point at
  // that coord (replaces the unreliable long-press/contextmenu gesture). The
  // WebView confirms the actual on/off state back via the 'placement' message.
  const [placing, setPlacing] = useState(false);

  // ── Pursue / filter / nearest state (Phase 2B) ─────────────────────────────
  // The user's own GPS fix (expo-location watch), powering pursuit + nearest-X.
  const [selfCoord, setSelfCoord] = useState<Coord | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied' | 'on'>('idle');
  // The current pursue target id ('peer:<uid>' | 'sos:<uid>' | 'amenity:<id>')
  // plus a captured label/coord. Peer/SOS targets re-resolve to live coords below.
  const [pursue, setPursue] = useState<{ id: string; label: string; coord: Coord } | null>(null);
  // Amenity categories toggled off via the filter chips (local only).
  const [hiddenAmenities, setHiddenAmenities] = useState<Set<AmenityType>>(() => new Set());

  const pins = useMemo(() => extractMeetingPointPins(meetingPoints), [meetingPoints]);
  // Stage + amenity pins from the festival's map data (Phase A/B contract).
  const stagePins = useMemo(() => extractStagePins(festival), [festival]);
  const amenityPins = useMemo(() => extractAmenityPins(festival?.mapConfig), [festival]);
  const hasStages = stagePins.length > 0;
  const hasAmenities = amenityPins.length > 0;

  // Resolve stage + amenity pins into WebView markers, attaching glyph + color
  // from the shared source so the inline document carries no category logic.
  const mapMarkers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    for (const s of stagePins) {
      out.push({
        id: s.id,
        kind: 'stage',
        label: s.label,
        latitude: s.latitude,
        longitude: s.longitude,
        color: s.color || '#19e3d3',
      });
    }
    for (const a of amenityPins) {
      // Filtered out by a chip toggle — skip rendering (still searchable for nearest-X).
      if (a.amenityType && hiddenAmenities.has(a.amenityType)) continue;
      const { glyph, color } = amenityGlyph(a.amenityType);
      out.push({
        id: a.id,
        kind: 'amenity',
        label: a.label,
        latitude: a.latitude,
        longitude: a.longitude,
        color,
        glyph,
      });
    }
    return out;
  }, [stagePins, amenityPins, hiddenAmenities]);

  // Initial camera: festival map-config (bounds/center) → static pins → centroid.
  const staticPins = useMemo(() => [...pins, ...stagePins, ...amenityPins], [pins, stagePins, amenityPins]);
  const camera = useMemo(() => pickFestivalCamera(festival, staticPins), [festival, staticPins]);
  const center = camera.center;

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

  // Meeting points present but without coords — listed so they're never lost,
  // even though they can't be plotted.
  const uncoordedPoints = useMemo(
    () =>
      (meetingPoints ?? []).filter(
        (p) => p && p.active !== false && !(Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      ),
    [meetingPoints],
  );

  // Resolve the pursue target's LIVE coord: peer/SOS targets track the latest
  // position from props (so the arrow follows them); a nearest-amenity target is
  // static. Null when the target vanished (peer stopped sharing) → overlay clears.
  const liveTarget = useMemo(() => {
    if (!pursue) return null;
    if (pursue.id.startsWith('peer:')) {
      const uid = pursue.id.slice('peer:'.length);
      const p = (peers ?? []).find((x) => x.userId === uid);
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
      return { id: pursue.id, label: p.username || pursue.label, coord: { latitude: p.lat, longitude: p.lng } };
    }
    if (pursue.id.startsWith('sos:')) {
      if (!sos?.position) return null;
      return {
        id: pursue.id,
        label: `${sos.username} — SOS`,
        coord: { latitude: sos.position.lat, longitude: sos.position.lng },
      };
    }
    return pursue; // nearest-amenity: static captured coord
  }, [pursue, peers, sos]);

  // Pursuit bundle (bearing + distance + compass + ETA) self → target.
  const pursuit = useMemo(
    () => (selfCoord && liveTarget ? buildPursuit(selfCoord, liveTarget.coord) : null),
    [selfCoord, liveTarget],
  );
  const pursueIsSos = !!liveTarget && liveTarget.id.startsWith('sos:');

  // Continuous GPS watch (expo-location) keeping `selfCoord` fresh as the user
  // moves so the arrow + ETA recompute live. Permission denial is non-destructive.
  const watchSubRef = useRef<Location.LocationSubscription | null>(null);
  const enableLocation = useCallback(async () => {
    if (watchSubRef.current) return; // already watching
    setGeoState('locating');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGeoState('denied');
        return;
      }
      watchSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 4000 },
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            setSelfCoord({ latitude, longitude });
            setGeoState('on');
          }
        },
      );
    } catch {
      setGeoState('denied');
    }
  }, []);
  useEffect(() => {
    return () => {
      watchSubRef.current?.remove();
      watchSubRef.current = null;
    };
  }, []);

  // "Nearest X": closest amenity of a category to self → pursue it. Searches the
  // FULL amenity set (ignores chip visibility) so "nearest medical" always works.
  const pursueNearest = useCallback(
    (type: AmenityType) => {
      if (!selfCoord) {
        void enableLocation();
        return;
      }
      const found = nearestPin(selfCoord, amenityPins, (p) => p.amenityType === type);
      if (!found) return;
      setPursue({
        id: `amenity:${found.pin.id}`,
        label: found.pin.label || type,
        coord: { latitude: found.pin.latitude, longitude: found.pin.longitude },
      });
      // Frame the chosen pin. `__festieFlyTo` only exists once the map is up; the
      // `&&` guard no-ops otherwise, and webRef is null while the fallback list shows.
      if (webRef.current) {
        webRef.current.injectJavaScript(
          `window.__festieFlyTo && window.__festieFlyTo(${found.pin.longitude}, ${found.pin.latitude}, 16); true;`,
        );
      }
    },
    [selfCoord, amenityPins, enableLocation],
  );

  const clearPursue = useCallback(() => setPursue(null), []);
  const toggleAmenity = useCallback((type: AmenityType) => {
    setHiddenAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // The HTML doc carries NO pin data — only the numeric center — so it only
  // rebuilds when the center changes (pins flow in via injectJavaScript below).
  const html = useMemo(() => buildHtml(center), [center]);

  // 'loading' → WebView mounted, waiting for MapLibre; 'map' → interactive map up;
  // 'fallback' → CDN/offline failure, render the honest list instead. Start in
  // loading whenever there's anything to plot (meeting points, festival map data,
  // OR live markers).
  const hasAnythingToPlot = pins.length > 0 || hasStages || hasAmenities || hasLive;
  const [phase, setPhase] = useState<'loading' | 'map' | 'fallback'>(
    hasAnythingToPlot ? 'loading' : 'fallback',
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
      let msg: {
        type?: string;
        reason?: string;
        latitude?: number;
        longitude?: number;
        on?: boolean;
        id?: string;
        label?: string;
      } = {};
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        if (!fellBackRef.current) setPhase('map');
      } else if (msg.type === 'pursue-select') {
        // A live peer / SOS marker tap. Toggle: re-tapping the same target clears.
        const { id, label, latitude, longitude } = msg;
        if (
          typeof id === 'string' &&
          typeof latitude === 'number' &&
          typeof longitude === 'number' &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude)
        ) {
          setPursue((prev) =>
            prev && prev.id === id
              ? null
              : { id, label: label || 'Target', coord: { latitude, longitude } },
          );
        }
      } else if (msg.type === 'placement') {
        // The WebView confirms the true placement state (it auto-exits after a
        // drop) — mirror it so the toggle button reflects reality.
        setPlacing(!!msg.on);
      } else if (msg.type === 'map-longpress') {
        // Tap-to-create: relay the tapped coord to the screen, which opens the
        // existing meeting-point form prefilled with it. The WebView has already
        // exited placement mode (one-shot); clear our local flag to match.
        // Range-check so a bad payload can't propagate non-finite coords.
        setPlacing(false);
        const { latitude, longitude } = msg;
        if (
          onMapPress &&
          typeof latitude === 'number' &&
          typeof longitude === 'number' &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude)
        ) {
          onMapPress({ latitude, longitude });
        }
      } else if (msg.type === 'error') {
        // Only a load/init failure means "no map" → fall back. A transient
        // pin/peer/recenter glitch must NOT tear the whole map down.
        if (
          msg.reason !== 'pin-update' &&
          msg.reason !== 'peer-update' &&
          msg.reason !== 'flyto' &&
          msg.reason !== 'mapdata-update' &&
          msg.reason !== 'fitbounds'
        )
          fallBack();
      }
    },
    [fallBack, onMapPress],
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
  // error — fellBackRef tracks real failures), try the map once live markers,
  // meeting points, or festival map data show up.
  useEffect(() => {
    if (phase === 'fallback' && !fellBackRef.current && hasAnythingToPlot) {
      setPhase('loading');
    }
  }, [phase, hasAnythingToPlot]);

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

  // Push static festival map data (stage + amenity markers) into the WebView when
  // the map is up and whenever it changes. Same hardened serializer (labels are
  // user/admin-controlled). Independent of the meeting/peer/SOS layers.
  const mapDataJson = useMemo(() => safeJsonForScript(mapMarkers), [mapMarkers]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetMapData && window.__festieSetMapData(${mapDataJson}); true;`);
  }, [phase, mapDataJson]);

  // Frame the map to the festival's explicit map-config bounds once it's up. The
  // map was already centered on camera.center via buildHtml; bounds (when the
  // config carries them) tighten the view to the grounds. Coords are numeric +
  // range-checked by the schema before they reach here. Fires once per map mount;
  // re-runs only if the bounds themselves change.
  const fitBoundsRef = useRef(false);
  const boundsKey = camera.bounds ? camera.bounds.flat().join(',') : '';
  useEffect(() => {
    if (phase !== 'map') {
      fitBoundsRef.current = false;
      return;
    }
    if (fitBoundsRef.current || !webRef.current || !camera.bounds) return;
    const [[west, south], [east, north]] = camera.bounds;
    if (![west, south, east, north].every((n) => Number.isFinite(n))) return;
    fitBoundsRef.current = true;
    webRef.current.injectJavaScript(
      `window.__festieFitBounds && window.__festieFitBounds(${west}, ${south}, ${east}, ${north}); true;`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, boundsKey]);

  // Push the authoring mode into the WebView whenever it (or the map phase)
  // changes (Phase D). The mode is whitelisted by buildSetAuthoringScript before
  // injection — only 'off'/'stage'/'amenity' can ever reach the document.
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(buildSetAuthoringScript(authoringMode));
  }, [phase, authoringMode]);

  // Toggle placement mode in the WebView. The next single map tap (while on)
  // drops a meeting point and auto-exits. We optimistically flip local state for
  // immediate button feedback; the WebView's 'placement' message reconciles it.
  const togglePlacement = useCallback(() => {
    if (phase !== 'map' || !webRef.current) return;
    const next = !placing;
    setPlacing(next);
    webRef.current.injectJavaScript(
      `window.__festieSetPlacement && window.__festieSetPlacement(${next ? 'true' : 'false'}); true;`,
    );
  }, [phase, placing]);

  // "Find me": fetch the device position via expo-location (already a dep) and
  // fly the WebView map to it. Permission denial / GPS failure is silent — the
  // map simply stays put (no destructive effect, so no alert needed here).
  const recenterToMe = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = pos.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      if (phase === 'map' && webRef.current) {
        // Numeric, range-checked coords — safe to splice into the inject call.
        webRef.current.injectJavaScript(
          `window.__festieFlyTo && window.__festieFlyTo(${longitude}, ${latitude}, 16); true;`,
        );
      }
    } catch {
      // Best-effort: leave the map where it is on any failure.
    } finally {
      setLocating(false);
    }
  }, [locating, phase]);

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

        {/* Stage/amenity map data: honest note when this festival was never mapped. */}
        {!hasStages && !hasAmenities ? (
          <Text style={styles.stageNote}>This festival isn't mapped yet.</Text>
        ) : null}
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

      {/* On-map controls (map phase only). "Find me" recenters to the device's
          GPS fix; the "Drop pin" toggle puts the map into placement mode so the
          next single tap drops a meeting point (reliable on touch, unlike a
          long-press). When armed, a hint tells the user to tap the map. */}
      {phase === 'map' ? (
        <>
          {onMapPress ? (
            <>
              {placing ? (
                <View style={styles.mapHint} pointerEvents="none">
                  <Ionicons name="locate-outline" size={14} color={t.colors.text.onAccent} />
                  <Text style={styles.mapHintText} numberOfLines={1}>
                    Tap the map to drop a meeting point
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
                  style={{ transform: [{ rotate: `${pursuit.bearingDeg}deg` }] }}
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
                  <TouchableOpacity onPress={() => void enableLocation()} accessibilityRole="button">
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

          {/* Nearest-X + amenity filter chips, scrollable above the bottom FABs. */}
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
  // Round "find me" control, pinned bottom-right above the SOS FAB's row so the
  // two don't collide (SOS sits lower-right via the map screen's own wrapper).
  recenterFab: {
    position: 'absolute',
    right: t.spacing[4],
    bottom: t.spacing[5] + 64,
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
    bottom: t.spacing[5] + 64 + 56 + 8,
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
  // Floating tap-to-create hint, top-centered, non-interactive.
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
  // "Drop pin" placement toggle, pinned bottom-right just above the "find me"
  // FAB. Pill shows the idle (aqua icon + label) vs armed (coral fill) state.
  dropPinButton: {
    position: 'absolute',
    right: t.spacing[4],
    bottom: t.spacing[5] + 64 + 56,
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
