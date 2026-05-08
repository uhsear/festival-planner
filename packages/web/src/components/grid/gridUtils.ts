/**
 * Shared constants and utility functions for the timeline grid view.
 */

export const PICK_COLOR: Record<string, string> = {
  must: 'var(--color-accent-coral)',
  'want-to-see': 'var(--color-accent-aqua)',
  maybe: 'var(--color-accent-amber)',
};

/**
 * PX_PER_MIN adapts to viewport width: narrower mobile -> denser (1.6 px/min)
 * so a 7-hour day fits in <= 680 px and the user still sees most of the day at
 * once. On tablet/desktop we keep 2 px/min (120 px/hr) for readability.
 */
export function getPxPerMin(viewportW: number): number {
  if (viewportW <= 360) return 1.4;
  if (viewportW <= 430) return 1.6;
  return 2;
}

export function getGutterW(viewportW: number): number {
  if (viewportW <= 430) return 38;
  return 52;
}

export function toMin(t: string): number {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fmtHour(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
}

export function fmtShort(t: string): string {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}

export interface GridBounds {
  lo: number;
  hi: number;
  span: number;
}

export interface HourMark {
  m: number;
  px: number;
}
