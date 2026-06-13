# Festie Design Roadmap — 2026-06-07

## Executive summary

This roadmap merges the **internal design review** (`docs/audits/design-review-internal-2026-06-07.md`, 51 findings) with the **external research** (`docs/research/design-references-2026-06-07.md`). Every internal gap below is paired with a proven, named external pattern and the source app to copy from — Festie should *borrow*, not reinvent.

**Four dominant themes:**

1. **One broken color pair, everywhere.** White text on coral `#ff3366` (~3.55:1) fails WCAG AA on the safety-critical SOS button, every mobile coral CTA, web Wrap tabs, and the forgot-password box. The team already fixed it once (`--color-day-tab-active #c01d3a`); it just never propagated. External backstop: WCAG 2.2 SC 1.4.3 (4.5:1 small text) + the research's rule "saturated red reserved for conflict + SOS only."
2. **No single primary-action color.** Aqua and coral are both used as "primary" with no rule (Upload=aqua, Create Crew=coral, onboarding Next=coral=danger). Research mandate: "**one accent** for the single primary action / active state per screen."
3. **Web↔mobile drift vs. the parity mandate.** Brand fonts (Syncopate/Space Grotesk) never load on mobile (Roboto fallback); day-pill accent differs (aqua vs crimson); nav labels diverge; the schedule tab is misnamed "Timeline."
4. **Hierarchy collapse on the densest screen.** The mobile Crew tab is a flat wall of 7 identical full-width rows; web already solves it with a tab bar. Clashfinder/Eleken's lesson — single-axis structure on phone, dense grid only on web — applies broadly.

**Overall design maturity: high intent, incomplete application.** Festie has a real centralized token system (`packages/shared/src/tokens/`), an enforced design discipline with documented rationales, and a strong web implementation (lucide icons, `.glass` panels, `ensureWhiteContrast`, AA-corrected day pills, 44px `IconButton`). This is a "finish the migration" roadmap, not a redesign. **Do first:** the P0 contrast + font + accent-rule cluster — they are token swaps and component reuse that erase the two High findings and the #1/#2 themes in days, not weeks.

**Counts by priority:** P0 = 7 · P1 = 6 · P2 = 8 · Cross-cutting = 3 · Decisions = 5 · Already-strong = 6.

---

## P0 — quick, high-impact wins (low effort, high payoff)

### P0-1 — Fix white-on-coral contrast everywhere (incl. Send SOS)
- **Problem (internal H1 + cross-cutting):** White `#fff` on coral `#ff3366` ≈ 3.55:1, fails AA. Hits the safety-critical SOS fill (`packages/mobile/components/CrewSos.tsx` `styles.sosButton`/`sosButtonText`, plus active "Get directions" l.274-280), mobile "Create Crew"/"Add" (`packages/mobile/app/(tabs)/crew.tsx:998-1007`), onboarding "Next"/"Get started" (`packages/mobile/components/FirstRunIntro.tsx:138-147`), web Wrap tabs (`packages/web/src/routes/wrap.tsx:186,195` ≈2.6:1), and forgot-password box (`packages/web/src/routes/forgot-password.tsx:97`, coral-on-coral ≈1:1).
- **Pattern/Fix:** Adopt **one** on-coral ink convention and centralize it in a shared button style. Either darken the fill to `#c01d3a` (white → ~4.9:1) or render dark ink `text.onLightAccent #080810` — exactly what web's danger Button already does (`bg-accent-coral text-bg-primary`). Source: WCAG 2.2 SC 1.4.3, 4.5:1 floor, "don't round" (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html); research rule "saturated red reserved for conflict + SOS only." For forgot-password use v4 slash syntax `bg-accent-coral/10 … text-accent-coral`; for Wrap use `bg-day-tab-active text-white`.
- **Effort:** S (token swap + one shared style) · **Platforms:** Mobile + Web

### P0-2 — Apply the brand fonts on mobile (Syncopate + Space Grotesk)
- **Problem:** `packages/mobile/hooks/useTokens.ts` `typeStyle()` omits `fontFamily` (l.34-52), so neither display nor body font loads — mobile renders Roboto and reads as a default template vs web's branded type (screens 01/02/06/07/12).
- **Pattern/Fix:** Register fonts via `expo-font`/`@expo-google-fonts` and wire `fontFamily` back into `typeStyle` (at least display roles). Source: research type-scale rules (display tracking -0.02 to -0.04em; Things 3 "type + spacing scale together," https://culturedcode.com/things/blog/2023/09/things-big-and-small/) — and the parity mandate (match web's `font-display`).
- **Effort:** S–M · **Platforms:** Mobile

### P0-3 — Define and enforce one primary-accent rule (coral=CTA vs aqua=selection)
- **Problem (cross-cutting):** No rule for filled aqua vs filled coral. Upload=aqua, Join=aqua, Create Crew=coral, Send SOS=coral, onboarding Next=coral, selection=aqua. The first CTA a new user sees (`FirstRunIntro.tsx:138-143`) speaks "danger."
- **Pattern/Fix:** Pick one primary-fill color, give the other a distinct role, document it as a token rule. Source: research "**one accent** for the single primary action / active state per screen" + "separate semantic palette: green=going, amber=maybe, saturated red reserved for conflict+SOS only" (Linear single rationed accent, https://linear.app). **Recommended direction** (needs user sign-off — see Decisions): aqua = primary CTA + selection, coral = danger/SOS/conflict only. Then recolor onboarding Next → aqua, demote Account "Upload."
- **Effort:** S (decision) + M (apply) · **Platforms:** Mobile + Web

### P0-4 — Make set-detail priority + reminder pickers 44px and legible
- **Problem:** `packages/mobile/app/set/[setId].tsx` `priorityText` = 10px (l.906-908); `priorityButton` has no `minHeight`, computing ~40px (<44px) (l.893-904); the 5 reminder chips ("5m 10m 15m 30m 1h") are forced across one phone width at 10px. Tapped on-site in a crowd.
- **Pattern/Fix:** Labels → 12-14px, `minHeight: 44` on `priorityButton`, let reminder options wrap/scroll. Source: Apple HIG Accessibility (44×44pt, custom type ≥11pt, https://developer.apple.com/design/human-interface-guidelines/accessibility); Material 3 Chips (≤12 short options, ≤2 wrapping rows, https://m3.material.io/components/chips/guidelines).
- **Effort:** S · **Platforms:** Mobile

### P0-5 — Tidy the Crew action cluster (collapse the 7-row wall)
- **Problem (internal H2):** `packages/mobile/app/(tabs)/crew.tsx` top cluster (l.607-715) is 7 full-width rows all sharing `styles.overlapToggle` with zero hierarchy; flat footer stack (l.880-927). Web already solves this exact screen with a tab bar (`CrewTabBar`/`CrewTabContent`).
- **Pattern/Fix:** Minimum viable for P0: collapse the 7 rows into 2-3 labeled clusters ("Plan together" / "On-site" / "Manage"), give Crew plan + Compare primary weight, demote owner rows (Force-add `crew.tsx:762-819`, Reform) into an overflow. Source: Apple HIG Maps muted-vs-default emphasis for info-dense surfaces (https://developer.apple.com/design/human-interface-guidelines/maps); DICE icon+label buttons. (Full segmented tab bar → P1-2.)
- **Effort:** M · **Platforms:** Mobile

### P0-6 — Rename the mobile "Timeline" tab to "Schedule"
- **Problem (themes + copy):** Tab title + a11y label are "Timeline" (`packages/mobile/app/(tabs)/_layout.tsx:61,66`) but it holds a Timeline/Grid/Cards segmented control. Web names it "Schedule" (`BottomNav.tsx:99`); mobile's own Picks empty-state copy (`picks.tsx:452,460`) and onboarding (`FirstRunIntro.tsx:16`) say "Schedule." Three-way mismatch + dead-end empty states (no `action` passed to `EmptyState` though it supports one).
- **Pattern/Fix:** Rename tab → "Schedule," reserve "Timeline" for the inner view; share one per-platform `scheduleTabLabel` constant so copy can't drift; add "Choose a festival" / "Join this festival" action buttons to the Picks empty states. Source: research async-state trio — one shared `EmptyState` with CTA (LogRocket, https://blog.logrocket.com/ui-design-best-practices-loading-error-empty-state-react/).
- **Effort:** S · **Platforms:** Mobile

### P0-7 — Stage-pill luminance fix on mobile set cards
- **Problem:** `packages/mobile/components/SetCardMobile.tsx` `stagePill` paints raw `stageColor` (l.173) under white 10px text (l.343-346); the amber DOME pill reads ~1.7:1 (`05-cards.png`). Web is already protected via `StageBadge.tsx` → `ensureWhiteContrast()` (~4.6:1).
- **Pattern/Fix:** Lift `ensureWhiteContrast()` into `@festie/shared` and call from `SetCardMobile` (plus GridView headers / TBASection). Source: Material 3 color-contrast (3:1 graphics / clustered containers each ≥3:1, https://m3.material.io/foundations/designing/color-contrast); research "one meaning per color + icon/label."
- **Effort:** S · **Platforms:** Mobile (shared helper)

---

## P1 — structural / feature-shaping (bigger, high value)

### P1-1 — Mobile schedule = timeline/list-first; dense grid stays web/tablet
- **Problem:** Mobile defaults to a 2D-grid mental model; a multi-stage stage×time grid does not fit a phone. (Touches `packages/mobile/app/(tabs)/index.tsx` segmented control + the Grid view, and web `routes/grid.tsx`.)
- **Pattern/Fix:** On mobile lead with a single-axis vertical timeline (time down the page) or swipeable per-stage/per-day list; ship the dense multi-stage grid only on festie.us (stages=columns, hours scroll horizontally, duration-sized blocks, red "now" line, virtualized). Source: **Clashfinder** — the canonical grid explicitly degrades to a collapsible act list on mobile because "the structure's broken down to fit on the screen" (https://clashfinder.com/); **Planby** virtualized EPG (https://planby.app/); **Eleken** "don't shrink the desktop grid" (https://www.eleken.co/blog-posts/calendar-ui). Model time gutter on **Notion Calendar** (monospaced 11px gutter, https://blakecrosley.com/guides/design/notion-calendar).
- **Effort:** L · **Platforms:** Mobile (+ web grid hardening)

### P1-2 — Now/Next live-day surface (Live Activity + widget + push)
- **Problem:** The "Live"/Festival-Mode now/up-next data exists but only inside the app, and the "Live" button is ambiguously named (`index.tsx:426-435` vs adjacent `LiveDot` l.415 vs Crew "Live location" — three meanings). Also the full Crew tab-bar from P0-5.
- **Pattern/Fix:** Build a Live Activity / Android ongoing notification around *current set + next pick + walk time*, plus a home-screen widget; rename in-app "Live" → "Now & Next," reserve "Live" for location. Adopt the full web-style segmented Crew tab bar (Members/Plan/Logistics/Money) on mobile. Source: **Coachella** Home Screen widget + Lock Screen Live Activity reviewers praise (https://apps.apple.com/us/app/coachella-official/id632833729); **Woov** artist-start push (https://woov.com/).
- **Effort:** L · **Platforms:** Mobile

### P1-3 — Picks as color priority tiers + auto-conflict prompt + re-anchoring reminders
- **Problem:** Priority is under-expressed: card controls are icon-only with no labels (`SetCardMobile.tsx` `PriorityButton` l.106-129); web crew-plan badges are hardcoded coral for every pick (`routes/crew-plan.tsx:227 bg-accent-coral/15`) regardless of must/want/maybe. Reminders are stored as fixed timestamps (related to the known `setStatus` TZ bug).
- **Pattern/Fix:** Render priority as color on the timeline using existing `--color-priority-must/want/maybe`; auto-flag overlaps and surface an explicit "you have a conflict" resolution prompt when two high-priority picks clash. Store reminders **relative to the set** (recompute on schedule sync) and **compute fire times in the festival's timezone, not the device's** (directly mitigates `bug_setstatus_timezone`). Source: **Clashfinder** color-tiered highlights + auto-conflict detection (https://clashfinder.com/); **Woov** "reminders update automatically when the schedule changes" + 30-min default lead (https://woov.com/).
- **Effort:** M–L · **Platforms:** Mobile + Web

### P1-4 — Avatar map markers with stale/SOS overlays + time-boxed sharing
- **Problem:** Crew location is split across scattered doors ("Crew map" → /map, "Meeting-point compass" → /compass, "Meeting points" footer — `crew.tsx:676-701,897-899`) and (per research) generic pins rather than avatars; live-share lacks an enforced opt-in/duration/Stop model.
- **Pattern/Fix:** Circular avatar (or 2-letter initials) per crew member; battery badge when low; **fade/desaturate + "last seen 12m ago" chip when stale**; pulsing ring when live; keep SOS markers OUT of clustering. Live-share = opt-in sheet with duration presets (default bounded ~2h) + festival-native option ("Until the festival ends"), always-visible "Stop sharing" banner, background-persist indicator (no silent drops). Co-locate map/compass/meeting-points under one "Find each other" destination. Source: **Snap Map** avatar-as-marker + stale fade (https://9meters.com/entertainment/social-media/snap-map-bitmoji-meanings-icons-and-symbols-explained); **Map UI Patterns** share-live-location spec (https://mapuipatterns.com/share-live-location/); **Apple Find My** human-readable durations (https://support.apple.com/en-us/105104); **Apple HIG Maps** muted basemap + custom markers (https://developer.apple.com/design/human-interface-guidelines/maps). Lean on offline (Festie's #1 priority) as the differentiator competitors lack.
- **Effort:** L · **Platforms:** Mobile (+ web map)

### P1-5 — Phase-aware home (pre / live-day / post)
- **Problem:** Home shows the same content regardless of festival phase; static logistics compete with live tasks.
- **Pattern/Fix:** One phase-aware home — pre = picks/lineup/crew invites/Spotify; live-day = now/next + live map + SOS + meeting points; post = wrap-up + expenses/settle-up. Dump static logistics into a searchable knowledge base so the main surface stays lean. Source: **Coachella 2016 phased-content case study** — four phases + content-priority matrix (https://wilsontu.com/coachella/).
- **Effort:** L · **Platforms:** Mobile + Web

### P1-6 — Splitwise-style net settle-up
- **Problem:** Expenses lack a consolidated net-balance settle-up view.
- **Pattern/Fix:** Surface one actionable net number per crew member ("You owe Sam $14"), a "Settle Up" that clears multiple expenses at once, and never introduce a stranger-to-pay; offer a raw-vs-simplified toggle. Use tabular numerals for all amounts. Source: **Splitwise** debt-simplification invariants — equal net, no new creditors, no one owes more (https://blog.splitwise.com/2012/09/14/debts-made-simple/).
- **Effort:** M · **Platforms:** Mobile + Web

---

## P2 — polish

- **P2-1 — Onboarding visual upgrade.** Mobile onboarding is a generic centered template with ~40% void (`FirstRunIntro.tsx`, `01-launch.png`). Anchor the block lower, use a real product screenshot / festival imagery on slide 1; align web (2 steps) vs mobile (3 dots) narrative, single-source copy in `@festie/shared`. Source: Appcues ≤3-5 steps, value before sign-up (https://www.appcues.com/blog/mobile-onboarding-best-practices). **S–M · Mobile + Web**
- **P2-2 — Skeleton loading states.** Replace bare spinners (mobile crew "Loading your crews…" `crew.tsx:414-421`; also Picks/Wrap) with skeletons matching final geometry; show cached crew data immediately per the offline architecture. Source: LogRocket — spinner only with no data, skeleton-matches-final-geometry (https://blog.logrocket.com/ui-design-best-practices-loading-error-empty-state-react/). **M · Mobile**
- **P2-3 — Error-toast verb voice.** Standardize on "Couldn't <verb> <object>. Try again." (the account folder is the model); bring crew/admin/picks ("Failed to…" / "Could not…") in line. **S · Mobile + Web**
- **P2-4 — Copy consistency sweep.** One guest-browse phrase ("Browse without an account"), one Terms/Privacy ordering+naming, "Sign in" on both, drop redundant "Login successful" toast, no terminal period on single-fragment toasts ("Joined crew!" → "Joined crew"), Unicode "…" everywhere, sentence-case mobile primary buttons. (`login.tsx`, `register.tsx` web+mobile, `LiveLocationControls.tsx:147,166`, `useFestivalLoader.ts:80`, `FestivalList.tsx:126`.) **S · Mobile + Web**
- **P2-5 — Web auth polish.** Fix undefined `--accent` token (login/register links indistinguishable, `login.tsx:190`, `register.tsx:244,248,252`) → `text-accent-aqua` + underline; extract one `AuthTabs` component (login pill vs register split, `login.tsx:65-101` vs `register.tsx:99-134`); password show/hide → shared `IconButton` (44px + focus ring, `login.tsx:173-180`). **S–M · Web**
- **P2-6 — Web nav consolidation.** Fold Schedule/Timeline/Grid into one "Schedule" tab with in-page switcher (parity with mobile SegmentedControl) → ~5 tabs instead of up to 7 (`components/layout/BottomNav.tsx:99-125`). **M · Web**
- **P2-7 — Micro-interaction + icon cleanup.** Replace `hover:brightness-110`+`transition-all` with `*-hover` tokens + `transition-colors` (`routes/crew.tsx:249,259`, `FestivalDayBanner.tsx:53`, `OfflineReadinessCard.tsx:115`); admin bars `transition-all` width → `scaleX`; lucide `ChevronRight` for raw `→` glyphs (`crew.tsx:253,263`); admin emoji icons + `←` → lucide; `font-display` on `crew-plan.tsx:155` / `compare.tsx:68` h1s; "NOW" marker `grid.tsx:196` → `--font-size-10`. Spring ~0.09s / ease-out ~0.35-0.4s; respect `prefers-reduced-motion`. Source: Arc timing values (https://www.saasui.design/application/arc-browser); the anti-slop checklist. **S–M · Web (+ mobile motion)**
- **P2-8 — Mobile chrome consistency.** One header convention for pushed peer screens (custom `ScreenHeader` vs native Stack vs modal handle); one shared `SectionLabel` (uppercase tracked); drop duplicate "Profile Photo" heading (`account.tsx:137` over `AccountAvatarSection.tsx:153`); hide decorative header glyph from a11y tree; less-overloaded transfer-ownership glyph (`crew.tsx:853`); group/sort festival picker live+upcoming first (de-emphasize past). **S–M · Mobile**

---

## Cross-cutting

### Copy / microcopy
Festie has no copy style guide yet. Adopt: error voice "Couldn't <verb> <object>. Try again." · one canonical guest-browse phrase · Unicode ellipsis "…" · sentence-case buttons · single-sourced `scheduleTabLabel` and consent strings in `@festie/shared`. (Drives P0-6, P2-3, P2-4.)

### Accessibility — concrete thresholds to adopt as the self-audit checklist
- **Touch targets:** mobile ≥44×44pt (iOS) / 48×48dp (Android); web ≥24×24 CSS px (WCAG 2.2 AA), 44px for primary actions. Decouple hit-area from visual size. Audit: map pins, SOS, schedule cells/swipe-card, expense icons, crew rows, icon-only header buttons. (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- **Spacing between targets:** ≥8dp/8px; ~12pt around bezeled buttons; ~24pt around bare icon-only buttons.
- **Contrast:** text ≥4.5:1 body / ≥3:1 large (≥18pt or ≥14pt bold), don't round; non-text UI ≥3:1; clustered containers each ≥3:1. Dark-first stretch: strive 7:1 body / APCA Lc ≥75 (prefer 90) body, ≥45 secondary, never below Lc 30 readable (tuning target, not yet a release blocker). (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html, APCA https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell)
- **Type scale:** 12/14/16/18/24/32/48/64; body 17pt iOS / 16px web; never below 11pt; tabular numerals for all aligned numbers (schedule gutter, set times, expenses, crew counts); honor Dynamic Type to ~200% on dense screens.
- **Lever:** lift web's helpers (`ensureWhiteContrast`, dark-ink coral, 44px `IconButton`/`Button`) into `@festie/shared` — resolves most a11y findings at once.

### Visual-system tokens (dark-first, for `@festie/shared`)
Two-tier+ ramp on near-black (not #000): bg `#0A0A0B`, surface `#161618`, elevated `#1F1F22`; hairline borders `rgba(255,255,255,0.08)` / strong `~0.14` (borders for cards, shadow for modals/sheets/FAB only); text primary `#F7F8F8` (never pure white) / secondary `~#B3B3B3` / tertiary `~#737373`; grid lines `rgba(255,255,255,0.09)`, muted basemap so avatars + red SOS pop. **One accent** per screen; red reserved for conflict + SOS. Source: Vercel/Geist ramp (https://vercel.com/geist/colors) + Linear 4-step surfaces (https://linear.app) + Spotify `#b3b3b3` secondary (https://blakecrosley.com/guides/design/spotify). Also fix the improvised day-pill shadow `rgba(255,80,110,0.45)` + off-scale `py-[7px]` (`SubHeader.tsx:174,165`) → `--shadow-glow-coral` + `py-2`.

---

## Decisions needed from the user (brand/taste calls — don't make unilaterally)

1. **Accent direction (blocks P0-3).** Recommended: aqua = primary CTA + selection, coral = danger/SOS/conflict only. Confirm, or invert (coral = primary CTA). One must win.
2. **How far to push the redesign.** Roadmap is scoped as "finish the migration" (token swaps + reuse). Confirm we are NOT doing a ground-up visual redesign — or say so and P1/P2 scope grows.
   - **RATIFIED (2026-06-10, DC13):** finish-the-migration is the end state. The migration is ~95% landed (P0 fully, P1 fully, most of P2); remaining polish items drop to normal backlog. No ground-up redesign. **This roadmap is closed.**
3. **Mobile grid removal (P1-1).** OK to drop the pinch-zoom 2D stage×time grid on phones in favor of timeline/list, keeping the dense grid web/tablet-only? (Clashfinder precedent.)
4. **Icon vocabulary.** Standardize fully on lucide (web) and a single RN icon set (mobile), retiring emoji (admin) and raw text glyphs (`→`, `←`)? Confirm the canonical set per platform.
5. **Brand font choice on mobile (P0-2).** Confirm Syncopate (display) + Space Grotesk (body) are the intended faces to register, matching web — or substitute.

---

## Already strong — do NOT touch

1. **Centralized token system** — `packages/shared/src/tokens/` (colors, typography, spacing) consumed by both apps; the right values almost always already exist.
2. **Enforced anti-slop discipline** — the team caught/fixed the white-on-coral day pill (`theme.css:426-428`), added hover tokens to replace `brightness` (`theme.css:454-455`), and documents deliberate font-drift fixes in comments.
3. **Strong web implementation** — lucide icon system, `.glass` panels, `StageBadge` `ensureWhiteContrast()`, AA-corrected day pills, dark-ink coral CTAs, shared `IconButton` (44px + focus ring), `EmptyState` with action support.
4. **The Crew screen IS mostly sectioned** — Members, Live location & SOS, Meeting points, Polls, Packing, Rides, Expenses, Activity are labeled; Force-add is owner-gated and separated. The defect is only the top action cluster (P0-5).
5. **Set-card priority controls are distinct glyphs with correct aria-labels** (not color-only), and the mobile SegmentedControl is the right pattern web should copy.
6. **Onboarding copy and the account-folder error copy** are the right house style — propagate, don't rewrite.
