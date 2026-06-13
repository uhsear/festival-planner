# Competitor Feature Research — Festie

> Research conducted 2026-06-02 covering EDM/festival/event-coordination apps: Woov, Partiful, Splitwise, DICE, Bandsintown, Songkick, Clashfinder, setlist.fm, Frontstage, Festival Buddy, Life360, Instafest, etc. Grounded against the Festie codebase through systematic feature mapping.

## Summary

Festie already leads the field on its core thesis — crew coordination (members, meeting points, polls, expenses, activity feed, home base, invite codes, realtime) plus clash detection, priority picks (must/want/maybe), share link, .ics, wrap poster, and offline — features most majors lack entirely. The strategic move is NOT to chase parity with ticketing/discovery apps (tickets, RFID, AR, in-app radio, editorial discovery — all poor fit or out of scope). It is to (1) close the two coordination gaps that genuinely hurt — live crew location and richer expense settle-up — and (2) press the unfair advantage: turn the closed crew graph into features generic apps structurally cannot copy (crew overlap on a set, schedule-native polls, crew-aware wrap, SOS to your crew, crew-aware Spotify onboarding). Verified against the codebase: the expense store returns raw per-member balances with no netting/settle-up; Socket.IO presence is festival-scoped only (no live location, no per-set presence); meeting points store free-text location + stageReference (no coords yet); Spotify is server-side preview only (no user OAuth). These confirm the gaps below are real and the realtime/crew plumbing to fill them already exists. Recommended wedge order: ship the cheap crew-native social/ledger wins first (presence on sets, debt simplification, on-my-way, live mode), then the flagship differentiator (opt-in live crew location + proximity compass + SOS), then discovery accelerants (Spotify onboarding, picks-as-playlist), with Live Activities timed to the imminent iOS launch.

## Parity gaps — features competitors have that Festie lacks

### Live opt-in crew location on the map (time-boxed 'share until festival ends / for N hours', battery-aware)
- **Who has it**: Woov, Frontstage, Festival Buddy, Life360, Find My, BuddySOS
- **User value**: Solves the #1 unsolved festival pain — losing your group in a dead-signal crowd. Festie has meeting points but no live member dots; this is the single highest-leverage coordination gap and is directly on-brand for a 'real-time crew-coordination' app.
- **Effort**: large
- **Fit**: strong

### Debt simplification + settle-up on the expense ledger (net A→B→C chains into fewest payments, mark-as-settled, optional Venmo/Cash App/PayPal deep links)
- **Who has it**: Splitwise (debt simplification + Settle Up); Partiful (payment links)
- **User value**: Festie already stores a zero-sum cents ledger but only shows raw per-member net balances (confirmed in lib/db/stores/expenses.ts getBalances) — members still have to figure out who pays whom. A greedy netting pass plus a settle action turns the ledger into an actually-actionable 'pay $14 to Sam' with a one-tap payment link. Pure backend, high perceived value.
- **Effort**: small
- **Fit**: strong

### Connect Spotify to auto-suggest picks from your top artists on this festival's lineup (taste-seeded onboarding)
- **Who has it**: DICE, Bandsintown, Songkick, Shotgun, RA (library sync onboarding); Spotify Gov Ball/Glastonbury (history × actual lineup)
- **User value**: The category's highest-leverage cold-start mechanic. New users face an empty lineup; 'connect Spotify → here are 12 artists you already love playing this fest, confirm into must/want/maybe' collapses pick-building from minutes to seconds. Festie only has server-side Spotify preview today (no user OAuth), so this is a new auth surface, but the lineup+artist data is already resolved.
- **Effort**: medium
- **Fit**: strong

### Create a Spotify playlist from my picks (pre-festival prep)
- **Who has it**: Clashfinder, setlist.fm/Setlist, Woov (auto-setlist), Instafest
- **User value**: Festie stores picks + Spotify track refs but can't turn them into listenable audio. 'Build a playlist from my picks' (top tracks per picked artist) is a beloved pre-festival ritual and a discovery loop. Shares the Spotify OAuth surface with the auto-pick feature, so build them together.
- **Effort**: medium
- **Fit**: strong

### Live mode: timeline auto-scrolls to now + countdown to your next pick during the event
- **Who has it**: Headliners (auto-scroll + live countdowns), Frontstage, Woov
- **User value**: Turns the static schedule into a during-event companion. Festie already computes set times, picks, and reminders — this is a new view mode over data it has, pairing naturally with existing per-set reminders.
- **Effort**: small
- **Fit**: strong

### iOS Live Activity / Android ongoing notification: next pick + crew meeting point on the lock screen / Dynamic Island
- **Who has it**: Coachella, Festiverse, Glastonbury (widget), Frontstage (lock-screen lineup)
- **User value**: Glanceable next-set countdown and active meeting point without unlocking — premium-feeling and high-frequency during the event. Festie already computes everything it needs; this is a new surface. Times perfectly with the imminent iOS launch.
- **Effort**: medium
- **Fit**: strong

### Proximity compass (heading + distance arrow to a crew member or meeting point)
- **Who has it**: Festival Buddy, Crowd Compass
- **User value**: A dot on a map isn't enough in a 50k crowd — people need 'walk this way, 80m'. Solves the last-100-meters reunion that maps don't. High delight per line of code once live location exists (magnetometer + bearing math).
- **Effort**: medium
- **Fit**: strong

### Geofenced arrive/leave + 'X reached the meeting point' alerts; 'keep us together' separation ping
- **Who has it**: Life360 (Place Alerts, No Show), Find My (recurring arrive/leave), BuddySOS (boundary)
- **User value**: Turns passive location into proactive coordination — nobody asks 'are you here yet?'. Festie's meeting points and home base are ready-made geofence targets, but the points store free-text location today, so coords must be added first. Only worth it after live location ships.
- **Effort**: medium
- **Fit**: strong

### Manual 'I'm on my way to [meeting point], ETA ~8 min' broadcast to crew
- **Who has it**: Find My / Maps (share ETA + auto-arrival)
- **User value**: A lighter, privacy-friendly precursor to full live location: a button tied to existing meeting points + the Google Maps directions Festie already integrates, broadcast over the crew Socket.IO room. Gives 'how close is everyone' without continuous tracking.
- **Effort**: small
- **Fit**: strong

### Crew members' picks overlaid as small avatars on your own timeline/grid cells (passive inline compare)
- **Who has it**: Headliners (friends' sets inline), Festival Dust/Woov (combine schedules)
- **User value**: The market trend is passive inline overlay, not a dedicated compare screen — which validates Festie's deliberate 'compare-as-a-link, not a screen' choice while offering a better surface. Reuses crew realtime data Festie already has; shows crew overlap where decisions are actually made (the grid).
- **Effort**: medium
- **Fit**: strong

### Schedule-aware polls: poll options pulled from the lineup ('which set at 9pm?'), resolving into a shared meeting point + reminders
- **Who has it**: Partiful/GroupMe (generic polls); none are schedule-native
- **User value**: Festie already has crew polls + schedule + meeting points; wiring them together turns a generic poll into a festival-native decision that auto-creates the meetup. Low effort given existing primitives, and competitors' generic polls structurally can't do this.
- **Effort**: small
- **Fit**: strong

### Weather overlaid on YOUR pick times (hourly forecast band on the timeline)
- **Who has it**: Lollapalooza/most official apps (generic weather push)
- **User value**: Generic weather is commodity, but 'rain at your 4pm set' tied to the festival's lat/long and the user's own picks is rarer and genuinely useful for planning. One weather API + a timeline band. (Org-grade lightning/evacuation alerts stay out of scope.)
- **Effort**: medium
- **Fit**: medium

### Bulk pick helpers ('add all must-see', genre/stage bulk-pick)
- **Who has it**: Woov, Clashfinder (auto-setlist from favorites)
- **User value**: Speeds initial setup for big lineups; a cheap complement to (or fallback for) Spotify auto-pick using only data Festie already has.
- **Effort**: small
- **Fit**: medium

### Inline clash prompt ('You have 2 acts at 8:30 — pick one') rather than only a visual marker
- **Who has it**: Ticket Fairy pattern, Headliners
- **User value**: Festie already detects clashes; surfacing them as an actionable inline nudge at the moment of conflict is a small polish on a feature it already leads on.
- **Effort**: small
- **Fit**: strong

### Accessibility: per-set sensory icons (strobe warning / ASL zone) + app-level a11y polish (screen-reader labels, dynamic type, contrast)
- **Who has it**: Glastonbury, Ticket Fairy
- **User value**: Rare, low-controversy goodwill that materially helps disabled attendees. App-level a11y is baseline hygiene; per-set icons need structured data in the lineup model. Worth noting for the roadmap, not urgent.
- **Effort**: medium
- **Fit**: medium


## Novel opportunities — Festie's unfair advantage (hard for generic apps to copy)

### Crew overlap on a set: avatars of which crew members picked this artist, grouped by must/want/maybe priority, shown on the set card and grid cell
- **Rationale**: Festie's strongest whitespace-fit. Competitors do stranger 'who's going' (Radiate) or friend RSVP counts (Bandsintown); none tie it to a CLOSED crew graph crossed with PRIORITY picks. 'Two of your crew have this as a must' drives real meetups. Almost entirely a read-model/UI feature over data Festie already has (crews + per-member priority picks). No generic app can copy it because they have no crew graph and only binary favorites.
- **Effort**: small

### Crew SOS / 'find me' broadcast: one tap pings the whole crew with your live position (or last meeting point), overriding quiet hours/DND, with a clear 'I'm OK' resolve flow
- **Rationale**: Safety is the highest-trust, highest-retention surface, and Festie already has crews + realtime + FCM + activity feed — an SOS is just a high-priority broadcast reusing all of it. BuddySOS/SearchParty prove demand; almost no schedule/coordination app pairs it with a real crew graph. Must override DND and must NOT imply it contacts emergency services (liability). Pairs with live location but a 'ping my last meeting point' version can ship even before continuous tracking.
- **Effort**: medium

### Crew-aware wrap recap: extend the existing wrap poster with crew superlatives (most-overlapping taste, sets seen together, total expense split, per-member cards, a crew group recap)
- **Rationale**: The shareable recap is a top viral-growth loop (Spotify Wrapped, Instafest). Festie already ships a wrap poster and the useGridExport image pipeline; making it crew-aware reuses crew + picks + expense data competitors don't have. Pure differentiation and an organic growth lever — a crew that gets a shared recap recruits next year's crew.
- **Effort**: medium

### Live crew presence pinned to the schedule: 'who in my crew is at this set / this stage right now' (check-in or inferred), overlaid on the timeline/grid
- **Rationale**: Generic apps have presence (Discord) or who's-going (Festiverse) but cannot tie presence to a SPECIFIC set on a real schedule. Pure Socket.IO presence + ephemeral Redis state with TTL — no heavy new infra, builds on the festival-scoped presence Festie already emits. Creates live social momentum ('the crew's all at the main stage, head over') that is structurally unique to Festie.
- **Effort**: medium

### Crew-native taste discovery: 'artists like the ones your crew picked, also on this lineup' and 'three of your crew are seeing X — add it?'
- **Rationale**: Discovery apps recommend from solo listening history; Festie can recommend from the COMBINED crew's picks against the lineup it already stores — no external API needed for the basic version. Turns discovery into a crew activity and nudges shared meetups. A crew-aware twist on the Spotify-onboarding feature that no taste-only competitor can replicate.
- **Effort**: medium

### Reactions/comments on crew members' picks and on 'who's going to this set' (lightweight, Partiful-style 'boops')
- **Rationale**: Partiful's emoji reactions create pre-event social momentum a binary RSVP can't. Festie's picks are already richer than yes/no but are individual and not socially reactive within the crew. Adding 'me too' / emoji on picks turns parallel solo planning into shared anticipation. Builds on existing picks + crew + activity feed; mostly UX.
- **Effort**: medium


## Quick wins

- Debt simplification + settle-up on the existing expense ledger (greedy netting into fewest payments + mark-settled + optional Venmo/Cash App deep links) — pure backend over the cents ledger Festie already computes
- Crew overlap on a set: avatars-by-priority of which crew members picked an artist — read-model/UI over data Festie already has
- Live mode: auto-scroll the timeline to now + countdown to your next pick during the event
- Schedule-aware polls: poll options pulled from the lineup, resolving into a shared meeting point + reminders
- Manual 'I'm on my way / ETA' broadcast to the crew tied to existing meeting points
- Inline clash prompt ('2 acts at 8:30 — pick one') on top of existing clash detection
- Bulk pick helpers ('add all must-see', genre/stage bulk-pick)

## Recommended build order

1. 1. Debt simplification + settle-up on expenses — small effort, high perceived value, closes a concrete Splitwise-grade gap on infra (zero-sum cents ledger) that already exists.
2. 2. Crew overlap on a set (avatars by priority) — cheapest, most on-brand differentiator; makes Festie's crew+priority advantage visible exactly where decisions happen.
3. 3. Live mode + inline clash prompt + schedule-aware polls + bulk pick helpers — batch of small during-event/UX wins over existing schedule data, shippable in quick succession.
4. 4. Manual 'on my way / ETA' broadcast — lands the meetup-coordination value with no battery/GPS risk and de-risks the later live-location work.
5. 5. Connect Spotify → auto-suggest picks AND create-playlist-from-picks (build the OAuth surface once, ship both) — the category's top onboarding accelerant plus a beloved prep ritual.
6. 6. Crew-aware wrap recap — extend the existing poster pipeline with crew superlatives; a viral growth loop timed for end-of-festival.
7. 7. Live opt-in crew location + proximity compass + crew SOS (flagship) — the large, defining differentiator; sequence as live-location first, then compass and SOS as cheap layers on top; add meeting-point coords + geofence alerts as a follow-on.
8. 8. iOS Live Activity / Android ongoing notification — time to the iOS launch; a new glanceable surface over data Festie already has.
9. 9. Pick-aware weather band and accessibility (per-set sensory icons + a11y polish) — lower-urgency roadmap items; weather is cheap, a11y is ongoing goodwill/hygiene.
