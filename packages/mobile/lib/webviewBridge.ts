// webviewBridge — mobile-LOCAL, framework-free helpers for the OfflineMap
// WebView transport. Extracted from components/OfflineMap.tsx so the two
// highest-blast-radius pure functions (the script serializer + the host
// allowlist) can be unit-tested in isolation without mounting the WebView or
// any native module.
//
// No React, no react-native, no WebView imports — keep this importable from a
// plain Jest test.

// U+2028 / U+2029 are valid whitespace in JSON output but are literal line
// terminators inside a JS string literal — they must be \u-escaped before the
// JSON is spliced into the WebView's JS context. Built from char codes so this
// source file stays plain-ASCII.
const LS_RE = new RegExp(String.fromCharCode(0x2028), 'g');
const PS_RE = new RegExp(String.fromCharCode(0x2029), 'g');

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
export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(LS_RE, '\\u2028').replace(PS_RE, '\\u2029');
}

/**
 * Hosts permitted for in-WebView resource/navigation loads. Anything else is
 * blocked (default-deny), mirroring the hardened Spotify embed WebView. Allows
 * unpkg.com (MapLibre JS/CSS + the pmtiles UMD) and the OpenStreetMap tile hosts
 * (`tile.openstreetmap.org` + its `*.tile.openstreetmap.org` subdomains). The
 * anchored regex (`(^|\.)tile\.openstreetmap\.org$`) rejects lookalike hosts
 * such as `evil.openstreetmap.org.attacker.com` or
 * `tile.openstreetmap.org.evil.com` — the `$` end-anchor means the host must
 * END at the legitimate domain.
 *
 * Phase 3A: a festival MAY carry an offline PMTiles vector basemap, whose archive
 * is byte-range fetched over HTTPS from a per-festival host. That host is NOT
 * baked in here (it's config-driven, admin-controlled, and validated https
 * upstream); the renderer passes it in via `extraHost` so the allowlist permits
 * EXACTLY that one origin and nothing more — default-deny is preserved. The host
 * is compared by strict equality (no wildcard), so only the configured origin
 * (and the static unpkg/OSM hosts) can ever load.
 *
 * Phase 4B: `extraHost` may be an ARRAY so the renderer can permit BOTH the
 * basemap host AND the georeferenced site-plan image host (each config-driven,
 * admin-controlled, validated https upstream). Each is matched by strict
 * equality; a single string is still accepted for backward compatibility.
 */
export function isAllowedMapHost(host: string, extraHost?: string | string[] | null): boolean {
  if (host === 'unpkg.com' || /(^|\.)tile\.openstreetmap\.org$/.test(host)) return true;
  // The festival's configured host(s) (PMTiles basemap / site-plan image), when
  // present. Strict equality only — no wildcard. Empty strings never match.
  if (!extraHost) return false;
  const list = Array.isArray(extraHost) ? extraHost : [extraHost];
  return list.some((h) => !!h && host === h);
}

// ── Authoring mode (Phase D) ────────────────────────────────────────────────
//
// The admin festival-map editor reuses the SAME WebView map document as the
// crew map, switched into an "authoring" mode where a single map tap reports a
// coordinate back to RN (so the editor can place/move a stage pin or drop an
// amenity). Authoring REUSES the existing one-shot tap path (the `map-longpress`
// message): the editor arms placement via `__festieSetPlacement(true)` exactly
// like the meeting-point drop, then receives `{type:'map-longpress', latitude,
// longitude}`. `__festieSetAuthoring(mode)` only flips a cosmetic cursor/affordance
// flag in the document — it does NOT introduce a second tap channel, weaken the
// CSP, the host allowlist, or the safeJsonForScript transport. All values pushed
// into the document still go through safeJsonForScript.

/** Authoring sub-modes the editor can put the map document into. */
export type AuthoringMode = 'off' | 'stage' | 'amenity' | 'zone' | 'siteplan';

/** Inbound message types RN listens for from the authoring map document. */
export type AuthoringMessageType =
  | 'authoring' // confirms the active AuthoringMode after __festieSetAuthoring
  | 'map-longpress' // a placement tap reported its coordinate (shared with crew map)
  | 'placement'; // confirms placement-armed on/off (shared with crew map)

/** True for one of the recognized authoring sub-modes. */
export function isAuthoringMode(value: unknown): value is AuthoringMode {
  return (
    value === 'off' || value === 'stage' || value === 'amenity' || value === 'zone' || value === 'siteplan'
  );
}

/**
 * Build the `injectJavaScript` snippet that flips the document's authoring mode.
 * The mode string is validated + whitelisted here (never interpolated raw), so a
 * caller can't splice arbitrary JS through this path; an unknown value coerces to
 * 'off'. Returns a statement ending in `true;` (react-native-webview requires the
 * injected script to evaluate to a truthy value to avoid a warning).
 */
export function buildSetAuthoringScript(mode: AuthoringMode): string {
  const safe: AuthoringMode = isAuthoringMode(mode) ? mode : 'off';
  return `window.__festieSetAuthoring && window.__festieSetAuthoring(${JSON.stringify(safe)}); true;`;
}
