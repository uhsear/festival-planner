import { useEffect, useMemo, useState } from 'react';
import { FestivalSet, FestivalDay } from '@festie/shared/types';
import { formatTime } from '@festie/shared/utils';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';

export type SetStatus = 'past' | 'live' | 'upcoming' | 'soon' | 'later' | 'tba';

export interface SetStatusResult {
  status: SetStatus;
  label: string;
  minutesUntil: number;
  progress: number; // 0-1 float for how far through the set we are
}

/**
 * Pure helper function to compute set status relative to a given time.
 * Used by the hook and for testing/external use.
 */
export function getSetStatus(set: FestivalSet, now: Date, days: FestivalDay[] = []): SetStatusResult {
  // Look up date via festival days array first (React store flattens sets with dayIndex);
  // fall back to set.date for callers that still have it attached.
  const dayRecord = typeof set.dayIndex === 'number' ? days[set.dayIndex] : null;
  const dateStr = dayRecord?.date || set.date;

  // Handle TBA case
  if (!dateStr || !set.startTime || !set.endTime) {
    return {
      status: 'tba',
      label: 'TBA',
      minutesUntil: Infinity,
      progress: 0,
    };
  }

  // Parse set date and times
  const setDate = new Date(dateStr);
  if (isNaN(setDate.getTime())) {
    return {
      status: 'tba',
      label: 'TBA',
      minutesUntil: Infinity,
      progress: 0,
    };
  }

  const [startHh, startMm] = (set.startTime || '00:00').split(':').map((x) => parseInt(x, 10));
  setDate.setHours(startHh, startMm, 0, 0);
  const setStartTime = setDate.getTime();

  const endDate = new Date(dateStr);
  const [endHh, endMm] = (set.endTime || set.startTime).split(':').map((x) => parseInt(x, 10));
  endDate.setHours(endHh, endMm, 0, 0);
  // If end time is before start time, assume next day
  if (endDate <= setDate) {
    endDate.setDate(endDate.getDate() + 1);
  }
  const setEndTime = endDate.getTime();

  const nowMs = now.getTime();
  const msUntilStart = setStartTime - nowMs;
  const msUntilEnd = setEndTime - nowMs;
  const minutesUntil = Math.round(msUntilStart / 60000);

  // Set is currently live
  if (msUntilStart <= 0 && msUntilEnd > 0) {
    const duration = setEndTime - setStartTime;
    const elapsed = nowMs - setStartTime;
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    return {
      status: 'live',
      label: 'LIVE',
      minutesUntil,
      progress,
    };
  }

  // Set has ended
  if (msUntilEnd <= 0) {
    return {
      status: 'past',
      label: 'Ended',
      minutesUntil,
      progress: 0,
    };
  }

  // Set starts within 30 minutes
  if (minutesUntil > 0 && minutesUntil <= 30) {
    return {
      status: 'soon',
      label: `In ${minutesUntil}m`,
      minutesUntil,
      progress: 0,
    };
  }

  // Set starts within 2 hours
  if (minutesUntil > 30 && minutesUntil <= 120) {
    const hours = Math.floor(minutesUntil / 60);
    const mins = minutesUntil % 60;
    const label = mins > 0 ? `In ${hours}h ${mins}m` : `In ${hours}h`;
    return {
      status: 'upcoming',
      label,
      minutesUntil,
      progress: 0,
    };
  }

  // Set starts more than 2 hours away
  if (minutesUntil > 120) {
    const label = formatTime(set.startTime);
    return {
      status: 'later',
      label,
      minutesUntil,
      progress: 0,
    };
  }

  // Fallback
  return {
    status: 'later',
    label: formatTime(set.startTime),
    minutesUntil,
    progress: 0,
  };
}

/**
 * Hook that computes set status relative to current time.
 * Updates on a 60-second interval.
 * Memoized to avoid recomputing on every render.
 */
export function useSetStatus(set: FestivalSet): SetStatusResult;
export function useSetStatus(sets: FestivalSet[]): SetStatusResult[];
export function useSetStatus(sets: FestivalSet | FestivalSet[]): SetStatusResult | SetStatusResult[] {
  const [now, setNow] = useState(() => new Date());
  const days = useFestivalStore((s) => s.days);
  const isSingleSet = !Array.isArray(sets);
  const setsArray = isSingleSet ? [sets] : sets;

  // Update current time on 60-second interval
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000); // Update every 60 seconds

    return () => clearInterval(timer);
  }, []);

  // Memoize the computation
  const results = useMemo(() => {
    return setsArray.map((set) => getSetStatus(set, now, days));
  }, [setsArray, now, days]);

  return isSingleSet ? results[0] : results;
}
