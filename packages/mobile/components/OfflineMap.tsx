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
  pmtilesHost,
  hasOfflineBasemap,
  pmtilesVectorStyle,
  type Coord,
  type MapPin as Pin,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry, Festival, Stage, AmenityType } from '@festie/shared/types';
import { useFestivalModeStore } from '@festie/shared/stores';
import { useTokens, makeStyles, typeStyle, iconSize } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';
import { safeJsonForScript, isAllowedMapHost, buildSetAuthoringScript } from '../lib/webviewBridge';
import type { AuthoringMode } from '../lib/webviewBridge';
import { ensureBasemapCached, basemapCacheDir } from '../lib/basemapCache';

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
  /** Phase 4C: GPS course (deg) — rotates the direction-of-travel caret. */
  heading?: number;
  /** Phase 4C: 8-wind arrow glyph for the popup ("Heading ↗"); absent when no heading. */
  headingArrow?: string;
  /** Phase 4C: battery chip text ("8% — regroup"); absent when no battery data. */
  batteryLabel?: string;
  /** Peer low-power flag (#5): sharer is in battery-saver mode — shows a "Low Power" cue next to battery. */
  lowPower?: boolean;
  /** Phase 4C: share-window countdown ("sharing ends in Nm"); absent when no expiry. */
  windowLabel?: string;
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
// PMTiles UMD/IIFE browser build (Phase 3A). Loaded from unpkg (already allowed)
// only when a festival carries an offline vector basemap. The IIFE exposes a
// `pmtiles` global with `pmtiles.Protocol`, which we register with MapLibre via
// `addProtocol('pmtiles', protocol.tile)` so the in-WebView map can byte-range
// read the `.pmtiles` archive. Pinned version (subresource pinning, mirrors the
// pinned MapLibre version) — no `@latest`.
const PMTILES_VERSION = '4.4.1';
const PMTILES_JS = `https://unpkg.com/pmtiles@${PMTILES_VERSION}/dist/pmtiles.js`;
// The basemap style is now CHOSEN by the shared `pickMapStyle` (Phase 3A) and
// templated into buildHtml per-festival: a festival with an offline PMTiles
// basemap gets a vector style; every other festival keeps TODAY's online OSM
// raster (graceful fallback — the online path is never regressed).

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
 * Default-DENY navigation guard FACTORY. Allows the inline document's own load
 * (about:blank / data:) and resource loads from the map's CDN + tile hosts;
 * blocks every other origin so an injected payload cannot redirect the WebView
 * off to an attacker host. The map never legitimately navigates elsewhere.
 *
 * Phase 3A: `extraHost` is the ONE additional https host permitted — the current
 * festival's PMTiles archive host (config-driven, validated https upstream).
 * Passing it through the closure keeps the allowlist exactly as wide as the
 * active festival needs and no wider; with no offline basemap it's null and the
 * guard is byte-for-byte the prior behaviour.
 *
 * Phase 3B: `allowFile` permits the `file://` scheme — and ONLY when true (a
 * local cached archive backs THIS festival's map). The WebView's
 * `allowingReadAccessToURL` is independently scoped to the basemaps cache dir, so
 * even with the scheme allowed here, reads are confined to that one folder. With
 * no local cache `allowFile` is false and `file://` is rejected like any other
 * off-origin navigation (default-deny preserved).
 */
function makeShouldStartLoad(extraHost: string | string[] | null, allowFile: boolean = false) {
  return function onShouldStartLoadWithRequest(req: ShouldStartLoadRequest): boolean {
    const url = req.url || '';
    // The inline HTML document itself (no real origin) + data URIs MapLibre uses.
    if (url === 'about:blank' || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) {
      return true;
    }
    // Local cached PMTiles archive (Phase 3B): only when a local basemap is active.
    if (url.startsWith('file://')) return allowFile;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
    return isAllowedMapHost(host, extraHost);
  };
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
  /**
   * In-progress authoring vertices/corners (Phase 4A/4B). While the admin draws a
   * zone or places the 4 site-plan corners, each tapped point is pushed here so the
   * WebView renders a small dot at it — giving per-tap feedback BELOW the threshold
   * where the polygon/overlay can render (a 1–2-vertex zone or a 1–3-corner site
   * plan otherwise shows nothing on the map). Omitted/empty in normal crew use — no
   * dots drawn. Backward-compatible.
   */
  draftPoints?: { latitude: number; longitude: number }[];
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
function buildHtml(
  center: { latitude: number; longitude: number } | null,
  /** MapLibre style object (raster OSM by default, PMTiles vector when configured). */
  style: object,
  /** The festival's PMTiles host to permit in the CSP, or null for none. */
  pmtilesOrigin: string | null,
  /**
   * Phase 3B: true when the chosen vector style reads a LOCAL `file://` PMTiles
   * archive (cached to app storage) rather than the remote https one. When set,
   * the CSP additionally permits the `file:` scheme on connect-src/img-src so the
   * pmtiles lib can byte-range read the local archive. Conservative + explicit:
   * `file:` is added ONLY in this branch (a basemap IS configured AND a local
   * copy exists); with no offline basemap the CSP is byte-for-byte as before.
   */
  localBasemap: boolean = false,
  /**
   * Phase 4B: the host of the georeferenced site-plan image, or null. When set,
   * its EXACT https origin is added to the CSP `img-src` so MapLibre's `image`
   * source can load the organizer's site-plan raster. Config-driven, admin-
   * controlled, validated https upstream; never a wildcard. With no site plan
   * this is null and the CSP is byte-for-byte as before.
   */
  siteplanOrigin: string | null = null,
): string {
  // center is numeric, non-user-controlled coords — safe to template. Still run
  // it through the hardened serializer for uniformity.
  const centerJson = safeJsonForScript(center ?? { latitude: 0, longitude: 0 });
  const hasCenter = center != null;
  // The chosen basemap style, serialized with the hardened context-aware
  // serializer (it carries only config-derived numbers/strings; the pmtilesUrl
  // was validated https upstream, but we still escape `<` / line terminators so
  // it can never break out of the JS string context — same transport as pins).
  const styleJson = safeJsonForScript(style);
  // Phase 3A/3B: load the pmtiles UMD when a vector basemap is configured — either
  // a remote https archive (pmtilesOrigin set) OR a local cached file:// archive
  // (localBasemap set). With neither, the map is the unchanged online OSM raster.
  const usePmtiles = pmtilesOrigin != null || localBasemap;
  // Phase 3A CSP widening (the one security-sensitive change). When — and only
  // when — a festival has a REMOTE offline basemap, we add its EXACT https origin
  // to connect-src (the archive is byte-range fetched via fetch()) and img-src (a
  // raster-tile PMTiles archive returns image bytes). unpkg is already allowed
  // (it serves the pmtiles UMD too). default-src stays 'none' (default-deny);
  // no wildcard origin is ever added — only the single configured host.
  const extra = pmtilesOrigin ? ` https://${pmtilesOrigin}` : '';
  // Phase 3B local-cache widening. When — and only when — a LOCAL cached archive
  // backs the map, permit the `file:` scheme on connect-src (byte-range fetch of
  // the archive) + img-src (raster pmtiles return image bytes). Scheme-only (no
  // path); the WebView's `allowingReadAccessToURL` is scoped to the basemaps
  // cache dir so file access is confined to exactly that folder. No remote origin
  // is added in this branch. With no offline basemap `fileExtra` is empty.
  const fileExtra = localBasemap ? ' file:' : '';
  // Phase 4B: permit EXACTLY the site-plan image's https origin on img-src (the
  // raster is loaded as an image). Image-only — no connect-src/script-src change.
  // With no site plan this is empty and the CSP is byte-for-byte as before.
  const siteplanExtra = siteplanOrigin ? ` https://${siteplanOrigin}` : '';
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://unpkg.com blob:",
    "style-src 'unsafe-inline' https://unpkg.com",
    `img-src data: blob: https://*.tile.openstreetmap.org https://unpkg.com${extra}${fileExtra}${siteplanExtra}`,
    `connect-src https://unpkg.com https://*.tile.openstreetmap.org${extra}${fileExtra}`,
    'worker-src blob:',
    'font-src data:',
  ].join('; ');
  // The pmtiles UMD <script>, included only when a vector basemap is configured.
  // Loaded BEFORE init() runs (init is the maplibre script.onload) so the
  // `pmtiles` global exists when we register the protocol.
  const pmtilesScriptTag = usePmtiles ? `<script src="${PMTILES_JS}"></script>` : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="${MAPLIBRE_CSS}" rel="stylesheet" />
  ${pmtilesScriptTag}
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
    /* Phase 4C: direction-of-travel caret pinned above the avatar, rotated inline
       per-peer by the GPS course. */
    .festie-peer-dir {
      position: absolute; bottom: calc(100% - 1px); left: 50%;
      transform-origin: 50% 16px; font-size: 9px; line-height: 1;
      color: #00e8d0; text-shadow: 0 0 2px rgba(8,8,16,0.9); pointer-events: none;
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
    /* Zone label (Phase 4A): small uppercase chip at the zone centroid, tinted
       with the zone color. The polygon fill itself is a GL layer beneath every
       marker. Non-interactive. */
    .festie-zone-label {
      white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis;
      background: rgba(8,8,16,0.7); color: #eaeaf2;
      font: 700 10px/1.3 -apple-system, system-ui, sans-serif;
      letter-spacing: 0.02em; text-transform: uppercase;
      padding: 2px 7px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.25);
      pointer-events: none;
    }
    /* Authoring draft dot (Phase 4A/4B): a small aqua dot rendered at each tapped
       zone vertex / site-plan corner so taps give feedback below the polygon/
       overlay render threshold. Non-interactive. */
    .festie-draft-dot {
      width: 12px; height: 12px; border-radius: 50%;
      background: #19e3d3; border: 2px solid #fff;
      box-shadow: 0 0 6px rgba(25,227,211,0.85);
      pointer-events: none;
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
    // The chosen basemap style (raster OSM by default; PMTiles vector when the
    // festival configured one) + whether the pmtiles protocol must be registered.
    var STYLE = ${styleJson};
    var USE_PMTILES = ${usePmtiles ? 'true' : 'false'};
    // Tracks whether meeting-point pins exist, so live peer/SOS auto-framing only
    // kicks in when there are no pins to anchor the view. Updated by __festieSetPins.
    var HAD_PINS = false;
    // One-shot guard: auto-frame the live (peer/SOS) layer only the FIRST time it
    // appears, not on every position tick (which would yank the camera as peers
    // move). RN owns the one-shot SOS framing separately (__festieFlyTo).
    var FRAMED_LIVE = false;

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
          // Phase 4C: direction-of-travel caret, rotated by the GPS course. RN
          // gates it (live peers with a real heading only); the document just
          // rotates a fixed glyph — no math, no untrusted text parsed as HTML.
          if (typeof p.heading === 'number' && isFinite(p.heading)) {
            var dir = document.createElement('span');
            dir.className = 'festie-peer-dir';
            dir.setAttribute('aria-hidden', 'true');
            dir.textContent = '▲';
            dir.style.transform = 'translateX(-50%) rotate(' + p.heading + 'deg)';
            el.appendChild(dir);
          }
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
          (p.sublabel ? '<br/>' + escapeHtml(p.sublabel) : '') +
          // Phase 4C popup chips (escaped; RN supplies the formatted strings).
          (p.headingArrow ? '<br/>Heading ' + escapeHtml(p.headingArrow) : '') +
          (p.batteryLabel ? '<br/>Battery ' + escapeHtml(p.batteryLabel) : '') +
          (p.lowPower ? '<br/>🍃 Low Power' : '') +
          (p.windowLabel ? '<br/>' + escapeHtml(p.windowLabel) : '');
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
      // anchor the view, and only ONCE (FRAMED_LIVE) so the camera isn't yanked
      // on every position tick as peers move.
      if (bounds && !HAD_PINS && !FRAMED_LIVE && items.length > 0) {
        FRAMED_LIVE = true;
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

    // Zone polygons (Phase 4A). A single GeoJSON source + a fill + outline layer
    // (data-driven color via ['get','color']) so the filled areas always sit
    // BENEATH every DOM marker. Zone labels are DOM markers at each centroid (no
    // glyphs endpoint needed). The source/layers are added once, then setData
    // updates them. Color arrives baked into each feature from the RN side.
    var ZONE_LABEL_MARKERS = [];
    function renderZones(map, payload) {
      var collection = (payload && payload.collection) || { type: 'FeatureCollection', features: [] };
      var labels = (payload && payload.labels) || [];
      try {
        var src = map.getSource('festie-zones');
        if (src) {
          src.setData(collection);
        } else {
          map.addSource('festie-zones', { type: 'geojson', data: collection });
          map.addLayer({ id: 'festie-zones-fill', type: 'fill', source: 'festie-zones',
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } });
          map.addLayer({ id: 'festie-zones-line', type: 'line', source: 'festie-zones',
            paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.85 } });
        }
      } catch (e) {}
      ZONE_LABEL_MARKERS.forEach(function (m) { try { m.remove(); } catch (e) {} });
      ZONE_LABEL_MARKERS = [];
      labels.forEach(function (z) {
        var el = document.createElement('div');
        el.className = 'festie-zone-label';
        el.style.borderColor = z.color || 'rgba(255,255,255,0.25)';
        el.textContent = z.label || '';
        var marker = new maplibregl.Marker({ element: el }).setLngLat([z.longitude, z.latitude]).addTo(map);
        ZONE_LABEL_MARKERS.push(marker);
      });
    }

    // Authoring draft points (Phase 4A/4B): a small dot at each in-progress zone
    // vertex / site-plan corner. Re-rendered wholesale on each push (tiny N),
    // tracked so a re-push doesn't stack duplicates. Numeric coords only — never
    // any text parsed as HTML.
    var DRAFT_MARKERS = [];
    function renderDraftPoints(map, points) {
      DRAFT_MARKERS.forEach(function (m) { try { m.remove(); } catch (e) {} });
      DRAFT_MARKERS = [];
      (points || []).forEach(function (p) {
        if (!p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return;
        var el = document.createElement('div');
        el.className = 'festie-draft-dot';
        el.setAttribute('aria-hidden', 'true');
        var marker = new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map);
        DRAFT_MARKERS.push(marker);
      });
    }

    // Site-plan raster overlay (Phase 4B). A MapLibre 'image' source + raster
    // layer positioned by the 4 corners at the configured opacity, inserted UNDER
    // the zones fill (and thus under every DOM marker). Pushed via
    // __festieSetSiteplan after 'ready'; a null payload tears it down. The image
    // URL was validated https + its host added to the CSP img-src on the RN side.
    function renderSiteplan(map, payload) {
      var SRC = 'festie-siteplan';
      var LAYER = 'festie-siteplan-layer';
      try {
        if (!payload || !payload.url || !payload.coordinates) {
          if (map.getLayer(LAYER)) map.removeLayer(LAYER);
          if (map.getSource(SRC)) map.removeSource(SRC);
          return;
        }
        var opacity = (typeof payload.opacity === 'number') ? payload.opacity : 0.6;
        var src = map.getSource(SRC);
        if (src) {
          src.updateImage({ url: payload.url, coordinates: payload.coordinates });
          if (map.getLayer(LAYER)) map.setPaintProperty(LAYER, 'raster-opacity', opacity);
        } else {
          map.addSource(SRC, { type: 'image', url: payload.url, coordinates: payload.coordinates });
          var layer = { id: LAYER, type: 'raster', source: SRC,
            paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 } };
          // Keep the site plan UNDER zones: insert before the zones fill if it's
          // already added; otherwise append (zones added later go on top anyway).
          if (map.getLayer('festie-zones-fill')) map.addLayer(layer, 'festie-zones-fill');
          else map.addLayer(layer);
        }
      } catch (e) {}
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function init() {
      if (typeof maplibregl === 'undefined') { post({ type: 'error', reason: 'no-maplibre' }); return; }
      try {
        // Phase 3A: when a vector basemap is configured, register the pmtiles
        // protocol so MapLibre can resolve pmtiles-scheme sources. The pmtiles
        // UMD script was loaded in the head, so the pmtiles global is present; if
        // it somehow is not we fall through (the vector source then errors and RN
        // falls back to the honest list) rather than throwing here.
        if (USE_PMTILES && typeof pmtiles !== 'undefined' && pmtiles.Protocol) {
          try {
            var protocol = new pmtiles.Protocol();
            maplibregl.addProtocol('pmtiles', protocol.tile);
          } catch (e) {}
        }
        var map = new maplibregl.Map({
          container: 'map',
          style: STYLE,
          center: HAS_CENTER ? [CENTER.longitude, CENTER.latitude] : [0, 0],
          zoom: HAS_CENTER ? 15 : 1,
          attributionControl: { compact: true },
          // North-locked: our pursue arrow + heading carets are north-referenced,
          // so disable map rotation/pitch — a rotated basemap would desync them.
          dragRotate: false,
          pitchWithRotate: false
        });
        // Also kill two-finger touch rotation (not covered by dragRotate).
        try { map.touchZoomRotate && map.touchZoomRotate.disableRotation(); } catch (e) {}
        try { map.keyboard && map.keyboard.disableRotation && map.keyboard.disableRotation(); } catch (e) {}
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
          AUTHORING = (mode === 'stage' || mode === 'amenity' || mode === 'zone' || mode === 'siteplan')
            ? mode : 'off';
          post({ type: 'authoring', mode: AUTHORING });
        };
        map.on('click', function (e) {
          if (!PLACEMENT || !e || !e.lngLat) return;
          // Zone + site-plan authoring need MULTIPLE taps (one per vertex/corner),
          // so they KEEP placement armed. Every other mode is one-shot: drop the
          // pin, then exit placement so a stray tap can't keep firing creates.
          var multiTap = (AUTHORING === 'zone' || AUTHORING === 'siteplan');
          if (!multiTap) {
            PLACEMENT = false;
            try { map.getCanvas().style.cursor = ''; } catch (err) {}
          }
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

        // Push zone polygons (a GeoJSON FeatureCollection + label anchors).
        // Independent of the meeting/peer/SOS/mapdata layers above.
        window.__festieSetZones = function (payload) {
          try {
            renderZones(map, payload || { collection: { type: 'FeatureCollection', features: [] }, labels: [] });
            post({ type: 'zones-updated' });
          } catch (err) { post({ type: 'error', reason: 'zones-update' }); }
        };

        // Push in-progress authoring vertices/corners (renders a dot per tap).
        // Independent of every other layer above; an empty array clears them.
        window.__festieSetDraftPoints = function (points) {
          try {
            renderDraftPoints(map, points || []);
            post({ type: 'draftpoints-updated', count: (points || []).length });
          } catch (err) { post({ type: 'error', reason: 'draftpoints-update' }); }
        };

        // Push the georeferenced site-plan overlay (a null payload tears it down).
        // Independent of every other layer above.
        window.__festieSetSiteplan = function (payload) {
          try {
            renderSiteplan(map, payload || null);
            post({ type: 'siteplan-updated' });
          } catch (err) { post({ type: 'error', reason: 'siteplan-update' }); }
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
  activeSosList,
  onMapPress,
  festival = null,
  authoringMode = 'off',
  draftPoints,
}: OfflineMapProps) {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset();
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
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
  // Zone polygons (Phase 4A): filled translucent areas drawn UNDER the markers.
  const zones = useMemo(() => extractZones(festival?.mapConfig), [festival]);
  // Site-plan raster overlay (Phase 4B): the organizer's georeferenced paper map.
  const siteplan = useMemo(() => extractSiteplan(festival?.mapConfig), [festival]);
  const hasStages = stagePins.length > 0;
  const hasAmenities = amenityPins.length > 0;
  const hasZones = zones.length > 0;
  const hasSiteplan = !!siteplan;

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

  // Zone centroids feed the camera fallback as pseudo-pins so a zones-only
  // festival still centres on its grounds (explicit config bounds/center win).
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

  // Initial camera: festival map-config (bounds/center) → static pins → centroid.
  const staticPins = useMemo(
    () => [...pins, ...stagePins, ...amenityPins, ...zoneCentroidPins],
    [pins, stagePins, amenityPins, zoneCentroidPins],
  );
  const camera = useMemo(() => pickFestivalCamera(festival, staticPins), [festival, staticPins]);
  const center = camera.center;

  // Effective SOS list: prefer the multi-SOS `activeSosList`, else the single
  // `sos` prop (back-compat). A marker is rendered for EACH entry.
  const sosList = useMemo<SosEntry[]>(() => activeSosList ?? (sos ? [sos] : []), [activeSosList, sos]);

  const hasLive = (peers?.length ?? 0) > 0 || sosList.length > 0;

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
      // Phase 4C: heading caret + battery + share-window. All formatted on the RN
      // side (shared pure helpers) and passed as plain strings/number so the
      // WebView document never computes them. Suppressed for stale peers.
      const arrow = stale ? null : headingToArrow(p.heading);
      const battery = stale ? null : formatBatteryLabel(p.battery);
      // Peer low-power flag (#5): only cue a live (non-stale) peer in battery-saver mode.
      const lowPower = stale ? false : p.lowPower === true;
      const windowLabel = stale ? null : formatShareWindow(p.expiresAt, now);
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
        ...(arrow && typeof p.heading === 'number' ? { heading: p.heading, headingArrow: arrow } : {}),
        ...(battery ? { batteryLabel: battery } : {}),
        ...(lowPower ? { lowPower: true } : {}),
        ...(windowLabel ? { windowLabel } : {}),
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
      // Festival low-power mode (F-battery): trade GPS freshness for battery —
      // Balanced accuracy + a slower 10s tick instead of High/4s. The pursue
      // arrow just updates less often; nothing else about the feature changes.
      watchSubRef.current = await Location.watchPositionAsync(
        lowPowerMode
          ? { accuracy: Location.Accuracy.Balanced, distanceInterval: 3, timeInterval: 10000 }
          : { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 4000 },
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
  }, [lowPowerMode]);
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

  // Phase 3A: choose the basemap style + the (optional) PMTiles host for this
  // festival. A festival with NO offline basemap yields the unchanged online OSM
  // raster style + a null host — exactly today's behaviour (graceful fallback).
  const remoteBasemapHost = useMemo(() => pmtilesHost(festival?.mapConfig), [festival]);

  // Phase 3B: the festival's configured (remote, https) PMTiles URL, if any. Used
  // both as the cache source and as the fallback when caching is unavailable.
  const remotePmtilesUrl = useMemo(
    () => (hasOfflineBasemap(festival?.mapConfig) ? festival!.mapConfig!.offlineBasemap!.pmtilesUrl : null),
    [festival],
  );
  const basemapAttribution = useMemo(
    () => (hasOfflineBasemap(festival?.mapConfig) ? festival?.mapConfig?.offlineBasemap?.attribution : undefined),
    [festival],
  );

  // Phase 3B native cache: once a festival with an offline basemap opens, download
  // the .pmtiles to app cache ONCE (idempotent) and point the WebView at the local
  // file:// so subsequent opens render with zero network. On failure we keep the
  // REMOTE https URL (Phase 3A range-fetch path) — additive, never regresses.
  //
  // We store the cached result TAGGED with the URL it was cached for; a switch to
  // a different festival is handled by comparing that tag against the current URL
  // during render (below) — no synchronous reset-in-effect needed.
  const [cachedBasemap, setCachedBasemap] = useState<{ url: string; uri: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!remotePmtilesUrl) return;
    void ensureBasemapCached(remotePmtilesUrl).then((uri) => {
      if (!cancelled && uri) setCachedBasemap({ url: remotePmtilesUrl, uri });
    });
    return () => {
      cancelled = true;
    };
  }, [remotePmtilesUrl]);

  // The EFFECTIVE basemap the WebView will read: the local cached file ONLY when
  // it was cached for the CURRENTLY configured URL (so a stale file from another
  // festival never leaks across); else the remote https URL (Phase 3A); else no
  // offline basemap. Derived during render — no effect/setState churn.
  const localBasemapUri =
    cachedBasemap && remotePmtilesUrl && cachedBasemap.url === remotePmtilesUrl ? cachedBasemap.uri : null;
  const usingLocalBasemap = localBasemapUri != null;
  const mapStyle = useMemo(() => {
    if (usingLocalBasemap && localBasemapUri) {
      // Local file:// archive — build the vector style directly off the local URI
      // via the SAME shared style builder (single source of truth).
      return pmtilesVectorStyle(localBasemapUri, basemapAttribution);
    }
    // Remote https basemap (Phase 3A) or no basemap → unchanged shared pick.
    return pickMapStyle(festival?.mapConfig);
  }, [usingLocalBasemap, localBasemapUri, basemapAttribution, festival]);

  // The remote host is permitted in the CSP/allowlist ONLY while we're still
  // reading the remote archive. Once the local file is in use, no remote origin
  // is needed (and isn't added) — the map reads purely from file://.
  const offlineBasemapHost = usingLocalBasemap ? null : remoteBasemapHost;

  // Phase 4B: the host of the configured site-plan image, if any. Threaded into
  // the CSP img-src + the navigation allowlist so the raster can load while
  // keeping default-deny (EXACTLY this one https origin, no wildcard). Null when
  // the festival has no site plan — CSP/allowlist byte-for-byte as before.
  const siteplanImageHost = useMemo(() => {
    if (!siteplan) return null;
    try {
      return new URL(siteplan.imageUrl).hostname;
    } catch {
      return null;
    }
  }, [siteplan]);

  // The HTML doc carries NO pin data — only the numeric center, the chosen
  // basemap style, and the site-plan image host (for the CSP) — so it rebuilds
  // only when those change (pins/zones/siteplan data flow in via injectJavaScript).
  const html = useMemo(
    () => buildHtml(center, mapStyle, offlineBasemapHost, usingLocalBasemap, siteplanImageHost),
    [center, mapStyle, offlineBasemapHost, usingLocalBasemap, siteplanImageHost],
  );

  // Navigation guard + origin whitelist, widened by EXACTLY the festival's
  // PMTiles host (remote mode) and/or the site-plan image host, OR the file://
  // scheme (local-cache mode) — default-deny preserved; only configured origins
  // are ever added.
  const extraHosts = useMemo(
    () => [offlineBasemapHost, siteplanImageHost].filter((h): h is string => !!h),
    [offlineBasemapHost, siteplanImageHost],
  );
  const shouldStartLoad = useMemo(
    () => makeShouldStartLoad(extraHosts, usingLocalBasemap),
    [extraHosts, usingLocalBasemap],
  );
  const originWhitelist = useMemo(() => {
    const base = usingLocalBasemap ? [...MAP_ORIGIN_WHITELIST, 'file://'] : [...MAP_ORIGIN_WHITELIST];
    for (const h of extraHosts) base.push(`https://${h}`);
    return base;
  }, [extraHosts, usingLocalBasemap]);

  // Scope native file access to EXACTLY the basemaps cache dir (and only when a
  // local archive is active). `allowingReadAccessToURL` (iOS) confines reads to
  // this subtree; `allowFileAccess` (Android) gates file:// at all. Both are off
  // unless a local basemap is in use — so the no-basemap + remote paths keep the
  // WebView with no filesystem access whatsoever (default-deny preserved).
  const basemapCacheDirUri = useMemo(() => {
    if (!usingLocalBasemap) return undefined;
    try {
      return basemapCacheDir().uri;
    } catch {
      return undefined;
    }
  }, [usingLocalBasemap]);

  // In local-cache mode, give the inline document a `file://` ORIGIN (via baseUrl)
  // that matches the cache dir, so the pmtiles client's same-origin `file://`
  // Range fetch of the archive succeeds under the standard `allowFileAccess` —
  // WITHOUT enabling the much broader allowUniversalAccessFromFileURLs. With no
  // local basemap, baseUrl is undefined and the doc loads at about:blank exactly
  // as before (online + remote-basemap paths unchanged). If the local read still
  // fails on some platform, map.on('error') falls us back to the honest list — a
  // blank map is never shown and the online path is never regressed.
  const source = useMemo(
    () => (usingLocalBasemap && basemapCacheDirUri ? { html, baseUrl: basemapCacheDirUri } : { html }),
    [html, usingLocalBasemap, basemapCacheDirUri],
  );

  // 'loading' → WebView mounted, waiting for MapLibre; 'map' → interactive map up;
  // 'fallback' → CDN/offline failure, render the honest list instead. Start in
  // loading whenever there's anything to plot (meeting points, festival map data,
  // OR live markers).
  //
  // P0 authoring deadlock fix: a brand-new festival with no plottable features
  // would otherwise render the fallback list, never mount the WebView, and the
  // authoring inject (which bails on phase !== 'map') could never fire — so a NEW
  // festival could never be mapped. Force the map to mount whenever authoring is
  // armed (authoringMode !== 'off') OR the festival carries a camera (center !=
  // null), so the editor always has a tappable canvas. Crew behaviour is
  // unchanged for truly-unmapped festivals (center is null + authoring 'off').
  const hasAnythingToPlot =
    pins.length > 0 ||
    hasStages ||
    hasAmenities ||
    hasZones ||
    hasSiteplan ||
    hasLive ||
    authoringMode !== 'off' ||
    center != null;
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
          msg.reason !== 'zones-update' &&
          msg.reason !== 'siteplan-update' &&
          msg.reason !== 'draftpoints-update' &&
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

  // Push zone polygons (a GeoJSON FeatureCollection with color baked in + label
  // anchors) into the WebView when the map is up and whenever they change. Same
  // hardened serializer (zone labels are admin-controlled). Independent layer.
  const zonesJson = useMemo(
    () => safeJsonForScript({ collection: zonesGeoJSON(zones), labels: zoneLabels(zones) }),
    [zones],
  );
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetZones && window.__festieSetZones(${zonesJson}); true;`);
  }, [phase, zonesJson]);

  // Push the site-plan raster overlay (Phase 4B) into the WebView when the map is
  // up and whenever it changes. A null payload tears the layer down. The image
  // URL is config-derived (https, host already in the CSP); same hardened
  // serializer. Independent of every other layer.
  const siteplanJson = useMemo(() => safeJsonForScript(siteplanImageSource(siteplan)), [siteplan]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetSiteplan && window.__festieSetSiteplan(${siteplanJson}); true;`);
  }, [phase, siteplanJson]);

  // Push in-progress authoring vertices/corners into the WebView (a dot per tap)
  // when the map is up and whenever they change. Keyed on the serialized string so
  // a fresh empty-array prop each render doesn't re-inject (identical primitive).
  const draftPointsJson = useMemo(() => safeJsonForScript(draftPoints ?? []), [draftPoints]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(
      `window.__festieSetDraftPoints && window.__festieSetDraftPoints(${draftPointsJson}); true;`,
    );
  }, [phase, draftPointsJson]);

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
  // changes (Phase D / 4A / 4B). The mode is whitelisted by buildSetAuthoringScript
  // before injection — only a known AuthoringMode can ever reach the document.
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(buildSetAuthoringScript(authoringMode));
  }, [phase, authoringMode]);

  // Zone drawing + site-plan corner placement need placement ARMED across multiple
  // taps (one vertex/corner per tap), so entering a multi-tap mode arms placement
  // automatically and leaving it disarms. Scoped to multi-tap transitions only —
  // stage/amenity placement (driven by the "Drop pin" toggle) is never touched,
  // preserving their one-shot behaviour.
  const isMultiTapMode = (m: AuthoringMode) => m === 'zone' || m === 'siteplan';
  const prevAuthRef = useRef<AuthoringMode>('off');
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) {
      prevAuthRef.current = authoringMode;
      return;
    }
    if (isMultiTapMode(authoringMode)) {
      webRef.current.injectJavaScript('window.__festieSetPlacement && window.__festieSetPlacement(true); true;');
    } else if (isMultiTapMode(prevAuthRef.current)) {
      webRef.current.injectJavaScript('window.__festieSetPlacement && window.__festieSetPlacement(false); true;');
    }
    prevAuthRef.current = authoringMode;
  }, [phase, authoringMode]);

  // P1 safety: one-shot fly/frame to each incoming SOS the moment it first
  // appears, regardless of meeting pins. The WebView's renderLive only auto-frames
  // the live layer when there are NO pins — so with pins present a safety-critical
  // SOS could sit off-screen. We track framed SOS by userId and fire __festieFlyTo
  // exactly once per SOS (not on every position tick); the framed set is reset when
  // the map remounts, and a cleared SOS drops its flag so a re-raise re-frames.
  // With several at once the last-framed wins the camera. Web force-flies likewise.
  const framedSosRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) {
      framedSosRef.current = new Set(); // re-frame after a remount
      return;
    }
    const present = new Set(sosList.map((s) => s.userId));
    // Drop framed flags for SOS that cleared so a later re-raise re-frames.
    for (const uid of Array.from(framedSosRef.current)) {
      if (!present.has(uid)) framedSosRef.current.delete(uid);
    }
    for (const s of sosList) {
      if (!s.position || framedSosRef.current.has(s.userId)) continue;
      const { lat, lng } = s.position;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      framedSosRef.current.add(s.userId);
      webRef.current.injectJavaScript(`window.__festieFlyTo && window.__festieFlyTo(${lng}, ${lat}, 16); true;`);
    }
  }, [phase, sosList]);

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
          <Ionicons name="cloud-offline-outline" size={iconSize.action} color={t.colors.accent.amber} />
          <Text style={styles.bannerText}>
            Map needs the festival downloaded for offline. Showing your saved meeting points.
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
            <Ionicons name="navigate-circle" size={iconSize.action} color={t.colors.accent.aqua} />
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
            {/* One-off 32px: sits between iconSize.lg (24) and .xl (48) — neither
                token fits this empty-state glyph without a visible size jump. */}
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
            {/* Aqua, not coral: a meeting-point pin is a neutral location cue;
                coral is danger/SOS-only per the one-accent rule. */}
            <Ionicons name="location" size={iconSize.action} color={t.colors.accent.aqua} />
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
            <Ionicons name="location-outline" size={iconSize.action} color={t.colors.text.muted} />
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
        originWhitelist={originWhitelist}
        onShouldStartLoadWithRequest={shouldStartLoad}
        source={source}
        style={styles.web}
        onMessage={onMessage}
        onLoadStart={armTimeout}
        onError={fallBack}
        onHttpError={fallBack}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
        // Phase 3B: native file access for the LOCAL cached PMTiles archive only.
        // `allowFileAccess` (Android) is enabled ONLY when a local basemap is in
        // use; `allowingReadAccessToURL` (iOS) confines reads to the basemaps cache
        // dir. We deliberately leave allowFileAccessFromFileURLs /
        // allowUniversalAccessFromFileURLs at their secure defaults (off): the doc
        // is an about:blank inline page reading file:// via pmtiles fetch under the
        // CSP, which does not require cross-file-origin access. With no local
        // basemap both props are off and the WebView has zero filesystem access.
        allowFileAccess={usingLocalBasemap}
        allowingReadAccessToURL={basemapCacheDirUri}
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
          {/* Crew controls (drop-pin FAB, find-me, amenity dock) are gated OFF in
              authoring mode — the admin editor drives placement via its own armed
              toolbar, and these would collide with that flow. */}
          {onMapPress && authoringMode === 'off' ? (
            <>
              {placing ? (
                <View style={styles.mapHint} pointerEvents="none">
                  <Ionicons name="locate-outline" size={iconSize.compact} color={t.colors.text.onAccent} />
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
          {authoringMode === 'off' ? (
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
          ) : null}

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
                  // so subtract 45° from the compass bearing — a due-north target
                  // (bearing 0) then points straight up.
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

          {/* Nearest-X + amenity filter chips, scrollable above the bottom FABs.
              Gated OFF in authoring mode (crew-only affordance). */}
          {hasAmenities && authoringMode === 'off' ? (
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
    bottom: t.spacing[5] + 64 + 56 + 40 + t.spacing[2],
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
