/**
 * Z-index tokens extracted from packages/web/src/styles/theme.css.
 * Values as numbers for both web and React Native.
 */

export const zIndex = {
  base: 0,
  sticky: 10,
  dropdown: 100,
  overlay: 1000,
  modal: 2000,
  toast: 3000,
  cookie: 4000,
  top: 9999,
} as const;

export type ZIndex = typeof zIndex;
