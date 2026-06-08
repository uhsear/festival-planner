This is a synthesis task — I have all the inputs (capability map + 113 findings) inline. No file exploration needed; I'll dedupe across screens and produce the roadmap directly.

# Festie — Post-SDK-56 Implementation Roadmap

Synthesized from the SDK-56 capability map + 113 per-screen findings, grounded in the installed Expo skills. Items are deduped across screens (one canonical entry per capability). Every item cites a `file:line` and a skill/source.

---

## 1. REQUIRED for SDK 56 correctness (not optional)

These are deprecated/broken/risky under SDK 56 and must change. Split into **must-edit code** (real bugs / removed APIs) and **must-verify** (engine/arch swaps that need a device smoke test, no code change).

### 1a. Must-edit code

| # | Issue | File:line | Fix | Skill / source |
|---|-------|-----------|-----|----------------|
| R1 | `expo-image-picker` `MediaTypeOptions` is **removed** in SDK-56-era versions. Current code reads `picker.MediaTypeOptions?.Images`, which is now `undefined` — it silently passes `mediaTypes: undefined`. Local interface is wrong. | `AccountAvatarSection.tsx:42-45, :89` | Drop `MediaTypeOptions` from the local module interface; call `launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing:true, aspect:[1,1], quality:0.8 })`. Re-test avatar upload on a real build. | docs.expo.dev/versions/latest/sdk/imagepicker; expo-upgrading-expo |
| R2 | iOS Live Activity countdown is **frozen** — the 60s refresh interval is Android-gated, so on iOS `now` never advances; "Next in 25m" goes stale and Next→Now never flips. Most user-visible iOS bug in the area. | `hooks/useOngoingNotification.ts:101-105` | Remove the `Platform.OS !== 'android'` part of the guard (or add a parallel iOS interval) so iOS gets the same on-device tick. Pair with R3. | expo widgets docs (`update()`); ongoingNotification.ts:207-219 |
| R3 | iOS Live Activity effect has **no signature guard** — once R2's tick is on, `model` is a fresh memo each tick and `instance.update` fires every 60s even when title/body are unchanged. | `hooks/useOngoingNotification.ts:178-185` | Mirror the Android `lastShownRef` pattern (140-171): compare `${model.title} ${model.body}`; only `update` on change, `end` only on active→inactive. | expo widgets docs; useOngoingNotification.ts:138-160 (template) |
| R4 | Notification handler globally suppresses sound (`shouldPlaySound:false`) for **all** foreground notifications — so time-critical local set reminders (scheduled with `sound:true`) fire silently when foregrounded. | `hooks/useMobilePush.ts:12-19` (vs useLocalReminders.ts:163) | If reminders should chime, branch in `handleNotification` on `data.kind === 'local-set-reminder'` → `shouldPlaySound:true`. Also move `setNotificationHandler` to `app/_layout.tsx` so its app-global scope is explicit. Confirm intent first. | docs.expo.dev/.../notifications (setNotificationHandler) |
| R5 | Six crew primary CTAs use `accent.coral` fill + white text — **fails WCAG AA** (~3.55:1; CrewSos documents this exact failure and uses `coralStrong` ~6.04:1) **and** violates the coral=danger-only accent rule. (Same root cause grouped with the design P0s; listed here because it's a measured a11y failure.) | `CrewExpenses.tsx:793`, `CrewPolls.tsx:585`, `CrewMeetingPoints.tsx:421`, `CrewStatus.tsx:536`, `CrewRides.tsx:281`, `CrewPacking.tsx:232` | Switch fill to `accent.aqua` + `text.onLightAccent` (the pattern crew.tsx:1088-1099 already documents). Reserve coral/coralStrong for SOS + destructive. | CrewSos.tsx:276-279,300-302 (in-repo AA math); WCAG 1.4.3 |
| R6 | Forgot-password "Send reset link" CTA uses `accent.coral` + `text.onAccent` — **fails AA** and breaks the accent rule. The only off-pattern auth CTA (login/register correctly use aqua). | `app/(auth)/forgot-password.tsx:199-204,208-212` | Change fill to `accent.aqua`, label to `text.onLightAccent` (#080810), matching login.tsx:235 / register.tsx:348. | `@festie/shared/tokens/colors.ts:29-48`; design-review memory P0 |

> **Note on R5/R6:** these are simultaneously a11y failures *and* design-rule violations. They are listed as REQUIRED (measured WCAG AA failure on a shipping CTA), not "polish." The fix is one style-block change each.

### 1b. Must-verify (engine/New-Arch swaps — smoke-test on a real device/TestFlight, no code change)

RN 0.85 under SDK 56 is **New-Architecture-only** (no bridge). Run `npx expo-doctor` after install to confirm every native dep is New-Arch compatible and on the SDK-56-recommended version, then smoke-test these surfaces:

| # | Surface | File:line | What to verify | Source |
|---|---------|-----------|----------------|--------|
| V1 | MapLibre WebView (the single most New-Arch-sensitive dep) | `OfflineMap.tsx:82-84,390-393,521,530`; `app/map.tsx`; `set/[setId].tsx:14,457-484` | map mount → `ready` → `window.__festieSetPeers` peer/SOS pins; `injectJavaScript`/`onMessage` round-trips; Spotify embed playback + external-link handoff. Keep `react-native-webview` as an **explicit dep** (do NOT assume `@expo/dom-webview` covers direct imports). **Also harden:** maplibre 4.7.1 is loaded unpinned-integrity from unpkg — add an SRI `integrity` attr (CSP already allows unpkg). | required-changes-deprecations map; expo-upgrading-expo |
| V2 | `react-native-view-shot` poster capture | `app/wrap.tsx:127-133, 449-455` (off-screen `collapsable=false` Views :326-342, :596-604) | Both personal + crew PNG capture/share on real Android (the `collapsable=false` path is the Android risk) and iOS. | required-changes-deprecations (view-shot 5.x New-Arch major) |
| V3 | `expo/fetch` is now the **default global fetch** (WinterTC). All `@festie/shared/services/api.ts:323` calls ride it. | api.ts:318-343; crew SOS `CrewSos.tsx:88-94`; offline write-queue; 401-refresh | Most-likely diff is **abort/timeout + network-error classification**: verify SOS-offline still hits `err.isNetworkError || status===0` → "No signal — SOS NOT sent"; offline queue replay; 429 `Retry-After`; checkSession 15s abort. Keep `EXPO_PUBLIC_USE_RN_FETCH=1` as a one-line rollback — do **not** set preemptively. | expo-native-data-fetching; changelog/sdk-56 |
| V4 | crew-compare nested horizontal-ScrollView-over-FlatList (measurement-sensitive) | `crew-compare.tsx:165-252` | Vertical scroll works while column header stays put; the `flex:1` viewport hack survives New-Arch measurement. | required-changes-deprecations (New-Arch measurement) |
| V5 | `ChannelAwareTriggerInput` `as` cast bypasses typecheck | `useOngoingNotification.ts:68` | Confirm ongoing notification still presents immediately on the LOW channel (no heads-up/sound each refresh). If TS6 flags it, drop the cast for the SDK-56-correct trigger shape. | docs.expo.dev/.../notifications |
| V6 | `end()` `dismissalPolicy` typed as plain `string` | `lib/liveActivity.ts:24,63` | Type-only hardening: narrow to `'default' \| 'immediate'`. Behavior already correct. | expo widgets docs |

**Must-run, but already clean (verify-and-move-on):**
- **expo-router v6 / react-navigation decoupling codemod** — run `npx expo-codemod sdk-56-expo-router-react-navigation-replace packages/mobile` then `pnpm --filter @festie/mobile typecheck`. Festie already imports from `expo-router`, so expect ~no rewrites; the one thing to check is any `@react-navigation/native` theme import (the ThemeProvider flicker fix). (navigation-native-ui map)
- **Hermes v1 / React 19.2 / Android edge-to-edge** — no code change; inherited. Just keep `@types/react ~19.2.17` aligned across workspaces and re-run the Android one-top-inset check post-build. (required-changes-deprecations map; commit 4054628)
- **`@expo/vector-icons` deprecation** — **DO NOTHING this upgrade.** Keep `^15.1.1` as an explicit dep (removing it breaks 53 files). Still functional in 56. Defer the `@react-native-vector-icons` codemod to a dedicated PR. (See §4.)
- **`eslint-config-expo` React-Compiler rules** — **keep at `warn`** (eslint.config.js:17-21). Do not flip to error or enable `experiments.reactCompiler` in this change. Backlog: fix `set-state-in-effect`/ref-write-during-render hot spots (`CrewLiveLocation.tsx:133`, crew.tsx:148/155, useNowIndicator.ts:64, MeetingPointCompass.tsx:115/151) *before* ever enabling the compiler.
- **`android.predictiveBackGestureEnabled:false`** — leave as-is (app.json:54).
- **`expo-file-system`** — already on the modern `File/Paths` API; no `copy()/move()` usage. No change.
- **Notification `sticky/priority/sound` content+channel duplication** (`useOngoingNotification.ts:43-70`) — **correct & supported in 56; preserve.** (positive)

---

## 2. HIGH-VALUE native modernization (ranked)

Effort: **S** ≤ ½ day · **M** 1–3 days · **L** multi-day/structural. All require a **native build** unless noted OTA-able.

> **Cross-cutting prerequisite (do first if pursuing native nav):** Festie's app code already imports from `expo-router`, but `find`/`map`/`compass` aren't registered as `Stack.Screen` entries (`app/_layout.tsx:232-241`), and there are no per-tab nested Stacks — so native headers/search/toolbars/formSheet have nowhere to attach. **N0 below is the enabler for N2/N3/N5/N6.**

| Rank | Item | What to change | Payoff | Effort | Build | Skill |
|------|------|----------------|--------|--------|-------|-------|
| **1** | **N1 — Migrate JS `<Tabs>` → `NativeTabs`** (single item for all 4 tabs) | `app/(tabs)/_layout.tsx:25-104`: map each `Tabs.Screen` → `<NativeTabs.Trigger>` with `.Icon` (sf `calendar/star/people/person` + md), `.Label`, `tintColor=accent.aqua`. **Delete** `tabBarBottomInset` math + hand-built `tabBarStyle`. Relaxes the `overflow:'hidden'` clip at index.tsx:686-689. `_layout.web.tsx` split keeps JS tabs on web. Optional Crew `Trigger.Badge` for open polls/unsettled. | Native iOS liquid-glass / Android Material 3 bar **for free**; deletes the manual safe-area workaround (directly furthers commit 4054628's "one top-inset per screen" pass). | M | native | tabs.md; docs.expo.dev native-tabs |
| **2** | **N0 — Per-tab nested Stacks + register pushed routes** (structural enabler) | Give each tab its own Stack (e.g. `(tabs)/(schedule)/_layout.tsx`); move shared `set/[setId]`, `find`, `map`, `compass` into array-route groups; register `find/map/compass` as explicit `<Stack.Screen>` in `app/_layout.tsx:232-241`. | Unlocks N2/N3/N5/N6 (native headers, search, toolbars, formSheet). Largest scope but the gate. | L | native | route-structure.md |
| **3** | **N2 — Native header search bar** (`headerSearchBarOptions`) | Schedule: replace the ~40-line custom search row `index.tsx:453-477,718-738` with `Stack.Screen options.headerSearchBarOptions` (placeholder "Search artists or stages", `onChangeText→setSearchQuery`, `hideWhenScrolling`). Use the skill's `useSearch()` hook; keep store as source of truth; web keeps inline `TextInput`. | Native scroll-collapsing search; deletes custom chrome. Strongest single search target. Depends on N0/native header. | M | native | search.md; toolbar-and-headers.md |
| **4** | **N4 — `set/[setId]` → `presentation:'formSheet'` with detents** (single canonical formSheet item) | `app/_layout.tsx:235-238`: change `'modal'`→`'formSheet'`, `sheetAllowedDetents:[0.5,1.0]`, `sheetGrabberVisible:true`. Delete hand-rolled drag handle (set/[setId].tsx:362, styles:708-716). | Real native grabber + peek/expand; deletes faux handle. Lowest-risk native win (presentation already in use). | S | native | form-sheet.md |
| **5** | **N5 — `compass` as formSheet over the map** (`sheetLargestUndimmedDetentIndex`) | Register `/compass` (N0) with `presentation:'formSheet'`, detents `[0.5,1.0]`, `sheetLargestUndimmedDetentIndex:1` so the arrow+distance peeks while the map stays pannable. The skill's textbook example. | Native "detail over a live map" UX for the find-each-other flow. | M | native | form-sheet.md |
| **6** | **N6 — Replace custom segmented controls with `@expo/ui` segmented `Picker`** (ONE item across all screens) | Swap to `@expo/ui` segmented `Picker` under `<Host matchContents>` for: `SegmentedControl.tsx` (Schedule Timeline/Cards), `CrewExpenses.tsx:204-230,240-259`, `CrewStatus.tsx:208-230`, `picks.tsx:353-375` (bulk priority), `wrap.tsx:292-309` (You/Crew), `plan-share.tsx:47-71` (3-tab). `@expo/ui ~56.0.16` is **already a dep** (Live Activity) → zero new native deps. Deletes ~130 lines of bespoke Reanimated + manual haptics. | Native styling/haptics/dark-mode/a11y for free across 6 sites. **Trade-off:** native segmented control resists custom color → loses aqua/coral active tint (`controls.md`: "avoid custom colors") — weigh per surface. | M | native | controls.md; expo-expo-ui-swift-ui (Host). **Fetch SDK-56 Picker docs first — skill is v55-pinned.** |
| **7** | **N3 — Header/overflow actions → `Stack.Toolbar`** (now Android too) | Move ad-hoc body chips to native toolbars: Schedule "Switch"/"Now & Next" `index.tsx:568-600`; picks "Add to calendar"/"Share" `picks.tsx:300-316,421-430`; set-detail Share `set/[setId].tsx:363-373`; crew owner/destructive actions `crew.tsx:718-832,581-607` → `Stack.Toolbar.Menu` (destructive `MenuAction`); map recenter/freshness `map.tsx:78-80`. | SDK 56 adds **experimental Android** toolbar with the same API → cross-platform (Festie ships Android-first). Cleaner bodies, native sizing. Depends on N0/native headers. | M | native | toolbar-and-headers.md; changelog/sdk-56 |
| **8** | **N7 — `<Link>` + `Link.Preview`/`Link.Menu` on set rows** (ONE refactor pattern) | Convert set-row `TouchableOpacity + router.push` → `<Link href asChild>` + `Link.Trigger` + `Link.Preview` (peek set detail) + `Link.Menu` (Must/Want/Maybe, Share, reminder) at: `SetCardMobile.tsx:182-222`, `TBASection.tsx:82-100`, `picks.tsx:239-250`, `festival-mode.tsx:88-131`, `find.tsx:65-134` (meeting-point rows → "Point compass / Show on map / Copy coords"). | iOS peek + native quick-actions the app **lacks entirely**. Mechanical but moderate. | M | native | SKILL.md (Context Menus / Link Previews) |
| **9** | **N8 — EAS Update Insights crash gate on every OTA** (CI, OTA-able) | Add a follow-up job to `mobile-ota.yml` running `eas update:insights $GROUP_ID --days 1 --json` after a delay; fail/alert if `crashRatePercent > threshold`. Use `eas channel:insights --channel production --runtime-version <appVersion>` for embedded-vs-OTA reach. **Gotcha:** runtime is the **appVersion string** (e.g. `1.1.0`), not a fingerprint. | Free crash-rate guard on Festie's OTA-first pipeline (today there's none). High value, low effort. | S | none (CI) | expo-eas-update-insights |
| **10** | **N9 — EAS Observe (startup/TTI/nav perf)** | Wrap `app/_layout.tsx` RootLayout with **`ObserveRoot`** (SDK 56 name, not `AppMetricsRoot`), call `markInteractive()` via `useObserve()` once the schedule first paint is interactive, enable the expo-router per-route integration; gate `Constants.appOwnership !== 'expo'` like Sentry. Query `eas observe:routes`. | Real cold/warm-launch + per-route TTR → tells you if the 4s `bootTimedOut` ceiling ever fires and which route is slow. Complements Sentry. | M | native | expo-expo-observe (SDK 56 = ObserveRoot + useObserve) |
| **11** | **N10 — iOS 26 Liquid Glass on floating affordances** (with `expo-blur` fallback) | Adopt `AdaptiveGlass` (gate `isLiquidGlassAvailable()` → `GlassView isInteractive`, else `expo-blur BlurView systemMaterial`) for: NowNextStrip/Timeline NOW fab, set-detail floating Share/Close over the photo, map overlay controls, festival-mode HUD. **Never `opacity:0` on GlassView.** Adds 2 deps (`expo-glass-effect`, `expo-blur`). **HARD EXCLUSION: never glassify SOS** (`OfflineMap.tsx:549-568` coral SOS, CrewSos send button) — keep solid `coralStrong` for AA. | Native frosted chrome on iOS 26 + blur fallback to the 16.4 floor. Polish, two new deps. | M | native | visual-effects.md (AdaptiveGlass, isLiquidGlassAvailable) |
| **12** | **N11 — `@expo/ui` Form/Section for the Account screen** | Migrate the grouped settings list `account.tsx:97-259` to `@expo/ui` universal `Form/Section/Row` (already a dep). RN core `Switch` slots in. Removes per-card toggle/reset boilerplate (AccountDisplayName/PaymentHandles/Password/Danger). | Native grouped-list styling/swipe/dark-mode/a11y for free. **Design call:** the tab root keeps `ScreenHeader` (brand face) by choice (commit 4054628) — lower-lift alternative is just `headerLargeTitle` + `contentInsetAdjustmentBehavior='automatic'`. | L | native | SKILL.md; changelog (universal Form/Row) |

**Native build batching note:** N1, N4, N6 each need a native build but are otherwise independent of N0 — batch them into one build. N0→N2→N3→N5 are a single sequenced native-nav stream.

---

## 3. Design / copy / a11y polish (lower priority, grouped)

**Accent-rule consistency (coral = danger/SOS only):**
- CrewTabBar open-polls count badge is coral → use aqua/amber "attention, not alarm"; keep coral only if owed-money is treated as alert. `CrewTabBar.tsx:108-127`. (design-review memory)
- Compass arrow is coral → recolor to `accent.aqua` (it's wayfinding, not danger; dilutes the SOS signal). `MeetingPointCompass.tsx:232`. (design-review)
- crew-plan "Up next" badge: amber fill + coral text → make self-consistent (amber-on-amber or aqua); verify AA on translucent fill. `crew-plan.tsx:206-208,291-301`.

**Contrast / opacity anti-patterns:**
- FestivalList past-festival card-wide `opacity:0.55` drops text below AA & is invisible to screen readers → use recessed bg + lighter border (the team's own `filterChipOff` precedent at index.tsx:803-812). The "Past" badge already gives the non-visual cue. `FestivalList.tsx:260-262`.
- ClashPrompt: verify aqua-on-`bg.card` keep-buttons + coral title meet AA. `ClashPrompt.tsx:90-91,167-181`.

**Touch targets (44pt):**
- Icon-only row buttons (~24-26px) below 44pt in six crew sub-features → apply `minWidth/minHeight:44` (or `hitSlop`) matching crew.tsx:1117-1125's own WCAG/HIG standard. Highest mis-tap risk: meeting-point directions/edit/remove cluster. `CrewExpenses.tsx:806`, `CrewPolls.tsx:598`, `CrewMeetingPoints.tsx:468`, `CrewStatus.tsx:555`, `CrewRides.tsx:294`, `CrewPacking.tsx:245`.

**A11y semantics:**
- OfflineMap fallback rows: `accessibilityRole='button'` on non-interactive Views → change to `'text'`, **or** make coorded pins actually deep-link to `/compass` (better UX). `OfflineMap.tsx:573-588,601-639`.
- find.tsx disabled (no-coords) meeting-point rows lack `accessibilityState.disabled` → VoiceOver announces an actionable button that no-ops. `find.tsx:111-131`.
- crew-compare grid cells have no `accessibilityLabel` → add `${member}: ${pick} for ${set}` so the table relation survives for VoiceOver/TalkBack. `crew-compare.tsx:223-248`.
- Schedule-poll picker silently no-ops at the 4-option cap → disable unchecked rows / `accessibilityLiveRegion` "Maximum 4 options" (mirrors "no silent drops"). `CrewPolls.tsx:272-296,111-117`.
- Live Activity decorative `music.note` is sole content in compactLeading/minimal → add an a11y label if the SwiftUI modifier exists. `NowNextActivity.tsx:42,44`.

**Brand fonts (design-review P0 "finish the migration"):**
- Auth wordmark "Festie" renders in system font → apply `typeStyle('display'/'heading')` (Syncopate, already root-registered). `login.tsx:173-179`, `register.tsx:263-269`, `forgot-password.tsx:164-170`.
- Live Activity hardcodes `AQUA='#16E0C8'` → source from `@festie/shared/tokens` if the widget extraction can follow the import; else cross-reference the token name in a comment. `NowNextActivity.tsx:24`.
- Optional: native header titles + boot splash can carry Syncopate via `headerTitleStyle.fontFamily` (`_layout.tsx:219`, `HeaderTitle.tsx:17`) and a branded splash mark (`_layout.tsx:244-248`). Design decision.

**Copy:**
- Genre pills: `textTransform:'capitalize'` mangles "drum and bass"/"UK garage" → keep original-cased display label, lowercase only the dedupe key. `picks.tsx:187-189,725`.
- Reminder title rounds 90m → "2h" → reuse shared `fmtCountdown` ("1h 30m"). `useLocalReminders.ts:153-162`.
- Force-add member exposes raw `user_id` input → reframe (username/email) or admin-gate; don't ship "by user ID" to owners. `crew.tsx:744-801`.
- Dedupe Schedule's two empty-state blocks (inline Cards copy lacks the TBA branch) into one helper. `index.tsx:378-401,616-631`.
- Reform-crew festival picker is an `Alert.alert` capped at 10 → use a formSheet list (>4 options = Picker/list, not action sheet). `crew.tsx:283-313`.
- Bulk-add success `Alert.alert` interrupts repeat adds → non-blocking toast/haptic for success, keep Alert for errors. `picks.tsx:202-205`.
- Soften "No compass on this device" copy. `MeetingPointCompass.tsx:206-213`. (copy here is otherwise exemplary — keep)

**Perf (festival-battery focused — these matter operationally):**
- map.tsx 15s stale-peer `setInterval` + CrewActivity 30s poll + MeetingPointCompass per-tick `setHeading` keep firing when backgrounded/unfocused → gate on `useFocusEffect` + `AppState 'active'`; drive the compass arrow with a Reanimated shared value (UI thread) instead of 10 React commits/sec. `map.tsx:44-48`, `CrewActivity.tsx:56-63`, `MeetingPointCompass.tsx:100-106,231`.
- OfflineMap arms an 8s fallback `setTimeout` on **every** `onLoadStart`, never cleared → store id in a ref, clear on re-arm + unmount. `OfflineMap.tsx:494-504`.
- Compass GPS is a single one-shot read → `watchPositionAsync` (throttled) or tap-to-refresh + fix age, so distance isn't frozen as the user walks. `MeetingPointCompass.tsx:119-152`.
- crew-plan recomputes `Date.now()` every render with no tick → drive from a 60s tick (reuse `useNowNext`). `crew-plan.tsx:112`.

---

## 4. Explicitly DON'T do

| Capability | Why it doesn't fit Festie |
|------------|---------------------------|
| **Expo Router data loaders (`useLoaderData`)** | **Web-only** — they don't run on RN native (this audit's scope), and Festie's web is Vite/TanStack-Router, not Expo-Router web. Inapplicable. (expo-native-data-fetching/references/expo-router-loaders.md:330) |
| **Full migration to EAS Workflows for the build pipeline** | Festie **deliberately** moved Android off EAS credits to free public-repo GitHub Actions (android-e2e/android-release/mobile-ota/mobile-release-gate). Keep it. EAS Workflows is only the right home for the **future iOS** pipeline once Apple's $99 lands. (reference_eas_alternatives; expo-cicd-workflows) |
| **`@react-native-vector-icons` migration in this pass** | High surface (262 uses / 53 files), low urgency. `@expo/vector-icons` still works in 56 and is kept alive by the explicit `^15.1.1` dep. Migrating now risks regressing the just-completed coral/aqua icon-color pass. Dedicated PR later via codemod (verify glyph-name parity). |
| **`expo-symbols` (SF Symbols) as an Ionicons replacement** | iOS-only — **not** a cross-platform drop-in for Festie's Android-first Ionicons usage. Optional iOS-only polish (animated SOS/compass glyphs) *after* the vector-icons decision; do not add a 3rd icon system casually. (icons.md) |
| **Enabling React Compiler (`experiments.reactCompiler:true`)** | Not an SDK-56 requirement. Festie has known `set-state-in-effect`/ref-write-during-render warnings (kept at `warn`); enabling now could silently mis-memoize. Only after the warning count hits zero. |
| **`presentation:'formSheet'` for crew-compare** | The overlap grid wants full height; detents fight the content. Low value vs effort — skip. (`crew-compare.tsx:264-272`) |
| **`Link.AppleZoom` broadly** | iOS 18+ polish only, and the skill warns against zoom on skinny full-width list rows (so **not** SetCardMobile rows). Only viable as a poster-card→poster-detail pairing **if** a wrap-preview route is ever added. Lowest priority. (zoom-transitions.md) |
| **React Query on mobile (now)** | Real web↔mobile parity gap, but **not** an SDK-56 requirement. Backlog: crew read paths first, keeping the api.ts offline write-queue as the mutation transport. Don't bundle into the upgrade. |
| **Rebuilding toggles** | RN core `<Switch>` is already correct across Account/CrewLiveLocation — **keep, don't rebuild.** No Slider exists and none is needed. Live Activity push-token plumbing is intentionally unused (offline-first) — leave it. |
| **`expo-secure-store` for the push-token cache (urgent)** | Worth doing (token is identity-adjacent; skill says never AsyncStorage — `useMobilePush.ts`), but AsyncStorage is app-wide and works in 56. Do it app-wide in **one** PR later, not as an upgrade blocker. |

---

## 5. Recommended SEQUENCE

**Phase 0 — Upgrade & verify (blocking, do first).**
1. Run the react-navigation codemod + `pnpm --filter @festie/mobile typecheck` + lint (expect ~no-ops). Keep eslint rules at `warn`.
2. Ship code fixes **R1–R6** (image-picker API, iOS Live Activity tick+guard, notification sound branch, the two coral-AA CTA groups). R1–R4/R6 are small and correctness-critical; R5 is six one-line style swaps.
3. `npx expo-doctor`, then native build + **V1–V6** device/TestFlight smoke (MapLibre, view-shot, expo/fetch abort/SOS paths, crew-compare nesting, notification trigger). Keep `EXPO_PUBLIC_USE_RN_FETCH=1` in your pocket.
4. Re-run Android one-top-inset check + Maestro smoke.

**Phase 1 — Free/cheap wins, OTA-able (no native build).**
5. **N8** — EAS Update Insights crash gate in `mobile-ota.yml` (query by appVersion string). Also reconcile the stale `mobile-release-gate.yml` fingerprint comment to the live appVersion policy.
6. OTA-shippable design/copy/perf-gate fixes from §3 that are pure JS (accent-rule recolors, opacity→recessed, 44pt targets, focus/AppState interval gating, OfflineMap timer cleanup, genre casing, empty-state dedupe). These ride the next OTA.

**Phase 2 — Low-risk native batch (one native build).**
7. **N1** (NativeTabs — re-verify Maestro `tab-*` selectors against the new view tree, the main risk), **N4** (set-detail formSheet), **N6** (segmented Picker across 6 sites — **fetch SDK-56 `@expo/ui` Picker docs first**). Add **N9** (Observe `ObserveRoot`) in the same build to start collecting perf baselines.

**Phase 3 — Native-nav structural stream (sequenced, needs native builds).**
8. **N0** (per-tab Stacks + register find/map/compass) → then **N2** (header search), **N3** (Stack.Toolbar actions), **N5** (compass formSheet-over-map), **N7** (`Link.Preview`/`Link.Menu`). N0 is the gate; the rest are independent once it lands.

**Phase 4 — Optional polish (design decisions pending).**
9. **N10** (Liquid Glass + expo-blur, never on SOS), **N11** (Account `@expo/ui` Form), brand-font finishing (auth wordmark, native header titles, Live Activity token), iOS-only SF Symbols, compass `watchPositionAsync`. Plus the deferred backlog: React Query parity, push-token → secure-store, `@react-native-vector-icons` codemod — each its own PR.

**OTA vs native build summary:** Phase 1 (N8 + JS-only §3 fixes) is **OTA-able**. Everything touching native components/presentation/tabs/toolbars/glass/Observe (N0–N7, N9–N11) **needs a native build** — batch Phase 2 into one build and run the Phase 3 nav stream as sequenced builds.

---

**Files central to this roadmap (absolute):** `C:\Users\lolzi\OneDrive\Documents\cowork\festie\packages\mobile\app\(tabs)\_layout.tsx`, `...\app\_layout.tsx`, `...\app\(tabs)\index.tsx`, `...\components\SegmentedControl.tsx`, `...\app\set\[setId].tsx`, `...\components\OfflineMap.tsx`, `...\app\wrap.tsx`, `...\hooks\useOngoingNotification.ts`, `...\hooks\useMobilePush.ts`, `...\components\AccountAvatarSection.tsx`, `...\app\(auth)\forgot-password.tsx`, and the six `Crew*.tsx` sub-feature components under `...\packages\mobile\components\`. CI: `...\.github\workflows\mobile-ota.yml`, `mobile-release-gate.yml`.