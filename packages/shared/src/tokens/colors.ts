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
    // Functional (semantic) colors — NOT free accents. Each has one role:
    //   amber = warning / offline / low-power / pending state.
    //   green = success / online / verified state.
    // The one-accent rule still holds: aqua is the only brand accent; coral is
    // danger-only. Do not introduce a new hue here without a documented role.
    // (`blue` #4488ff was an unused rogue accent with no role — removed 2026-06-14.)
    amber: '#ffb020',
    green: '#39ff14',
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
  /**
   * Confidence — HOW OLD A FACT IS. Aliases only: every value below is an
   * existing hue, so this group adds no new contrast risk and no new brand
   * colour (the one-accent rule in `accent` still holds).
   *
   * THE RULE — A CONFIDENCE COLOUR IS NEVER USED ALONE.
   * Every use pairs the colour with BOTH:
   *   1. a NUMERAL — the age itself ("2m", "14m", "1h"), set in the `numeral`
   *      type role (tabular figures, so a column of ages aligns), and
   *   2. a SHAPE — a filled dot for `live`, a hollow ring for `aging`, a
   *      dashed ring for `stale`, a slashed ring for `dark`.
   * Colour is therefore the third signal, never the first. WCAG 1.4.1 (Use of
   * Colour) and "Differentiate Without Colour Alone" are satisfied HERE, at the
   * token layer, so a screen cannot accidentally opt out by reaching for the
   * colour on its own. If you find yourself using one of these as the only
   * difference between two states, the token is being misused: add the numeral
   * and the shape, or use a different token.
   *
   *   live  — fresh, still arriving      = accent.green  (the online/success green)
   *   aging — getting old, still usable  = accent.amber  (the pending/warning amber)
   *   stale — old, treat with suspicion  = text.muted
   *   dark  — the device is gone; this   = text.disabled
   *           is its LAST KNOWN fact
   *
   * `dark` IS BRIGHTER THAN `stale` ON PURPOSE. text.disabled (#a8a8c0, 8.51:1
   * on bg.primary) reads louder than text.muted (#8787a8, 5.71:1), which looks
   * like an inversion if you read the group as a single fade from certain to
   * uncertain. It is not that.
   *
   * `stale` and `dark` are different KINDS of state, not two points on one ramp.
   * A stale value is still claiming to be current and is decaying toward
   * irrelevance, so it should recede. A dark value has stopped claiming
   * anything: the device is gone and what remains is a frozen last-known fix,
   * with the time it froze. For a crew looking for someone whose phone died,
   * that frozen fact is the most valuable thing on the screen, and it stays
   * useful all night precisely because it never ages into a lie. Receding it
   * would hide the one datum the situation turns on.
   *
   * So the ordering that matters here is SALIENCE, not confidence, and the
   * shape ramp carries the confidence ordering instead: filled -> hollow ->
   * dashed -> slashed. Do not "fix" this by dimming `dark`.
   */
  confidence: {
    live: '#39ff14',
    aging: '#ffb020',
    stale: '#8787a8',
    dark: '#a8a8c0',
  },
  /**
   * Delivery — WHETHER YOUR ACTION LEFT THE PHONE. A DIFFERENT AXIS from
   * `confidence` and deliberately not folded into it: confidence is how old a
   * fact is, delivery is where your own action got to. A pick can be `local`
   * (never sent) and `live` (just made) at the same time, so the two groups
   * must be readable side by side.
   *
   * Aliases only, same reason as `confidence`. The same never-alone rule
   * applies: pair with an icon (phone / arrow-up / cloud-offline) and a label.
   *
   *   local  — on your phone only        = text.muted      (no claim made yet)
   *   sent   — acknowledged by the crew  = status.verified (the "verified" green)
   *   failed — waiting for signal        = accent.amber    (the documented
   *            offline/pending hue — NOT coral: a queued action is not an
   *            error, it retries. Reserve danger colour for danger.)
   */
  delivery: {
    local: '#8787a8',
    sent: '#22c55e',
    failed: '#ffb020',
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
