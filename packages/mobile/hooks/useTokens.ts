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
 * Convert a named Stagelight type role into a React Native text style.
 * fontFamily is intentionally omitted — the web stack ("Space Grotesk", …)
 * isn't a valid RN family name, so we let RN use the system font until custom
 * fonts are registered. Sizes come straight from the shared ramp.
 */
export function typeStyle(role: TypeRoleName): TextStyle {
  const r = typeRoles[role];
  const style: TextStyle = {
    fontSize: r.size,
    lineHeight: Math.round(r.lineHeight * r.size),
    letterSpacing: r.letterSpacing * r.size,
    fontWeight: String(r.weight) as TextStyle['fontWeight'],
  };
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
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (t: Tokens) => T,
): () => T {
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
