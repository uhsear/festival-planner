import React from 'react';

/**
 * StageBadge — consolidates the duplicated stage-badge inline-style pattern
 * used by `.stage-chip` (AppShell), `.pick-stage` (picks / timeline TBA).
 *
 * Active/default rendering: solid stage-color background with white text
 * and a text-shadow for contrast — this is the pattern that passes AA
 * against every stage color in the palette (including dark purples).
 *
 * When `variant='chip'` with `active=false`, we fall back to the legacy
 * faded chip style (stage-color text on a 12%-opacity stage-color bg) so
 * AppShell's stage-filter chips keep their untoggled look.
 */

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

/**
 * Returns the inline style for a stage-colored badge. Exported so non-span
 * call-sites (e.g. interactive `<button>` stage chips in AppShell) can share
 * the same palette logic without duplicating the inline-style object.
 */
export function getStageBadgeStyle(
  stageColor: string,
  variant: StageBadgeVariant = 'default',
  active = true,
): React.CSSProperties {
  const isFadedChip = variant === 'chip' && !active;
  if (isFadedChip) {
    return {
      background: stageColor + '20',
      color: stageColor,
      borderColor: 'transparent',
    };
  }
  return {
    background: stageColor,
    color: '#fff',
    fontWeight: 700,
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
    borderColor: stageColor,
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
