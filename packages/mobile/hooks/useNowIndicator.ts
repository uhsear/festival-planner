import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppState, type ScrollView } from 'react-native';

/** Time bounds for the visible day window (minutes-from-midnight). */
export interface TimeBounds {
  minMin: number;
  maxMin: number;
  totalSlots: number;
}

/**
 * Mobile port of the web `useNowIndicator`. Provides a live "now" position
 * (0-100 %) within the visible time range, a ref to attach to the vertical
 * timeline ScrollView, and a `scrollToNow` helper that animates the now-line
 * into view.
 *
 * The internal tick fires every 30 s so the indicator creeps forward. The
 * scroll math needs the rendered content height, so callers pass `rowHeight`
 * (px per 15-minute slot) — matching the web grid's slot model.
 */
export function useNowIndicator(timeBounds: TimeBounds | null, selectedDay: number, rowHeight: number) {
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    // iOS suspends JS timers while backgrounded, freezing the NOW line. Snap to
    // the real clock the instant the app returns to the foreground.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowTick(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  const nowIndicator = useMemo(() => {
    if (!timeBounds) return null;
    const now = new Date(nowTick);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (nowMins >= timeBounds.minMin && nowMins <= timeBounds.maxMin) {
      return ((nowMins - timeBounds.minMin) / (timeBounds.maxMin - timeBounds.minMin)) * 100;
    }
    return null;
  }, [timeBounds, nowTick]);

  const scrollRef = useRef<ScrollView | null>(null);

  const scrollToNow = useCallback(() => {
    const el = scrollRef.current;
    if (!el || nowIndicator === null || !timeBounds) return;
    // Total rendered height = slots * rowHeight. Target the now-line, then
    // offset up by ~120px so it lands roughly centered rather than at the top.
    const contentHeight = timeBounds.totalSlots * rowHeight;
    const targetY = (nowIndicator / 100) * contentHeight;
    el.scrollTo({ y: Math.max(0, targetY - 120), animated: true });
  }, [nowIndicator, timeBounds, rowHeight]);

  // Auto-scroll to now once per day switch (matches web's rAF-on-day-change).
  useEffect(() => {
    if (nowIndicator === null) return;
    const id = requestAnimationFrame(() => scrollToNow());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  return { nowIndicator, scrollRef, scrollToNow };
}
