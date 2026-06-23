import { useState, useEffect, useMemo } from 'react';

/**
 * Tracks viewport dimensions and computes a responsive row height for the
 * 15-minute timeline grid.  Desktop/tablet keeps a fixed 36 px row; mobile
 * computes `(availableH - header) / totalSlots` with a 26 px floor.
 */
export function useTimelineViewport(totalSlots: number | undefined) {
  const [vpH, setVpH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  const [vpW, setVpW] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));

  useEffect(() => {
    let rafId: number | null = null;
    const onResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        setVpH(window.innerHeight);
        setVpW(window.innerWidth);
        rafId = null;
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const rowHeight = useMemo(() => {
    if (vpW > 430) return 36; // desktop / tablet stays dense
    const reserved = 160 + 40;
    const avail = Math.max(280, vpH - reserved);
    const slots = totalSlots ?? 20;
    return Math.max(26, Math.min(36, Math.floor(avail / slots)));
  }, [vpH, vpW, totalSlots]);

  return { vpH, vpW, rowHeight };
}
