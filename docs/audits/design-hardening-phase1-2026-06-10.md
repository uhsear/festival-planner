# Design Hardening — Phase 1 (Audit) Raw Findings

Status: UNVERIFIED (fact-check phase held per user). 9 auditors, 82 findings: 30 decisions, 52 objective fixes.

## DECISION CANDIDATES (user picks)

### DC1 [HIGH] Timeline view pins ~7 rows of chrome above the schedule, starving the actual timeline on small phones
- File: `packages/mobile/app/(tabs)/index.tsx:647-675`

In Timeline view (the default for any festival with timed sets, per the auto-default at lines 191-197) the entire `controls` stack stays FIXED above the timeline: ScreenHeader, the live/Switch/Now&Next + view-switcher row, NowNextStrip, PhaseHomeActions, the search bar, the day-chip row, and the stage/my-picks filter row. All chips are 44pt tall post-P1, so this stack is roughly 300-360pt of chrome before the first set renders — on an iPhone SE/13 mini-class screen the timeline gets well under half the viewport, and the TBA dock (line 673) can take another 40%. Cards view already solved this by riding the controls in the FlatList header; Timeline did not. This is the single most-used screen mid-festival, where glanceability is the whole point.

- **Option A: Scroll-collapse the chrome** — Wrap the controls in a collapsing header (or hide search + PhaseHomeActions once the user scrolls the timeline); keeps everything reachable but adds animation/state complexity to an already busy screen.
- **Option B: Demote search + phase actions behind a single icon row** — One 44pt row (search icon, filter icon, day pill) replaces three; cheapest fix, but adds one tap to search/filter — acceptable since both are setup actions, not mid-crowd actions.
- **Option C: Merge the live/Switch/Now&Next row into ScreenHeader** — Recovers ~52pt with zero behavior change; smallest win, doesn't address search/day/filter rows.

**Recommendation:** Option 2 plus option 3: keep day chips always visible (the one mid-festival control), fold search and stage filters behind icons, and merge the switcher row into the header. Timeline should own ~70% of the viewport.

### DC2 [HIGH] SOS raise is buried three levels deep (Crew tab → Logistics tab → mid-scroll)
- File: `packages/mobile/app/(tabs)/crew.tsx:989-993`

CrewSos — the safety-critical raise button (CrewSos.tsx docblock: 'a large, reachable SOS button') — renders only inside the Crew tab's Logistics pane, below 'Find each other', 'Share plan', CrewHomeBase, and CrewPhotoLink rows. A panicking user must know it lives under 'Logistics' (a label that doesn't say safety), and crewTab resets to 'members' on every crew change (line 163), so the path is: Crew tab → Logistics → scroll. The map screen displays an incoming SOS but offers no way to raise one. Festival context is exactly the case where this needs to be ≤2 taps with zero reading.

- **Option A: SOS affordance on /find and /map** — The 'where is everyone' hub is where a lost/in-trouble user already goes; a small coral FAB there is 2 taps from anywhere. Adds a second entry point to maintain.
- **Option B: Persistent SOS row in the crew chrome (above the tab bar)** — Always visible whenever Crew is open regardless of sub-tab; costs ~44pt of vertical space on every crew view.
- **Option C: Rename 'Logistics' → 'Safety & logistics' and pin SOS to the top of that pane** — Zero new surfaces, but still three navigation steps in an emergency.

**Recommendation:** Option 1: put a raise-SOS FAB on /find (and /map), keeping the full CrewSos card in the crew pane. The confirm dialog already guards accidental triggers, so an extra entry point is safe.

### DC3 [MEDIUM] Set detail renders two stacked coral conflict blocks for the same conflicts
- File: `packages/mobile/app/set/[setId].tsx:504-546`

When a pick conflicts, the screen shows BOTH the ClashPrompt ('keep one' with clear actions, lines 504-512) AND the passive conflict box ('N scheduling conflicts' with per-row Switch buttons, lines 515-546) — two adjacent coral-bordered warning cards listing the same sets with different verbs (Clear vs Switch). The comment calls the second an 'ambient marker', but back-to-back they read as a bug, push the priority picker (the screen's primary action) below the fold, and the Clear/Switch semantics are easy to confuse mid-crowd.

- **Option A: Merge into one conflict card** — One coral block listing each conflicting set with both 'Keep this' and 'Switch to' actions; loses the visual separation of nudge-vs-status but halves the warning real estate.
- **Option B: Keep ClashPrompt only** — Cleanest; loses the explicit Switch shortcut (user can still re-pick via the other set's detail).
- **Option C: Keep both but collapse the passive box to a one-line summary** — Minimal change; still two coral surfaces.

**Recommendation:** Option 1 — a single conflict card with per-set Keep/Switch actions is the densest, least alarming presentation.

### DC4 [MEDIUM] Crew 'Logistics' tab is an 11-section kitchen sink mixing safety with chores
- File: `packages/mobile/app/(tabs)/crew.tsx:948-1007`

One scroll pane contains: Find each other, Share plan (QR), Home base, Photo album, Live location, SOS, Status, Meeting points, Packing, Rides, Activity. Three different jobs are interleaved — mid-festival safety (find/live/SOS/meeting points), pre-festival planning (packing/rides), and ambient info (photo link/activity) — so the mid-festival items a user actually needs in a crowd share fold position with packing checklists. The label 'Logistics' describes none of them well, and everything from Status down is reliably below the fold.

- **Option A: Split into 'Find' (map/compass/live/SOS/meeting points) and move Packing/Rides into the Plan tab** — Cleaner job separation; Plan tab grows, and a 5th tab segment may crowd CrewTabBar.
- **Option B: Reorder within Logistics: safety cluster first, Packing/Rides/Activity behind collapsible sections** — No IA change, fast; still one long scroll.
- **Option C: Make rows ordering phase-aware (reuse festivalPhase): pre-fest = packing/rides first, live = find/SOS first** — Best festival fit, most logic; ordering that changes by day can disorient.

**Recommendation:** Option 1: the screen already has a 'Find each other' hub route — promote that grouping to the tab level and let Plan own packing/rides.

### DC5 [MEDIUM] Predictive back is explicitly disabled despite compileSdk/targetSdk 36 and zero BackHandler usage
- File: `packages/mobile/app.json:54`

"predictiveBackGestureEnabled": false opts the app out of Android's predictive back (no back-to-home preview animation, no in-app cross-activity preview). On Android 16 (targetSdk 36, which this app builds against) predictive back is the platform default and the opt-out path is deprecated — Google has stated it will eventually be ignored. A repo-wide grep shows ZERO BackHandler usages in packages/mobile (the only hits for 'BackHandler|predictive' are app.json:54 and a comment in app/_layout.tsx:258), and all RN Modals already use onRequestClose (components/CrewSos.tsx:207, components/OfflineBanner.tsx:133), so the usual blockers for enabling it are absent. react-native-screens 4.25.2 (package.json:58) supports predictive back on the native stack.

- **Option A: Enable now (flip the flag) and smoke-test back nav on the Android 16 emulator via the existing Maestro harness** — Small risk of animation glitches in the formSheet route (set/[setId]) and NativeTabs; needs one E2E pass to verify
- **Option B: Keep disabled until React Navigation/expo-router declare full predictive-back support stable** — App feels dated on Android 16 devices; the opt-out is on borrowed time and will silently stop working in a future Android release
- **Option C: Enable behind a staged rollout (next EAS build only, not OTA)** — Safest, but the flag is native config anyway — it can only ship in a build, so this is effectively option 1 with extra ceremony

**Recommendation:** Option 1. The codebase has no custom back interception to break, the opt-out is deprecated platform-wide, and the existing Maestro Android-E2E suite can verify back flows (sheet dismiss, tab back-to-home) before shipping.

### DC6 [MEDIUM] No android_ripple anywhere — 415 TouchableOpacity usages give opacity-fade-only touch feedback on Android
- File: `packages/mobile/components/SetCardMobile.tsx`

Grep: android_ripple appears 0 times in packages/mobile; TouchableOpacity appears 415 times across 49 files (every list row, tab content, and button — e.g. SetCardMobile.tsx, CrewExpenses.tsx with 27, crew.tsx with 39). Only 7 Pressable usages exist (TBASection.tsx, SegmentedControl.tsx) and none pass android_ripple. Material convention on Android is a bounded ripple originating at the touch point; opacity fade reads as an iOS idiom. This is consistent (so not broken), but it is the single biggest 'feels like an iOS port' signal on Android.

- **Option A: Add a shared <AppPressable> wrapper (Pressable + android_ripple on Android, opacity on iOS) and migrate high-traffic surfaces first (SetCardMobile, CrewTabBar, list rows)** — Incremental effort across 49 files; mixed feedback styles during migration
- **Option B: Keep opacity-fade everywhere as a deliberate cross-platform brand choice** — Zero work, internally consistent, but violates Material touch-feedback convention and ripple is what Android users' muscle memory expects
- **Option C: Ripple only on list rows/cards, keep opacity on small inline buttons** — Best perceived-quality-per-effort, but introduces a two-rule system contributors must learn

**Recommendation:** Option 1, rolled out via option 3's prioritization. A single wrapper keeps the rule enforceable ('never raw TouchableOpacity in new code') and the OTA pipeline means high-traffic screens can convert without a store build.

### DC7 [MEDIUM] One 'updates' channel bundles set reminders AND crew updates — users can't mute crew noise without losing reminders
- File: `packages/mobile/hooks/useMobilePush.ts:41`

ensureAndroidChannels creates 'default' ("General", DEFAULT importance) and 'updates' ("Set reminders & crew updates", HIGH importance). Channel names are human-readable (good), and the sticky 'ongoing' channel ("Festival status", LOW, no sound/vibration — useOngoingNotification.ts:48-58) is exemplary. But Android channels exist precisely so users can tune categories independently in system settings: a personal set reminder (I asked for this) and crew activity (someone else's action) are different consent levels, and the conjoined name itself admits two categories. A user drowning in crew pings at a festival can only nuke the channel that also carries their set alarms.

- **Option A: Split into 'set-reminders' (HIGH) and 'crew' (DEFAULT) channels now, before push volume grows** — Backend FCM payloads must send the right channelId per notification type — a coordinated shared+server change; existing users keep the old channel until next channel creation
- **Option B: Keep one channel; rely on in-app notification preferences instead** — No native change needed, but fights the platform — Android's long-press-to-mute on a notification kills the whole channel, which is the path users actually take

**Recommendation:** Option 1. Channel splits are nearly impossible to do gracefully later (channels are immutable once created, per-user), so the cheapest time is before the Android install base grows. Crew push was already a deferred roadmap item — fold the split into that work.

### DC8 [MEDIUM] Zero list/layout motion anywhere — state changes hard-cut
- File: `packages/mobile/app/(tabs)/index.tsx:618-624`

A package-wide grep for `entering|exiting|LayoutAnimation|FadeIn|SlideIn` returns zero animation usage. Toggling 'only mine', switching day chips, switching Cards/Timeline view (index.tsx:618 branches on viewMode with no transition), adding/deleting packing items (CrewPacking.tsx), poll results updating, and crew-tab content swaps (CrewTabBar) all teleport. For an app whose brand leans on a 'live' feel (LiveDot, NowNext, real-time sync), content appearing/disappearing with no motion reads cheaper than the rest of the polish.

- **Option A: Reanimated layout primitives on key lists** — Add `entering={FadeIn.duration(duration.med)}` / `exiting={FadeOut}` + `layout={LinearTransition}` to set-card rows, packing items, and poll options, gated on useReduceMotion. Best feel; touches several files; FlatList + layout animations need itemLayoutAnimation and light testing on New Architecture.
- **Option B: Crossfade only at the container level** — Single Animated opacity wrapper around the schedule body keyed on viewMode/selectedDay/tab. One-file change per screen, much cheaper, but individual row add/remove still hard-cuts.
- **Option C: Keep static** — Zero risk and zero frame cost on low-end Androids at a festival, but the app keeps its teleporting feel and the motion system stays 3 components deep.

**Recommendation:** Option 1 for the three highest-traffic lists (schedule rows, packing, polls) plus option 2's crossfade for view-mode/day switches — both behind useReduceMotion. This is the single biggest perceived-quality lever in this lens.

### DC9 [MEDIUM] Press feedback vocabulary is split: one component squishes, everything else uses ad-hoc activeOpacity
- File: `packages/mobile/components/SegmentedControl.tsx:34-72`

SegmentedControl's Segment has a tokenized Reanimated press-squish (scale 0.94, duration.fast/easing.out in, duration.med/easing.spring out, reduce-motion gated) — the nicest press in the app. Every other touchable is TouchableOpacity with hand-picked activeOpacity values: 0.7 (SetCardMobile priority buttons, day chips), 0.8 (card body, CrewTabBar), 0.85 (festival-mode.tsx:92,121). Two different physical metaphors (squish vs fade) and three fade strengths with no rule for which applies where.

- **Option A: Shared PressableScale primitive** — Extract Segment's squish into components/PressableScale.tsx and adopt it for chip/pill/button-class controls; cards keep opacity. Coherent and reuses already-proven token code, but a wide mechanical migration (~20 files).
- **Option B: Standardize on one activeOpacity token** — Add `t.pressOpacity = 0.7` and replace the magic numbers. Trivial diff, kills the 0.7/0.8/0.85 lottery, but keeps the squish/fade split and adds no delight.
- **Option C: Keep as is** — No effort; inconsistency is subtle per-screen but compounds with finding 3 into a 'web port' feel.

**Recommendation:** Option 1 for small controls (priority buttons, chips, tab pills, rating emoji) + option 2's single opacity constant for large card surfaces. Squish-for-buttons / fade-for-cards is an easy rule to document and enforce.

### DC10 [MEDIUM] Sibling share posters follow opposite token philosophies and have diverging surface values
- File: `packages/mobile/components/WrapPoster.tsx:10`

WrapPoster.tsx:4-16 sources its palette from @festie/shared/tokens ('so web and poster stay in sync if the palette evolves') but hardcodes its white-overlay chrome as raw rgba strings (lines 141, 155, 158 — statCell fill rgba(255,255,255,0.05), a value not in the overlay scale). CrewWrapPoster.tsx:52-57 documents the exact opposite: hex palette 'deliberately static to lock the captured PNG', with only the overlay chrome routed through colors.overlay (lines 160-171, statCell fill overlay[1]=0.03). So the two posters that ship side-by-side disagree both in philosophy and in actual pixels: their stat-cell fills differ (0.05 vs 0.03) and a future palette change would update one poster but not the other.

- **Option A: Adopt CrewWrapPoster's approach in both (static hex palette + token overlay scale)** — Captured PNGs are locked to today's brand forever; a palette refresh requires touching posters manually.
- **Option B: Adopt WrapPoster's approach in both (palette from tokens), and route overlays through colors.overlay too** — Posters track the brand automatically, but a future theme/palette change silently changes shared-to-stories artifacts.
- **Option C: Leave as-is and only align the stat-cell fill value** — Cheapest, fixes the visible 0.05-vs-0.03 difference, but the contradictory header comments keep misleading future editors.

**Recommendation:** Option 2: both posters read the palette from tokens (they already must match the web posters, which are token-driven), normalize statCell fill to colors.overlay[2 or 3], and delete the contradictory 'deliberately static' note — token values only change with deliberate brand decisions anyway.

### DC11 [MEDIUM] Short timeline set blocks stay under a 44pt effective touch target
- File: `packages/mobile/components/TimelineView.tsx:154-177`

A set block's height is duration-derived: `Math.max(ROW_HEIGHT, …) - 4` → a 15-minute set renders 18px tall. The hitSlop at line 177 adds 8+8, yielding ~34pt effective — still under the 44pt minimum the code comment claims to satisfy, and adjacent blocks' hitSlops overlap (the topmost sibling wins), so back-to-back short sets remain hard to hit for motor-impaired users. This is intrinsic timeline-density tension: honest 44pt blocks would distort the time scale.

- **Option A: Enforce a 28px visual minimum block height (28 + 16 hitSlop = 44pt)** — Short sets render slightly larger than their true duration — minor time-scale distortion for back-to-back 15-min slots, may cause visual overlap that needs a stacking tweak
- **Option B: Raise ROW_HEIGHT from 22 to 30 (≈2 px/min)** — Uniformly accurate scale and every 15-min set hits ~26px+16=42pt, but a full festival day gets ~35% taller — more scrolling, against the documented 1.4-1.6 px/min spec
- **Option C: Accept as-is; Cards view is the accessible alternative** — Zero work and WCAG 2.5.8 technically allows an equivalent control elsewhere, but the equivalence is undiscoverable and the in-code 44pt comment stays misleading

**Recommendation:** Option 1 — a 28px floor with the existing hitSlop reaches 44pt while keeping the px/min spec for everything ≥19 minutes; also fix the stale WCAG comment either way.

### DC12 [MEDIUM] Selected-day pill still differs by platform: web crimson #c01d3a vs mobile aqua — now also violates the codified accent rule
- File: `packages/web/src/components/layout/SubHeader.tsx:177`

Roadmap cross-cutting Medium, verified unresolved. Web paints the active day `bg-day-tab-active` (crimson) + white with the improvised shadow `rgba(255,80,110,0.45)` and off-scale `py-[7px]` (SubHeader.tsx:169,178); mobile paints it `accent.aqua` + dark ink (app/(tabs)/index.tsx:771-773). Since the review, the accent rule was codified in shared tokens (colors.ts:33-40: 'coral is RESERVED for DANGER / SOS only', selection = aqua), which makes web's coral-family selected-day the rule-breaking outlier — but changing it alters web's established look, so it's a brand call.

- **Option A: Web adopts mobile's aqua + dark-ink selected day** — Full parity and compliance with the codified accent rule; web loses its distinctive crimson day pill.
- **Option B: Mobile adopts web's #c01d3a + white** — Keeps web's look and is AA-safe, but contradicts the token rule the team just wrote (coral family = danger only).
- **Option C: Keep divergent deliberately and document it** — Zero work, but the parity mandate and the token-comment rule both stay violated; future audits re-flag it.

**Recommendation:** Option 1 (aqua on both). The rule in shared/colors.ts is the newer, deliberate decision; web should follow it. Either way, replace the improvised shadow with --shadow-glow tokens and round py-[7px] to py-2.

### DC13 [MEDIUM] Open decision: confirm 'finish-the-migration' scope is final (roadmap decision #2 — the only one of the 5 still open)
- File: `docs/audits/design-roadmap-2026-06-07.md:126`

Of the roadmap's 5 pending user decisions, 4 are now resolved in code: #1 accent direction (aqua=primary, coral=danger — codified in packages/shared/src/tokens/colors.ts:33-40), #3 mobile grid removal (app/(tabs)/index.tsx:46 'dense 2D stage×time Grid is intentionally web/tablet-only'), #4 icon vocabulary (admin emoji → lucide, admin.tsx:46-51; `←` → ArrowLeft, AdminLayout.tsx:33), #5 brand fonts (Syncopate/Space Grotesk wired in hooks/useTokens.ts:61-77). Only #2 — how far to push the redesign — was never explicitly answered; the team proceeded de facto on the migration-finish path and has now substantially completed it.

- **Option A: Ratify finish-the-migration as the end state** — Closes the design epic; remaining polish items become normal backlog. No new visual ambition.
- **Option B: Commission a deeper visual redesign on top** — Differentiation opportunity (the token system would support it), but large effort with the current design now consistent and AA-clean — weak ROI signal.

**Recommendation:** Option 1. The code shows the migration is ~95% landed (P0 fully, P1 fully, most of P2); ratify it and close the roadmap rather than reopen scope.

### DC14 [LOW] Schedule tab is the only tab without a distinct selected-state SF Symbol
- File: `packages/mobile/app/(tabs)/_layout.tsx:25`

Picks, Crew, and Account all switch to .fill variants when selected (star→star.fill, person.2→person.2.fill, person.crop.circle→person.crop.circle.fill), but Schedule declares sf={{ default: 'calendar', selected: 'calendar' }} — only the aqua tint signals selection on the app's most-used tab. SF Symbols has no plain 'calendar.fill', so this is a real constraint, not an oversight, but the asymmetry is visible side-by-side in the tab bar.

- **Option A: Keep 'calendar' for both states** — Matches Apple's own Calendar app (tint-only selection is HIG-acceptable); selected state is slightly weaker than the other three tabs.
- **Option B: Use 'calendar.circle' / 'calendar.circle.fill'** — Gains a fill-state pair, but the circled glyph reads heavier and shape-inconsistent next to the uncircled star/person glyphs.
- **Option C: Drop .fill variants on all four tabs** — Restores symmetry by leveling down; loses the standard iOS filled-when-selected affordance users expect.

**Recommendation:** Option 1 (keep as-is): tint-only selection for calendar mirrors Apple's first-party tab bars, and the other tabs' fill variants still carry the convention; don't trade glyph-family consistency for a forced fill pair.

### DC15 [LOW] Crew invite share message exposes a raw /api/v1/ URL
- File: `packages/mobile/app/(tabs)/crew.tsx:231`

handleShareInvite shares `https://festie.us/api/v1/crews/join/${code}` as the visible link text in the SMS/share message. Compare the picks share (picks.tsx:327) which uses the clean `festie.us/s/:id`. An '/api/v1/' URL in a text message reads machiney and mildly phishy to recipients — the invite is the app's main growth loop, so the link is marketing surface.

- **Option A: Add a friendly web route (e.g. festie.us/join/CODE) that 302s to the API handler** — Small server change; cleanest message.
- **Option B: Share the bare code + festie.us and instructions** — No server change but loses one-tap join.

**Recommendation:** Option 1 — a /join/:code redirect route, then update this one string.

### DC16 [LOW] Onboarding pager shows dots but doesn't swipe
- File: `packages/mobile/components/FirstRunIntro.tsx:120-135`

FirstRunIntro advances only via the Next button (setIndex on press); there is no horizontal pan/pager. The page-indicator dots (lines 121-125) are the universal affordance for 'swipe me', so first-time users — on the very first screen of the app — will swipe and get nothing. Platform convention for multi-slide intros is a swipeable pager.

- **Option A: Render slides in a paging horizontal FlatList/ScrollView driving index from onMomentumScrollEnd** — Standard pattern, ~30 lines; keeps the Next button as a secondary path.
- **Option B: Drop the dots and keep tap-only** — Honest affordance with zero new code, but loses progress feedback.

**Recommendation:** Option 1 — make it a real pager; the dots already promise it.

### DC17 [LOW] Native splash auto-hides into a JS spinner overlay — a double loading transition instead of one splash hold
- File: `packages/mobile/app/_layout.tsx:282`

expo-splash-screen is configured (app.json:82-89, #080810 bg) but the code never calls SplashScreen.preventAutoHideAsync/hideAsync (grep: zero hits in packages/mobile source). So on cold start the user sees: native splash with brand icon → splash dismisses at first render → a bare dark View with an aqua ActivityIndicator (_layout.tsx:282-286, gated on fonts+hydration+session with a 4s ceiling at line 103) → app. The matching #080810 background softens it, but the icon vanishing into a generic spinner is exactly the two-stage boot the Android 12+ SplashScreen API was designed to eliminate.

- **Option A: preventAutoHideAsync at module scope, hideAsync when `loading` flips false (keep the existing 4s bootTimedOut ceiling as the forced-hide backstop)** — One continuous branded splash; risk is a regression of the exact splash-wedge bug the comments at lines 93-100 describe, though the ceiling already guards it
- **Option B: Keep the spinner overlay as-is** — Zero risk, proven to never wedge, but boot reads as two loading screens
- **Option C: Hybrid: hold native splash only for fonts (the fast, deterministic wait) and let session-check happen behind the live UI** — Shortest perceived boot, but introduces a logged-out flash if the session check redirects

**Recommendation:** Option 1. The hard-won 4s safety valve already exists and transfers directly to hideAsync; the change is ~5 lines and removes the most visible rough edge of every cold start.

### DC18 [LOW] Notification accent color is coral (#ff3366) — the shipped accent rule reserves coral for danger
- File: `packages/mobile/app.json:100`

The expo-notifications plugin sets "color": "#ff3366" — Android tints the small status-bar/shade icon with this for EVERY notification, including routine set reminders and crew updates. The 2026-06-07 design review established aqua = primary, coral = danger; under that rule a 'your set starts in 15 min' notification rendered in danger-coral is off-rule. (SOS pushes, where coral is correct, share the same single color — Android allows only one accent per app via this plugin.)

- **Option A: Switch to aqua #00e8d0** — On-rule and on-brand, but a light teal tint has weaker contrast on the light notification shade of light-mode devices (Android does auto-adjust tint contrast since 12)
- **Option B: Keep coral** — Strong contrast and attention-grabbing, but every benign notification borrows the danger color
- **Option C: A darker brand-derived teal tuned for light surfaces** — Best contrast compliance, but introduces a one-off color outside the token set

**Recommendation:** Option 1 — consistency with the accent rule the team already paid to establish; Android's automatic tint-contrast adjustment handles the light-shade case. Note this is native config (rides the next EAS build, not OTA).

### DC19 [LOW] 'Now' FAB on the Schedule timeline uses coral for a primary (non-destructive) action
- File: `packages/mobile/components/TimelineView.tsx:411`

The scroll-to-now FAB is styled backgroundColor: t.colors.accent.coral with a musical-notes icon and 'Now' label (TimelineView.tsx:409-419). Jumping the timeline to the current time is a primary navigation action, which the shipped accent rule assigns to aqua; coral here is the only floating action in the app and it wears the danger color. As a FAB it is otherwise convention-correct (bottom-right, bottom: spacing[5], above the native tab bar, proper accessibilityRole/Label).

- **Option A: Recolor to aqua per the accent rule** — Rule-consistent; loses the 'red = LIVE right now' connotation that may have motivated coral
- **Option B: Keep coral as a deliberate 'live indicator' exception and document it in the accent rule** — Preserves the live-now metaphor (common in streaming apps) but adds an exception future contributors must know about

**Recommendation:** Option 2 only if 'coral = live/now' was a conscious choice during the June 7 design pass — otherwise option 1, since an undocumented exception erodes the rule. Worth a 30-second check against docs/audits/design-review-internal-2026-06-07.md.

### DC20 [LOW] SegmentedControl active state hard-cuts — no thumb slide or tint transition
- File: `packages/mobile/components/SegmentedControl.tsx:118-127`

The component is described as 'iOS-style' but the active aqua fill jumps instantly between segments (static `segmentActive` style swap); the only animation is the press squish. A real iOS UISegmentedControl slides its thumb. The control sits at the top of the most-used screen (Schedule, index.tsx:606), so the cut is seen constantly.

- **Option A: Animated sliding thumb** — One absolute-positioned Animated.View whose translateX animates with withTiming(duration.med, easing.standard); true native feel, needs onLayout measurement of segment widths.
- **Option B: Per-segment color crossfade** — Animate backgroundColor/label color via interpolateColor on an active shared value. Much simpler than measuring, no slide but no hard cut either.
- **Option C: Keep static** — Free, and the press squish already gives some life; the 'iOS-style' claim stays slightly hollow.

**Recommendation:** Option 1, reduce-motion falling back to the current instant swap — the component already has the token + reduceMotion plumbing, and a sliding thumb is the canonical pattern users expect from this exact control.

### DC21 [LOW] Priority pick activation is an instant color swap — the app's signature interaction has no micro-animation
- File: `packages/mobile/components/SetCardMobile.tsx:111-139`

Picking a set (Must/Want/Maybe) is the core loop of the product. PriorityButton fires haptics.select() (good) but visually the accent background/border just flips via a conditional style. There is no fill, scale pop, or icon bounce confirming the pick — the haptic says 'something happened' while the screen barely agrees. Compare LiveDot, which got a full breathing animation for a purely passive indicator.

- **Option A: Scale pop + color timing on activation** — withSequence scale 1→1.12→1 (duration.fast/easing.spring) plus interpolateColor fill on the active button, reduce-motion gated. Small, contained to PriorityButton; New-Arch Reanimated cost is negligible for one button.
- **Option B: Icon-only bounce** — Animate just the Ionicons star/heart scale; cheaper visually quieter, background still hard-cuts.
- **Option C: Keep instant** — Fastest perceived response and zero work, but the highest-frequency interaction stays the least celebrated.

**Recommendation:** Option 1 — it's ~30 lines in one component, pairs with the existing select() haptic into a complete confirm moment, and PriorityButton is memoized so render cost is contained.

### DC22 [LOW] haptics.warning's own documented use-case — schedule conflicts — never fires
- File: `packages/mobile/components/ClashPrompt.tsx`

useHaptics.ts:56 documents warning() as 'Warning, e.g. a schedule conflict', but a package grep shows warning() is only ever called for SOS (CrewSos.tsx:59,66). Schedule conflicts — the ClashPrompt surfacing after a pick, and the Conflict badge on SetCardMobile:215 — are silent, so picking a set that collides with a Must feels identical to a clean pick. Either the contract doc is stale or the coverage is incomplete.

- **Option A: Fire warning() when ClashPrompt appears after a pick** — Closes the documented gap and makes conflicts physically noticeable mid-festival; risk of buzz fatigue if a user knowingly stacks conflicts.
- **Option B: Reserve warning() exclusively for SOS and fix the doc** — Keeps the strongest haptic rare and meaningful (good for an SOS feature); conflicts stay visual-only. One-line doc edit in useHaptics.ts.
- **Option C: Add a milder distinct pattern for conflicts** — iOS has no spare notification type, so this means a custom Android pattern + iOS Medium impact — more vocabulary surface to maintain.

**Recommendation:** Option 1 — fire warning() once when ClashPrompt first mounts for a new conflict. A missed headliner clash is exactly the moment a glance-down-at-phone festival user needs a physical nudge, and it makes the hook's contract true.

### DC23 [LOW] No codified motion/haptic vocabulary — conventions exist only as scattered JSDoc
- File: `packages/shared/src/tokens/motion.ts:1-50`

The raw materials are genuinely good: shared duration/easing tokens with css+bezier duals, a four-verb haptic hook with platform split, and a useReduceMotion hook that every animated component actually honors. But there is no written rule for WHEN each applies — which is exactly why findings 2, 4, 5 happened (each new component re-decides). Nothing maps interaction classes (press, selection, confirmation, destructive, ambient, layout change) to a duration+easing+haptic triple.

- **Option A: Vocabulary table in ARCHITECTURE.md or a docs/design page** — Cheap (a table: press=fast/out+none, selection=fast+select, confirm=med/spring+success, destructive confirm=warning, ambient pulse=pulse-token/standard, layout=med/standard); relies on review discipline to enforce.
- **Option B: Encode in primitives instead of prose** — Ship PressableScale (finding 4), an AnimatedListItem wrapper, and make useHaptics the only legal expo-haptics import (lint rule from finding 1). Self-enforcing, but more upfront build.
- **Option C: Do nothing** — Each future component keeps rolling its own; drift already visible after one design-review cycle.

**Recommendation:** Both halves of options 1+2: write the one-page table AND back it with the two primitives plus the no-restricted-imports lint rule. The table costs an hour; the primitives fall out of fixing findings 1 and 4 anyway.

### DC24 [LOW] Loading treatment split: spinners vs skeletons across sibling screens
- File: `packages/mobile/app/crew-compare.tsx:116`

Initial-load treatments diverge: picks (PicksSkeleton, picks.tsx:531), crew (geometry-matched skeleton, crew.tsx:427-451), wrap (WrapSkeleton, wrap.tsx:352) and FestivalList (skeleton cards) all use content-shaped skeletons, while crew-compare uses the LoadingState spinner (crew-compare.tsx:116), index.tsx's picker wrapper uses LoadingState (index.tsx:425), and set/[setId] deep-link resolution uses a raw inline ActivityIndicator instead of the LoadingState component (set/[setId].tsx:352-356). None of these are broken, but the app currently has three tiers of loading polish and which one you get is arbitrary per screen.

- **Option A: Skeletons everywhere layout is known** — Best perceived performance and zero layout jump, but each screen needs a bespoke skeleton (crew-compare's grid is the most work)
- **Option B: Codify the current split as a rule** — Cheap — document 'skeleton for list/grid screens, LoadingState for indeterminate resolves (deep links, auth gates)' and only fix the one raw ActivityIndicator in set/[setId] to use LoadingState
- **Option C: LoadingState spinner everywhere** — Maximum consistency for minimum code, but regresses the already-shipped skeletons and reintroduces layout jump

**Recommendation:** Option 2: the skeleton-vs-spinner split is already principled in practice; just write the rule down and replace the raw ActivityIndicator in set/[setId].tsx:354 with the shared LoadingState so the deep-link resolve matches the design system. Add a crew-compare skeleton later only if that screen's spinner shows up in real usage.

### DC25 [LOW] No icon-size token scale — 17 distinct inline Ionicons sizes with off-grid one-offs
- File: `packages/mobile/components/CrewTabBar.tsx:56`

Icon sizes are all inline literals: 10,12,13,14,15,16,18,20,22,24,28,32,36,40,48,56,96 across app/ and components/. Most cluster on a sane 12/16/18/20 grid, but odd one-offs sit beside siblings on the grid: size={13} (app/(tabs)/crew.tsx:914, components/TBASection.tsx:119, components/SetCardMobile.tsx:210) and size={15} (components/CrewTabBar.tsx:56, components/CrewPolls.tsx:443, components/SetCardMobile.tsx:131) — visually near-identical to 12/14/16 but guaranteeing slow drift since there is no tokens.iconSize to reach for.

- **Option A: Add an iconSize scale to useTokens (e.g. xs:12, sm:16, md:20, lg:24, xl:48) and sweep, snapping 13->12 and 15->16** — ~190 call sites to touch; purely mechanical but noisy diff.
- **Option B: Add the token scale but only fix the off-grid 13/15 one-offs now; adopt the scale for new code** — Small diff, stops the bleeding, but the codebase stays mixed for a long time.
- **Option C: Leave as-is** — Zero cost today; drift continues and each new icon size is a fresh judgment call.

**Recommendation:** Option 2 — introduce the scale and snap the six 13/15 outliers; a full sweep isn't worth the diff noise given how consistent the existing 12/16/18/20 clustering already is.

### DC26 [LOW] Live NOW/UP-NEXT transitions are never announced to screen readers
- File: `packages/mobile/components/NowNextStrip.tsx:63-71`

The schedule's NowNextStrip and the festival-mode screen recompute on a 60s tick (useNowNext) and silently flip from "UP NEXT in 5m" to "NOW playing", and TimelineView's countdown row (TimelineView.tsx:379-391) updates every minute — none carry `accessibilityLiveRegion` or fire `announceForAccessibility`, so a blind user at the festival gets no notification that their picked set just started. The codebase already uses live regions for OfflineBanner and auth errors, so the pattern exists; the open question is chattiness (a polite region on the strip would re-announce every minute as the countdown text changes).

- **Option A: Announce only the up-next→now transition via AccessibilityInfo.announceForAccessibility in useNowNext consumers** — One meaningful announcement per set start, works on both platforms, but needs a small transition-detection effect (track previous current[0]?.set.id)
- **Option B: accessibilityLiveRegion="polite" on the strip** — One-line change matching OfflineBanner, but Android-only and re-announces every countdown minute (noisy)
- **Option C: Leave silent** — No code, but the app's headline live feature is inaccessible to screen-reader users on site

**Recommendation:** Option 1 — announce "Now playing: <artist> at <stage>" exactly once when a picked set moves into `current`; it matches the haptics philosophy (signal the moment, not the tick).

### DC27 [LOW] Two competing 'selected pill' grammars: filled aqua (SegmentedControl) vs outlined aqua tint (CrewTabBar)
- File: `packages/mobile/components/SegmentedControl.tsx:119 vs CrewTabBar.tsx:98`

SegmentedControl's active segment is a solid aqua fill with dark ink (segmentActive, labelActive: onLightAccent); CrewTabBar's active tab is an aqua border + aquaAlpha[12] tint with aqua text (tabActive, labelActive: accent.aqua). SetCardMobile priorityButton-active and the schedule day/filter chips add further selected treatments. Both are token-correct and AA-safe, but the app now has two visual answers to 'this pill is selected', which weakens scanability across the Schedule view-switcher and the Crew tabs that sit one tab apart.

- **Option A: Filled = mutually-exclusive view switch, outlined-tint = navigational tabs (status quo, codified)** — Zero code change; requires writing the rule down (tokens doc or SectionLabel-style comment) so the next chip doesn't coin a third style.
- **Option B: Converge everything on the filled-aqua active state** — Strongest selected affordance and one rule; CrewTabBar gets visually louder and the coral dot badge sits on a bright fill, needing a badge-contrast pass.
- **Option C: Converge on the outlined aqua-tint active state** — Quieter, scales to many pills; weakens the Schedule Timeline/Cards switcher where the filled state currently reads instantly.

**Recommendation:** Option 1 — the two treatments map cleanly onto distinct control semantics (switcher vs tabs); codify it in a comment/doc and audit the day/filter chips against it rather than restyling working controls.

### DC28 [LOW] Auth and set-detail screens use ad-hoc headers instead of ScreenHeader
- File: `packages/mobile/app/(auth)/login.tsx (also register.tsx, forgot-password.tsx, reset-password.tsx, set/[setId].tsx)`

ScreenHeader (components/ScreenHeader.tsx) is adopted by the four tab screens plus crew-plan and privacy, and HeaderTitle covers native Stack headers — but the four auth screens and set/[setId] still hand-roll insets.top headers (grep: they consume insets.top without ScreenHeader). For auth this is plausibly intentional (hero/branding layout, no tab chrome); set/[setId] is an iOS formSheet where a safe-area header is a different shape. So this is incomplete-but-maybe-deliberate adoption rather than a bug.

- **Option A: Leave auth + formSheet as documented exceptions** — No work; the exception list must live somewhere (ScreenHeader doc comment) or future screens will copy the wrong template.
- **Option B: Add a variant prop to ScreenHeader (e.g. hero/sheet) and migrate all five** — One header system, consistent title shrink-to-fit/a11y role everywhere; risks over-generalizing a 90-line component for two layouts that share little.

**Recommendation:** Option 1 — document the exception in ScreenHeader's JSDoc ('tab/stack screens use this; auth hero and formSheet detail are exempt'); migrating auth heroes into a shared header buys consistency nobody perceives.

### DC29 [LOW] Onboarding narrative still diverges: web 2 steps vs mobile 3 slides, copy not single-sourced — and web carries an unresolved in-code TASTE CALL
- File: `packages/web/src/components/features/Onboarding.tsx:33`

P2-1's visual upgrade shipped on mobile (FirstRunIntro.tsx:13-17 anchors copy low, slide 1 renders a product-miniature visual). But the alignment half didn't: web Onboarding has 2 steps ('Mark the sets you want' / 'Plan it with your crew', Onboarding.tsx:37-50) while mobile has 3 different slides (FirstRunIntro.tsx:27-44), copy lives in two files instead of @festie/shared, and Onboarding.tsx:34-36 contains a literal 'TASTE CALL — flagged for human review' about whether web step 1 should lead with live set cards.

- **Option A: Align both to mobile's 3-slide narrative, single-sourced in @festie/shared** — Full parity-mandate compliance; web onboarding gets one step longer.
- **Option B: Keep counts different but single-source the shared two slides' copy** — Less churn; accepts that the platforms tell slightly different stories (mobile adds the offline-reminders slide, which is genuinely mobile-only).
- **Option C: Leave as-is** — No work, but two onboarding copies will keep drifting and the in-code TASTE CALL stays unanswered.

**Recommendation:** Option 2 — mobile's third slide is about local notifications, a real platform difference; single-source the two shared slides and answer the web step-1 visual question (skip live set cards, per the file's own rationale that lineups may not be loaded yet).

### DC30 [LOW] Primary nav labels still differ: web 'My Picks'/'Me' vs mobile 'Picks'/'Account'
- File: `packages/web/src/components/layout/BottomNav.tsx:83`

Internal-review parity nit, verified unresolved: web BottomNav.tsx:83-85 uses 'My Picks' and 'Me'; mobile NativeTabs (_layout.tsx:30,41) uses 'Picks' and 'Account'. Schedule/Crew now match (the Timeline rename and web nav consolidation both shipped), leaving these two as the last label drift.

- **Option A: Standardize on 'Account' + 'My Picks' (the docs' recommendation)** — Mobile keeps 'Account'; web renames 'Me'; 'My Picks' is slightly long for a native tab label.
- **Option B: Standardize on 'Account' + 'Picks'** — Shortest labels, fits NativeTabs best; web loses the possessive that distinguishes it from crew picks.

**Recommendation:** Option 2 — mobile NativeTabs labels are the more space-constrained surface, and 'Picks' is unambiguous inside an authenticated nav.


## OBJECTIVE FIXES (no decision needed)

### F1 [HIGH] Set-detail notes are covered by the keyboard (no keyboard avoidance in the formSheet)
- File: `packages/mobile/app/set/[setId].tsx:387-688`

The 'Your note' and 'Crew note' TextInputs (lines 667-685) sit at the very bottom of the set-detail ScrollView, but the screen has no KeyboardAvoidingView, no automaticallyAdjustKeyboardInsets, and no keyboardDismissMode. iOS form sheets on iPhone do not auto-avoid the keyboard, so when the user taps a note field the keyboard fully covers the input they are typing into. Every other form surface in the app already handles this correctly (login/register/forgot/reset/crew/account all wrap KeyboardAvoidingView with behavior='padding'; crew.tsx:839-840 even adds keyboardDismissMode='on-drag'), so this screen is an outlier as well as a HIG keyboard-management violation.

**Fix:** Add automaticallyAdjustKeyboardInsets (iOS) plus keyboardDismissMode="interactive" to the ScrollView at line 387 (or wrap it in the same KeyboardAvoidingView pattern used by the auth screens), so the note inputs scroll above the keyboard while typing.

### F2 [HIGH] Schedule tab never surfaces load errors for a selected festival — failures render as 'No sets for this day'
- File: `packages/mobile/app/(tabs)/index.tsx:102,426,628-643`

The store's `error` is read (line 102) but only consumed in the no-festival picker branch (`festivals.length === 0 && error`, line 426). Once a festival is selected, a failed `selectFestival` (pull-to-refresh on flaky festival wifi, cold-start restore, server 500) leaves `sets` empty and the screen falls into the 'No sets for this day' / 'Set times not announced yet' EmptyState (lines 384-407 and the Cards ListEmptyComponent at 628-643) — an error presented as an empty schedule. The sibling Picks tab does this correctly with a full ladder: skeleton → `error && rows.length === 0` → 'Couldn't load your picks' EmptyState with a Try again action (picks.tsx:469-479). The two tabs read the same store but only one tells the user the truth.

**Fix:** Mirror picks.tsx: in the selected-festival branch, when `error && allSets.length === 0` render an EmptyState (icon cloud-offline-outline, message=error, action 'Try again' → selectFestival(currentFestival.id)) instead of the no-sets empty state; keep the existing empty states for the genuinely-empty case.

### F3 [HIGH] Residual coral-fill primary CTAs with white text — violates the shipped accent rule and fails WCAG AA
- File: `packages/mobile/app/reset-password.tsx:228`

The 2026-06-07 accent rule (documented in packages/shared/src/tokens/colors.ts:29-48) states aqua is the primary accent (with dark ink) and coral is reserved for danger/SOS; coral #ff3366 behind white text only reaches ~3.55:1 and FAILS AA. CrewSos.tsx:276-302 was correctly migrated to coralStrong, and login.tsx:232-234 documents the aqua-CTA rule — but six non-danger primary CTAs still use accent.coral fill + text.onAccent (#fff): reset-password.tsx:228+235 (Reset password button), components/ErrorBoundary.tsx:45+55 (Retry), app/wrap.tsx:727+736 and :763 (Share buttons), components/CrewHomeBase.tsx:230+237 (Save), components/CrewPhotoLink.tsx:231+238 (Save), components/TimelineView.tsx:411+563-565 (the 'Now' FAB). None of these are danger actions.

**Fix:** Switch each to the established primary-CTA pattern: backgroundColor t.colors.accent.aqua + color t.colors.text.onLightAccent (exactly as login.tsx's sign-in button). If any surface must stay coral for brand reasons (e.g. the Now FAB as a 'live' marker), use accent.coralStrong behind white text, which passes AA at ~6.04:1.

### F4 [HIGH] fontWeight overrides after typeStyle() are inert or faux-bold — the weighted font family wins on native
- File: `packages/mobile/hooks/useTokens.ts:67`

typeStyle() resolves the role's weight into a weight-specific family (e.g. caption -> 'SpaceGrotesk_400Regular'; useTokens.ts:65 even documents 'on native the weighted family is authoritative'). ~35 styles then spread typeStyle and override fontWeight ('600'/'700'/'800'), e.g. components/CrewTabBar.tsx:120-122, components/LiveBadge.tsx:67-68 (weight '800' has no loaded cut at all), components/NowNextStrip.tsx:128-129 and 153-155, components/SetCardMobile.tsx:429-435+461, components/TimelineView.tsx:521-523 and 563-565, components/PhaseHomeActions.tsx:112-115, app/(tabs)/crew.tsx:1194-1197 and 1317-1319, app/crew-plan.tsx:258-308, components/FreshnessChip.tsx:118-120, components/TBASection.tsx, components/OfflineBanner.tsx:229-230+300-301, components/CrewSos.tsx:250-253+305-307, components/MeetingPointCompass.tsx:276-278, components/AccountHistorySection.tsx:243-246, app/festival-mode.tsx:206-223, app/find.tsx:207-209, app/plan-share.tsx:111-113, app/set/[setId].tsx:940-941. The intended bolding either does nothing or renders synthesized faux-bold of the Regular cut, varying by platform — visible weight inconsistency across sibling badges/labels.

**Fix:** Extend typeStyle to accept an optional weight override — typeStyle(role, weight) — that re-runs nativeFontFamily(r.family, weight) so the correct SpaceGrotesk_500/600/700 cut is selected (clamp 800/900 to 700Bold), then sweep all `...typeStyle(...), fontWeight:` sites to use it and delete the raw fontWeight overrides.

### F5 [HIGH] Crew save buttons still use forbidden coral fill + white text (accent-rule violation, AA fail)
- File: `packages/mobile/components/CrewHomeBase.tsx:229 (also CrewPhotoLink.tsx:230)`

CrewHomeBase and CrewPhotoLink `saveButton` is `backgroundColor: t.colors.accent.coral` with `saveButtonText: color: t.colors.text.onAccent` (white). The token file itself (packages/shared/src/tokens/colors.ts:30-40) documents the user-approved rule: coral is danger/SOS only, and white-on-coral #ff3366 is ~3.55:1, failing WCAG AA. All six sibling crew components (CrewExpenses/Packing/Polls/Rides/Status/MeetingPoints) were migrated to the aqua `primaryButton` with the comment 'accent rule: aqua primary + dark ink' — these two files were simply missed in that sweep.

**Fix:** In CrewHomeBase.tsx and CrewPhotoLink.tsx change saveButton to backgroundColor: t.colors.accent.aqua and saveButtonText to color: t.colors.text.onLightAccent, matching the six sibling crew components verbatim.

### F6 [HIGH] FestivalList puts white text/icon on aqua fill (~1.45:1 contrast) — retry button and Live badge
- File: `packages/mobile/components/FestivalList.tsx:15,189,255`

statusBadge 'Live' returns `fg: colors.text.onAccent` (white) on `bg: colors.accent.aqua`, and retryButton renders a white refresh icon (line 189) + `retryText: color: colors.text.onAccent` (line 255) on an aqua fill (line 249). White on #00e8d0 is roughly 1.4:1 — unreadable, far below AA. Every other aqua-filled control in the app (SegmentedControl labelActive, EmptyState actionText, FirstRunIntro buttonText, all crew primaryButtonText) correctly uses text.onLightAccent (#080810), which the token doc states is the AA-safe pair.

**Fix:** Replace colors.text.onAccent with colors.text.onLightAccent for the Live badge fg, the retryText color, and the Ionicons refresh color in FestivalList.tsx.

### F7 [HIGH] FestivalList bypasses brand typography and the useTokens convention entirely
- File: `packages/mobile/components/FestivalList.tsx:4,276-340`

FestivalList (the festival picker — a first-run, high-traffic surface) is one of only three text-bearing components that never call typeStyle(): festivalName is raw `fontSize: fontSize[18], fontWeight: '700'`, metaText/emptySubtitle raw fontSize[14], badgeText raw fontSize[12] — all rendering in the system font, not Space Grotesk. It also imports tokens directly (`import { colors, spacing, fontSize, radii } from '@festie/shared/tokens'`) and uses StyleSheet.create instead of the makeStyles/useTokens seam that hooks/useTokens.ts documents as 'the single seam a future theme switch hooks into'. This silently undoes the shipped 'mobile brand fonts' P0 on this screen.

**Fix:** Convert FestivalList to makeStyles((t) => ...) and map festivalName -> typeStyle('title'), metaText/emptySubtitle -> typeStyle('caption')/('body'), badgeText -> typeStyle('micro' or 'caption'), retryText -> typeStyle('label').

### F8 [HIGH] Primary button defined ~12 times with height/padding/disabled-opacity drift — extract a Button component
- File: `packages/mobile/components/CrewExpenses.tsx:793 (and 11 siblings)`

The aqua primary button is re-declared verbatim (same 6-line style + same accent-rule comment) in six crew components (CrewExpenses:793, CrewPacking:232, CrewPolls:585, CrewRides:281, CrewStatus:536, CrewMeetingPoints:421), and re-rolled with drift in at least six more: FirstRunIntro:267 (paddingVertical spacing[4] + minHeight 44), SmsHandoff:201 (row layout, disabled opacity 0.5 vs everyone else's 0.6), EmptyState:81 (paddingVertical spacing[3], no minHeight), AccountPasswordSection submit:227 (minHeight 48 — the only 48px one; other Account sections repeat it), FestivalList retryButton:242, PlanQRScan. That is ~12 definitions of one concept with three different heights (none/44/48), two disabled opacities, and two text tokens. The secondary/outline aqua variant is likewise re-rolled 5 ways (AccountAvatarSection btnPrimary:257, CrewSos bannerButtonOutline:284, ClashPrompt keepButton:167, CrewLiveLocation stopButton:417, CrewStatus headerButton:399).

**Fix:** Create components/ui/Button.tsx with variants {primary: aqua fill + onLightAccent, secondary: aqua border + aqua text, ghost: borderless muted, danger: coralStrong fill + onAccent} and fixed specs (minHeight 48, radii.default, disabled opacity 0.6, optional leading icon), then replace the per-file styles. The six identical crew copies are a mechanical swap; do those first.

### F9 [HIGH] Forgot-password error box is still coral-on-coral (unimplemented P0-1 remnant)
- File: `packages/web/src/routes/forgot-password.tsx:97`

The only piece of P0-1 (white/coral contrast cluster) that never landed. Line 97 still reads `bg-accent-coral bg-opacity-10 border-accent-coral border-opacity-30 ... text-accent-coral`. `bg-opacity-*` is a dead utility in Tailwind v4, so the box renders a SOLID coral fill under coral text (~1:1) — the reset-error message is unreadable exactly when a user is locked out. Every other P0-1 surface verified fixed: SOS uses `accent.coralStrong` (CrewSos.tsx:302), wrap tabs no longer use bg-accent-coral, mobile crew CTAs are aqua (crew.tsx:1090-1091), FirstRunIntro CTA is aqua (FirstRunIntro.tsx:268-273).

**Fix:** Use v4 slash syntax as the roadmap prescribed: `bg-accent-coral/10 border-accent-coral/30 text-accent-coral`.

### F10 [MEDIUM] Pushed screens privacy and crew-plan have no visible back/close affordance on iOS
- File: `packages/mobile/app/privacy.tsx (also packages/mobile/app/crew-plan.tsx:120-144)`

privacy is pushed as presentation:'card' with headerShown:false (app/_layout.tsx:277) from account.tsx:212 and — worse — mid-registration from (auth)/register.tsx:203. crew-plan likewise sets headerShown:false (crew-plan.tsx:120/130/143) and is pushed from crew.tsx:849. Both render ScreenHeader, which has no back button slot (components/ScreenHeader.tsx renders only icon+title+right), and neither file contains any router.back call (grep confirms the only back affordance in app/ is set-detail's CloseButton). On iOS the ONLY way off these screens is the undiscoverable left-edge swipe; HIG requires a visible back button on pushed navigation-stack screens. Sibling pushed routes (map, compass, find, festival-mode, wrap, plan-share, crew-compare) all flip headerShown:true and get the native back chevron — these two are the inconsistent stragglers.

**Fix:** Set headerShown:true with a title for privacy and crew-plan like their sibling routes (the root Stack already styles headers dark), or add a leading back-chevron prop to ScreenHeader and wire it to router.back() on both screens.

### F11 [MEDIUM] Set-detail sheet content ignores the home-indicator inset, violating its own useListBottomInset contract
- File: `packages/mobile/app/set/[setId].tsx:748-752`

styles.content uses paddingBottom: t.spacing[6] (a fixed 24px) and the file never calls useListBottomInset, yet hooks/useListBottomInset.ts:69 explicitly lists 'Set detail app/set/[setId].tsx' under 'Non-tab / stack / modal surfaces (MUST include the inset)'. At the 1.0 detent the formSheet reaches the bottom of the screen, so on home-indicator iPhones the last element — the Crew note TextInput — sits partially under the indicator (the hook's doc block at lines 22-24 also notes Android-based CI screenshots cannot catch this).

**Fix:** Replace the fixed paddingBottom with const bottomPad = useListBottomInset() and apply contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}, matching crew-plan.tsx:94/145.

### F12 [MEDIUM] No Dynamic Type strategy: zero maxFontSizeMultiplier caps and counter-scaling shrink-to-fit headers
- File: `packages/mobile/hooks/useTokens.ts:67-83 (typeStyle), packages/mobile/components/ScreenHeader.tsx:43-51`

A repo-wide grep finds no maxFontSizeMultiplier or allowFontScaling anywhere in packages/mobile, so every Text scales unboundedly with iOS accessibility text sizes (up to ~3.1x at AX5). The type ramp includes a 10px 'micro' role used in single-line numberOfLines={1} pills (set-detail stagePill line 404, genre chips, day chips in (tabs)/index.tsx:516) that will truncate rather than wrap at large sizes, and ScreenHeader's adjustsFontSizeToFit + minimumFontScale={0.7} actively shrinks the screen title back down, partially defeating the user's accessibility setting. HIG requires apps to support Dynamic Type predictably; today behavior at AX sizes is untested and inconsistent (some text grows, the most prominent text shrinks).

**Fix:** Adopt an explicit policy: add maxFontSizeMultiplier (~1.5-2.0) to typeStyle-consuming Text in fixed/single-line decorative contexts (chips, pills, badges), allow body/notes text to scale fully, and remove or relax the header minimumFontScale; verify the schedule, set detail, and crew flows once at AX3+.

### F13 [MEDIUM] Wrap screen uses coral for the primary share CTA and the active tab — direct violation of the shipped accent rule
- File: `packages/mobile/app/wrap.tsx:727,763`

`shareButton.backgroundColor: t.colors.accent.coral` (line 727) and `tabActive.backgroundColor: t.colors.accent.coral` (line 763) make 'Share your wrap' and the You/Crew-wrap tab selection coral. The 2026-06-07 design review's P0 established aqua = primary/selection, coral = danger/SOS only, and every other screen in the app now follows it (login/register/crew/picks all carry explicit comments citing the rule). Wrap is the one screen that slipped: a celebratory share action rendered in the danger color, and a coral selected-tab state that contradicts the aqua SegmentedControl on Schedule.

**Fix:** Change shareButton fill to t.colors.accent.aqua with t.colors.text.onLightAccent ink, and tabActive to the aqua selection treatment used by SegmentedControl/plan-share's tabActive.

### F14 [MEDIUM] Auth screens (the first brand touchpoint) bypass the brand type system entirely
- File: `packages/mobile/app/(auth)/login.tsx:173-185`

login.tsx and register.tsx use plain StyleSheet.create with raw `fontSize[32]/fontWeight '700'` (login.tsx 173-178, register.tsx 263-268) instead of `typeStyle()` from hooks/useTokens.ts, which is what resolves the Syncopate display / Space Grotesk body brand fonts (useTokens.ts:46-83). Result: the 'Festie' wordmark and all auth copy render in the system font while every post-auth screen renders in brand faces — the first screen a new user sees is the only off-brand one. The 'mobile brand fonts' item was a P0 of the 2026-06-07 review; these two screens (plus forgot-password, same pattern) were missed.

**Fix:** Convert login/register/forgot-password to makeStyles + typeStyle: title → a display role (Syncopate), subtitle/inputs/buttons → body/label roles, matching the rest of the app.

### F15 [MEDIUM] Set-detail note inputs sit at the bottom of a ScrollView with no keyboard avoidance
- File: `packages/mobile/app/set/[setId].tsx:387-390,663-687`

The 'Your note' and 'Crew note' multiline TextInputs are the last elements of the detail ScrollView, but unlike crew.tsx and account.tsx (both wrap in KeyboardAvoidingView) this screen has neither KeyboardAvoidingView nor the ScrollView's `automaticallyAdjustKeyboardInsets`. Tapping a note field raises the keyboard directly over the input the user is typing into, especially in the formSheet presentation where the sheet already sits low. The 500ms debounced save means users also get no feedback that text hidden behind the keyboard was captured.

**Fix:** Add automaticallyAdjustKeyboardInsets to the ScrollView (or wrap in KeyboardAvoidingView with behavior='padding'), consistent with crew.tsx:559.

### F16 [MEDIUM] Coral used for meeting-point/location semantics, diluting the coral=danger rule
- File: `packages/mobile/app/find.tsx:126`

Navigable meeting-point rows in find.tsx render their pin icon in `t.colors.accent.coral` (line 126), and crew-plan.tsx's 'Meet up' card header icon is also coral (crew-plan.tsx:151). Per the shipped accent rule (and the comments throughout crew.tsx/login.tsx: 'coral is reserved for danger/SOS only'), a routine meeting point should not share the SOS color — especially on the find/map surfaces where coral specifically must mean 'someone needs help'. The non-navigable row state correctly uses muted, making the coral read as 'alert' rather than 'active'.

**Fix:** Switch the meeting-point pin and crew-plan 'Meet up' icon to aqua (selection/primary) or amber (attention), reserving coral on these surfaces for the SOS layer.

### F17 [MEDIUM] plan-share bypasses useHaptics with a direct expo-haptics call, breaking the Android platform split
- File: `packages/mobile/app/plan-share.tsx:8,36-40`

plan-share.tsx imports `* as Haptics from 'expo-haptics'` and calls `Haptics.selectionAsync().catch(() => {})` on its Share/Scan tab switch. Every other haptic in the app (14 call sites) goes through hooks/useHaptics.ts, whose documented contract is: iOS = expo-haptics Taptic, Android = tuned RN Vibration patterns (select = 30ms). This one call gives Android users a different, untuned buzz than every other selection in the app and is the single place the vocabulary can drift.

**Fix:** Replace the direct import with `const haptics = useHaptics()` and call `haptics.select()` in selectTab. Optionally add a lint rule (no-restricted-imports for 'expo-haptics' outside hooks/useHaptics.ts) so it can't recur.

### F18 [MEDIUM] Selection haptic is applied inconsistently across equivalent controls
- File: `packages/mobile/components/RatingButtons.tsx:94-105`

The de-facto rule is 'selection-type taps call haptics.select()': priority buttons (SetCardMobile.tsx:123), day chips (app/(tabs)/index.tsx:507), reminders and clash-clear (app/set/[setId].tsx:295,316), poll votes (CrewPolls.tsx:177), plan-share tabs. But four equivalent controls are silent: RatingButtons emoji rating (a radio-group selection, no haptic at all), SegmentedControl view switch (SegmentedControl.tsx:86-98 — it even animates a press squish but never buzzes), CrewTabBar tab change (CrewTabBar.tsx:46-55), and the stage/only-mine filter chips sitting directly below the buzzing day chips (index.tsx:535-539). Same screen, same gesture class, randomly different feedback — this is the definition of an incoherent haptic pattern.

**Fix:** Add `haptics.select()` to RatingButtons.handlePress, SegmentedControl's Segment onPress, CrewTabBar's onPress (when key !== activeTab), and the filter-chip onPress handlers in app/(tabs)/index.tsx. Also CrewPacking.tsx:147 check-off is a natural `select()` candidate.

### F19 [MEDIUM] FreshnessChip surface="schedule" is implemented but never mounted — the flagship offline surface has no staleness indicator
- File: `packages/mobile/app/(tabs)/index.tsx`

FreshnessChip.tsx explicitly supports `surface: 'schedule'` driven by `festivalDataStore._festivalCachedAt` (FreshnessChip.tsx:7,36-37), and `_festivalCachedAt` is persisted exactly for this (festivalDataStore.ts:535). But a repo-wide grep finds zero `surface="schedule"` usages — only crew surfaces render it (crew.tsx:572, crew-plan.tsx:146, map.tsx:79). The OfflineBanner's own copy says "You're offline — showing your saved schedule" (OfflineBanner.tsx:98-99), yet the schedule screen itself never shows how old that saved schedule is, while every crew surface does. Inconsistent sibling treatment of the project's #1 priority (offline mode).

**Fix:** Render <FreshnessChip surface="schedule" /> in index.tsx's selected-festival chrome (e.g. inside the `controls` block next to NowNextStrip, or in the viewSwitcher row), matching the crew tab's placement.

### F20 [MEDIUM] FestivalList empty state says 'Pull down to refresh' but is not scrollable — the instruction cannot be followed
- File: `packages/mobile/components/FestivalList.tsx:197-205`

The `!isLoading && festivals.length === 0` branch returns a plain centered <View> with subtitle 'Pull down to refresh'. There is no ScrollView/FlatList and no RefreshControl in that branch — the RefreshControl only exists on the populated list (lines 214-222). A user who hits this state (slow first load, server hiccup returning []) is told to do a gesture that does nothing; the only escape is killing the app.

**Fix:** Wrap the empty state in a ScrollView with `contentContainerStyle={{flexGrow:1}}` and the same RefreshControl, or replace it with the shared EmptyState plus an explicit 'Refresh' action button calling loadFestivals().

### F21 [MEDIUM] Festival-picker loading/error handled twice with conflicting presentations — index.tsx spinner pre-empts FestivalList's skeleton
- File: `packages/mobile/app/(tabs)/index.tsx:424-435`

index.tsx wraps FestivalList with its own `festivals.length === 0 && isLoading → LoadingState('Loading festivals…')` and `error → EmptyState` branches (424-432), while FestivalList itself contains a skeleton loading state (FestivalList.tsx:166-180), a bespoke error block that does NOT use the shared EmptyState (alert-circle icon + custom retryButton, 183-194), and its own empty state (197-205). The outer branches always win, so FestivalList's skeleton is dead code on the only screen that renders it, and the app has two different-looking error UIs for the identical condition depending on which layer catches it first. This is exactly the 'inconsistent state handling between siblings' smell, compressed into one screen.

**Fix:** Delete the loading/error branches from index.tsx and make FestivalList the single owner of its states (it already has the better skeleton treatment), converting its bespoke error block to the shared EmptyState with a retry action.

### F22 [MEDIUM] Poll voting gives no instant feedback — and appears to silently do nothing offline
- File: `packages/shared/src/stores/crewStore.ts:580-594`

votePoll is the only key mutation with no optimistic path: it POSTs, then refetches ALL polls before `myVote` changes (crewStore.ts:583-585). The UI's only response is `disabled={voteBusy}` on every option button with no style change, spinner, or checkmark until the round-trip + refetch completes (CrewPolls.tsx:175-186, 431-450). Contrast siblings: picks update local state BEFORE the network call (festivalDataStore.ts:323-330 'Optimistic: ... the star fills immediately even if we're offline') and expenses insert an optimistic placeholder via onOptimisticCreate (crewStore.ts:1186-1204). Offline, the vote's refetch fails (best-effort catch at 586-588), so the tap produces zero visible change — on festival-grade signal, voting feels broken.

**Fix:** Optimistically write the user's vote into the local poll's votes map in votePoll before the POST (rolling back on error, as savePick does), or at minimum render a per-option busy indicator in CrewPolls while the vote is in flight.

### F23 [MEDIUM] Auth screens and FestivalList bypass typeStyle — system font instead of brand typography on first-run surfaces
- File: `packages/mobile/app/(auth)/login.tsx:173`

The brand-font migration routes text through typeStyle() so Space Grotesk / Syncopate families are applied (raw fontWeight alone never selects a brand cut — see useTokens.ts:38-44). But five screens still build text styles from raw fontSize[..] + fontWeight via module-level StyleSheet.create with no fontFamily: app/(auth)/login.tsx:173-191 (incl. the 'Festie' title at fontSize[32]/'700'), app/(auth)/register.tsx:264-372, app/(auth)/forgot-password.tsx, app/reset-password.tsx:217-237, components/FestivalList.tsx:236-265. These render entirely in the system font — and they are the first screens a new user sees, so the brand typography shipped in the design review is absent exactly where first impressions form.

**Fix:** Migrate these styles to makeStyles((t)=>...) with ...typeStyle(role) spreads (title -> a display role, body/captions -> body roles), matching the pattern used everywhere else (e.g. components/PlanQRShare.tsx:157-190).

### F24 [MEDIUM] iOS Live Activity uses off-brand aqua #16E0C8 instead of token aqua #00e8d0
- File: `packages/mobile/widgets/NowNextActivity.tsx:24`

const AQUA = '#16E0C8' drives every accent in the Lock Screen banner and Dynamic Island, and the file's own comment (lines 13-15) claims 'Brand: aqua accent'. The brand aqua token is #00e8d0 (packages/shared/src/tokens/colors.ts:45). #16E0C8 is a visibly different teal that exists nowhere in the palette, so the most prominent off-app brand surface (Dynamic Island) is off-brand.

**Fix:** Change the literal to '#00e8d0'. If the expo-widgets 'widget' compiler permits module imports, import colors from '@festie/shared/tokens' and use colors.accent.aqua; otherwise keep the literal with a sync comment mirroring CrewWrapPoster's poster-intent note.

### F25 [MEDIUM] Share posters render the FESTIE wordmark and all text in the system font, not the brand fonts
- File: `packages/mobile/components/WrapPoster.tsx:108`

The web posters set fontFamily Syncopate for the wordmark and Space Grotesk for body (packages/web/src/components/features/WrapPoster.tsx:63,74 and CrewWrapPoster.tsx:96,107). The native mirrors set no fontFamily at all — WrapPoster.tsx:108-114 (wordmark fontSize 96 / fontWeight '900') and CrewWrapPoster.tsx:145 — so the captured PNG shared to social stories shows the FESTIE wordmark in San Francisco/Roboto. The header comments only excuse gradients ('RN can't gradient-clip text'), not fonts, and Syncopate_700Bold / SpaceGrotesk cuts are already loaded at bootstrap (app/_layout.tsx:85-86), so this is fixable, not a platform limitation.

**Fix:** Add fontFamily: 'Syncopate_700Bold' to the wordmark styles and the appropriate SpaceGrotesk_* cuts to the other poster text styles in both WrapPoster.tsx and CrewWrapPoster.tsx (drop the now-inert '900'/'800' fontWeight values).

### F26 [MEDIUM] Server-supplied stage colors used as text with no contrast floor
- File: `packages/mobile/app/set/[setId].tsx:403-406`

The set-detail stage pill renders `color: stageColor` on a `stageColor + '25'` (15% alpha over #080810) background, and TimelineView's stage header (packages/mobile/components/TimelineView.tsx:118-122) renders the stage name in `stageColor` on bg.sticky #14142a. Stage colors come from the API and have no AA guarantee when used as TEXT: even the curated 'accessible' purple token #9c4dcb only reaches 4.12:1 vs #080810 and 3.73:1 vs #14142a (label/micro type sizes need 4.5:1); arbitrary festival colors (e.g. a #b05c10 amber-brown at 4.17:1, or anything darker) fail outright. The shared `ensureWhiteContrast` (packages/shared/src/utils/contrast.ts:47) protects white-on-stage-color fills (SetCardMobile uses it) but nothing protects stage-color-as-text — the inverse case. safeStageColor (packages/mobile/lib/stageColor.ts) only guards against `var(...)` strings, not contrast.

**Fix:** Add a shared `ensureTextContrastOnDark(hex, bgHex)` helper in packages/shared/src/utils/contrast.ts (the lighten mirror of ensureWhiteContrast: scale linear luminance UP until the ratio vs the dark bg reaches 4.6:1) and route both stage-text call sites (set/[setId].tsx stagePill text, TimelineView stageHeaderText) through it. Keep the raw stage color for the border-left rails and dots (non-text, 3:1 not required at those sizes is already borderline-fine).

### F27 [MEDIUM] "Who's going" priority is conveyed by color alone
- File: `packages/mobile/app/set/[setId].tsx:647-654`

Each crew row in the set-detail "Who's Going" section is an 8px dot tinted by priority (must=coral, want=aqua, maybe=amber) next to the member name. The priority tier is communicated ONLY by the dot's color — WCAG 1.4.1 (Use of Color) failure for color-blind users, and completely invisible to VoiceOver/TalkBack (the row has no accessibilityLabel; the screen reader hears just the name). SetCardMobile's CrewCluster already solves this pattern correctly with its "N must, N want" breakdown label (SetCardMobile.tsx:313) — the detail screen regressed to color-only.

**Fix:** Append the priority as text or a11y metadata per row: give the row View `accessible` + `accessibilityLabel={`${o.name}, ${priorityLabel}`}` and add a small text suffix (e.g. "· Must") or reuse the icon set (star/heart/ellipse) next to the dot so the tier is legible without color.

### F28 [MEDIUM] Conflict "Switch" button is ~29pt tall with no hitSlop
- File: `packages/mobile/app/set/[setId].tsx:879-885`

The `switchButton` style (used by the per-conflict Switch action at lines 534-542) has `paddingVertical: t.spacing[1]` (4px) around a 14px label (~21px line-height) → roughly 29pt total height, with no `minHeight` and no `hitSlop`. Every other actionable chip in the app was lifted to a 44pt floor in the 2026-06-07 pass (dayChip, filterChip, reminderChip, priorityButton, iconButton all carry explicit `minHeight: 44` comments); this one was missed. It sits in a stacked list of conflict rows, so mis-taps hit the adjacent row.

**Fix:** Add `minHeight: 44` + `justifyContent: 'center'` to `switchButton` (matching the established pattern), or `hitSlop={{ top: 8, bottom: 8 }}` if the compact visual is preferred — minHeight is the codebase convention.

### F29 [MEDIUM] Crew tab badges (open polls / unsettled money) are invisible to screen readers
- File: `packages/mobile/components/CrewTabBar.tsx:52-64`

Each tab TouchableOpacity sets `accessibilityLabel={tab.label}`, which makes it an accessible container and flattens its children — the inner badge Views' own labels (`${badge} open` at line 59, "Needs attention" at line 63) are never reachable or announced. A VoiceOver/TalkBack user hears "Plan, tab" with no clue there are 3 open polls, and "Money, tab" with no hint of an unsettled balance — the exact signal the badges exist to carry (crew.tsx:643 wires `badges={{ plan: openPollCount, money: hasUnsettledBalance }}`).

**Fix:** Fold the badge into the tab's own label: `accessibilityLabel={badge ? (typeof badge === 'number' ? `${tab.label}, ${badge} open` : `${tab.label}, needs attention`) : tab.label}` and drop the dead inner accessibilityLabels.

### F30 [MEDIUM] Stale iconButton variants missing the 44pt touch-target floor
- File: `packages/mobile/components/CrewHomeBase.tsx:216 (also CrewPhotoLink.tsx:213, ClashPrompt.tsx:167, CrewStatus.tsx:403)`

Six crew components carry the upgraded iconButton (`minWidth/minHeight: 44` with the WCAG 2.5.5 comment), but CrewHomeBase.tsx:216 and CrewPhotoLink.tsx:213 still have the pre-fix version (`padding: t.spacing[1]` only — a ~24px target around a 16-18px icon). Similarly ClashPrompt's keepButton/dismissButton (paddingVertical spacing[2], no minHeight ≈ 36px tall) and CrewStatus headerButton (same paddings) sit below the 44pt floor that SegmentedControl, CrewTabBar, SetCardMobile priorityButton, and the other crew iconButtons all enforce with explicit comments. Same components, same control class, different reachability.

**Fix:** Copy the 44pt iconButton block (minWidth/minHeight 44 + center alignment) into CrewHomeBase and CrewPhotoLink, and add minHeight: 44 to ClashPrompt keepButton/dismissButton and CrewStatus headerButton (hitSlop is an acceptable alternative where layout is tight).

### F31 [MEDIUM] LiveBadge uses plain coral behind white micro text — fails AA where CrewSos already solved it
- File: `packages/mobile/components/LiveBadge.tsx:58-70`

livePill is `backgroundColor: t.colors.accent.coral` with white dot and white uppercase micro (10px) text via text.onAccent — ~3.55:1, failing AA for small text. The token doc (colors.ts:37-40) says coralStrong (#c01d3a, ~6.04:1 vs white) exists precisely for 'whenever coral is the fill behind white label text', and CrewSos.tsx:274-282 and sosButton already apply it with that exact rationale. LiveBadge is the one remaining white-on-plain-coral fill.

**Fix:** Change livePill backgroundColor to t.colors.accent.coralStrong (dot and text stay onAccent white).

### F32 [MEDIUM] Two input families with inconsistent focus treatment — most inputs have no focus state at all
- File: `packages/mobile/components/CrewHomeBase.tsx (input) vs AccountPasswordSection.tsx:212`

Inputs split into two visual families: (A) crew + auth — bg.input, border.default, paddingHorizontal spacing[4], no minHeight (CrewHomeBase/Expenses/Polls/Rides/Status/Packing/MeetingPoints/PhotoLink, app/(auth)/login.tsx); (B) account sections — bg.primary, border.light, paddingHorizontal spacing[3], minHeight 48 (AccountPasswordSection.tsx:212, AccountDisplayName, AccountPaymentHandles, AccountDanger). Worse, the focused state (aqua border + ring.aqua bg, defined as inputFocused in login.tsx/register.tsx/AccountDisplayNameSection.tsx) exists on only 3 of ~15 input sites — every crew TextInput gives zero visual focus feedback, and only the account family guarantees the 44pt+ height. Error text styling also lives only in the account family.

**Fix:** Extract components/ui/TextField.tsx standardizing on bg.input + border.default base, minHeight 48, the existing aqua inputFocused treatment, and a caption/text.danger error slot; migrate the ~15 call sites. The focus-state and minHeight gaps are the objective part regardless of which family's cosmetics win.

### F33 [MEDIUM] Mobile register: email required but fails silently, placeholder bare 'Email' — diverges from web's optional policy
- File: `packages/mobile/app/(auth)/register.tsx:51`

Internal-review Medium item, verified still unfixed. Line 51 `if (!username.trim() || !email.trim() || !password.trim()) return;` makes Create Account a dead button with no inline error when email is empty; placeholder is bare "Email" (line 116). Web register makes email optional with sr-label "Email (optional)" and validates only when present (web register.tsx:62,77,183). Same form, opposite policy, and the mobile failure mode is invisible.

**Fix:** Show a specific inline error (the screen already has an `error` alert region at line 91-95) instead of the silent return, and change the placeholder to "Email (for password reset)". Separately align the required-vs-optional policy with web (web's optional-with-helper is the documented model).

### F34 [LOW] Priority toggle gives haptic feedback on the schedule card but not on the set-detail sheet
- File: `packages/mobile/app/set/[setId].tsx:284-290`

handlePriority in set detail saves the pick with no haptic, while the exact same action on SetCardMobile fires haptics.select() (components/SetCardMobile.tsx:123), and the reminder chips two sections below on the same set-detail screen do fire haptics.select() (line 295). UIFeedbackGenerator guidance is to use feedback consistently for the same interaction — the most deliberate place to set a priority is the one place it's silent.

**Fix:** Add haptics.select() at the top of handlePriority (the useHaptics instance is already in scope at line 115); add it to the deps array like handleReminder does.

### F35 [LOW] Leftover diagnostic console.log fires on every Schedule render in production
- File: `packages/mobile/app/(tabs)/index.tsx:409-413`

`// [festie-diag] temporary instrumentation for the guest-selection E2E failure` followed by a console.log + JSON.stringify executed unconditionally in the component body. The Schedule screen re-renders on every search keystroke, store update, and 60s tick, so this stringifies and logs continuously on the app's busiest screen, shipped to prod.

**Fix:** Delete the [festie-diag] console.log block (or gate behind __DEV__).

### F36 [LOW] crew-compare day chips missed the 44pt touch-target fix applied everywhere else
- File: `packages/mobile/app/crew-compare.tsx:305-312`

`dayChip` here uses paddingVertical: t.spacing[2] with no minHeight, yielding a ~33pt target — while the identical day-chip pattern in (tabs)/index.tsx (lines 758-770) carries the explicit 'WCAG 2.5.5 / 2.5.8 minimum 44x44px' minHeight: 44 fix from the design-review P0. Same control, two heights; the compare grid is also a likely one-handed mid-crowd surface.

**Fix:** Add minHeight: 44 (and paddingVertical: t.spacing[3]) to crew-compare's dayChip to match index.tsx.

### F37 [LOW] KeyboardAvoidingView behavior 'height' on Android double-compensates with the default adjustResize/edge-to-edge keyboard handling
- File: `packages/mobile/app/(tabs)/account.tsx:98`

Six screens use behavior={Platform.OS === 'ios' ? 'padding' : 'height'}: login.tsx:49, register.tsx:79, forgot-password.tsx:61, reset-password.tsx:85, crew.tsx:456+559, account.tsx:98. app.json sets no android.softwareKeyboardLayoutMode, so the window already resizes for the keyboard (SDK 56's enforced edge-to-edge re-implements adjustResize via react-native-edge-to-edge). Stacking KAV 'height' on top of a window that already resizes is the documented RN anti-pattern — the RN docs themselves warn 'height' may cause issues on Android, and the symptom is a visible jump/over-shrink when the keyboard animates (most likely on crew.tsx, where the KAV wraps the entire tab screen including its FlatList).

**Fix:** Change the Android branch to undefined — behavior={Platform.OS === 'ios' ? 'padding' : undefined} — in all six files, letting the OS-level resize do the work alone. Verify the chat-style input on crew.tsx on the Android emulator afterward.

### F38 [LOW] Skeleton uses the legacy Animated API with hard-coded 750ms durations outside the token scale
- File: `packages/mobile/components/Skeleton.tsx:35-39`

Skeleton animates with RN's legacy `Animated` (timing 750ms literals) while LiveDot and SegmentedControl use Reanimated driven by shared tokens (duration.fast/med/slow from packages/shared/src/tokens/motion.ts:43-47). 750ms exists nowhere in the token scale (max is slow=320), so the shimmer cadence is undocumented and the package carries two animation systems. LiveDot's pulse (duration.slow per half-cycle) and Skeleton's (750ms per half-cycle) are both 'ambient pulse' motions running at unrelated speeds.

**Fix:** Add a `pulse: 750` (or similar ambient-loop value) to the shared duration tokens and reference it from Skeleton; align LiveDot's half-cycle to a tokenized ambient duration too. Optionally migrate Skeleton to Reanimated withRepeat for a single animation system, matching LiveDot's structure.

### F39 [LOW] Leftover [festie-diag] console.log instrumentation in two production render/select paths
- File: `packages/mobile/app/(tabs)/index.tsx:409-413`

Two 'temporary instrumentation for the guest-selection E2E failure' blocks shipped: index.tsx logs a JSON.stringify on EVERY render of the schedule screen (including each search keystroke, since search state lives in the component), and FestivalList.tsx:138-152 logs on every festival tap plus a post-select getState readback. Debug noise in production bundles and pointless per-keystroke serialization.

**Fix:** Remove the [festie-diag] console.log blocks from index.tsx (409-413) and FestivalList.tsx handleSelect (138-152) now that the E2E investigation is done.

### F40 [LOW] Wrap error state has no retry and discards the actual error message
- File: `packages/mobile/app/wrap.tsx:173-181`

When the wrap fetch fails, the EmptyState shows a generic 'Something went wrong loading your festival wrap.' with no action — the hook's `error` value is ignored and there is no retry path or pull-to-refresh on this screen; the user must back out and re-enter. Sibling error states (picks.tsx:471-479, index.tsx:427-432) both pass the store error through as the message and offer a 'Try again' action. The crew-wrap branch (~wrap.tsx:486-490) has the same gap.

**Fix:** Add an `action: { label: 'Try again', onPress: <refetch> }` to both wrap error EmptyStates and surface the hook's error string as the message, matching the picks/schedule pattern.

### F41 [LOW] crew-compare fetches data but offers no pull-to-refresh or error retry
- File: `packages/mobile/app/crew-compare.tsx:60-63,130`

The screen triggers a network load (loadOverlap, line 60-62) and renders potentially stale crew picks, but unlike every sibling data screen (schedule, picks, crew — all with RefreshControl) there is no way to re-fetch: errors render as a small inline red text line (line 130) with no retry, and the 'No crew picks yet' empty state can be a stale-cache artifact with no refresh affordance. A user waiting for a crewmate's picks to appear has to leave and re-enter the screen.

**Fix:** Add a RefreshControl to the vertical FlatList (or wrap the empty/loading branches in a refreshable ScrollView) calling loadOverlap + loadProfiles, and give the inline error a retry action.

### F42 [LOW] PlanQRScan overlay hardcodes #FFFFFF and a hand-rolled scrim where tokens exist
- File: `packages/mobile/components/PlanQRScan.tsx:304`

reticle borderColor '#FFFFFF' (line 304), hint color '#FFFFFF' (line 310) and hint backgroundColor 'rgba(8,8,16,0.8)' (line 311) bypass the token surface inside an otherwise fully tokenized makeStyles block. Tokens already cover these: colors.text.onAccent / colors.overlay.hi for the whites, and the shade scale (e.g. shade[10] rgba(0,0,0,0.75)) for the camera-overlay scrim — OfflineBanner.tsx:241 already uses shade[9] for exactly this purpose. (PlanQRShare's QR ink #080810/#FFFFFF is documented as intentional for camera contrast and is excluded.)

**Fix:** Replace '#FFFFFF' with t.colors.text.onAccent (or overlay.hi) and 'rgba(8,8,16,0.8)' with t.colors.shade[10] (or add a bg-primary-alpha token if the blue-black tint matters).

### F43 [LOW] Crew switcher chips ~37pt tall, below the 44pt floor
- File: `packages/mobile/app/(tabs)/crew.tsx:1151-1158`

`crewChip` (the horizontal multi-crew switcher rendered at crew.tsx:616-631) uses `paddingVertical: t.spacing[2]` (8px) around a 14px label → ~37pt height, with no `minHeight` and no hitSlop. Inconsistent with the 44pt floor applied to dayChip/filterChip/CrewTabBar tabs/iconButton elsewhere in the same screen (e.g. iconButton at crew.tsx:1117-1125 explicitly documents the 44pt guarantee).

**Fix:** Add `minHeight: 44` and `justifyContent: 'center'` to the `crewChip` style.

### F44 [LOW] RatingButtons radio uses `selected` instead of `checked` accessibilityState
- File: `packages/mobile/components/RatingButtons.tsx:100-102`

The emoji rating buttons declare `accessibilityRole="radio"` inside a `radiogroup` but set `accessibilityState={{ selected: active, disabled: busy }}`. Per the RN accessibility contract, radio/checkbox roles announce via the `checked` state key — TalkBack reads a radio's checked/not-checked from `checked`, so with only `selected` Android users hear no on/off state for the current rating. (The tab roles elsewhere correctly use `selected`; this is the one radio in the app.)

**Fix:** Change to `accessibilityState={{ checked: active, disabled: busy }}` (optionally keep `selected` too for iOS parity).

### F45 [LOW] Double "selected" announcement on priority/reminder toggles
- File: `packages/mobile/app/set/[setId].tsx:564-565`

Priority buttons (set/[setId].tsx:564-565), reminder chips (598-601), and SetCardMobile's PriorityButton (packages/mobile/components/SetCardMobile.tsx:128-129) set both `accessibilityState={{ selected: active }}` AND bake "(selected)" / "Reminder set…" phrasing into the accessibilityLabel. VoiceOver announces the state trait itself, so users hear "selected" twice ("Must See (selected), selected, button"). The reminder chip variant is fine (its label is action-phrased, not state-phrased); the "(selected)" suffixes are the redundancy.

**Fix:** Drop the "(selected)" suffix from the labels and let `accessibilityState.selected` carry the state — label stays `option.label` in both files.

### F46 [LOW] captureButton ('Use my location') duplicated verbatim across two crew components
- File: `packages/mobile/components/CrewStatus.tsx:496 (= CrewMeetingPoints.tsx:442)`

captureButton + captureButtonText are byte-identical 12-line blocks in CrewStatus.tsx:496-509 and CrewMeetingPoints.tsx:442-456 (row, border.default, bg.input, caption text). This is the same copy-drift pattern that produced the stale iconButton/saveButton above — the next styling sweep will fix one and miss the other.

**Fix:** Fold into the proposed ui/Button as a 'tonal/utility' variant (or a shared LocationCaptureButton), and delete both local copies.

### F47 [LOW] Dead `t.radii.sm ?? 6` fallback in CrewPacking and CrewRides
- File: `packages/mobile/components/CrewPacking.tsx:274 (also CrewRides.tsx:323)`

`borderRadius: t.radii.sm ?? 6` — radii.sm is a defined const (8, packages/shared/src/tokens/radii.ts), so the `?? 6` branch is unreachable, and it misleadingly implies the token might be absent (TBASection.tsx:253 uses t.radii.sm bare). Likely a remnant from before radii.sm existed.

**Fix:** Replace with `borderRadius: t.radii.sm` in both files.

### F48 [LOW] Hardcoded radius literals where exact tokens exist
- File: `packages/mobile/components/SetCardMobile.tsx:421 (also CrewActivity.tsx:122, CrewWrapPoster.tsx:169, WrapPoster.tsx:156, AccountAvatarSection.tsx:215)`

A handful of raw borderRadius numbers bypass the radii scale: SetCardMobile.tsx:421 uses 12 (literally radii.default), CrewActivity.tsx:122 uses 16 (between default 12 and lg 20), CrewWrapPoster.tsx:169 and WrapPoster.tsx:156 use 24, AccountAvatarSection.tsx:215/221 use 24 for the avatar preview, FirstRunIntro.tsx:260 uses 4 (= radii.xs). Circular cases (Avatar sz/2, LiveDot, MeetingPointCompass 100) are legitimately computed and fine. The 12 and 4 literals are straight token misses; 16/24 are off-scale values that quietly mint new radii.

**Fix:** Swap 12 -> t.radii.default and 4 -> t.radii.xs; snap the 16 to default or lg and the 24s to t.radii.lg (20) unless the poster crop genuinely needs 24, in which case add a radii.xl token rather than repeating the literal.

### F49 [LOW] P1-3 remainder: mobile timeline blocks don't express priority tiers (and no conflict-resolution prompt)
- File: `packages/mobile/components/TimelineView.tsx:169`

Most of P1-3 verified shipped: conflicts auto-flagged (picks.tsx:83, SetCardMobile 'Conflict' badge:215-218, coral border TimelineView:171), crew-plan badges now priority-driven (web crew-plan.tsx:23-26), reminders recompute on reconcile in the festival's timezone (hooks/useLocalReminders.ts:45,151 + zonedWallTimeToMs/setStatus tests — the old TZ bug is fixed). What's left: a picked set on the mobile timeline renders only generic `bg.hover` (line 169) regardless of must/want/maybe, even though `t.colors.priority.*` tokens exist and are used by FirstRunIntro's product visual and web crew-plan. The 'explicit conflict resolution prompt' sub-item also never went beyond the badge.

**Fix:** Drive the timeline block's border-left or background tint from `getMyPick(s.id)` using the existing priority tokens (must=coral, want=aqua, maybe=amber), keeping the coral conflict border distinct. Treat the resolution-prompt sub-item as optional backlog.

### F50 [LOW] Error-voice sweep (P2-3) incomplete: web still has 'Failed to …' toasts; mobile settled on 'Could not' instead of the documented 'Couldn't … Try again.'
- File: `packages/web/src/components/account/NotificationSection.tsx:33`

Mobile is now internally consistent ('Could not <verb> <object>.' across all Account components and CrewSos), but it standardized on a different contraction than the doc's house style ('Couldn't <verb>. Try again.'). Web still mixes voices: 'Failed to enable notifications' / 'Failed to disable' (NotificationSection.tsx:33,45), 'Failed to resend verification email' (UserMenuAccountSection.tsx:41), plus useOfflineQueue.ts. The point of P2-3 was one voice everywhere; the sweep stopped at the mobile/account boundary.

**Fix:** Pick the de facto winner ('Could not …') as the house style, update the roadmap doc to match, and convert the remaining web 'Failed to' fallback strings.

### F51 [LOW] Mobile pushed-screen header convention (P2-8) still mixed: crew-plan/privacy use custom ScreenHeader, wrap/map/find/crew-compare use native Stack headers
- File: `packages/mobile/app/crew-plan.tsx:120`

app/_layout.tsx:234-236 documents the convention ('non-modal pushed screens flip headerShown:true'), and wrap.tsx:290, map.tsx:53, find.tsx:49, crew-compare.tsx:270-274 follow it. But crew-plan.tsx:120-121 and privacy.tsx:405 set headerShown:false and render the custom tab-style ScreenHeader instead — exactly the 'two header systems on peer screens' the internal review flagged. SectionLabel and the duplicate Profile Photo heading from the same P2-8 cluster were verified fixed.

**Fix:** Convert crew-plan and privacy to the native Stack header convention (title via Stack.Screen options), reserving ScreenHeader for tab roots.

### F52 [LOW] Anti-slop `transition-all` ban only enforced at the spots the roadmap named; ~10 other web components still use it
- File: `packages/web/src/components/layout/SubHeader.tsx:213`

The cited P2-7 offenders were fixed (no hover:brightness-110 anywhere; admin bars now scaleX, TopSets.tsx:29; crew.tsx arrows now lucide). But `transition-all` — barred by the project's own anti-slop checklist — persists in SubHeader.tsx:213,251, TimelineGridCell.tsx:167, TBASection.tsx:121, DetailPanel.tsx:263,272, DetailReminderPicker.tsx:19, DetailPriorityPicker.tsx:30, FestivalModeToggle.tsx:51, Onboarding.tsx:145, SetCard.tsx:247, RatingButtons.tsx:149, Header.tsx:154, PollOptionButton.tsx:44.

**Fix:** Sweep each to the narrowest property (`transition-colors`, `transition-transform`, or an explicit list). Mechanical change; behavior-identical.

