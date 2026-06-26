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
// Festival LIST item — GET /festivals summary (routes/festivals.ts router.get('/'))
// ════════════════════════════════════════════════════════════════════════════

/**
 * One row of the cached festival LIST (the picker payload). NARROWER than the
 * full/depth-1 festival document: identity + `location` (COALESCEd to '' so it
 * is a plain string), the derived `stageCount`/`dayCount` (never null —
 * `?.length || 0`), and the date range derived from the day dates. `startDate`/
 * `endDate` are `dates[0]`/`dates[at-1] || null` (null when the festival has no
 * dated days), as ISO `YYYY-MM-DD` strings.
 */
export const festivalListItemResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  stageCount: z.number(),
  dayCount: z.number(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});
export type FestivalListItemResponse = z.infer<typeof festivalListItemResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// Profile — serializeOwnProfile()/serializeProfileForViewer() (lib/helpers/export-utils.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A single pick's priority. The three allowed values mirror
 * `ALLOWED_PICK_PRIORITIES` (lib/constants.ts) and the request-side
 * `normalizePickPayload` filter. Exported standalone (the "Pick" entity) and
 * reused as the value type of the profile `picks` map.
 */
export const pickPriorityResponseSchema = z.enum(['must', 'want-to-see', 'maybe']);
export type PickPriorityResponse = z.infer<typeof pickPriorityResponseSchema>;

/**
 * A festival participation profile as serialized to a CLIENT. Models the VIEWER
 * superset (`serializeProfileForViewer`): identity, `avatarUrl` (null until the
 * owner has both avatarKey + avatarVersion), the public `picks` map (setId →
 * priority), and timestamps. `userId` is nullable because an unclaimed orphan
 * profile (imported lineup, no account yet) carries `user_id = NULL`.
 *
 * `notes` (setId → free text, the "Note" entity) and `reminders` (setId →
 * lead-minutes integer) are PRIVATE: present only on the requester's OWN
 * profile (both `serializeOwnProfile` and the viewer serializer's
 * self-branch) — hence `.optional()`. Default Zod strips unknown keys so a
 * viewer payload (which omits them) and an own payload (which includes them)
 * both parse.
 */
export const profileResponseSchema = z.object({
  id: z.string(),
  festivalId: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  picks: z.record(z.string(), pickPriorityResponseSchema),
  notes: z.record(z.string(), z.string()).optional(),
  reminders: z.record(z.string(), z.number()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// CrewPoll — polls.listByCrew()/create()/close() (lib/db/stores/polls.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * One vote inside a poll's `votes` array as emitted by `polls.listByCrew`
 * (`json_agg(json_build_object('option', v.option_index, 'user_id', v.user_id))`).
 * Because the underlying join is a LEFT JOIN, a poll with NO votes still emits a
 * single element with BOTH fields null — hence both are `.nullable()`.
 */
export const crewPollVoteResponseSchema = z.object({
  option: z.number().nullable(),
  user_id: z.string().nullable(),
});
export type CrewPollVoteResponse = z.infer<typeof crewPollVoteResponseSchema>;

/**
 * A crew poll. Snake_case straight from Postgres. `options` is the JSONB choice
 * array (always an array — the store COALESCEs a string back to []). `closes_at`
 * is the optional auto-close deadline (null = open until manually closed),
 * `closed` the manual flag. The aggregate `vote_count` (COUNT → bigint, which
 * node-postgres returns as a STRING) and the `votes` array are present ONLY on
 * the LIST endpoint; `create`/`close`/`getById` omit them — hence `.optional()`.
 * Route wraps as `{ poll }` (create) or `{ polls: [...] }` (list).
 */
export const crewPollResponseSchema = z.object({
  id: z.string(),
  crew_id: z.string(),
  created_by: z.string(),
  question: z.string(),
  options: z.array(z.string()),
  closes_at: z.string().nullable(),
  closed: z.boolean(),
  created_at: z.string(),
  vote_count: z.string().optional(),
  votes: z.array(crewPollVoteResponseSchema).optional(),
});
export type CrewPollResponse = z.infer<typeof crewPollResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// CrewExpense — expenses.getByCrew()/create() (lib/db/stores/expenses.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A crew expense ledger row. Snake_case from Postgres. `amount` is a NUMERIC
 * column, which node-postgres returns as a STRING (never coerced server-side on
 * read), so it crosses the wire as a string. `split_with` is the parsed JSONB
 * member-id array (empty = split across the whole crew). `planned` marks a
 * forecast/budget row excluded from the live ledger. `paid_by_name` (joined
 * username) is present ONLY on the LIST endpoint — `create`/settle/`getById`
 * omit it — hence `.optional()`.
 */
export const crewExpenseResponseSchema = z.object({
  id: z.string(),
  crew_id: z.string(),
  paid_by: z.string(),
  description: z.string(),
  amount: z.string(),
  split_with: z.array(z.string()),
  category: z.string(),
  planned: z.boolean(),
  created_at: z.string(),
  paid_by_name: z.string().optional(),
});
export type CrewExpenseResponse = z.infer<typeof crewExpenseResponseSchema>;

/**
 * A single member's net dollar position in the ledger, as emitted by the
 * settlement-plan/`/balances` endpoints (`balanceCents / 100` → a JS number).
 */
export const crewBalanceResponseSchema = z.object({
  userId: z.string(),
  username: z.string(),
  balance: z.number(),
});
export type CrewBalanceResponse = z.infer<typeof crewBalanceResponseSchema>;

/**
 * One directed transfer in the netted settlement plan. `amountCents` is the
 * integer-cent source of truth; `amount` is its dollar projection. `payeeHandles`
 * carries ONLY the payee's payment handles (each null when unset) so a client
 * can build prefilled pay links without leaking the whole roster's handles.
 */
export const crewSettlementResponseSchema = z.object({
  fromUserId: z.string(),
  fromName: z.string(),
  toUserId: z.string(),
  toName: z.string(),
  amountCents: z.number(),
  amount: z.number(),
  payeeHandles: z.object({
    venmo: z.string().nullable(),
    cashapp: z.string().nullable(),
    paypal: z.string().nullable(),
  }),
});
export type CrewSettlementResponse = z.infer<typeof crewSettlementResponseSchema>;

/**
 * The settlement-plan response body: the dollar `balances` (mirroring
 * `/balances`) plus the greedy min-cash-flow `settlements`.
 */
export const crewSettlementPlanResponseSchema = z.object({
  balances: z.array(crewBalanceResponseSchema),
  settlements: z.array(crewSettlementResponseSchema),
});
export type CrewSettlementPlanResponse = z.infer<typeof crewSettlementPlanResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// CrewPackingItem — crewPacking.listByCrew()/create()/update() (lib/db/stores/crews.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A crew packing-board row ("who's bringing what"). Snake_case from Postgres.
 * `brought_by` is the optional free-text owner (null when unclaimed); `claimed`
 * the boolean checkbox. `creator_name` (joined username) is present ONLY on the
 * LIST endpoint — `create`/`update`/`getById` omit it — hence `.optional()`.
 * Route wraps as `{ item }` / `{ items: [...] }`.
 */
export const crewPackingItemResponseSchema = z.object({
  id: z.string(),
  crew_id: z.string(),
  created_by: z.string(),
  label: z.string(),
  brought_by: z.string().nullable(),
  claimed: z.boolean(),
  created_at: z.string(),
  creator_name: z.string().optional(),
});
export type CrewPackingItemResponse = z.infer<typeof crewPackingItemResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// CrewRideOffer — crewRides.listByCrew()/create()/update() (lib/db/stores/crews.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A crew carpool board row ("who's driving"). Snake_case from Postgres. Every
 * descriptive field is optional-at-create and therefore `.nullable()`:
 * `driver`, `seats` (integer → number), `depart_from`, `depart_at` (the stored
 * departure string), and `note`. `creator_name` (joined username) is present
 * ONLY on the LIST endpoint — hence `.optional()`. Route wraps as
 * `{ offer }` / `{ offers: [...] }`.
 */
export const crewRideOfferResponseSchema = z.object({
  id: z.string(),
  crew_id: z.string(),
  created_by: z.string(),
  driver: z.string().nullable(),
  seats: z.number().nullable(),
  depart_from: z.string().nullable(),
  depart_at: z.string().nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
  creator_name: z.string().optional(),
});
export type CrewRideOfferResponse = z.infer<typeof crewRideOfferResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// CrewMemberStatus — crewStatus.upsert()/listByCrew() (lib/db/stores/crews.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A crew member's last-synced status snapshot (offline-DEGRADED, NOT live GPS).
 * Snake_case from Postgres. `status`/`target_meeting_point_id`/`eta_minutes`
 * (integer → number)/`note` are all nullable (a status-only update clears the
 * ETA). `latitude`/`longitude`/`location_captured_at` are the optional offline
 * presence breadcrumb (null when never captured). The joined identity fields
 * (`username`, `name` ⇐ display_name, `avatar_key`, `avatar_version`) are
 * present ONLY on the LIST endpoint — `upsert` returns the bare row — hence
 * `.optional()` (and `name`/`avatar_*` additionally `.nullable()`). Route wraps
 * as `{ status }` / `{ statuses: [...] }`.
 */
export const crewMemberStatusResponseSchema = z.object({
  crew_id: z.string(),
  user_id: z.string(),
  status: z.string().nullable(),
  target_meeting_point_id: z.string().nullable(),
  eta_minutes: z.number().nullable(),
  note: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  location_captured_at: z.string().nullable(),
  updated_at: z.string(),
  username: z.string().optional(),
  name: z.string().nullable().optional(),
  avatar_key: z.string().nullable().optional(),
  avatar_version: z.string().nullable().optional(),
});
export type CrewMemberStatusResponse = z.infer<typeof crewMemberStatusResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// CrewActivityEntry — activity.getByCrew() (lib/db/stores/activity.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * One crew activity-feed row. Snake_case from Postgres + the joined `username`.
 * `detail` is the optional human string (null for detail-less events). Route
 * wraps as `{ items: [...], nextCursor }`.
 */
export const crewActivityEntryResponseSchema = z.object({
  id: z.string(),
  crew_id: z.string(),
  user_id: z.string(),
  type: z.string(),
  detail: z.string().nullable(),
  created_at: z.string(),
  username: z.string(),
});
export type CrewActivityEntryResponse = z.infer<typeof crewActivityEntryResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// NotificationPrefs — notificationPrefs.get() (lib/db/stores/notifications.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * A user's notification preferences. The six category toggles are stored as
 * INTEGER (DEFAULT 1) columns and surfaced AS-IS — i.e. as `0`/`1` NUMBERS, not
 * booleans (the GET serializer never coerces, and a missing row defaults each
 * to the integer `1`). `dndStart`/`dndEnd` are the optional quiet-hours window
 * as `HH:MM` strings (null when unset). Route returns the object directly.
 */
export const notificationPrefsResponseSchema = z.object({
  userId: z.string(),
  crewUpdates: z.number(),
  setReminders: z.number(),
  scheduleChanges: z.number(),
  lineupDrops: z.number(),
  crewReformed: z.number(),
  wrapReady: z.number(),
  dndStart: z.string().nullable(),
  dndEnd: z.string().nullable(),
});
export type NotificationPrefsResponse = z.infer<typeof notificationPrefsResponseSchema>;

// ════════════════════════════════════════════════════════════════════════════
// Auth envelope — routes/auth.ts (register/login/me/refresh-token)
// ════════════════════════════════════════════════════════════════════════════

/**
 * The shared auth response envelope. Every auth success wraps the public
 * `user` (serializePublicUser → userResponseSchema). `token` and `refreshToken`
 * are present ONLY when the client opts into body tokens (the
 * `wantsBodyTokens` branch — native clients that can't use the httpOnly
 * cookie); the cookie path omits both — hence `.optional()`. This single shape
 * backs register (201), login, /me, and refresh-token (RefreshTokenResponse).
 */
export const authEnvelopeResponseSchema = z.object({
  user: userResponseSchema,
  token: z.string().optional(),
  refreshToken: z.string().optional(),
});
export type AuthEnvelopeResponse = z.infer<typeof authEnvelopeResponseSchema>;

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
  // Phase 2 — breadth: the remaining serialized entities.
  festivalListItem: festivalListItemResponseSchema,
  pickPriority: pickPriorityResponseSchema,
  profile: profileResponseSchema,
  crewPoll: crewPollResponseSchema,
  crewPollVote: crewPollVoteResponseSchema,
  crewExpense: crewExpenseResponseSchema,
  crewSettlementPlan: crewSettlementPlanResponseSchema,
  crewPackingItem: crewPackingItemResponseSchema,
  crewRideOffer: crewRideOfferResponseSchema,
  crewMemberStatus: crewMemberStatusResponseSchema,
  crewActivityEntry: crewActivityEntryResponseSchema,
  notificationPrefs: notificationPrefsResponseSchema,
  authEnvelope: authEnvelopeResponseSchema,
};
