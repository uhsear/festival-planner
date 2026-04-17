// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Check whether the current wall-clock time falls inside a user's Do-Not-Disturb window.
 * @param {{ dndStart?: string, dndEnd?: string } | null | undefined} prefs
 * @returns {boolean}
 */
function isInDndWindow(prefs) {
  if (!prefs) return false;
  if (!prefs.dndStart || !prefs.dndEnd) return false;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (prefs.dndStart <= prefs.dndEnd) {
    if (prefs.dndStart === prefs.dndEnd) return false;
    return hhmm >= prefs.dndStart && hhmm <= prefs.dndEnd;
  }
  // Wraps midnight (e.g., 22:00 - 08:00)
  return hhmm >= prefs.dndStart || hhmm < prefs.dndEnd;
}

module.exports = { isInDndWindow };
