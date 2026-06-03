# Festie Feature Strategy — The Offline-First Correction

> Supersedes the prioritization in `docs/research/competitor-features-2026-06-02.md`. That report ranked an opt-in **live crew location** feature as the #1 flagship differentiator. This report corrects that blind spot: a festival is a **dead-signal environment**, and any feature whose value depends on a live server round-trip *during the crowd* is structurally broken there — no matter how good Festie's Socket.IO plumbing is. The lens for every feature is now: **does it survive a congested/no-signal crowd, across the festival lifecycle (before / during / after)?**
>
> Grounded against Festie's real offline architecture (commit `f04873b`): a **read-cache** (`crewStore` + web TanStack-Query persist serving the last-synced snapshot) plus a **one-directional, store-and-forward async write-queue** (`api.ts` `OFFLINE_ELIGIBLE_PATTERNS` allowlist → IndexedDB/AsyncStorage → replay on reconnect, no silent drops). **There is no peer-to-peer/BLE/mesh transport.** The decisive consequence the prior report ignored: the write-queue lets *you* record intent offline, but it delivers *nothing to your crew* until everyone is back on signal.

---

## 1. Offline-resilience framework (the legend)

Every feature is tagged with exactly one tier. The tier — not the polish — decides whether it works in the crowd.

| Tier | Definition | Festival verdict |
|------|-----------|------------------|
| **offline-native** | Works fully with **no signal**, computed from already-cached data + the device clock/sensors. Zero network in the critical path. | The gold standard for DURING. Build these first. |
| **offline-degraded-syncs** | Acts offline (records intent, optimistic echo), **delivers on the next signal blip** via the write-queue. Useful when *you* need to capture something; **not** useful when the crew must *receive* it live. | Good for capture (expenses, notes, votes you'll act on later). A trap if framed as live coordination. |
| **peer-to-peer-no-internet** | Phone-to-phone over **BLE / mesh / QR / AirDrop / Quick Share / SMS** — no servers at all. | The only thing that delivers data to *another phone* in the dead window. Costly and platform-fragmented. |
| **before/after-online-ok** | Used at home / hotel / transit where **signal exists**. Online dependency is legitimate because it never overlaps the crowd. | Fine to be online. Press these hard. |
| **online-only** | Needs **continuous live connectivity** to be useful. **RED FLAG for DURING-festival** — looks great in a demo, dies in the crowd. | Skip for DURING, or redesign. Acceptable only if the phase is genuinely before/after. |

**The litmus test for any "crew/live" feature:** *Does its value require another phone to receive my data during the dead-signal window?* If yes, it is broken at a festival until a P2P mesh exists. This single test kills or redesigns the entire live-location / live-presence / SOS / live-ETA / geofence cluster that the prior report led with.

---

## 2. Master table (deduped across all angles)

Effort: S/M/L. Verdict: **build** / **redesign** (redesign-for-offline) / **maybe** / **skip** (skip-useless-offline).

### Offline-first core & UX trust layer

| Feature | Phase | Tier | Value | Effort | Verdict |
|---|---|---|---|---|---|
| Read-cache + all-method write-queue (offline-first core) | all | offline-degraded-syncs | The only correct base architecture; everything builds on it | M | **build** *(shipped — keep investing)* |
| Offline-honest UX system (freshness chips, "synced N ago", queued-action badges, retryable failedSync cards) | during | offline-native | The trust layer that makes every other offline feature credible | S | **build** |
| Surface read-cache as first-class "offline data" UI (schedule + picks + crew roster) | during | offline-native | Non-negotiable baseline; users must *trust* stale data, not assume the app broke | S | **build** |

### DURING — offline-native (the real wedge)

| Feature | Phase | Tier | Value | Effort | Verdict |
|---|---|---|---|---|---|
| Pre-computed **LOCAL** set reminders (`expo-notifications`, on-device, no server) | during | offline-native | Fires "set starts in 15 min" with zero bars; highest-certainty offline win | S | **build** |
| **Live mode** (auto-scroll timeline to now + countdown to next pick) | during | offline-native | Rare during-event feature delivering live value on dead signal — pure device-clock math | S | **build** |
| **Crew overlap on a set** (avatars by must/want/maybe from cached picks) | before+during | offline-native | "2 of your crew have this as a must" — Festie's unique crew×priority graph, fully cached | S | **build** |
| "What's my crew's plan" digest (cached meeting points + home base + who-picked-what-next, one screen) | during | offline-native | The killer offline read; solves lost-crew panic with zero connectivity | M | **build** |
| Pre-set **meeting points** readable + editable offline (queued writes) | during | offline-native | THE offline coordination primitive — agreed *before* signal dies | S | **build** |
| Inline clash prompt ("2 acts at 8:30 — pick one") | before+during | offline-native | Actionable nudge over cached schedule + your picks | S | **build** |
| iOS Live Activity / Android ongoing notification — **local-data-driven** | during | offline-native | Glanceable next-set + active meeting point on lock screen, no unlock, no push | M | **build** |
| Lock-screen / wallpaper daily lineup (static render) | during | offline-native | Battery-saving glance; offline-native cheap delight | S | **maybe** |
| Accessibility (per-set sensory icons + a11y polish) | all | offline-native | Static lineup metadata caches with schedule; on-device a11y | M | **build** |

### DURING — offline-degraded / redesigns of online-only traps

| Feature | Phase | Tier | Value | Effort | Verdict |
|---|---|---|---|---|---|
| Check-ins / "heading to [point]" / notes / votes captured offline, delivered on next blip | during | offline-degraded-syncs | Intermittent-signal coordination via the existing queue | S | **build** |
| **REDESIGN: live GPS → last-synced position + queued "on my way, ETA ~8 min to [point]"** | during | offline-degraded-syncs | Find My's last-known model; 80% of "where's everyone" value, far less battery | M | **redesign** |
| **REDESIGN: live presence on a set → "who PLANNED to be here" from cached picks** | during | offline-native | Strictly better offline; structurally unique to Festie | S | **redesign** |
| **REDESIGN: proximity compass → point to a SAVED MEETING-POINT coord (not a live member)** | during | offline-native | On-device magnetometer + cached coord = "walk this way, 80m" | M | **redesign** |
| **REDESIGN: pick-aware weather band → pre-cache forecast, render from cache** ("forecast as of N ago") | before+during | offline-degraded-syncs | "Rain at your 4pm set" answerable on-site | M | **redesign** |
| **REDESIGN: SOS → local screen ("show this to a medic"), never queued delivery** | during | online-only→p2p | A queued SOS is dangerous theater; only honest forms are local-screen or BLE-relay | M | **redesign** |
| Schedule-aware polls (lineup options → auto meeting point + reminders) | before+during | offline-degraded-syncs | Festival-native decision; **frame as BEFORE planning, not live in-crowd** | S | **build** |

### DURING — online-only TRAPS (do not ship as-built)

| Feature | Phase | Tier | Value | Effort | Verdict |
|---|---|---|---|---|---|
| Live opt-in crew location on the map | during | online-only | #1 demo feature, structurally dead in the crowd | L | **skip** *(redesign only via mesh)* |
| Live crew presence pinned to sets ("who's at this set now") | during | online-only | Bidirectional live publish/receive — dead offline | M | **skip** |
| Live crew heatmap / who's-where overview | during | online-only | Same congestion fate as live dots | M | **maybe** *(only atop real transport)* |
| Geofenced arrive/leave + separation alerts | during | online-only | Detect entry locally, but *notifying others* needs network/mesh | M | **skip** |
| Crew group chat / live messaging | during | online-only | "No service = no messaging" (Woov's own reviews) | M | **redesign** *(queue or BLE)* |

### DURING — peer-to-peer (no internet)

| Feature | Phase | Tier | Value | Effort | Verdict |
|---|---|---|---|---|---|
| Share plan / location-snapshot via **QR** (crew invite / plan) | before+during | peer-to-peer | Cross-platform, offline, ~camera range; onboard a dead-data friend | S | **build** |
| **SMS last-resort handoff** ("text the crew our meetup") | during | peer-to-peer | SMS rides the network's low-bandwidth priority — often delivers when data is dead | S | **build** |
| AirDrop / Quick Share / OS share-sheet handoff | during | peer-to-peer | Offline same-OS transfer of a plan/snapshot | S | **maybe** |
| NFC tap-to-share (crew invite / contact) | during | peer-to-peer | Marginal over QR; QR is cheaper and works at distance | M | **maybe** |
| Same-OS **BLE proximity** "find my crew within ~40m" (opt-in delight) | during | peer-to-peer | Last-100m reunion; magical when it works | L | **maybe** |
| **BLE / local-mesh crew chat + location relay** (the "works with no signal" dream) | during | peer-to-peer | The *only* architecture that makes live crew features work at a festival | L | **redesign** *(phase-N moonshot)* |
| Downloadable **offline map tiles** of grounds (MapLibre/PMTiles) | before+during | offline-native | Navigate stages/pins with zero signal | M–L | **build** *(needs coords first)* |

### BEFORE — at-home planning that pre-loads the dead window

| Feature | Phase | Tier | Value | Effort | Verdict |
|---|---|---|---|---|---|
| **Explicit "Download this festival for offline" action + readiness checklist** | before | online-only *(pre-loads during)* | Removes the #1 silent failure: arriving half-cached | M | **build** |
| Pre-cache **weather** snapshot for offline viewing | before+during | before/after-online-ok | "Will it rain Sat 9pm" answerable on-site | S | **build** |
| Pre-cache **Spotify album art + artist photos** | before+during | before/after-online-ok | Keeps the schedule visually intact offline | M | **build** |
| **Connect Spotify → auto-pre-pick must-sees** against THIS lineup | before | online-only | The killer cold-start hook; populates the picks that get cached | L | **build** |
| Create Spotify playlist from picks | before | online-only | Beloved prep ritual + discovery loop | M | **build** |
| Pre-festival discovery playlist for unknown artists | before | online-only | Fills schedule gaps with new acts | M | **maybe** |
| Crew **packing list** / who's-bringing-what (offline-checkable) | before+during | offline-degraded-syncs | Crew problem solved in chats today; fits crew primitives | M | **build** |
| Pre-trip **budget planner** (forecasted shared costs, planned flag) | before | offline-degraded-syncs | Agree on budget before arrival; reuses expense ledger | M | **build** |
| **Carpool / ride coordination** board (departure plan pre-caches) | before | before/after-online-ok | Who's driving / seats / meet-to-leave | M | **build** |
| Lodging / camp-spot pin ("find our tent at 3am") | before+during | before/after-online-ok | Likely an extension of home-base, not new | S | **maybe** |
| Self-service (non-admin) lineup import | before | online-only | Expands TAM but needs moderation/abuse decision | L | **maybe** |
| Surface ICS calendar sync as offline reminder backstop | before | before/after-online-ok | Native calendar alarms fire offline on-device | S | **build** *(surface, don't build)* |
| Bulk pick helpers ("add all must-see", genre/stage) | before | offline-degraded-syncs | Speeds setup for big lineups | S | **build** |
| Crew-native taste discovery ("artists like your crew's picks") | before | online-only | Speculative; gated on Spotify OAuth | M | **maybe** |
| Reactions / "boops" on crew picks | before+after | offline-degraded-syncs | Pre/post social momentum; dead during | S | **maybe** |

### AFTER — online is fine (signal is back)

| Feature | Phase | Tier | Value | Effort | Verdict |
|---|---|---|---|---|---|
| **Debt simplification** (greedy min-cash-flow netting) on the cents ledger | after | before/after-online-ok | "Pay Sam $14" — Splitwise cut 8 payments to 3; pure backend | S | **build** |
| **Payment deep links** (Venmo / Cash App) prefilled amount+memo | after | before/after-online-ok | Tap-through pay; no money touches Festie (no PCI) | S | **build** |
| **Mark expense settled** (zero out after real-world payment) | after | before/after-online-ok | Completes the settle-up loop | S | **build** |
| **Crew-aware wrap superlatives** (MVP, biggest spender, overlapping taste, sets together) | after | before/after-online-ok | The viral growth artifact (Spotify Wrapped's social half) | M | **build** |
| **Shared crew recap card** (one poster) as the next-year invite | after | before/after-online-ok | The recap *is* the invite back | S | **build** |
| **Reform crew for next festival** (pre-seed from last year's members) | before+after | before/after-online-ok | The most defensible retention loop; no competitor has the graph | M | **build** |
| Cross-festival **year-over-year music history** (lifetime sets, top artists) | after | before/after-online-ok | Identity surface; turns wrap into a returning ritual | M | **build** |
| Always-current "concert wrapped" (rolling, not seasonal) | after | online-only | Gigvault's wedge; mostly a view over YoY data | S | **build** |
| Set-logging archive as a personal profile (setlist.fm-style, cross-event) | after | before/after-online-ok | Reframes existing `set_ratings` as a lifetime log | S | **build** |
| **Re-engagement triggers** (lineup-drop / tickets / "your crew is re-forming") push+email | after | online-only | Personalized push lifts reaction ~400%; email is owned lifeline | M | **build** |
| Spotify playlist from top-rated sets (post-fest re-loop) | after | online-only | Gated on the OAuth investment; sequence with before-auto-pick | M | **maybe** |
| Crew photo wall scoped to the festival (link-out / R2 presigned) | after | online-only | Captured during (offline), heavy upload defers to wifi | L | **redesign** |
| Full disposable-camera product | during+after | online-only | Off-thesis; heavy storage/moderation, no crew-graph edge | L | **skip** |

### Out of scope (skip — useless offline AND off-mission)

| Feature | Phase | Tier | Verdict |
|---|---|---|---|
| Spotify-match festival friend discovery (Radiate-style) | before | online-only | **skip** |
| Artist tracking / concert alerts (Bandsintown/Songkick territory) | before | online-only | **skip** |
| Ticketing / waitlist / wristband registration | before | online-only | **skip** |
| Cashless RFID payments / order-ahead food | during | offline-degraded-syncs | **skip** *(solved by RFID vendors at POS)* |
| AR lenses / curated playlists | before+during | online-only | **skip** |

---

## 3. Per-phase strategy

### BEFORE — "the before-phase earns the during-phase"

Signal exists at home, so online dependency is fine here. The strategic job of BEFORE is **pre-loading the dead window**. Today Festie's pre-cache is *implicit* — you only have offline data for screens you happened to open on wifi. That is the single biggest before-phase gap.

**Build:**
- **Explicit "Download this festival for offline" + readiness checklist** — one button that force-fetches and caches schedule, picks, crew, meeting plans, weather, album art, and shows "Ready for offline · synced 5 min ago" per section. Wire to the existing `festie-festival` / `festie-crew` persist stores and extend the VitePWA service-worker `runtimeCaching` (today it only caches `GET /api/v1/festivals` — not Spotify art, weather, or tiles). This removes the silent half-cached-arrival failure.
- **Pre-cache weather + Spotify art** — `routes/weather.ts` already returns 7-day/hourly (Open-Meteo) but is server-cached 30 min only, never persisted client-side, so it vanishes offline. Persist the snapshot keyed by `festivalId`. For art, cache the static images (CacheFirst, bounded) — note Spotify *embed iframes* will never render offline, so cache the art image, not the iframe.
- **Connect Spotify → auto-pre-pick** — the killer cold-start hook (needs new user-OAuth scopes; current `lib/spotify.ts` is client-credentials only). Match top/saved artists against this lineup (artist names + Spotify links already resolved per set). This directly populates the picks that get cached for offline.
- **Crew packing list + pre-trip budget planner + carpool board** — all map cleanly onto crew primitives + the offline write-queue. Add each to the `OFFLINE_ELIGIBLE_PATTERNS` allowlist and the `crewStore` optimistic-create reconciler (same pattern as `createPoll`). Budget = a `planned` flag on `crew_expenses`, not a new table.
- **Surface ICS calendar sync** as a reminder backstop — native calendar events fire offline on-device, complementing FCM (which needs signal). It already exists (`routes/calendar-sync.ts`); just promote it in onboarding.

### DURING — everything must be offline-native, offline-degraded, or peer-to-peer

This is the phase the prior report got wrong. **Three crowd-pleasing ideas are traps** and must be called out:

- **Live crew location on a map** — GPS positions your phone offline, but *transmitting* it needs the congested uplink that saturates exactly during headliners and exits. A position queued and replayed hours later is worthless (you've moved). **Skip as-built; demote from #1 flagship.**
- **Live crew presence on a set** — needs every phone to publish *and* receive in near-real-time. Dead offline. A cached check-in 6h stale is misleading. **Skip the live version.**
- **Crew SOS over Socket.IO/FCM** — the worst miss: sender offline (push never leaves) + recipients offline (never arrives), and a queued SOS that "delivers" hours later creates **dangerous false confidence in a safety feature.** Never ship a queued-delivery SOS.

**The redesign principle (borrowed from Apple Find My — an AirTag has no GPS, it shows last-known position until another device sees it):** never pretend to stream live data offline. Instead:
- **live GPS → last-synced position + ETA-to-known-point + queued "on my way"** (honest "as of 6 min ago" timestamps).
- **live presence → "who PLANNED to be at this set"** from cached priority picks — fully offline, and structurally uncopyable.
- **proximity compass → point to a saved meeting-point coordinate** (on-device magnetometer + cached coord), not to a live member.
- **SOS → a local screen** ("my last meeting point + emergency note, show this to a medic") with explicit *"this does NOT contact anyone"* copy — or a real BLE-mesh relay if/when it exists.

**The offline-native winners to ship (these deliver live value with dead signal):**
- **Pre-computed local set reminders** (`scheduleNotificationAsync`, survives reboot on Android) — `Profile.reminders` (setId→lead-minutes) already exists; schedule them locally so they fire with zero bars. *This was deferred in the QoL roadmap pending an FCM-vs-local de-dup decision — this report justifies promoting it; resolve the de-dup first.*
- **Live mode** — auto-scroll to now + countdown, pure device-clock math. **⚠ Fix the known `setStatus` timezone bug (`bug_setstatus_timezone.md`) first** — local-now vs UTC `set.date` will mis-badge non-UTC users, and a clock-driven view makes correct TZ mandatory.
- **Crew overlap on a set** + **"What's my crew's plan" digest** + **pre-set meeting points** — all pure read-models over already-cached data.
- **Local Live Activity / ongoing notification** — drive it from the on-device schedule + a local timer, **not** remote push (dead at festival). Show the last-*cached* meeting point.

**Peer-to-peer escape hatches (cheap, ship the asymmetric wins first):**
- **QR plan-snapshot share** — cross-platform, offline, onboards a dead-data friend by scan.
- **SMS handoff** ("text the crew our meetup") — `expo-sms` opens the composer prefilled (user taps send; not silent). Leverages SMS's network priority. Frame as a last-resort handoff, not in-app delivery; Android returns no delivery confirmation.

### AFTER — press the growth loop (offline tax disappears)

Signal is back, so online is legitimate, and the data is already in the DB. This is Festie's softest, highest-leverage surface. Build order within AFTER:
1. **Debt simplification + payment deep links + mark-settled** — cheapest concrete win, pure backend over the existing zero-sum cents ledger (`lib/db/stores/expenses.ts getBalances`). *Beware the hardening-audit expense bug.*
2. **Crew-aware wrap superlatives + shared crew recap card** — the existing `WrapPoster.tsx` nails individual identity but misses the social half that made Spotify Wrapped drive 500M+ day-one shares. Superlatives are a read-model over `getCrewRatings` + the expense ledger + picks.
3. **Reform crew for next festival** — triggered off the wrap; the recap *is* the invite. The single most defensible retention loop because no competitor has a persistent closed crew graph.
4. **Cross-festival YoY history** + **set-logging archive** — build together; ratings are siloed per festival today (`getByUser(festivalId)`), so aggregate across all attended festivals into a lifetime profile.
5. **Re-engagement triggers** — Android push + email first (iOS push pending Apple $99 per memory); gate on real events (lineup drop, crew re-forms, wrap ready) to avoid fatigue.
6. **Crew photo wall** — last; needs object storage (R2 presigned), a *media* write-queue distinct from the JSON queue (photos captured offline, heavy upload defers to wifi). Ship link-out before a full build.

---

## 4. The offline-coordination tech decision

The during-festival "talk to another phone" problem has three candidate transports. Assessed for **Expo SDK 54 managed + EAS**:

| Option | What it delivers | Expo fit | Hard constraints | Verdict for Festie |
|---|---|---|---|---|
| **Queued sync (read-cache + write-queue)** — *shipped* | Capture intent offline, deliver on a signal blip | Pure JS, no native code, works in the web PWA too | One-directional, store-and-forward — **delivers nothing to the crew during the dead window** | **The backbone.** Highest ROI. Keep investing (local notifications, more allowlist regexes, optimistic-create parity). |
| **SMS fallback** (`expo-sms`) | Last-resort handoff that often delivers when data is dead (SMS rides low-bandwidth priority) | Managed; opens composer prefilled (user taps send) | Not silent; Android gives no delivery confirmation; some devices error | **Build as an escape hatch.** Cheap, real value, honest framing. |
| **QR / AirDrop / Quick Share** | Phone-to-phone transfer of a plan/snapshot, ~10m | `expo-camera` does QR natively in managed workflow (no eject) | AirDrop = iOS↔iOS, Quick Share = Android↔Android; QR is the cross-platform bridge | **Build QR.** The cheap, cross-platform P2P win. |
| **BLE / local mesh** (`expo-nearby-connections`, Bridgefy, BLE-mesh) | True internet-free crew chat / location relay — the "it just works with no signal" dream | Needs dev client / EAS prebuild + New Arch (Nitro Modules); leaves Expo Go; **conflicts with CLAUDE.md mobile dep rules** | **(a)** `expo-nearby-connections` has **NO iOS↔Android interop** (Nearby Connections vs MultipeerConnectivity) — fatal for a mixed crew. **(b)** Cross-platform requires **Bridgefy** — paid annual SDK with a damning USENIX security record (tracking, impersonation, single-message zip-bomb network kill). **(c)** iOS suspends BLE advertise/scan/relay in background — works mainly app-foregrounded, screen on. **(d)** ~30–100m/hop, value gated on dense same-app adoption at the venue. | **Phase-N moonshot.** A large, native, multi-platform-fragile, adoption-gated R&D bet. Do **not** build it before the cheap tiers are excellent. |

**Recommendation for the during-festival layer:** double down on **queued-sync + offline-native reads + local notifications** as the backbone (pure leverage on shipped code, works on the web PWA), add **QR and SMS as P2P escape hatches**, and treat **BLE mesh as a deliberately-deferred flagship experiment** — the strategic target *if* Festie ever wants genuine live-crew location at a festival, scoped as separate large native R&D, never as a quick layer on Socket.IO. Until mesh exists, every live-crew feature stays online-only or redesigned.

---

## 5. Revised, offline-first recommended build order

*Supersedes the prior report's order, which led with online-only live location.*

1. **Promote local set reminders (`expo-notifications`) + the offline-honest UX system (freshness chips, queued/failed badges).** Rationale: highest-certainty offline win (the data model exists, the OS guarantees delivery), plus the trust layer that makes *every* other offline feature credible. Resolve the deferred FCM-vs-local de-dup first.
2. **Ship the offline-native crew reads: Live mode, Crew overlap on a set, "What's my crew's plan" digest.** Rationale: these are the rare during-festival features that deliver live value with dead signal, they're cheap read-models over already-cached data, and they're structurally uncopyable. **Fix the `setStatus` TZ bug before Live mode.**
3. **Explicit "Download this festival for offline" + pre-cache weather/art + extend the SW runtimeCaching.** Rationale: the before-phase that earns the during-phase; removes the #1 silent failure (half-cached arrival).
4. **After-festival cheap wins: debt simplification + payment deep links + mark-settled.** Rationale: small, pure-backend over the existing cents ledger, signal-is-back so no offline tax, highest perceived value per line.
5. **Crew-aware wrap superlatives + shared crew recap + reform-crew-for-next-festival.** Rationale: the viral growth loop and the most defensible retention loop, all over data Festie already has.
6. **P2P escape hatches: QR plan-snapshot share + SMS handoff.** Rationale: the cheap, honest "no internet at all" wins that avoid the mesh trap; `expo-camera` QR is already managed-workflow.
7. **REDESIGNED location features: last-synced position + queued "on my way / ETA" + compass-to-meeting-point.** Rationale: delivers 80% of "where's everyone" value offline and de-risks any future live-location work by shipping its offline-safe core first. **Prerequisite: add lat/lng to `CrewMeetingPoint`** (currently free-text) — sequence with the offline map.
8. **Connect Spotify → auto-pick + playlist (build OAuth once, serve before+after).** Rationale: the top cold-start accelerant; before-phase, legitimately online.
9. **Offline map tiles (MapLibre/PMTiles) with stages + meeting-point pins.** Rationale: a proven expected festival feature, but gated on coords (step 7) and the heaviest pure-offline build; sequence after the cheap wins.
10. **Cross-festival YoY history + re-engagement triggers + crew packing/budget/carpool boards.** Rationale: retention depth and crew-coordination breadth over existing primitives.
11. **(Deferred) BLE local mesh** — the phase-N moonshot, only if/when dense adoption justifies a large native bet.
12. **(Deferred) Crew photo wall** — needs R2 + a media write-queue; ship link-out first.

---

## 6. Novel offline-first opportunities (features that WIN *because* of no signal)

These are where Festie can beat competitors precisely because the competitors get the offline reality wrong.

1. **Last-known-location with honest staleness UX.** Every competitor silently shows a stale dot as "live" — a trust killer the moment a user walks to an empty spot. Festie's edge is *intellectual honesty*: "last seen 14 min ago near Stage B," never a fake live dot. Cheap, and a genuine differentiator (Apple Find My's exact model). It also reframes the "broken" live-location feature into something that works.

2. **"What's my crew's plan" — the offline replacement for live presence.** One card assembled entirely from cache: active meeting point + time, crew home base, and "who picked what's next" from cached crew picks. Zero connectivity, no live location, yet it directly solves the lost-crew panic. Novel — no competitor pairs a closed crew graph with cached schedule + meeting plans.

3. **Crew overlap on a set from cached priority picks.** "2 of your crew have this as a must" rendered on the grid cell, fully offline. Festie's structurally-unique crew×priority graph; generic apps have only binary favorites and no crew graph. The single best offline-native differentiator and the cheapest.

4. **The explicit "Download for offline" readiness step.** Festival Dust claims generic offline; nobody ships a *verifiable* pre-download with per-section freshness ("Ready for offline · synced 5 min ago"). It turns Festie's implicit, fragile pre-cache into a trustworthy promise — and it's the feature that makes every other offline feature actually work at the gate.

5. **Local-clock everything: reminders, Live mode, Live Activity — driven on-device, never by push.** Competitors lean on server push that dies in the crowd. Festie can guarantee "set starts in 15 min" fires with zero bars because the data is cached and the trigger is the device clock. This is the cleanest "works at a festival" primitive and Festie already models the data.

6. **SMS as a deliberate, designed last resort.** Everyone treats SMS as legacy; at a saturated festival it's the *only* channel that often gets through (it rides the network's low-bandwidth priority path). A "text the crew our meetup" button is a genuinely useful escape hatch that competitors overlook.

7. **QR plan-snapshot to onboard a dead-data / dead-battery friend.** Encode the crew plan (meeting point + time + home base + compact picks) into a QR; the receiver scans, imports into local cache, and syncs later. Cross-platform, offline, no account needed — the practical answer to "my phone has no data, get me the plan." Novel for festival crew plans.

> **Bottom line:** Festie's defensible niche is the **offline-native, no-account-friction, all-crew (not 1:1) coordination layer for the DURING phase** — cached schedule + Live mode + crew overlap + pre-set meeting points + local reminders — wrapped in honest staleness UX, bookended by online-OK before-planning (download-for-offline, Spotify auto-pick) and after-festival growth loops (settle-up, crew wrap, reform-crew). The hard part everyone fudges is real offline location transport. Festie's winning move is **not** to fake it (the prior report's trap) but to be ruthlessly honest about staleness where competitors silently lie — and to keep BLE mesh as a clearly-scoped future bet, not a near-term promise.
