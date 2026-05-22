// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Shared constants — prevents enum duplication across modules (#57)
 * Used by both server.js (Sets) and lib/schemas.js (Zod enums)
 */

export const ALLOWED_PICK_PRIORITIES = new Set(['must', 'want-to-see', 'maybe']);
export const PICK_PRIORITY_VALUES = ['must', 'want-to-see', 'maybe'] as const;

export const ALLOWED_REMINDER_MINUTES = new Set([5, 10, 15, 30, 60]);
export const REMINDER_MINUTE_VALUES = [5, 10, 15, 30, 60] as const;

export const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const ALLOWED_AVATAR_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

export const ALLOWED_LINK_PLATFORMS = ['spotify', 'soundcloud', 'instagram', 'twitter', 'tiktok', 'website'] as const;
export const MAX_ARTISTS_PER_SET = 4;
export const MAX_LINKS_PER_ARTIST = 6;

export const MEETING_POINT_TYPES = ['pre-show', 'during', 'post-show', 'post-event', 'emergency', 'general'] as const;
export const MAX_MEETING_POINTS_PER_CREW = 5;
