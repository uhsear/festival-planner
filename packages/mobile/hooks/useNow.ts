import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Returns a "now" timestamp (ms since epoch) that refreshes on an interval,
 * so render bodies and useMemo factories can derive time-relative values
 * without calling the impure `Date.now()` directly during render
 * (react-hooks/purity). Mirrors the tick pattern in `useNowIndicator`.
 *
 * The default 30s cadence matches the timeline indicator; pass a coarser
 * interval for screens that only need minute-level staleness.
 *
 * iOS suspends JS timers while backgrounded, so we also snap to the real clock
 * the instant the app returns to the foreground.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs]);

  return now;
}
