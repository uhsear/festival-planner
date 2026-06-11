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
  display: -0.02,
  caps: 0.08,
  body: -0.01,
} as const;

/**
 * Named type roles (Stagelight). Bundle family/size/line-height/tracking/weight
 * so a "title" is the same on web and React Native. Sizes are the existing
 * ramp (no new pixel values). 11px/13px are intentionally absent — round to
 * 12 or 14. `transform: 'uppercase'` applies to the micro role only.
 */
export const typeRoles = {
  'display-xl': {
    family: fontFamily.display,
    size: fontSize[48],
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.display,
    weight: 700,
  },
  'display-lg': {
    family: fontFamily.display,
    size: fontSize[32],
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.display,
    weight: 700,
  },
  heading: {
    family: fontFamily.display,
    size: fontSize[24],
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.display,
    weight: 700,
  },
  title: {
    family: fontFamily.body,
    size: fontSize[20],
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.body,
    weight: 600,
  },
  body: {
    family: fontFamily.body,
    size: fontSize[16],
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.body,
    weight: 400,
  },
  label: {
    family: fontFamily.body,
    size: fontSize[14],
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.body,
    weight: 500,
  },
  caption: { family: fontFamily.body, size: fontSize[12], lineHeight: lineHeight.snug, letterSpacing: 0, weight: 400 },
  micro: {
    family: fontFamily.body,
    size: fontSize[10],
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.caps,
    weight: 600,
    transform: 'uppercase' as const,
  },
} as const;

export type FontFamily = typeof fontFamily;
export type FontSize = typeof fontSize;
export type LineHeight = typeof lineHeight;
export type LetterSpacing = typeof letterSpacing;
export type TypeRoles = typeof typeRoles;
export type TypeRoleName = keyof typeof typeRoles;
