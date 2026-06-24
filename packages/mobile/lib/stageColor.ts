import { resolveStageColor } from '@festie/shared/utils';

/**
 * Stage colors come from the API. When a stage has no color the shared
 * `getStageColor` returns the platform-neutral `STAGE_COLOR_FALLBACK` sentinel —
 * `resolveStageColor` maps that (and any nullish value) to a real RN token.
 * We additionally guard against any legacy `var(...)` CSS custom property that
 * React Native can't parse, substituting the token there too.
 */
export function safeStageColor(color: string | undefined, fallback: string): string {
  if (color && color.startsWith('var(')) return fallback;
  return resolveStageColor(color, fallback);
}
