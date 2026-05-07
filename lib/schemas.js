// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

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

const { z } = require('zod');
const { PICK_PRIORITY_VALUES, REMINDER_MINUTE_VALUES, ALLOWED_LINK_PLATFORMS, MAX_ARTISTS_PER_SET } = require('./constants');

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

const registerSchema = z.object({
  username,
  password,
  confirmPassword: z.string(),
  email: email.optional(),
  tosAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms of Service' }) }),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

const loginSchema = z.object({
  username: z.string().min(1, 'Username required').max(40),
  password: z.string().min(1, 'Password required').max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword: password,
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

// ════════════════════════════════════════════════════════════════════════════════
// Profile & Festival Participation Schemas
// ════════════════════════════════════════════════════════════════════════════════

const pickValue = z.enum(PICK_PRIORITY_VALUES);
const picksMap = z.record(z.string().max(100), pickValue).optional();
const notesMap = z.record(z.string().max(100), shortText).optional();
const allowedReminderMinutes = z.union(
  REMINDER_MINUTE_VALUES.map((m) => z.literal(m))
);
const remindersMap = z.record(z.string().max(100), allowedReminderMinutes).optional();

const profileUpdateSchema = z.object({
  picks: picksMap,
  notes: notesMap,
  reminders: remindersMap,
}).refine((d) => Object.keys(d).some((k) => d[k] !== undefined), {
  message: 'At least one field required',
});

const joinFestivalSchema = z.object({
  festivalId: identifier,
});

// ════════════════════════════════════════════════════════════════════════════════
// Admin Schemas
// ════════════════════════════════════════════════════════════════════════════════

const adminLoginSchema = z.object({
  username: z.string().min(1).max(40),
  password: z.string().min(1).max(200),
});

const resetPasswordSchema = z.object({
  newPassword: password,
});

const resetPasswordPublicSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid token').max(64),
  newPassword: password,
  confirmPassword: z.string().min(8).max(100),
});

// ════════════════════════════════════════════════════════════════════════════════
// Notification & Push Schemas
// ════════════════════════════════════════════════════════════════════════════════
const dndTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)').nullable();
const notificationPrefsSchema = z.object({
  crewUpdates: z.boolean().optional(),
  setReminders: z.boolean().optional(),
  scheduleChanges: z.boolean().optional(),
  dndStart: dndTime.optional(),
  dndEnd: dndTime.optional(),
}).strict();

const pushTokenSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['web', 'ios', 'android']).default('web'),
  deviceName: z.string().max(60).optional().nullable(),
});

// ── Additional notification schemas ──────────────────────────────
const deleteTokenSchema = z.object({
  token: z.string().min(1, 'Token required').max(4096),
});

const markReadSchema = z.object({
  festivalId: z.string().max(100).optional(),
});

// ── Topic subscription schema ────────────────────────────────────
const topicSubscriptionSchema = z.record(
  z.string(),
  z.boolean()
).refine((d) => Object.keys(d).length > 0 && Object.keys(d).length <= 10, {
  message: 'At least one topic required, max 10',
});

// ── Account schemas ───────────────────────────────────────────────
const usernameChangeSchema = z.object({
  username: z.string().trim().min(1, 'Username required').max(40),
});

const accountDeleteSchema = z.object({
  password: z.string().min(1, 'Password confirmation required'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Valid email required').max(254),
});

const updateEmailSchema = z.object({
  email: z.string().email('Valid email required').max(254),
  password: z.string().min(1, 'Password confirmation required'),
});

// ── Festival schemas (admin) ───────────────────────────────────────
const stageSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
});

const artistLinkSchema = z.object({
  name: z.string().min(1).max(300),
  links: z.record(
    z.enum(ALLOWED_LINK_PLATFORMS),
    z.string().url().max(500).or(z.literal("")).optional().nullable(),
  ).optional().default({}).transform(obj =>
    Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v != null && v !== ''))
  ),
});

const setSchema = z.object({
  id: z.string().max(100).optional(),
  artists: z.array(artistLinkSchema).min(1).max(MAX_ARTISTS_PER_SET).optional(),
  // Backward compat — old clients may still send artist/linkUrl
  artist: z.string().max(300).optional(),
  stageId: z.string().max(100).optional().nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable().or(z.literal('')),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable().or(z.literal('')),
  linkUrl: z.string().max(500).optional().nullable().or(z.literal('')),
}).refine((d) => d.artists?.length > 0 || (d.artist && d.artist.length > 0), {
  message: 'At least one artist is required (via artists[] or artist)',
});

const daySchema = z.object({
  label: z.string().max(100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sets: z.array(setSchema).optional(),
});

const festivalCreateSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  location: z.string().max(500).optional(),
  b2bSeparator: z.string().max(10).optional(),
  stages: z.array(stageSchema).max(20).optional(),
  days: z.array(daySchema).max(10).optional(),
});

const festivalUpdateSchema = festivalCreateSchema.partial().refine(
  (d) => Object.keys(d).some((k) => d[k] !== undefined),
  'At least one field required'
);

// ── Crew schemas ─────────────────────────────────────────────────────
const crewCreateSchema = z.object({
  name: z.string().trim().min(1, 'Crew name required').max(60),
  festivalId: identifier,
});

const crewUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  maxMembers: z.number().int().min(2).max(30).optional(),
}).refine((d) => Object.keys(d).some((k) => d[k] !== undefined), {
  message: 'At least one field required',
});

const crewJoinSchema = z.object({
  inviteCode: z.string().trim().min(4).max(12),
});

const crewTransferSchema = z.object({
  userId: identifier,
});

const crewAddMemberSchema = z.object({
  userId: identifier,
});

// ── Set link schema (admin) ──────────────────────────────────────
const setLinkSchema = z.object({
  linkUrl: z.string().url('Must be a valid URL').max(500).nullable().optional().or(z.literal('')),
});


// ── Meeting Point schemas (Phase 1B) ────────────────────────────
const { MEETING_POINT_TYPES } = require('./constants');

const meetingPointCreateSchema = z.object({
  label: z.string().trim().min(1, 'Label required').max(100),
  location: z.string().trim().min(1, 'Location required').max(200),
  type: z.enum(MEETING_POINT_TYPES).default('during'),
  meetAt: z.string().datetime().optional().nullable(),
  stageReference: z.string().max(100).optional().nullable(),
});

const meetingPointUpdateSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  type: z.enum(MEETING_POINT_TYPES).optional(),
  meetAt: z.string().datetime().optional().nullable(),
  stageReference: z.string().max(100).optional().nullable(),
}).refine((d) => Object.keys(d).some((k) => d[k] !== undefined), {
  message: 'At least one field required',
});

// ── Validation middleware factory ───────────────────────────────────
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue.path.length > 0
        ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
        : firstIssue.message;
      const { sendError, ErrorCodes } = require('./response');
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
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue.path.length > 0
        ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
        : firstIssue.message;
      const { sendError, ErrorCodes } = require('./response');
      return sendError(res, 400, message, ErrorCodes.VALIDATION_ERROR, {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// Payload Normalizers (consolidated from lib/validation.js)
// ════════════════════════════════════════════════════════════════════════════════

const { sanitizeString, normalizeRecordKey, sanitizeIdentifier, validateTime, validateColor } = require('./helpers');
const { ALLOWED_PICK_PRIORITIES, ALLOWED_REMINDER_MINUTES, MAX_ARTISTS_PER_SET: _MAX_ARTISTS } = require('./constants');

/**
 * Derive a display name from an artists array using the festival's b2b separator.
 * @param {Array} artists - Array of { name, links } objects
 * @param {string} separator - B2B separator string (default: 'b2b')
 * @returns {string} Display name like "DJ Alpha b2b DJ Beta"
 */
function artistDisplayName(artists, separator = 'b2b') {
  if (!artists?.length) return 'Unknown';
  return artists.map((a) => a.name).join(` ${separator} `);
}

/**
 * Normalize a set's artist data — accepts both old (artist+linkUrl) and new (artists[]) formats.
 * Always returns a normalized artists array.
 */
function normalizeSetArtists(set) {
  if (set.artists?.length > 0) {
    return set.artists.slice(0, _MAX_ARTISTS).map((a) => ({
      name: sanitizeString(a.name || '', 300),
      links: sanitizeLinkRecord(a.links),
    })).filter((a) => a.name);
  }
  // Backward compat: convert old artist + linkUrl to artists[]
  const name = sanitizeString(set.artist || '', 300);
  if (!name) return [];
  const links = {};
  const rawUrl = set.linkUrl && typeof set.linkUrl === 'string' ? set.linkUrl.trim() : '';
  if (rawUrl && /^https?:\/\//.test(rawUrl)) links.spotify = rawUrl.slice(0, 500);
  return [{ name, links }];
}

function sanitizeLinkRecord(links) {
  if (!links || typeof links !== 'object') return {};
  const clean = {};
  for (const [platform, url] of Object.entries(links)) {
    if (typeof url !== 'string' || !url.trim()) continue;
    const trimmed = url.trim().slice(0, 500);
    if (/^https?:\/\//.test(trimmed)) clean[platform] = trimmed;
  }
  return clean;
}

function normalizePickPayload(input, config) {
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
    if (!ALLOWED_PICK_PRIORITIES.has(priority)) {
      return { error: `Invalid priority: ${priority}` };
    }
    picks[setId] = priority;
  }
  return { value: picks };
}

function normalizeNotePayload(input, config) {
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

function normalizeReminderPayload(input, config) {
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
    const minutes = Number.parseInt(leadMinutes, 10);
    if (!ALLOWED_REMINDER_MINUTES.has(minutes)) {
      return { error: 'Invalid reminder time' };
    }
    reminders[setId] = minutes;
  }
  return { value: reminders };
}

function sanitizeFestivalPayload(input, existingFestival, config, createOpaqueId) {
  const now = new Date().toISOString();
  const b2bSep = sanitizeString(input.b2bSeparator ?? existingFestival?.b2bSeparator ?? 'b2b', 10) || 'b2b';
  return {
    id: existingFestival?.id || sanitizeIdentifier(input.id, 100) || createOpaqueId('fest'),
    name: sanitizeString(input.name || existingFestival?.name || ''),
    location: sanitizeString(input.location ?? existingFestival?.location ?? '', 500),
    b2bSeparator: b2bSep,
    stages: (input.stages || existingFestival?.stages || []).slice(0, config.MAX_STAGES).map((stage, index) => ({
      id: sanitizeIdentifier(stage.id, 100) || createOpaqueId(`stage-${index}`),
      name: sanitizeString(stage.name || '', 100),
      color: validateColor(stage.color) ? stage.color : '#666666',
    })),
    days: (input.days || existingFestival?.days || []).slice(0, config.MAX_DAYS).map((day) => ({
      label: sanitizeString(day.label || '', 100),
      date: sanitizeString(day.date || '', 20),
      sets: (day.sets || []).slice(0, config.MAX_SETS_PER_DAY).map((set, index) => {
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
const crewHomeBaseSchema = z.object({
  location: z.string().trim().max(200).optional().nullable(),
  time: z.string().trim().max(100).optional().nullable(),
});

const pollCreateSchema = z.object({
  question: z.string().trim().min(1, 'Question required').max(500),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(4),
  closesAt: z.string().datetime().optional().nullable(),
});

const pollVoteSchema = z.object({
  optionIndex: z.number().int().min(0).max(3),
});

// ── Refresh Token schema ────────────────────────────────────────
const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── Rating schemas ──────────────────────────────────────────────
const ratingCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  note: z.string().max(500).optional(),
});

// ── Expense schemas ─────────────────────────────────────────────
const expenseCreateSchema = z.object({
  description: z.string().min(1).max(200),
  amount: z.number().positive(),
  splitWith: z.array(z.number().int()).min(1),
  category: z.string().max(50).optional(),
});

const expenseSettleSchema = z.object({
  toUserId: z.number().int(),
});

// ── Admin bulk schemas ──────────────────────────────────────────
const adminBulkDeactivateSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
});

const adminBulkArchiveSchema = z.object({
  festivalIds: z.array(z.string().min(1)).min(1),
});

// ── Admin role schema ───────────────────────────────────────────
const adminAddRoleSchema = z.object({
  role: z.string().min(1).max(50),
});

// ── Pagination query schema ────────────────────────────────────
const paginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ── Admin audit query schema ──────────────────────────────────
const validDateString = z.string().refine(
  (v) => !isNaN(new Date(v).getTime()),
  'Must be a valid date string',
);
const adminAuditQuery = z.object({
  actor_id: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  resource_type: z.string().trim().max(100).optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  from: validDateString.optional(),
  to: validDateString.optional(),
});

// ── Admin user search query schema ────────────────────────────
const adminUserSearchQuery = z.object({
  search: z.string().trim().max(200).optional(),
});

// ── Festival detail depth query schema ────────────────────────
const festivalDepthQuery = z.object({
  depth: z.coerce.number().int().min(0).max(2).optional(),
});

// ── Festival delete query schema ──────────────────────────────
const festivalDeleteQuery = z.object({
  hard: z.enum(['true', 'false']).optional(),
});

// ── Crew search query schema ──────────────────────────────────
const crewUserSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
});

// ── Crew list query schema ────────────────────────────────────
const crewListQuery = z.object({
  festivalId: z.string().max(100).optional(),
});

// ── Expense settle schema (extended with amount) ──────────────
const expenseSettleFullSchema = z.object({
  toUserId: z.number().int(),
  amount: z.number().positive(),
});

module.exports = {
  schemas: {
    register: registerSchema,
    login: loginSchema,
    changePassword: changePasswordSchema,
    profileUpdate: profileUpdateSchema,
    joinFestival: joinFestivalSchema,
    adminLogin: adminLoginSchema,
    resetPassword: resetPasswordSchema,
    resetPasswordPublic: resetPasswordPublicSchema,
    notificationPrefs: notificationPrefsSchema,
    pushToken: pushTokenSchema,
    deleteToken: deleteTokenSchema,
    markRead: markReadSchema,
    usernameChange: usernameChangeSchema,
    accountDelete: accountDeleteSchema,
    topicSubscription: topicSubscriptionSchema,
    festivalCreate: festivalCreateSchema,
    festivalUpdate: festivalUpdateSchema,
    crewCreate: crewCreateSchema,
    crewUpdate: crewUpdateSchema,
    crewJoin: crewJoinSchema,
    crewTransfer: crewTransferSchema,
    crewAddMember: crewAddMemberSchema,
    setLink: setLinkSchema,
    crewHomeBase: crewHomeBaseSchema,
    meetingPointCreate: meetingPointCreateSchema,
    meetingPointUpdate: meetingPointUpdateSchema,
    pollCreate: pollCreateSchema,
    pollVote: pollVoteSchema,
    forgotPassword: forgotPasswordSchema,
    updateEmail: updateEmailSchema,
    refreshToken: refreshTokenSchema,
    ratingCreate: ratingCreateSchema,
    expenseCreate: expenseCreateSchema,
    expenseSettle: expenseSettleSchema,
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
  },
  validate,
  validateQuery,
  normalizePickPayload,
  normalizeNotePayload,
  normalizeReminderPayload,
  sanitizeFestivalPayload,
  artistDisplayName,
  normalizeSetArtists,
};
