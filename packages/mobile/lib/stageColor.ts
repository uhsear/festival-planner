/**
 * Stage colors come from the API but the web fallback is a CSS custom property
 * (`var(--text-muted)`) that React Native can't parse. Guard against any
 * `var(...)` value (or a missing color) and substitute a real token instead.
 */
export function safeStageColor(color: string | undefined, fallback: string): string {
  if (!color || color.startsWith('var(')) return fallback;
  return color;
}
