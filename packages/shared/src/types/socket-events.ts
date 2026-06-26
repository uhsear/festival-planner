import type { OnlineUser, Priority, CrewMemberStatus } from './domain';

// ════════════════════════════════════════════════════════════════════════════════
// Socket.IO Event Payload Types
// ════════════════════════════════════════════════════════════════════════════════

/** Presence user entry as emitted by the server's emitPresence helper. */
export interface PresenceUser {
  userId: string;
  username: string;
  avatarUrl?: string;
}

/** Base payload with optional event version field. */
interface VersionedPayload {
  _v?: number;
}

// ── Profile events (emitter.js) ──────────────────────────────────────────────

export interface ProfileUpdatedPayload extends VersionedPayload {
  festivalId: string;
  profileId: string;
  name?: string;
  avatarUrl?: string;
  picks?: Record<string, Priority>;
  updatedAt?: string;
}

export interface ProfileCreatedPayload extends VersionedPayload {
  festivalId: string;
  profile: {
    id: string;
    name?: string;
    avatarUrl?: string;
  };
}

export interface ProfileDeletedPayload extends VersionedPayload {
  festivalId: string;
  profileId: string;
}

// ── Festival events (emitter.js) ─────────────────────────────────────────────

export interface FestivalIdPayload extends VersionedPayload {
  id: string;
}

export interface FestivalCreatedPayload extends VersionedPayload {
  id: string;
  name: string;
}

// ── Presence events ──────────────────────────────────────────────────────────

export interface PresenceUpdatePayload extends VersionedPayload {
  online: PresenceUser[];
  /** Legacy field — some code paths emit `users` instead of `online`. */
  users?: OnlineUser[];
}

// ── Crew events (crews.js, crew-features.js) ─────────────────────────────────

export interface CrewMemberEventPayload {
  crewId: string;
  userId: string;
  username?: string;
}

export interface CrewUpdatedPayload {
  id: string;
  crewId?: string;
  festivalId?: string;
  name?: string;
  members?: Array<{
    userId: string;
    username?: string;
    name?: string;
    role?: string;
    joinedAt?: string;
  }>;
  memberCount?: number;
  [key: string]: unknown;
}

export interface CrewDeletedPayload {
  crewId: string;
  festivalId?: string;
}

export interface CrewHomeBaseUpdatedPayload {
  crewId: string;
  location: string | null;
  time: string | null;
}

export interface CrewMeetingPointPayload {
  id: string;
  crewId: string;
  [key: string]: unknown;
}

export interface CrewMeetingPointRemovedPayload {
  id: string;
  crewId: string;
}

export interface CrewPollCreatedPayload {
  pollId: string;
  question: string;
  options: string[];
  createdBy: string;
}

export interface CrewPollVotedPayload {
  pollId: string;
  userId: string;
  optionIndex: number;
}

export interface CrewPollClosedPayload {
  pollId: string;
}

export interface CrewExpensePayload extends VersionedPayload {
  crewId: string;
  expense: Record<string, unknown>;
}

export interface CrewExpenseDeletedPayload extends VersionedPayload {
  crewId: string;
  expenseId: string;
}

export interface CrewActivityPayload extends VersionedPayload {
  crewId: string;
  item: Record<string, unknown>;
}

/**
 * M5: a member's last-synced status changed. The payload carries the upserted
 * row (snake_case). NOT live GPS — the client renders `updated_at` as honest
 * staleness. The crew room scopes it, so (like poll events) it carries no
 * top-level crewId; the row's `crew_id` is authoritative.
 */
export interface CrewStatusUpdatedPayload extends VersionedPayload {
  status: CrewMemberStatus;
}

// ── Live Location + SOS events (ephemeral; routes/socket.ts + crew-sos.ts) ────

/** client→server: declare intent to START sharing to the active crew. */
export interface LocationSharePayload extends VersionedPayload {
  crewId: string;
  position?: {
    lat: number;
    lng: number;
    accuracy?: number;
    heading?: number;
    /** Phase 4C: sharer battery % (0–100); only present when a native/web source supplies it. */
    battery?: number;
    /** Peer low-power flag (#5): sharer's device is in battery-saver mode; absent → omitted. */
    lowPower?: boolean;
    capturedAt: string;
  };
  /** Phase 4C: ISO expiry of this time-boxed share ("sharing ends in Nm"). */
  expiresAt?: string;
}

/** client→server: a periodic high-frequency GPS fix while sharing. */
export interface LocationUpdatePayload extends VersionedPayload {
  crewId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  /** Phase 4C: sharer battery % (0–100); only present when a source supplies it. */
  battery?: number;
  /** Peer low-power flag (#5): sharer's device is in battery-saver mode; absent → omitted. */
  lowPower?: boolean;
  /** Phase 4C: ISO expiry of this time-boxed share. */
  expiresAt?: string;
  capturedAt: string;
}

/** client→server: explicit opt-out of sharing. */
export interface LocationStopPayload extends VersionedPayload {
  crewId: string;
}

/** client→server (OPTIONAL, Phase 1.5): late-joiner snapshot request. */
export interface LocationSyncPayload extends VersionedPayload {
  crewId: string;
}

/** server→client: a peer's new position. UI renders staleness from serverAt. */
export interface LocationPeerUpdatePayload extends VersionedPayload {
  crewId: string;
  userId: string;
  username: string;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  /** Phase 4C: sharer battery % (0–100); only present when a source supplies it. */
  battery?: number;
  /** Peer low-power flag (#5): sharer's device is in battery-saver mode; absent → omitted. */
  lowPower?: boolean;
  /** Phase 4C: ISO expiry of this time-boxed share ("sharing ends in Nm"). */
  expiresAt?: string;
  capturedAt: string;
  serverAt: string;
}

/** server→client: a peer stopped / disconnected / TTL-expired. */
export interface LocationPeerStoppedPayload extends VersionedPayload {
  crewId: string;
  userId: string;
  reason: 'stop' | 'disconnect' | 'expired';
}

/** server→client: emitted by POST /crews/:crewId/sos (never a client emit). */
export interface SosRaisedPayload extends VersionedPayload {
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
  activityId: string;
  raisedAt: string;
}

/** server→client: emitted by POST /crews/:crewId/sos/clear. */
export interface SosClearedPayload extends VersionedPayload {
  crewId: string;
  userId: string;
  clearedBy: string;
  activityId?: string;
  clearedAt: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// Server → Client event map
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Maps every server→client Socket.IO event name to its payload type.
 * Use with `socket.on<K extends keyof ServerToClientEvents>(event, handler)`
 * for type-safe listeners.
 */
export interface ServerToClientEvents {
  // Profile
  'profile:created': (data: ProfileCreatedPayload) => void;
  'profile:updated': (data: ProfileUpdatedPayload) => void;
  'profile:deleted': (data: ProfileDeletedPayload) => void;
  // Legacy alias — server emits profile:updated but old code listened to these
  'profile:joined': (data: ProfileUpdatedPayload) => void;
  'profile:left': (data: ProfileDeletedPayload) => void;

  // Picks / notes — profile:updated is the actual event, but the client
  // registers explicit listeners for these names for clarity.
  'pick:updated': (data: ProfileUpdatedPayload) => void;
  'pick:removed': (data: ProfileDeletedPayload) => void;
  'picks:updated': (data: ProfileUpdatedPayload) => void;
  'note:saved': (data: ProfileUpdatedPayload) => void;

  // Festival
  'festival:created': (data: FestivalCreatedPayload) => void;
  'festival:updated': (data: FestivalIdPayload) => void;
  'festival:deleted': (data: FestivalIdPayload) => void;
  'festival:set-added': (data: FestivalIdPayload) => void;
  'festival:set-updated': (data: FestivalIdPayload) => void;
  'festival:access-revoked': (data: { festivalId: string; profileId?: string }) => void;

  // Presence
  'presence:update': (data: PresenceUpdatePayload) => void;
  'user:online': (user: OnlineUser) => void;
  'user:offline': (userId: string) => void;

  // Crew
  'crew:updated': (data: CrewUpdatedPayload) => void;
  'crew:deleted': (data: CrewDeletedPayload) => void;
  'crew:member-joined': (data: CrewMemberEventPayload) => void;
  'crew:member-left': (data: CrewMemberEventPayload) => void;
  'crew:member-kicked': (data: { crewId: string; userId: string }) => void;
  'crew:member-added': (data: CrewMemberEventPayload) => void;
  'crew:member-removed': (data: CrewMemberEventPayload) => void;
  'crew:home-base-updated': (data: CrewHomeBaseUpdatedPayload) => void;
  'crew:meeting-point-created': (data: CrewMeetingPointPayload) => void;
  'crew:meeting-point-updated': (data: CrewMeetingPointPayload) => void;
  'crew:meeting-point-removed': (data: CrewMeetingPointRemovedPayload) => void;
  'crew:poll-created': (data: CrewPollCreatedPayload) => void;
  'crew:poll-voted': (data: CrewPollVotedPayload) => void;
  'crew:poll-closed': (data: CrewPollClosedPayload) => void;
  'crew:expense-added': (data: CrewExpensePayload) => void;
  'crew:expense-deleted': (data: CrewExpenseDeletedPayload) => void;
  'crew:activity': (data: CrewActivityPayload) => void;
  'crew:status-updated': (data: CrewStatusUpdatedPayload) => void;

  // Live Location + SOS (ephemeral live location; safety-critical SOS)
  'location:peer-update': (data: LocationPeerUpdatePayload) => void;
  'location:peer-stopped': (data: LocationPeerStoppedPayload) => void;
  'sos:raised': (data: SosRaisedPayload) => void;
  'sos:cleared': (data: SosClearedPayload) => void;

  // Identity
  'profile:identity': (data: { festivalId: string; profileId: string; username: string; avatarUrl?: string }) => void;

  // System
  'session:revoked': (data: { reason: string }) => void;
  'server:draining': (data: { message: string }) => void;
  error: (error: { message: string; code?: string }) => void;
  connect: () => void;
  disconnect: (reason: string) => void;
}

// ════════════════════════════════════════════════════════════════════════════════
// Client → Server event map
// ════════════════════════════════════════════════════════════════════════════════

export interface ClientToServerEvents {
  'join:festival': (
    festivalId: string,
    data: { _v?: number; userToken?: string | null },
    ack: (response: { ok: boolean; profileId?: string; error?: string }) => void,
  ) => void;
  'leave:festival': () => void;
  'join:crew': (
    data: { _v?: number; crewId: string },
    ack: (response: { ok: boolean; crewId?: string; error?: string }) => void,
  ) => void;
  'leave:crew': (data: { _v?: number; crewId: string }) => void;
  'reconnect:restore': (
    data: { _v?: number; festivalId: string; userToken?: string | null },
    ack: (response: { ok: boolean; profileId?: string; error?: string }) => void,
  ) => void;

  // Live Location (ephemeral). SOS raise/clear are HTTP POSTs, not socket emits.
  'location:share': (data: LocationSharePayload, ack: (response: { ok: boolean; code?: string }) => void) => void;
  'location:update': (data: LocationUpdatePayload) => void;
  'location:stop': (data: LocationStopPayload, ack: (response: { ok: boolean }) => void) => void;
  // OPTIONAL (Phase 1.5, Redis-backed). Phase 1 has no server handler; the type
  // exists so the late-joiner snapshot contract is ready for the UI to adopt.
  'location:sync': (
    data: LocationSyncPayload,
    ack: (response: { ok: boolean; peers: LocationPeerUpdatePayload[] }) => void,
  ) => void;
}
