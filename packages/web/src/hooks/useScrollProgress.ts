import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives scroll-linked UI (R11 timeline beam, R13 shrinking header) from a
 * single scroll listener on a scrollable container.
 *
 * Sets a `--scroll-progress` custom property (0→1) on the container element so
 * pure-CSS consumers (the timeline beam height) can read it without React
 * re-renders. Also returns `scrolled` (boolean, scrollTop past `threshold`) and
 * `scrollingUp` for header collapse logic — those DO drive React state but only
 * flip on a crossing, not on every scroll frame.
 *
 * Browsers that support CSS `animation-timeline: scroll()` (Baseline 2026) get
 * the beam fill natively via the stylesheet; this hook's `--scroll-progress`
 * update is the universal fallback, guarded behind `@supports not (...)` in CSS
 * so it never double-drives on modern engines. The boolean state (header) has no
 * pure-CSS equivalent, so it always runs.
 */
export function useScrollProgress<T extends HTMLElement>(threshold = 80) {
  const ref = useRef<T | null>(null);
  const prevTopRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [scrollingUp, setScrollingUp] = useState(false);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el || rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const node = ref.current;
      if (!node) return;
      const top = node.scrollTop;
      const max = node.scrollHeight - node.clientHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, top / max)) : 0;
      node.style.setProperty('--scroll-progress', String(progress));
      // Keep gutter-pinned children (the R11 beam) glued to the left gutter as
      // the timeline scrolls horizontally — the time labels are `sticky left-0`,
      // so the beam must track scrollLeft to stay aligned with them.
      node.style.setProperty('--scroll-left', `${node.scrollLeft}px`);
      setScrolled(top > threshold);
      // Treat tiny jitter as "no direction change" to avoid header flicker.
      if (Math.abs(top - prevTopRef.current) > 4) {
        setScrollingUp(top < prevTopRef.current);
        prevTopRef.current = top;
      }
    });
  }, [threshold]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { ref, scrolled, scrollingUp, handleScroll };
}
