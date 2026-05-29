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
 * Compute a set's status relative to a given `now`. Pure — the time source is
 * injected so it stays testable and works identically on web and native. Shared
 * single source of truth consumed by both web's and mobile's useSetStatus hooks.
 */
export function getSetStatus(
  set: FestivalSet,
  now: Date,
  days: FestivalDay[] = [],
): SetStatusResult {
  // Look up the date via the festival days array first (the store flattens sets
  // with a dayIndex); fall back to set.date for callers that still attach it.
  const dayRecord = typeof set.dayIndex === 'number' ? days[set.dayIndex] : null;
  const dateStr = dayRecord?.date || set.date;

  if (!dateStr || !set.startTime || !set.endTime) {
    return { status: 'tba', label: 'TBA', minutesUntil: Infinity, progress: 0 };
  }

  const setDate = new Date(dateStr);
  if (isNaN(setDate.getTime())) {
    return { status: 'tba', label: 'TBA', minutesUntil: Infinity, progress: 0 };
  }

  const [startHh = 0, startMm = 0] = (set.startTime || '00:00')
    .split(':')
    .map((x) => parseInt(x, 10));
  setDate.setHours(startHh, startMm, 0, 0);
  const setStartTime = setDate.getTime();

  const endDate = new Date(dateStr);
  const [endHh = 0, endMm = 0] = (set.endTime || set.startTime)
    .split(':')
    .map((x) => parseInt(x, 10));
  endDate.setHours(endHh, endMm, 0, 0);
  // If the end time is before the start time, the set runs past midnight.
  if (endDate <= setDate) {
    endDate.setDate(endDate.getDate() + 1);
  }
  const setEndTime = endDate.getTime();

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
