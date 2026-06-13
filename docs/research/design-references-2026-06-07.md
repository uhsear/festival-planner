# Festie Design References & Best Practices — 2026-06-07

External design research synthesized for Festie (real-time festival crew-coordination app, dark-first, web + Expo/React Native, `@festie/shared` design tokens). Sources span festival apps, crew/safety apps, best-in-class dark UI, component libraries, and platform guidelines. URLs cited throughout; "(scraped)" marks references pulled full-text via Scrapling/WebFetch, "(search/store)" marks reference summaries.

---

## Top borrowable patterns (ranked)

Each: **pattern → who does it well (url) → exactly how to apply to Festie.**

1. **Schedule grid does NOT fit a phone — timeline/list is the mobile primary; reserve the 2D stage×time grid for web/tablet.**
   → Clashfinder, the canonical festival grid, explicitly degrades on mobile to a collapsible act *list* with quick-search because "the structure's broken down to fit on the screen" — the full grid is a desktop/print artifact (https://clashfinder.com/, scraped). Planby/Eleken concur (https://planby.app/, https://www.eleken.co/blog-posts/calendar-ui).
   → **Festie:** On mobile lead with a single-axis vertical timeline (time down the page) or swipeable per-stage/per-day list; ship the dense multi-stage grid only on festie.us web (stages = columns, hours scroll horizontally, duration-sized blocks, red "now" line, virtualized). Never force a pinch-zoom 2D grid into RN.

2. **Live-day "now/next" surface that lives OUTSIDE the app — Live Activity + widget + push.**
   → Coachella ships a Home Screen widget and a Lock Screen Live Activity reviewers praise for remembering "where I want to be when" (https://apps.apple.com/us/app/coachella-official/id632833729); Woov pushes when your favourite artist starts (https://woov.com/).
   → **Festie:** Build the roadmapped Live Activity / Android ongoing notification around *current set + next pick + walk time*, plus a home widget. Anchor it to next-pick + live location.

3. **Picks have PRIORITY TIERS expressed as color (not a binary star), and conflicts between tiered picks auto-flag.**
   → Clashfinder: tap to choose a highlight color, long-press for speed; conflicts among highlighted acts are auto-detected (https://clashfinder.com/, scraped). Coachella's single star is simpler but loses priority.
   → **Festie:** Render pick priority as color on the timeline (Festie already has picks/priorities/conflicts); auto-flag overlaps, and when two high-priority picks clash surface an explicit "you have a conflict" resolution prompt.

4. **Reminders must AUTO-RE-ANCHOR when set times change; default 30-min lead.**
   → Woov: "Act reminders update automatically when the schedule changes" (https://woov.com/); Coachella alerts 30 min before start.
   → **Festie:** Store reminders *relative to the set*, not a fixed timestamp; recompute fire times on schedule sync and notify if a pick moved. Compute in the **festival's timezone, not the device's** — directly mitigates the known `setStatus` TZ bug.

5. **Hold-to-activate SOS with a cancelable countdown + explicit abort window; auto-attach location; offer silent send.**
   → iOS/Android Emergency SOS use touch-and-hold or a ~5s cancelable countdown before alerting (https://www.android.com/articles/personal-safety-app/; case study https://medium.com/design-bootcamp/ux-case-study-sos-feature-implementation-3c92622f47ee).
   → **Festie:** Press-and-hold with a filling countdown ring + haptic ramp, big CANCEL during countdown, then broadcast to crew with location attached. Offer silent-send (festival is loud — notify crew without a siren). Active state = full-bleed unmistakable red. Never a single bare tap. Keep SOS markers OUT of clustering.

6. **Avatar-as-marker, not generic pins — crew render as avatar/initials with status overlays (battery, stale, SOS) baked in.**
   → Snap Map uses Bitmoji avatars with overlays for low battery, "recently opened", and a faded avatar after inactivity (https://9meters.com/entertainment/social-media/snap-map-bitmoji-meanings-icons-and-symbols-explained, scraped). Apple HIG Maps allows swapping the default pin for a 2-3 char string or image (https://developer.apple.com/design/human-interface-guidelines/maps, scraped).
   → **Festie:** Circular avatar (or 2-letter initials) per crew member; battery badge when low; **fade/desaturate the marker + "last seen 12m ago" chip when stale**; subtle pulsing ring when live.

7. **Time-boxed location sharing — explicit opt-in, safe default, always-visible Stop, plus a festival-native duration.**
   → Map UI Patterns: durations 1h/2h/6h/24h, **default 2h** ("most common, least intrusive"), always a pause/cancel control (https://mapuipatterns.com/share-live-location/, scraped). Find My offers "one hour / until end of day / indefinitely" (https://support.apple.com/en-us/105104). Life360 auto-expiring share links (https://www.life360.com/, scraped).
   → **Festie:** Never auto-on. Pre-share sheet with duration presets + a domain option ("Until the festival ends" / "Until I leave the grounds"); default bounded (not indefinite); persistent "Stop sharing" banner while active.

8. **Re-prioritize the home surface by FESTIVAL PHASE (pre / live-day / post).**
   → Coachella case study: four phases, analytics track them, a content-priority matrix drives per-phase home content (https://wilsontu.com/coachella/, scraped).
   → **Festie:** One phase-aware home — pre = picks/lineup/crew invites/Spotify; live-day = now/next + live map + SOS + meeting points; post = wrap-up + expenses/settle-up. Dump static logistics into a searchable knowledge base so the main surface stays lean.

9. **Find-friends/crew ON the live map is the headline festival feature — and the differentiator is OFFLINE resilience.**
   → Woov has find-friends-on-map but reviews warn usefulness "diminishes at festivals with no service — no messaging or maps without internet" (https://woov.com/); Coachella map has category filters.
   → **Festie:** Lean into offline (Festie's #1 priority): cache map tiles, last-known crew positions, queue location writes. This is the competitive edge competitors lack. Background-location must persist when the phone locks (foreground-only sharing silently dies — surface a clear indicator, no silent drops).

10. **Settle-up: show ONE consolidated net balance per person; minimize payments without inventing new creditors.**
    → Splitwise's three invariants — equal net for everyone, never owe someone you didn't already owe, never owe more in total — with a "Settle up" button + "Simplify debts?" toggle (https://blog.splitwise.com/2012/09/14/debts-made-simple/, scraped).
    → **Festie:** Surface one actionable net number per crew member ("You owe Sam $14"), Settle Up that clears multiple expenses at once, and never introduce a stranger-to-pay. Offer a raw-vs-simplified toggle.

---

## By category

### Festival apps
- **Clashfinder** (https://clashfinder.com/, scraped) — canonical color-coded stage×time grid; color-tiered highlights; "show only stages with my picks" + "temporarily show all" escape hatch; tap-act info popup (photo/bio from MusicBrainz/Wikipedia); Build Spotify Playlist; iCal/JSON/Excel export; explicit mobile fallback to a list.
- **Coachella Official** (https://apps.apple.com/us/app/coachella-official/id632833729) — 4.9★/13K; star→plan, 30-min reminders, Home Screen widget, Lock Screen Live Activity, map category filters + add-to-favorite from pin, real-time Lost & Found with email-match.
- **Woov** (https://woov.com/) — closest competitor; personal timetable + artist-start push; reminders auto-update on schedule change; graceful pre-schedule lineup in organiser order; 3D map; find friends on map; automated moderation for chats; marquee announcements. Key lesson: dies without service → validates Festie offline-first.
- **DICE** critique (https://ixd.prattsi.org/2026/02/design-critique-dice-ios-app/) — dark as photo canvas; yellow accent on date/time; icon+label buttons; category filter pills; Spotify-taste recs. Anti-patterns: "Recently Viewed" eating the home; map button blending into nav; showing sold-out lowest price.
- **Coachella 2016 phased content** (https://wilsontu.com/coachella/, scraped) — four phases + content-priority matrix; logistics → searchable knowledge base.
- **Insomniac/EDC** (https://www.insomniac.com/the-insomniac-app/) — multi-event shell (event switcher) if Festie ever spans a season.
- **Coachella feature review** (https://medium.com/music-tech-alliance/coachella-a9d91d78474a) — confirms favorites→schedule→30-min loop + map-as-utility.

### Crew + safety apps
- **Apple HIG Maps** (https://developer.apple.com/design/human-interface-guidelines/maps, scraped) — default vs **muted** emphasis (use muted for info-rich overlays); cluster overlapping points into a counted pin; custom marker icon/initials; place-card styles (full callout/sheet, compact, caption); keep selected pin visible (offset card); control contrast via stroke/shadow; indoor-map → festival-grounds progressive detail by zoom.
- **Life360** (https://www.life360.com/, scraped) — Circles = named invite groups (= crew); dashboard shows everyone + battery + history; "Bubbles" hide pin but keep SOS; auto-expiring share links; reassuring copy ("When they're okay, you're okay").
- **Snap Map** (https://9meters.com/.../snap-map-bitmoji-meanings-icons-and-symbols-explained, scraped) — avatar-as-marker; baked status overlays; shrinking circle = stale; Actionmoji contextual status; Ghost Mode with auto-expiry + visible badge.
- **Map UI Patterns — Share Live Location** (https://mapuipatterns.com/share-live-location/, scraped) — two states (not shared default / sharing); duration picker default 2h; opt-in recipients; pulsating live markers; always a stop control; ghost mode; background vs foreground warning.
- **Apple Find My** (https://support.apple.com/en-us/105104) — People tab, human-readable durations, Live (direction+speed) only when actively viewed, reciprocity prompt.
- **Citizen + ACM deceptive-patterns study** (https://dl.acm.org/doi/fullHtml/10.1145/3544548.3581258) — color-coded active/resolved incident pins, distance+recency sort, alert zones. Anti-pattern: 100% of studied users felt MORE anxious from constant alerts → keep everyday quiet, SOS rare/loud.
- **Android/iOS Emergency SOS** (https://www.android.com/articles/personal-safety-app/) — hold-or-countdown, cancelable, optional siren, auto location, silent mode.
- **Partiful** (https://ixd.prattsi.org/2025/02/design-critique-partiful/, scraped) — "social snowball" (show who's in), natural-mapping RSVP (Going/Maybe/Can't), playful dark theme.

### Best-in-class dark UI
- **Linear** (https://linear.app, scraped) — near-black canvas (#010102), single rationed accent (#5e6ad2), 1px inset borders > fills, narrow 4-step surface ramp, Inter Variable wt 510/590, LCH-generated themes, dense status-dot + ID-chip + avatar rows.
- **Vercel/Geist** (https://vercel.com/geist/colors) — copyable neutral gray ramp (gray-950 #0A0A0A → gray-300 #D4D4D4), never pure #000, hairline borders rgba(255,255,255,0.08)/0.15, 8px grid, radii 4/6/8, type scale 12/14/16/18/24/32/48/64 with negative display tracking.
- **Spotify** (https://blakecrosley.com/guides/design/spotify) — #121212/#181818/#1f1f1f layers, green #1ed760 only for play, heavy shadows (0.3–0.5) on dark, card recipe (#181818, 8px, 16/700 title, #b3b3b3 secondary).
- **Notion Calendar/Cron** (https://blakecrosley.com/guides/design/notion-calendar) — 1px grid lines at 9% opacity, monospaced time gutter 11px/500, 15-min snap, 6-hue muted event palette, single-key shortcuts (n/t/g//).
- **Raycast** (https://www.raycast.com) — near-total-dark void, accent as status only, near-white primary pill, optical tracking by size (negative on display, positive at 11–13px).
- **Family** (https://benji.org/family-values) — continuity-of-matter shared-element transitions; morph only the changing part of a label.
- **Arc** (https://www.saasui.design/application/arc-browser) — spring ~0.09s, ease-out ~0.38s timing values; arcs not lines.
- **Things 3** (https://culturedcode.com/things/blog/2023/09/things-big-and-small/) — vector icons, type + spacing scale together, honor Dynamic Type.

### Components
- **Map UI Patterns** (scraped, above) — share-live-location spec.
- **Splitwise** (https://blog.splitwise.com/2012/09/14/debts-made-simple/, scraped) — debt-simplification invariants.
- **LogRocket loading/error/empty** (https://blog.logrocket.com/ui-design-best-practices-loading-error-empty-state-react/, scraped) — spinner only with no data; inline progress on revalidate; ErrorBoundary per component; distinct empty component.
- **Eleken calendar UI** (https://www.eleken.co/blog-posts/calendar-ui) — single-track timeline vs multi-stage columns; don't shrink desktop grid; one meaning per color + icon/label.
- **Planby** (https://planby.app/) — virtualized EPG timeline: fixed left axis, scrollable time, duration-sized blocks, live marker.
- **Permission Priming** (https://www.useronboard.com/onboarding-ux-patterns/permission-priming/) — soft pre-prompt before OS dialog.
- **Appcues onboarding** (https://www.appcues.com/blog/mobile-onboarding-best-practices) — ≤3–5 steps, value before sign-up, contextual permission timing.
- **Material 3 Chips** (https://m3.material.io/components/chips/guidelines) — ≤12 short options, accent selected state, consistent single/multi, ≤2 wrapping rows.
- **Mobbin chip glossary** (https://mobbin.com/glossary/chip) — chip variants + real-app screenshot library.
- **Google Maps marker clustering** (https://developers.google.com/maps/documentation/javascript/marker-clustering) — 60×60px grid, min 2, expand on zoom.
- **RN Tinder-style swipe** (https://vinova.sg/engineering-tinder-style-swipe-interfaces-in-react-native/; https://medium.com/@phillfarrugia/building-a-tinder-esque-card-interface-5afa63c6d3db) — gesture-handler + reanimated on native thread, rotation + drag-distance indicators, always provide tap-button fallbacks.
- **SOS feature case study** (https://medium.com/design-bootcamp/ux-case-study-sos-feature-implementation-3c92622f47ee) — hold + countdown + cancel.

### Platform guidelines
- **Apple HIG Accessibility** (https://developer.apple.com/design/human-interface-guidelines/accessibility, scraped) — control sizes (iOS 44×44pt default / 28×28 min), spacing (~12pt bezeled / ~24pt icon-only), contrast table, custom type min 11pt, ≥200% enlargement, more-than-color, gesture alternatives, no timed auto-dismiss.
- **Apple HIG Dark Mode** (https://developer.apple.com/design/human-interface-guidelines/dark-mode, scraped) — min 4.5:1 strive 7:1, base vs elevated surfaces, semantic tokens, soften white image backgrounds, no app-specific appearance toggle, dark-only OK for media apps.
- **Material 3 Structure** (https://m3.material.io/foundations/designing/structure, scraped) — ≥48×48dp touch / ≥44 pointer, ≥8dp spacing, single H1.
- **Material 3 Color contrast** (https://m3.material.io/foundations/designing/color-contrast, scraped) — 3:1 large/graphics, 4.5:1 small; clustered containers each ≥3:1; standalone prominent (FAB) exempt.
- **WCAG 2.2 SC 1.4.3** (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — 4.5:1 normal / 3:1 large (≥18pt or ≥14pt bold); don't round.
- **WCAG 2.2 SC 2.5.8** (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) — 24×24 CSS px AA floor, 44 AAA, five exceptions.
- **APCA in a Nutshell** (https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell) — Lc 90 preferred body / 75 min body / 60 large / 45 headline / 30 spot-read / 15 floor.
- **Tailwind v4 Dark Mode** (https://tailwindcss.com/docs/dark-mode) — `@custom-variant dark (&:where(.dark, .dark *))`, default dark + persist override.
- **RN Safe area** (https://reactnative.dev/docs/safeareaview) — SafeAreaView deprecated/iOS-only; use `useSafeAreaInsets()` once at screen root (matches Festie commit 4054628).

---

## Concrete thresholds & rules Festie should adopt

**Touch targets**
- Mobile: every tappable control **≥44×44pt (iOS) / 48×48dp (Android)**; decouple hit-area from visual size (24dp icon centered in a 48dp padded target).
- Web (festie.us): **≥24×24 CSS px** (WCAG 2.2 AA floor); target **44px** for primary actions (AAA).
- High-risk surfaces to audit: map pins/markers, SOS button, schedule grid cells + swipe-card, expense row icons, crew rows, icon-only header buttons.

**Spacing between targets**
- **≥8dp/8px** minimum between adjacent targets; **~12pt** around bezeled buttons; **~24pt** around bare icon-only buttons (map recenter/layer, day tabs, priority toggles).
- 8px base grid: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128. Surface padding 12px, gaps 2–8px.

**Contrast**
- Text: **≥4.5:1** body/secondary; **≥3:1** large (≥18pt or ≥14pt bold). Don't round the computed ratio.
- Non-text UI (button outlines, active icons, status/conflict badges, map pins, route lines): **≥3:1**.
- Clustered containers (chip groups, button rows): each **≥3:1** vs surface. Standalone FAB/SOS technically exempt but keep ≥3:1 for outdoor glare.
- Dark-first stretch goal: **strive 7:1** for body text. APCA acceptance bar for the dark palette: body **Lc ≥75 (prefer 90)**, large/headline **≥60**, secondary/placeholder/timestamps **≥45**, never below **Lc 30** for readable text, **Lc 15** floor for faint dividers/disabled. (Tuning target, not yet a release blocker — WCAG ratios over-pass on dark backgrounds.)

**Type scale**
- Scale: **12 / 14 / 16 / 18 / 24 / 32 / 48 / 64**. Body default **17pt (iOS) / 16px (web)**; never below **11pt**.
- Letter-spacing: display/headers **-0.02 to -0.04em**; body **-0.01em**; badges/timestamps/labels at 11–12px **+0.02 to +0.05em** (uppercase for section labels).
- **Tabular/monospaced numerals** (`font-variant-numeric: tabular-nums`) for all aligned numbers: schedule time gutter, set start/end, expense + settle-up amounts, crew counts.
- Honor OS font scaling / Dynamic Type up to ~200% on dense screens (schedule, expenses, crew compare) without clipping. Avoid thin weights at small sizes (low-light/glare).

**Surfaces & color (dark-first tokens for `@festie/shared`)**
- Two-tier+ ramp on near-black (not #000): bg `#0A0A0B`, surface `#161618`, surface-elevated `#1F1F22`. Base recedes (screen bg), elevated advances (sheets/modals/cards/popovers).
- Borders: hairline `rgba(255,255,255,0.08)`, strong `~0.14`. Use borders for cards/separators; reserve shadow for modals/sheets/FAB.
- Text: primary `#F7F8F8` (never pure white), secondary `~#B3B3B3`, tertiary `~#737373`.
- **One accent** for the single primary action / active state per screen. Separate **semantic** palette: green = going, amber = maybe, **saturated red reserved for conflict + SOS only** (unique alarm color). Always pair color with icon/shape.
- Grid lines `rgba(255,255,255,0.09)`; muted/desaturated basemap so crew avatars + red SOS + meeting pins are the visual focus.

**Motion**
- Tap/press spring **~0.09s**; sheet/modal ease-out **~0.35–0.4s**. Shared-element transitions for pick→detail, crew-list→map-pin, set→my-picks. Animate only the changing token in dynamic labels ("2 picks"→"3 picks"). Respect `prefers-reduced-motion` (swap pulse for a static filled dot).

**Safe area**
- Apply `insets.top/bottom` **once per screen root** (never nested → double-padding). Full-bleed map/SOS edge-to-edge but keep interactive controls inside the safe area. Web/PWA: mirror with `env(safe-area-inset-*)`.

---

## "Don't reinvent" shortlist (proven solutions to copy)

- **Live-location share sheet** → copy Map UI Patterns spec verbatim: opt-in only, duration presets (default bounded ~2h), opt-in recipient pick, always-visible Stop, ghost/approximate mode, background-persist with explicit indicator. (https://mapuipatterns.com/share-live-location/)
- **SOS activation** → copy iOS/Android: hold or ~5s cancelable countdown ring + haptics + big CANCEL + auto location + silent option. (https://www.android.com/articles/personal-safety-app/)
- **Debt settle-up math** → copy Splitwise invariants (equal net, no new creditors, no one owes more) + simplify toggle. (https://blog.splitwise.com/2012/09/14/debts-made-simple/)
- **Map marker clustering** → copy Google/Apple: counted cluster bubble, expand on zoom, consistent tap-to-card; keep SOS out of clusters. (https://developers.google.com/maps/documentation/javascript/marker-clustering)
- **Avatar markers + stale/live semantics** → copy Snap Map: avatar-as-marker, fade stale + timestamp, pulse live, battery badge. (Snap Map breakdown)
- **Dark token system** → copy Vercel/Geist ramp + Linear's 4-step surfaces + Spotify's #b3b3b3 secondary, rather than authoring from scratch. (https://vercel.com/geist/colors)
- **Schedule timeline component** → model on Planby (web grid) / Notion Calendar visual rules; don't hand-roll virtualization. (https://planby.app/)
- **Async-state trio** → one shared `EmptyState` (icon/title/body/CTA) + skeleton-matches-final-geometry + ErrorBoundary-per-surface, in `@festie/shared`. (LogRocket)
- **Swipe deck** → react-native-gesture-handler + reanimated (or react-native-deck-swiper) + mandatory tap-button fallback + undo. (vinova.sg / Farrugia)
- **Accessibility thresholds** → adopt Apple HIG + Material 3 + WCAG 2.2 numbers directly as the self-audit checklist; add a token-level contrast unit-check.
- **Permission priming + onboarding** → soft "why" pre-prompt before OS dialog; ≤3–5 steps to first meaningful action. (useronboard / Appcues)
- **RSVP / meeting-point attendance states** → copy Partiful natural-mapping Going/Maybe/Can't + social snowball ("X of your crew is here"). (Partiful critique)
