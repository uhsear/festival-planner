# Incident Response Plan

Festie — real-time festival crew coordination (festie.us)
Last reviewed: 2026-06-20

> **Public-repo safe.** This document references roles, env-var names, and
> logical resource names only. No production IPs, usernames, or credentials
> appear here. Operational detail (SSH targets, credentials, prod URLs) lives
> in private runbooks and the server `.env`.

---

## 1. Contacts

| Role | Alias / Channel | Scope |
|------|-----------------|-------|
| **Security Lead** | security@festie.us | All security incidents; first escalation point |
| **Privacy Contact / DPO** | privacy@festie.us | Personal-data breach; GDPR Art. 33/34 notifications |
| **Infra On-call** | infra@festie.us | Host, PM2, Redis, Postgres, Cloudflare Tunnel |
| **External: Sentry** | sentry.io — org `festi-jn` | Error telemetry; incident correlation |
| **External: Cloudflare** | cf support ticket | Tunnel / WAF / DNS disruption |

*Personal email addresses are stored out-of-band (private contacts file, password
manager). Never commit them here.*

---

## 2. Detection Sources

| Source | What it surfaces | Where to look |
|--------|-----------------|---------------|
| **Sentry** (`festi-jn` org) | Unhandled exceptions, new issue spikes, performance regressions | Sentry dashboard / email alerts |
| **Uptime monitor** | Endpoint availability (`/api/ready`, `festie.us`) | Monitor dashboard alerts |
| **Prometheus / prom-client** | 5xx rate >2%, p95 latency >1.5s, pg pool near-empty, Redis down, disk <10% | `docs/alerts.yml` rule groups `festie-availability` + `festie-infra`; Prometheus alertmanager |
| **PM2 logs** | Process crashes, restart loops, Node.js fatal errors | `pm2 logs festie --lines 200` on the app host |
| **Postgres audit log** | Admin mutations, suspicious DML patterns | `lib/helpers/audit.ts` writes to `audit_log` table; query directly |
| **Festie application audit log** | All admin + sensitive mutations (actor, IP, request-id) | `audit_log` table in Postgres |
| **gitleaks (CI gate)** | Committed secrets in any push / PR | `.github/workflows/ci.yml` — `gitleaks` step |
| **Manual report** | Responsible disclosure from external researchers or users | security@festie.us (see SECURITY.md) |

---

## 3. Severity Classification

| Sev | Label | Definition | Target acknowledge | Target contain |
|-----|-------|------------|-------------------|----------------|
| **S1** | Critical | Active exploitation confirmed; personal data exfiltrated or at risk; service completely unavailable during a live event; ransomware / credential takeover | 15 min | 1 h |
| **S2** | High | Likely exploitation or strong suspicion; significant functionality broken; GDPR breach threshold likely met | 30 min | 4 h |
| **S3** | Medium | Vulnerability confirmed but not yet exploited; degraded performance; limited-scope data exposure | 2 h | 24 h |
| **S4** | Low | Informational finding; minor anomaly; no evidence of exploitation | Next business day | 72 h |

**GDPR trigger:** Any incident where personal data (user accounts, GPS coordinates,
SOS messages, crew membership) of EU-resident users is or may have been accessed,
altered, or destroyed without authorization is a **potential Art. 33 notifiable
breach**. Start the 72-hour clock at the moment the incident is first confirmed
(not when investigation concludes). See §7.

---

## 4. Response Runbook

### 4.1 Phase 1 — Identify

1. Triage the alert or report. Assign a severity (§3) and an incident commander (IC).
2. Open an incident record (private channel / doc). Record:
   - Detection timestamp (UTC)
   - Detection source (Sentry issue ID, alert name, reporter)
   - Initial hypothesis (what data / systems are affected)
   - IC name and Security Lead notified Y/N
3. Gather signals in parallel:
   - Sentry: search `festi-jn` org for correlated errors (filter by time window).
   - PM2 logs: `pm2 logs festie --lines 500` — look for unhandled exceptions, auth failures, unusual routes.
   - Postgres `audit_log`: query for anomalous admin actions or bulk data access in the window.
   - Prometheus: check `FestieHigh5xxRate`, `FestiePgPoolNearEmpty`, `FestieRedisDown` firing history.
   - Cloudflare Tunnel: check tunnel health and WAF event log for unusual traffic.
4. Determine whether **personal data** is in scope (GPS, SOS, user accounts, crew
   membership). If yes, notify Privacy Contact immediately — the GDPR clock may
   already be running.

### 4.2 Phase 2 — Contain

Goal: stop the bleeding without destroying evidence.

**Account / session compromise:**
- Force-invalidate all sessions for the affected user(s):
  `stores.sessions.deleteUserSessions(userId)` (or via the admin panel).
- Force-revoke all refresh tokens: `stores.refreshTokens.revokeAll(userId)`.
- If a credential (API key, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`,
  `JWT_SECRET`) is exposed, rotate it immediately (§5) — this takes priority over
  preserving the running state.

**Active exploitation of a realtime / Socket.IO path:**
- Identify the socket room and force-evict affected sockets server-side using
  `io.in('crew:'+crewId).fetchSockets()` filtered by `userId`.
- If the vector is an unpatched code path: enable maintenance mode or temporarily
  disable the affected feature via the `LIVE_LOCATION_ENABLED` or equivalent
  feature flag before restarting.

**Data exfiltration / bulk access:**
- Revoke or rotate the database credential immediately (`DATABASE_URL` — §5).
- Block the source IP at the Cloudflare WAF / firewall level if identified.
- Snapshot the Postgres `pg_stat_activity` and `audit_log` rows before any restart.

**Infrastructure compromise (host-level):**
- Isolate: remove the Cloudflare Tunnel connector (`CF_TUNNEL_TOKEN`) so the host
  is no longer publicly reachable. Traffic stops immediately.
- Do NOT restart PM2 or delete logs — preserve evidence.
- Engage Infra On-call for live forensics.

**Key actions that apply to all S1/S2 incidents:**
- Preserve PM2 logs (`~/$FESTIE_APP_DIR/logs/`) before any `pm2 restart`.
- Capture a Postgres dump of the `audit_log` and relevant tables to a local file
  before any schema changes.

### 4.3 Phase 3 — Eradicate

1. Identify the root cause (vulnerable code path, leaked credential, misconfigured
   access control, compromised dependency).
2. If a code fix is required:
   - Develop and test the fix on a non-production environment.
   - Run the full CI suite (`npm test`, `pnpm --filter @festie/web test`, mobile
     typecheck + lint) before deploying.
   - Deploy via the standard runbook (`docs/runbooks/deploy.md`) — do not bypass
     the readiness gate.
3. If a dependency is the root cause: pin the fixed version in `package.json` /
   `packages/*/package.json`, run `npm ci` / `pnpm install --frozen-lockfile`,
   verify `npm audit --audit-level=high` passes.
4. Rotate all credentials that were or may have been exposed (§5).
5. Remove any attacker-injected artifacts (malicious data rows, rogue admin
   accounts, injected meeting-point labels). Verify via `audit_log`.

### 4.4 Phase 4 — Recover

1. Restore from backup if data integrity is uncertain:
   - Follow `docs/runbooks/backup-restore.md` exactly.
   - The offsite-encrypted-git path (`uhsear/festie-backups`) holds GPG-symmetric
     AES-256 dumps with 14-backup retention. Decrypt with `BACKUP_GPG_PASSPHRASE`
     (stored out-of-band in the password manager — see the backup runbook).
   - Prefer restoring to an isolated `festie_restore` DB first and validating
     before any prod cutover.
2. Re-enable the Cloudflare Tunnel connector once the host is confirmed clean and
   the fix is deployed.
3. Verify health: `python scripts/deploy/verify.py` (PM2 online, `/api/ready` 200,
   login smoke).
4. Monitor Sentry and Prometheus for 24 h post-recovery for re-exploitation
   indicators.
5. Notify affected users if personal data was exposed (see §7).

### 4.5 Phase 5 — Postmortem

Required for all S1 / S2 incidents; recommended for S3.

Postmortem document must include:
- Timeline (UTC, from first signal to resolution).
- Root cause (technical and process).
- Impact: data categories affected, number of users, duration.
- What worked / what failed in this runbook.
- Corrective actions with owners and due dates.
- Whether GDPR notification was required and what was filed.

Post within 5 business days. Store in `docs/postmortems/YYYY-MM-DD-slug.md`
(not committed if it contains personal data).

---

## 5. Credential Rotation and Key Revocation

> Reference `SECURITY.md` for the authoritative list of hardening controls.
> Never commit secrets; all credentials are referenced by env-var name only.

| Credential | Env var | Rotation steps |
|------------|---------|----------------|
| Postgres password | `DATABASE_URL` | 1. Generate new password. 2. Update in `.env` on prod host. 3. `pm2 reload festie` (app reconnects on boot). 4. Update any backup scripts referencing the old URL. |
| Redis password | `REDIS_URL` | 1. Set `requirepass` in Redis config. 2. Update `REDIS_URL` in `.env`. 3. `pm2 reload festie`. |
| Session secret | `SESSION_SECRET` | Rotation invalidates **all** active sessions sitewide. 1. Generate new 256-bit secret. 2. Update `.env`. 3. `pm2 reload festie`. Warn users they will be logged out. |
| JWT / bearer secret | `JWT_SECRET` | Same effect as SESSION_SECRET rotation. Coordinate with mobile release if long-lived tokens are in use. |
| Backup GPG passphrase | `BACKUP_GPG_PASSPHRASE` | 1. Re-encrypt all retained dumps with the new passphrase. 2. Update in password manager. 3. Update on prod host `.env`. Future dumps use the new passphrase automatically. |
| Backup deploy key (GitHub) | SSH key at `festie_backups_deploy` path | 1. Generate new ed25519 key pair. 2. Replace deploy key on `uhsear/festie-backups`. 3. Replace private key on prod host at the configured path. |
| Firebase / FCM server key | `FIREBASE_SERVICE_ACCOUNT` / env var | Revoke in Google Cloud Console → IAM. Generate new service account key. Update `.env`. |
| Cloudflare Tunnel token | `CF_TUNNEL_TOKEN` | Revoke old token in Cloudflare dashboard → Zero Trust → Tunnels. Generate new token. Update `.env`. `pm2 reload festie`. |
| GitHub Actions secrets | `EXPO_TOKEN`, etc. | Rotate in repository Settings → Secrets. No app restart needed. |

**After any credential rotation:** verify `npm audit --audit-level=high` is still
clean and the Prometheus `FestieRedisDown` / `FestiePgPoolNearEmpty` alerts are
not firing.

---

## 6. Personal Data in Festie's Scope

For GDPR/privacy purposes, the following data categories are processed:

| Category | Where stored | Sensitivity |
|----------|-------------|-------------|
| User accounts (email, hashed password, display name) | Postgres `users` table | High |
| Session tokens (hashed) | Postgres `sessions`, `refresh_tokens` tables | High |
| Live GPS coordinates | Socket.IO only — never persisted to Postgres | Very High |
| SOS messages and coarse SOS coordinates (~11 m rounded) | Postgres `crew_activity` table | Very High |
| Crew membership and crew names | Postgres `crews`, `crew_members` tables | Medium |
| Meeting-point labels and coordinates | Postgres `crew_meeting_points` | Medium |
| Lineup picks, schedule data | Postgres; links to Spotify artist IDs | Low |
| Audit log (actor, IP, request-id) | Postgres `audit_log` | Medium |
| Push tokens (FCM/APNs) | Postgres (device registration table) | Medium |

Live GPS is the highest-risk asset: it is real-time location of festival attendees
and is socket-only with no database write. A compromise of the realtime Socket.IO
layer (e.g. via the crew-room membership-revocation gap documented in
`docs/audits/security-review-2026-06-06.md`) constitutes personal data exposure
even without a Postgres breach.

---

## 7. GDPR Article 33 — 72-Hour Breach Notification

### Trigger

A personal data breach under Art. 4(12) GDPR must be notified to the competent
supervisory authority within **72 hours** of the controller becoming aware of it,
unless the breach is "unlikely to result in a risk to the rights and freedoms of
natural persons."

**The clock starts when the incident is first confirmed, not when the
investigation is complete.**

Festie processes personal data of EU residents attending festivals. Any incident
that meets the Art. 4(12) definition (accidental or unlawful access, disclosure,
alteration, or destruction of personal data) must be assessed immediately.

### Assessment checklist

At the moment an incident is confirmed:

- [ ] Does it involve personal data? (See §6 for data categories.)
- [ ] Are any data subjects EU residents?
- [ ] Was the data accessed, altered, destroyed, or disclosed without
      authorization — even if only potentially?
- [ ] Is there a risk to rights and freedoms (identity theft, physical safety,
      reputational harm)?

If all four boxes are checked, treat it as a notifiable breach and begin filing.

### Who acts

| Action | Owner | Deadline |
|--------|-------|----------|
| Confirm breach and start clock | Security Lead | T+0 |
| Notify Privacy Contact / DPO | Security Lead | T+0 (same notification) |
| Draft supervisory authority notification | Privacy Contact | T+48 h |
| File with supervisory authority | Privacy Contact | T+72 h max |
| Notify affected data subjects (if high risk, Art. 34) | Privacy Contact | Without undue delay after SA filing |

### Notification content (Art. 33(3))

The notification must include:
1. Nature of the breach (categories and approximate number of data subjects and
   records affected).
2. Contact details of the DPO or privacy contact: privacy@festie.us.
3. Likely consequences of the breach.
4. Measures taken or proposed to address the breach and mitigate effects.

If all information is not available within 72 hours, file a preliminary
notification and supplement it (Art. 33(4) permits phased filing).

### Record-keeping (Art. 33(5))

All personal data breaches must be documented in the incident record regardless
of whether they are notifiable. Include: facts, effects, remedial action taken.

---

## 8. Stack-Specific Runbook Notes

### PM2 cluster (x4 workers)

- Prefer `pm2 reload festie` (zero-downtime) over `pm2 restart` during incidents
  unless the process is wedged.
- Emergency hard-reset: `~/restart.sh` or `~/recover.sh` on the app host (see
  `docs/runbooks/deploy.md §5`).
- Rate-limiter state that is in-memory per-process (location flood, SOS raise
  throttle) resets on each reload — expected. Redis-backed limiters persist.

### Postgres

- Connection string: `DATABASE_URL` in prod `.env`.
- All migrations are app-managed and additive. Do not run a separate migration
  tool during an incident — `pm2 reload` applies pending migrations on boot.
- If schema integrity is uncertain after an attack, restore from the offsite
  encrypted backup (`docs/runbooks/backup-restore.md`).

### Redis

- Used for: sessions, rate limiting, Socket.IO multi-worker pub/sub adapter,
  BullMQ notification queue.
- If Redis is down: sessions degrade gracefully (in-memory fallback for rate
  limits only — sessions themselves still require Redis). The Socket.IO adapter
  falls back to single-node mode. BullMQ jobs queue on the local worker.
- To verify: `redis-cli -u "$REDIS_URL" ping` on the host.

### Cloudflare Tunnel

- All public traffic flows through the Cloudflare Tunnel (`CF_TUNNEL_TOKEN`).
- Revoking or removing the tunnel connector immediately takes festie.us offline —
  use this as a kill switch for S1 containment.
- DNS and WAF rules can block specific IPs without taking the site fully offline.

### Sentry (`festi-jn` org)

- New error spikes during an incident: check Sentry first for stack traces before
  digging into raw PM2 logs.
- Source maps are uploaded on each CI build — stack frames resolve to TypeScript
  source lines.
- Use Sentry performance traces to correlate a surge in a specific route with
  database or Redis latency.

### Offsite encrypted backup

- Repo: `uhsear/festie-backups` (private, write-only deploy key on prod).
- Format: `pg_dump -Fc` | GPG AES-256 symmetric. 14 dumps retained.
- Decrypt key: `BACKUP_GPG_PASSPHRASE` — stored **only** in the out-of-band
  password manager. If lost, encrypted dumps are unrecoverable.
- Full restore procedure: `docs/runbooks/backup-restore.md`.

---

## 9. Related Documents

| Document | Purpose |
|----------|---------|
| `SECURITY.md` | Hardening controls, vulnerability reporting, accepted risks |
| `docs/runbooks/deploy.md` | Deploy, rollback, emergency restart |
| `docs/runbooks/backup-restore.md` | Offsite backup decrypt + restore |
| `docs/audits/security-review-2026-06-06.md` | Full security audit with H1-H4 findings |
| `docs/alerts.yml` | Prometheus alert rules (availability + infra) |
| `docs/adrs/013-scrypt-sha256-session-token-auth.md` | Auth/session design rationale |
