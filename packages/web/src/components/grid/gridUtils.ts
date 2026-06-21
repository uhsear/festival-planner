/**
 * Shared constants and utility functions for the timeline grid view.
 *
 * Pure grid utils (toMin, fmtHour, fmtShort, getPxPerMin, getGutterW) and
 * interfaces (GridBounds, HourMark) now live in @festie/shared/utils so mobile
 * can consume them. Re-exported here so existing web call sites don't churn.
 *
 * PICK_COLOR stays here — it references CSS custom properties that are
 * web-only (var(--color-accent-*)) and are meaningless in React Native.
 */

export { toMin, fmtHour, fmtShort, getPxPerMin, getGutterW } from '@festie/shared/utils';
export type { GridBounds, HourMark } from '@festie/shared/utils';

export const PICK_COLOR: Record<string, string> = {
  must: 'var(--color-accent-coral)',
  'want-to-see': 'var(--color-accent-aqua)',
  maybe: 'var(--color-accent-amber)',
};
