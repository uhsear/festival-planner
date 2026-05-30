// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Input validation for festivals, users, and form data.
 */

import { sanitizeString, sanitizeIdentifier } from './sanitize';

export function validateTime(value: any) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hh, mm] = value.split(':').map(Number) as [number, number];
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/**
 * Validate hex color format (#RGB, #RRGGBB, #RRGGBBAA)
 */
export function validateColor(value: any) {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

/**
 * Validate username: 2-30 chars, alphanumeric/dash/underscore, spaces allowed between words
 */
export function validateUsername(value: any) {
  if (typeof value !== 'string') return false;
  const clean = value.trim();
  if (clean.length < 2 || clean.length > 30) return false;
  return /^[a-zA-Z0-9_-]+( [a-zA-Z0-9_-]+)*$/.test(clean);
}

/**
 * Validate password strength: 8-100 chars (length-only; kept for callers that
 * just need the boolean. New code should prefer checkPasswordPolicy, which also
 * screens common/breached passwords and identity reuse).
 */
export function validatePasswordStrength(value: any) {
  if (typeof value !== 'string') return false;
  return value.length >= 8 && value.length <= 100;
}

/**
 * The most common / breached passwords (lowercased). NIST 800-63B recommends
 * screening against a known-bad list instead of composition rules. This is a
 * focused, bundled top-list (no network dependency); a HIBP k-anonymity check
 * could be layered behind a flag later. Keep entries lowercase + trimmed.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '123123123', '111111111', '000000000',
  'qwerty123', 'qwertyuiop', 'qwerty12345', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx',
  'iloveyou', 'iloveyou1', 'admin123', 'administrator', 'welcome1', 'welcome123',
  'letmein1', 'letmein123', 'abc12345', 'abcd1234', 'baseball', 'football',
  'football1', 'sunshine', 'princess', 'princess1', 'dragon123', 'monkey123',
  'master123', 'superman1', 'trustno1', 'whatever1', 'starwars1', 'computer1',
  'michael1', 'jennifer', 'jordan23', 'hunter22', 'shadow123', 'ashley123',
  'login123', 'changeme', 'changeme1', 'secret123', 'samsung123', 'google123',
  'qazwsxedc', 'asdfghjkl', 'zxcvbnm1', 'q1w2e3r4', 'q1w2e3r4t5', 'passpass',
  'test1234', 'test12345', 'temp1234', 'demo1234', 'guest123', 'user1234',
  'festival', 'festival1', 'festie123', 'festival123',
]);

export interface PasswordPolicyContext {
  username?: string | null;
  email?: string | null;
}

/**
 * Server-authoritative password policy. Returns an error message string, or
 * null if the password is acceptable. Rejects: out-of-range length, common /
 * breached passwords, and passwords that contain the username or email
 * local-part (case-insensitive). No composition rules (per NIST 800-63B).
 */
export function checkPasswordPolicy(
  value: any,
  ctx: PasswordPolicyContext = {},
): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 100) return 'Password must be at most 100 characters';

  const lower = value.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return 'That password is too common — please choose something harder to guess';
  }

  const username = ctx.username?.trim().toLowerCase();
  if (username && username.length >= 3 && lower.includes(username)) {
    return 'Password must not contain your username';
  }

  const emailLocal = ctx.email?.split('@')[0]?.trim().toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    return 'Password must not contain your email address';
  }

  return null;
}

/**
 * Comprehensive festival data validation
 * Checks stages, days, sets, timing, and prevents duplicate names/IDs
 */
export function validateFestival(config: any, body: any) {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') return ['Festival payload is required'];
  if (!body.name || !sanitizeString(body.name)) errors.push('Festival name is required');
  if (body.stages && !Array.isArray(body.stages)) errors.push('Stages must be an array');
  if (body.days && !Array.isArray(body.days)) errors.push('Days must be an array');
  if (body.stages?.length > config.MAX_STAGES) errors.push(`Maximum ${config.MAX_STAGES} stages`);
  if (body.days?.length > config.MAX_DAYS) errors.push(`Maximum ${config.MAX_DAYS} days`);
  const stageIds = new Set();
  const stageNames = new Set();
  for (const stage of body.stages || []) {
    const cleanName = sanitizeString(stage?.name || '', 100);
    const cleanId = sanitizeIdentifier(stage?.id, 100);
    if (!cleanName) errors.push('Every stage requires a name');
    if (!cleanId) errors.push(`Stage "${cleanName || 'Unnamed'}" requires a valid id`);
    if (cleanId && stageIds.has(cleanId)) errors.push(`Duplicate stage id: ${cleanId}`);
    if (cleanId) stageIds.add(cleanId);
    const normalizedName = cleanName.toLowerCase();
    if (normalizedName && stageNames.has(normalizedName)) errors.push(`Duplicate stage name: ${cleanName}`);
    if (normalizedName) stageNames.add(normalizedName);
  }
  const setIds = new Set();
  for (const day of body.days || []) {
    if (day.sets && !Array.isArray(day.sets)) errors.push('Day sets must be an array');
    if ((day.sets || []).length > config.MAX_SETS_PER_DAY) {
      errors.push(`Maximum ${config.MAX_SETS_PER_DAY} sets per day`);
    }
    const stageSchedules = new Map();
    for (const set of day.sets || []) {
      const setId = sanitizeIdentifier(set?.id, 100);
      // Support both old (artist string) and new (artists array) format
      const artist = set?.artists?.length > 0
        ? set.artists.map((a: any) => sanitizeString(a.name || '', 300)).filter(Boolean).join(' b2b ')
        : sanitizeString(set?.artist || '', 300);
      const stageId = sanitizeIdentifier(set?.stageId, 100);
      if (!setId) errors.push(`Set "${artist || 'Unnamed'}" requires a valid id`);
      if (setId && setIds.has(setId)) errors.push(`Duplicate set id: ${setId}`);
      if (setId) setIds.add(setId);
      if (!artist && !(set?.artists?.length > 0)) errors.push('Every set requires an artist name');
      if (!stageId || !stageIds.has(stageId)) errors.push(`Set "${artist || 'Unnamed'}" must reference a valid stage`);
      if (!validateTime(set?.startTime) || !validateTime(set?.endTime)) {
        // TBA sets without times are valid — only error if partial time given
        if ((set?.startTime && !validateTime(set?.startTime)) || (set?.endTime && !validateTime(set?.endTime))) {
          errors.push(`Set "${artist || 'Unnamed'}" has invalid time format`);
        }
      }
      if (!stageId || !validateTime(set?.startTime) || !validateTime(set?.endTime)) continue;
      const stageEntries = stageSchedules.get(stageId) || [];
      stageEntries.push({
        artist: artist || 'Unnamed',
        start: set.startTime,
        end: set.endTime,
      });
      stageSchedules.set(stageId, stageEntries);
    }
    for (const stageEntries of stageSchedules.values()) {
      const sorted = stageEntries
        .map((entry: any) => {
          const start = entry.start.split(':').map((part: any) => Number.parseInt(part, 10));
          const end = entry.end.split(':').map((part: any) => Number.parseInt(part, 10));
          const startMinutes = (start[0] * 60) + start[1];
          let endMinutes = (end[0] * 60) + end[1];
          if (endMinutes <= startMinutes) endMinutes += 24 * 60;
          return { ...entry, startMinutes, endMinutes };
        })
        .sort((left: any, right: any) => left.startMinutes - right.startMinutes);
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (current.startMinutes < previous.endMinutes) {
          errors.push(`Stage overlap on "${current.artist}" and "${previous.artist}"`);
        }
      }
    }
  }
  return errors;
}
