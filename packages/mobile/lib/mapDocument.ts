// mapDocument — builds the inline HTML document that hosts MapLibre inside the
// OfflineMap WebView. Mobile-LOCAL and framework-free (no React, no
// react-native, no WebView imports) for the same reason webviewBridge.ts is:
// the document and its CSP are the highest-blast-radius strings in the app, so
// they must be unit-testable without mounting a WebView or a native module.
//
// SELF-CONTAINED RUNTIME: MapLibre GL JS, its stylesheet and the PMTiles UMD are
// INLINED from vendor/mapRuntime.ts (copied verbatim out of the installed
// maplibre-gl / pmtiles packages by scripts/vendor-map-runtime.mjs). They used
// to be fetched from unpkg.com at runtime, which meant (a) the map could not
// start without a network round-trip to a third party, and (b) ~1 MB of
// third-party JavaScript was executed, un-integrity-checked, inside a WebView
// that renders live crew coordinates and SOS positions. Inlining removes both.
// The cost is ~1.1 MB of vendored text in the JS bundle; the benefit is that the
// map runtime now needs no network at all and no origin outside the app.
//
// Inlining needs NO CSP widening: script-src and style-src already carry
// 'unsafe-inline' for the document's own bootstrap script, so the vendored
// blobs load under the existing grant while https://unpkg.com is removed from
// every directive.
//
// VERSION NOTE: the CDN tags pinned MapLibre 4.7.1, but packages/mobile has
// declared maplibre-gl ^5.24.0 all along for the WEB export (OfflineMap.web.tsx,
// which imports it as a real module). Vendoring from node_modules therefore
// moves this WebView from 4.7.1 to 5.24.0 — a major bump, deliberately taken so
// native and web finally run ONE MapLibre. The APIs this document uses
// (maplibregl.Map, Marker, Popup, LngLatBounds, addProtocol) and the shared
// style objects from @festie/shared/utils are already exercised against 5.24.0
// by the web build, but this document's exact behaviour on a device is NOT
// verified here — the mobile test harness is node-only and cannot render a
// WebView. Needs a device smoke test.
//
// WHAT THIS DOES NOT DO: it does not make the map work offline by itself. TILES
// are a separate problem — a festival still needs a cached PMTiles archive
// (lib/basemapCache.ts) to draw anything without a network.

import { safeJsonForScript } from './webviewBridge';
import { MAPLIBRE_CSS_SRC, MAPLIBRE_JS_SRC, PMTILES_JS_SRC } from '../vendor/mapRuntime';

// The basemap style is CHOSEN by the shared `pickMapStyle` (Phase 3A) and
// templated into buildMapHtml per-festival: a festival with an offline PMTiles
// basemap gets a vector style; every other festival keeps TODAY's online OSM
// raster (graceful fallback — the online path is never regressed).


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
 * `{type:'error'}` if the inlined runtime fails to define `maplibregl` or the
 * map throws while initializing — RN uses those to decide map vs fallback.
 */
export function buildMapHtml(
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
  // raster-tile PMTiles archive returns image bytes). default-src stays 'none'
  // (default-deny); no wildcard origin is ever added — only the single
  // configured host.
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
  // The map runtime is inlined (see the file header), so NO remote origin is
  // needed to start the map: script-src and style-src carry no host at all, and
  // the only https origins left anywhere in the policy are the ones TILES still
  // need — the OSM raster hosts plus, conditionally, the festival's own PMTiles
  // and site-plan hosts. 'unsafe-inline' covers the vendored blobs exactly as it
  // already covered the bootstrap script; `blob:` stays because MapLibre spawns
  // its render workers from blob URLs.
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' blob:",
    "style-src 'unsafe-inline'",
    `img-src data: blob: https://*.tile.openstreetmap.org${extra}${fileExtra}${siteplanExtra}`,
    `connect-src https://*.tile.openstreetmap.org${extra}${fileExtra}`,
    'worker-src blob:',
    'font-src data:',
  ].join('; ');
  // The pmtiles UMD, inlined only when a vector basemap is configured (a raster
  // festival should not pay for it, or run it). It sits BEFORE the bootstrap
  // script so the `pmtiles` global exists by the time init() registers the
  // protocol.
  const pmtilesScriptTag = usePmtiles ? `<script>${PMTILES_JS_SRC}</script>` : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>${MAPLIBRE_CSS_SRC}</style>
  ${pmtilesScriptTag}
  <script>${MAPLIBRE_JS_SRC}</script>
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
        map.on('error', function (e) {
          // MapLibre's 'error' event is its general error-reporting channel: it
          // fires for routine per-source tile/data fetch failures (a dropped
          // tile on a saturated venue link) as well as truly fatal ones. MapLibre
          // tags source-scoped failures with a sourceId when forwarding them up
          // to the map; a source-less error is the fatal case (style load/parse
          // failure, WebGL loss) that actually means "no map" — only that should
          // tear the map down to the fallback list.
          if (e && e.sourceId) { console.warn('[OfflineMap] transient tile error', e.sourceId); return; }
          post({ type: 'error', reason: 'map-error' });
        });

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

    // MapLibre was inlined in <head> and has already run, so init() can go
    // straight away - no CDN round-trip, no load event to wait on. If the
    // vendored blob somehow failed to evaluate, init()'s own 'no-maplibre'
    // guard posts the error and RN falls back to the honest list, exactly as
    // the old script.onerror path did.
    init();
  </script>
</body>
</html>`;
}
