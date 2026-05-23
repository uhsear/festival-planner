/**
 * Motion tokens extracted from packages/web/src/styles/theme.css.
 *
 * Easing curves are provided in two forms:
 *   - `css`: the CSS cubic-bezier() string (for web)
 *   - `bezier`: a 4-tuple of control points (for React Native Animated / Reanimated)
 *
 * Durations are in milliseconds (numbers).
 */

export const easing = {
  out: {
    css: 'cubic-bezier(0.16, 1, 0.3, 1)' as const,
    bezier: [0.16, 1, 0.3, 1] as const,
  },
  in: {
    css: 'cubic-bezier(0.4, 0, 1, 1)' as const,
    bezier: [0.4, 0, 1, 1] as const,
  },
  spring: {
    css: 'cubic-bezier(0.34, 1.56, 0.64, 1)' as const,
    bezier: [0.34, 1.56, 0.64, 1] as const,
  },
  standard: {
    css: 'cubic-bezier(0.4, 0, 0.2, 1)' as const,
    bezier: [0.4, 0, 0.2, 1] as const,
  },
  /** Legacy aliases from :root (web-only). */
  outExpo: {
    css: 'cubic-bezier(0.16, 1, 0.3, 1)' as const,
    bezier: [0.16, 1, 0.3, 1] as const,
  },
  outQuart: {
    css: 'cubic-bezier(0.25, 1, 0.5, 1)' as const,
    bezier: [0.25, 1, 0.5, 1] as const,
  },
  inQuart: {
    css: 'cubic-bezier(0.5, 0, 0.75, 0)' as const,
    bezier: [0.5, 0, 0.75, 0] as const,
  },
} as const;

export const duration = {
  fast: 120,
  med: 200,
  slow: 320,
} as const;

export type Easing = typeof easing;
export type Duration = typeof duration;
