import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { TimeBounds } from './useTimelineFilters';

/**
 * Provides a live "now" position (0-100 %) within the visible time range, a
 * ref to attach to the grid container, and a `scrollToNow` helper that
 * smoothly brings the now-line into view.
 *
 * The internal tick fires every 30 s so the indicator creeps forward without
 * forcing the parent to rerender.
 */
export function useNowIndicator(
  timeBounds: TimeBounds | null,
  selectedDay: number,
) {
  // Minute-tick so the now-indicator advances independently.
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const nowIndicator = useMemo(() => {
    if (!timeBounds) return null;
    const now = new Date(nowTick);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (nowMins >= timeBounds.minMin && nowMins <= timeBounds.maxMin) {
      return (
        ((nowMins - timeBounds.minMin) / (timeBounds.maxMin - timeBounds.minMin)) * 100
      );
    }
    return null;
  }, [timeBounds, nowTick]);

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
