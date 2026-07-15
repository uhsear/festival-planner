import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppState, type ScrollView } from 'react-native';
import { useReduceMotion } from './useReduceMotion';

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
  const reduceMotion = useReduceMotion();
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
    let nowMins = now.getHours() * 60 + now.getMinutes();
    // Post-midnight rollover: festivals whose schedule extends past midnight
    // (e.g. 14:00-02:00) have timeBounds.maxMin > 24*60. When the wall clock
    // reads 00:30 (30 mins) but the grid ends at 26*60 (=02:00 next day), add
    // 24h so 30 becomes 24*60+30 = 1470, placing the indicator correctly.
    if (timeBounds.maxMin > 24 * 60 && nowMins < timeBounds.minMin) {
      nowMins += 24 * 60;
    }
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
    el.scrollTo({ y: Math.max(0, targetY - 120), animated: !reduceMotion });
  }, [nowIndicator, timeBounds, rowHeight, reduceMotion]);

  // Keep a ref to the latest scrollToNow so the day-switch effect can call it
  // without listing it (or nowIndicator) as a dep — depending on nowIndicator
  // would re-scroll on every 30s tick, not just on a day change.
  const scrollToNowRef = useRef(scrollToNow);
  useEffect(() => {
    scrollToNowRef.current = scrollToNow;
  }, [scrollToNow]);

  // Auto-scroll to now once per day switch (matches web's rAF-on-day-change).
  // scrollToNow no-ops when nowIndicator is null, so the guard rides along.
  useEffect(() => {
    const id = requestAnimationFrame(() => scrollToNowRef.current());
    return () => cancelAnimationFrame(id);
  }, [selectedDay]);

  return { nowIndicator, scrollRef, scrollToNow };
}
