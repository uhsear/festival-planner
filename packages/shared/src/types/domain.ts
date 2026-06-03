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
  id: string;
  userId: string;
  /** Immutable @handle, serialized alongside the friendly `name` (routes/crews.ts). */
  username?: string;
  name?: string;
  avatar?: string;
  role?: 'owner' | 'member';
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
  createdAt: string;
  updatedAt: string;
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
}

export interface UpdateCrewMeetingPointRequest {
  label?: string;
  location?: string;
  type?: string;
  meetAt?: string | null;
  stageReference?: string | null;
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
}

export interface SettleCrewExpenseRequest {
  toUserId: string;
  amount: number;
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
