/**
 * Spacing tokens extracted from packages/web/src/styles/theme.css.
 * Values in pixels (numbers) for React Native compatibility.
 *
 * @theme scale: 4px base (--space-1 = 0.25rem = 4px)
 * Legacy scale: named sizes (--space-xs through --space-2xl)
 */

export const spacing = {
  /** 4px-base scale from @theme --space-* tokens. */
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** Legacy named spacing aliases (px values). */
export const spacingNamed = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

/** Max inline measure for prose content (in ch units, as a number). */
export const measureProse = 65 as const;

export type Spacing = typeof spacing;
export type SpacingNamed = typeof spacingNamed;
