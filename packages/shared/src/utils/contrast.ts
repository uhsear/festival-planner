/**
 * Pure WCAG 2.2 contrast helpers (SC 1.4.3) — zero runtime/DOM dependencies.
 *
 * Lifted out of packages/web's StageBadge so both web AND mobile can reuse the
 * same colour math (e.g. mobile stage pills via `ensureWhiteContrast`). The
 * web-only, DOM-reading bits (getComputedStyle / canvas-luminance probing) stay
 * in StageBadge.tsx; only the platform-agnostic functions live here.
 */

/** sRGB 8-bit channel (0–255) -> linear-light (0–1). */
export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Linear-light (0–1) -> sRGB 8-bit channel (0–255), clamped + rounded. */
export function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, c * 255)));
}

/** WCAG relative luminance of an sRGB colour (channels 0–255). */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Parse #rgb / #rrggbb (with or without leading #) -> [r,g,b] or null. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  if (h.length < 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** [r,g,b] (0–255) -> #rrggbb. */
export function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Darkens a hex color just enough so white (#fff) text reaches 4.5:1.
 * Targets 4.6:1 to absorb rounding error from 8-bit RGB quantization.
 * Returns the input unchanged for unparseable colours.
 */
export function ensureWhiteContrast(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const lum = relativeLuminance(r, g, b);
  if (1.05 / (lum + 0.05) >= 4.6) return hex;
  const target = 1.05 / 4.6 - 0.05;
  const k = target / lum;
  return toHex(linearToSrgb(srgbToLinear(r) * k), linearToSrgb(srgbToLinear(g) * k), linearToSrgb(srgbToLinear(b) * k));
}
