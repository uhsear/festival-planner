# Festie Hardening Audit — 2026-05-30

> **SDK NOTE:** This audit was conducted against Expo SDK 54; the project is now on SDK 56, so some findings (including the SDK-54 framing on line 286) may no longer apply.

> **STATUS: ARCHIVED — all findings remediated (2026-05-30/31).** This document is a
> historical record of the audit process, not a list of open work. Every finding
> below (B-1 … K-7) was fixed on or shortly after the audit date; see the git
> history for the corresponding fix commits. The narrative is written in the
> present tense as of the audit; read it as a description of the *pre-fix* state.
>
> **Line-number citations refer to the pre-remediation source** and have since
> shifted as fixes landed — consult `git log`/`git blame` for current locations
> rather than the line numbers cited here.
>
> **Commit SHAs cited below predate a 2026-05-31 history rewrite** (`git filter-repo`,
> to scrub setup docs + an old server IP) and no longer resolve. The fixes remain in
> the current history under new hashes; use `git log`/`git blame` to locate them.

Synthesis of adversarially-verified findings across backend, web, mobile, shared, and toolchain. Every finding below was confirmed real against the source. Severities reflect post-verification ratings (several were downgraded from the original triage after evidence review).

---

## Executive summary

The single most damaging defect is a **critical correctness regression**: the expense create/settle Zod schemas type user IDs as `number`, but user IDs are `TEXT`. Every expense request from the real web and mobile apps fails `400` — the entire crew-expense feature is non-functional in production with no workaround. A companion **high** bug corrupts balances via string-concatenation on the `NUMERIC` `amount` column.

The next tier is **resilience and data-loss** on mobile: `checkSession` logs users out on any transient network blip at cold start (offline launch bounces an authenticated user to login), and mobile has **no offline write queue** despite the OfflineBanner promising sync-on-reconnect — offline picks/notes are silently lost while the UI shows them as saved.

The largest **toolchain blind spots** are that the mobile package and ~1,029 frontend+shared vitest cases are **never run in CI**, and the CI dependency-audit only covers the npm backend tree, leaving the entire React/Expo/RN graph unaudited.

Security findings are real but mostly **medium/low** hardening gaps (plaintext token in AsyncStorage, cacheable GDPR export, default-allow Spotify WebView, length-only password policy, web service-worker caching of per-user API responses). None is a remote, low-effort exploit.

Accessibility findings cluster on web navigation (a genuine **high** keyboard trap) and mobile auth-form labelling.

**Total findings: 37** (35 from the verified set, deduped to 33 distinct items, plus 2 net-new KNOWN-item fixes — Tailwind config, auth/me probe).

### Counts by severity

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High     | 6 |
| Medium   | 9 |
| Low      | 21 |

### Counts by surface

| Surface   | Count |
|-----------|-------|
| Backend   | 6 |
| Web       | 5 |
| Mobile    | 11 |
| Shared    | 8 |
| Toolchain | 7 |

(Cross-surface findings counted under their primary surface.)

---

## Deduplication note

Three pairs of findings describe the same root cause and are merged:

- **Mobile offline data loss** appeared twice (`festivalDataStore.offlinePut` mobile gap + `OfflineBanner` false promise). Merged into **M-1**.
- **checkSession network-error logout** appeared twice (correctness framing + resilience framing). Merged into **S-1**.
- **offlinePut bridge fallthrough (web pre-mount race)** is a near-unreachable special case of the missing-rollback bug; folded into **S-1**'s rollback remediation as **S-7**.

The two expense-schema findings (`splitWith`/`toUserId` types **B-1** and non-member validation **B-5**) are kept separate because B-5 is explicitly gated behind B-1 and is additive defense-in-depth.

---

## Backend

### B-1 — CRITICAL — Expense schemas use `number` IDs but user IDs are `TEXT`; every expense request 400s
- **Location:** `lib/schemas.ts:551` (`expenseCreateSchema.splitWith = z.array(z.number().int())`), `lib/schemas.ts:628` (`expenseSettleFullSchema.toUserId = z.number().int()`)
- **Problem:** `users.id` is `TEXT` (migrations/004:17), clients send string IDs (`packages/shared/src/types/domain.ts:218,223`), `validate()` uses `safeParse` with no coercion → 400 for every real expense create/settle. Even a numeric-looking ID would silently never subtract in `getBalances` (keys are TEXT). Crew expenses are 100% broken in prod.
- **Fix:** `splitWith → z.array(z.string().min(1)).min(1)`; `toUserId → z.string().min(1)`. No client change.
- **Risk:** Very low — matches the real contract and DB types; only unbreaks a broken path.
- **Auto-applyable:** ✅ Yes
- **Verify:** Add integration test POSTing a string-ID split asserting 201 + correct balances.

### B-2 — HIGH — `getBalances` string-concats `NUMERIC` amount; balances become NaN and non-zero-sum
- **Location:** `lib/db/stores/expenses.ts:116-139`
- **Problem:** node-postgres returns `NUMERIC(10,2)` as a JS **string**; `balances[paid_by] += exp.amount` concatenates (`0 + "10.00" → "010.00"`, second expense → NaN after `Math.round`). Separately, per-person share isn't cent-rounded so uneven splits ($10/3) aren't zero-sum. No `pg.types.setTypeParser` registered anywhere.
- **Fix:** Coerce once (`const amt = Number(exp.amount)`), work in integer cents, distribute remainder pennies, divide by 100 at return. Also fix `tests/stores-expenses.test.ts` to feed `amount` as a **string** (it currently feeds a number, hiding the bug) and add a $10/3 zero-sum case.
- **Risk:** Low — in-memory computation only; storage unchanged.
- **Auto-applyable:** ✅ Yes (code + test fixture together)

### B-3 — LOW — GDPR export response is cacheable (no `Cache-Control: no-store`)
- **Location:** `routes/account.ts:312-346` (`GET /account/export`)
- **Problem:** Sets only Content-Type + Content-Disposition; never calls `setNoStore`, unlike every sibling handler (avatar/username) and all of `routes/export.ts`. The body is the user's full PII dump. No global no-store middleware; helmet doesn't set noCache. Exposure = browser disk cache / shared-machine / intermediary proxy; mobile also writes it to OS cache dir.
- **Fix:** Add `setNoStore(res);` as first statement of the handler (already in scope at line 117). Optionally `X-Content-Type-Options: nosniff`.
- **Risk:** Negligible — header-only on a one-shot, rate-limited (1/24h) attachment.
- **Auto-applyable:** ✅ Yes

### B-4 — LOW — Password policy is length-only (8–100); no common/breached-password screen
- **Location:** `lib/helpers/validation.ts:36-39`; enforced `routes/auth.ts:165,510`, `routes/email-auth.ts:276`
- **Problem:** Accepts `password`, `12345678`. scrypt + login rate-limit + lockout (HTTP 423) blunt online brute force, but trivially weak/breached passwords remain guessable for targeted accounts and credential-stuffing.
- **Fix (NIST 800-63B-aligned):** Keep 8-char floor, **do not add complexity rules**. Add a bundled top-~1k common-password Set (O(1), case-insensitive, trimmed) and reject password equal-to/containing username or email local-part. Optional HIBP k-anonymity behind a flag, fail-open on network error. Apply at all 3 sites; mirror messaging in web/mobile validators (server authoritative). Add unit tests. Update weak test fixtures.
- **Risk:** Low — narrows accepted set only.
- **Auto-applyable:** ❌ No (needs the bundled list + fixture updates; product-visible messaging)

### B-5 — LOW — Expense `splitWith` members not validated as crew members; non-member shares silently dropped
- **Location:** `routes/expenses.ts:22-47` (create), `lib/db/stores/expenses.ts:122-132` (`getBalances`)
- **Problem:** `splitWith` accepted without checking each ID is a current member. `shareCount = splitMembers.length` counts non-members, but their share is never subtracted (guarded by `balances[uid] !== undefined`) → non-zero-sum. Most realistic trigger: a removed member on an old expense. **Gated behind B-1** (today integer IDs never match anyway).
- **Fix:** Land with B-1. In create, fetch crew member ID set once and 400 if any `splitWith` ID isn't a member; reject duplicates. In settle, validate `toUserId` is a member (and ≠ caller). Optionally cap `splitWith` at crew size. Defense-in-depth: have `getBalances` drop/redistribute shares for uids not in `memberIds` so legacy rows reconcile.
- **Risk:** Low — additive validation; client already sends current member IDs.
- **Auto-applyable:** ✅ Yes (the write-time validation), but only meaningful after B-1 lands.

### B-6 — LOW — `GET /profiles/:festivalId` realtime full-reload churn
- **Location:** `lib/db/stores/profiles.ts:60-68`, `routes/profiles.ts:25-50`, `packages/shared/src/hooks/useRealtimeSync.ts:96`
- **Problem:** `getByFestival` has no LIMIT and inlines every profile's picks/notes; clients never paginate; every socket event re-fetches + re-serializes ALL profiles. **Overstated claims refuted:** result is hard-capped at `MAX_PROFILES_PER_FESTIVAL=100` (config.ts:32, enforced at join) and `serializeProfileForViewer` already omits other users' notes (export-utils.ts:214-217) — no unbounded payload, no notes leak. Indexes adequate.
- **Fix:** Drop the LIMIT/projection work. Only fix the realtime layer: on single-profile socket events (`pick:updated`, `pick:removed`, `note:saved`, `picks:updated`, `profile:updated`) patch that one profile in place instead of full `loadProfiles()`; reserve full reload for `profile:joined`/`profile:left`. Optional belt-and-suspenders LIMIT.
- **Risk:** Low — client-only change to event handling.
- **Auto-applyable:** ❌ No (touches realtime sync behavior; needs verification)

---

## Web

### W-1 — HIGH — Primary navs use roving-tabindex with NO arrow-key handler (keyboard trap)
- **Location:** `BottomNav.tsx:149-191`, `SubHeader.tsx:126-160` (day tabs), `Header.tsx:188-212`
- **Problem:** All three declare `role="tablist"`/`role="tab"` with `tabIndex={active ? 0 : -1}` but no `onKeyDown` for Arrow/Home/End (grep: zero handlers). Keyboard users land only on the active tab; every other tab is `tabIndex=-1` and unreachable. WCAG 2.1.1 failure on the app's primary navigation. Also `aria-controls="main-content"` is invalid (`#main-content` is the app shell `<main>`, not a `tabpanel`).
- **Fix (Option B, lowest risk):** These are route/day navigations, not tab panels. Drop `role="tablist"`/`role="tab"`/`aria-controls`; use `aria-current="page"` on the active item; remove roving `tabIndex` so every button is naturally tabbable. SubHeader day tabs → toggle/radiogroup with `aria-current`. Update `Header.test.tsx`/`BottomNav.test.tsx`/`SubHeader.test.tsx` (they assert `getByRole('tab')`).
- **Risk:** Breaks role-based tests (must update); no visual change.
- **Auto-applyable:** ❌ No (changes ARIA contract + tests; semantic decision)

### W-2 — MEDIUM — Service-worker `StaleWhileRevalidate` caches authenticated, per-user `/api/v1/` responses
- **Location:** `packages/web/vite.config.ts:60-68` (`urlPattern /\/api\/v1\//`, SWR, maxEntries 100, 1h)
- **Problem:** SWR serves the cached copy first for every `/api/v1/` GET including `/auth/me`, `/crews`, `/profiles/:id`, `/account`. Workbox keys by URL only (ignores cookies), and logout never purges the SW cache. On a shared device, after account switch the first nav paints the **previous user's** data until the revalidate lands. Web-only (mobile uses bearer + no SW). **Mis-categorized as "performance" — it is a privacy/correctness bug.**
- **Fix:** Narrow `urlPattern` to public catalog endpoints only (e.g. `/\/api\/v1\/festivals(\/[^/]+)?$/`); exclude `/auth/`, `/profiles/`, `/crews/`, `/account/`. Add `cacheableResponse: { statuses: [0,200] }` and gate on `request.method === 'GET'`. On logout call `caches.delete('api-cache')`. **Do not** just switch to NetworkFirst — it still caches user-scoped responses.
- **Risk:** Medium — changes offline behavior for those endpoints; verify offline schedule viewing still works.
- **Auto-applyable:** ❌ No (interacts with offline UX product surface)

### W-3 — LOW — Stage filter renders multi-select toggles as `role="tab"` (invalid ARIA)
- **Location:** `SubHeader.tsx:176-200`
- **Problem:** Multi-select filter (`activeStages.includes`) but each chip is `role="tab"`/`aria-selected` in a `role="tablist"`. A tablist permits exactly one selected tab; multiple `aria-selected=true` confuses SRs. Chips are real `<button>`s so still operable — SR semantic confusion only.
- **Fix:** Container `role="group"` (keep `aria-label="Filter by stage"`); chips → `aria-pressed={isActive}`, remove `role="tab"`/`aria-selected`, drop the `(selected)` suffix. Day-tabs block unchanged. Update `SubHeader.test.tsx`.
- **Risk:** Low — no visual change; test update.
- **Auto-applyable:** ❌ No (ARIA contract + test change)

### W-4 — (covered by Known-benign) — `401 /api/v1/auth/me` console noise on guest load — see **K-5**.

### W-5 — (covered by Known-benign) — Tailwind v4 "content option missing or empty" — see **K-1**.

---

## Mobile

### M-1 — HIGH — Offline picks/notes silently lost; mobile has NO offline queue while banner promises sync
- **Location:** `packages/shared/src/stores/festivalDataStore.ts:13-22` (`offlinePut`), `OfflineBanner.tsx:49`, `app/set/[setId].tsx:210,222,265,275`
- **Problem:** `offlinePut` only queues when `window.__festieQueue` exists — that bridge is web-only (0 matches in `packages/mobile`). On RN it always falls through to `api.put`, which rejects offline. The store applies the optimistic change before the call and never rolls back; the set-detail screen swallows the rejection with `.catch(() => {})`. Persist partializes only `currentFestivalId`, so the star/note vanishes on next reload. Banner says "changes will sync when you reconnect" — false. Core festival use-case (spotty connectivity) makes this worse.
- **Fix (stage):** (1) **Now, zero-risk:** change mobile banner copy to not promise sync; stop swallowing offline write failures — surface a "Couldn't save — you're offline" toast and revert the optimistic store change (see S-1 rollback). (2) **Follow-up:** AsyncStorage-backed offline-queue adapter behind a `getStorage()`-gated bridge (mirror web's IndexedDB queue), drain on NetInfo reconnect. Check mobile `RatingButtons` for the same gap.
- **Risk:** Medium, product-facing — (2) is a real feature; (1) changes messaging.
- **Auto-applyable:** ❌ No

### M-2 — MEDIUM — Auth/session token persisted in plaintext AsyncStorage instead of secure storage
- **Location:** `packages/mobile/bootstrap.ts:9-12`, `app/_layout.tsx:31-43,57-60`
- **Problem:** `configureStorage(AsyncStorage)` makes the whole authStore (incl. `userToken`, the 64-hex full-access session credential, accepted as Bearer for delete-account/change-password/GDPR for up to 24h) serialize as plaintext JSON. No `partialize`. AsyncStorage is app-private but readable on rooted devices / ADB backup / forensic images. Platform offers Keychain/Keystore.
- **Fix:** Add `expo-secure-store`. `partialize` the authStore to exclude `userToken`/`adminToken` from AsyncStorage; write the token to SecureStore in login/register/refreshToken/logout; on cold start read via `getItemAsync` before `setAuthToken`. Migration: read old AsyncStorage token once, move to SecureStore, delete. SecureStore is async, ~2KB limit (fine for 64 chars). Web unchanged.
- **Risk:** Medium — must preserve the recently-fixed "persist login across restarts" behavior; needs migration + cold-start hydration verification.
- **Auto-applyable:** ❌ No

### M-3 — LOW — Spotify WebView allows arbitrary non-click navigations in-app (content-injection surface)
- **Location:** `app/set/[setId].tsx:422-444` (`onShouldStartLoadWithRequest`)
- **Problem:** Default-allow: only the exact embedUrl and click-navs to open.spotify.com are special-cased; everything else (`return true`) loads in-app regardless of origin. `originWhitelist` only gates the initial top-level load. **Risk is genuinely low** — embed is server-constructed first-party Spotify, and the WebView has **no** `injectedJavaScript`/`onMessage` bridge to abuse.
- **Fix:** Make it default-deny with a Spotify-host allowlist (`spotify.com`, `scdn.co`, `spotifycdn.com`): allow embedUrl + in-frame Spotify sub-nav; click on Spotify host → open externally; everything else → `openLink` + `return false`. Keep no bridge. Test track + artist embed playback (media loads from `*.scdn.co`).
- **Risk:** Low–medium — too-strict guard could block legit Spotify iframe nav; test playback.
- **Auto-applyable:** ❌ No (needs on-device playback verification)

### M-4 — MEDIUM — Auth form inputs labelled only via placeholder (no `accessibilityLabel`)
- **Location:** `app/(auth)/login.tsx:49-73`, `app/(auth)/register.tsx:63-110` (also `forgot-password.tsx:70`)
- **Problem:** Placeholders are an unreliable accessible name (vanish on input; inconsistent SR announcement). WCAG 4.1.2/3.3.2 gap on the auth gate. The team already labels password inputs in `AccountPasswordSection.tsx` — these screens just missed it.
- **Fix:** Add `accessibilityLabel` to each TextInput keeping `placeholder` as visual hint (Username/Password/Email/Confirm password). Extend to forgot-password email.
- **Risk:** None — additive props.
- **Auto-applyable:** ✅ Yes

### M-5 — LOW — Auth error messages not announced to screen readers
- **Location:** `login.tsx:47`, `register.tsx:61`, `forgot-password.tsx:68,86`
- **Problem:** Errors render as plain conditional `<Text>` with no `accessibilityLiveRegion`/`role="alert"`. `forgot-password.tsx:107` added it for the success box, proving the team knows the pattern. SR users get no feedback on failed submit.
- **Fix:** Add `accessibilityLiveRegion="assertive"` + `accessibilityRole="alert"` to each error Text.
- **Risk:** Very low — additive.
- **Auto-applyable:** ✅ Yes

### M-6 — LOW — Auth submit buttons don't expose role/busy/disabled state
- **Location:** `login.tsx:75-86,88-101`, `register.tsx:118,131`, `forgot-password.tsx` link wrapper
- **Problem:** Sign In / Create Account TouchableOpacity lack `accessibilityRole="button"` and `accessibilityState={{disabled,busy}}`; `<Link>` wrappers lack `accessibilityRole="link"`. WCAG 4.1.2. (`disabled={isLoading}` already prevents double-submit — SR announcement is the only real gap. forgot-password submit already has role+label, only missing state.)
- **Fix:** Add role/label/state per the `SetCardMobile.tsx` pattern; add `accessibilityState` to forgot-password submit; add `accessibilityRole="link"` + label to Link wrappers.
- **Risk:** Very low — additive.
- **Auto-applyable:** ✅ Yes

### M-7 — LOW — FestivalList cards expose no button role/state
- **Location:** `components/FestivalList.tsx:39-79` (FestivalCard), `:134` (retryButton)
- **Problem:** TouchableOpacity with `disabled={isSelecting}` but no role/composed label/state; name/date/location read as 3 fragments; chevron icon not hidden. `SetCardMobile.tsx` already implements the exact pattern — FestivalCard is the outlier.
- **Fix:** Add `accessibilityRole="button"`, `accessibilityState={{disabled: isSelecting}}`, composed `accessibilityLabel` (name, dateRange, location); hide decorative icons (`accessibilityElementsHidden` iOS + `importantForAccessibility="no-hide-descendants"` Android). retryButton → role + "Retry". Compute `formatDateRange` once.
- **Risk:** Low — additive; verify no double-read on device.
- **Auto-applyable:** ✅ Yes

### M-8 — LOW — SegmentedControl segments 36pt tall (below 44pt/48dp minimum)
- **Location:** `components/SegmentedControl.tsx:122-130` (`minHeight: 36`)
- **Problem:** Vertical touch target below Apple HIG 44 / WCAG 2.5.5. Horizontal is generous (`flex: 1`), so real miss-tap risk is modest. ARIA semantics correct.
- **Fix:** `minHeight: 36 → 44` (matches the app's 44/48 convention elsewhere). Avoid hitSlop (doesn't help low-vision precision).
- **Risk:** Low — ~6-8px taller.
- **Auto-applyable:** ❌ No (small visual change — design tolerance call). *Note: trivially safe; could be auto-applied if design sign-off isn't required.*

### M-9 — LOW — SetCardMobile not memoized; every pick/keystroke re-renders all visible cards
- **Location:** `components/SetCardMobile.tsx:105`; consumers `app/(tabs)/index.tsx:262-274`, `picks.tsx:160-171`
- **Problem:** Plain function component (no `React.memo`); inline arrow `onPickChange`/`onPress` props are fresh each render; `usePicks` recreates `getMyPick`/`getOtherPicks`/`getMyNote` on every `currentProfile` change; `savePick` sets a new `currentProfile`. A pick tap or keystroke re-renders all mounted (virtualized, ~8-15 onscreen, **not** 121) cards. Medium-light cards → noticeable jank on low-end Android, not catastrophic.
- **Fix:** (1) `React.memo` SetCardMobile + stabilize per-row callbacks (pass `setId` back so handlers can be hoisted); plain memo alone is defeated by the inline closures. (2) Stabilize `usePicks` callbacks / memoize `getOtherPicks` output per set (custom `areEqual` for `friendProfiles` array identity). (3) FlatList windowing props as starting guesses, not gospel. Profile before/after.
- **Risk:** Low-medium — changing `onPickChange`/`onPress` signature touches both call sites + component.
- **Auto-applyable:** ❌ No

### M-10 — LOW — Picks screen redundant `getMyPick` ×3 filter passes + `detectConflicts`
- **Location:** `app/(tabs)/picks.tsx:62-123`
- **Problem:** `rows` runs 3 `getMyPick` filter passes per day; `conflictIds` runs O(picked²) `detectConflicts`. Both recompute on pick toggle (dep churn), but guarded by `useMemo` (only on dep change, **not every render**) and the work is sub-ms at festival scale. Code-quality, not a perf defect.
- **Fix (optional, only if touching the file):** One pass reading `currentProfile?.picks` directly, bucketing into must/want/maybe, key memo on `currentProfile?.picks`. Leave `detectConflicts` as-is.
- **Risk:** Low — must preserve sort/tie-break.
- **Auto-applyable:** ❌ No (net-negative ROI standalone)

### M-11 — LOW — Spotify preview fetched on every set-detail open even when collapsed
- **Location:** `app/set/[setId].tsx:243-259` (fetch on mount), `415-446` (WebView gated)
- **Problem:** `GET /spotify/preview/:setId` fires on mount regardless of `spotifyOpen` (default false). WebView correctly deferred. **The fetch result is load-bearing:** the toggle button only renders when `spotify?.embedUrl` exists and its label comes from the fetch — so the proposed "defer to expansion" fix would break the affordance. Route is server-cached + rate-limited (60/min).
- **Fix:** Accept/close, OR split backend into a cheap DB-only "has preview" check for the button gate + lazy full-embed on expansion (more code, negligible gain). **Do not** move the fetch into the toggle handler.
- **Risk:** Low.
- **Auto-applyable:** ❌ No

---

## Shared

### S-1 — HIGH — `checkSession` logs user out on transient network errors (offline cold-start → login)
- **Location:** `packages/shared/src/stores/authStore.ts:164-178`; consumed `packages/mobile/app/_layout.tsx:79-96`
- **Problem:** Bare `catch` clears `user`/`isAdmin`/`userToken` for ALL failures. `apiRequest` throws `ApiClientError(status=0, isNetworkError=true)` on network failure. Offline cold start → `/auth/me` throws → AuthGate redirects an authenticated user to login, and the persisted token is wiped so reconnecting doesn't help. Web softens this via `RouteErrorBoundary`; mobile hard-redirects (worse). OfflineBanner promises offline support. (Merges the duplicate "expired vs outage" finding.)
- **Fix:** In the catch, import `ApiClientError` and only preserve session on `err.isNetworkError || err.status === 0`: `set({ sessionChecked: true }); return false;`. Genuine 401 still falls through to clear. Add regression tests for both branches (network → state intact; 401 → cleared). Add AppState 'active'/NetInfo reconnect re-`checkSession` so a session expired during an offline window is eventually cleared.
- **Risk:** Low — strictly more lenient on network errors; real 401 still clears.
- **Auto-applyable:** ✅ Yes

### S-2 — MEDIUM — Structured API error signal discarded; UI can't distinguish offline / 429 / 5xx / 4xx
- **Location:** `packages/shared/src/services/api.ts:124-156`; all store catches `set({error: err.message})`
- **Problem:** `ApiClientError` carries `isNetworkError`, `status`, `code`, `retryAfter`, but every store catch collapses to `err.message`. No consumer reads the rich fields (grep: 0); 429 `Retry-After` never honored. A network blip and a validation failure look identical.
- **Fix (additive):** Keep `error: string|null`, add `lastError: ApiClientError|null` set in catches. Add `mapErrorToUserMessage(err)` branching on `isNetworkError`/429/5xx/4xx. **Normalize `Retry-After`** — it may be delta-seconds OR HTTP-date; parse both, clamp, → ms (don't assume numeric). Export an `isApiClientError` guard. Optional exponential-backoff follow-up.
- **Risk:** Low-medium — touches several stores' error shape; do additively.
- **Auto-applyable:** ❌ No (multi-store shape change + UI work)

### S-3 — MEDIUM — Conflict detection ignores day; same clock-time sets on different festival days flagged as conflicts
- **Location:** `packages/shared/src/utils/conflicts.ts:12-50` (`detectConflicts`, `findAlternatives`)
- **Problem:** Compares only minutes-of-day; `FestivalSet.date`/`dayIndex` (domain.ts:55-56) unused (grep: 0 refs). `dayIndex` is reliably stamped (festivalDataStore.ts:110-111). Multi-day festival → 14:00 Fri and 14:00 Sat reported as conflict; set-detail offers a bogus "Switch" (`set/[setId].tsx:153-162,465-486`). False-positive warnings + wrong alternatives.
- **Fix:** Defensive day guard in both functions: `if (a.dayIndex != null && b.dayIndex != null && a.dayIndex !== b.dayIndex) continue;` (treat null as unknown → time-only fallback, preserving single-day + midnight-wrap tests). **Do not** hard-require dayIndex equality (breaks callers without it). Don't attempt cross-midnight-into-next-day overlap (out of scope). Add tests: same time/diff day → no conflict; same time/same day → conflict; findAlternatives excludes different-day sets.
- **Risk:** Low-medium — tightens to remove false positives.
- **Auto-applyable:** ✅ Yes

### S-4 — LOW — `checkSession` failure clears state token but not the in-memory bearer token
- **Location:** `packages/shared/src/stores/authStore.ts:164-178` vs `services/api.ts:35-55`
- **Problem:** Both non-success branches set `userToken: null` but never call `clearAuthToken()`, so `_bearerToken` / `window.__FP_BEARER_TOKEN` keep the stale token; subsequent requests still send `Authorization: Bearer <stale>`. `logout()` and `refreshToken()` catch already pair the two. Security framing is weak (token only resent same-origin, already rejected on genuine 401) — it's a state/client consistency bug.
- **Fix:** Add `clearAuthToken()` to both failure branches. Cleanest: factor a `clearAuthState()` helper used by logout, refreshToken-catch, and both checkSession branches. Land with S-1 (the network-vs-401 discrimination).
- **Risk:** Very low.
- **Auto-applyable:** ✅ Yes

### S-5 — LOW — Socket `connect_error` 401/403 permanently disconnects with no socket-initiated re-auth
- **Location:** `packages/shared/src/services/socket.ts:41-46`
- **Problem:** `disconnect()` on 401/403 stops reconnection (despite `reconnectionAttempts: Infinity`). Recovery depends entirely on an HTTP request triggering the refresh chain. If the socket 401s but no HTTP request fires, realtime silently stalls. **Low because** socket + HTTP share the bearer token, so an expired socket token almost always coincides with HTTP 401s (checkSession on foreground/hydration, the very reloads these events trigger). Graceful degradation, not crash/data-loss.
- **Fix:** After the auth-disconnect, emit a distinct local event / call an `onAuthError` callback passed to `createSocket` so the hook can set a 'reconnecting' UI state and call `refreshToken()` once (use a once-guard like `_refreshPromise`), then `socket.auth = ...; socket.connect()`. Keep refresh in the hook/store layer. At minimum add a Sentry breadcrumb. **Do not** reuse `configureApi.onUnauthorized` from `createSocket` (logout-on-transient risk + circular dep).
- **Risk:** Medium — avoid refresh storm.
- **Auto-applyable:** ❌ No

### S-6 — (covered by S-1) — `checkSession` expired-vs-outage. Merged.

### S-7 — LOW — `offlinePut`/optimistic mutations never roll back on failure (web pre-mount race + flaky-online)
- **Location:** `packages/shared/src/stores/festivalDataStore.ts:13-22`, savePick/removePick/saveNote
- **Problem:** Missing rollback fires on ANY failed mutation, not just the near-unreachable offline-no-bridge race. A flaky network while online produces the same lying UI. `RatingButtons.tsx` already rolls back via `onError(ctx.prev)`. Session-scoped (persist only stores `currentFestivalId`; refresh self-heals).
- **Fix:** Capture `const prev = get().currentProfile` before the optimistic `set`; in each catch `set({ currentProfile: prev, error: message })` then rethrow. Safe for web's queued path (successful `queueMutation` doesn't throw). Update the existing test that asserts the optimistic value stays on the offline-no-bridge path. This is the substantive fix; the typed-OfflineError refinement is secondary.
- **Risk:** Low — silent-loss → explicit-error; callers already catch.
- **Auto-applyable:** ✅ Yes

### S-8 — LOW — Conflict util lacks an all-TBA / scale guard test (test gap)
- **Location:** `packages/shared/src/utils/conflicts.test.ts`
- **Problem:** Correctness-only suite; no test pinning that an all-TBA festival (nc-2026, no set has start/end) → empty conflict set. The only protection is the `&& s.startTime && s.endTime` filter (conflicts.ts:16). **"O(n²) hot path" framing is inflated** — wrapped in `useMemo`, loop is bounded by picked+timed sets. Cheap, high-value regression guard against dropping that filter.
- **Fix:** Add (1) all-TBA picks → `getConflictingSetIds` size 0, `detectConflicts` []; (2) mixed timed+TBA → only timed overlaps reported. **Do not** add wall-clock timing assertions (flaky). No production change.
- **Risk:** Very low — additive test.
- **Auto-applyable:** ✅ Yes

---

## Toolchain

### T-1 — HIGH — Mobile package never built, typechecked, or linted in CI
- **Location:** `.github/workflows/ci.yml` (no `mobile` reference), `packages/mobile/package.json:12` (lint is `echo` stub)
- **Problem:** CI typechecks backend + web only; mobile (Expo SDK 54, 45+ TS/TSX files, 40 importing `@festie/shared`) has no gate. A TS error / broken import in `app/**` reaches main with zero signal until an EAS build or runtime crash. Recent history (Sentry plugin Android break, login-persistence fixes) shows active mobile work.
- **Fix:** (1) **Now:** add `mobile-typecheck` job — checkout, node 22, pnpm/action-setup v4, `pnpm install --frozen-lockfile` in `packages`, `pnpm --filter @festie/mobile typecheck` (script exists, passes locally). (2) **Follow-up:** add `eslint` + `eslint-config-expo`, replace the lint stub, wire into CI as non-blocking (`--max-warnings`) until backlog cleared. Defer `expo export`/`expo-doctor` to a separate workflow.
- **Risk:** Low-medium — may surface latent errors (the point); stage it.
- **Auto-applyable:** ❌ No (CI job add; may turn CI red first run — needs local green confirmation)

### T-2 — HIGH — CI never runs web (632) or shared (~397) vitest suites
- **Location:** `.github/workflows/ci.yml` (test job 42-101, quality 120-160)
- **Problem:** Both define `vitest run`; ~1,029 frontend+shared cases exist (authStore/crewStore/festivalDataStore/api/socket/conflicts/etc.). CI runs only the backend `node --test` suite, web lint/typecheck/build, Semgrep. A broken store/hook/component lands green. **Downgraded critical→high** (CI-process gap, not exploitable).
- **Fix:** Add a dedicated `frontend-tests` job: checkout, node 22, pnpm/action-setup v4, install in `packages`, `pnpm --filter @festie/shared test` then `pnpm --filter @festie/web test`. Add it to the `docker` job's `needs:`. (`vitest run` already exits non-zero; CI=true auto-set — no `--reporter=dot`/`CI=true` needed.)
- **Risk:** Low — additive; may surface pre-existing failures (run locally first to confirm green before making required).
- **Auto-applyable:** ✅ Yes (pure CI job addition; scripts exist)

### T-3 — MEDIUM — CI dependency audit covers only the npm backend tree; web/mobile/shared (pnpm) unaudited
- **Location:** `.github/workflows/ci.yml:110-119` (`npm ci` + `npm audit --audit-level=high`)
- **Problem:** Root is npm-managed backend (no `workspaces`); `npm audit` doesn't traverse `packages/` (pnpm). The largest attack surface (React/Expo/RN graph) gets zero CVE scanning. (`inflight` = 0 in root lock, 3 in pnpm lock — confirmed.) Semgrep scans `packages/` source but that's SAST, not a dependency advisory gate.
- **Fix:** Add a frontend audit step to the `security` job: pnpm/action-setup v4, `pnpm install --frozen-lockfile && pnpm audit --prod --audit-level=high` in `packages`. Use `--prod` (known deprecated transitives are dev-only). Start as `continue-on-error: true` for one cycle to baseline, or rely on `--prod` to avoid red-barring on dev advisories. Reuse the pnpm store cache.
- **Risk:** Low — additive; `pnpm audit` exits non-zero on any match (mitigate with `--prod` / advisory mode).
- **Auto-applyable:** ❌ No (CI behavior decision: blocking vs advisory)

### T-4 — LOW — `packages/shared` never typechecked/linted/tested in CI
- **Location:** `.github/workflows/ci.yml:151-155`; `packages/shared/eslint.config.mjs` exists but uninvoked
- **Problem:** Shared holds the stores/api/socket consumed by both clients. Web transitively typechecks shared code it imports, but mobile-only or unused-export paths get zero coverage. Scripts already exist.
- **Fix:** Add to quality job: `pnpm --filter @festie/shared typecheck`; to lint job: `pnpm --filter @festie/shared lint`. Optionally `pnpm --filter @festie/shared test` (covered by T-2's job). `--max-warnings=0` only if warnings should gate.
- **Risk:** Low — same first-run-red caveat.
- **Auto-applyable:** ✅ Yes (pre-existing scripts)

### T-5 — LOW — Two competing backend lockfiles tracked (npm `package-lock.json` + stale root `pnpm-lock.yaml`)
- **Location:** root `package-lock.json`, root `pnpm-lock.yaml`
- **Problem:** Both describe `festie@3.0.0`. CI/Docker use `npm ci`; root pnpm-lock is consumed by nothing and last touched in an old commit (orphaned). `package-lock.json` is the maintained source of truth. Latent drift if someone runs `pnpm install` at root. (The finding's "@sentry/node 10.52.0 vs npm" example is **false** — both currently resolve 10.52.0.)
- **Fix:** `git rm` the **root** `pnpm-lock.yaml` only (keep `packages/pnpm-lock.yaml`). Add `/pnpm-lock.yaml` (leading slash) to `.gitignore`. Optional `"preinstall": "npx only-allow npm"` in root package.json. Update the stale CI comment (~lines 135-136).
- **Risk:** Low — nothing installs from it.
- **Auto-applyable:** ✅ Yes

### T-6 — LOW — TypeScript version drift (backend 5.8 / mobile 5.9 / web+shared 6.0.3)
- **Location:** `package.json` ~5.8.0, `packages/mobile/package.json` ~5.9.3, `packages/web` + `packages/shared` ~6.0.3
- **Problem:** Shared source is typechecked by both web (6.0) and mobile (5.9). **"CI flakiness by ordering" is inaccurate** — CI runs only backend (5.8) + web (6.0); mobile/shared typecheck aren't in CI, and the jobs don't race over shared. All frontend tsconfigs set `skipLibCheck:true` + same strictness. Real residual risk = local-vs-CI divergence on genuine 5.9-vs-6.0 semantics. (typescript@6.0.3 is current `latest`, not beta.)
- **Fix:** Pin web + shared to `~5.9.3` (mobile's Expo-blessed line), relock `packages/`. **Do not** push mobile to 6.0 (Expo SDK 54 validates 5.9.x). Backend can stay 5.8 (shares no frontend source) or bump to 5.9.3 for consistency. Add mobile + shared typecheck to CI (T-1/T-4). Keep `skipLibCheck:true`.
- **Risk:** Low-medium — downgrading web/shared 6.0→5.9 could surface 6.0-only syntax.
- **Auto-applyable:** ❌ No (version decision + relock + verify)

### T-7 — LOW — OTA `runtimeVersion.policy = "appVersion"` couples native compat to a manual marketing version
- **Location:** `packages/mobile/app.json:10-15`, `eas.json:22-26`
- **Problem:** OTA delivered only to clients built from the same `expo.version` ("1.0.0"). `autoIncrement` bumps **build number**, NOT `expo.version` (finding's mechanism slightly wrong) — so `expo.version` is a static manual string. A native-surface change (Sentry plugin, FCM, SDK bump) shipped without bumping `expo.version` keeps the same runtimeVersion → OTA JS bundle assuming new native APIs delivered to incompatible native code → mismatch crash. Latent process risk, not an active bug.
- **Fix:** Switch to `{ "policy": "fingerprint" }` (SDK 54 + expo-updates ~29 support it) — runtimeVersion auto-tracks native compat (JS-only keeps fingerprint, native changes it). **Migration caveat:** first build after the switch establishes a new runtime namespace; existing clients stop getting OTA until a store build — coordinate with a release, verify via `npx expo-updates fingerprint:generate`. Or enforce a strict "native change → bump expo.version" rule (fingerprint removes the human-error dependency).
- **Risk:** Medium — one-time delivery discontinuity; product/release decision.
- **Auto-applyable:** ❌ No

---

## Known-benign resolution

Every triaged "benign/upstream/cosmetic/environmental" item, with an explicit verdict and concrete fix.

### K-1 — Tailwind v4 "content option missing or empty" despite `@source`
- **Verdict: REAL — fixable now.** `packages/web/src/styles/theme.css` uses the **split** entrypoints `@import "tailwindcss/theme.css"` + `@import "tailwindcss/utilities.css"` instead of the single `@import "tailwindcss"`. In Tailwind v4 the `@source` directive (and automatic content detection) is wired up by the **main** `tailwindcss` import; the split `theme.css`/`utilities.css` imports do not initialize the content/source pipeline the same way (and also skip `preflight`/base). That's exactly why the build warns "content option missing or empty" even though `@source "../**/*.{ts,tsx,js,jsx}"` is present.
- **Fix:** Replace the two split imports at the top of `theme.css` with the standard combined entry and keep the explicit source:
  ```css
  @import "tailwindcss";
  @source "../**/*.{ts,tsx,js,jsx}";
  ```
  If `preflight` was being intentionally omitted (the split was likely chosen to drop base resets), keep that intent explicitly instead of silently via split imports:
  ```css
  @import "tailwindcss" source(none);   /* or: layer(...) controls */
  @import "tailwindcss/preflight" layer(base);   /* re-add only what you want */
  @source "../**/*.{ts,tsx,js,jsx}";
  ```
  Verify the built CSS still contains the utilities actually used (grep the dist for a known class) and that the warning is gone. **Auto-applyable: ❌ No** — switching to `@import "tailwindcss"` re-enables preflight, which can change the rendered baseline; confirm visually first. The minimal, zero-visual-change variant is `@import "tailwindcss" source(none); @source "..."`.

### K-2 — Sentry-cli build WARN (token embeds `https://sentry.io`, config resolves `https://sentry.io/`)
- **Verdict: ALREADY RESOLVED — do NOT "fix".** Commit 4d1808a removed the `"url"` from the `@sentry/react-native/expo` plugin in `app.json` precisely to silence this trailing-slash WARN; the auth token already embeds the slug origin. The current no-url state is the fix. Re-adding `"url": "https://sentry.io"` (the naive remediation) would **reintroduce** the warning.
- **Fix:** None for the WARN. The **only** warranted change is correcting the now-false comment in `app/_layout.tsx:18-21` (which still claims the Sentry Expo plugin is "intentionally NOT in app.json yet" — it IS configured since commit 28f4df7, with source-map upload wired via `scripts/install-sentry-cli.cjs` + `SENTRY_AUTH_TOKEN` EAS env secret). **Auto-applyable: ❌ No** (the build is functional; the comment fix is doc-only and low priority, but touches a file with a credential/gating context worth a human glance).

### K-3 — RN/Android Gradle deprecation warnings (`onCatalystInstanceDestroy`, etc.)
- **Verdict: GENUINELY UPSTREAM / NOT LOCALLY FIXABLE.** `onCatalystInstanceDestroy` appears in 0 JS/TS source files; it's compiled into RN core / prebuilt AARs and autolinked native modules (react-native-screens ^4.16, reanimated ~4.1.7, react-native-webview 13.15). No `android/` is checked in (managed Expo; `/android` gitignored) — any local patch is overwritten on prebuild/EAS. These are cosmetic deprecation warnings (New-Architecture bridge transition), not on any build-failure path (no `-Werror`/`abortOnError`/`lintOptions` in CI or eas.json).
- **Fix (mitigation, tracking-only):** (1) Do **not** add `-Werror`/`abortOnError` to generated Gradle. (2) Keep deps current via `npx expo install --check` so New-Arch-clean releases land. (3) Optional `--warning-mode=summary` to cut log noise. (4) Track via a low-priority upstream-tagged issue; close on the SDK bump that drops the legacy symbols. **Auto-applyable: ❌ No** (no code change; `expo install --check` rides a normal build + smoke test).

### K-4 — Deprecated transitive subdeps: glob, rimraf, inflight, uuid, source-map, sourcemap-codec
- **Verdict: SPLIT.** `glob`/`rimraf`/`inflight`/`source-map`/`sourcemap-codec` are **genuinely benign** — dev/build-time tooling (Metro/webpack-era), deprecated-not-vulnerable, mostly unfixable upstream. But **`uuid` is NOT benign**: `uuid <11.1.1` has GHSA-w5hq-g745-h8pq (CWE-787 OOB write, CVSS 7.5) entering via `firebase-admin ~13.9.0 → @google-cloud/{storage,firestore} → gaxios/teeny-request → uuid@8.3.2/9.0.1`. **However** the vulnerable code path (v3/v5/v6 with an undersized caller buffer) is unreachable here — google-gax uses `v4()`, no app code passes attacker-controlled buffers; npm normalizes it to **moderate**. Also `protobufjs <=7.5.7` (GHSA-jggg-4jg4-v7c6 DoS) and `qs` via the same firebase chain.
- **Fix:** Dependency-hygiene, not an incident. `npm update firebase-admin` is a **no-op** (`~13.9.0` pins 13.9.x; storage 7.x still pins `uuid:^8`). Use overrides in root `package.json`:
  ```json
  "overrides": { "uuid": ">=11.1.1", "protobufjs": ">=7.5.8" }
  ```
  Then `npm install` and run `tests/notifications-send.test.ts` + a real FCM smoke send (uuid 8/9→11 is a major bump under packages requesting ^8/^9; the v3/v4/v5/parse/stringify surface is compatible). **Do not** override `qs` (also pulled by express; leave to the express line). Update the stale `docs/DEPENDENCIES.md`. **Auto-applyable: ❌ No** (major-ish uuid bump inside firebase internals — run notification suite before deploy).

### K-5 — Web console `401 /api/v1/auth/me` on guest load
- **Verdict: EXPECTED / BENIGN — but the noise is avoidable.** Cookie-mode session probe: on guest load `checkSession()` calls `GET /auth/me` (`authStore.ts:166`), the server returns 401 (no session cookie), the `catch` clears state and renders the guest UI. This is correct behavior; the 401 is a normal probe. Note `api.ts` excludes `/auth/` from the onUnauthorized refresh chain, so it does **not** trigger a logout loop. The only cost is a red line in the console (and a Sentry breadcrumb if configured).
- **Fix (cosmetic, optional):** Two clean options. (a) **Suppress the console error at the source:** in the api client, don't `console.error` for an expected 401 on `/auth/me` (treat the session-probe 401 as a normal outcome, not an error log). (b) **Skip the probe when there's no plausible session:** in cookie mode, only call `/auth/me` if a session-presence hint exists (e.g. a non-HttpOnly `fp_has_session` flag the server sets on login), otherwise go straight to guest. (a) is the lower-risk, smaller change. **Auto-applyable: ❌ No** (behavioral/log-policy change; verify it doesn't mask real auth errors). Acceptable to **accept as-is** — it is purely cosmetic.

### K-6 — Backend integration tests require `TEST_DATABASE_URL` (fail locally, pass in CI; no documented local setup)
- **Verdict: REAL DX GAP — fixable with docs + a helper, no code change.** Confirmed: `tests/_integration-helpers.ts:28-29` hard-requires `TEST_DATABASE_URL` and `process.exit(1)` if unset (intentional safety: never falls back to `DATABASE_URL`). ~20 test files depend on it. CI provides it; there's no documented local path.
- **Fix:** (1) Add a `docs/TESTING.md` (or a section in `docs/configuration.md`) documenting local Postgres setup: a one-line `docker run` for a throwaway Postgres, the migration command, and `export TEST_DATABASE_URL=postgres://...localhost.../festie_test`. (2) Add an npm script `test:db:up` (docker compose service for a test DB) + `test:integration` that sets the env. (3) Optionally make the guard message print the exact docker command. Keep the no-fallback safety. **Auto-applyable: ❌ No** (docs + tooling; small but a deliberate addition). This unblocks local integration testing, which also lowers the risk of the untested endpoints (B-1, locate-set) shipping broken.

### K-7 — Root `.npmrc ignore-scripts=true` + `packages/.npmrc onlyBuiltDependenciesFile:""` (pnpm v10 build-script gating)
- **Verdict: REAL but LOW / mostly intentional — one concrete cleanup.** Confirmed contents: root `.npmrc` = `ignore-scripts=true` (backend installs via npm with scripts disabled — this is why `scripts/install-sentry-cli.cjs` runs via the explicit `eas-build-post-install` hook rather than a postinstall). `packages/.npmrc` = `onlyBuiltDependenciesFile: ""` (empty string). The empty `onlyBuiltDependenciesFile` is harmless/no-op, but it pairs with the **separate** malformed root `pnpm-workspace.yaml` `allowBuilds` block containing literal placeholder strings (`sharp: set this to true or false`, etc.) — and `allowBuilds` is **not a valid pnpm key** (pnpm uses `onlyBuiltDependencies`), so pnpm ignores the entire block. The real `packages/pnpm-workspace.yaml` correctly uses `onlyBuiltDependencies: ["@sentry/cli"]`. Net: build-script gating is NOT in an unintentional state — the malformed block is inert and the root pnpm workspace is never installed from.
- **Fix:** (1) Delete the vestigial root pnpm footprint: remove the bogus `allowBuilds` block from root `pnpm-workspace.yaml` (or delete the whole root `pnpm-workspace.yaml`, since the real workspace is `packages/`), and remove the orphaned root `pnpm-lock.yaml` (same as **T-5**). (2) Leave `packages/.npmrc onlyBuiltDependenciesFile: ""` and root `ignore-scripts=true` as-is — both are intentional and correct (the Sentry CLI build is handled by `packages/pnpm-workspace.yaml onlyBuiltDependencies` + the EAS hook). (3) Update the stale CI comment about root `pnpm-workspace.yaml`. **Do not** "fix" by adding booleans under `allowBuilds` — that key is invalid. **Auto-applyable: ✅ Yes** (deleting inert/vestigial config is strictly an improvement; confirm `simple-git-hooks` still installs its hook and `sharp` still loads — both use prebuilt binaries / are gated in the real workspace).

---

## Prioritized action checklist

### Auto-applyable now (low-regression, no product decision)

1. **B-1** (CRITICAL) — expense schema string IDs (`lib/schemas.ts:551,628`). Unbreaks all crew expenses. + integration test.
2. **B-2** (HIGH) — `getBalances` integer-cents fix + string `amount` test fixture (`lib/db/stores/expenses.ts:116-139`).
3. **S-1** (HIGH) — `checkSession` preserve session on network error (`authStore.ts:164-178`) + regression tests.
4. **T-2** (HIGH) — add `frontend-tests` CI job running web + shared vitest; add to docker `needs:`.
5. **S-3** (MEDIUM) — day-guard in `detectConflicts`/`findAlternatives` (`conflicts.ts`) + tests.
6. **B-3** (LOW) — `setNoStore(res)` on GDPR export (`routes/account.ts:313`).
7. **B-5** (LOW) — expense `splitWith`/`toUserId` member validation (after B-1).
8. **S-4** (LOW) — `clearAuthToken()` in both `checkSession` failure branches (with S-1).
9. **S-7** (LOW) — optimistic-mutation rollback in savePick/removePick/saveNote.
10. **S-8** (LOW) — all-TBA conflict test.
11. **M-4** (MEDIUM) — `accessibilityLabel` on auth inputs.
12. **M-5** (LOW) — live-region/alert on auth error Texts.
13. **M-6** (LOW) — role/state on auth buttons + link roles.
14. **M-7** (LOW) — role/state/label on FestivalList cards.
15. **T-4** (LOW) — add shared typecheck + lint CI steps (pre-existing scripts).
16. **T-5** (LOW) — remove orphaned root `pnpm-lock.yaml` + `.gitignore`.
17. **K-7 / vestigial pnpm** (LOW) — delete the invalid root `allowBuilds` block + root pnpm-workspace.yaml.

*(Items 4, 15 may turn CI red on first run if pre-existing failures exist — run the suites locally to confirm green before making the check required. Otherwise pure additions.)*

### Decisions needed (product/design/release sign-off, or on-device verification)

- **T-1** (HIGH) — add mobile typecheck/lint CI (may surface latent errors; stage).
- **W-1** (HIGH) — fix keyboard trap in nav (ARIA contract + test changes).
- **M-1** (HIGH) — mobile offline queue + honest banner copy (feature scope).
- **M-2** (MEDIUM) — move token to SecureStore (migration + hydration verify).
- **W-2** (MEDIUM) — narrow SW api-cache + purge on logout (offline UX).
- **S-2** (MEDIUM) — structured error mapping across stores (multi-store shape change).
- **T-3** (MEDIUM) — frontend pnpm audit in CI (blocking vs advisory decision).
- **B-4** (LOW) — common/breached password screen (bundled list + messaging).
- **M-3** (LOW) — Spotify WebView allowlist (on-device playback test).
- **M-9** (LOW) — SetCardMobile memoization (prop-signature change; profile).
- **T-6** (LOW) — TS version alignment (relock + verify).
- **T-7** (LOW) — OTA `fingerprint` policy (release coordination).
- **B-6** (LOW) — profiles realtime patch-in-place (verify).
- **S-5** (LOW) — socket-initiated re-auth (avoid refresh storm).
- **M-8** (LOW) — SegmentedControl 44pt (design tolerance; trivially safe).
- **M-10 / M-11** (LOW) — picks redundancy / Spotify prefetch — accept or fold into adjacent work.
- **K-1** (Tailwind) — switch to `@import "tailwindcss"` (visual confirm) or zero-change `source(none)` variant.
- **K-2** (Sentry) — fix stale comment only; do NOT touch the (resolved) WARN.
- **K-3** (RN/Gradle) — tracking-only; `expo install --check` on a normal build.
- **K-4** (uuid/protobufjs) — overrides + FCM smoke test.
- **K-5** (auth/me 401) — accept as-is, or suppress the console error.
- **K-6** (TEST_DATABASE_URL) — add local DB docs + `test:db:up` helper.
