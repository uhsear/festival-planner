import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { TextStyle } from 'react-native';
import {
  colors,
  spacing,
  fontSize,
  fontFamily,
  lineHeight,
  letterSpacing,
  radii,
  typeRoles,
} from '@festie/shared/tokens';
import type { TypeRoleName } from '@festie/shared/tokens';

/**
 * The mobile design-token surface. Screens should pull tokens from here (via
 * useTokens / makeStyles) instead of re-typing values or importing scattered
 * token modules — this is the single seam a future theme switch hooks into.
 */

/**
 * Icon-size scale. Reach for these instead of inline literals.
 *
 * New-code rule: never write `size={N}` for an Ionicons/icon where N isn't in
 * this scale. Map to the nearest step (13→xs/12, 15→sm/16 are the historical
 * off-grid values; both are explicitly snapped here).
 *
 * Scale: 12/14/16/18/20/24/48. `compact` (14) and `action` (18) were promoted
 * from de-facto usage in this audit — 18 alone covers 56 row-action call sites.
 *
 *   xs: 12       — inline badge / meta-row indicators
 *   compact: 14  — inline meta/link icons
 *   sm: 16       — in-line action icons (buttons, tab icons)
 *   action: 18   — row-action icons (most-used size in the app)
 *   md: 20       — medium stand-alone controls
 *   lg: 24       — screen-level leading icons, header icons
 *   xl: 48       — empty-state / hero icons
 */
export const iconSize = {
  xs: 12,
  compact: 14,
  sm: 16,
  action: 18,
  md: 20,
  lg: 24,
  xl: 48,
} as const;

export const tokens = {
  colors,
  spacing,
  fontSize,
  fontFamily,
  lineHeight,
  letterSpacing,
  radii,
  typeRoles,
  iconSize,
} as const;

export type Tokens = typeof tokens;

/**
 * Resolve a shared type-role's (web) font family + weight to the concrete native
 * font variant registered at app bootstrap (see app/_layout.tsx's `useFonts`).
 *
 * The brand fonts ship as weight-specific families (e.g. `SpaceGrotesk_700Bold`)
 * rather than a single family + a numeric `fontWeight`, so we map each role's
 * weight onto the nearest available cut:
 *   - display roles  -> Syncopate (ships 400 + 700; every display role is 700)
 *   - body roles     -> Space Grotesk (400 / 500 / 600 / 700)
 * Returns undefined for an unrecognized family so we fall back to the system
 * font instead of pointing at a face that was never loaded.
 */
function nativeFontFamily(family: string, weight: number): string | undefined {
  if (family.includes('Syncopate')) {
    return weight >= 700 ? 'Syncopate_700Bold' : 'Syncopate_400Regular';
  }
  if (family.includes('Space Grotesk')) {
    if (weight >= 700) return 'SpaceGrotesk_700Bold';
    if (weight >= 600) return 'SpaceGrotesk_600SemiBold';
    if (weight >= 500) return 'SpaceGrotesk_500Medium';
    return 'SpaceGrotesk_400Regular';
  }
  return undefined;
}

/**
 * Convert a named Stagelight type role into a React Native text style.
 * fontFamily resolves to the brand face (Syncopate for display roles, Space
 * Grotesk for body roles) registered at bootstrap; the app is gated behind the
 * splash until those fonts load, so the family is always available by the time
 * any screen renders. Sizes come straight from the shared ramp. `fontWeight` is
 * retained for web/iOS fidelity; on native the weighted family is authoritative.
 *
 * Pass an optional `weight` to override the role's default — the correct
 * weight-specific font cut is selected automatically (800/900 clamp to 700Bold).
 * Use this instead of spreading typeStyle() and then adding a raw `fontWeight`
 * override (which is inert on native because the weighted family wins).
 *
 * @example
 *   // Wrong — fontWeight '700' does nothing on native:
 *   { ...typeStyle('caption'), fontWeight: '700' }
 *
 *   // Right — selects SpaceGrotesk_700Bold:
 *   typeStyle('caption', 700)
 */
export function typeStyle(role: TypeRoleName, weight?: number): TextStyle {
  const r = typeRoles[role];
  const resolvedWeight = weight ?? r.weight;
  // Clamp 800/900 to 700 — no loaded cut above Bold for either brand face.
  const clampedWeight = Math.min(resolvedWeight, 700);
  const style: TextStyle = {
    fontSize: r.size,
    lineHeight: Math.round(r.lineHeight * r.size),
    // Negative tracking is clamped to 0 on BOTH native platforms. iOS kerns
    // after the final glyph (clipping it: "Add to calenda"); Android's
    // fractional negative letterSpacing under-measures the text node by ~one
    // glyph even in unconstrained containers ("Uploa", "Of"). The R5 negative
    // display ramp remains web-only via theme.css.
    letterSpacing: Math.max(0, r.letterSpacing * r.size),
  };
  const family = nativeFontFamily(r.family, clampedWeight);
  if (family) {
    // The weight-specific family IS the weight on native. Do NOT also set
    // fontWeight: Android applies synthetic (fake) bold on top of the already
    // weighted face, drawing glyphs wider than they were measured — clipping
    // the trailing character ("Uploa", "Of"). iOS ignores it; web never
    // reaches this code path.
    style.fontFamily = family;
  } else {
    // System-font fallback: no weighted family loaded, so the numeric weight
    // is the only weight signal.
    style.fontWeight = String(resolvedWeight) as TextStyle['fontWeight'];
  }
  if ('transform' in r && r.transform) {
    style.textTransform = r.transform;
  }
  return style;
}

/**
 * F12: Sensible Dynamic Type cap for fixed/single-line decorative contexts
 * (chips, pills, badges) where unbounded scaling causes truncation or layout
 * break rather than reflow. Body/notes text should scale fully — only apply
 * this to numberOfLines={1} or fixed-height containers.
 *
 * Usage: add `maxFontSizeMultiplier={MAX_FONT_SCALE}` to the Text prop.
 */
export const MAX_FONT_SCALE = 1.4;

/** Returns the active design tokens. Single theme today; stable reference. */
export function useTokens(): Tokens {
  return tokens;
}

/**
 * Build a memoized StyleSheet from a token-aware factory. The sheet is created
 * once (cached) rather than rebuilt on every render or re-typed inline per
 * screen. When theming lands, the cache becomes keyed by the active theme.
 *
 * Usage:
 *   const useStyles = makeStyles((t) => ({ container: { padding: t.spacing[4] } }));
 *   function Screen() { const s = useStyles(); ... }
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (t: Tokens) => T): () => T {
  let cache: T | null = null;
  return function useStyles(): T {
    return useMemo(() => {
      if (!cache) {
        cache = StyleSheet.create(factory(tokens));
      }
      return cache;
    }, []);
  };
}
