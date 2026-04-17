# Festie Architecture & Refactoring Guide

## Project Overview

Festie is a real-time web application for festival crew coordination. Users create festivals, join crew profiles, manage picks/notes/reminders, and chat in real-time.

**Stack:**
- Backend: Node.js + Express + Socket.IO + SQLite
- Frontend: Vanilla JS (no build step) + Service Workers (offline)
- Deployment: Single-server or multi-worker (Redis-backed)

---

## Code Organization

### Server Entry Point: `server.js` (2074 lines)

The main factory `createFestivalPlanner(overrides)` returns an object with:
- Express app instance
- HTTP server + Socket.IO
- Configuration + state
- Helper functions (data access, rate limiting, auth)

**Organization within server.js:**

1. **Constants & Configuration** (lines 100-200)
   - Allowed values (priorities, presets, MIME types)
   - Scrypt/hashing constants
   - Rate limit & timeout settings

2. **Password Hashing & Security** (lines 201-300)
   - `hashPassword()` - Scrypt-based with random salt
   - `verifyPassword()` - Timing-safe comparison
   - `timingSafeEqualString()` - For token comparisons

3. **State Initialization** (lines 300-400)
   - Write queuing (safeWrite) to prevent race conditions
   - Rate limit maps with periodic cleanup
   - User/festival caching with version tracking

4. **Data Management** (lines 400-600)
   - Avatar file handling (directory, temp files, validation)
   - JSON read/write with resource resolution
   - User map caching (invalidated on user updates)

5. **Session Management** (lines 600-800)
   - `createUserSession()` - Generate token + set SQLite + evict old
   - `validateUserSession()` - Check TTL + last access
   - `invalidateUserSessions()` - Revoke + disconnect sockets

6. **Request Handling** (lines 800-1000)
   - Rate limiting middleware (API + auth + socket connect)
   - CORS for mobile clients (Capacitor origins)
   - Request body size limits
   - Static file serving

7. **Route Registration** (lines 1000-1200)
   - Routes injected with dependencies (factory pattern)
   - Each route handles specific domain (auth, profiles, exports, etc.)

8. **Socket.IO Setup** (lines 1200-1400)
   - Real-time event handlers (presence, chat, typing, reactions)
   - Presence debouncing (500ms) to reduce broadcasts
   - Message sequencing for gap-fill on reconnect

9. **Graceful Shutdown** (lines 1400-1500)
   - Drain in-flight requests
   - Close database + cache connections
   - Clear timers

### Route Handlers: `routes/*.js`

Each route is a factory function:

```javascript
module.exports = function createXRoutes(deps) {
  const { express, log, ... } = deps;
  const router = express.Router();

  router.post('/endpoint', (req, res) => { ... });

  return router;
};
```

**Route Files:**

| File | Lines | Responsibility |
|------|-------|-----------------|
| `auth.js` | 308 | Register, login, logout, change password |
| `account.js` | 306 | Avatar upload/delete |
| `profiles.js` | 306 | Join festival, update picks/notes/reminders |
| `festivals.js` | 184 | Create, update, delete, clone festivals |
| `notifications.js` | 296 | Push tokens, notification prefs, mark read |
| `export.js` | 446 | HTML/ICS exports, presence list, messages |
| `socket.js` | 492 | Real-time: presence, chat, typing, reactions |
| `admin.js` | 172 | Admin login, user management, password reset |
| `health.js` | 207 | Health checks, metrics, debug info |

### Database: `lib/planner-db.js` (1389 lines)

SQLite schema with 3 migration phases:

**Core Tables:**
- `users` - User accounts (username, password_hash, avatar_key)
- `user_sessions` - Session tokens (hashed) with TTL
- `admin_sessions` - Admin tokens
- `festivals` - Festival records
- `festival_stages` - Stages per festival
- `festival_days` - Days per festival
- `festival_sets` - Sets (artist + time + stage) per day
- `festival_profiles` - User participation + picks/notes/reminders
- `messages` - Chat messages per festival
- `device_tokens` - Push notification tokens (expires_at: 90 days)
- `audit_log` - Audit trail (Phase 6)

**Data Access:** Each table has a store object with CRUD methods:
```javascript
stores.users.getById(userId) → user object
stores.profiles.readAll() → all profiles
stores.messages.readFestival(festivalId) → messages
```

### Helpers: `lib/helpers.js` (727 lines)

**Sections:**
1. Input Sanitization (sanitizeString, normalizeRecordKey)
2. Validation (validateTime, validateColor, validateFestival)
3. Formatting (formatTime, buildFestivalSetList)
4. Serialization (serializeOwnProfile, serializeLiveStatus)
5. Export Generation (buildExportHtml)
6. Security (escapeHtml, buildContentSecurityPolicy)
7. Utilities (createOpaqueId, buildAvatarUrl)

### Configuration: `lib/config.js`

Loads environment variables with sensible defaults:

```javascript
const { DEFAULTS, loadConfig } = require('./lib/config');
const config = loadConfig(overrides);
// config.PORT, config.MAX_USERS, config.RATE_LIMIT_MAX, etc.
```

### Schemas: `lib/schemas.js`

Zod validation for all endpoints:

```javascript
const validation = schemas.registerSchema.safeParse(req.body);
if (!validation.success) return sendError(res, 400, validation.error.message);
```

**Coverage:**
- Auth: register, login, change password, admin login
- Profiles: picks, notes, reminders, live status, join festival
- Notifications: push tokens, preferences
- Socket events: join:festival, chat:send, chat:typing, chat:react

---

## Key Design Patterns

### 1. Dependency Injection

Every module receives its dependencies as an object:

```javascript
createAuthRoutes({
  express,
  config,
  log,
  hashPassword,
  verifyPassword,
  createUserSession,
  // ... 20+ more
})
```

**Benefits:**
- Easy to test (swap real implementation with test doubles)
- Clear data flow (no hidden globals)
- Reusable modules (same interface in tests + server)

### 2. Error Handling

Standardized error response format:

```javascript
sendError(res, 400, 'Invalid username', ErrorCodes.INVALID_INPUT)
// → { ok: false, code: 'INVALID_INPUT', message: 'Invalid username' }
```

Sensitive data is sanitized before logging:

```javascript
log.error('login failed', sanitizeLogMeta({ password: '***', username: 'alice' }))
```

### 3. Rate Limiting (Multi-Tier)

**In-Memory (Fast)**
- Per-IP API limit: 120 req/min
- Per-IP auth limit: 10 attempts / 5 min
- Per-userId auth limit: 10 attempts / 5 min (prevents distributed attack)
- Per-user chat limit: 10 msg / min

**Redis-Backed (Distributed)**
- Same limits, but shared across workers
- Graceful fallback to in-memory if Redis unavailable

**Cleanup**
- Maps pruned every 60s (entries older than 2x window)
- Cap: 10,000 entries max (LRU eviction if exceeded)

### 4. State Management

Immutable state with explicit mutations:

```javascript
const state = {
  writeLocks: new Map(),           // File-level write locks
  writeQueues: new Map(),          // Queued writes per file
  onlineUsers: new Map(),          // Connected socket ID → user
  chatRateLimits: new Map(),       // Per-user chat rate limit
  metrics: { totalRequests: 0 },   // Server metrics
};
```

**Write Queuing** (`safeWrite`)

Prevents race conditions:

```javascript
await safeWrite('profiles.json', (data) => {
  const profile = data.find(p => p.id === profileId);
  profile.picks = { ...newPicks };
  return { data, value: profile };
});
```

Internally:
1. Acquire write lock
2. Read + deep clone
3. Apply mutation
4. Write back
5. Cache invalidation (if needed)
6. Release lock + process queue

### 5. Real-Time (Socket.IO)

**Presence Tracking**
- User joins festival room: `socket.emit('join:festival', festivalId)`
- Presence broadcast debounced (500ms) to reduce updates
- Message sequencing for gap-fill: `lastMessageSequence` on reconnect

**Chat Features**
- Messages are NDJSON (newline-delimited) for large exports
- Reactions: emoji with 20-emoji cap per message (prevents bloat)
- Typing indicators: broadcast with 3.5s cleanup (candidate for removal)

**Events:**
```javascript
socket.on('join:festival', (festivalId, {userToken}) → presence update
socket.on('chat:send', {festivalId, text} → message broadcast
socket.on('chat:typing', {festivalId} → typing indicator broadcast
socket.on('chat:react', {messageId, emoji} → reaction update
socket.on('leave:festival' → presence cleanup
```

### 6. Session Security

**Password Hashing**
- Scrypt with 64-byte derived key
- Random 16-byte salt per password
- Format: `salt:hash` (hex-encoded)

**Token Security**
- 32 bytes (256 bits) random per session
- SHA256 hashed before storage
- Timing-safe comparison via crypto.timingSafeEqual

**Cookie Security**
- HTTP-only (no JS access)
- Secure (HTTPS only in production)
- SameSite=Strict (CSRF protection)
- Session TTL: 24 hours (configurable)

**Multi-Session Handling**
- Max 5 concurrent sessions per user (configurable)
- New login evicts oldest session
- Evicted sessions immediately disconnected via Socket.IO

### 7. Offline Support (Frontend)

**Snapshots**
- localStorage snapshot of festivals, profiles, messages
- Updated every time state changes
- Includes user + current festival context

**Sync Queue**
- Profile changes queued in localStorage (picks, notes, reminders)
- Auto-syncs when connection restored
- Discardable sync errors (e.g., festival deleted, profile not found)

**Local Reminders**
- Reminder timers continue offline
- Fired notifications even when no server connection
- Sync with server when reconnected

---

## Refactoring History (10 Passes Completed)

### Pass 1: server.js Organization
- Added section headers for code blocks (constants, auth, state, data, sessions, etc.)
- Separated password hashing functions (hashPassword, verifyPassword)
- Added JSDoc comments to key functions

### Pass 2: helpers.js Reorganization
- Added module-level documentation
- Grouped functions into sections:
  - Input Sanitization & Validation
  - Formatting & Serialization
  - Export Generation
  - Security & Configuration
- Added JSDoc to all 40+ exported functions

### Pass 3: planner-db.js Error Boundaries
- Added section headers for utilities, schema, database initialization
- Added JSDoc to createSchema, openPlannerDatabase, createStores
- Documented table relationships + migration phases

### Pass 4: socket.js Handler Extraction
- Added module documentation (real-time chat, presence, reactions)
- Documented event schemas with version field
- Added comments on design decisions (typing indicators, reactions)

### Pass 5: export.js Clarification
- Added module documentation (HTML/ICS exports, presence, messages)
- Clarified bundling rationale (why presence + messages together)
- Noted future split point (500+ lines)

### Pass 6: app.js Frontend Documentation
- Added comprehensive module header (state, rendering, offline, auth)
- Documented architecture (coordinator pattern, socket listeners, view dispatch)

### Pass 7: config.js Validation Layer
- Added module documentation (env var loading, defaults, type-safe parsing)
- Noted runtime validation at startup

### Pass 8: schemas.js Consolidation
- Added module-level documentation with usage examples
- Organized into clear sections:
  - Reusable Primitives
  - Authentication Schemas
  - Profile & Participation Schemas
  - Admin Schemas
  - Notification & Push Schemas
- Documented coverage gaps

### Pass 9: Naming Consistency Fixes
- Standardized route factory naming (all use `create*Routes` pattern)
- Added JSDoc to auth.js factory
- Fixed socket.js naming + added JSDoc

### Pass 10: Dead Code Removal & Final Documentation
- Added comprehensive architectural documentation to server.js
- Created ARCHITECTURE.md (this file)
- No dead code found (no TODOs, FIXMEs)
- Added file size notes for refactoring candidates

---

## Performance Considerations

### Caching
- User map cache: invalidated on user updates, rebuilt on access
- Festival map cache: invalidated on festival updates
- Device tokens: 5-minute TTL to reduce DB queries during notifications
- Parse JSON cache: LRU with 1000-entry max

### Rate Limiting
- In-memory maps: O(1) lookup, periodic cleanup
- Redis fallback: distributed across workers
- Cap: 10,000 entries (LRU eviction if exceeded)

### Database
- SQLite with prepared statements (no query parsing overhead)
- Indexed columns: (user_id, created_at), (festival_id, day_index)
- Foreign keys enabled (referential integrity)
- Pragmas: optimize SQLite performance (journal_mode=WAL)

### Memory
- State maps cleaned every 60 seconds
- Active exports limited to 4 concurrent (configurable)
- Message array capped at 500 per festival (CHAT_MAX_MESSAGES)

---

## Testing Notes

**Test Coverage:** 128 tests across unit + integration suites

**Key Test Scenarios:**
- Auth: register, login, session management, rate limiting
- Profiles: picks/notes/reminders validation, profile updates
- Exports: HTML + ICS generation, crew filtering
- Socket: presence, chat, reconnect gap-fill
- Rate limiting: distributed limits, in-memory fallback
- Admin: user management, password reset

**Running Tests:**
```bash
npm test                          # Unit + integration (node test runner)
npm run test:e2e                  # Playwright E2E (browser automation)
npm run test:all                  # Both
```

---

## Deployment & Operations

### Single-Server Mode
- In-memory rate limiting
- Local file storage (avatars)
- SQLite database

### Multi-Worker Mode (with Redis)
- Redis-backed rate limiting
- Redis presence store
- Redis cache invalidation bus
- Graceful fallback if Redis unavailable

### Configuration
```bash
PORT=4000                    # HTTP server port
BIND_ADDRESS=0.0.0.0         # Listen on all interfaces
REDIS_ENABLED=false          # Enable Redis caching
REDIS_URL=redis://...        # Redis connection
SESSION_TTL=86400000         # 24 hours
RATE_LIMIT_MAX=120           # Requests per minute
AVATAR_SIZE=256              # Avatar dimension (pixels)
```

### Logging
- JSON structured logs (timestamp, level, service, PID, message)
- Log levels: error, warn, info, debug
- Sensitive data sanitized (passwords, tokens, cookies)
- Request ID per HTTP request for tracing

---

## Future Improvements

### Phase 2 Candidates
1. **Remove Typing Indicators**
   - Cost: socket events + cleanup timers
   - Benefit: minimal (3s latency before message)
   - Recommendation: Remove for simplicity

2. **Split export.js**
   - Current: 446 lines (presence + exports + messages)
   - Candidate: Extract to routes/realtime.js (messages + presence only)
   - Threshold: 500 lines

3. **Further server.js Splitting**
   - Current: 2074 lines (manageable with factory pattern)
   - Candidates: lib/middleware.js, lib/avatars.js
   - Only if feature growth exceeds 3000 lines

4. **Frontend View Extraction**
   - Current: app.js 871 lines
   - Candidates: Split render functions into modules (views/cards.js, views/timeline.js)
   - Threshold: 1200+ lines

5. **Push Notification Service**
   - Current: basic APNS/FCM in lib/notifications.js
   - Opportunity: Service worker improvements, silent notifications

---

## Codebase Statistics

| Component | Lines | Purpose |
|-----------|-------|---------|
| server.js | 2074 | Express app, Socket.IO, session management |
| lib/planner-db.js | 1389 | SQLite schema, migrations, stores |
| public/app.js | 871 | Frontend coordinator, state, rendering |
| lib/helpers.js | 727 | 40+ utility functions |
| routes/socket.js | 492 | Real-time event handlers |
| routes/export.js | 446 | HTML/ICS exports, presence |
| routes/auth.js | 308 | Authentication endpoints |
| routes/account.js | 306 | Avatar management |
| routes/notifications.js | 296 | Push token + notification prefs |
| lib/config.js | 200+ | Configuration management |
| lib/schemas.js | 200+ | Zod validation schemas |
| **Total** | **~8500** | **Production codebase** |

---

**Last Updated:** 2026-03-15 (After 10 Refactoring Passes)
