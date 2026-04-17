'use strict';
/**
 * DEPRECATED: This file is a backward-compatibility re-export.
 * All validation logic has been consolidated into lib/schemas.js.
 * Update imports to use require('./schemas') directly.
 */
const {
  normalizePickPayload,
  normalizeNotePayload,
  normalizeReminderPayload,
  sanitizeFestivalPayload,
} = require('./schemas');
const { ALLOWED_PICK_PRIORITIES, ALLOWED_REMINDER_MINUTES } = require('./constants');

module.exports = {
  ALLOWED_PICK_PRIORITIES,
  ALLOWED_REMINDER_MINUTES,
  normalizePickPayload,
  normalizeNotePayload,
  normalizeReminderPayload,
  sanitizeFestivalPayload,
};
