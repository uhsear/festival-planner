import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Detects whether a horizontally-scrollable container can scroll in each
 * direction, returning `canScrollLeft` / `canScrollRight` booleans that
 * drive CSS fade-indicator classes. Re-checks on scroll, resize, and
 * content mutation so the indicators stay in sync as the viewport or
 * child count changes.
 */
export function useScrollFade<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 2 px threshold absorbs sub-pixel rounding on HiDPI screens.
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Initial check (rAF so layout is settled after mount/lazy-load).
    const rafId = requestAnimationFrame(check);

    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);

    // Watch for child-list changes (e.g. stage chips added after fetch).
    let observer: MutationObserver | undefined;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(check);
      observer.observe(el, { childList: true, subtree: true });
    }

    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      observer?.disconnect();
    };
  }, [check]);

  return { ref, canScrollLeft, canScrollRight, check };
}
