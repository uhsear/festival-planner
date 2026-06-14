import type { FestivalDay } from '../types/domain';
import { formatTime } from './format';
import { createDateInLocalFrame, zonedWallTimeToMs } from './setStatus';

/**
 * 055: resolve a crew meeting point's display time, honoring daily recurrence.
 *
 * A recurring point (`recurs_daily = true`) has a meaningful TIME-OF-DAY only —
 * its `meet_at` date component is just the day it was first set; the point should
 * render as "daily 3:00 PM" and resolve to a concrete datetime on EACH festival
 * day. A one-shot point keeps its single concrete `meet_at`.
 *
 * Everything here is PURE and platform-agnostic (web + React Native): no `window`,
 * `document`, or Node globals; `now` is injected for testability. Time math reuses
 * the shared TZ-safe primitives (`createDateInLocalFrame` / `zonedWallTimeToMs`)
 * so a recurring point lands at the same wall-clock on every day with no
 * UTC/local string-parser skew, and — when a festival `timeZone` is supplied —
 * at the correct real-world instant for an attendee whose phone is in another zone.
 */

/** A `YYYY-MM-DD` day-key, exactly the shape `FestivalDay.date` carries. */
type DayLike = Pick<FestivalDay, 'date'>;

export interface MeetingOccurrence {
  /** The festival day-key (`YYYY-MM-DD`) this occurrence falls on. */
  dayKey: string;
  /** Absolute epoch-ms for the occurrence (TZ-resolved). */
  ms: number;
}

/**
 * Extract the `{ hours, minutes }` wall-clock TIME-OF-DAY of an ISO `meet_at`.
 * When `timeZone` is supplied the time-of-day is read in the FESTIVAL's zone
 * (so "3 PM at the festival" stays 3 PM regardless of the device zone); omitted,
 * it is read in the device-local frame. Returns null for a missing/unparseable
 * value so callers can fall back to a label-less point.
 */
export function meetAtTimeOfDay(
  meetAt: string | null | undefined,
  timeZone?: string,
): { hours: number; minutes: number } | null {
  if (!meetAt) return null;
  const d = new Date(meetAt);
  if (Number.isNaN(d.getTime())) return null;
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(d);
    const map: Record<string, number> = {};
    for (const p of parts) if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
    if (map.hour == null || map.minute == null || Number.isNaN(map.hour) || Number.isNaN(map.minute)) return null;
    return { hours: map.hour, minutes: map.minute };
  }
  return { hours: d.getHours(), minutes: d.getMinutes() };
}

/** Build an `HH:MM` 24h key from a time-of-day, e.g. `{15, 0}` → `"15:00"`. */
function toHHMM(tod: { hours: number; minutes: number }): string {
  return `${String(tod.hours).padStart(2, '0')}:${String(tod.minutes).padStart(2, '0')}`;
}

/**
 * Resolve the concrete occurrence(s) of a meeting point.
 *
 * - One-shot (`recursDaily` falsy): a single occurrence at the literal `meetAt`
 *   instant (empty array when `meetAt` is missing).
 * - Recurring: one occurrence per festival day, at `meetAt`'s time-of-day,
 *   sorted ascending by instant.
 *
 * `timeZone` (optional IANA id): anchors the wall-clock in the festival's zone;
 * omitted, it uses the device-local frame. Always returns ABSOLUTE epoch-ms so
 * callers compare against a true `now`.
 */
export function meetingOccurrences(
  meetAt: string | null | undefined,
  recursDaily: boolean | null | undefined,
  days: ReadonlyArray<DayLike> = [],
  timeZone?: string,
): MeetingOccurrence[] {
  if (!meetAt) return [];

  if (!recursDaily) {
    const d = new Date(meetAt);
    if (Number.isNaN(d.getTime())) return [];
    return [{ dayKey: meetAt.slice(0, 10), ms: d.getTime() }];
  }

  const tod = meetAtTimeOfDay(meetAt, timeZone);
  if (!tod) return [];

  const out: MeetingOccurrence[] = [];
  for (const day of days) {
    const dayKey = day?.date?.slice(0, 10);
    if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;
    const ms = timeZone
      ? zonedWallTimeToMs(dayKey, tod.hours, tod.minutes, timeZone)
      : createDateInLocalFrame(dayKey, tod.hours, tod.minutes).getTime();
    if (Number.isNaN(ms)) continue;
    out.push({ dayKey, ms });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

/**
 * The NEXT upcoming occurrence at/after `now` (epoch-ms), or — when every
 * occurrence is in the past — the most recent one, so a label can still render
 * ("was at …" vs "next at …"). Returns null when there are no occurrences.
 */
export function nextMeetingOccurrence(
  meetAt: string | null | undefined,
  recursDaily: boolean | null | undefined,
  days: ReadonlyArray<DayLike> = [],
  now: Date = new Date(),
  timeZone?: string,
): MeetingOccurrence | null {
  const occ = meetingOccurrences(meetAt, recursDaily, days, timeZone);
  if (occ.length === 0) return null;
  const nowMs = now.getTime();
  const upcoming = occ.find((o) => o.ms >= nowMs);
  return upcoming ?? occ[occ.length - 1]!;
}

export interface MeetingTimeDisplay {
  /** Short human label, e.g. `"daily 3:00 PM"` or `"Sat 3:00 PM"`. */
  label: string;
  /** True for a recurring point (label is a daily time, not a single instant). */
  recurring: boolean;
  /** The resolved next/most-recent occurrence (null when none). */
  next: MeetingOccurrence | null;
}

/**
 * Display model for a meeting point's time.
 *
 * - Recurring → `"daily 3:00 PM"` (time-of-day only; the point repeats each day).
 * - One-shot  → a weekday + time for the concrete instant, e.g. `"Sat 3:00 PM"`.
 * - No `meetAt` → `{ label: '', recurring, next: null }` so callers hide the row.
 *
 * Pure. `now`/`timeZone` injectable. The weekday for a one-shot is rendered in the
 * festival zone when supplied, else device-local.
 */
export function meetingTimeDisplay(
  meetAt: string | null | undefined,
  recursDaily: boolean | null | undefined,
  days: ReadonlyArray<DayLike> = [],
  now: Date = new Date(),
  timeZone?: string,
): MeetingTimeDisplay {
  const recurring = !!recursDaily;

  if (!meetAt) return { label: '', recurring, next: null };

  if (recurring) {
    const tod = meetAtTimeOfDay(meetAt, timeZone);
    const next = nextMeetingOccurrence(meetAt, recursDaily, days, now, timeZone);
    if (!tod) return { label: '', recurring, next };
    return { label: `daily ${formatTime(toHHMM(tod))}`, recurring, next };
  }

  // One-shot: weekday + time-of-day for the single instant.
  const d = new Date(meetAt);
  if (Number.isNaN(d.getTime())) return { label: '', recurring, next: null };
  const next: MeetingOccurrence = { dayKey: meetAt.slice(0, 10), ms: d.getTime() };
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  };
  const label = new Intl.DateTimeFormat('en-US', opts).format(d);
  return { label, recurring, next };
}
