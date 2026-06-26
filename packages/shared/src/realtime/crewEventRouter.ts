// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * crewEventRouter — pure, socket-free routing core for crew sub-feature realtime.
 *
 * Each exported function takes a raw socket payload + the active crew id and
 * returns a typed *intent descriptor* describing what the consumer should do, or
 * `null` when the event should be ignored (no active crew, or the event is
 * scoped to a different crew than the one currently open).
 *
 * The functions deliberately know nothing about sockets, stores, or React: they
 * mirror the guard + crewId-resolution logic of the mobile `useRealtimeSync`
 * reference implementation so it can be unit-tested in isolation. The hook
 * wrapper (`useCrewRealtime`) wires these to a socket and an injected sink.
 *
 * Backend emit shapes (verified against routes/ + lib/emitter.ts):
 *   crew:home-base-updated      { crewId, location, time }
 *   crew:meeting-point-created  <raw DB row> { crew_id, created_by, meet_at, ... }
 *   crew:meeting-point-updated  <raw DB row> { crew_id, ... }
 *   crew:meeting-point-removed  { id, crewId }
 *   crew:poll-created           { pollId, question, options, createdBy }   (no crewId)
 *   crew:poll-voted             { pollId, userId, optionIndex }            (no crewId)
 *   crew:poll-closed            { pollId }                                 (no crewId)
 *   crew:expense-added          { _v, crewId, expense }
 *   crew:expense-deleted        { _v, crewId, expenseId }
 *   crew:activity               { _v, crewId, item }
 *
 * Poll events carry no crewId because join:crew scopes the socket to a single
 * `crew:${crewId}` room server-side; the active crew is the authoritative
 * resolution, so poll intents only require a non-null active crew.
 */

import type {
  CrewMeetingPoint,
  CrewPoll,
  CrewExpense,
  CrewActivityEntry,
  PeerLocation,
  SosEntry,
} from '../types/domain';
import type {
  CrewHomeBaseUpdatedPayload,
  CrewMeetingPointPayload,
  CrewMeetingPointRemovedPayload,
  CrewPollCreatedPayload,
  CrewPollVotedPayload,
  CrewPollClosedPayload,
  CrewExpensePayload,
  CrewExpenseDeletedPayload,
  CrewActivityPayload,
  LocationPeerUpdatePayload,
  LocationPeerStoppedPayload,
  SosRaisedPayload,
  SosClearedPayload,
} from '../types/socket-events';

// ════════════════════════════════════════════════════════════════════════════
// Intent descriptors — the typed output of the router.
// ════════════════════════════════════════════════════════════════════════════

export interface HomeBaseUpdatedIntent {
  kind: 'home-base-updated';
  crewId: string;
  location: string | null;
  time: string | null;
}

export interface MeetingPointUpsertIntent {
  kind: 'meeting-point-upsert';
  crewId: string;
  meetingPoint: CrewMeetingPoint;
}

export interface MeetingPointRemovedIntent {
  kind: 'meeting-point-removed';
  crewId: string;
  mpId: string;
}

/**
 * Poll-created carries no full poll shape (only pollId/question/options), so the
 * intent signals a *reload* of the authoritative list rather than an in-place
 * insert — mirrors mobile's debounced `loadPolls`. The raw fields are carried so
 * a consumer that wants to insert optimistically still can.
 */
export interface PollCreatedIntent {
  kind: 'poll-created';
  crewId: string;
  pollId: string;
  question: string;
  options: string[];
  createdBy: string;
}

export interface PollVotedIntent {
  kind: 'poll-voted';
  crewId: string;
  pollId: string;
  userId: string;
  optionIndex: number;
}

export interface PollClosedIntent {
  kind: 'poll-closed';
  crewId: string;
  pollId: string;
}

export interface ExpensesChangedIntent {
  kind: 'expenses-changed';
  crewId: string;
}

export interface ActivityLoggedIntent {
  kind: 'activity-logged';
  crewId: string;
}

// ── Live Location + SOS intents ─────────────────────────────────────────────
// All four payloads carry an explicit crewId, so the guard is exact (no reliance
// on room-scoping like the poll events). Unlike the reload-style intents above,
// these carry full payloads and are applied IMMEDIATELY (no debounce).

export interface LocationPeerUpdateIntent {
  kind: 'location-peer-update';
  crewId: string;
  peer: PeerLocation;
}

export interface LocationPeerStoppedIntent {
  kind: 'location-peer-stopped';
  crewId: string;
  userId: string;
  reason: 'stop' | 'disconnect' | 'expired';
}

export interface SosRaisedIntent {
  kind: 'sos-raised';
  crewId: string;
  sos: SosEntry;
}

export interface SosClearedIntent {
  kind: 'sos-cleared';
  crewId: string;
  userId: string;
  clearedBy: string;
}

export type CrewRealtimeIntent =
  | HomeBaseUpdatedIntent
  | MeetingPointUpsertIntent
  | MeetingPointRemovedIntent
  | PollCreatedIntent
  | PollVotedIntent
  | PollClosedIntent
  | ExpensesChangedIntent
  | ActivityLoggedIntent
  | LocationPeerUpdateIntent
  | LocationPeerStoppedIntent
  | SosRaisedIntent
  | SosClearedIntent;

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a meeting-point payload's crew id. The created/updated payloads are
 * the raw serialized DB row whose id is snake_case (`crew_id`); fall back to
 * camelCase (`crewId`) only for safety. Mirrors mobile useRealtimeSync.
 */
function resolveMeetingPointCrewId(payload: CrewMeetingPointPayload): string | undefined {
  const p = payload as { crew_id?: string; crewId?: string };
  return p?.crew_id ?? p?.crewId;
}

/** True when there is an active crew and the event targets exactly it. */
function matchesActiveCrew(crewId: string | undefined, activeCrewId: string | null): activeCrewId is string {
  return Boolean(activeCrewId) && crewId === activeCrewId;
}

// ════════════════════════════════════════════════════════════════════════════
// Routers — one pure function per server→client crew sub-feature event.
// ════════════════════════════════════════════════════════════════════════════

export function routeHomeBaseUpdated(
  payload: CrewHomeBaseUpdatedPayload,
  activeCrewId: string | null,
): HomeBaseUpdatedIntent | null {
  if (!matchesActiveCrew(payload?.crewId, activeCrewId)) return null;
  return {
    kind: 'home-base-updated',
    crewId: payload.crewId,
    location: payload.location,
    time: payload.time,
  };
}

export function routeMeetingPointUpsert(
  payload: CrewMeetingPointPayload,
  activeCrewId: string | null,
): MeetingPointUpsertIntent | null {
  const crewId = resolveMeetingPointCrewId(payload);
  if (!matchesActiveCrew(crewId, activeCrewId)) return null;
  return {
    kind: 'meeting-point-upsert',
    crewId: activeCrewId,
    meetingPoint: payload as unknown as CrewMeetingPoint,
  };
}

export function routeMeetingPointRemoved(
  payload: CrewMeetingPointRemovedPayload,
  activeCrewId: string | null,
): MeetingPointRemovedIntent | null {
  if (!matchesActiveCrew(payload?.crewId, activeCrewId)) return null;
  return {
    kind: 'meeting-point-removed',
    crewId: payload.crewId,
    mpId: payload.id,
  };
}

export function routePollCreated(
  payload: CrewPollCreatedPayload,
  activeCrewId: string | null,
): PollCreatedIntent | null {
  // No crewId in payload — the active crew room scopes it. Only require an
  // active crew to exist.
  if (!activeCrewId) return null;
  return {
    kind: 'poll-created',
    crewId: activeCrewId,
    pollId: payload.pollId,
    question: payload.question,
    options: payload.options,
    createdBy: payload.createdBy,
  };
}

export function routePollVoted(payload: CrewPollVotedPayload, activeCrewId: string | null): PollVotedIntent | null {
  if (!activeCrewId) return null;
  return {
    kind: 'poll-voted',
    crewId: activeCrewId,
    pollId: payload.pollId,
    userId: payload.userId,
    optionIndex: payload.optionIndex,
  };
}

export function routePollClosed(payload: CrewPollClosedPayload, activeCrewId: string | null): PollClosedIntent | null {
  if (!activeCrewId) return null;
  return {
    kind: 'poll-closed',
    crewId: activeCrewId,
    pollId: payload.pollId,
  };
}

export function routeExpensesChanged(
  payload: CrewExpensePayload | CrewExpenseDeletedPayload,
  activeCrewId: string | null,
): ExpensesChangedIntent | null {
  if (!matchesActiveCrew(payload?.crewId, activeCrewId)) return null;
  return { kind: 'expenses-changed', crewId: payload.crewId };
}

export function routeActivityLogged(
  payload: CrewActivityPayload,
  activeCrewId: string | null,
): ActivityLoggedIntent | null {
  if (!matchesActiveCrew(payload?.crewId, activeCrewId)) return null;
  return { kind: 'activity-logged', crewId: payload.crewId };
}

export function routeLocationPeerUpdate(
  payload: LocationPeerUpdatePayload,
  activeCrewId: string | null,
): LocationPeerUpdateIntent | null {
  if (!matchesActiveCrew(payload?.crewId, activeCrewId)) return null;
  return {
    kind: 'location-peer-update',
    crewId: payload.crewId,
    peer: {
      crewId: payload.crewId,
      userId: payload.userId,
      username: payload.username,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      heading: payload.heading,
      speed: payload.speed,
      battery: payload.battery,
      lowPower: payload.lowPower,
      expiresAt: payload.expiresAt,
      capturedAt: payload.capturedAt,
      serverAt: payload.serverAt,
    },
  };
}

export function routeLocationPeerStopped(
  payload: LocationPeerStoppedPayload,
  activeCrewId: string | null,
): LocationPeerStoppedIntent | null {
  if (!matchesActiveCrew(payload?.crewId, activeCrewId)) return null;
  return {
    kind: 'location-peer-stopped',
    crewId: payload.crewId,
    userId: payload.userId,
    reason: payload.reason,
  };
}

export function routeSosRaised(payload: SosRaisedPayload, activeCrewId: string | null): SosRaisedIntent | null {
  if (!matchesActiveCrew(payload?.crewId, activeCrewId)) return null;
  return {
    kind: 'sos-raised',
    crewId: payload.crewId,
    sos: {
      crewId: payload.crewId,
      userId: payload.userId,
      username: payload.username,
      message: payload.message,
      position: payload.position,
      activityId: payload.activityId,
      raisedAt: payload.raisedAt,
    },
  };
}

export function routeSosCleared(payload: SosClearedPayload, activeCrewId: string | null): SosClearedIntent | null {
  if (!matchesActiveCrew(payload?.crewId, activeCrewId)) return null;
  return {
    kind: 'sos-cleared',
    crewId: payload.crewId,
    userId: payload.userId,
    clearedBy: payload.clearedBy,
  };
}

// Re-export the domain types the intents reference so consumers building a sink
// have a single import surface.
export type { CrewMeetingPoint, CrewPoll, CrewExpense, CrewActivityEntry, PeerLocation, SosEntry };
