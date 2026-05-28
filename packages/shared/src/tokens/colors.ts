/**
 * Color tokens extracted from packages/web/src/styles/theme.css.
 * Pure data -- zero runtime dependencies.
 */

export const colors = {
  bg: {
    primary: '#080810',
    secondary: '#0e0e1a',
    card: 'rgba(20, 20, 38, 0.65)',
    cardHover: 'rgba(32, 32, 58, 0.8)',
    input: 'rgba(16, 16, 34, 0.8)',
    hover: 'rgba(32, 32, 58, 0.8)',
    elevated: 'rgba(24, 24, 44, 0.9)',
    sticky: '#14142a',
  },
  text: {
    primary: '#eaeaf2',
    secondary: '#9999bb',
    muted: '#8787a8',
    onAccent: '#ffffff',
    onLightAccent: '#080810',
    onDark: '#000000',
    onPoster: '#ffffff',
    danger: '#f87171',
    disabled: '#a8a8c0',
    placeholder: '#a8a8c0',
  },
  accent: {
    coral: '#ff3366',
    aqua: '#00e8d0',
    amber: '#ffb020',
    green: '#39ff14',
    blue: '#4488ff',
  },
  border: {
    default: 'rgba(255, 255, 255, 0.06)',
    light: 'rgba(255, 255, 255, 0.1)',
  },
  priority: {
    must: '#ff3366',
    want: '#00e8d0',
    maybe: '#ffb020',
  },
  glass: {
    bg: 'rgba(20, 20, 38, 0.65)',
    border: 'rgba(255, 255, 255, 0.08)',
  },
  stage: {
    purpleAccessible: '#9c4dcb',
    fallback: '#8787a8',
  },
  /** Focus rings — always paired with a border/outline change, never sole. */
  ring: {
    coral: 'rgba(255, 51, 102, 0.15)',
    aqua: 'rgba(0, 232, 208, 0.15)',
  },
  dayTab: {
    active: '#c01d3a',
  },
  status: {
    verified: '#22c55e',
    unverified: '#fbbf24',
    verifiedBg: 'rgba(34, 197, 94, 0.15)',
    unverifiedBg: 'rgba(251, 191, 36, 0.15)',
    warning: '#f0a030',
    error: '#ff6b6b',
  },
  spotify: {
    brand: '#1DB954',
  },
  cookieBanner: {
    textLight: '#1f2937',
  },
  wrapPoster: {
    bg1: '#0a0a1a',
    bg2: '#1a0a2e',
    bg3: '#0a1a2e',
  },
  /** Glow box-shadow values (web-only, kept as strings). */
  glow: {
    coral: '0 0 24px rgba(255, 51, 102, 0.35)',
    aqua: '0 0 24px rgba(0, 232, 208, 0.3)',
    amber: '0 0 20px rgba(255, 176, 32, 0.3)',
    green: '0 0 20px rgba(57, 255, 20, 0.3)',
  },
  /** White overlay scale (rgba strings). */
  overlay: {
    1: 'rgba(255, 255, 255, 0.03)',
    2: 'rgba(255, 255, 255, 0.04)',
    3: 'rgba(255, 255, 255, 0.06)',
    4: 'rgba(255, 255, 255, 0.08)',
    5: 'rgba(255, 255, 255, 0.1)',
    hi: 'rgba(255, 255, 255, 0.95)',
  },
  /** Black shade scale (rgba strings). */
  shade: {
    1: 'rgba(0, 0, 0, 0.04)',
    2: 'rgba(0, 0, 0, 0.06)',
    3: 'rgba(0, 0, 0, 0.08)',
    4: 'rgba(0, 0, 0, 0.1)',
    5: 'rgba(0, 0, 0, 0.12)',
    6: 'rgba(0, 0, 0, 0.15)',
    7: 'rgba(0, 0, 0, 0.2)',
    8: 'rgba(0, 0, 0, 0.4)',
    9: 'rgba(0, 0, 0, 0.45)',
    10: 'rgba(0, 0, 0, 0.75)',
  },
  /** Aqua alpha scale (rgba strings). */
  aquaAlpha: {
    6: 'rgba(0, 232, 208, 0.06)',
    8: 'rgba(0, 232, 208, 0.08)',
    10: 'rgba(0, 232, 208, 0.1)',
    12: 'rgba(0, 232, 208, 0.12)',
    15: 'rgba(0, 232, 208, 0.15)',
    20: 'rgba(0, 232, 208, 0.2)',
    30: 'rgba(0, 232, 208, 0.3)',
  },
  /** Amber alpha scale (rgba strings). */
  amberAlpha: {
    8: 'rgba(255, 176, 32, 0.08)',
    12: 'rgba(255, 176, 32, 0.12)',
    20: 'rgba(255, 176, 32, 0.2)',
    30: 'rgba(255, 176, 32, 0.3)',
  },
  /** Raw RGB channel values for use in rgba() expressions. */
  rgb: {
    coral: '255, 51, 102',
    spotify: '29, 185, 84',
  },
} as const;

export type Colors = typeof colors;
