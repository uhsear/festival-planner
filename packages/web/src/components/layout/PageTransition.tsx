import React from 'react';
import { m, useReducedMotion } from 'motion/react';
import { useLocation } from '@tanstack/react-router';

interface PageTransitionProps {
  children: React.ReactNode;
}

/**
 * PageTransition: lightweight fade-in on route change.
 *
 * Previously used AnimatePresence with mode="wait" + 250 ms enter/exit +
 * an 8 px Y-translate. On mobile that combination made the first scroll
 * after a tab switch feel laggy — the new page was semi-transparent,
 * transforming, and code-split chunks were still loading. Removing
 * AnimatePresence wait-mode lets the new page mount immediately; the Y
 * translate is gone (transforms force compositor repaints); duration is
 * 120 ms opacity-only so the content is interactive within two frames.
 */
export default function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const key = location.pathname;
  // The global CSS prefers-reduced-motion block can't reach JS-driven Motion, so
  // gate the enter animation here: under reduce-motion the page mounts in place.
  const reduce = useReducedMotion();

  return (
    <m.div
      key={key}
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      /* ease-out cubic-bezier matches --ease-out token in globals.css;
         180ms is long enough to read the hierarchy shift (4px Y translate)
         without delaying first interaction. transform-only Y keeps this on
         the compositor — no layout thrash. */
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="will-change-[opacity,transform] h-full flex flex-col min-h-0"
    >
      {children}
    </m.div>
  );
}
