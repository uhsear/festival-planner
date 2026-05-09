import React from 'react';

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

const VARIANT_CLASS: Record<StageBadgeVariant, string> = {
  chip: 'stage-chip',
  pick: 'pick-stage',
  default: 'stage-badge',
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
export function ensureWhiteContrast(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const lum = relativeLuminance(r, g, b);
  if (1.05 / (lum + 0.05) >= 4.5) return hex;
  const target = 1.05 / 4.5 - 0.05;
  const k = target / lum;
  return toHex(
    linearToSrgb(srgbToLinear(r) * k),
    linearToSrgb(srgbToLinear(g) * k),
    linearToSrgb(srgbToLinear(b) * k),
  );
}

// Ensures the inactive chip text color has at least 4.5:1 contrast against
// the dark app background (~#0d0d1a, luminance ~0.008). Light stage colors
// (yellow, lime, etc.) are brightened just enough to pass WCAG AA.
const DARK_BG_LUMINANCE = 0.008;
function ensureDarkBgContrast(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const lum = relativeLuminance(r, g, b);
  const ratio = (lum + 0.05) / (DARK_BG_LUMINANCE + 0.05);
  if (ratio >= 4.5) return hex;
  // Target luminance for 4.5:1 against DARK_BG_LUMINANCE
  const targetLum = 4.5 * (DARK_BG_LUMINANCE + 0.05) - 0.05;
  if (lum === 0) return '#b3b3b3'; // fallback for pure black
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
    color: '#fff',
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
  const activeSuffix = variant === 'chip' && active ? ' active' : '';
  const composedClass = [variantClass + activeSuffix, className].filter(Boolean).join(' ');

  return (
    <span className={composedClass} style={{ ...baseStyle, ...style }}>
      {stageName}
    </span>
  );
}
