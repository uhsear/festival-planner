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
 * Validate password strength: 8-100 chars
 */
export function validatePasswordStrength(value: any) {
  if (typeof value !== 'string') return false;
  return value.length >= 8 && value.length <= 100;
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
