import React from 'react';
import { parseHex, toHex, relativeLuminance, srgbToLinear, linearToSrgb, ensureWhiteContrast } from '@festie/shared';
import { cn } from '../../lib/utils';

// Re-export so existing web imports (SetCard.tsx / SetCard.test.tsx import
// `ensureWhiteContrast` from this module) keep working unchanged after the
// pure helpers moved to @festie/shared/utils/contrast.
export { ensureWhiteContrast };

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
  chip: 'inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold cursor-pointer border-2 border-transparent transition-[color,background-color,border-color,box-shadow] duration-200',
  pick: 'type-micro inline-block rounded-full px-2 py-1',
  default: 'type-micro inline-block rounded-full px-2 py-1',
};

// --- WCAG 2.2 contrast helpers (SC 1.4.3) ---
// The platform-agnostic math (parseHex/toHex/relativeLuminance/srgbToLinear/
// linearToSrgb/ensureWhiteContrast) now lives in @festie/shared so mobile can
// reuse it. Only the web-only, DOM-reading helpers stay below.

// Ensures the inactive chip text color has at least 4.5:1 contrast against
// the dark app background. The background luminance is read live from the
// --color-bg-primary token (computed once, memoized) so a theme retune of the
// canvas keeps the contrast math correct instead of drifting from a hardcoded
// magic number. Falls back to the historical constant (~0.008, the old
// ~#0d0d1a canvas luminance) in non-DOM contexts (SSR / tests).
const FALLBACK_BG_RGB: [number, number, number] = [8, 8, 16]; // #080810
let _darkBgRgb: [number, number, number] | null = null;
function getDarkBgRgb(): [number, number, number] {
  if (_darkBgRgb !== null) return _darkBgRgb;
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return FALLBACK_BG_RGB;
  }
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-primary').trim();
    const rgb = parseHex(raw);
    if (rgb) {
      _darkBgRgb = rgb;
      return _darkBgRgb;
    }
  } catch {
    /* getComputedStyle can throw in detached documents — fall through */
  }
  _darkBgRgb = FALLBACK_BG_RGB;
  return _darkBgRgb;
}

// Solve a foreground hex up to 4.5:1 against an arbitrary background luminance.
// Brightens the foreground (k > 1) until the ratio is met; pure black falls
// back to the recessed stage-fallback token.
function adjustForBgLuminance(hex: string, bgLum: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const lum = relativeLuminance(r, g, b);
  const ratio = (lum + 0.05) / (bgLum + 0.05);
  if (ratio >= 4.5) return hex;
  const targetLum = 4.5 * (bgLum + 0.05) - 0.05;
  if (lum === 0) return 'var(--color-stage-fallback)'; // fallback for pure black
  const k = targetLum / lum;
  return toHex(
    linearToSrgb(Math.min(1, srgbToLinear(r) * k)),
    linearToSrgb(Math.min(1, srgbToLinear(g) * k)),
    linearToSrgb(Math.min(1, srgbToLinear(b) * k)),
  );
}

// The inactive chip paints the stage colour at ~0.125 alpha (the '20' hex
// suffix) over the canvas, so contrast must be solved against that COMPOSITE,
// not the bare canvas. Measuring against the (darker) canvas over-reported
// contrast for dark stage colours, letting them dip below AA on the tinted
// pill. Blend per-channel in sRGB, then take the luminance of the result.
const CHIP_TINT_ALPHA = 0x20 / 0xff; // '20' hex alpha ≈ 0.125
function inactiveChipTextColor(stageColor: string): string {
  const fg = parseHex(stageColor);
  if (!fg) return stageColor;
  const bg = getDarkBgRgb();
  const composite: [number, number, number] = [
    Math.round(fg[0] * CHIP_TINT_ALPHA + bg[0] * (1 - CHIP_TINT_ALPHA)),
    Math.round(fg[1] * CHIP_TINT_ALPHA + bg[1] * (1 - CHIP_TINT_ALPHA)),
    Math.round(fg[2] * CHIP_TINT_ALPHA + bg[2] * (1 - CHIP_TINT_ALPHA)),
  ];
  const chipBgLum = relativeLuminance(composite[0], composite[1], composite[2]);
  return adjustForBgLuminance(stageColor, chipBgLum);
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
      color: inactiveChipTextColor(stageColor),
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
