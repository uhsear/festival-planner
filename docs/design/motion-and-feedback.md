# Motion, Haptics & Feedback Vocabulary

Design system reference for the Festie mobile app. These rules exist so every
new component makes the same decisions without re-litigating them. The raw
materials live in:

- `packages/shared/src/tokens/motion.ts` — `duration` + `easing` tokens
- `packages/mobile/hooks/useHaptics.ts` — four-verb haptic API
- `packages/mobile/hooks/useReduceMotion.ts` — OS reduce-motion gate
- `packages/mobile/components/PressableScale.tsx` — squish primitive (small controls)
- `packages/mobile/components/AppPressable.tsx` — fade/ripple primitive (large surfaces)

---

## 1. Motion/Haptic Vocabulary Table (DC23)

Every interaction class maps to exactly one duration + easing + haptic triple.
When in doubt, match the class here rather than inventing new values.

| Interaction class | Duration | Easing | Haptic | Motion primitive |
|---|---|---|---|---|
| **Press down** (visual only, no state change) | `duration.fast` (120ms) | `easing.out` | none | `PressableScale` in / `AppPressable` press |
| **Press release** (spring back) | `duration.med` (200ms) | `easing.spring` | none | `PressableScale` out |
| **Selection / toggle** (chips, tabs, priority, rating) | `duration.med` (200ms) | `easing.standard` | `haptics.select()` | `PressableScale` + animated fill |
| **View-mode / day switch** (SegmentedControl thumb, day chips) | `duration.med` (200ms) | `easing.standard` | `haptics.select()` | Sliding thumb (`withTiming`) |
| **Confirmation** (form save, pick set, vote) | `duration.med` (200ms) | `easing.spring` | `haptics.success()` | scale pop 1→1.12→1 + color interpolation |
| **Destructive confirmation** (delete, clear pick) | `duration.fast` (120ms) | `easing.out` | `haptics.warning()` | color flash to `coralStrong` |
| **Warning / conflict surfaced** (ClashPrompt mount) | — | — | `haptics.warning()` | static (no layout motion) |
| **Layout change** (list item add/remove, packing, polls) | `duration.med` (200ms) | `easing.standard` | none | `LinearTransition` / `FadeIn` + `FadeOut` |
| **Ambient pulse** (LiveDot breathing, Skeleton shimmer) | 750ms per half-cycle | `easing.standard` | none | `withRepeat` / `Animated.timing` |
| **Navigation / page swipe** | platform default | platform default | none | `ScrollView pagingEnabled` |

### Rules

- **Always gate animation behind `useReduceMotion()`** — when true, skip
  `withTiming`/`withSpring` calls or pass `duration: 0`.
- **`haptics.warning()` fires once per event** — mount-time, not on each re-render.
  Do not fire it in a tick or polling loop.
- **Never call `expo-haptics` directly** — always go through `useHaptics()` so the
  Android Vibration pattern (30ms select / 50/30/50 warning) stays in sync with
  the iOS Taptic calls. The one exception currently in the codebase
  (`plan-share.tsx`) is a known violation tracked as F17.
- **No magic duration literals** — use `duration.fast / .med / .slow` from
  `@festie/shared/tokens`. The 750ms ambient-pulse value is the single exception
  and should be added as `duration.pulse` in a future tokens update (F38).

---

## 2. Loading-State Rule: Skeletons vs Spinners (DC24)

Use the treatment that matches how much layout information is known at load time.

| Situation | Treatment | Rationale |
|---|---|---|
| List or grid screen with known geometry | **Content-shaped skeleton** (`PicksSkeleton`, `WrapSkeleton`, crew geometry skeleton) | Zero layout jump; perceived performance |
| Indeterminate resolve: deep links, auth gates, modal opens | **`<LoadingState />`** (shared spinner component) | Layout is unknown; a skeleton would guess wrong |
| Inline button busy state | **`<ActivityIndicator size="small" />`** inside the button | Contained; not a screen-level loading state |

### Corollary

Do **not** use a raw `<ActivityIndicator />` at the screen level — wrap it in
`<LoadingState />` so the aqua color, sizing, and accessibility role stay
consistent. The deep-link resolve in `app/set/[setId].tsx` was the last raw
`ActivityIndicator` screen-level call; it has been replaced (DC24).

Crew-compare (`app/crew-compare.tsx`) currently uses `LoadingState` because its
grid geometry is less predictable. Add a bespoke skeleton there only if real
usage shows the spinner as a pain point.

---

## 3. Pill / Chip Grammar (DC27)

Two visual treatments for selected pills exist in the app. They are
**semantically distinct**, not inconsistent:

| Treatment | Example | Semantics |
|---|---|---|
| **Filled aqua** — solid `accent.aqua` background + `text.onLightAccent` ink | `SegmentedControl` active thumb (Schedule Cards/Timeline switcher) | **Mutually-exclusive view switcher** — exactly one option is always active; the fill makes the current view immediately scannable |
| **Outlined aqua-tint** — `aquaAlpha[12]` background + `accent.aqua` border + `accent.aqua` text | `CrewTabBar` active tab | **Navigational tabs** — moving between content sections; the lighter fill lets badge counts and icons stay legible against the background |

### Day and filter chips (audit notes)

- **Day chips** (`app/(tabs)/index.tsx`) use the filled-aqua treatment. This is
  correct: the selected day is a mutually-exclusive view switcher.
- **Stage/filter chips** (same screen) use the outlined-tint treatment. This is
  also correct: they are toggleable nav filters, not a single forced selection.
- **Crew switcher chips** (`crew.tsx crewChip`) currently use a third ad-hoc
  style. These should be migrated to the outlined-tint treatment (navigational
  tabs, not a view switcher). Tracked as a future cleanup — not mass-edited in
  this pass per the DC27 Option A recommendation.

### Rule

> **Filled = mutually-exclusive view switch. Outlined-tint = navigational tabs
> and toggle filters.**

When adding a new chip or pill, ask: "does selecting this force exactly one
active option?" If yes, use the filled-aqua style. If the user is navigating
between sections or toggling a filter, use the outlined-tint style.

Do not introduce a third selected-pill treatment without first checking whether
one of the two above applies.

---

## 4. Skeleton Shimmer Spec (R7 — design-inspiration-deep-2026-06-10)

### Web

| Property | Value |
|---|---|
| Gradient | `linear-gradient(90deg, #1a1a1a 0%, #2a2a2a 40%, #1a1a1a 100%)` |
| Background-size | `200% 100%` |
| Keyframe | `@keyframes skeleton-loading` — `0% { background-position: -200% 0 }` → `100% { background-position: 200% 0 }` (band sweeps left→right) |
| Duration / easing | `1.4s linear infinite` |
| Reduce-motion | Handled globally by `@media (prefers-reduced-motion: reduce)` in `animations.css` — collapses to `0.01ms 1 iteration` |
| Card hairline | `border border-[var(--color-aqua-a08)]` (`rgba(0,232,208,0.08)`) on card-shaped skeleton wrappers |
| Dismiss | `@utility skeleton-dismiss` — `transition: opacity 150ms linear; opacity: 0`. Apply to wrapper on data arrival, remove element after `transitionend` or 150ms `setTimeout`. |

**Utility class:** `skeleton-shimmer` (defined in `packages/web/src/styles/theme.css`).
**Dismiss utility:** `skeleton-dismiss` (same file).

### Mobile

| Property | Value |
|---|---|
| Animation | `withRepeat(withTiming(0.8, { duration: 700, easing: easing.standard }), -1, true)` |
| Opacity range | `0.4 → 0.8` |
| Half-cycle | 700ms in / 700ms out |
| Reduce-motion | `useReduceMotion()` gate — static `opacity: 0.6`, no loop |
| Card hairline | `borderWidth: 1, borderColor: 'rgba(0,232,208,0.08)'` via `card` prop on `<Skeleton card />` |

**Component:** `packages/mobile/components/Skeleton.tsx`. Pass `card` prop for card-shaped containers (crew rows, set cards, FM cards); omit for inline text/circle blocks.

### Motion table row addition

| Interaction class | Duration | Easing | Haptic | Motion primitive |
|---|---|---|---|---|
| **Skeleton shimmer** (web) | 1.4s per full sweep | `linear` | none | CSS `skeleton-loading` keyframe on `background-position` |
| **Skeleton pulse** (mobile) | 700ms per half-cycle | `easing.standard` | none | `withRepeat` / `withTiming` on opacity 0.4↔0.8 |
| **Skeleton dismiss** (web) | 150ms | `linear` | none | `skeleton-dismiss` utility, opacity 1→0 |

---

## 4. Status Badge Geometry (R6 — DC28)

All time/presence status badges share one pill spec:

| Property | Value |
|---|---|
| border-radius | 9999px (`rounded-full` / `borderRadius: 9999`) |
| padding | 3px top/bottom, 10px left/right |
| font | Space Grotesk 500, 11px (web `text-[11px]`; mobile `typeStyle('micro', 500)`) |
| letter-spacing | 0.04em (`tracking-[0.04em]`; mobile: `fontSize * 0.04`) |
| text-transform | uppercase |

### Color assignments

| Badge | Background | Text | Notes |
|---|---|---|---|
| **LIVE** | `coralStrong` #c01d3a | `#080810` (onLightAccent) | Sole coral-fill exception — danger/time-critical, not a CTA. AA ~6.04:1. Pulsing dark-ink dot. |
| **NOW PLAYING** (soon) | `aqua` #00e8d0 | `#0a0a0a` (onLightAccent) | Aqua fill + dark ink. AA. |
| **UP NEXT** (upcoming) | transparent | `aqua` #00e8d0 | 1px `rgba(0,232,208,0.4)` border. |
| **PAST** / TBA / later | `#3a3a3a` | `#686868` | Neutral recessed. |
| **ONLINE** crew dot | `aqua` #00e8d0 | — | Avatar status dot. No green anywhere. |
| **OFFLINE** crew dot | `text.muted` #8787a8 | — | Avatar status dot. |

### Rule

> The LIVE coral-fill is the **only** permitted coral fill in the app. All other
> "active/positive" states use aqua. Never use `accent.green` for presence/status.

---

## 5. Glass Sheet Surface (R4)

Introduced by R4 (design-inspiration-deep-2026-06-10). Applied to
`DetailPanel` (web) and `app/set/[setId].tsx` (mobile).

### Web (`DetailPanel` / vaul `Drawer.Content`)

| Property | Value |
|---|---|
| background | `rgba(29, 29, 29, 0.82)` |
| backdrop-filter | `blur(20px)` (-webkit- prefixed) |
| border | `1px solid rgba(255, 255, 255, 0.08)` |
| box-shadow | `inset 0 1px 0 rgba(255, 255, 255, 0.06)` (top highlight) |
| border-radius (mobile sheet) | `24px` top corners |
| border-radius (lg dialog) | `16px` all corners |
| scrim | `rgba(0, 0, 0, 0.6)` |
| interior header divider | `1px rgba(0, 232, 208, 0.12)` (aqua hairline below drag handle) |

CSS utility: `detail-glass` in `packages/web/src/styles/theme.css`.
Vaul handles the slide animation natively — no additional CSS transition needed.

### Mobile (`app/set/[setId].tsx`)

RN has no `backdrop-filter`. The glass approximation uses:
- `backgroundColor: 'rgba(29, 29, 29, 0.82)'` — translucent dark surface
- `borderTopLeftRadius: 24`, `borderTopRightRadius: 24`
- `borderWidth: 1`, `borderColor: 'rgba(255, 255, 255, 0.08)'`
- `borderTopColor: 'rgba(255, 255, 255, 0.14)'` — brighter top edge simulates the inset highlight

**Platform limitation**: blur is not rendered on mobile — the visual approximation
relies entirely on the translucent surface tinting and the top-highlight hairline.

---

## 6. Count-Up Ticker (R10, design-inspiration-deep-2026-06-10)

Stat numbers on Wrap tween from 0 to their final value on mount. Duration: 800ms.
Easing: ease-out cubic (`1 - (1-t)^3` on web; `Easing.out(Easing.cubic)` on mobile).

**Web** (`useCountUp` in `packages/web/src/routes/wrap.tsx`):
- Pure `requestAnimationFrame` loop; no library.
- Detects `prefers-reduced-motion` via `window.matchMedia` at call time and
  jumps to the final value immediately when true.
- Float detection: if `target` contains `.` the displayed value uses
  `toFixed(1)`, otherwise `Math.round`.
- `aria-label={value}` on the display element gives screen readers the real
  number regardless of animation progress.

**Mobile** (`useCountUpMobile` in `packages/mobile/app/wrap.tsx`):
- Reanimated `useSharedValue` + `withTiming` with `Easing.out(Easing.cubic)`.
- A `useDerivedValue` + `runOnJS(setState)` bridge feeds a plain React state
  string into a `<Text>` (avoids AnimatedText dependency complexity;
  setState-throttled approach per spec).
- Gates on `useReduceMotion()` — when true the final string is set directly
  without `withTiming`.

**Interaction class** mapping: treat as **layout change** (200ms) for
incidental inline count changes; use 800ms only for on-mount stat reveal.

---

## 7. Radial Aqua Glow — Now Playing Hero (R8, design-inspiration-deep-2026-06-10)

A static + ambient radial aqua glow marks the NOW section as the live
festival surface.

**Web** (`fm-now-hero` utility in `packages/web/src/styles/theme.css`):
- `::before` pseudo: `radial-gradient(circle at 50% 35%, rgba(0,232,208,0.22)
  0%, transparent 65%)` plus a slow `aurora` keyframe (30s linear infinite)
  that animates a `400% 400%` background-position.
- Aurora is a background-position shift only — no transform/opacity changes.
  Collapsed to 0.01ms by the global `@media(prefers-reduced-motion)` block in
  `animations.css`. Static radial layer persists under reduce-motion.
- Usage: `className="fm-now-hero rounded-xl"` on the section container.
  Direct children auto-lift to `z-index: 1` via `& > *`.

**Mobile** (`glowStyles` in `packages/mobile/app/festival-mode.tsx`):
- Two concentric absolutely-positioned circular `View`s (400x400 outer at
  `rgba(0,232,208,0.11)`, 160x160 inner at `rgba(0,232,208,0.14)`) centred
  at the top of an `overflow: hidden` wrapper.
- `expo-linear-gradient` is absent; no new dependency needed.
- Purely static colour; no reduce-motion gate required.

---

## 8. Sliding Tab Indicator (R14)

**Component:** `packages/mobile/components/CrewTabBar.tsx`

A 2px aqua beam slides horizontally to track the active tab in `CrewTabBar`.

| Property | Value |
|---|---|
| Height | 2px |
| Border-radius | 1px |
| Color | `colors.accent.aqua` (#00e8d0) |
| Motion | `withSpring(x, { stiffness: 180, damping: 20 })` |
| Reduce-motion | `withTiming(x, { duration: 0 })` — instant jump |

Implementation notes: `indicatorX` / `indicatorW` are Reanimated `useSharedValue`
running on the UI thread. Each tab fires `onLayout` to record `{ x, width }` in
React state; the `useEffect` re-runs on `activeTab` change or new measurement.
`indicatorX` starts at `-999` (off-screen) to prevent a flash at `x=0` on mount.
The indicator track is `position: absolute, top: 0, zIndex: 1` with
`pointerEvents="none"` so touches fall through to the tab pills.

**Motion table row addition:**

| Interaction class | Duration | Easing | Haptic | Primitive |
|---|---|---|---|---|
| **Tab indicator slide** | spring 180/20 | spring | none | `withSpring` on `translateX` + `width` |

---

## 9. Hero Image Gradient Overlay (R15)

**Component:** `packages/mobile/app/set/[setId].tsx`

Artist photos in the set-detail sheet receive a darkening overlay matching the
spec: `linear-gradient(180deg, transparent 40%, rgba(10,10,10,0.85) 100%)`.

`expo-linear-gradient` is not in the mobile dep tree. The gradient is approximated
by two stacked `View`s inside an `overflow: hidden` container:

| Layer | Position | Height | Color |
|---|---|---|---|
| Top (clear) | `top: 0` | 40% | `transparent` |
| Bottom (dark) | `bottom: 0` | 60% | `rgba(10,10,10,0.85)` |

Both Views use `pointerEvents="none"`. The container holds `overflow: hidden` and
`borderRadius: t.radii.default` to clip overlays to the image's rounded corners.

**Upgrade path:** if `expo-linear-gradient` is added, replace the two-View stack
with `<LinearGradient colors={['transparent','rgba(10,10,10,0.85)']} locations={[0.4,1.0]} style={StyleSheet.absoluteFillObject} />` inside the same container.

---

## 10. Scroll-Driven Primitives — Web (R11 + R13)

Two scroll-linked web primitives introduced by design-inspiration-deep-2026-06-10.
Both prefer native CSS scroll-driven animation (Baseline 2026) with a
single-listener JS fallback, and both are reduced-motion-safe.

### Shared hook: `useScrollProgress`

`packages/web/src/hooks/useScrollProgress.ts`. One `requestAnimationFrame`-throttled
scroll listener on a scrollable container. It writes two custom properties on the
container element (`--scroll-progress` 0→1, `--scroll-left` px) for pure-CSS
consumers, and returns `scrolled` / `scrollingUp` booleans (crossing-only state,
not per-frame) for direction-aware logic. CSS consumers read the vars without
React re-rendering.

### R11 — Timeline aqua beam

A 2px aqua (`--color-accent-aqua`) beam in the timeline's left gutter fills from
the top of the scroll content to the current scroll position.

| Property | Value |
|---|---|
| Element | `.timeline-beam` (in `animations.css`), child of `.timeline-content` (a `min-h-full relative` wrapper so `%` height resolves against scroll content, not the viewport) |
| Width / radius | 2px, `border-radius: 1px`, `box-shadow: 0 0 8px rgba(0,232,208,0.55)` |
| Preferred fill | `@supports (animation-timeline: scroll())` → `animation: fillBeam linear both; animation-timeline: scroll(); animation-range: 0% 100%` (no JS in the fill loop) |
| Fallback fill | `@supports not (...)` → `height: calc(var(--scroll-progress,0) * 100%)` driven by `useScrollProgress` |
| Horizontal tracking | `transform: translateX(var(--scroll-left,0px))` keeps the beam glued to the `sticky left-0` time-label gutter during horizontal scroll |
| Reduce-motion | The global block would collapse the scroll-driven fill to its end-state, so a `prefers-reduced-motion` rule drops `animation` and uses the `--scroll-progress` fallback — still scroll-linked, no time-based motion |

### R13 — Shrinking sticky header + sliding tab underline

**Shrinking header** (`Header.tsx`, classes in `animations.css`):

| Property | Value |
|---|---|
| Trigger | single scroll listener on `#main-content`; `.shrunk` toggles when `scrollTop > 80` AND not scrolling up (direction tracked via a ref — re-expands immediately on scroll-up) |
| Compression | `.app-header.shrunk` → `min-height: 48px` + reduced vertical padding; `.app-header-brand` font-size 15px→13px |
| Easing | `200ms var(--ease-out)` on `min-height`, `padding`, `font-size` |
| Reduce-motion | transitions collapse to 0.01ms via the global block (instant snap) |

**Sliding tab underline** (`ScheduleViewSwitcher.tsx`, `.tab-underline` in `animations.css`):

| Property | Value |
|---|---|
| Element | `.tab-underline`, 2px aqua, `border-radius: 1px`, positioned in a `relative` tab bar |
| Position/width | `--tab-x` / `--tab-w` custom properties set from the active tab's `offsetLeft` / `offsetWidth`, measured in `useLayoutEffect` on active-tab change + on resize (no per-scroll re-render) |
| Motion | `transition: transform 200ms var(--ease-standard), width 200ms var(--ease-standard)` |
| Reduce-motion | collapses to instant via the global block |

**Motion table row additions:**

| Interaction class | Duration | Easing | Haptic | Primitive |
|---|---|---|---|---|
| **Scroll beam fill** (web) | scroll-linked | linear (scroll-progress) | none | `animation-timeline: scroll()` / `--scroll-progress` height |
| **Header shrink** (web) | 200ms | `ease-out` | none | `.shrunk` class toggling `min-height` / `padding` / brand `font-size` |
| **Tab underline slide** (web) | 200ms | `ease-standard` | none | `--tab-x` / `--tab-w` on `.tab-underline` `translateX` + `width` |

---

## CTA Hierarchy & Hairline Dividers (R2 / R3)

Static (non-motion) design conventions codified during the 2026-06-10 design
sweep. They share this doc because they govern the same "every component makes
the same decision" goal as the motion vocabulary.

### Single-accent CTA discipline (R3)

Exactly **one solid aqua fill per screen** — the primary action. Everything else
is demoted:

| Tier | Web (`ui/Button.tsx`) | Mobile (`components/Button.tsx`) | Treatment |
|---|---|---|---|
| **Primary** (1 per screen) | `variant="primary"` | `variant="primary"` | Solid `accent-aqua` fill + dark ink (`onLightAccent`) |
| **Secondary / demoted** | `variant="outline"` | `variant="secondary"` | Transparent fill, 1px aqua-0.4 border, **muted** text; web hover lifts border to aqua-0.7 + text to primary |
| **Tertiary / ghost** | `variant="ghost"` | `variant="ghost"` | Borderless, muted text |
| **Danger** (SOS / delete) | `variant="danger"` (filled `coralStrong`) or coral text/outline | `variant="danger"` | Coral — never the screen's lone solid-aqua substitute |

- Selection-state fills (active segmented-control thumb, active day/reminder
  chip, selected poll option) are **not** counted as the screen's solid-aqua CTA
  — they are toggle indicators, one-active-at-a-time.
- `setShowForm`-style add/submit buttons are mutually exclusive (the add button
  is hidden while the form's submit shows), so a single screen still renders only
  one solid aqua at a time.
- The aqua-0.4 / aqua-0.7 border values live as tokens: web uses the
  `accent-aqua/40` opacity utility (and `--color-aqua-a4` / `--color-aqua-a7`);
  mobile consumes `colors.aquaAlpha[40]` / `[70]` literals (RN has no opacity
  modifier).

### Hairline dividers (R2)

Two — and only two — hairline values for card borders, list-row separators, and
section dividers:

| Use | Token (web util / mobile) | Value |
|---|---|---|
| **Neutral** separator (crew rows, expense items, schedule card, poll option, set-detail divider) | `border-glass-border` / `colors.glass.border` | `rgba(255,255,255,0.08)` |
| **Active / featured** hairline | `border-aqua-a12` / `colors.aquaAlpha[12]` | `rgba(0,232,208,0.12)` |

Selected-state emphasis borders (selected poll option, `optionButtonMine`) keep
their solid `accent-aqua` border — that is intentional selection weight, not a
divider. Stage-color `border-l-4` accents on set cards are likewise preserved.


---

## 11. Long-Press Delete Affordance — Mobile List Rows (R20)

R20 specified a Reanimated `Gesture.Pan` swipe-to-delete on expense and packing
rows. **`react-native-gesture-handler` is not a mobile dependency** (verified in
`packages/mobile/package.json` — only `react-native-reanimated` /
`react-native-worklets` are present), and the HARD RULE forbids adding new
dependencies. Per the R20 fallback clause, the swipe gesture is replaced by a
**long-press delete affordance** on the whole row.

**Components:** `packages/mobile/components/CrewExpenses.tsx` (expense rows),
`packages/mobile/components/CrewPacking.tsx` (packing rows).

| Property | Value |
|---|---|
| Trigger | `Pressable onLongPress` on the row container (only when the user may delete) |
| `delayLongPress` | 350ms |
| Affordance | Pressed-state coral dim: `backgroundColor: ring.coral` + `borderColor: accent.coral` (no transform / no spring) |
| Haptic | `haptics.warning()` fired once at the start of `handleRemove` / `handleDelete`, before the confirmation Alert (Destructive-confirmation row of the vocab table) |
| Confirmation | Existing `Alert.alert` destructive prompt → existing Zustand delete action (`removeExpense` / `deletePackingItem`) |
| Row-tap safety | Expense rows have no tap action; packing rows keep the checkbox + trash `TouchableOpacity` as independent tap targets. A long-press on the row body collides with neither. The always-visible trash button remains the primary delete affordance. |
| Reduce-motion | Honoured by construction — the affordance is a static color swap, not animation. On packing rows the existing `FadeIn`/`LinearTransition` layout motion stays gated behind `useReduceMotion()`; the row composes long-press onto Reanimated via `AnimatedPressable` (`Animated.createAnimatedComponent(Pressable)`) so the entering/exiting/layout animations are preserved. |

**Motion table row addition:**

| Interaction class | Duration | Easing | Haptic | Primitive |
|---|---|---|---|---|
| **Long-press delete** (mobile, RNGH-absent fallback for swipe-to-delete) | 350ms hold | none (static color) | `haptics.warning()` | `Pressable onLongPress` + pressed coral dim |

**Upgrade path:** if `react-native-gesture-handler` is later added to the mobile
deps, replace the `Pressable onLongPress` with the spec's `Gesture.Pan` swipe
(translateX clamped `[-rowWidth, 0]`, coral delete zone revealed past -40px,
`haptics.warning()` at the -0.4·rowWidth threshold, `withSpring({stiffness:200,
damping:25})` snap-back), wrapping rows in `Gesture.Race` / `activeOffsetX` so the
checkbox tap still wins. The haptic call and the existing delete actions are reused
as-is.

---

## 11. Presence Pulse -- One-Shot Flip Ring (R23)

Avatar status dot gets a one-shot scale+fade ring when the peer's presence
flips from OFFLINE to ONLINE. Continuous animation is banned (battery rule).

### Web (Avatar.tsx)

| Property | Value |
|---|---|
| Trigger | `isOnline` prop flips `false` to `true` |
| Mechanism | `useRef` tracks prev value; `useEffect` adds `status-dot-flipped` class on flip |
| Animation | `@keyframes status-dot-pulse-once` -- scale `1` to `2.8`, opacity `0.7` to `0`, 600ms `ease-out` |
| Iteration | `1` (one-shot) -- class removed on `animationend` |
| Ring element | `::after` pseudo on the status dot div |
| Reduce-motion | Global `prefers-reduced-motion` block collapses `animation-duration` to 0.01ms -- no ring visible |

**Keyframe:** `status-dot-pulse-once` in `packages/web/src/styles/animations.css`
**Utility:** `status-dot-flipped` in `packages/web/src/styles/theme.css`

### Mobile (Avatar.tsx)

| Property | Value |
|---|---|
| Trigger | `isOnline` prop flips `false` to `true` (tracked via `useRef`) |
| Mechanism | `useSharedValue` for `ringScale` + `ringOpacity`; `useEffect` fires one `withTiming` sequence |
| Animation | `ringScale`: 1 to 2.8, `ringOpacity`: 0.7 to 0, 600ms `Easing.out(Easing.cubic)` |
| Ring element | `Animated.View` positioned absolutely behind the dot |
| Reduce-motion | `useReduceMotion()` guard -- skip animation entirely when true |

**Motion table row addition:**

| Interaction class | Duration | Easing | Haptic | Primitive |
|---|---|---|---|---|
| **Presence flip ring** (web) | 600ms | `ease-out` | none | `status-dot-pulse-once` keyframe, `animation-iteration-count: 1` |
| **Presence flip ring** (mobile) | 600ms | `Easing.out(Easing.cubic)` | none | `withTiming` on `ringScale` + `ringOpacity` SharedValues |

---

## 12. SOS FAB Alert Pulse (R24)

The SOS floating action button (find.tsx, map.tsx on mobile; LiveLocationControls
"Raise SOS" button on web) gets a continuous slow coral pulse ring ONLY while an
active SOS exists in `liveLocationStore.sos` for the current crew.

Continuous animation is **justified** for the emergency context -- the ring must
command immediate attention. It stops as soon as the SOS is cleared.

### Web (LiveLocationControls.tsx)

| Property | Value |
|---|---|
| Active condition | `showSos` -- `sos && sos.crewId === crewId` |
| Animation class | `sos-fab-alerting` -- `@keyframes sos-fab-pulse` 1.5s ease-out infinite |
| Pulse shape | `box-shadow: 0 0 0 0 rgba(255,51,102,0.7)` to `0 0 0 16px rgba(255,51,102,0)` |
| Reduce-motion | `sos-fab-static-ring` class instead -- static `box-shadow: 0 0 0 3px rgba(255,51,102,0.6)` |
| Detection | `window.matchMedia('(prefers-reduced-motion: reduce)')` at render time |

**Keyframe:** `sos-fab-pulse` in `packages/web/src/styles/animations.css`
**Utilities:** `sos-fab-alerting`, `sos-fab-static-ring` in `packages/web/src/styles/theme.css`

### Mobile (find.tsx, map.tsx)

| Property | Value |
|---|---|
| Active condition | `sos && activeCrew && sos.crewId === activeCrew.id` |
| Animation | `withRepeat(withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) }), -1, true)` on `sosFabGlow` shared value |
| Effect | `shadowColor: '#ff3366'`, `shadowOpacity: glow * 0.7`, `shadowRadius: 4 + glow * 12` on Animated.View wrapper |
| Reduce-motion | `useReduceMotion()` -- `sosFabGlow` stays at 0; static `borderWidth: 2, borderColor: rgba(255,51,102,0.6)` applied |
| Store | `useLiveLocationStore((s) => s.sos)` scoped to active crew id |

**Motion table row addition:**

| Interaction class | Duration | Easing | Haptic | Primitive |
|---|---|---|---|---|
| **SOS FAB alert ring** (web) | 1.5s infinite | `ease-out` | none | `sos-fab-pulse` keyframe on `box-shadow` |
| **SOS FAB alert ring** (mobile) | 750ms half-cycle | `Easing.out(Easing.cubic)` | none | `withRepeat(withTiming)` on shadow SharedValue |

---

## Batch 2 Conventions (design-inspiration-deep-2026-06-10)

### Staggered list entrances (R22)

Stagger applies only on **initial mount** — never on re-renders or live updates.

| Property | Web | Mobile |
|---|---|---|
| Keyframe | `fadeInUp` (opacity 0→1, translateY 12px→0) | Reanimated `FadeInDown` layout entering prop |
| Per-item delay | `calc(var(--i) * 70ms)` via inline `style={{ '--i': index }}` | `.delay(Math.min(index, 6) * 70)` |
| Duration | `350ms ease-out` | `.duration(350)` |
| Delay cap | index > 6 → clamp delay to `420ms` (no slow tail) | `Math.min(index, 6) * 70` caps at 420ms |
| Reduce-motion | `@media(prefers-reduced-motion)` block collapses to `animation: none` globally | `useReduceMotion()` gate — omit `entering` prop, use plain `View` |

CSS class `stagger-item` (defined in `animations.css`) applies `animation: fadeInUp 350ms ease-out both` and reads `--i` from the style prop.

### One-shot presence pulse vs. continuous-SOS exception

- **Avatar status dot** (ONLINE): `statusPulse` keyframe (`scale 1→1.15, opacity 1→0.6`) — `2s ease-in-out infinite`. Ambient, low-intensity, continuous. Acceptable because the dot is 10px and visually recessive.
- **SOS button** (active/triggered): `sosPulse` keyframe (`box-shadow 0→16px→0 coral`) — `1.5s ease-out infinite`. The **sole continuous coral pulse** permitted. All other pulsing elements must be ambient aqua and low-opacity.
- **General rule**: one-shot animations (list entrance, skeleton dismiss, notification badge bounce) fire once and stop. Continuous animation is reserved for: skeleton shimmer (loading), status dot (online presence), SOS active state. Nothing else loops indefinitely.

Both pulse keyframes respect `@media(prefers-reduced-motion)` — the global block collapses them to `0.01ms 1 iteration`.

### Swipe-to-delete thresholds (R20, mobile)

| Threshold | Action |
|---|---|
| `translateX < -40px` | Delete zone becomes visible (`opacity` animates 0→1) |
| `translateX < -0.4 * rowWidth` OR release velocity `< -500` | Haptic (`ImpactFeedbackStyle.Medium`) fires once |
| Gesture end past threshold or velocity trigger | Animate to `-rowWidth` then execute delete |
| Gesture end otherwise | `withSpring(0, { stiffness: 200, damping: 25 })` snap back |

Fire the haptic once when the threshold is first crossed. Track with a `hasFiredHaptic` ref that resets on gesture start.

### Animated gradient border fallback chain (R19)

```
1. @property --border-angle supported (Chrome/Edge) → conic-gradient border-box animation
2. @supports not (@property ...) → static 1px rgba(0,232,208,0.3) border (no animation)
3. prefers-reduced-motion → always static border regardless of @property support
```

Apply animated gradient borders to **at most one card per screen**. Never stack on multiple simultaneous cards.

### Poll bar timing (R26)

| Property | Web | Mobile |
|---|---|---|
| Trigger | React re-render when `pct` prop changes | `useEffect` watching `pct` prop |
| Duration | `400ms` | `400ms` |
| Easing | `ease-out` (`duration-[400ms] ease-out`) | `withTiming(pct, { duration: 400 })` |
| Reduce-motion | CSS transitions collapse globally via `animations.css` — no JS gate needed | `reduceMotion ? (widthPct.value = pct) : withTiming(...)` — instant snap |
| Mount behaviour | Bar snaps to initial width instantly (no entrance tween) | `isFirstRender` ref skips `withTiming` on first mount |
| Scope | `PollOptionButton.tsx` — `crew-poll-bar` div only | `PollBarFill` helper in `CrewPolls.tsx` — `Animated.View` fill only |

**Motion table row addition:**

| Interaction class | Duration | Easing | Haptic | Primitive |
|---|---|---|---|---|
| **Poll bar width** (vote update) | 400ms | ease-out | none | CSS `transition-[width]` (web) / `withTiming` on `useSharedValue` (mobile) |

---

## 13. Bento Grid for Wrap Stats (R16)

CSS Grid / flex-wrap layout for Wrap stat surfaces. Zero shadows; depth from hairline gaps only.

### Web (`packages/web/src/routes/wrap.tsx`)

| Property | Value |
|---|---|
| Grid | `display: grid; grid-template-columns: 2fr 1fr; gap: 1px` |
| Gap color | Parent `background: rgba(0,232,208,0.08)` — gap shows through as aqua tint |
| Featured cell | `grid-column: span 2`; number at `text-4xl` Syncopate, `tracking-[-0.02em]` |
| Supporting cells | `text-xl` Syncopate; individual `bg-bg-card` |
| Crew 3-cell | `grid-template-columns: 1fr 1fr 1fr`; 1px `rgba(0,232,208,0.12)` `border-right` on cells 1–2 |
| Border-radius | `12px` on outer container with `overflow: hidden` |

### Mobile (`packages/mobile/app/wrap.tsx`)

| Property | Value |
|---|---|
| Container | `borderRadius: t.radii.default`, `overflow: hidden`, `backgroundColor: 'rgba(0,232,208,0.08)'`, `gap: 1` |
| Featured cell | Full-width top row; `fontSize: 36`, `letterSpacing: -0.02 * 36`, `fontFamily: 'Syncopate_700Bold'` |
| Row cells | `flexDirection: row`, `gap: 1`; divider cells add `borderRightWidth: 1, borderRightColor: 'rgba(0,232,208,0.12)'` |
| Crew 3-cell | `flexDirection: row` with `bentoCellDivider` on cells 1–2 |

### Rule

> Bento grids use **gap-as-hairline** (1px gap + aqua-tint parent bg) rather than explicit borders.
> No `box-shadow` on any bento cell — depth from surface contrast only.

---

## 14. Multi-Step Offline-Download Loader (R18)

Per-step visual state for the festival offline-download sync. Replaces single spinner/progress rows.

### States

| State | Web | Mobile |
|---|---|---|
| **pending** | 8px `#3a3a3a` dot | 8px `#3a3a3a` `View` circle |
| **active** | 8px `#00e8d0` dot, `offline-step-pulse 900ms` CSS keyframe | Reanimated `withRepeat(withTiming(0.45, 450ms))` on opacity 1→0.45 |
| **done** | Lucide `<Check>` in `text-accent-aqua` + "synced N ago" text | Ionicons `checkmark-circle` + time label |
| **error** | Lucide `<AlertCircle>` in `text-accent-coral` + inline Retry button | Ionicons `alert-circle` + Retry `TouchableOpacity` |

### Motion

- Active dot pulse: `offline-step-pulse` — `0%,100% {opacity:1;scale(1)}` `50% {opacity:0.45;scale(1.35)}`, 900ms ease-in-out infinite.
- Reduce-motion (web): `@media(prefers-reduced-motion:reduce)` collapses keyframe to `opacity:0.7;transform:none`.
- Reduce-motion (mobile): `useReduceMotion()` gate — `withTiming` skipped, static `opacity: 0.7`.
- Keyframe injected via `document.createElement('style')` in a `useEffect` (web only) — no new CSS file needed.

### Shimmer placeholder (active state, web)

The active step's right-side label uses `skeleton-shimmer` utility (R7) as a width-80px placeholder instead of text — consistent with the shimmer vocabulary established in section 4.

### Files

- Web: `packages/web/src/components/features/OfflineReadinessCard.tsx`
- Mobile: `packages/mobile/components/OfflineReadinessCard.tsx` (new)

**Motion table row additions:**

| Interaction class | Duration | Easing | Haptic | Primitive |
|---|---|---|---|---|
| **Step pulse** (offline sync active dot) | 900ms per full cycle | ease-in-out | none | CSS `offline-step-pulse` keyframe (web) / Reanimated `withRepeat(withTiming)` (mobile) |
