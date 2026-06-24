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
 * unpkg.com (MapLibre JS/CSS) and the OpenStreetMap tile hosts
 * (`tile.openstreetmap.org` + its `*.tile.openstreetmap.org` subdomains). The
 * anchored regex (`(^|\.)tile\.openstreetmap\.org$`) rejects lookalike hosts
 * such as `evil.openstreetmap.org.attacker.com` or
 * `tile.openstreetmap.org.evil.com` — the `$` end-anchor means the host must
 * END at the legitimate domain.
 */
export function isAllowedMapHost(host: string): boolean {
  return host === 'unpkg.com' || /(^|\.)tile\.openstreetmap\.org$/.test(host);
}
