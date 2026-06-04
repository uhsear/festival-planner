import React from 'react';
import { cn } from '../../lib/utils';

export type StageBadgeVariant = 'chip' | 'pick' | 'default';

interface StageBadgeProps {
  stageName: string;
  stageColor: string;
  variant?: StageBadgeVariant;
  /** Only meaningful for variant='chip' — inactive chips use a faded style. */
  active?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// `default`/`pick` tighten to the mobile stage-pill density: the `micro` type
// role (10px / 600 / 0.08em caps) at spacing[2]/spacing[1] padding.
const VARIANT_CLASS: Record<StageBadgeVariant, string> = {
  chip: 'inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold cursor-pointer border-2 border-transparent transition-all duration-200',
  pick: 'inline-block rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em]',
  default: 'inline-block rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em]',
};

// --- WCAG 2.2 contrast helpers (SC 1.4.3) ---

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, c * 255)));
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  if (h.length < 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Darkens a hex color just enough so white (#fff) text reaches 4.5:1.
// Targets 4.6:1 to absorb rounding error from 8-bit RGB quantization.
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

// Ensures the inactive chip text color has at least 4.5:1 contrast against
// the dark app background. The background luminance is read live from the
// --color-bg-primary token (computed once, memoized) so a theme retune of the
// canvas keeps the contrast math correct instead of drifting from a hardcoded
// magic number. Falls back to the historical constant (~0.008, the old
// ~#0d0d1a canvas luminance) in non-DOM contexts (SSR / tests).
const FALLBACK_BG_LUMINANCE = 0.008;
let _darkBgLuminance: number | null = null;
function getDarkBgLuminance(): number {
  if (_darkBgLuminance !== null) return _darkBgLuminance;
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return FALLBACK_BG_LUMINANCE;
  }
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-primary').trim();
    const rgb = parseHex(raw);
    if (rgb) {
      _darkBgLuminance = relativeLuminance(rgb[0], rgb[1], rgb[2]);
      return _darkBgLuminance;
    }
  } catch {
    /* getComputedStyle can throw in detached documents — fall through */
  }
  _darkBgLuminance = FALLBACK_BG_LUMINANCE;
  return _darkBgLuminance;
}
function ensureDarkBgContrast(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const bgLum = getDarkBgLuminance();
  const lum = relativeLuminance(r, g, b);
  const ratio = (lum + 0.05) / (bgLum + 0.05);
  if (ratio >= 4.5) return hex;
  // Target luminance for 4.5:1 against the live canvas luminance.
  const targetLum = 4.5 * (bgLum + 0.05) - 0.05;
  if (lum === 0) return 'var(--color-stage-fallback)'; // fallback for pure black
  const k = targetLum / lum;
  return toHex(
    linearToSrgb(Math.min(1, srgbToLinear(r) * k)),
    linearToSrgb(Math.min(1, srgbToLinear(g) * k)),
    linearToSrgb(Math.min(1, srgbToLinear(b) * k)),
  );
}

export function getStageBadgeStyle(
  stageColor: string,
  variant: StageBadgeVariant = 'default',
  active = true,
): React.CSSProperties {
  const isFadedChip = variant === 'chip' && !active;
  if (isFadedChip) {
    return {
      background: stageColor + '20',
      color: ensureDarkBgContrast(stageColor),
      borderColor: 'transparent',
    };
  }
  const bg = ensureWhiteContrast(stageColor);
  return {
    background: bg,
    color: 'var(--color-text-on-accent)',
    fontWeight: 700,
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
    borderColor: bg,
  };
}

export default function StageBadge({
  stageName,
  stageColor,
  variant = 'default',
  active = true,
  className,
  style,
}: StageBadgeProps) {
  const baseStyle = getStageBadgeStyle(stageColor, variant, active);
  const variantClass = VARIANT_CLASS[variant];
  const activeClass = variant === 'chip' && active ? 'border-current' : '';

  return (
    <span className={cn(variantClass, activeClass, className)} style={{ ...baseStyle, ...style }}>
      {stageName}
    </span>
  );
}
