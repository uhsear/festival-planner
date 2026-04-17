# Changelog

All notable changes to Festie are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.10.2] - 2026-03-22

### Changed
- **Server modularization (Phase 3)**: Extracted 5 focused modules from server.js monolith, reducing it from 2,662 to 2,154 lines (-19%)
  - `lib/logger.js` — structured logging with sensitive field sanitization
  - `lib/crypto-auth.js` — scrypt password hashing, session token hashing, timing-safe comparison
  - `lib/reset-pages.js` — password reset HTML form and error page generators
  - `lib/presence.js` — Socket.IO presence management (13 functions via factory pattern)
  - `lib/rate-limiting.js` — rate limiter factories (written, pending integration)
- **webhook automation (Phase 2)**: Deploy pipeline, monitoring, and FCM retry queue 
  - GitHub webhook triggers automated deploy pipeline
  - Health monitoring workflow with ntfy.sh alerts
  - Persistent FCM retry queue for failed push notifications
- **FCM retry integration**: Fire-and-forget POST to webhook alongside in-memory retry queue in lib/notifications.js

### Removed
- Backup files: server.js.pre-phase3, server.js.bak, lib/notifications.js.bak

### Fixed
- All 236 tests passing (106 unit + 91 integration + 31 critical paths + 8 e2e)

## [1.10.1] - 2026-03-21

### Added
- **Email change UI**: Account menu displays current email with verified/unverified badge, supports changing email with password confirmation
- **Resend verification**: One-click resend of email verification from account menu
- **Account settings layout**: Reorganized account section into Photo / Email / Password rows with inline actions
- **Install App button**: Cross-platform PWA install — uses native beforeinstallprompt on Chromium, shows platform-specific instructions (iOS, Android, Firefox, Samsung) on all other browsers
- **Support Me button**: PayPal.me tip link in header below logo
- **WCAG 2.2 compliance**: 44px touch targets (2.5.8), aria-controls on tabs (4.1.2), role=alert on auth errors, aria-describedby on cookie consent
- **Cross-browser E2E tests**: WebKit and Firefox Playwright projects
- **E2E test coverage**: 7 new tests — guest browsing, share links, forgot password, WCAG touch targets, aria-controls, role=alert, email change flow

### Fixed
- **Offline mode**: Added helpers.js and timeline.js to service worker SHELL_URLS — app now works fully offline when installed as PWA
- **FCM push notifications**: Added fcmregistrations.googleapis.com to CSP connect-src — push token registration no longer fails silently
- **Manifest icons**: Split "any maskable" icon purpose into separate entries for Chrome installability; added id and scope fields

### Changed
- Service worker cache bumped to v117
- Version bump to 1.10.1

## [1.10.0] - 2026-03-20

### Removed
- **Chat feature**: Removed in-app chat entirely — chat:send, chat:react socket events, message loading endpoint, SSE fallback, chat UI panel, chat rate limiting, and all associated CSS. Users coordinate via existing messaging apps (WhatsApp, iMessage, Discord). DB tables retained for data preservation.
- **Chat reactions**: Removed emoji reaction system (reaction picker, reaction pill UI, per-emoji caps)
- **Chat push notifications**: Removed FCM push for chat messages (crew update and schedule change push notifications remain)
- **Chat rate limiting**: Removed dedicated chat rate limit map and Redis rate limiter
- **Chat config**: Removed CHAT_MAX_MESSAGES, CHAT_RATE_LIMIT, CHAT_MAX_LENGTH, SOCKET_REACT_RATE_LIMIT config constants
- **Chat tests**: Removed ~120 lines of chat-specific integration tests

### Changed
- **Socket.IO**: Simplified to presence and crew updates only (chat events removed)
- **Reconnect handler**: No longer performs message gap-fill on reconnect:restore
- **Emitter**: Removed chatMessage() and chatReaction() broadcast functions
- **Frontend**: ~3,700 bytes smaller (chat UI, handlers, state removed)
- **CSS**: ~8,000 bytes smaller (chat panel, messages, reactions, date separators removed)
- Version bump to 1.10.0

## [1.9.1] - 2026-03-21

### Fixed
- **Socket.IO reconnect bug**: Fixed undefined `validatedFestivalId` reference in `reconnect:restore` handler that caused runtime errors when room was full
- **N+1 avatar query**: Batch-resolve user avatars on reconnect gap-fill instead of sequential per-message queries (up to 200x fewer DB calls)
- **Rate limit cleanup**: Consolidated 8 separate rate-limit cleanup loops into single unified iteration in server.js
- **Export worker**: Removed redundant hard-coded concurrent export limit (20) that conflicted with configurable MAX_CONCURRENT_EXPORTS
- **Batch eviction**: Optimized emitter batch eviction from O(n) scan to O(1) using Map insertion order
- **CSS**: Fixed undefined `--bg-hover` variable causing broken hover states on now/next strip; removed duplicate `slideUp` keyframe animation

### Added
- **Pick save debounce**: Prevents double-click/rapid-tap race conditions on priority buttons with 350ms cooldown per set
- **Loading skeleton**: CSS skeleton placeholder cards shown while festival data loads
- **Profiles route documentation**: Added TODO annotations for future N+1 query optimization in profiles route

### Changed
- **Version header**: Corrected server.js header comment from v1.3.0 to v1.9.0
- **Cache bust**: Updated frontend asset version query strings
- **CSS variables**: Added `--bg-hover` and `--bg-elevated` to dark theme root

## [1.9.0] - 2026-03-20

### Added
- **Real-time Crew Synchronization**: Live updates across all team members with optimized Socket.IO events
- **Priority-based Event Picks**: Three-tier system (must-see, interested, skip) with conflict resolution
- **Automatic Conflict Detection**: Real-time alerts when crew members pick overlapping events
- **Live Crew Chat**: In-app messaging with real-time delivery and read receipts
- **Calendar Export**: ICS format for one-click integration with calendar applications
- **Offline Support**: Local-first architecture with automatic sync on reconnection
- **Push Notifications**: Firebase Cloud Messaging for desktop and mobile alerts
- **Admin Dashboard**: Comprehensive event management, user analytics, and moderation tools
- **Public Share Pages**: Festival-specific URLs for sharing schedules with non-authenticated users
- **Avatar Upload System**: User profile customization with image validation and CDN delivery
- **OpenAPI Specification**: Interactive API documentation at `/api/docs`
- **Comprehensive Test Suite**: 236 tests covering unit, integration, and critical user paths
- **Enhanced Security**: SHA-256 session tokens, Scrypt password hashing, CSP with per-script hashing
- **Session Management**: Secure refresh token rotation with 90-day TTL and account lockout protection
- **Rate Limiting**: Multi-tier per-endpoint and per-user limiting to prevent abuse
- **GDPR Compliance**: Data export, account self-deletion with 30-day grace period, ToS acceptance tracking
- **Database Migrations**: Full migration chain (004-008) with 20+ optimized tables
- **Production Deployment**: PM2 cluster mode, nginx reverse proxy, Let's Encrypt TLS integration
- **Health Endpoints**: `/health/live` for liveness and `/api/health` for readiness probes
- **Comprehensive Documentation**: README, deployment guide, configuration reference, and security policies

### Changed
- **Database Schema**: Expanded from 15 to 20+ tables for scalability and performance
- **Authentication Flow**: Token-based with refresh rotation replacing simple session tokens
- **API Response Format**: Standardized error responses with ISO 8601 timestamps
- **Logging System**: Structured logging with configurable verbosity levels

### Fixed
- Memory leak in Socket.IO connection handling
- Race condition in concurrent event pick updates
- Incorrect timezone handling in calendar export
- Session token expiration edge cases

### Security
- Implemented parameterized SQL queries preventing injection attacks
- Added CSRF protection via origin enforcement
- Enforced Content Security Policy with per-script nonce hashing
- Implemented session token refresh rotation (90-day TTL)
- Added account lockout after 10 failed login attempts
- Rate limiting on login endpoints (5 attempts per 5 minutes)
- Secure password hashing with Scrypt (12 rounds default)

## [1.8.0] - 2026-02-15

### Added
- **Refresh Token System**: Automatic token rotation with 90-day expiration
- **Account Lockout Protection**: Account locks after 10 failed login attempts
- **OpenAPI Specification**: Machine-readable API documentation with Swagger UI
- **Metrics Rollups**: Historical metrics aggregation for performance analysis
- **Redis Caching**: Optional Redis integration for improved session performance
- **Backup Automation**: Database backup scripts with restoration testing
- **Monitoring Endpoints**: `/api/health` endpoint for readiness checks

### Changed
- Upgraded to Node.js 22 LTS
- Improved database query performance with connection pooling
- Enhanced error messages for debugging

### Fixed
- Session timeout race conditions
- WebSocket reconnection issues on network interruption

## [1.7.3] - 2026-01-10

### Added
- Initial stable release
- Core crew synchronization features
- Basic event scheduling with picks
- Chat messaging system
- User authentication with sessions
- PostgreSQL database with migrations
- Express.js REST API
- Socket.IO real-time updates

### Known Limitations
- Limited to 500 events per festival
- Maximum 1000 concurrent users
- No offline support in this version
- Avatar uploads not yet supported

## [1.7.0] - 2025-12-20

### Added
- Initial beta release
- Event picking system
- User management
- Basic API endpoints

---

## Upgrade Guide

### From 1.8.0 to 1.9.0

No breaking changes. Optional enhancements available:

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies
npm install

# 3. Run database migrations (idempotent)
npm run migrate:up

# 4. Deploy with PM2
pm2 restart ecosystem.config.js

# 5. Verify
curl https://festie.us/api/health
```

### From 1.7.3 to 1.8.0

Breaking changes in token format:

```bash
# 1. Backup database
pg_dump festival_planner_prod > backup_1.7.3.sql

# 2. Pull latest code
git pull origin main

# 3. Install dependencies
npm install

# 4. Run migrations
npm run migrate:up

# 5. Restart all instances
pm2 restart ecosystem.config.js

# 6. Verify sessions are valid
npm run test:integration
```

## Version Numbering

- **MAJOR**: Breaking API or database changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes and security updates

Festie follows continuous deployment practices. All releases are tagged in Git and correspond to Docker image tags.

## Security Updates

Security patches are released as patch versions and are mandatory. Subscribe to [GitHub Releases](https://github.com/uhsear/festival-planner/releases) for notifications.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for information on reporting issues and contributing features.

## Support

For version-specific support:
- Open an issue on [GitHub](https://github.com/uhsear/festival-planner/issues)
- Check [Discussions](https://github.com/uhsear/festival-planner/discussions) for Q&A

---

**Latest Version**: 1.9.0 (March 20, 2026)
