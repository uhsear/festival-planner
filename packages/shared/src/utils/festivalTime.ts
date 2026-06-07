import type { Festival } from '../types';
import { createDateInLocalFrame } from './setStatus';

interface DayLike {
  date?: string | null;
}

/**
 * Validate an IANA time-zone id (e.g. `America/New_York`). Returns false for
 * empty/garbage so callers can safely fall back to the device-local frame.
 */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== 'string') return false;
  try {
    // Throws RangeError for an unknown zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a festival's IANA time zone, when known. Reads the optional
 * `timeZone` field the backend may attach so reminder fire-times can be anchored
 * in the festival's zone (not the device's). Returns undefined when absent or
 * invalid, in which case time math falls back to the device-local frame —
 * preserving the prior `createDateInLocalFrame` behavior with no regression.
 */
export function resolveFestivalTimeZone(festival: { timeZone?: string | null } | null | undefined): string | undefined {
  const tz = festival?.timeZone;
  return isValidTimeZone(tz) ? tz : undefined;
}

/** Festival-like object that may carry inline days (e.g. from the list endpoint). */
interface FestivalWithDays extends Festival {
  days?: ReadonlyArray<DayLike>;
}

/**
 * Returns true when the festival's last day's 23:59 local has passed.
 *
 * NOTE: `festivalStore.selectFestival` strips `days` off the Festival object
 * and stores them in a separate `days` field. So callers MUST pass both the
 * festival and the days array. The second argument is optional for the (rare)
 * case where a Festival object from the list endpoint still has them inline.
 */
export function isFestivalOver(festival: Festival | null | undefined, days?: ReadonlyArray<DayLike> | null): boolean {
  if (!festival) return false;
  const daysArr = (days && days.length > 0 ? days : (festival as FestivalWithDays).days) || [];
  if (!daysArr.length) return false;
  const last = daysArr[daysArr.length - 1];
  if (!last?.date) return false;
  // Anchor 23:59 in the device's local frame (no JS string-parser TZ skew).
  const endDt = createDateInLocalFrame(last.date, 23, 59);
  if (Number.isNaN(endDt.getTime())) return false;
  return endDt < new Date();
}

export type FestivalStatus = 'upcoming' | 'ongoing' | 'past';

/**
 * Classify a festival relative to `now`:
 *  - 'past'     once the final day's 23:59 (local) has passed
 *  - 'ongoing'  while `now` is within [first day 00:00, last day 23:59]
 *  - 'upcoming' before it starts
 * Uses inline `days[]` when present, otherwise the festival's startDate/endDate
 * (the list endpoint provides those). Returns null when no usable dates exist so
 * callers can simply hide the status. `now` is injectable for testing.
 */
export function festivalStatus(
  festival: (Festival & { startDate?: string | null; endDate?: string | null }) | null | undefined,
  days?: ReadonlyArray<DayLike> | null,
  now: Date = new Date(),
): FestivalStatus | null {
  if (!festival) return null;
  const daysArr = (days && days.length > 0 ? days : (festival as FestivalWithDays).days) || [];
  const dayDates = daysArr.map((d) => d?.date).filter(Boolean) as string[];

  let first: string | undefined;
  let last: string | undefined;
  if (dayDates.length) {
    const sorted = [...dayDates].sort();
    first = sorted[0];
    last = sorted[sorted.length - 1];
  } else {
    first = festival.startDate || undefined;
    last = festival.endDate || festival.startDate || undefined;
  }
  if (!first || !last) return null;

  // Both bounds anchored in one consistent local frame (no string-parser skew).
  const startDt = createDateInLocalFrame(first, 0, 0);
  const endDt = createDateInLocalFrame(last, 23, 59);
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) return null;

  if (now > endDt) return 'past';
  if (now >= startDt) return 'ongoing';
  return 'upcoming';
}

/**
 * Lifecycle phase of a festival, used to re-prioritize the home/landing surface:
 *  - 'pre'  — before it starts (lean into picks / lineup / crew invites / Spotify)
 *  - 'live' — while it's running (lean into Now & Next / live map / SOS / meeting points)
 *  - 'post' — once it's over    (lean into wrap-up / expenses / settle-up)
 *
 * A thin semantic wrapper over {@link festivalStatus} (ongoing → 'live') so web
 * and mobile derive the same phase from the festival date range vs `now` and can
 * reorder/emphasize — never hide — content per phase. Returns null when no usable
 * dates exist so callers fall back to a phase-neutral layout.
 */
export type FestivalPhase = 'pre' | 'live' | 'post';

export function festivalPhase(
  festival: (Festival & { startDate?: string | null; endDate?: string | null }) | null | undefined,
  days?: ReadonlyArray<DayLike> | null,
  now: Date = new Date(),
): FestivalPhase | null {
  const status = festivalStatus(festival, days, now);
  if (!status) return null;
  return status === 'upcoming' ? 'pre' : status === 'ongoing' ? 'live' : 'post';
}

/**
 * Returns true when a set's start time has arrived (so the user can
 * meaningfully rate it). If the set has no start time, fall back to the
 * festival-over check.
 */
export function hasSetStarted(
  set: { startTime?: string | null; dayIndex?: number | null } | null,
  festival: Festival | null | undefined,
  days?: ReadonlyArray<DayLike> | null,
): boolean {
  if (!set) return false;
  if (!festival) return false;
  const daysArr = (days && days.length > 0 ? days : (festival as FestivalWithDays).days) || [];
  if (!set.startTime || set.dayIndex == null) return isFestivalOver(festival, daysArr);
  const day = daysArr[set.dayIndex];
  if (!day?.date) return isFestivalOver(festival, daysArr);
  // Anchor the set's start in the device's local frame (no string-parser skew).
  const [hh = 0, mm = 0] = set.startTime.split(':').map((x) => parseInt(x, 10));
  const startDt = createDateInLocalFrame(day.date, hh, mm);
  if (Number.isNaN(startDt.getTime())) return isFestivalOver(festival, daysArr);
  return startDt <= new Date();
}
