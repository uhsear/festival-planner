import type { Festival } from '../types';

interface DayLike {
  date?: string | null;
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
  const endDt = new Date(last.date + 'T23:59:59');
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

  const startDt = new Date(first.slice(0, 10) + 'T00:00:00');
  const endDt = new Date(last.slice(0, 10) + 'T23:59:59');
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) return null;

  if (now > endDt) return 'past';
  if (now >= startDt) return 'ongoing';
  return 'upcoming';
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
  const startDt = new Date(day.date + 'T' + set.startTime + ':00');
  return startDt <= new Date();
}
