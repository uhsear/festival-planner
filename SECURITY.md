# Security Policy

## Reporting

Email uhsear@gmail.com with reproduction steps. We aim to acknowledge within 48 hours.

## Production Hardening Snapshot

| Control | State |
|---|---|
| HTTPS / HSTS | Enforced (1y, includeSubDomains, preload) |
| Content-Security-Policy | Custom CSP with sha256-pinned inline scripts/styles, `frame-ancestors 'none'`, `object-src 'none'` |
| Helmet headers | x-powered-by off, frameguard deny, COOP same-origin, referrer no-referrer |
| Auth | Bearer + cookie dual mode, scrypt password hashing, refresh tokens |
| Rate limiting | Redis-backed with in-memory fallback (multi-instance safe) |
| Input validation | Zod at every HTTP boundary |
| Log redaction | `sanitizeLogMeta` redacts 15+ sensitive field patterns |
| CSRF | Same-origin check + custom header requirement |
| Audit log | All admin & sensitive mutations recorded with actor, IP, request ID |
| Backups | PostgreSQL dump every 6h + daily offsite |
| Dependencies | `npm ci` enforced, lifecycle scripts disabled, package-lock pinned |

## Known Accepted Risks

### `firebase-admin` transitive low-severity advisories (8 LOW)

`@tootallnate/once` → `http-proxy-agent` → `teeny-request` → `@google-cloud/storage` → `firebase-admin` chain has 8 advisories rated LOW (CVSS < 4.0). All are server-side only and only reachable through FCM push notification dispatch, which never accepts user-controlled URLs.

`npm audit fix --force` would downgrade `firebase-admin` from 13.x to 10.3.0 — a major breaking change that removes APIs the app currently uses.

**Decision:** accept the risk. Monitor upstream `firebase-admin` for a fix that does not require a downgrade.

**Next review:** 2026-07-01.

## Reporting Channels

- uhsear@gmail.com — primary
- Open a private security advisory on GitHub if email is unavailable.
