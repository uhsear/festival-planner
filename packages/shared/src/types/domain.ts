export type Priority = 'must' | 'want-to-see' | 'maybe';

export interface Festival {
  id: string;
  name: string;
  description?: string;
  image?: string;
  startDate: string;
  endDate: string;
  location?: string;
  b2bSeparator?: string;
  /**
   * Optional IANA time-zone id (e.g. `America/New_York`). When present, set
   * reminders are anchored in the festival's zone so they fire at the right
   * real-world instant for attendees whose phones are in another zone. Absent →
   * time math falls back to the device-local frame (see resolveFestivalTimeZone).
   */
  timeZone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Stage {
  id: string;
  name: string;
  color?: string;
  festivalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FestivalDay {
  id: string;
  festivalId: string;
  date: string;
  label?: string;
  dayIndex?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Artist {
  id?: string;
  name: string;
  photo?: string;
  genres?: string[];
  links?: Record<string, string>;
}

export interface FestivalSet {
  id: string;
  festivalId: string;
  stageId: string;
  stageName?: string;
  date?: string;
  dayIndex?: number;
  startTime: string;
  endTime: string;
  artist?: string;
  artists?: Artist[];
  linkUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  avatar?: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  // Payment handles for settle-up deep links (serializePublicUser surfaces
  // these; null when unset). Used by account settings + the settlement plan.
  venmoHandle?: string | null;
  cashappCashtag?: string | null;
  paypalHandle?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  data: {
    user: User;
    token?: string;
  };
  error?: null;
}

export interface Profile {
  id: string;
  userId: string;
  festivalId: string;
  name?: string;
  picks: Record<string, Priority>;
  notes: Record<string, string>;
  /** setId -> reminder lead time in minutes (5|10|15|30|60). */
  reminders?: Record<string, number>;
  updatedAt: string;
  etag?: string;
}

export interface CrewMember {
  userId: string;
  /** Immutable @handle, serialized alongside the friendly `name` (routes/crews.ts). */
  username?: string;
  name?: string;
  avatarKey?: string | null;
  avatarVersion?: string | null;
  role?: 'owner' | 'member';
  joinedAt?: string;
}

export interface Crew {
  id: string;
  name: string;
  inviteCode?: string;
  owner: string;
  festivalId?: string;
  members: CrewMember[];
  // Home base is surfaced on the serialized crew (routes/crews.ts:48-50);
  // owner-only PUT /crews/:id/home-base updates it. Optional/nullable so the
  // additions don't break existing crew consumers.
  homeBaseLocation?: string | null;
  homeBaseTime?: string | null;
  homeBaseUpdatedAt?: string | null;
  // Crew totem: a crew's rally marker (the flag/sign held up in the crowd so the
  // crew can find each other). `totem_name` is a short label (≤40 chars) and
  // `totem_emoji` a small glyph (≤16 chars). Serialized snake_case on every crew
  // read/list response, defaulting to null when unset. Optional/nullable so the
  // additions never break existing crew consumers; set via crew create/update.
  totem_name?: string | null;
  totem_emoji?: string | null;
  // M6 Crew Photo Wall (Phase 1, link-out only): a single shared-album URL
  // (e.g. Google Photos / Apple shared album) any member can set; members open
  // it to view/add photos off-platform. Festie does not host photos yet (the R2
  // upload pipeline is deferred). Optional/nullable so it never breaks existing
  // crew consumers; set via PUT /crews/:id/photo-album.
  photoAlbumUrl?: string | null;
  // Lineage (M3 "Reform crew for next festival"): the id of the crew this one
  // was reformed from, or null/absent for a normally-created crew. Surfaced by
  // routes/crews.ts so the UI can show "your crew last year". Additive/optional.
  reformedFrom?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Client-only optimistic-offline flag (see CrewPoll._optimistic). Set on a
   * synthetic placeholder crew inserted while an offline `joinByCode` is queued;
   * the queue reconciler swaps it for the real crew on replay, and a fresh
   * online `loadCrews` (which replaces the whole list) drops any stragglers.
   */
  _optimistic?: boolean;
}

/**
 * Per-roster outcome of POST /crews/:id/reform — who was auto-added to the new
 * crew (already had a target-festival profile) vs who still needs to be invited
 * via the shared link. Consent-safe: members without a profile are NEVER
 * silently added.
 */
export interface CrewReformOutcome {
  autoAdded: string[];
  invited: string[];
}

/** Response of POST /crews/:crewId/reform — the new crew + the roster split. */
export interface ReformCrewResponse extends Crew {
  reformedFrom: string | null;
  reform: CrewReformOutcome;
}

/** Request body for POST /crews/:crewId/reform. */
export interface ReformCrewRequest {
  targetFestivalId: string;
}

export interface CrewOverlap {
  setId: string;
  memberCount: number;
  members: CrewMember[];
}

/**
 * Crew poll as serialized by the backend (routes/crew-polls.ts). Fields are
 * snake_case because they come straight from Postgres. `votes` is the raw vote
 * list — count per option is derived client-side.
 */
export interface CrewPollVote {
  option: number;
  user_id: string | null;
}

/**
 * Client-only linkage from a schedule-aware poll OPTION to the lineup set it
 * was prefilled from (M2 "Schedule-aware polls"). Carried in local state /
 * persisted on the poll, NEVER sent to the server (no migration) — so when the
 * poll closes the winning option already knows which set won and can seed a
 * meeting point + reminder. `null` marks a free-text option with no set behind
 * it. Each entry is index-aligned with `CrewPoll.options`.
 */
export interface PollSetRef {
  setId: string;
  /** Artist/title → meeting-point label. */
  label: string;
  /** Stage name → meeting-point stageReference. */
  stageReference: string | null;
  /** Set start (ISO) → meeting-point meetAt. */
  meetAt: string | null;
}

export interface CrewPoll {
  id: string;
  crew_id: string;
  created_by: string;
  question: string;
  options: string[];
  votes: CrewPollVote[];
  closes_at: string | null;
  closed: boolean;
  created_at: string;
  /**
   * Client-only flag (NOT sent by the server). Marks an entity that was created
   * while offline and is rendering optimistically from the offline write-queue's
   * synthetic result, before its queued POST has replayed. Cleared/replaced when
   * the queued create replays (reconciliation) or on the next authoritative
   * server reload. Strict server consumers ignore it (optional).
   */
  _optimistic?: boolean;
  /**
   * Client-only set linkage (NOT sent by the server). Index-aligned with
   * `options`: `_setRefs[i]` is the lineup set behind option `i`, or `null` for
   * a free-text option. Set by the schedule-aware composer; consumed by
   * `closePoll` to create the winning set's meeting point + reminder. Persisted
   * with the poll so close works after a reload. Optional — plain polls omit it.
   */
  _setRefs?: (PollSetRef | null)[];
}

export interface CreateCrewPollRequest {
  question: string;
  options: string[];
  closesAt?: string;
}

/**
 * Options for `closePoll`. When a schedule-aware poll closes, the winning
 * option's linked set (carried in `CrewPoll._setRefs`) becomes a shared meeting
 * point + a seeded reminder. crewStore owns the meeting-point create (same
 * store); the reminder is seeded through the injected `seedReminder` callback so
 * crewStore stays decoupled from festivalDataStore. Omit entirely for a plain
 * close (the legacy `closePoll(crewId, pollId)` behavior is unchanged).
 */
export interface ClosePollOptions {
  /** Active festival id — required to seed a reminder (SaveReminderRequest). */
  festivalId?: string;
  /**
   * Seeds a set reminder for the winning option's set. Callers bind this to
   * `useFestivalStore.getState().saveReminder`. Lead time is the caller's
   * default. Errors here are swallowed (best-effort) so a reminder failure can
   * never block closing the poll or creating the meeting point.
   */
  seedReminder?: (setId: string, festivalId: string) => Promise<void> | void;
}

/**
 * Crew meeting point as serialized by the backend
 * (routes/crew-meeting-points.ts). snake_case from Postgres.
 */
export interface CrewMeetingPoint {
  id: string;
  crew_id: string;
  created_by: string;
  label: string;
  location: string;
  type: string;
  meet_at: string | null;
  stage_reference: string | null;
  /** F4: captured GPS coords; null for legacy free-text meeting points. */
  latitude?: number | null;
  longitude?: number | null;
  /**
   * 055: when true the point repeats every festival day at `meet_at`'s
   * time-of-day ("daily 3:00 PM"). Defaults false (one-shot). Optional because
   * legacy list/create payloads predate the column. See utils/meetingTime.ts for
   * resolving the next/each concrete occurrence for display.
   */
  recurs_daily?: boolean;
  /** 055: backend also serializes expiry/update timestamps on the row. */
  expires_at?: string | null;
  updated_at?: string;
  /** Joined creator username (present on the list endpoint, not on create/update). */
  creator_name?: string;
  active: boolean;
  created_at: string;
  /** Client-only optimistic-offline flag (see CrewPoll._optimistic). */
  _optimistic?: boolean;
}

export interface CreateCrewMeetingPointRequest {
  label: string;
  location: string;
  type?: string;
  meetAt?: string | null;
  stageReference?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** 055: optional daily recurrence; omitted ⇒ server defaults to false (one-shot). */
  recursDaily?: boolean;
}

export interface UpdateCrewMeetingPointRequest {
  label?: string;
  location?: string;
  type?: string;
  meetAt?: string | null;
  stageReference?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** 055: toggle daily recurrence on an existing point. */
  recursDaily?: boolean;
}

/**
 * Crew packing-board item (M2 logistics) as serialized by the backend
 * (routes/crew-packing.ts). snake_case from Postgres. A shared "who's bringing
 * what" checklist row: a `label`, an optional `brought_by` owner, and a
 * `claimed` flag.
 */
export interface CrewPackingItem {
  id: string;
  crew_id: string;
  created_by: string;
  label: string;
  brought_by: string | null;
  claimed: boolean;
  created_at: string;
  /** Client-only optimistic-offline flag (see CrewPoll._optimistic). */
  _optimistic?: boolean;
}

export interface CreateCrewPackingItemRequest {
  label: string;
  broughtBy?: string | null;
  claimed?: boolean;
}

export interface UpdateCrewPackingItemRequest {
  label?: string;
  broughtBy?: string | null;
  claimed?: boolean;
}

/**
 * Crew carpool / ride-board offer (M2 logistics) as serialized by the backend
 * (routes/crew-rides.ts). snake_case from Postgres. A shared "who's driving"
 * board row: an optional `driver` name, `seats` count, `depart_from` origin,
 * free-text `depart_at` time, and a `note`. Cloned from CrewPackingItem.
 */
export interface CrewRideOffer {
  id: string;
  crew_id: string;
  created_by: string;
  driver: string | null;
  seats: number | null;
  depart_from: string | null;
  depart_at: string | null;
  note: string | null;
  created_at: string;
  /** Client-only optimistic-offline flag (see CrewPoll._optimistic). */
  _optimistic?: boolean;
}

export interface CreateCrewRideOfferRequest {
  driver?: string | null;
  seats?: number | null;
  departFrom?: string | null;
  departAt?: string | null;
  note?: string | null;
}

export interface UpdateCrewRideOfferRequest {
  driver?: string | null;
  seats?: number | null;
  departFrom?: string | null;
  departAt?: string | null;
  note?: string | null;
}

/**
 * Crew member status (M5) as serialized by the backend (routes/crew-status.ts).
 * snake_case from Postgres.
 *
 * CARDINAL RULE: this is a LAST-SYNCED degraded-sync snapshot, NOT live GPS. The
 * member set it (often offline) and it delivered on the next signal blip. ALWAYS
 * render `updated_at` as honest staleness ("as of N ago" via formatStaleness) —
 * never imply real-time.
 *
 * - `status`: 'on-my-way' | 'here' | 'delayed' | null (null = cleared)
 * - `target_meeting_point_id`: free TEXT ref to a crew_meeting_points row (the
 *   ETA target); may dangle if the point was removed → renders without a target.
 * - `eta_minutes`: the member's own estimate (or geo-computed when the target
 *   point has coords + the device shared a position), null when unknown.
 */
export interface CrewMemberStatus {
  crew_id: string;
  user_id: string;
  status: 'on-my-way' | 'here' | 'delayed' | null;
  target_meeting_point_id: string | null;
  eta_minutes: number | null;
  note: string | null;
  /**
   * 055: last-known OFFLINE presence breadcrumb (DOUBLE PRECISION) — NOT live
   * GPS. Null when the member never captured a fix. Render with HONEST staleness
   * derived from `location_captured_at` ("last seen near X, as of N ago"), never
   * "live". `location_captured_at` is when the device stamped the fix (offline),
   * distinct from `updated_at` (when the row last synced).
   */
  latitude?: number | null;
  longitude?: number | null;
  location_captured_at?: string | null;
  updated_at: string;
  // Joined member display fields (from the users table in listByCrew).
  username?: string;
  name?: string | null;
  avatar_key?: string | null;
  avatar_version?: string | null;
  /** Client-only optimistic-offline flag (see CrewPoll._optimistic). */
  _optimistic?: boolean;
}

/**
 * The PUT /crews/:id/status body the member sends to set THEIR OWN status. All
 * fields optional; an empty `status` (null) clears it.
 */
export interface UpdateCrewMemberStatusRequest {
  status?: 'on-my-way' | 'here' | 'delayed' | null;
  targetMeetingPointId?: string | null;
  etaMinutes?: number | null;
  note?: string | null;
  /**
   * 055: optional last-known OFFLINE breadcrumb to persist with this status.
   * OMIT entirely to leave the prior breadcrumb untouched (server COALESCEs).
   * When `capturedAt` is omitted the server stamps `location_captured_at = now()`.
   * NOT live GPS — captured (often offline) and delivered on the next signal blip.
   */
  position?: { lat: number; lng: number; capturedAt?: string } | null;
}

/**
 * Crew expense as serialized by the backend (routes/crew-expenses.ts).
 * snake_case from Postgres. `amount` arrives as a numeric string from pg, so
 * consumers must Number() it.
 */
export interface CrewExpense {
  id: string;
  crew_id: string;
  paid_by: string;
  paid_by_name: string;
  description: string;
  amount: string | number;
  split_with: string[];
  category: string;
  /**
   * Budget = planned expenses. A planned row is a forecast/anticipated cost and
   * is EXCLUDED from the balance ledger + settle-up (server getBalances filters
   * planned=false). Absent/false on legacy rows means an actual expense.
   */
  planned?: boolean;
  created_at: string;
  /** Client-only optimistic-offline flag (see CrewPoll._optimistic). */
  _optimistic?: boolean;
}

export interface CrewExpenseBalance {
  userId: string;
  username: string;
  balance: number;
}

export interface CreateCrewExpenseRequest {
  description: string;
  amount: number;
  splitWith: string[];
  category: string;
  /** Mark as a planned/budget row (forecast-only, excluded from settle-up). */
  planned?: boolean;
}

export interface SettleCrewExpenseRequest {
  toUserId: string;
  amount: number;
}

/** Payee payment handles attached to a settlement row (null when unset). */
export interface SettlementPayeeHandles {
  venmo: string | null;
  cashapp: string | null;
  paypal: string | null;
}

/**
 * One netted transfer in the simplified settlement plan: `from` pays `to`.
 * Amount carried as both integer cents (ledger source of truth) and dollars.
 */
export interface CrewSettlement {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
  amount: number;
  payeeHandles: SettlementPayeeHandles;
}

/** Response of GET /crews/:crewId/expenses/settlement-plan. */
export interface CrewSettlementPlan {
  balances: CrewExpenseBalance[];
  settlements: CrewSettlement[];
}

/**
 * Crew activity-log entry (routes/crew-activity.ts). snake_case from Postgres.
 * `type` is a free-form event string ('member-joined', 'expense-added', …).
 */
export interface CrewActivityEntry {
  id: string;
  crew_id: string;
  user_id: string;
  username: string;
  type: string;
  detail: string | null;
  created_at: string;
}

/**
 * Live Location + SOS (EPHEMERAL — never persisted client- or server-side).
 *
 * A peer's last-known position as held in the non-persisted liveLocationStore.
 * `serverAt` is the server's receive timestamp — the UI renders honest
 * "live · N ago" staleness from it (via formatStaleness) and NEVER implies a
 * pinpoint real-time fix. GPS in festival crowds can be tens of metres off, so
 * `accuracy` (metres) should surface as a radius, not a dot.
 */
export interface PeerLocation {
  crewId: string;
  userId: string;
  username: string;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  /** ISO timestamp the client stamped at GPS fix time. */
  capturedAt: string;
  /** ISO timestamp the server received/relayed the fix (authoritative for staleness). */
  serverAt: string;
}

/**
 * An active SOS for the current crew, held in the liveLocationStore. The single
 * coordinate is the one intentional durable location datum (see crew_activity);
 * everything else about live location is ephemeral.
 */
export interface SosEntry {
  crewId: string;
  userId: string;
  username: string;
  message?: string;
  position?: {
    lat: number;
    lng: number;
    accuracy?: number;
    capturedAt: string;
  };
  activityId?: string;
  raisedAt: string;
}

export interface NotificationPrefs {
  userId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  scheduleAlerts: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineUser {
  id: string;
  name?: string;
  avatar?: string;
  status: 'online' | 'away' | 'offline';
  lastSeen?: string;
}
