import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import type { TimeBounds } from './useTimelineFilters';

/**
 * Provides a live "now" position (0-100 %) within the visible time range, a
 * ref to attach to the grid container, and a `scrollToNow` helper that
 * smoothly brings the now-line into view.
 *
 * The internal tick fires every 30 s so the indicator creeps forward without
 * forcing the parent to rerender.
 *
 * Only shows when `selectedDay` corresponds to today's date (comparing against
 * the festival day's `date` field). Handles post-midnight rollover: when
 * `nowMins` is below `minMin`, tries `nowMins + 1440` to account for sets
 * running past midnight (e.g. a 1 AM now-line on a day whose bounds go to
 * 2 AM = 26:00).
 */
export function useNowIndicator(timeBounds: TimeBounds | null, selectedDay: number) {
  // Minute-tick so the now-indicator advances independently.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const days = useFestivalStore((s) => s.days);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const nowIndicator = useMemo(() => {
    if (!timeBounds) return null;

    // Only show the now-indicator when the selected day IS today.
    const day = days[selectedDay];
    if (day?.date) {
      const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
      if (day.date !== todayStr) return null;
    }

    const now = new Date(nowTick);
    let nowMins = now.getHours() * 60 + now.getMinutes();

    // Post-midnight rollover: if the day's bounds extend past 1440 (midnight)
    // and the wall-clock is in the early morning hours (below minMin), shift
    // nowMins into the 1440+ range so the indicator renders correctly for
    // sets running after midnight.
    if (nowMins < timeBounds.minMin && timeBounds.maxMin > 1440) {
      nowMins += 1440;
    }

    if (nowMins >= timeBounds.minMin && nowMins <= timeBounds.maxMin) {
      return ((nowMins - timeBounds.minMin) / (timeBounds.maxMin - timeBounds.minMin)) * 100;
    }
    return null;
  }, [timeBounds, nowTick, days, selectedDay]);

  // Auto-scroll-to-now once per day switch.
  const gridRef = useRef<HTMLDivElement | null>(null);

  const scrollToNow = useCallback(() => {
    const el = gridRef.current;
    if (!el || nowIndicator === null) return;
    const target = el.querySelector<HTMLElement>('.timeline-now-label');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [nowIndicator]);

  useEffect(() => {
    if (nowIndicator === null) return;
    const id = window.requestAnimationFrame(() => scrollToNow());
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  return { nowIndicator, gridRef, scrollToNow };
}
