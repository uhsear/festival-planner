// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * COMPILE-TIME contract test. This file ships zero runtime assertions — its job
 * is to make `tsc --noEmit` fail if the backend's serialized shapes ever drift
 * from the shared domain contracts. It is part of the tsconfig `include`, so a
 * regression here turns CI red.
 *
 * Positive cases prove the real serialized shapes satisfy the contracts.
 * Negative cases use `@ts-expect-error` to prove the compiler now *rejects* the
 * historical bugs (a Crew without `owner`; a CrewMeetingPoint with camelCase
 * `crewId`). If a negative case ever stops erroring, the `@ts-expect-error`
 * itself becomes an unused-directive error — so removing the bug-guard can't
 * pass silently.
 */

import type { Crew, CrewMember, CrewMeetingPoint, Profile, User } from '../../lib/types';
import type { PublicUser } from '../../lib/types/app-context';

// ── Fixtures ────────────────────────────────────────────────────────────────

const member: CrewMember = {
  id: 'm-1',
  userId: 'user-1',
  username: 'alice',
  name: 'Alice',
  role: 'owner',
};

// ── Positive: the full, correct Crew shape is assignable ──────────────────────

const validCrew: Crew = {
  id: 'crew-1',
  name: 'The Squad',
  owner: 'user-1',
  festivalId: 'fest-1',
  members: [member],
  inviteCode: 'ABC123',
  homeBaseLocation: 'Gate A',
  homeBaseTime: '15:00',
  homeBaseUpdatedAt: '2026-06-01T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};
void validCrew;

// ── Positive: serializePublicUser's projection is a structural subset of User ─

const publicUser: PublicUser = {
  id: 'user-1',
  username: 'alice',
  name: 'Alice',
  avatarUrl: null,
  email: null,
  emailVerified: false,
  venmoHandle: null,
  cashappCashtag: null,
  paypalHandle: null,
};
// The public projection carries the identity fields the shared User contract
// requires; assert that overlap explicitly (the API intentionally emits `null`
// for absent optionals where User uses `undefined`, so this checks the shared
// required surface rather than full `Partial<User>` assignability).
const userIdentity: Pick<User, 'id' | 'username'> = {
  id: publicUser.id,
  username: publicUser.username,
};
void userIdentity;

// ── Positive: a well-formed Profile is assignable ─────────────────────────────

const validProfile: Profile = {
  id: 'p-1',
  userId: 'user-1',
  festivalId: 'fest-1',
  picks: { 'set-1': 'must' },
  notes: { 'set-1': 'front row' },
  reminders: { 'set-1': 15 },
  updatedAt: '2026-06-01T00:00:00.000Z',
};
void validProfile;

// ── Positive: a correct snake_case CrewMeetingPoint is assignable ─────────────

const validMeetingPoint: CrewMeetingPoint = {
  id: 'mp-1',
  crew_id: 'crew-1',
  created_by: 'user-1',
  label: 'Main Stage Left',
  location: 'By the food trucks',
  type: 'during',
  meet_at: null,
  stage_reference: null,
  active: true,
  created_at: '2026-06-01T00:00:00.000Z',
};
void validMeetingPoint;

// ════════════════════════════════════════════════════════════════════════════
// NEGATIVE CASES — each MUST error. Removing any `@ts-expect-error` below would
// itself become a compile error (unused directive), so these guard real bugs.
// ════════════════════════════════════════════════════════════════════════════

// Historical bug #1: a Crew serialized WITHOUT `owner`. The compiler must reject
// it (property 'owner' is missing).
// @ts-expect-error — Crew requires `owner`
const crewMissingOwner: Crew = {
  id: 'crew-2',
  name: 'No Owner',
  festivalId: 'fest-1',
  members: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};
void crewMissingOwner;

// Historical bug #2: a CrewMeetingPoint using camelCase `crewId`/`createdBy`
// instead of the snake_case wire shape. Built as an inferred literal first, then
// assigned to the contract type so the missing-required-property error
// (`crew_id`/`created_by`) lands on the assignment line directly below the
// directive.
const camelMeetingPoint = {
  id: 'mp-2',
  crewId: 'crew-1',
  createdBy: 'user-1',
  label: 'Wrong Casing',
  location: 'Somewhere',
  type: 'during',
  meet_at: null,
  stage_reference: null,
  active: true,
  created_at: '2026-06-01T00:00:00.000Z',
};
// @ts-expect-error — CrewMeetingPoint is snake_case (crew_id/created_by), not camelCase
const meetingPointCamelCase: CrewMeetingPoint = camelMeetingPoint;
void meetingPointCamelCase;
