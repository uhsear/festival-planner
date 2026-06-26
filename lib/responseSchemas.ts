// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * RESPONSE Zod schemas — OUTPUT shapes (Phase 1).
 *
 * These describe what the backend ACTUALLY serializes onto the wire, i.e. what a
 * client RECEIVES, NOT what it sends. They are the response-side counterpart of
 * the request validators in `lib/schemas.ts`, and the runtime/test-checkable
 * source of truth behind the hand-written RESPONSE interfaces in
 * `packages/shared/src/types/domain.ts` (the "as serialized by the backend"
 * drift surface).
 *
 * MODELLED FROM THE REAL SERIALIZERS — read these before changing a field:
 *   - User .................. serializePublicUser()           lib/helpers.ts
 *   - Festival (depth-1) .... GET /festivals/:id?depth=1      routes/festivals.ts
 *   - Festival (full) ....... festivals.getById() SELECT      lib/db/stores/festivals.ts
 *   - Stage / Set / Artist .. json_build_object in getById    lib/db/stores/festivals.ts
 *   - Crew / CrewMember ..... serializeCrewWithMembers()      routes/crews.ts
 *   - MeetingPoint .......... meetingPoints.create/listByCrew lib/db/stores/crews.ts
 *
 * ADDITIVE ONLY: this file introduces no runtime behaviour and changes no
 * request schema. It exists to be imported by docs/tests/typegen. Postgres
 * `timestamptz` columns arrive as JS `Date`s in-process but cross the wire as
 * ISO strings (res.json → JSON.stringify), so every timestamp here is a
 * `z.string()` — the OUTPUT a client decodes.
 *
 * NULLABILITY POLICY: a field is `.nullable()` when the underlying serializer /
 * SQL column can emit `null` (legacy rows, `?? null` fall-throughs, COALESCE to
 * NULL). Default Zod object behaviour STRIPS unknown keys (it does not reject
 * them), so these stay forward-compatible with additively-serialized fields.
 */

import { z } from 'zod';

import { festivalMapConfigSchema } from './schemas';

// ════════════════════════════════════════════════════════════════════════════
// User — serializePublicUser() → PublicUser (lib/helpers.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * The public-safe user projection emitted by `serializePublicUser` and wrapped
 * as `{ user }` on every auth/account response. Intentionally OMITS
 * createdAt/updatedAt/isAdmin (server-internal). `avatarUrl` is null until the
 * user has both an avatarKey + avatarVersion; `name` is the editable display
 * name (null ⇒ client falls back to `username`); the payment handles are null
 * when unset.
 */
export const userResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  venmoHandle: z.string().nullable(),
  cashappCashtag: z.string().nullable(),
  paypalHandle: z.string().nullable(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// Festival sub-entities — Stage, Artist, Set
// ════════════════════════════════════════════════════════════════════════════

/**
 * A stage as serialized inside the festival document (festivals.getById
 * json_build_object, and re-emitted verbatim at depth=1). `latitude`/`longitude`
 * are the optional map pin (degrees), null when the stage was never mapped.
 * `color` is the hex swatch (sanitize defaults it to '#666666', but a legacy
 * row's column may still be null).
 */
export const stageResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type StageResponse = z.infer<typeof stageResponseSchema>;

/**
 * One artist inside a set's `artists` JSONB array (normalizeSetArtists shape):
 * a `name` plus an optional platform→url `links` map. Unknown keys are stripped
 * by default, so older rows carrying extra fields still parse.
 */
export const artistResponseSchema = z.object({
  name: z.string(),
  links: z.record(z.string(), z.string()).optional(),
});
export type ArtistResponse = z.infer<typeof artistResponseSchema>;

/**
 * A festival SET as serialized in the FULL (depth=2 / getById) festival
 * document: id, the flat `artist` display string (backward-compat), the
 * structured `artists[]`, `stageId`, `startTime`/`endTime` (HH:MM or null), and
 * the spotify-ish `linkUrl`. NOTE this is NARROWER than the shared
 * `FestivalSet` domain interface (which also lists festivalId/date/dayIndex/
 * createdAt/updatedAt) — those are NOT serialized here. `artists` is COALESCEd
 * to `[]` so it is always an array.
 */
export const festivalSetResponseSchema = z.object({
  id: z.string(),
  artist: z.string().nullable(),
  artists: z.array(artistResponseSchema),
  stageId: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  linkUrl: z.string().nullable(),
});
export type FestivalSetResponse = z.infer<typeof festivalSetResponseSchema>;

// The depth=1 set is the same minus `linkUrl` (the route's L1 mapper drops it).
const festivalDepth1SetSchema = festivalSetResponseSchema.omit({ linkUrl: true });

const festivalDepth1DaySchema = z.object({
  label: z.string(),
  date: z.string(),
  sets: z.array(festivalDepth1SetSchema),
});

// The full (depth=2) day additionally carries `dayIndex` and linkUrl-bearing sets.
const festivalFullDaySchema = z.object({
  dayIndex: z.number(),
  label: z.string(),
  date: z.string(),
  sets: z.array(festivalSetResponseSchema),
});

// ════════════════════════════════════════════════════════════════════════════
// Festival — GET /festivals/:id (depth=1 overview and depth=2 full)
// ════════════════════════════════════════════════════════════════════════════

/**
 * The L1 structural overview returned by `GET /festivals/:id?depth=1`: identity,
 * stages (with map pins), days with set names/times (no linkUrl, no dayIndex),
 * the optional `mapConfig` (reusing the request validator's strict shape, since
 * the persisted value was validated by it; null ⇒ "not mapped yet"), and the
 * timestamps. `location` is COALESCEd to '' server-side, so it is a plain string.
 */
export const festivalDepth1ResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  stages: z.array(stageResponseSchema),
  days: z.array(festivalDepth1DaySchema),
  mapConfig: festivalMapConfigSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FestivalDepth1Response = z.infer<typeof festivalDepth1ResponseSchema>;

/**
 * The FULL festival document (depth=2 / omitted depth) — the raw `getById` row.
 * Superset of depth-1: adds `b2bSeparator`, the optional `timeZone`, `dayIndex`
 * on each day, and `linkUrl` on each set.
 */
export const festivalResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  b2bSeparator: z.string(),
  timeZone: z.string().nullable(),
  mapConfig: festivalMapConfigSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stages: z.array(stageResponseSchema),
  days: z.array(festivalFullDaySchema),
});
export type FestivalResponse = z.infer<typeof festivalResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// Crew — serializeCrewWithMembers() (routes/crews.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A crew member as emitted by `serializeCrewWithMembers`. `name` mirrors the
 * `username` (the route uses the handle as the display name); avatar fields are
 * null when unset; `role` is owner|member.
 */
export const crewMemberResponseSchema = z.object({
  userId: z.string(),
  username: z.string(),
  name: z.string(),
  avatarKey: z.string().nullable(),
  avatarVersion: z.string().nullable(),
  role: z.enum(['owner', 'member']),
  joinedAt: z.string().optional(),
});
export type CrewMemberResponse = z.infer<typeof crewMemberResponseSchema>;

/**
 * A crew as emitted by `serializeCrewWithMembers`. `owner` and `createdBy` are
 * the same value (the latter kept for backward compat). Totem fields are
 * snake_cased ON THE WIRE (the only snake keys on this otherwise-camelCase
 * object). The membership-conditional fields (`role`, `joinedAt`) appear only
 * when the requester is a member; the owner-only fields (`inviteCode`,
 * `inviteExpiresAt`) only when their role is owner — hence all `.optional()`.
 * When the serializer is called with a null requester (the broadcast path),
 * `inviteCode` is additionally deleted before emit.
 */
export const crewResponseSchema = z.object({
  id: z.string(),
  festivalId: z.string(),
  name: z.string(),
  owner: z.string(),
  createdBy: z.string(),
  maxMembers: z.number().optional(),
  reformedFrom: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  homeBaseLocation: z.string().nullable(),
  homeBaseTime: z.string().nullable(),
  homeBaseUpdatedAt: z.string().nullable(),
  photoAlbumUrl: z.string().nullable(),
  totem_name: z.string().nullable(),
  totem_emoji: z.string().nullable(),
  // Membership-conditional (present when the requester is a member):
  role: z.enum(['owner', 'member']).optional(),
  joinedAt: z.string().optional(),
  // Owner-only:
  inviteCode: z.string().optional(),
  inviteExpiresAt: z.string().nullable().optional(),
  // Added by serializeCrewWithMembers:
  members: z.array(crewMemberResponseSchema),
  memberCount: z.number(),
});
export type CrewResponse = z.infer<typeof crewResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// MeetingPoint — meetingPoints.create()/listByCrew() (lib/db/stores/crews.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A crew meeting point row as serialized by the store (snake_case straight from
 * Postgres). Wrapped on the route as `{ meetingPoint }` (create/update) or
 * `{ meetingPoints: [...] }` (list); this models the ENTITY. `creator_name` (a
 * joined username) is present ONLY on the list endpoint — hence optional.
 * `meet_at`/`expires_at` are nullable timestamps; `latitude`/`longitude` are the
 * optional captured GPS coords (null for legacy free-text points).
 */
export const meetingPointResponseSchema = z.object({
  id: z.string(),
  crew_id: z.string(),
  created_by: z.string(),
  label: z.string(),
  location: z.string(),
  type: z.string(),
  meet_at: z.string().nullable(),
  stage_reference: z.string().nullable(),
  expires_at: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  recurs_daily: z.boolean(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  creator_name: z.string().optional(),
});
export type MeetingPointResponse = z.infer<typeof meetingPointResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// Bundle — mirrors the `schemas` namespace style in lib/schemas.ts
// ════════════════════════════════════════════════════════════════════════════

export const responseSchemas = {
  user: userResponseSchema,
  stage: stageResponseSchema,
  artist: artistResponseSchema,
  festivalSet: festivalSetResponseSchema,
  festivalDepth1: festivalDepth1ResponseSchema,
  festival: festivalResponseSchema,
  crew: crewResponseSchema,
  crewMember: crewMemberResponseSchema,
  meetingPoint: meetingPointResponseSchema,
};
