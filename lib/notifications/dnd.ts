// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Check whether the current wall-clock time falls inside a user's Do-Not-Disturb window.
 */
export function isInDndWindow(prefs: { dndStart?: string; dndEnd?: string } | null | undefined) {
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
