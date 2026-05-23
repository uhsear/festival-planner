/**
 * Design tokens extracted from packages/web/src/styles/theme.css.
 *
 * Pure TypeScript data -- zero runtime dependencies.
 * All values use `as const` for literal types.
 *
 * @example
 * ```ts
 * import { colors, spacing, radii } from '@festie/shared/tokens';
 *
 * // Web (CSS-in-JS)
 * const style = { backgroundColor: colors.bg.primary, padding: spacing[4] };
 *
 * // React Native
 * const rnStyle = { backgroundColor: colors.bg.primary, padding: spacing[4], borderRadius: radii.default };
 * ```
 */

export { colors } from './colors.js';
export type { Colors } from './colors.js';

export { spacing, spacingNamed, measureProse } from './spacing.js';
export type { Spacing, SpacingNamed } from './spacing.js';

export { fontFamily, fontSize, lineHeight, letterSpacing } from './typography.js';
export type { FontFamily, FontSize, LineHeight, LetterSpacing } from './typography.js';

export { easing, duration } from './motion.js';
export type { Easing, Duration } from './motion.js';

export { radii } from './radii.js';
export type { Radii } from './radii.js';

export { breakpoints } from './breakpoints.js';
export type { Breakpoints } from './breakpoints.js';

export { zIndex } from './z-index.js';
export type { ZIndex } from './z-index.js';
