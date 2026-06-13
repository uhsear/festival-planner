import { FestivalSet, FestivalDay } from '../types/domain';
import { formatTime } from './format';

export type SetStatus = 'past' | 'live' | 'upcoming' | 'soon' | 'later' | 'tba';

export interface SetStatusResult {
  status: SetStatus;
  label: string;
  minutesUntil: number;
  /** 0–1 float for how far through the set we are (only meaningful when live). */
  progress: number;
}

/**
 * Build a `Date` for a `YYYY-MM-DD` day-key plus an `HH:MM` wall-clock time in a
 * single, consistent **local** frame — never touching the JS Date string parser.
 *
 * Why this matters: `new Date('2026-06-15')` is parsed as UTC midnight, whereas
 * `new Date('2026-06-15T00:00:00')` is parsed as *local* midnight, and `setHours`
 * always operates in local time. Mixing those two parse modes (e.g. comparing a
 * UTC-parsed set time against a local `now`) silently shifts every comparison by
 * the machine's UTC offset, so a set looks "live" / "past" at the wrong moment for
 * any non-UTC user. CI runs in UTC, so the skew is invisible there. By splitting
 * the date string ourselves and seeding the calendar fields explicitly, the result
 * is anchored to the same local frame regardless of how the host parses strings.
 */
export function createDateInLocalFrame(dateStr: string, hours: number, minutes: number): Date {
  const [y, m, d] = dateStr
    .slice(0, 10)
    .split('-')
    .map((x) => parseInt(x, 10));
  const date = new Date();
  // setFullYear(year, monthIndex, day) — month is 0-based.
  date.setFullYear(y!, m! - 1, d!);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/** Shift a `YYYY-MM-DD` day-key by `n` calendar days (TZ-agnostic, via UTC math). */
function addDaysToDateKey(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

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
 * Epoch-ms for a wall-clock (`YYYY-MM-DD` + `HH:MM`) interpreted in a specific
 * IANA time zone — independent of the device's zone. Used so set reminders fire
 * at the right real-world instant even when the attendee's phone is set to a
 * different zone than the festival (the festival-TZ extension of the local-frame
 * fix in `createDateInLocalFrame`). Returns `NaN` for an unparseable date.
 *
 * Uses the standard two-pass offset correction so it stays accurate across DST
 * boundaries (the offset at the naive instant may differ from the offset at the
 * resolved instant).
 */
export function zonedWallTimeToMs(dateStr: string, hours: number, minutes: number, timeZone: string): number {
  const [y, m, d] = dateStr
    .slice(0, 10)
    .split('-')
    .map((x) => parseInt(x, 10));
  if (y == null || m == null || d == null || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return NaN;
  const naiveUtc = Date.UTC(y, m - 1, d, hours, minutes, 0);
  const offset1 = zoneOffsetMsAt(naiveUtc, timeZone);
  let ms = naiveUtc - offset1;
  const offset2 = zoneOffsetMsAt(ms, timeZone);
  if (offset2 !== offset1) ms = naiveUtc - offset2;
  return ms;
}

/**
 * Resolve a set's start/end to absolute epoch-ms in the device's local frame —
 * the single source of truth for "when does this set happen". Returns `null`
 * when the set has no usable date/time (TBA), so callers can skip it.
 *
 * Built on `createDateInLocalFrame` (no JS string-parser TZ skew) and includes
 * the **post-midnight rollover**: when the end wall-clock is at or before the
 * start (e.g. 23:30→01:00), the set runs past midnight, so the end is pushed to
 * the next calendar day. This is the same math `getSetStatus` uses internally,
 * extracted so festival/live mode, clash prompts and local reminders all read
 * identical bounds instead of re-deriving them (the old hand-rolled `parseSetMs`
 * copies in web/mobile festival-mode used a divergent 6am-cutoff heuristic).
 *
 * When `endTime` is missing the set is treated as one hour long.
 *
 * `timeZone` (optional IANA id, e.g. `America/New_York`): when supplied, the
 * wall-clock is anchored in the FESTIVAL's zone rather than the device's local
 * frame, so set reminders fire at the correct real-world instant for an
 * attendee whose phone is set to another zone. Omit it (the default) to keep
 * the original device-local behavior — every existing caller is unaffected.
 */
export function getSetTimeBounds(
  set: Pick<FestivalSet, 'startTime' | 'endTime' | 'date' | 'dayIndex'>,
  days: FestivalDay[] = [],
  timeZone?: string,
): { startMs: number; endMs: number } | null {
  // Look up the date via the festival days array first (the store flattens sets
  // with a dayIndex); fall back to set.date for callers that still attach it.
  const dayRecord = typeof set.dayIndex === 'number' ? days[set.dayIndex] : null;
  const dateStr = dayRecord?.date || set.date;
  if (!dateStr || !set.startTime) return null;

  // Anchor on the first 10 chars (YYYY-MM-DD). Reject anything that isn't a
  // well-formed calendar day before doing any time math.
  const dayKey = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;

  const [startHh = 0, startMm = 0] = set.startTime.split(':').map((x) => parseInt(x, 10));

  let startMs: number;
  if (timeZone) {
    startMs = zonedWallTimeToMs(dayKey, startHh, startMm, timeZone);
    if (Number.isNaN(startMs)) return null;
  } else {
    const startDate = createDateInLocalFrame(dayKey, startHh, startMm);
    if (isNaN(startDate.getTime())) return null;
    startMs = startDate.getTime();
  }

  let endMs: number;
  if (set.endTime) {
    const [endHh = 0, endMm = 0] = set.endTime.split(':').map((x) => parseInt(x, 10));
    if (timeZone) {
      endMs = zonedWallTimeToMs(dayKey, endHh, endMm, timeZone);
      // End at/before start means the set runs past midnight — push to next day.
      if (endMs <= startMs) endMs = zonedWallTimeToMs(addDaysToDateKey(dayKey, 1), endHh, endMm, timeZone);
    } else {
      const endDate = createDateInLocalFrame(dayKey, endHh, endMm);
      // End at/before start means the set runs past midnight — push to next day.
      if (endDate.getTime() <= startMs) {
        endDate.setDate(endDate.getDate() + 1);
      }
      endMs = endDate.getTime();
    }
  } else {
    // No end time: assume a one-hour set so "now / up next" stays sensible.
    endMs = startMs + 60 * 60_000;
  }

  return { startMs, endMs };
}

/**
 * Compute a set's status relative to a given `now`. Pure — the time source is
 * injected so it stays testable and works identically on web and native. Shared
 * single source of truth consumed by both web's and mobile's useSetStatus hooks.
 *
 * `timeZone` (optional IANA id, e.g. `America/New_York`): when supplied the set
 * wall-clock times are anchored in the FESTIVAL's zone rather than the device's
 * local frame. This is the correct mode whenever the festival has a known
 * `timeZone` field — without it a user whose device is in a different zone sees
 * the wrong live/past/soon badge because their local frame shifts the boundaries.
 * Omit to retain the original device-local behaviour (all existing callers that
 * don't pass it are unaffected).
 *
 * Importantly, when `timeZone` is supplied `now` **must** be a true UTC-epoch
 * `Date` (i.e. `new Date()` or `new Date(Date.now())`), NOT one constructed via
 * `createDateInLocalFrame` — the zoned bounds are absolute epoch-ms and must be
 * compared against an absolute `now`.
 */
export function getSetStatus(
  set: FestivalSet,
  now: Date,
  days: FestivalDay[] = [],
  timeZone?: string,
): SetStatusResult {
  if (!set.startTime || !set.endTime) {
    return { status: 'tba', label: 'TBA', minutesUntil: Infinity, progress: 0 };
  }

  // Delegate the TZ-safe start/end math (incl. post-midnight rollover) to the
  // shared getSetTimeBounds so status + festival/live mode never diverge.
  // Pass timeZone through so the bounds are anchored in the festival's zone
  // (absolute epoch-ms) rather than the device's local frame when a zone is known.
  const bounds = getSetTimeBounds(set, days, timeZone);
  if (!bounds) {
    return { status: 'tba', label: 'TBA', minutesUntil: Infinity, progress: 0 };
  }
  const { startMs: setStartTime, endMs: setEndTime } = bounds;

  const nowMs = now.getTime();
  const msUntilStart = setStartTime - nowMs;
  const msUntilEnd = setEndTime - nowMs;
  const minutesUntil = Math.round(msUntilStart / 60000);

  if (msUntilStart <= 0 && msUntilEnd > 0) {
    const duration = setEndTime - setStartTime;
    const elapsed = nowMs - setStartTime;
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    return { status: 'live', label: 'LIVE', minutesUntil, progress };
  }

  if (msUntilEnd <= 0) {
    return { status: 'past', label: 'Ended', minutesUntil, progress: 0 };
  }

  if (minutesUntil > 0 && minutesUntil <= 30) {
    return { status: 'soon', label: `In ${minutesUntil}m`, minutesUntil, progress: 0 };
  }

  if (minutesUntil > 30 && minutesUntil <= 120) {
    const hours = Math.floor(minutesUntil / 60);
    const mins = minutesUntil % 60;
    const label = mins > 0 ? `In ${hours}h ${mins}m` : `In ${hours}h`;
    return { status: 'upcoming', label, minutesUntil, progress: 0 };
  }

  return {
    status: 'later',
    label: formatTime(set.startTime),
    minutesUntil,
    progress: 0,
  };
}
