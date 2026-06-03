# Festie Feature Roadmap — Detailed Implementation Plan

> Synthesis of four codebase-grounded architect passes (DURING-offline, location/map/P2P, BEFORE,
> AFTER), sequenced into one dependency-aware program. Prioritization follows
> [`offline-first-features-2026-06-03.md`](../research/offline-first-features-2026-06-03.md);
> feature sourcing follows [`competitor-features-2026-06-02.md`](../research/competitor-features-2026-06-02.md).
>
> **Lens:** every feature is tagged by festival **phase** (before / during / after) and **offline tier**
> (offline-native · offline-degraded-syncs · peer-to-peer · before/after-online-ok · online-only).
> DURING features must be offline-native, offline-degraded, or peer-to-peer — *never* online-only.

---

## 0. Foundations (build FIRST — they unblock multiple features)

These are shared prerequisites the architects surfaced. Several DURING features **silently render empty
offline** without them.

| # | Foundation | Why it unblocks | Effort | Files |
|---|---|---|---|---|
| **F1** | **Persist `allProfiles`** (bounded, crew-scoped: `{id,userId,name,picks}` + `_profilesCachedAt`; mirror the `_cachedCrewId` staleness guard) | `festivalDataStore.partialize` omits `allProfiles` today → **crew overlap, crew digest, grid overlap all render empty on a cold offline start** | M | `packages/shared/src/stores/festivalDataStore.ts` |
| **F2** | **Unify set-time math** — `getSetTimeBounds(set, days)` in `setStatus.ts` (uses the already-fixed `createDateInLocalFrame`, incl. post-midnight rollover); replace the two hand-rolled `parseSetMs` copies | Live mode + clash prompt + local reminders all need correct, single-source TZ-safe times (a 2nd copy of the bug class just fixed) | S | `packages/shared/src/utils/setStatus.ts`, `packages/web/src/routes/festival-mode.tsx`, `packages/mobile/app/festival-mode.tsx` |
| **F3** | **Shared util modules** (build once, many consumers): `timeAgo`/`formatStaleness`, `geo.ts` (haversine/bearing/relativeHeading + lat-lng↔pixel), `paymentLinks.ts`, `planSnapshot.ts` (QR/SMS payload codec, versioned + Zod-validated) | De-dups 3 inlined `timeAgo` copies; powers compass/map/ETA, settle-up, QR/SMS | S | `packages/shared/src/utils/*` |
| **F4** | **Coords on `CrewMeetingPoint`** — nullable `latitude`/`longitude` (mirror `022_festivals_geo.sql`); thread through store/route/schema/types/optimistic-placeholder; capture via `expo-location` (mobile) / `navigator.geolocation` (web) | Gate for last-synced position, compass, offline-map pins | S–M | migration, `lib/db/stores/crews.ts`, `routes/crew-meeting-points.ts`, `lib/schemas.ts`, `packages/shared/src/types/domain.ts`, `crewStore.ts` |
| **F5** | **"Download this festival for offline"** keystone — `offlineReadinessStore` orchestrates existing loaders + extends web SW `runtimeCaching` (weather SWR + art CacheFirst). **Division of labor: SW caches only PUBLIC GETs (festivals, weather, images); per-user data (profiles, crew) stays in zustand-persist** (URL-keyed SW caching leaks across accounts on shared devices) | Makes every DURING offline feature actually work; removes the #1 silent failure (half-cached arrival). Persists `allProfiles` (F1) behind an explicit, bounded download | M | new `packages/shared/src/stores/offlineReadinessStore.ts`, `packages/web/vite.config.ts`, new readiness UI (web + mobile) |

Also fix opportunistically: **`updateMeetingPoint`/`deleteMeetingPoint` latent offline bug** — they
destructure `{meetingPoint}` from the synthetic optimistic PUT result (which is `{...body,_optimistic}`),
writing `undefined` into the list. Apply the optimistic merge from the request body (mirror `savePick`).

---

## 1. Master feature table (deduped across clusters)

Effort S/M/L. Tier abbreviations: **ON** offline-native · **OD** offline-degraded-syncs · **P2P** peer-to-peer · **B/A** before/after-online-ok · **OO** online-only.

| Feature | Phase | Tier | Eff | Milestone |
|---|---|---|---|---|
| Offline-honest UX (freshness chips, "synced N ago", queued/failed badges) | during | ON | S | **M1** |
| Pre-computed LOCAL set reminders (`expo-notifications`, on-device) | during | ON | S | **M1** |
| Live mode (auto-scroll to now + next-pick countdown) | during | ON | S | **M1** |
| Crew overlap on a set (avatars by must/want/maybe, card + grid) | before+during | ON | S | **M1** |
| "What's my crew's plan" digest (meeting point + home base + next picks) | during | ON | M | **M1** |
| Pre-set meeting points offline read/edit (+fix update/delete bug) | during | ON/OD | S | **M1** |
| Inline clash prompt ("2 acts at 8:30 — pick one") | before+during | ON | S | **M1** |
| Bulk pick helpers ("add all must-see", genre/stage) | before | ON | S | **M2** |
| Schedule-aware polls (lineup options → meeting point + reminders) | before+during | OD | S | **M2** |
| Crew logistics boards (budget `planned` flag / packing / carpool) | before | OD | M | **M2** |
| Debt simplification + settle-up + payment deep links | after | B/A | S | **M3** |
| Crew-aware wrap superlatives + shared crew recap poster | after | B/A | M | **M3** |
| Reform crew for next festival (recap = the invite) | after→before | B/A | M | **M3** |
| Cross-festival year-over-year history + set-logging archive | after | B/A | M | **M3** |
| Re-engagement triggers (lineup drop / crew re-forms / wrap ready) | after | OO | M | **M3** |
| Connect Spotify → auto-suggest picks from top artists on lineup | before | OO | L | **M4** |
| Create Spotify playlist from picks | before | OO | M | **M4** |
| Last-synced position + queued "on my way / ETA to [point]" | during | OD | M | **M5** |
| Proximity compass to a saved meeting-point coord | during | ON | M | **M5** |
| QR plan-snapshot share (onboard a dead-data friend) | during | P2P | S–M | **M5** |
| SMS handoff ("text the crew our meetup") | during | P2P | S | **M5** |
| Offline map tiles (stages + meeting-point pins) | during | ON | M–L | **M6** |
| iOS Live Activity / Android ongoing notification (local-data) | during | ON | M (Android) / L (iOS) | **M6** |
| Crew photo wall (link-out now → R2 + media queue later) | after | OO | S → L | **M6** |
| BLE local mesh (true no-internet crew transport) | during | P2P | L | **deferred** |

---

## 2. Milestone 1 — Offline trust + during-festival core (the wedge)

*Prereqs: F1, F2, F3 (timeAgo). This is the defensible niche — features that deliver live value on dead signal.*

- **Offline-honest UX system** — `FreshnessChip` (web + mobile) reading `crewStore._cachedAt` / `festivalDataStore._festivalCachedAt`; per-surface "N change(s) queued" badge over `uiStore.pendingSync`; the `failedSync` retry cards already exist. *Accept:* cold offline launch shows "Showing offline data · synced N ago" with N advancing from the device clock.
- **Local set reminders** — `useLocalReminders` hook: diff `currentProfile.reminders` → `scheduleNotificationAsync` with deterministic id `festie-reminder-<setId>` at `getSetTimeBounds − lead`. **Decision: local-first delivery on mobile, FCM as at-home backstop, gated by the existing `scheduleAlerts` pref** (server-skip is a 1-line backend follow-up). Cap to the next ≤64 sets (iOS limit), prioritize must>want>maybe. Needs a dev-client/EAS build. *Accept:* reminder fires 15 min before a set in airplane mode.
- **Live mode** — now-line + auto-scroll on `timeline.tsx` / mobile `TimelineView.tsx`, 60 s tick, on F2's unified math; don't fight manual scroll. *Accept:* auto-scrolls to now offline; boundaries correct in a non-UTC TZ.
- **Crew overlap on a set** — the SetCard avatar cluster already exists (fed by `usePicks().getOtherPicks` → `allProfiles`); add priority grouping + the **grid-cell** overlap (not wired today) + avatar join against persisted `crewStore.crewMembers`. **Hard-depends on F1.** *Accept:* avatars by priority render offline on cards + grid.
- **"What's my crew's plan" digest** — new screen assembling active meeting point + `activeCrew.homeBase*` + next-slot crew picks, all from cache. Depends on F1 + the timed-set helper. *Accept:* renders with zero network requests.
- **Pre-set meeting points offline** — read/create already work; **fix the update/delete optimistic bug** (Foundations). *Accept:* edit/delete offline show immediately, replay clean.
- **Inline clash prompt** — `ClashPrompt` over `conflicts.ts` (detection exists as a passive badge); tap-to-demote via `savePick(...null)`; show once per clash pair. *Accept:* resolves a clash offline, persists.

## 3. Milestone 2 — Before-festival planning (pre-loads the dead window)

*Prereq: F5 (download-for-offline) lands here as the keystone.*

- **"Download this festival for offline"** (F5) — ship the orchestrator + readiness checklist UI.
- **Bulk pick helpers** — `bulkSavePicks(setIds, priority)` merges into the picks map and issues **one** coalesced `offlinePut` to `/profiles/:id`. Offline-native; also the no-Spotify fallback for M4. *Accept:* "add all on stage X" applies in one write, works offline, idempotent.
- **Schedule-aware polls** — client-side composer prefills poll `options` from `sets` in a timeslot (polls are already offline-create-eligible + reconciled); on close, create a meeting point at the winning set's stage/time + seed a reminder. Optional `meta`/`setRefs` to carry the linkage. Frame as **before-planning** (degraded in-crowd). *Accept:* close creates the meetup; offline create reconciles.
- **Crew logistics boards** — **budget = a `planned BOOLEAN` flag on `crew_expenses`** (NOT a new table; `getBalances` must exclude `planned=true`); **packing + carpool** = two new sub-resources cloning the poll/meeting-point pattern (tables + routes + `crewStore` optimistic-create + reconciler branches + `OFFLINE_ELIGIBLE_PATTERNS` entries + `partialize`). Sequence budget → packing → carpool; carpool deferrable. *Accept:* offline add reconciles with no dupes; planned expenses excluded from owed-amounts.

## 4. Milestone 3 — After-festival growth + retention loops (online OK)

*Signal is back; the offline tax disappears. Highest leverage per line. The expense bug flagged in the old audit is **already fixed** — settle-up builds on a sound ledger.*

- **Debt simplification + settle-up + payment links** — `simplifyDebts(balances)` greedy min-cash-flow **in integer cents** in `lib/db/stores/expenses.ts`; expose via a `settlement-plan` endpoint; **replace the broken `handleSettle` `Math.min()` heuristic** in `ExpensesTab.tsx` with netted "You pay {name} ${amt}" rows; `paymentLinks.ts` (Venmo/Cash App/PayPal deep links, https fallbacks). Needs **payment-handle storage** (migration: `venmo_handle`/`cashapp_cashtag`/`paypal_handle` on `users` + account-settings UI). *Accept:* ≤N−1 transfers, zero-sum cents, deep link prefilled.
- **Crew-aware wrap superlatives** — `ratings.getCrewWrap(crewId, festivalId)` aggregating `getCrewRatings` + expenses + picks (overlap matrix, sets-seen-together, total split, biggest spender, MVP); new `CrewWrapPoster` mirroring `WrapPoster.tsx` + the `wrap.tsx` share pipeline (`fonts.ready` + `html-to-image` `toBlob`). *Accept:* superlatives match hand-computed; 1080×1920 poster shares.
- **Reform crew for next festival** — crews are **festival-scoped**, so reform = create a new crew in the target festival + invite the prior roster (`POST /crews/:id/reform`); prefer invite+notify over silent add; optional `reformed_from` lineage column. *Accept:* one new crew, prior members invited, idempotent.
- **Cross-festival YoY history** — `getLifetimeStats(userId)` / `getAttendedFestivals(userId)` (drop the `festival_id` filter; needs a `set_ratings(user_id)` index); `GET /ratings/lifetime` + a profile "History" surface. *Accept:* lifetime totals = sum of per-festival stats.
- **Re-engagement triggers** — add `lineup_drop`/`crew_reformed`/`wrap_ready` to `ALLOWED_NOTIFICATION_TYPES` + `PREF_MAP` + prefs UI; wire triggers (festival-over → wrap_ready; lineup-import → lineup_drop to prior-year attendees; reform route → crew_reformed); email templates in `lib/email.ts`. **iOS APNs is already live** (shipped this session). *Accept:* once per user per event, respects prefs/DND. *Risk:* prior-year fan-out exceeds `MAX_PUSH_BATCH` (200) — needs a real queue, not the capped single call.

## 5. Milestone 4 — Spotify (before, online; build the OAuth surface once)

*Today Spotify is client-credentials only (`lib/spotify.ts`); **artist Spotify IDs are already stored** in `festival_sets.artists[].links.spotify` — the join key exists. Build #2 + #3 together on one PKCE module.*

- **Connect Spotify → auto-suggest picks** — Authorization Code **+ PKCE** (`lib/spotify-oauth.ts` + `routes/spotify-auth.ts`; scopes `user-top-read user-follow-read playlist-modify-*` requested together). New `spotify_accounts` table (refresh tokens **encrypted at rest** — reuse `calendar-tokens.ts`). `GET /spotify/suggestions/:festivalId` joins `/me/top/artists` + `/me/following` against the stored lineup artist IDs → confirm into must/want/maybe via `savePick`. Mobile uses `expo-auth-session` + `expo-web-browser` (managed; redirect `festie://spotify-callback`). *Risk:* Spotify app-review 25-user dev cap; mobile redirect must match dashboard; rate limits → server-side join + TTL cache.
- **Create playlist from picks** — `POST /spotify/playlist/:festivalId`: top-tracks per picked artist (bounded concurrency, dedupe) → create playlist → add tracks (≤100/req). Shares OAuth; guard against duplicate playlists.

## 6. Milestone 5 — Location redesign + P2P (offline-honest, never fake-live)

*Prereq: F4 (coords). The redesigns of the prior report's online-only traps — Apple Find My model: honest "as of N ago", never streamed live.*

- **Last-synced position + queued "on my way / ETA"** — new `crew_member_status` table + `routes/crew-status.ts` (`PUT/GET`), add `/crews/:id/status` to `OFFLINE_ELIGIBLE_PATTERNS` (deterministic clientId collapses toggles), `crewStore` status state + socket `crew:status-updated`, shared `etaMinutes` + `formatStaleness`. **Captured offline, delivered on a signal blip — UI must say "sent when signal returns / as of N ago", never imply live.** *Accept:* offline toggle queues + reconciles; receiver sees honest staleness.
- **Proximity compass** — `expo-sensors`/`expo-location` heading + shared `geo.ts` bearing/distance to a **saved meeting-point coord**; `MeetingPointCompass` (mobile-only — web has no reliable compass). Low-pass smooth the magnetometer. *Accept:* arrow points to the cached coord with zero network.
- **QR plan-snapshot share** — `expo-camera` (managed QR) + shared `planSnapshot.ts` (compact, versioned, **strictly Zod-validated untrusted input**, size-bounded); scan → import into local cache. *Accept:* two airplane-mode phones transfer the plan, no internet.
- **SMS handoff** — `expo-sms` opens the composer prefilled with meeting point + maps link; `isAvailableAsync` guard; honest "last resort, can't confirm delivery" copy. *Accept:* composer opens prefilled with data off.

## 7. Milestone 6 — Heavy / native (deferred until the cheap wins ship)

- **Offline map tiles** — **start with WebView + MapLibre GL JS + PMTiles** (`react-native-webview` already present → lowest Expo risk) or a static image overlay; treat **native `@maplibre/maplibre-react-native`** as a later fidelity upgrade. Needs **stage coords** (new migration or a festival map-config blob — stages have none today). Pins from F4 + stages; asset downloaded via F5. *Risk:* the heaviest Expo/native item.
- **iOS Live Activity / Android ongoing notification** — **Android ongoing notification ships now** (expo-notifications + local timer, on-device schedule + last-cached meeting point). **iOS Live Activity needs ActivityKit — a native config-plugin spike** (`expo-notifications` can't drive it); phase separately. Drive both from the on-device timed-set model, never push.
- **Crew photo wall** — **ship a link-out now** (`crews.photo_album_url` + paste a shared-album URL); full build later = **Cloudflare R2 presigned uploads + a SEPARATE media write-queue** (wifi-gated, isolated from the JSON queue so a stalled 8 MB upload can't block crew sync) + moderation/EXIF-strip. Gate Phase 1 behind product sign-off.
- **BLE local mesh** *(deferred moonshot)* — the only transport that delivers to another phone with no internet, but: `expo-nearby-connections` has **no iOS↔Android interop** (fatal for mixed crews); cross-platform needs **Bridgefy** (paid + a damning USENIX security record); iOS suspends BLE in background. A large native R&D bet, not a near-term promise. Revisit only if dense same-app venue adoption justifies it.

---

## 8. Cross-cutting reference

### Suggested migration sequence (assign final numbers at build time; next free is 042)
1. `crew_meeting_points` + `latitude`/`longitude` (F4) — mirror `022_festivals_geo.sql`
2. `spotify_accounts` (refresh-token store, encrypted)
3. `crew_member_status` (on-my-way/ETA; bump `crewStore` persist version + extend `migrate`)
4. `users` payment handles (`venmo_handle`/`cashapp_cashtag`/`paypal_handle`)
5. `crew_expenses.planned` + `crew_packing_items` + `crew_ride_offers` (logistics)
6. `stages` coords (or festival map-config) — for map pins
7. `crews.reformed_from` lineage (reform crew)
8. `set_ratings(user_id)` index (lifetime history scan)
9. notification-prefs columns for the 3 new re-engagement types
10. `crew_photos` (deferred, Phase 1 only)

All additive `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE` per the repo pattern; add FK indexes per the `_fk_indexes` convention. **Note:** prod migrations do NOT auto-apply reliably — see `[[deployment]]` (apply manually as part of deploy).

### New Expo deps (all need a dev-client/EAS build — Expo Go is insufficient; add config plugins to `app.json`, declare in `packages/mobile/package.json` per CLAUDE.md)
`expo-location` (F4 + compass + ETA) · `expo-sensors` (compass) · `expo-camera` (QR) · `expo-sms` (SMS handoff) · `expo-auth-session` + `expo-web-browser` (Spotify OAuth) · a QR-render lib (mobile) · later: MapLibre (native, optional). **No new native module is needed for the WebView map** (`react-native-webview` already present). All reusable logic (codecs, geo/ETA math, staleness) lives in `@festie/shared`.

### Shared modules to build once
`getSetTimeBounds` (F2) · `timeAgo`/`formatStaleness` · `geo.ts` (bearing/haversine/pixel) · `paymentLinks.ts` · `planSnapshot.ts` (QR/SMS codec) · `etaMinutes`.

### Top risks
- **F1 omission** silently empties 3 DURING crew features offline — do it first.
- **Never imply live delivery** for status/ETA/presence (the cardinal trap) — honest "as of N ago" everywhere.
- **SW cache isolation** — never add per-user endpoints to web `runtimeCaching` (cross-account leak).
- **Spotify**: app-review dev cap, mobile redirect exactness, refresh-token encryption, rate limits.
- **iOS Live Activity + native MapLibre + BLE mesh** are the only genuinely heavy/native items — phase them; ship the WebView/static/Android variants first.
- **Re-engagement fan-out** > `MAX_PUSH_BATCH` (200) needs a real queue.

### Build-order one-liner
**Foundations (F1–F5) → M1 (offline trust + during core) → M2 (before-planning) → M3 (after growth loops) → M4 (Spotify, parallelizable) → M5 (offline-honest location + QR/SMS) → M6 (map / Live Activity / photos / mesh, deferred).**
