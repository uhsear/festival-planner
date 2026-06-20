# Security Policy

## Reporting a Vulnerability

Email **security@festie.us** with reproduction steps. We aim to acknowledge
within 48 hours and provide a resolution timeline within 5 business days.

If email is unavailable, open a **private security advisory** on GitHub
(Security tab → "Report a vulnerability").

**Do not** open a public GitHub issue for security-sensitive reports.

## Privacy / Data-Breach Contact

For personal-data concerns or GDPR-related enquiries:
**privacy@festie.us**

## Incident Response

A full incident-response plan — including severity classes, the
identify → contain → eradicate → recover → postmortem runbook, GDPR Art. 33
72-hour breach-notification procedure, and credential-rotation steps — is
maintained at [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md).

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

See the "Reporting a Vulnerability" section above. Primary alias is
security@festie.us; GitHub private advisory is the fallback.
