import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export interface AnimatedNumberOptions {
  /** Tween length in ms. */
  duration?: number;
  /** Fraction digits in the returned string (0 = integer, 1 = one decimal, …). */
  decimals?: number;
  /**
   * Starting value for a mount tween (e.g. 0 for Wrap poster stats). When
   * omitted the first render snaps straight to `value` and only subsequent
   * changes animate — the right default for live metrics that update in place.
   */
  startFrom?: number;
}

/**
 * N1: animated number transitions for live metrics. Tweens from the currently
 * displayed value to `value` with a requestAnimationFrame loop (ease-out cubic,
 * no library), so totals/counts count up or down instead of hard-cutting.
 *
 * prefers-reduced-motion (via motion/react's useReducedMotion, the existing
 * reduce-motion seam in this app) snaps instantly to the final value.
 * Non-finite targets also snap so NaN never animates.
 */
export function useAnimatedNumber(
  value: number,
  { duration = 500, decimals = 0, startFrom }: AnimatedNumberOptions = {},
): string {
  const prefersReducedMotion = useReducedMotion();
  const snap = prefersReducedMotion || !Number.isFinite(value);
  // The on-screen value — doubles as the tween's "from" when `value` changes.
  const shownRef = useRef(snap || startFrom === undefined ? value : startFrom);
  const [shown, setShown] = useState(shownRef.current);

  useEffect(() => {
    if (snap || shownRef.current === value) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    const start = performance.now();
    let raf: number;
    const step = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const v = from + (value - from) * easeOutCubic(p);
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // duration/snap are config — re-running on them would restart a live tween.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return shown.toFixed(decimals);
}
