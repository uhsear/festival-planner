# Festie Internal Design Review — 2026-06-07

## Executive summary

This review consolidates verified findings from six internal design lenses — mobile
screen design, web page design (anti-slop + a11y + Rams), copy/microcopy, accessibility,
visual-system/token parity, and IA/flows. Duplicate findings raised by multiple lenses
(e.g. white-on-coral contrast surfaced by three lenses; the Crew action wall by two) have
been merged into single entries and ranked by the highest severity any lens assigned.

### Themes

1. **One broken color pair, repeated everywhere: white text on coral `#ff3366`.** It
   measures ~3.55:1 (fails WCAG AA 4.5:1) and recurs on the safety-critical SOS button,
   every mobile coral CTA, the web Wrap tabs, and the forgot-password error box. The team
   already solved this once (`--color-day-tab-active #c01d3a`, and web's danger Button uses
   dark ink) — mobile and a few web spots never adopted the fix.
2. **Hierarchy collapse on the most feature-dense screen.** The mobile Crew tab is a wall
   of visually identical full-width rows with no in-screen structure, while web solves the
   same screen with a tab bar (CrewTabBar/CrewTabContent).
3. **Web↔mobile drift against the parity mandate.** Brand fonts missing on mobile, day-pill
   accent differs (aqua vs crimson), accent semantics (coral=danger vs coral=primary) are
   inconsistent, nav labels and tab names diverge, and onboarding tells different stories.
4. **Copy has no style guide yet.** Error verbs, ellipsis characters, button casing,
   consent wording, and the guest-browse CTA each drift — often *within* a single platform.
5. **A "Schedule" tab that does not exist on mobile.** Empty-state copy points users at a
   tab labeled "Timeline", and the empty states are dead ends with no action button.

### Counts by severity (after dedup)

| Severity | Count |
|----------|-------|
| High     | 2     |
| Medium   | 18    |
| Low      | 22    |
| Nit      | 9     |
| **Total**| **51**|

### Overall design maturity

Festie has a real, opinionated design system: centralized tokens in
`packages/shared/src/tokens/`, an anti-AI-slop checklist the team actually enforces,
documented contrast fixes with rationale comments in `theme.css`, and a strong web
implementation (lucide icon system, `.glass` panels, AA-corrected day pills, dark-ink
coral CTAs). The maturity gap is **consistency of application, not design intent**: the
correct decisions exist but were not propagated to mobile or to a few late-added web
surfaces. This is a "finish the migration" review, not a "redesign" review — most fixes are
swapping a token, reusing an existing component, or moving the right value that already
lives in the system. The two High items (SOS contrast, Crew hierarchy) are the only ones
that materially hurt usability today.

---

## Top issues (High)

### H1 — Safety-critical "Send SOS" button fails contrast
- **Area:** Mobile / accessibility
- **Location:** `packages/mobile/components/CrewSos.tsx` — `styles.sosButton`
  (`backgroundColor: accent.coral`) + `styles.sosButtonText` (`color: text.onAccent #fff`,
  700, `typeStyle('label')` = 14px). Visible in `09-sos.png`.
- **Problem:** White `#ffffff` on coral `#ff3366` measures ~3.55:1, below the AA 4.5:1 floor.
  At 14px bold this is *not* "large text" (needs ≥18.66px bold), so 4.5:1 applies and it
  fails. This is the app's most important control to read under stress. The team already
  treats white-on-`#ff3366` as a defect — `theme.css:427-428` created
  `--color-day-tab-active #c01d3a` precisely for this — but the SOS fill never got the fix.
- **Fix:** Darken the SOS fill to `#c01d3a` (white reaches ~4.9:1) **or** render dark ink
  `text.onLightAccent #080810` (~5.8:1), as web's danger Button does
  (`bg-accent-coral text-bg-primary`). Keep bright coral only on the non-text warning icon.

### H2 — Mobile Crew tab is an ungrouped wall of identical actions
- **Area:** Mobile / IA & hierarchy
- **Location:** `packages/mobile/app/(tabs)/crew.tsx` — top action cluster lines 607-715
  (Reform, Crew plan, Compare schedules, Full compare grid, Crew map, Meeting-point compass,
  Share plan), plus the footer section stack lines 880-927.
- **Problem:** The top cluster is 7 full-width rows all sharing `styles.overlapToggle`
  (leading aqua icon + label + chevron, identical height/border/bg) with zero hierarchy — a
  "navigation dump" the user must scan linearly. Below it the footer stacks ~10 same-weight
  section blocks. Nothing separates everyday tasks (Crew plan, Compare, SOS) from edge cases
  (owner-gated Force-add, Reform). Web solves exactly this screen with a tab bar
  (`CrewTabBar`/`CrewTabContent`), so mobile is both harder to use and divergent.
  *(Nuance from cross-check: the rest of the Crew screen IS sectioned with labels, and
  Force-add is rendered separately and owner-gated — the defensible defect is the ungrouped
  7-row top cluster plus flat footer, not an "8-row dump including Force-add".)*
- **Fix:** Adopt the web pattern — a segmented/tab bar inside the active-crew screen
  (Members / Plan / Logistics / Money) — or at minimum collapse the 7 rows into 2-3 labeled
  clusters ("Plan together", "On-site", "Manage"), give Crew plan + Compare primary weight,
  and demote owner/admin rows (Force-add, Reform) into an overflow. Consider a 2-column tile
  grid so the shortcuts stop reading as one undifferentiated list.

---

## By surface

### Mobile

#### Onboarding — `components/FirstRunIntro.tsx`
- **[Medium] Coral CTA uses the danger color for the primary action.** The filled "Next"/
  "Get started" button (lines 138-143) is coral, but coral is the danger/"must" accent
  (same fill as Send SOS). On this same screen the icon (l.50) and active dots (l.135) are
  aqua — the primary-action color. So the very first CTA a user sees speaks "danger" while
  the screen speaks "primary." *Fix:* make the CTA aqua + dark ink, matching the screen's
  own icon/dots and the rest of mobile's primary language. (Also folds into the contrast and
  accent-semantics items below.)
- **[Low] Generic centered macrostructure.** Lone outline icon + centered title/body + dots
  + full-width button, dead-centered with ~40% void above/below (`01-launch.png`).
  Indistinguishable from a template. *Fix:* anchor the block lower; use a real product
  screenshot / festival imagery on slide 1.
- **[Low] Screen-reader/target gaps.** Skip `TouchableOpacity` (l.43) wraps only the ~21px
  label with no `hitSlop`/min-size; advancing slides via `setIndex` has no
  `accessibilityLiveRegion`/focus move; dots (l.57-60) convey step by color/width only.
  *Fix:* `hitSlop={12}` (or min 44px) on Skip; `accessibilityLiveRegion='polite'` on the
  slide body; `accessibilityLabel="Step {i+1} of {n}"` on the dots row.

#### Schedule tab (first tab) — `app/(tabs)/index.tsx`, `app/(tabs)/_layout.tsx`
- **[Medium] Tab is mislabeled "Timeline".** The tab title + `tabBarAccessibilityLabel`
  are "Timeline" (`_layout.tsx:61,66`) but the tab holds a Timeline/Grid/Cards segmented
  control and defaults to Cards for all-TBA festivals (`index.tsx:179`). Web names the same
  entry "Schedule" (`BottomNav.tsx:99`), and mobile's own Picks empty-state copy says
  "Schedule tab." The container is named after one of its three child views and disagrees
  with both copy and web. *Fix:* rename the tab to "Schedule"; reserve "Timeline" for the
  inner view.
- **[Low] "Live" header button is ambiguous.** The flash-icon "Live" button (l.426-435)
  opens Festival Mode (now/up-next), while a `LiveDot` sits adjacent (l.415) and the Crew
  tab has "Live location." "Live" carries three meanings. *Fix:* rename to "Now" / "Now &
  Next" and reserve "Live" for location.
- **[Low] Festival picker leads with a past event.** `02-cards`/`02` shows "Forbidden
  Kingdom 2026 — Past" given equal prominence *above* "North Coast 2026 — Upcoming." Raw
  date order buries the actionable choice. *Fix:* group/sort live + upcoming first, past
  de-emphasized under a subheading; default selection to nearest upcoming.

#### Picks tab — `app/(tabs)/picks.tsx`
- **[Medium] Empty-state copy references a non-existent "Schedule" tab.** Lines 452 & 460
  ("Choose a festival from the Schedule tab…", "Open the Schedule tab…") point at a tab
  labeled "Timeline" (`11-picks.png` confirms). *Fix:* say "Timeline tab" (or rename the
  tab per above) and share one per-platform `scheduleTabLabel` constant so copy and tab
  title can't drift.
- **[Medium] Empty states are dead ends.** Both pass no `action` to `EmptyState`, though the
  component supports an action button (`EmptyState.tsx:13-14,42-50`) and `index.tsx:398`
  already uses it. *Fix:* add "Choose a festival" / "Join this festival" action buttons that
  navigate/trigger the flow.
- **[Low] Set-card priority controls have no labels; "maybe" glyph is weak.**
  `components/SetCardMobile.tsx` `PriorityButton` (l.106-129) renders icon-only star/heart/
  `ellipse` circles; labels exist only on the detail screen, and the filled-dot "ellipse"
  is not a recognizable "maybe." *(They are distinct glyphs with aria-labels, not "identical
  grey circles," and selection adds fill — meaning isn't color-only.)* *Fix:* add tiny
  Must/Want/Maybe labels on the card and swap the dot for a clearer "maybe" glyph.

#### Set detail — `app/set/[setId].tsx`
- **[Medium] Priority + reminder pickers are too small to read and too short to hit.**
  `styles.priorityText` = `typeStyle('micro')` = 10px (l.906-908); `priorityButton` has
  `paddingVertical: spacing[3]` (12) and **no `minHeight`** (l.893-904), computing to ~40px
  tall (< 44px). The 5 reminder chips ("5m 10m 15m 30m 1h") are forced across one phone
  width at 10px. These are tapped on-site in a crowd. *Fix:* raise picker labels to 12-14px,
  add `minHeight: 44` to `priorityButton`, and let the 5 reminder options wrap/scroll.

#### Set cards — `components/SetCardMobile.tsx`
- **[Medium] Stage pill paints raw stage color under white text with no luminance fix.**
  `styles.stagePill` uses `backgroundColor: stageColor` (l.173) + white `text.onAccent`
  10px (l.343-346); the amber DOME pill in `05-cards.png` reads ~1.7:1. Web is protected —
  `StageBadge.tsx` runs `ensureWhiteContrast()` to darken light stages to ~4.6:1. *Fix:*
  lift `ensureWhiteContrast()` into `@festie/shared` and call it from `SetCardMobile` (and
  GridView headers / TBASection), or pick dark/light ink by computed luminance.

#### Crew tab — `app/(tabs)/crew.tsx` (beyond H2)
- **[Medium] Three overlapping comparison doors + three scattered location doors.** "Crew
  plan" (→/crew-plan), inline "Compare schedules" overlap toggle, and "Full compare grid"
  (→/crew-compare) sit adjacent (l.627-673); "Crew map" (→/map), "Meeting-point compass"
  (→/compass), and a "Meeting points" footer section are peers (l.676-701, 897-899). The
  user can't predict which answers "what are we seeing / where is everyone." *Fix:* make
  "Crew plan" the single comparison entry with overlap + grid as views inside it; co-locate
  map/compass/meeting-points under one "Find each other" destination.
- **[Medium] "Create Crew" / "Add" coral CTAs fail contrast.** `styles.primaryButton`/
  `primaryButtonText` (l.998-1007), white on coral. (See cross-cutting contrast item.)
- **[Low] Transfer-ownership star glyph is ambiguous next to the kick button.** Amber
  `star-outline` (l.853) = "Transfer ownership" reads as a favorite toggle and sits one tap
  from `person-remove-outline` (l.862). *Fix:* use a less overloaded glyph (swap/shield/
  ribbon) or move transfer into a per-member overflow. (a11y label already correct.)
- **[Low] Owner "Force-add member by user ID" has everyday visual weight.** l.762-819 uses
  the same `styles.overlapToggle` as Crew plan/Compare though it's admin/debug-grade (paste
  a raw user_id). *Fix:* move owner admin actions (Force-add, Regenerate invite, Reform)
  into a labeled "Manage crew"/overflow section.
- **[Low] Loading is a bare spinner, not a skeleton.** `07-picks`/`07` shows a lone teal
  refresh glyph in a black void ("Loading your crews…", l.414-421); on weak signal it reads
  as a hang, and the project's frontend-ui guidance prefers skeletons. *Fix:* render a
  lightweight skeleton of the crew header + member rows, and show cached crew data
  immediately per the offline-cache architecture. (Same applies to Picks/Wrap loads.)

#### Account tab — `app/(tabs)/account.tsx`, `components/AccountAvatarSection.tsx`
- **[Medium] The loudest element is the optional avatar uploader.** `AccountAvatarSection`
  `btnPrimary` "Upload"/"Change" is a full-width bright-aqua button (`12-account.png`) — a
  low-priority action gets the screen's strongest treatment, violating accent restraint.
  *(Part of the accent-semantics item.)* *Fix:* demote "Upload" to outline/secondary (or an
  inline pencil on the avatar).
- **[Low] Duplicate "Profile Photo" heading.** `account.tsx:137` `sectionLabel` "Profile
  Photo" sits directly above `AccountAvatarSection.tsx:153` `rowTitle` "Profile Photo"
  (`12`). *Fix:* drop one — keep just the "JPG or PNG, square works best" helper.

#### Cross-screen mobile chrome
- **[Medium] Brand fonts never applied.** `hooks/useTokens.ts` `typeStyle()` omits
  `fontFamily` (l.34-52), so neither Syncopate (display) nor Space Grotesk (body) loads —
  screenshots 01/02/06/07/12 show Roboto. Type hierarchy collapses to size+weight of one
  system family; the app reads as a default template versus web's branded type. *Fix:*
  register the fonts via `expo-font`/`@expo-google-fonts` and wire `fontFamily` back into
  `typeStyle` for at least the display roles.
- **[Low] Two header systems coexist.** Tabs use a custom branded `ScreenHeader`
  (`headerShown:false`), while wrap/festival-mode/map/compass/plan-share/crew-compare use
  the thin native Stack header, and set-detail uses a bare modal handle. Peer-level pushed
  screens feel like two apps. *Fix:* pick one convention for pushed peer screens.
- **[Low] Section-header casing differs by screen.** Crew uses uppercase tracked captions
  (`crew.tsx:1175-1179`), Account uses Title-Case labels (`account.tsx:321-325`), from the
  same-cased source strings. *Fix:* one shared `SectionLabel` (recommend the uppercase
  treatment).
- **[Nit] Tab title leading icon echoes the bottom tab icon.** `ScreenHeader.tsx:28`
  prefixes each tab title with an aqua glyph duplicating the active tab icon below
  (02/06/07/11/12). *Fix:* drop the leading icon on tab roots, or reserve it where it
  disambiguates.
- **[Nit] Decorative header glyph not hidden from a11y tree.** `ScreenHeader.tsx:28`
  Ionicons lacks `accessibilityElementsHidden`/`importantForAccessibility`, unlike
  `FestivalList.tsx:60-91`. *Fix:* match the FestivalList pattern.
- **[Nit] Primary-button casing mixed.** "Sign In"/"Create Account"/"Sign Out" (Title Case)
  vs "Get started"/"Next"/"Skip" (sentence case). *Fix:* sentence case everywhere.

### Web

#### Auth (login / register) — `routes/login.tsx`, `routes/register.tsx`
- **[Medium] "Forgot password?" and TOS/Privacy links point at an undefined token.**
  `--accent` is defined nowhere in `packages/web`; `text-[var(--accent)] no-underline` on
  `login.tsx:190` and `register.tsx:244,248` inherits body color with no underline, so the
  links are indistinguishable from static copy (distinguished by *nothing*). The TOS
  checkbox `accent-[var(--accent)]` (l.252) falls back to browser-default blue, off-brand.
  *Fix:* `text-accent-aqua` + `underline hover:underline` on the links;
  `accent-[var(--color-accent-aqua)]` on the checkbox (or define `--accent` in `:root`).
- **[Medium] Login vs Register auth toggle styled two different ways.** Login is a pill
  group (`bg-bg-secondary rounded-full`, inner pills, `py-2`, `login.tsx:65-101`); Register
  is a bordered split (`border rounded-DEFAULT overflow-hidden`, no track, `py-[--space-6]`,
  `register.tsx:99-134`). Switching tabs changes the control's shape/height/fill. *Fix:*
  extract one `AuthTabs` component; standardize on the login pill treatment.
- **[Medium] Password show/hide toggle is a 20px target with no focus ring.**
  `login.tsx:173-180` (and register) is a bare `<button>` with a 20px icon, no min-size/
  padding (below WCAG 2.5.8 24px and the app's own 44px floor), and no `focus-visible`
  style. *Fix:* use the shared `IconButton` (min-h-11/min-w-11 + `focus-visible:outline-
  accent-aqua`), keep the aria-label.
- **[Medium] Forgot-password error box renders coral-on-coral.** `forgot-password.tsx:97`
  has no `.glass`, so `bg-accent-coral` + the dead `bg-opacity-10` utility yields a solid
  coral fill under `text-accent-coral` ≈ 1:1, unreadable when a reset error shows. *Fix:*
  `bg-accent-coral/10 … text-accent-coral` (v4 slash syntax). (See Toast item for the
  related dead-utility cleanup.)

#### Wrap — `routes/wrap.tsx`
- **[Medium] Active You/Crew tab is white-on-coral (~2.6:1).** `wrap.tsx:186,195` uses
  `bg-accent-coral text-white`, the exact pair `theme.css:426-428` documents as failing and
  replaced with `--color-day-tab-active` for day pills. *Fix:* `bg-day-tab-active text-white`
  or dark ink `text-[var(--text-on-light-accent)]`.
- **[Low] h1 font drift.** `wrap.tsx:264` correctly uses `font-display` (and even carries a
  comment that this drift was fixed here) — but compare/crew-plan were missed (see below).

#### Crew — `routes/crew.tsx`
- **[Low] Accent CTAs hover via `brightness-110` + `transition-all`.** "Crew plan"/"Compare
  schedules" (l.249,259) use `hover:brightness-110` though `--color-accent-aqua-hover`/
  `-coral-hover` (theme.css:454-455) were added to replace the blunt filter, and
  `transition-all` (l.249) is barred by the anti-slop checklist. *Fix:*
  `hover:bg-[var(--color-accent-coral-hover)]`/`-aqua-hover` and `transition-colors`.
  (Same brightness drift also at `FestivalDayBanner.tsx:53`, `OfflineReadinessCard.tsx:115`.)
- **[Nit] Trailing `→` text glyph mixes into the lucide system.** l.253,263 pair a leading
  lucide icon with a raw `{'→'}`. *Fix:* lucide `ChevronRight`/`ArrowRight`.

#### Crew plan — `routes/crew-plan.tsx`
- **[Medium] "Up next" priority badges are hardcoded coral.** l.227
  `bg-accent-coral/15 text-accent-coral` for every member pick; only the label text changes
  via `PRIORITY_LABEL`. So a "Want"/"Maybe" pick renders in the must-color, contradicting
  the coral=must / aqua=want / amber=maybe language used on picks/compare. *Fix:* drive
  bg/text from `p.priority` reusing `--color-priority-must/want/maybe`.
- **[Low] h1 font drift.** `crew-plan.tsx:155` `text-xl font-bold` (body font) vs
  account/wrap `font-display font-bold`. *Fix:* `text-xl font-display font-bold` (extract a
  `PageTitle`). Same on `compare.tsx:68`.

#### Bottom nav — `components/layout/BottomNav.tsx`
- **[Medium] Up to 7 top-level tabs; 3 are views of the same schedule.** `baseTabs` =
  Schedule/Timeline/Grid (l.99-101), `authTabs` = My Picks/Crew/Me (l.104-107), + Wrap
  (l.110,125). At <360px all labels hide (l.176) → 7 unlabeled icons. View-switching
  over-weights nav. *Fix:* fold Schedule/Timeline/Grid into one "Schedule" tab with an
  in-page view switcher (parity with mobile's SegmentedControl) → ~5 tabs.

#### Grid — `routes/grid.tsx`
- **[Nit] "NOW" marker is `text-[0.55rem]` (~8.8px), off-scale.** l.196, below the smallest
  token `--font-size-10`. *Fix:* use `--font-size-10`.

#### Admin (operator-only) — `routes/admin.tsx`, `components/admin/*`
- **[Low] Emoji glyphs as feature icons + bare `←` back control.** `admin.tsx:45-50` emoji
  map rendered in `AdminLayout.tsx:88`; back is a `←` text char (`AdminLayout.tsx:38`) while
  the app standardizes on lucide. *Fix:* lucide icons (LayoutDashboard, Tent, Users, …) and
  `<ArrowLeft />`. Lower impact — admins only.
- **[Low] Distribution/Top-set bars use `transition-all` on width.**
  `PickDistribution.tsx:41,48,55`, `TopSets.tsx:30` animate a layout property (barred).
  Operator-only, re-tweens on data change only. *Fix:* drive growth with
  `transform: scaleX` + `transition-transform`.

#### Picks — `routes/picks.tsx`
- **[Low] Two empty states cite two different affordances.** l.197 "Choose a festival from
  the top menu…" vs l.209 "Open the Schedule tab and tap Join festival…". Both exist but
  the path reads ambiguous. *Fix:* reference one entry point (standardize on "the Schedule
  tab").

---

## Cross-cutting

### Visual system

- **[Medium] White-on-coral is a system-wide AA failure (the #1 theme).** Beyond SOS (H1):
  mobile "Create Crew"/"Add" (`crew.tsx:998-1007`), onboarding "Next"/"Get started"
  (`FirstRunIntro.tsx:138-147`), active-SOS "Get directions" (`CrewSos.tsx:274-280`), and
  web Wrap tabs / forgot-password box. All use white on `#ff3366` ≈ 3.55:1 at 14px. Web's
  Button danger variant already does it right (`bg-accent-coral text-bg-primary`). *Fix:*
  adopt one on-coral ink convention — dark `text.onLightAccent #080810`, or darken the fill
  to `#c01d3a` — and centralize it in one shared button style so every coral CTA inherits
  it. (aqua-filled buttons are already fine: they use dark `text.onLightAccent`.)
- **[Medium] No single "primary action" color (accent semantics).** Filled aqua and filled
  coral are both used for primary-looking buttons with no rule: Upload=aqua, Join=aqua,
  Create Crew=coral, Send SOS=coral, onboarding Next=coral, active selection=aqua. *Fix:*
  define one primary-fill color and give the other a distinct role (recommend: coral =
  primary CTA, aqua = selection/links — or vice-versa, but pick one), and demote the Account
  "Upload" button so the accent fill marks the screen's real primary action.
- **[Medium] Active day pill differs across platforms.** Web paints it
  `--color-day-tab-active #c01d3a` + white (`SubHeader.tsx:170-176`); mobile paints it
  `accent.aqua #00e8d0` + dark ink (`index.tsx:701-704`). Same control, two colors —
  against the parity mandate. *Fix:* pick one selected-day accent (token already centralized
  in `shared/colors.ts`) and apply on both.
- **[Nit] Active day-pill shadow uses an improvised color + off-scale padding.**
  `SubHeader.tsx:174` `rgba(255,80,110,0.45)` matches neither the coral token nor the fill;
  `py-[7px]` (l.165) is off the 4px scale. *Fix:* use `--shadow-glow-coral` /
  `rgb(var(--accent-coral-rgb))` and round to `py-2`.

### Accessibility

Captured per-surface above (SOS H1, stage pills, password toggle, set-detail targets,
onboarding SR gaps, decorative-icon hiding). Common thread: **mobile diverged from
contrast/target decisions web already encodes.** Lifting the web helpers
(`ensureWhiteContrast`, dark-ink coral, the 44px `IconButton`/`Button` floors) into
`@festie/shared` would resolve most a11y findings at once.

### Copy & microcopy

- **[Medium] "Schedule tab" doesn't exist on mobile.** (Detailed under Picks.) Long-term:
  one shared per-platform `scheduleTabLabel` constant.
- **[Medium] Email is required on mobile but optional on web — and fails silently.**
  `mobile/register.tsx:50` returns early on `!email.trim()` with no inline error (the
  Create Account button appears dead), placeholder is a bare "Email" (`:111`); web makes it
  optional with "Email — for password reset" (`web/register.tsx:75,223`). *Fix:* pick one
  policy; if required on mobile, change the placeholder to "Email (for password reset)" and
  show a specific error instead of the silent return.
- **[Medium] Error-toast verb voice has no rule.** "Failed to …" (web crew/admin/expenses,
  mobile `crew.tsx:265`), "Could not …" (`PickBulkActions.tsx:102`, `picks.tsx:153`), and
  "Couldn't …. Try again." (all account components) are used interchangeably. *Fix:*
  standardize on "Couldn't <verb> <object>. Try again." (the account folder is the model);
  bring crew/admin/picks in line.
- **[Low] Guest-browse CTA has three phrasings.** Visible "Browse without signing in"
  (`login.tsx:147`) vs "Maybe later — just browse" (`register.tsx:241`) vs a11y "Browse
  without an account" (`register.tsx:239`, which doesn't match its own visible text). *Fix:*
  one canonical phrase ("Browse without an account") as both visible + a11y label on both
  screens.
- **[Low] Terms/Privacy consent copy diverges three ways.** Order, naming ("Terms" vs
  "Terms of Service"), and error tone differ between `mobile/register.tsx:60,194,202` and
  `web/register.tsx:65,249,253`. *Fix:* one ordering + names ("Terms of Service & Privacy
  Policy"); error names both docs on both platforms.
- **[Low] Auth CTA verb + brand voice diverge.** "Login" (web, a noun-as-verb) vs "Sign In"
  (mobile); web carries the tagline "Plan your sets. Sync with your crew." while mobile uses
  flat "Sign in to your account." *Fix:* "Sign in" on both; reuse the web tagline as the
  mobile auth subtitle.
- **[Low] Redundant post-auth success toasts.** `web/login.tsx:43` "Login successful" and
  `register.tsx:77` "Account created successfully" fire right before redirecting to /cards
  (the redirect is the confirmation). *Fix:* drop "Login successful"; trim register to
  "Account created" (matches the "<noun> created" corpus) or drop it.
- **[Low] Toast punctuation/tone outliers.** Most success toasts are period-free fragments,
  but `LiveLocationControls.tsx:147,166` end in periods, and `useFestivalLoader.ts:80`
  "Joined crew!" is the only toast using "!". *Fix:* no terminal period on single fragments;
  "Joined crew!" → "Joined crew".
- **[Nit] Ellipsis character mixed within each platform.** Unicode "…" vs ASCII "..." in
  loading strings (mobile `FestivalList.tsx:126` ASCII vs `crew.tsx:418` Unicode; web
  auth-button ASCII vs `AppShell.tsx:41` Unicode). *Fix:* standardize on Unicode "…"
  everywhere.
- **[Nit] Onboarding teaches "schedule" but the tab says "Timeline".** `FirstRunIntro.tsx:16`
  + Picks copy use "schedule," which never appears as a visible label. *Fix:* resolved by
  renaming the tab to "Schedule" (also fixes the empty-state misdirection + web parity).

### IA & flows / parity

- **[Low] Onboarding step count + copy differ by platform.** Web `Onboarding.tsx` STEPS = 2
  ("Mark the sets you want", "Plan it with your crew"); mobile shows 3 dots + different
  headline. *Fix:* align narrative/step count; single-source copy in `@festie/shared` if
  practical.
- **[Nit] Primary nav labels differ.** mobile "Account"/"Picks" vs web "Me"/"My Picks".
  *Fix:* one label per destination (recommend "Account", "My Picks").

---

## What's already good

- **A real, centralized token system.** `packages/shared/src/tokens/` (colors, typography,
  spacing) is consumed by both apps; the right values almost always already exist — most
  fixes are "use the token that's already there."
- **An enforced anti-AI-slop discipline.** The team caught and fixed the white-on-coral day
  pill (`theme.css:426-428`), added dedicated hover tokens to replace `brightness` filters
  (`theme.css:454-455`), and `wrap.tsx:261-263` even carries a comment documenting a font
  drift it deliberately fixed — evidence of genuine design self-review.
- **Strong web implementation.** Consistent lucide icon system, `.glass` panels that
  correctly win the cascade, `StageBadge` `ensureWhiteContrast()`, AA-corrected day pills,
  dark-ink coral CTAs in Button/crew-plan, a shared `IconButton` with 44px + focus-ring
  floors, and an `EmptyState` that supports action buttons.
- **The Crew screen IS mostly sectioned.** Members, Live location & SOS, Meeting points,
  Polls, Packing, Rides, Expenses, Activity are labeled, and Force-add is owner-gated and
  separated — the hierarchy problem is the top action cluster, not the whole screen.
- **Set-card priority controls are distinct glyphs with correct aria-labels** (not
  color-only), and the mobile SegmentedControl for schedule views is the right pattern web
  should copy.
- **Onboarding copy itself is good** — the issue is purely the schedule/Timeline naming
  split, not the writing.
- **The account folder's error copy** ("Couldn't X. Try again.") is the right house style;
  it just needs propagating to crew/admin/picks.
