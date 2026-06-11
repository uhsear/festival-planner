/**
 * Color tokens extracted from packages/web/src/styles/theme.css.
 * Pure data -- zero runtime dependencies.
 */

export const colors = {
  bg: {
    primary: '#0a0a0a',
    secondary: '#1a1a1a',
    card: 'rgba(26, 26, 26, 0.65)',
    cardHover: 'rgba(38, 38, 38, 0.8)',
    input: 'rgba(20, 20, 20, 0.8)',
    hover: 'rgba(38, 38, 38, 0.8)',
    elevated: 'rgba(32, 32, 32, 0.9)',
    sticky: '#161616',
  },
  text: {
    primary: '#eaeaf2',
    secondary: '#9999bb',
    muted: '#8787a8',
    onAccent: '#ffffff',
    onLightAccent: '#0a0a0a',
    onDark: '#000000',
    onPoster: '#ffffff',
    danger: '#f87171',
    disabled: '#a8a8c0',
    placeholder: '#a8a8c0',
  },
  /**
   * Accent system rule (user-approved 2026-06-07):
   *   - `aqua` is the PRIMARY accent. On filled aqua surfaces use dark ink
   *     (`text.onLightAccent` #0a0a0a); that pair already passes WCAG AA.
   *   - `coral` is RESERVED for DANGER / SOS only — never as a primary CTA.
   *     `coral` (#ff3366) is for borders/glows/accents/text-on-dark; it only
   *     reaches ~3.55:1 against white text, which FAILS AA (4.5:1) for filled
   *     buttons.
   *   - `coralStrong` (#c01d3a) is the deepened coral for FILLED danger/SOS
   *     buttons with white text: it reaches ~6.04:1 against #fff (passes AA,
   *     and AAA for normal text). Use it whenever coral is the fill behind
   *     white label text; keep `coral` for the lighter accent uses.
   */
  accent: {
    coral: '#ff3366',
    coralStrong: '#c01d3a',
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
    bg: 'rgba(26, 26, 26, 0.65)',
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
  // DC12: selected-day pill unified on aqua across web + mobile (accent rule:
  // aqua = primary/selected). Was the improvised crimson #c01d3a.
  dayTab: {
    active: '#00e8d0',
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
    // R3 outline-secondary border (0.4 resting / 0.7 active). Mobile needs the
    // literal since RN lacks an opacity-modifier syntax; web uses accent-aqua/40.
    40: 'rgba(0, 232, 208, 0.4)',
    70: 'rgba(0, 232, 208, 0.7)',
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
