/**
 * Motion tokens extracted from packages/web/src/styles/theme.css.
 *
 * Easing curves are provided in two forms:
 *   - `css`: the CSS cubic-bezier() string (for web)
 *   - `bezier`: a 4-tuple of control points (for React Native Animated / Reanimated)
 *
 * Durations are in milliseconds (numbers).
 */

export const easing = {
  out: {
    css: 'cubic-bezier(0.16, 1, 0.3, 1)' as const,
    bezier: [0.16, 1, 0.3, 1] as const,
  },
  in: {
    css: 'cubic-bezier(0.4, 0, 1, 1)' as const,
    bezier: [0.4, 0, 1, 1] as const,
  },
  standard: {
    css: 'cubic-bezier(0.4, 0, 0.2, 1)' as const,
    bezier: [0.4, 0, 0.2, 1] as const,
  },
  outQuart: {
    css: 'cubic-bezier(0.25, 1, 0.5, 1)' as const,
    bezier: [0.25, 1, 0.5, 1] as const,
  },
  inQuart: {
    css: 'cubic-bezier(0.5, 0, 0.75, 0)' as const,
    bezier: [0.5, 0, 0.75, 0] as const,
  },
} as const;

export const duration = {
  fast: 120,
  med: 200,
  slow: 320,
} as const;

/**
 * Duration, split by WHAT IS MOVING. `duration` above is unchanged and stays
 * the general-purpose scale; these two groups are additive and name the axis.
 *
 * Published guidance (Material 3 motion, and the same split in Apple's HIG
 * "reduce motion" notes) is that SPATIAL motion — anything changing position
 * or size — must settle more slowly than an EFFECT — anything changing only
 * opacity or colour. A fade has no momentum to read, so a slow one just feels
 * laggy; a moving object needs the extra time for the eye to track it, and it
 * may overshoot on arrival.
 *
 *   effects — opacity, colour, shadow. NO overshoot, ease only.
 *   spatial — position, size, translation. MAY overshoot (see `spring`).
 *
 * WHERE THE NUMBERS CAME FROM — nothing was imported from outside this repo:
 *   - `effects` IS the existing `duration` scale, aliased. Those three values
 *     were tuned on fades and transitions in the deployed web SPA, so they are
 *     already the effects scale; naming them costs nothing and moves nothing.
 *   - `spatial` is that same scale shifted one rung up (fast 120→200,
 *     med 200→320), which makes spatial slower than effects at every step by
 *     construction. The new top rung continues the ramp's own ratio: the
 *     existing scale steps by ~1.6x (120→200→320), and 320 x 1.5 = 480.
 * Result: only ONE new number (480) enters the system, and no existing value
 * moves. Anything importing `duration` is untouched.
 */
export const durationEffects = {
  fast: duration.fast,
  med: duration.med,
  slow: duration.slow,
} as const;

export const durationSpatial = {
  fast: duration.med,
  med: duration.slow,
  slow: 480,
} as const;

/**
 * Spring preset for anything A FINGER TOUCHES or that CAN BE INTERRUPTED —
 * press states, drag release, sheet snap, any gesture-driven transform. A
 * curve + duration cannot be interrupted gracefully: re-targeting mid-flight
 * restarts the easing and the object visibly stutters. A spring carries its
 * velocity into the new target, so an interrupted press looks continuous.
 *
 * PHYSICAL FORM ON PURPOSE — THE REANIMATED 4 DURATION TRAP:
 * `withSpring` accepts EITHER a physical config (mass/stiffness/damping) OR a
 * `duration` + `dampingRatio` config. In Reanimated 4 (this repo pins
 * react-native-reanimated ~4.3.1) that `duration` is a PERCEPTUAL duration —
 * the time until the motion reads as finished — and the animation keeps
 * settling after it. Real wall-clock settle time runs roughly 1.5x longer, so
 * `withSpring(v, { duration: 300 })` is done to the eye at ~300ms and actually
 * finishes near ~450ms. A preset written as `duration: durationSpatial.med`
 * would therefore NOT be a 320ms animation, and anything sequencing off it
 * would fire early.
 * This preset carries NO `duration` field, so the trap cannot apply to it. If
 * you ever do need the duration form, divide the wall-clock time you want by
 * 1.5 first: for a real 320ms settle, pass `duration: 213`.
 *
 * The physical values are chosen against `durationSpatial`, not guessed:
 *   mass 1, stiffness 300, damping 30
 *   -> undamped frequency w = sqrt(k/m) = 17.32 rad/s
 *   -> damping ratio z = c / (2*sqrt(k*m)) = 30 / 34.64 = 0.87
 * z < 1 means it overshoots slightly, which is allowed for spatial motion and
 * is what makes a press feel physical. Settling time to a 2% band is
 * 4 / (z*w) = 4 / 15.0 = 0.27s — just inside durationSpatial.med (320ms), so
 * the spring and the spatial scale agree about how long "medium" feels.
 *
 * Use with the property-based overload:
 *   withSpring(0.96, spring.touch)
 */
export const spring = {
  touch: {
    mass: 1,
    stiffness: 300,
    damping: 30,
  },
} as const;

export type Easing = typeof easing;
export type Duration = typeof duration;
export type DurationEffects = typeof durationEffects;
export type DurationSpatial = typeof durationSpatial;
export type Spring = typeof spring;
