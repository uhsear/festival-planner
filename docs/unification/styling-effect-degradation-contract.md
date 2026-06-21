# Styling — Effect-Degradation Contract

**Scope:** Five web-only CSS effects (implemented in `packages/web/src/styles/theme.css`) that have
no direct RN equivalent. This table is the authoritative native treatment for each one.

**Ground-truth sources used:**
- `packages/web/src/styles/theme.css` (the CSS definitions)
- `packages/shared/src/tokens/colors.ts` (token reality check)
- `packages/mobile/package.json` (dep availability)

---

## Effect-to-native mapping

| Web effect | theme.css location | Native contract (current) | Status |
|---|---|---|---|
| `glass` / `glass-sm` / `glass-xs` | Lines 13–23 (`backdrop-filter: saturate(180%) blur(var(--glass-blur-strong/--glass-blur))` / `blur(8px)`) | **Translucent-solid fallback:** `backgroundColor: colors.bg.card` (`rgba(26,26,26,0.65)`), no blur. This is the shipping contract today. | **Blocked** — upgrading to a real blur requires adding `expo-blur` (not currently in `packages/mobile/package.json`). Mark a future ticket; adopt only after dep is added and audited against the `react-native-worklets` collision risk (see §4 of the v2 plan). |
| `detail-glass` | Lines 30–36 (`rgba(29,29,29,0.82)` bg + `blur(20px)` + `1px solid rgba(255,255,255,0.08)` border + inset highlight) | **Translucent-solid fallback:** `backgroundColor: 'rgba(29,29,29,0.82)'`, border `1px solid rgba(255,255,255,0.08)`, `boxShadow`/`shadowColor` for the inset highlight approximation, no blur. Border literal is `rgba(255,255,255,0.08)` — available as `colors.glass.border` (`packages/shared/src/tokens/colors.ts:66`). **Do NOT reference `colors.glassBorder`** — that path is fabricated; the real nested token is `colors.glass.border`. | **Blocked** on `expo-blur` (same as above). |
| `skeleton-shimmer` | Lines 213–218 (`linear-gradient(90deg, #1a1a1a 0%, #2a2a2a 40%, #1a1a1a 100%)` animated 1.4s linear infinite) | **Reanimated loop:** a `useSharedValue` cycling `0 → 1` on a 1400ms linear loop drives `interpolateColor(v, [0,0.4,1], ['#1a1a1a','#2a2a2a','#1a1a1a'])` applied to `backgroundColor` via `useAnimatedStyle`. Colors match the web palette exactly (`#1a1a1a` = `colors.bg.secondary`). The shimmer dismissal (150ms opacity fade on data arrival, `skeleton-dismiss`) maps to an Animated/Reanimated opacity-out. | **Available today** — `react-native-reanimated@4.3.1` is already a declared dep. |
| `.set-card.live` conic border | Lines 244–259 (`conic-gradient` rotating border, `#00e8d0 → transparent → #ff3366 → transparent`, 6s infinite; `@media (prefers-reduced-motion)` collapses to `1px solid rgba(0,232,208,0.3)`) | **Static aqua border** — `borderWidth: 1`, `borderColor: colors.aquaAlpha[30]` (`rgba(0,232,208,0.3)`). This is exactly the web's own reduced-motion fallback (theme.css:256–259), so the native contract already matches web's accessibility floor. No animation is added — CSS `conic-gradient` rotation has no RN equivalent and is not worth polyfilling for a single live card. | **Available today.** Conic animation is permanently dropped on touch; static aqua border is the contract. |
| Spotlight hover (`.set-card::after`) | Lines 336–337 (`radial-gradient` follows `--mx/--my` mousemove; desktop-only via `@media (hover:hover)`) | **Dropped entirely on touch.** Touch devices have no hover/mousemove events, and a persistent glow on every card press creates visual noise without a directional input. No native equivalent is applied. | **By design** — not a regression. |

---

## Typography — escape-hatch decision (keep `typeStyle()` authoritative on native)

The draft's escape-hatch conclusion is correct and must be preserved:

**`typeStyle()` (from `@festie/shared`) remains the authoritative source for native text weight and
tracking.** Do **not** use NativeWind `font-bold` / `tracking-*` utilities on native text.

Why this matters — when NativeWind re-emits CSS className props on RN it translates:
- `font-bold` → `fontWeight: '700'`
- `tracking-tight` / any negative letter-spacing class → negative `letterSpacing`

Both of these reopen the **Android trailing-glyph clip** (documented in memory:
`bug_android_text_clipping.md`). The six root causes of that bug all involve either `fontWeight`
changes or negative `letterSpacing` applied via StyleSheet, which clamps the character advance
width on older Skia text engines. `typeStyle()` applies the same values but with the workarounds
already baked in (positive or zero tracking floors, font-family specifics).

**Scope of NativeWind (if adopted):** layout / color / spacing only. Typography props are
off-limits for the NativeWind layer on native targets.

---

## Dependency gate — what needs to be added before blur/gradient rows unblock

| Package | Required for | Status |
|---|---|---|
| `expo-blur` | `glass` / `glass-sm` / `glass-xs` / `detail-glass` blur layer | **Not in `packages/mobile/package.json`** — add and audit before use |
| `expo-linear-gradient` | Any gradient-based shimmer or glass variant (alternative to Reanimated interpolation) | **Not in `packages/mobile/package.json`** — not required for current skeleton-shimmer contract (Reanimated is sufficient) |

---

## `useReducedMotion()` — not yet wired

A `useReducedMotion()` hook (wrapping `AccessibilityInfo.isReduceMotionEnabled()` / Reanimated's
`useReducedMotion`) is **not present anywhere in the mobile codebase or `@festie/shared`** as of
2026-06-20. References to it in any native animation code are aspirational.

**To wire:** when adding the skeleton-shimmer Reanimated loop or any other motion effect, add the
hook at that point — do not cite it as available until it exists. The reduced-motion gate on the
live `.set-card` border is already handled by the "static aqua border always" decision (no
animation was added, so no gate is needed there).

---

## Token quick-reference

| Effect | Token path (correct) | Literal value | Note |
|---|---|---|---|
| `detail-glass` border | `colors.glass.border` | `rgba(255,255,255,0.08)` | Also available as CSS `--color-glass-border` (theme.css:437). NOT `colors.glassBorder` — that path does not exist. |
| Glass bg (card) | `colors.bg.card` | `rgba(26,26,26,0.65)` | Translucent-solid fallback for all three glass utilities |
| Detail-glass bg | literal | `rgba(29,29,29,0.82)` | No shared token at this exact value; use the literal or promote to `colors.glass.detailBg` |
| Live card static border | `colors.aquaAlpha[30]` | `rgba(0,232,208,0.3)` | Matches web's reduced-motion fallback exactly |
| Skeleton base | `colors.bg.secondary` | `#1a1a1a` | |
| Skeleton highlight | — | `#2a2a2a` | No token; use the literal (matches `--color-bg-secondary` step-up) |
