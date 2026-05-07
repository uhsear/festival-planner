# ADR-004: CSRF Protection and Bearer Token Design

**Status:** Accepted
**Date:** 2026-05-07
**Context:** Security audit finding — CSRF bypass for Bearer tokens needs documentation

## Decision

Festie uses two authentication mechanisms, each with a different CSRF posture:

### 1. Cookie-based sessions (browser clients)

- Session token set via `HttpOnly`, `SameSite=Lax`, `Secure` cookie
- CSRF protection via **origin enforcement**: the server rejects state-changing requests whose `Origin` header doesn't match `PUBLIC_ORIGIN`
- Additional defense: the `X-Festie-Mutation: 1` header is required on all mutating requests (POST/PUT/PATCH/DELETE). Browsers will not attach custom headers to cross-origin form submissions or `<img>` tags, so this acts as a lightweight CSRF token equivalent

### 2. Bearer token auth (mobile / API clients)

- Token passed via `Authorization: Bearer <token>` or `X-User-Token` header
- **No CSRF protection needed** because Bearer tokens are never sent automatically by browsers. An attacker-controlled page cannot cause a victim's browser to attach a Bearer token to a cross-origin request
- This is a well-established security property documented in RFC 6750 Section 5.2 and the OWASP CSRF Prevention Cheat Sheet

### Why the CSRF check is skipped for Bearer tokens

In `lib/app-context/session.js`, the auth middleware resolves the token from either the cookie or the `Authorization` header. When the token comes from a header (not a cookie), the request is inherently CSRF-safe because:

1. JavaScript on an attacker's origin cannot read the token (blocked by same-origin policy)
2. Browsers do not auto-attach `Authorization` headers cross-origin
3. `<form>`, `<img>`, `<script>` tags cannot set custom headers

Therefore, origin enforcement is only applied to cookie-authenticated requests.

## SESSION_SECRET

`SESSION_SECRET` is loaded via `lib/config.js` and validated at startup in production, but is **not currently used cryptographically**. Session tokens are opaque random strings (generated via `crypto.randomBytes`) and stored server-side as SHA-256 hashes. The secret is pre-provisioned so HMAC-signed session tokens can be introduced in a future iteration without requiring a redeployment or config change.

## CSP and style-src unsafe-inline

The app's Content-Security-Policy includes `style-src 'unsafe-inline'` because `motion/react` (animation library) injects dynamic inline styles at runtime via direct DOM mutation that cannot be covered by SHA-256 hashes or nonces. This is documented in `lib/helpers.js::buildContentSecurityPolicy`. `script-src` does **not** include `unsafe-inline`.

## Consequences

- Mobile clients can authenticate without CSRF tokens (simpler flow)
- Browser clients remain protected via origin enforcement + mutation header
- Session tokens never leave the server in a form that could enable partial-preimage attacks (session list uses opaque SHA-256-derived identifiers)
- `SESSION_SECRET` is ready for future HMAC signing without migration
