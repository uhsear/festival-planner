// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Shared constants — prevents enum duplication across modules (#57)
 * Used by both server.js (Sets) and lib/schemas.js (Zod enums)
 */

const ALLOWED_PICK_PRIORITIES = new Set(['must', 'want-to-see', 'maybe']);
const PICK_PRIORITY_VALUES = ['must', 'want-to-see', 'maybe'];

const ALLOWED_REMINDER_MINUTES = new Set([5, 10, 15, 30, 60]);
const REMINDER_MINUTE_VALUES = [5, 10, 15, 30, 60];

const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_AVATAR_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

const ALLOWED_LINK_PLATFORMS = ['spotify', 'soundcloud', 'instagram', 'twitter', 'tiktok', 'website'];
const MAX_ARTISTS_PER_SET = 4;
const MAX_LINKS_PER_ARTIST = 6;

const MEETING_POINT_TYPES = ['pre-show', 'during', 'post-show', 'post-event', 'emergency', 'general'];
const MAX_MEETING_POINTS_PER_CREW = 5;

module.exports = {
  MEETING_POINT_TYPES,
  MAX_MEETING_POINTS_PER_CREW,
  ALLOWED_PICK_PRIORITIES,
  PICK_PRIORITY_VALUES,
  ALLOWED_REMINDER_MINUTES,
  REMINDER_MINUTE_VALUES,
  ALLOWED_AVATAR_MIME_TYPES,
  ALLOWED_AVATAR_FORMATS,
  ALLOWED_LINK_PLATFORMS,
  MAX_ARTISTS_PER_SET,
  MAX_LINKS_PER_ARTIST,
};
