/**
 * Stage color resolution — platform-neutral.
 *
 * The festival API supplies a real color per stage (a hex). When a stage has no
 * color, the shared `useFestival.getStageColor` returns the neutral sentinel
 * `STAGE_COLOR_FALLBACK` rather than a web-only CSS custom property — shared must
 * stay free of `var(--…)` (RN can't parse it) and of any per-platform token name.
 *
 * Each platform maps the sentinel to its own muted value at the consumption
 * boundary via `resolveStageColor`:
 *   web    → resolveStageColor(c, 'var(--text-muted)')
 *   mobile → resolveStageColor(c, tokens.colors.text.muted)
 *
 * Everything here is PURE — no globals, no DOM, no RN — so both consumers and a
 * Vitest unit can call it identically.
 */

/**
 * Neutral "no stage color" identifier returned by `getStageColor` when a stage
 * carries no API color. Deliberately NOT a valid CSS color and NOT a platform
 * token — callers must map it through `resolveStageColor` to a real value.
 */
export const STAGE_COLOR_FALLBACK = 'stage-color-fallback';

/**
 * Resolve a stage color to a concrete platform value. Returns `fallback` when the
 * color is missing or is the neutral `STAGE_COLOR_FALLBACK` sentinel; otherwise
 * returns the color unchanged (the real API hex).
 */
export function resolveStageColor(color: string | null | undefined, fallback: string): string {
  if (!color || color === STAGE_COLOR_FALLBACK) return fallback;
  return color;
}
