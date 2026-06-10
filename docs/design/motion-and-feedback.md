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
