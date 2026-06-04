// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Zod Validation Schemas for All API Endpoints
 *
 * Usage:
 *   const validation = schemas.registerSchema.safeParse(req.body);
 *   if (!validation.success) return sendError(res, 400, validation.error.message);
 *
 * Coverage:
 *   - Authentication (register, login, password change, admin)
 *   - Profiles (picks, notes, reminders, live status)
 *   - Notifications (push tokens, preferences, marks)
 *   - Festivals (creation via routes/festivals.js)
 *   - Socket events (validated in routes/socket.js)
 *   - Crews (create, update, join, transfer operations)
 *
 * Validation flow: Express route → schema.safeParse() → sendError() or processData()
 *
 * NOTE: Inline validation in routes (checks for length, type, range) should use
 * schema validation instead. Patterns to consolidate in future:
 *   • Array.isArray() + length checks → zod.array()
 *   • String length checks → z.string().min().max()
 *   • Regex patterns → z.string().regex()
 *   • Numeric bounds → z.number().min().max()
 * This keeps validation rules centralized and ensures consistency.
 */

import { z } from 'zod';
import {
  PICK_PRIORITY_VALUES,
  REMINDER_MINUTE_VALUES,
  ALLOWED_LINK_PLATFORMS,
  MAX_ARTISTS_PER_SET,
  MEETING_POINT_TYPES,
  ALLOWED_PICK_PRIORITIES,
  ALLOWED_REMINDER_MINUTES,
} from './constants';
import { sanitizeString, normalizeRecordKey, sanitizeIdentifier, validateTime, validateColor } from './helpers';
import { sendError, ErrorCodes } from './response';

// ════════════════════════════════════════════════════════════════════════════════
// Reusable Primitives
// ════════════════════════════════════════════════════════════════════════════════

const username = z.string().trim().min(1).max(40);
const password = z.string().min(8).max(200);
const identifier = z.string().min(1).max(100);
const shortText = z.string().max(1000);

// ════════════════════════════════════════════════════════════════════════════════
// Authentication Schemas
// ════════════════════════════════════════════════════════════════════════════════
const email = z.string().email('Invalid email address').max(254).optional().or(z.literal(''));

export const registerSchema = z
  .object({
    username,
    password,
    confirmPassword: z.string(),
    email: email.optional(),
    tosAccepted: z.literal(true, { error: 'You must accept the Terms of Service' }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  username: z.string().min(1, 'Username required').max(40),
  password: z.string().min(1, 'Password required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password required'),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ════════════════════════════════════════════════════════════════════════════════
// Profile & Festival Participation Schemas
// ════════════════════════════════════════════════════════════════════════════════

const pickValue = z.enum(PICK_PRIORITY_VALUES);
const picksMap = z.record(z.string().max(100), pickValue).optional();
const notesMap = z.record(z.string().max(100), shortText).optional();
const allowedReminderMinutes = z.union(REMINDER_MINUTE_VALUES.map((m: any) => z.literal(m)) as any);
const remindersMap = z.record(z.string().max(100), allowedReminderMinutes).optional();

export const profileUpdateSchema = z
  .object({
    picks: picksMap,
    notes: notesMap,
    reminders: remindersMap,
  })
  .refine((d) => Object.keys(d).some((k) => (d as any)[k] !== undefined), {
    message: 'At least one field required',
  });
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const joinFestivalSchema = z.object({
  festivalId: identifier,
});
export type JoinFestivalInput = z.infer<typeof joinFestivalSchema>;

// ════════════════════════════════════════════════════════════════════════════════
// Admin Schemas
// ════════════════════════════════════════════════════════════════════════════════

export const resetPasswordSchema = z.object({
  newPassword: password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const resetPasswordPublicSchema = z.object({
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'Invalid token')
    .max(64),
  newPassword: password,
  confirmPassword: z.string().min(8).max(100),
});
export type ResetPasswordPublicInput = z.infer<typeof resetPasswordPublicSchema>;

// ════════════════════════════════════════════════════════════════════════════════
// Notification & Push Schemas
// ════════════════════════════════════════════════════════════════════════════════
const dndTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)')
  .nullable();
export const notificationPrefsSchema = z
  .object({
    crewUpdates: z.boolean().optional(),
    setReminders: z.boolean().optional(),
    scheduleChanges: z.boolean().optional(),
    lineupDrops: z.boolean().optional(),
    crewReformed: z.boolean().optional(),
    wrapReady: z.boolean().optional(),
    dndStart: dndTime.optional(),
    dndEnd: dndTime.optional(),
  })
  .strict();
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

export const pushTokenSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['web', 'ios', 'android']).default('web'),
  deviceName: z.string().max(60).optional().nullable(),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

// ── Additional notification schemas ──────────────────────────────
export const deleteTokenSchema = z.object({
  token: z.string().min(1, 'Token required').max(4096),
});
export type DeleteTokenInput = z.infer<typeof deleteTokenSchema>;

export const markReadSchema = z.object({
  festivalId: z.string().max(100).optional(),
});
export type MarkReadInput = z.infer<typeof markReadSchema>;

// ── Topic subscription schema ────────────────────────────────────
export const topicSubscriptionSchema = z
  .record(z.string(), z.boolean())
  .refine((d) => Object.keys(d).length > 0 && Object.keys(d).length <= 10, {
    message: 'At least one topic required, max 10',
  });
export type TopicSubscriptionInput = z.infer<typeof topicSubscriptionSchema>;

// ── Account schemas ───────────────────────────────────────────────
export const usernameChangeSchema = z.object({
  username: z.string().trim().min(1, 'Username required').max(40),
});
export type UsernameChangeInput = z.infer<typeof usernameChangeSchema>;

// Editable display name (friendly name). Username stays the immutable @handle.
export const displayNameChangeSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name required').max(50),
});
export type DisplayNameChangeInput = z.infer<typeof displayNameChangeSchema>;

// Payment handles for settle-up deep links. All optional; an explicit empty
// string clears the handle (stored as NULL). Handles are short identifiers, not
// URLs — the deep-link builders prepend the scheme/host. A leading '@' or '$'
// is tolerated and normalized server-side.
const paymentHandle = z.string().trim().max(64).optional();
export const paymentHandlesSchema = z
  .object({
    venmoHandle: paymentHandle,
    cashappCashtag: paymentHandle,
    paypalHandle: paymentHandle,
  })
  .refine((v) => v.venmoHandle !== undefined || v.cashappCashtag !== undefined || v.paypalHandle !== undefined, {
    message: 'At least one payment handle is required',
  });
export type PaymentHandlesInput = z.infer<typeof paymentHandlesSchema>;

export const accountDeleteSchema = z.object({
  password: z.string().min(1, 'Password confirmation required'),
});
export type AccountDeleteInput = z.infer<typeof accountDeleteSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email('Valid email required').max(254),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const updateEmailSchema = z.object({
  email: z.string().email('Valid email required').max(254),
  password: z.string().min(1, 'Password confirmation required'),
});
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;

// ── Festival schemas (admin) ───────────────────────────────────────
export const stageSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/)
    .optional(),
});
export type StageInput = z.infer<typeof stageSchema>;

export const artistLinkSchema = z.object({
  name: z.string().min(1).max(300),
  links: z
    .record(z.enum(ALLOWED_LINK_PLATFORMS), z.string().url().max(500).or(z.literal('')).optional().nullable())
    .optional()
    .default({} as Record<string, string | null | undefined>)
    .transform((obj: any) =>
      Object.fromEntries(Object.entries(obj || {}).filter(([, v]: any) => v != null && v !== '')),
    ),
});
export type ArtistLinkInput = z.infer<typeof artistLinkSchema>;

export const setSchema = z
  .object({
    id: z.string().max(100).optional(),
    artists: z.array(artistLinkSchema).min(1).max(MAX_ARTISTS_PER_SET).optional(),
    // Backward compat — old clients may still send artist/linkUrl
    artist: z.string().max(300).optional(),
    stageId: z.string().max(100).optional().nullable(),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional()
      .nullable()
      .or(z.literal('')),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional()
      .nullable()
      .or(z.literal('')),
    linkUrl: z.string().max(500).optional().nullable().or(z.literal('')),
  })
  .refine((d) => (d.artists?.length ?? 0) > 0 || (d.artist && d.artist.length > 0), {
    message: 'At least one artist is required (via artists[] or artist)',
  });
export type SetInput = z.infer<typeof setSchema>;

export const daySchema = z.object({
  label: z.string().max(100).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sets: z.array(setSchema).optional(),
});
export type DayInput = z.infer<typeof daySchema>;

export const festivalCreateSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  location: z.string().max(500).optional(),
  b2bSeparator: z.string().max(10).optional(),
  stages: z.array(stageSchema).max(20).optional(),
  days: z.array(daySchema).max(10).optional(),
});
export type FestivalCreateInput = z.infer<typeof festivalCreateSchema>;

export const festivalUpdateSchema = festivalCreateSchema
  .partial()
  .refine((d) => Object.keys(d).some((k) => (d as any)[k] !== undefined), 'At least one field required');
export type FestivalUpdateInput = z.infer<typeof festivalUpdateSchema>;

// ── Crew schemas ─────────────────────────────────────────────────────
export const crewCreateSchema = z.object({
  name: z.string().trim().min(1, 'Crew name required').max(60),
  festivalId: identifier,
});
export type CrewCreateInput = z.infer<typeof crewCreateSchema>;

export const crewUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    maxMembers: z.number().int().min(2).max(30).optional(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as any)[k] !== undefined), {
    message: 'At least one field required',
  });
export type CrewUpdateInput = z.infer<typeof crewUpdateSchema>;

export const crewJoinSchema = z.object({
  inviteCode: z.string().trim().min(4).max(12),
});
export type CrewJoinInput = z.infer<typeof crewJoinSchema>;

// Reform a crew into a NEW crew in the target festival (M3). Crews are
// festival-scoped, so "reform" = create a new crew in `targetFestivalId` +
// invite the prior roster. `:crewId` (the source crew) comes from the path.
export const crewReformSchema = z.object({
  targetFestivalId: identifier,
});
export type CrewReformInput = z.infer<typeof crewReformSchema>;

export const crewTransferSchema = z.object({
  userId: identifier,
});
export type CrewTransferInput = z.infer<typeof crewTransferSchema>;

export const crewAddMemberSchema = z.object({
  userId: identifier,
});
export type CrewAddMemberInput = z.infer<typeof crewAddMemberSchema>;

// ── Set link schema (admin) ──────────────────────────────────────
export const setLinkSchema = z.object({
  linkUrl: z.string().url('Must be a valid URL').max(500).nullable().optional().or(z.literal('')),
});
export type SetLinkInput = z.infer<typeof setLinkSchema>;

// ── Meeting Point schemas (Phase 1B) ────────────────────────────

export const meetingPointCreateSchema = z.object({
  label: z.string().trim().min(1, 'Label required').max(100),
  location: z.string().trim().min(1, 'Location required').max(200),
  type: z.enum(MEETING_POINT_TYPES).default('during'),
  meetAt: z.string().datetime().optional().nullable(),
  stageReference: z.string().max(100).optional().nullable(),
  // F4: optional captured GPS coords (browser/native geolocation). Nullable —
  // legacy free-text points omit these and keep NULL coords server-side.
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});
export type MeetingPointCreateInput = z.infer<typeof meetingPointCreateSchema>;

export const meetingPointUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    location: z.string().trim().min(1).max(200).optional(),
    type: z.enum(MEETING_POINT_TYPES).optional(),
    meetAt: z.string().datetime().optional().nullable(),
    stageReference: z.string().max(100).optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as any)[k] !== undefined), {
    message: 'At least one field required',
  });
export type MeetingPointUpdateInput = z.infer<typeof meetingPointUpdateSchema>;

// ── Validation middleware factory ───────────────────────────────────
export function validate(schema: z.ZodType<any>) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0]!;
      const message =
        firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : firstIssue.message;
      return sendError(res, 400, message, ErrorCodes.VALIDATION_ERROR, {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

/**
 * Middleware factory for query-string validation via Zod.
 * Parses req.query and stores the result in req.validatedQuery.
 */
export function validateQuery(schema: z.ZodType<any>) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const firstIssue = result.error.issues[0]!;
      const message =
        firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : firstIssue.message;
      return sendError(res, 400, message, ErrorCodes.VALIDATION_ERROR, {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

/**
 * Middleware factory for URL params validation via Zod.
 * Parses req.params and stores the result in req.validatedParams.
 */
export function validateParams(schema: z.ZodType<any>) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const firstIssue = result.error.issues[0]!;
      const message =
        firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : firstIssue.message;
      return sendError(res, 400, message, ErrorCodes.VALIDATION_ERROR, {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.validatedParams = result.data;
    next();
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// Payload Normalizers (consolidated from lib/validation.js)
// ════════════════════════════════════════════════════════════════════════════════

const _MAX_ARTISTS = MAX_ARTISTS_PER_SET;

/**
 * Derive a display name from an artists array using the festival's b2b separator.
 * @param artists - Array of { name, links } objects
 * @param separator - B2B separator string (default: 'b2b')
 * @returns Display name like "DJ Alpha b2b DJ Beta"
 */
export function artistDisplayName(artists: any[], separator = 'b2b'): string {
  if (!artists?.length) return 'Unknown';
  return artists.map((a: any) => a.name).join(` ${separator} `);
}

/**
 * Normalize a set's artist data — accepts both old (artist+linkUrl) and new (artists[]) formats.
 * Always returns a normalized artists array.
 */
export function normalizeSetArtists(set: any): any[] {
  if (set.artists?.length > 0) {
    return set.artists
      .slice(0, _MAX_ARTISTS)
      .map((a: any) => ({
        name: sanitizeString(a.name || '', 300),
        links: sanitizeLinkRecord(a.links),
      }))
      .filter((a: any) => a.name);
  }
  // Backward compat: convert old artist + linkUrl to artists[]
  const name = sanitizeString(set.artist || '', 300);
  if (!name) return [];
  const links: Record<string, string> = {};
  const rawUrl = set.linkUrl && typeof set.linkUrl === 'string' ? set.linkUrl.trim() : '';
  if (rawUrl && /^https?:\/\//.test(rawUrl)) links.spotify = rawUrl.slice(0, 500);
  return [{ name, links }];
}

export function sanitizeLinkRecord(links: any): Record<string, string> {
  if (!links || typeof links !== 'object') return {};
  const clean: Record<string, string> = {};
  for (const [platform, url] of Object.entries(links)) {
    if (typeof url !== 'string' || !url.trim()) continue;
    const trimmed = url.trim().slice(0, 500);
    if (/^https?:\/\//.test(trimmed)) clean[platform] = trimmed;
  }
  return clean;
}

export function normalizePickPayload(input: any, config: any): { error?: string; value?: any } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid picks format' };
  }
  const entries = Object.entries(input);
  if (entries.length > config.MAX_PICKS) {
    return { error: 'Too many picks' };
  }
  const picks = Object.create(null);
  for (const [rawSetId, priority] of entries) {
    const setId = normalizeRecordKey(rawSetId, 100);
    if (!setId) return { error: 'Invalid pick key' };
    if (!ALLOWED_PICK_PRIORITIES.has(priority as any)) {
      return { error: `Invalid priority: ${priority}` };
    }
    picks[setId] = priority;
  }
  return { value: picks };
}

export function normalizeNotePayload(input: any, config: any): { error?: string; value?: any } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid notes format' };
  }
  const entries = Object.entries(input);
  if (entries.length > config.MAX_NOTES) {
    return { error: 'Too many notes' };
  }
  const notes = Object.create(null);
  for (const [rawSetId, note] of entries) {
    const setId = normalizeRecordKey(rawSetId, 100);
    if (!setId) return { error: 'Invalid note key' };
    if (typeof note !== 'string') return { error: 'Note must be a string' };
    if (note.length > config.MAX_NOTE_LENGTH * 2) return { error: 'Note too long' };
    const sanitized = sanitizeString(note, config.MAX_NOTE_LENGTH);
    notes[setId] = sanitized;
  }
  return { value: notes };
}

export function normalizeReminderPayload(input: any, config: any): { error?: string; value?: any } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid reminders format' };
  }
  const entries = Object.entries(input);
  if (entries.length > config.MAX_REMINDERS) {
    return { error: 'Too many reminders' };
  }
  const reminders = Object.create(null);
  for (const [rawSetId, leadMinutes] of entries) {
    const setId = normalizeRecordKey(rawSetId, 100);
    if (!setId) return { error: 'Invalid reminder key' };
    const minutes = Number.parseInt(leadMinutes as string, 10);
    if (!ALLOWED_REMINDER_MINUTES.has(minutes)) {
      return { error: 'Invalid reminder time' };
    }
    reminders[setId] = minutes;
  }
  return { value: reminders };
}

export function sanitizeFestivalPayload(input: any, existingFestival: any, config: any, createOpaqueId: any): any {
  const now = new Date().toISOString();
  const b2bSep = sanitizeString(input.b2bSeparator ?? existingFestival?.b2bSeparator ?? 'b2b', 10) || 'b2b';
  return {
    id: existingFestival?.id || sanitizeIdentifier(input.id, 100) || createOpaqueId('fest'),
    name: sanitizeString(input.name || existingFestival?.name || ''),
    location: sanitizeString(input.location ?? existingFestival?.location ?? '', 500),
    b2bSeparator: b2bSep,
    stages: (input.stages || existingFestival?.stages || [])
      .slice(0, config.MAX_STAGES)
      .map((stage: any, index: number) => ({
        id: sanitizeIdentifier(stage.id, 100) || createOpaqueId(`stage-${index}`),
        name: sanitizeString(stage.name || '', 100),
        color: validateColor(stage.color) ? stage.color : '#666666',
      })),
    days: (input.days || existingFestival?.days || []).slice(0, config.MAX_DAYS).map((day: any) => ({
      label: sanitizeString(day.label || '', 100),
      date: sanitizeString(day.date || '', 20),
      sets: (day.sets || []).slice(0, config.MAX_SETS_PER_DAY).map((set: any, index: number) => {
        const artists = normalizeSetArtists(set);
        return {
          id: sanitizeIdentifier(set.id, 100) || createOpaqueId(`set-${index}`),
          artists,
          // Phase 1 backward compat: keep flat artist + linkUrl for rollback safety
          artist: artistDisplayName(artists, b2bSep),
          stageId: sanitizeIdentifier(set.stageId, 100) || '',
          startTime: validateTime(set.startTime) ? set.startTime : null,
          endTime: validateTime(set.endTime) ? set.endTime : null,
          linkUrl: artists[0]?.links?.spotify || null,
        };
      }),
    })),
    createdAt: existingFestival?.createdAt || now,
    updatedAt: now,
  };
}

// ── Poll Schemas ──────────────────────────────────────────────────
export const crewHomeBaseSchema = z.object({
  location: z.string().trim().max(200).optional().nullable(),
  time: z.string().trim().max(100).optional().nullable(),
});
export type CrewHomeBaseInput = z.infer<typeof crewHomeBaseSchema>;

// M6 Crew Photo Wall (Phase 1, link-out only). A single shared-album URL per
// crew (e.g. Google Photos / Apple shared album). https-only and length-bounded
// to avoid javascript:/data: schemes and oversized values; nullable / empty so
// a member can clear the link. Festie hosts no photos yet — this is a link-out.
export const crewPhotoAlbumSchema = z.object({
  photoAlbumUrl: z
    .string()
    .trim()
    .url('Must be a valid URL')
    .max(2048)
    .refine((u) => u.startsWith('https://'), 'Must be an https URL')
    .nullable()
    .optional()
    .or(z.literal('')),
});
export type CrewPhotoAlbumInput = z.infer<typeof crewPhotoAlbumSchema>;

export const pollCreateSchema = z.object({
  question: z.string().trim().min(1, 'Question required').max(500),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(4),
  closesAt: z.string().datetime().optional().nullable(),
});
export type PollCreateInput = z.infer<typeof pollCreateSchema>;

export const pollVoteSchema = z.object({
  optionIndex: z.number().int().min(0).max(3),
});
export type PollVoteInput = z.infer<typeof pollVoteSchema>;

// ── Crew packing-board schemas (M2 logistics) ───────────────────────
export const packingCreateSchema = z.object({
  label: z.string().trim().min(1, 'Label required').max(200),
  broughtBy: z.string().trim().max(100).optional().nullable(),
  claimed: z.boolean().optional(),
});
export type PackingCreateInput = z.infer<typeof packingCreateSchema>;

export const packingUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    broughtBy: z.string().trim().max(100).optional().nullable(),
    claimed: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as any)[k] !== undefined), {
    message: 'At least one field required',
  });
export type PackingUpdateInput = z.infer<typeof packingUpdateSchema>;

// ── Crew member status schema (M5: on-my-way / ETA) ─────────────────
// A last-synced, degraded-sync snapshot the member set (often offline) — NOT
// live GPS. All fields optional/nullable so a member can post just a status,
// just an ETA, or clear it. `status` is a small enum: 'on-my-way' | 'here' |
// 'delayed' | null (clear). etaMinutes is bounded (0–1440 = up to a day).
export const crewStatusSchema = z
  .object({
    status: z.enum(['on-my-way', 'here', 'delayed']).optional().nullable(),
    targetMeetingPointId: z.string().trim().max(100).optional().nullable(),
    etaMinutes: z.number().int().min(0).max(1440).optional().nullable(),
    note: z.string().trim().max(280).optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });
export type CrewStatusInput = z.infer<typeof crewStatusSchema>;

// ── Crew carpool / ride-board schemas (M2 logistics) ────────────────
export const rideCreateSchema = z.object({
  driver: z.string().trim().max(100).optional().nullable(),
  seats: z.number().int().min(0).max(99).optional().nullable(),
  departFrom: z.string().trim().max(200).optional().nullable(),
  departAt: z.string().trim().max(100).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});
export type RideCreateInput = z.infer<typeof rideCreateSchema>;

export const rideUpdateSchema = z
  .object({
    driver: z.string().trim().max(100).optional().nullable(),
    seats: z.number().int().min(0).max(99).optional().nullable(),
    departFrom: z.string().trim().max(200).optional().nullable(),
    departAt: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((d) => Object.keys(d).some((k) => (d as any)[k] !== undefined), {
    message: 'At least one field required',
  });
export type RideUpdateInput = z.infer<typeof rideUpdateSchema>;

// ── Refresh Token schema ────────────────────────────────────────
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// ── Rating schemas ──────────────────────────────────────────────
export const ratingCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  note: z.string().max(500).optional(),
});
export type RatingCreateInput = z.infer<typeof ratingCreateSchema>;

// ── Expense schemas ─────────────────────────────────────────────
export const expenseCreateSchema = z.object({
  description: z.string().min(1).max(200),
  amount: z.number().positive(),
  // User IDs are TEXT (e.g. "user-<uuid>"), not integers — clients send strings.
  // Typing these as numbers 400'd every real expense create/settle.
  splitWith: z.array(z.string().min(1)).min(1),
  category: z.string().max(50).optional(),
  // Budget = planned expenses. A planned row is a forecast and is EXCLUDED from
  // the balance ledger / settle-up (see getBalances). Defaults to actual (false).
  planned: z.boolean().optional(),
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

// ── Admin bulk schemas ──────────────────────────────────────────
export const adminBulkDeactivateSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
});
export type AdminBulkDeactivateInput = z.infer<typeof adminBulkDeactivateSchema>;

export const adminBulkArchiveSchema = z.object({
  festivalIds: z.array(z.string().min(1)).min(1),
});
export type AdminBulkArchiveInput = z.infer<typeof adminBulkArchiveSchema>;

// ── Admin role schema ───────────────────────────────────────────
export const adminAddRoleSchema = z.object({
  role: z.string().min(1).max(50),
});
export type AdminAddRoleInput = z.infer<typeof adminAddRoleSchema>;

// ── Pagination query schema ────────────────────────────────────
export const paginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PaginationQueryInput = z.infer<typeof paginationQuery>;

// ── Admin audit query schema ──────────────────────────────────
const validDateString = z.string().refine((v) => !isNaN(new Date(v).getTime()), 'Must be a valid date string');
export const adminAuditQuery = z.object({
  actor_id: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  resource_type: z.string().trim().max(100).optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  from: validDateString.optional(),
  to: validDateString.optional(),
});
export type AdminAuditQueryInput = z.infer<typeof adminAuditQuery>;

// ── Admin user search query schema ────────────────────────────
export const adminUserSearchQuery = z.object({
  search: z.string().trim().max(200).optional(),
});
export type AdminUserSearchQueryInput = z.infer<typeof adminUserSearchQuery>;

// ── Festival detail depth query schema ────────────────────────
export const festivalDepthQuery = z.object({
  depth: z.coerce.number().int().min(0).max(2).optional(),
});
export type FestivalDepthQueryInput = z.infer<typeof festivalDepthQuery>;

// ── Festival delete query schema ──────────────────────────────
export const festivalDeleteQuery = z.object({
  hard: z.enum(['true', 'false']).optional(),
});
export type FestivalDeleteQueryInput = z.infer<typeof festivalDeleteQuery>;

// ── Crew search query schema ──────────────────────────────────
export const crewUserSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
});
export type CrewUserSearchQueryInput = z.infer<typeof crewUserSearchQuery>;

// ── Crew list query schema ────────────────────────────────────
export const crewListQuery = z.object({
  festivalId: z.string().max(100).optional(),
});
export type CrewListQueryInput = z.infer<typeof crewListQuery>;

// ── Expense settle schema (extended with amount) ──────────────
export const expenseSettleFullSchema = z.object({
  toUserId: z.string().min(1),
  amount: z.number().positive(),
});
export type ExpenseSettleFullInput = z.infer<typeof expenseSettleFullSchema>;

// ── Route param schemas ────────────────────────────────────────
export const crewIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
});
export type CrewIdParams = z.infer<typeof crewIdParams>;

export const crewIdExpenseIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  expenseId: z.string().min(1, 'Expense ID required').max(100),
});
export type CrewIdExpenseIdParams = z.infer<typeof crewIdExpenseIdParams>;

export const crewIdPollIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  pollId: z.string().min(1, 'Poll ID required').max(100),
});
export type CrewIdPollIdParams = z.infer<typeof crewIdPollIdParams>;

export const crewIdMpIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  mpId: z.string().min(1, 'Meeting point ID required').max(100),
});
export type CrewIdMpIdParams = z.infer<typeof crewIdMpIdParams>;

export const crewIdItemIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  itemId: z.string().min(1, 'Item ID required').max(100),
});
export type CrewIdItemIdParams = z.infer<typeof crewIdItemIdParams>;

export const setIdParams = z.object({
  setId: z.string().min(1, 'Set ID required').max(100),
});
export type SetIdParams = z.infer<typeof setIdParams>;

export const crewIdFestivalIdParams = z.object({
  crewId: z.string().min(1, 'Crew ID required').max(100),
  festivalId: z.string().min(1, 'Festival ID required').max(100),
});
export type CrewIdFestivalIdParams = z.infer<typeof crewIdFestivalIdParams>;

export const festivalIdParams = z.object({
  festivalId: z.string().min(1, 'Festival ID required').max(100),
});
export type FestivalIdParams = z.infer<typeof festivalIdParams>;

export const genericIdParams = z.object({
  id: z.string().min(1, 'ID required').max(100),
});
export type GenericIdParams = z.infer<typeof genericIdParams>;

export const profileIdParams = z.object({
  id: z.string().min(1, 'Profile ID required').max(100),
});
export type ProfileIdParams = z.infer<typeof profileIdParams>;

// ════════════════════════════════════════════════════════════════════════════════
// Bundled schemas export (preserves the original `schemas` namespace for
// consumers that import as `const { schemas } = require('./schemas')`)
// ════════════════════════════════════════════════════════════════════════════════

export const schemas = {
  register: registerSchema,
  login: loginSchema,
  changePassword: changePasswordSchema,
  profileUpdate: profileUpdateSchema,
  joinFestival: joinFestivalSchema,
  resetPassword: resetPasswordSchema,
  resetPasswordPublic: resetPasswordPublicSchema,
  notificationPrefs: notificationPrefsSchema,
  pushToken: pushTokenSchema,
  deleteToken: deleteTokenSchema,
  markRead: markReadSchema,
  usernameChange: usernameChangeSchema,
  displayNameChange: displayNameChangeSchema,
  paymentHandles: paymentHandlesSchema,
  accountDelete: accountDeleteSchema,
  topicSubscription: topicSubscriptionSchema,
  festivalCreate: festivalCreateSchema,
  festivalUpdate: festivalUpdateSchema,
  crewCreate: crewCreateSchema,
  crewUpdate: crewUpdateSchema,
  crewJoin: crewJoinSchema,
  crewReform: crewReformSchema,
  crewTransfer: crewTransferSchema,
  crewAddMember: crewAddMemberSchema,
  setLink: setLinkSchema,
  crewHomeBase: crewHomeBaseSchema,
  crewPhotoAlbum: crewPhotoAlbumSchema,
  meetingPointCreate: meetingPointCreateSchema,
  meetingPointUpdate: meetingPointUpdateSchema,
  pollCreate: pollCreateSchema,
  pollVote: pollVoteSchema,
  packingCreate: packingCreateSchema,
  packingUpdate: packingUpdateSchema,
  crewStatus: crewStatusSchema,
  rideCreate: rideCreateSchema,
  rideUpdate: rideUpdateSchema,
  forgotPassword: forgotPasswordSchema,
  updateEmail: updateEmailSchema,
  refreshToken: refreshTokenSchema,
  ratingCreate: ratingCreateSchema,
  expenseCreate: expenseCreateSchema,
  adminBulkDeactivate: adminBulkDeactivateSchema,
  adminBulkArchive: adminBulkArchiveSchema,
  adminAddRole: adminAddRoleSchema,
  paginationQuery,
  adminAuditQuery,
  adminUserSearchQuery,
  festivalDepthQuery,
  festivalDeleteQuery,
  crewUserSearchQuery,
  crewListQuery,
  expenseSettleFull: expenseSettleFullSchema,
  crewIdParams,
  crewIdExpenseIdParams,
  crewIdPollIdParams,
  crewIdMpIdParams,
  crewIdItemIdParams,
  setIdParams,
  crewIdFestivalIdParams,
  festivalIdParams,
  genericIdParams,
  profileIdParams,
};
