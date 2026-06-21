# ADR-013: scrypt + SHA-256 Session-Token Authentication (No JWTs, No Refresh Tokens)

**Status:** Accepted
**Date:** 2026-06-19

## Context

Festie is a consumer app where sessions persist across many days of festival attendance. The
authentication design choices are: (1) how to hash passwords at rest, (2) how to represent and
validate active sessions, and (3) whether to use stateless tokens (JWTs) or server-side sessions.
JWTs enable stateless validation but make immediate revocation impossible (a banned or logged-out
user retains access until token expiry). For a crew coordination app where an admin may need to
remove a bad actor immediately, this is unacceptable. Third-party auth providers (Clerk, WorkOS)
were noted as a SaaS-readiness option in ADR-005 but were deferred to avoid a hard external
dependency for a v1 product.

## Decision

Password hashing uses `crypto.scrypt` (Node's built-in, backed by the scrypt KDF) with a 64-byte
derived key (`SCRYPT_KEYLEN = 64`) and a random 16-byte hex salt generated with
`crypto.randomBytes(16)`. The stored format is `"${salt}:${hash}"`. Verification uses
`crypto.timingSafeEqual` to prevent timing-oracle attacks. A dummy hash path
(`DUMMY_PASSWORD_SALT`, `DUMMY_PASSWORD_HASH`) runs the scrypt computation even for non-existent
users so the response time does not reveal whether a username exists.

Session tokens are opaque random strings: `crypto.randomBytes(32).toString('hex')` produces a
64-character hex token. This raw token is returned to the client (cookie or Bearer) but is
**never stored server-side in plaintext**. The server stores only
`crypto.createHash('sha256').update(token).digest('hex')` — the SHA-256 hash. On every
authenticated request, the presented token is hashed and looked up in the `user_sessions` table.
Sessions are capped at `USER_SESSION_MAX` concurrent sessions per user; a new login evicts the
oldest session and disconnects it via Socket.IO in the same operation. There are no refresh tokens
for browser sessions — token lifetime is controlled by `SESSION_TTL` and cookie expiry.

`SESSION_SECRET` is validated at startup (must be non-empty, non-default in production) but is
not currently used cryptographically. It is pre-provisioned for a future HMAC-signing upgrade
(see also ADR-004).

## Consequences

- Sessions are immediately revocable: deleting a row from `user_sessions` and disconnecting the
  corresponding Socket.IO socket terminates access within milliseconds.
- The server never holds plaintext session tokens; a full `user_sessions` table dump does not
  yield usable tokens (only SHA-256 pre-images, which are computationally infeasible to reverse
  for 32-byte random inputs).
- Password enumeration timing attacks are mitigated by the dummy-hash path.
- Concurrent-session eviction is enforced at the database layer and propagated to active WebSocket
  connections synchronously within `createUserSession()`.
- Trade-off: every authenticated request requires a database query
  (`SELECT FROM user_sessions WHERE token_hash = $1`). There is no in-process token validation;
  under high request rates this query becomes a hot path. The pg pool (min 2 / max 20) absorbs
  this, but it is a scalability consideration if request volume grows significantly.
- Trade-off: stateless JWT validation (no DB round-trip per request) is intentionally foregone.
  Migrating to JWTs in a future iteration would require either accepting delayed revocation or
  building a token denylist — neither is trivial.
- Trade-off: the mobile app uses Bearer tokens (`Authorization: Bearer <token>` or `X-User-Token`
  header) while the browser uses `HttpOnly` cookies. This dual-path is handled in
  `lib/app-context/session.ts::resolveRequestToken` but adds surface area to the auth middleware.
