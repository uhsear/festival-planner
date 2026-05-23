/**
 * Border-radius tokens extracted from packages/web/src/styles/theme.css.
 * Values in pixels (numbers) for React Native compatibility.
 */

export const radii = {
  xs: 4,
  sm: 8,
  md: 10,
  default: 12,
  lg: 20,
  pill: 999,
} as const;

export type Radii = typeof radii;
