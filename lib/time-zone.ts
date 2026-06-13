// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Backend time-zone helper.
 *
 * The root backend cannot import `@festie/shared` (different package manager, no
 * path mapping — importing the barrel drags in React). So the DST-correct
 * wall-clock→epoch math from packages/shared/src/utils/setStatus.ts
 * (`zonedWallTimeToMs`) is re-implemented here, standalone, for the reminder
 * scheduler. Keep the two in sync if either changes.
 */

/** The offset (ms) the given IANA zone is from UTC at a particular instant. */
function zoneOffsetMsAt(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  const asUTC = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour!, map.minute!, map.second!);
  return asUTC - utcMs;
}

/**
 * Epoch-ms for a wall-clock (Y-M-D h:m) interpreted in a specific IANA zone,
 * independent of the server's own zone. Returns NaN for an unparseable date or
 * an unknown zone, so the caller can fall back to bare-local behavior.
 *
 * Two-pass offset correction (DST-safe): treat the wall time as if it were UTC
 * to get a first guess, read back the zone's offset at that instant, apply it,
 * then re-read the offset at the resolved instant and re-apply if it changed
 * (handles DST boundaries where the naive-instant offset differs from the real
 * one).
 */
export function zonedWallTimeToMs(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): number {
  if ([year, month, day, hours, minutes].some((n) => Number.isNaN(n))) return NaN;
  try {
    // First guess: pretend the wall-clock is UTC, then correct by the zone offset.
    const naiveUtc = Date.UTC(year, month - 1, day, hours, minutes, 0);
    const offset1 = zoneOffsetMsAt(naiveUtc, timeZone);
    let ms = naiveUtc - offset1;
    // Second pass: the offset at the resolved instant may differ across a DST
    // boundary — re-apply with the corrected offset if so.
    const offset2 = zoneOffsetMsAt(ms, timeZone);
    if (offset2 !== offset1) ms = naiveUtc - offset2;
    return ms;
  } catch {
    return NaN;
  }
}
