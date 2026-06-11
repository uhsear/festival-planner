# UI Design Research — 2026-06-11

Synthesis of eight researcher-agent digests against Festie's current design language.

**Read-first context.** Festie's design system is now mature and coherent. `docs/research/design-inspiration-deep-2026-06-10.md` shipped R1–R26 (R9/R17/R27/R29/R30 skipped). `packages/web/src/styles/theme.css` and `packages/shared/src/tokens/colors.ts` already encode: the 5-step neutral surface palette, hairline dividers, single-aqua-accent discipline, pill badges, skeleton shimmer, glassmorphic detail drawer (`detail-glass`), empty-state dot-grid, animated gradient border (`set-card.live`), spotlight hover, status-dot pulse, SOS alert ring, full motion-token system (`--duration-*`/`--ease-*`), focus-ring tokens, named type roles, off-ramp font sizes (11/13/18), aqua/amber/coral alpha scales, glow shadows. The `design-hardening-phase1` audit (DC1–DC30 + F1–F9) already owns the open polish backlog (mobile swipe/ripple/predictive-back, mobile Button extraction, gradient-thumb segmented control, etc.).

**Therefore most "festieIdeas" in the eight digests are already shipped, already in the audit backlog, or off-brand.** What follows is the *residue* — only items that are genuinely new AND strengthen the existing language.

---

## Per-site digest

### 1. ui.shadcn.com — semantic tokens, compound components
Background/foreground token pairs; CSS-var radii scale; 4px spacing; 9-step type ramp; compound component anatomy (Card.Header/Body/Footer, Command → CommandInput/List/Group/Item/Separator, Tabs variant='line', Popover with side alignment); focus = 2px outline + offset, never ring alone; Badge variant prop. **Almost entirely already present in Festie** (token pairs, radii, spacing, type roles, focus rule, Badge variants all live in theme.css). The one structurally-new idea: the **Command palette anatomy** for crew search, and **compound-component naming parity** (variant='destructive' vs the current `delete`/`danger` split).

### 2. styles.refero.design — Linear / Apple / Authkit / Mercury
Single-accent rationing (1 saturated CTA/screen); near-black not pure black (#08090a, #05060f); hairline inset borders over shadows; pill radii 32–999px; **light display weights (300–360)**; **negative letter-spacing scaling with size** (-0.022em @72px → -0.01em @20px); 4px base + 80–120px section gaps; 8–12-shade monochrome text ramp; semantic accents (red/green/amber) only for status, never CTAs. **Festie already does** single-accent, hairlines, pills, negative tracking (R5), semantic-status discipline. New residue: **font-weight discipline** (Festie display is locked at 700; Linear/Apple/Mercury argue authority comes from *light* weight at large sizes) and **section-gap rhythm** (80–120px) as an explicit token.

### 3. 21st.dev — community React/Tailwind components
Ultra-subtle glass (border 0.5px @40%); pill badge clusters with grouped `rounded-l/rounded-r` + `gap-px`; fast 200ms micro-interactions; bento grids; **`@number-flow/react` animated pricing numbers**; superellipse avatar corners (`corner-shape: superellipse(1.25)`). Festie already has glass, pills, bento (R16), 200ms motion. New residue: **animated number transitions** (R10 was *specced* but grep shows it never shipped — no `number-flow`/tween in any rendered metric) and **superellipse avatars** (squircle).

### 4. componentry.fun — spring-physics micro-interactions
Spring physics (stiffness 180/damping 14) over linear easing; **proximity-driven magnetic interactions** (magnify at 150px, repel at 120px); layered depth without shadows; **staggered reveal at 30–50ms**; retro-mechanical references (split-flap). Festie's motion is token-driven cubic-bezier, not spring; it already staggers lists (R22) and uses zero-shadow depth. New residue: **split-flap / mechanical countdown** for the festival count-down hero (a focused, on-brand novelty, not a system change). Magnetic/repel/eye-tracking = reject (see below).

### 5. shadergradient.co + granim/webgradients
Multi-stop linear/radial/conic/mesh gradient animation; **dual-layer stacked gradients with opacity breathing**; glass-sheet gradient underlay; accent breathing-pulse. Festie has the radial aqua glow (R8) and gradient peak-CTAs (R9). New residue: a single, restrained **ambient aqua underlay** behind festival-mode chrome — but only if it stays below perception. Most gradient ideas (shimmer pills, map drift, avatar halos, Spotify track glow) = reject as noise.

### 6. minimal.gallery — editorial restraint
Whitespace breathing; pure monochrome; **typography-led hierarchy (size/weight only, zero color)**; sharp 0px tile edges; tag-based filtering over nav trees; generous 80–160px section gaps. This site is a *restraint check*, not a feature source — it validates Festie's direction and argues against adding more color/motion. New residue: nothing to build; it reinforces the reject list.

### 7. dark.design — dark-product gallery
Elevation via white-opacity tiers (white/5 → white/100); single accent (#FF3D00) for CTAs only; glass morphism (`bg-black/80 backdrop-blur-md`); tight touch targets ≥44px; brightness-only hover (no color shift); white-opacity text ramp. **All already in Festie** (overlay scale, single-aqua, glass-blur tokens, 44px min, hover tones, text ramp). New residue: none — pure confirmation.

### 8. dotmatrix.zzzzshawn.cloud — dot-matrix loaders
5×5 dot grid; three-tier opacity (0.12/0.42/1.0); 1500ms base cycle; bloom/halo glow; shape/pattern/color presets; `prefers-reduced-motion` honored. A single-purpose loader aesthetic. Festie already standardized on skeleton-shimmer (R7) + multi-step loader (R18). New residue: nothing worth adopting — a dot-matrix loader would *introduce* a second loading vocabulary, which violates the system. Reject.

---

## NEW recommendations

### N1 — Animated number transitions for live metrics (the R10 that never shipped)
- **What:** Tween numeric values (expense totals, member count, "X attending", Wrap stats) from old→new over ~500ms ease-out instead of hard-cutting. R10 specced this in the prior round but a grep for `number-flow`/tween/`requestAnimationFrame`-counter across `packages/web/src` shows it was never built — every metric still hard-swaps.
- **Where:** both. Web: `packages/web/src/routes/wrap.tsx` (poster stats, mount 0→final), `components/crew/ExpensesTab.tsx` + `MembersTab.tsx` (totals/count). Mobile: `components/WrapPoster.tsx`, `CrewExpenses.tsx`.
- **Effort:** S. **Impact:** med.
- **Sketch:** No new dependency. Add `packages/web/src/hooks/useAnimatedNumber.ts` — a `requestAnimationFrame` tween with `easeOutCubic = t => 1 - (1-t)**3`, honoring `useReduceMotion` (snap instantly when reduced). Render through the existing `type-display-*` roles (Syncopate for poster headline stats, Space Grotesk for inline counts). Mobile: `Reanimated withTiming(duration.med)` on a `SharedValue`, `useDerivedValue` → display string. This is the one prior-round item that demonstrably slipped through — closing it is the cleanest win here.

### N2 — Mobile `Button` primitive + `variant='destructive'` naming parity
- **What:** Web has a full `ui/` dir (`Button.tsx` with `primary|danger|ghost|secondary|outline|util|delete`). Mobile has **no `ui/` directory at all** — confirmed by glob — so the aqua primary button is re-declared ~12× with height/padding/opacity drift (this is audit F8). shadcn's lesson is the naming: web's variant set has both `danger` and `delete`, which is the kind of split shadcn's `destructive` single-variant avoids.
- **Where:** mobile primarily (the missing primitive); web secondarily (rename `delete`→fold into `danger`/icon-only).
- **Effort:** M (mobile extraction is mechanical across ~12 files). **Impact:** high (kills accent-rule/AA drift at the source — see audit F3/F5/F8).
- **Sketch:** Create `packages/mobile/components/ui/Button.tsx` mirroring web's variant contract: `primary` = `accent.aqua` + `text.onLightAccent`; `danger` = `accent.coralStrong` + white; `secondary` = aqua border + aqua text; `ghost` = borderless muted. Fixed `minHeight: 48`, `radii.DEFAULT`, disabled opacity 0.6. Drive styles through `makeStyles((t)=>…)`/`useTokens` (the documented theme seam). This is the audit's F8 — the shadcn digest independently confirms it's the right move and supplies the variant taxonomy.

### N3 — Squircle (superellipse) avatars
- **What:** 21st.dev uses `corner-shape: superellipse(1.25)` for avatars — an organic squircle rather than a hard circle. Festie avatars are currently pure circles (`Avatar.tsx`, `border-radius: 50%`). A squircle reads slightly more premium and is the current iOS/Mobbin idiom.
- **Where:** both. Web `packages/web/src/components/ui/Avatar.tsx`; mobile `packages/mobile/components/Avatar.tsx`.
- **Effort:** S. **Impact:** low.
- **Sketch:** Web: progressive enhancement — `corner-shape: superellipse(1.25); border-radius: 30%` (the `border-radius` is the fallback where `corner-shape` is unsupported, which is most browsers in 2026). Mobile: RN has no superellipse primitive, so approximate with `borderRadius` ≈ 40% of size, OR skip mobile and keep this web-only/cosmetic. **Caveat:** `corner-shape` is barely shipping in 2026; the visible delta is tiny. Low impact, low risk — a "nice-to-have," not a priority.

### N4 — Split-flap mechanical countdown for the festival count-down hero
- **What:** componentry.fun's split-flap display — a vintage-airport-board flip animation — for the time-until-festival / time-until-next-set countdown. This is a *focused decorative moment*, not a system change: it lives on exactly one surface and replaces a plain numeric countdown with a tactile flip.
- **Where:** web first (`packages/web/src/routes/festival-mode.tsx` now-next strip / pre-festival hero). Mobile only if it proves itself.
- **Effort:** M. **Impact:** low–med (delight, single surface).
- **Sketch:** Pure CSS 3D flip on a per-digit component; flip duration ~40ms/step, stagger 25ms between digits, accent `--color-accent-aqua`, honor `prefers-reduced-motion` (fall back to instant digit swap). No library. Gate strictly to the countdown hero — it must NOT become a general number style (N1 owns metrics). **Recommend building only after N1/N2.** It's the one "novelty" idea from the research that fits Festie's festival theme without diluting the system.

### N5 — Codified section-gap rhythm token + display-weight audit
- **What:** Refero's four production systems converge on two typographic disciplines Festie hasn't codified: (a) **section rhythm** — tight 8–16px element gaps but generous 80–120px *between sections* — and (b) **light display weights** at large sizes (Linear 300, Mercury 360) for "authority through restraint." Festie's spacing scale tops out at `--space-12: 3rem (48px)`; there is no section-gap token, and Syncopate display is locked at `font-weight: 700` everywhere (`type-display-*`).
- **Where:** both (token + audit). `packages/web/src/styles/theme.css` (`@theme` spacing), `packages/shared/src/tokens/spacing.ts`.
- **Effort:** S (token) / M (weight audit). **Impact:** low–med.
- **Sketch:** Add `--space-16: 4rem` / `--space-20: 5rem` and adopt them as the standard gap between major page sections (festival hero → schedule, crew sections). The display-weight half is a **taste call, not a fix**: trialing Syncopate 700→400 at ≥48px (festival hero, Wrap year headline) is exactly the Linear/Apple move, but it changes Festie's established loud-display character. Flag for the principal designer; do not ship unilaterally.

---

## Top 5 ranked — principal designer's call

Festie's design language is finished and coherent. The bar for any addition is: *does it strengthen the existing system, or just add surface?* Four of the eight sites (minimal.gallery, dark.design, and most of shadcn/refero) are **confirmation, not new direction** — they validate that Festie is already doing the right things. That is the most important finding: **the correct default is to add almost nothing.**

**Build, in order:**

1. **N1 — Animated number transitions (S, med).** The clear winner: it's the one prior-round recommendation (R10) that verifiably never shipped, it's a self-contained hook, it honors reduce-motion, and "live" numbers reinforce Festie's real-time identity. Ship first.
2. **N2 — Mobile Button primitive (M, high).** Highest *impact*. It's already the audit's F8, and the shadcn research independently confirms the variant taxonomy. Extracting it eliminates the accent-rule/AA-contrast drift (F3/F5) at the root instead of whack-a-mole. The only reason it's #2 not #1 is scope.
3. **N5 (token half only) — section-gap tokens (S, low-med).** Cheap, purely additive, no visual regression risk. Add `--space-16/--space-20` and use them; skip the display-weight audit unless the designer green-lights it.
4. **N4 — Split-flap countdown (M, low-med).** The single on-theme novelty. Festival countdowns *want* mechanical tactility. Strictly scoped to one hero. Build only after 1–2 land, and only if there's appetite for delight work.
5. **N3 — Squircle avatars (S, low).** Lowest priority real item. `corner-shape` barely ships in 2026 and the delta is sub-perceptual on mobile. Do it as a one-line web progressive-enhancement when touching Avatar anyway; don't schedule it.

### REJECT (with reasons)

- **Magnetic dock / text-repel / eye-tracking SOS (componentry.fun).** Cursor-proximity physics is a desktop-pointer paradigm; Festie is mobile-first and used one-handed in crowds. An "eye that watches the crew" for SOS is theatrical — emergency UI must be instantly legible, not whimsical. The existing coral SOS FAB + pulse ring (R24) is correct.
- **Dot-matrix loader (dotmatrix).** Festie already standardized loading on skeleton-shimmer (R7) + multi-step text loader (R18). A 5×5 dot grid would introduce a *second* loading vocabulary — the exact fragmentation the design system exists to prevent.
- **Gradient shimmer pills / map drift / avatar halos / Spotify track glow (shadergradient).** Ambient animated gradients on every pill and surface is noise. Festie's zero-shadow, single-accent restraint is its signature; the radial aqua glow (R8) already spends the one "ambient gradient" budget the system can afford. minimal.gallery and dark.design both argue *against* this.
- **Bento grid for the crew roster / pricing tiers / feature carousel (21st.dev).** Crew is a scannable list, not a marketing page; a bento roster trades glanceability for visual flair. Pricing tiers don't exist in the product. Feature carousels are landing-page furniture.
- **Display-weight 700→300 across the board (refero).** Tempting, but it would rewrite Festie's established loud-festival display character. This is a brand decision for a human, not a research-driven sweep — listed under N5 as a flagged taste call, not a recommendation to ship.
- **Sparkles text for urgent updates (21st.dev).** Sparkle particles on "Stage closed" / "Meet at coordinates" trivializes safety-critical copy. Urgency comes from contrast and placement, not glitter.
