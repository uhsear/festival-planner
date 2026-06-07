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
export const tokens = {
  colors,
  spacing,
  fontSize,
  fontFamily,
  lineHeight,
  letterSpacing,
  radii,
  typeRoles,
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
 */
export function typeStyle(role: TypeRoleName): TextStyle {
  const r = typeRoles[role];
  const style: TextStyle = {
    fontSize: r.size,
    lineHeight: Math.round(r.lineHeight * r.size),
    letterSpacing: r.letterSpacing * r.size,
    fontWeight: String(r.weight) as TextStyle['fontWeight'],
  };
  const family = nativeFontFamily(r.family, r.weight);
  if (family) {
    style.fontFamily = family;
  }
  if ('transform' in r && r.transform) {
    style.textTransform = r.transform;
  }
  return style;
}

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
