/**
 * Breakpoint tokens extracted from packages/web/src/styles/theme.css.
 * Values in pixels (numbers) for programmatic use.
 *
 * CSS originals are in rem (1rem = 16px):
 *   sm: 40rem = 640px, md: 48rem = 768px, lg: 64rem = 1024px,
 *   xl: 80rem = 1280px, 2xl: 96rem = 1536px
 */

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoints = typeof breakpoints;
