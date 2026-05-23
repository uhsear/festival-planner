/**
 * Typography tokens extracted from packages/web/src/styles/theme.css.
 * Font sizes in pixels (numbers) for React Native compatibility.
 * Line heights as unitless ratios. Letter spacing in em (as numbers).
 */

export const fontFamily = {
  body: "'Space Grotesk', system-ui, sans-serif",
  display: "'Syncopate', sans-serif",
} as const;

/** Font size ramp in pixels (numbers). */
export const fontSize = {
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  18: 18,
  20: 20,
  24: 24,
  32: 32,
  48: 48,
} as const;

/** Unitless line-height ratios. */
export const lineHeight = {
  tight: 1.15,
  snug: 1.3,
  normal: 1.5,
  relaxed: 1.6,
} as const;

/**
 * Letter spacing in em (as numbers).
 * Multiply by font size to get px value on RN.
 */
export const letterSpacing = {
  display: 0.06,
  caps: 0.08,
  body: -0.01,
} as const;

export type FontFamily = typeof fontFamily;
export type FontSize = typeof fontSize;
export type LineHeight = typeof lineHeight;
export type LetterSpacing = typeof letterSpacing;
