import React from 'react';
import { cn } from '@/lib/utils';

interface CrewOverlapHeatProps {
  crewSize: number;
  overlapCount: number;
}

/**
 * CrewOverlapHeat: Visualization of crew overlap for a set
 * Renders dots representing crew members who picked this set
 * Color intensity scales with overlap count
 * - 1 member: dim aqua
 * - 2-3 members: medium aqua
 * - 4+ members: bright aqua with glow
 * - All members: gold/amber with glow
 */
export default function CrewOverlapHeat({
  crewSize,
  overlapCount,
}: CrewOverlapHeatProps) {
  // Don't render if no crew
  if (crewSize === 0) {
    return null;
  }

  // Determine color based on overlap
  const allSelected = overlapCount === crewSize && crewSize > 0;
  const highOverlap = overlapCount >= 4;
  const mediumOverlap = overlapCount >= 2;

  const dotColor = allSelected
    ? 'bg-accent-amber'
    : highOverlap
      ? 'bg-accent-aqua'
      : mediumOverlap
        ? 'bg-accent-aqua'
        : 'bg-accent-aqua';

  const dotGlowColor = allSelected
    ? 'shadow-accent-amber/50'
    : highOverlap
      ? 'shadow-accent-aqua/50'
      : '';

  // Create array of dots
  const dots = Array.from({ length: crewSize }, (_, i) => i < overlapCount);

  return (
    <div className="flex items-center gap-1">
      {dots.map((isSelected, index) => (
        <div
          key={index}
          className={cn(
            'w-2 h-2 rounded-full transition-all duration-200',
            isSelected
              ? cn(
                  dotColor,
                  dotGlowColor && `shadow-lg ${dotGlowColor}`,
                  allSelected && 'shadow-lg',
                )
              : 'bg-text-secondary/20',
          )}
        />
      ))}
      {/* Optional: Show count on hover */}
      {crewSize > 0 && (
        <span className="text-xs text-text-secondary ml-1">
          {overlapCount}/{crewSize}
        </span>
      )}
    </div>
  );
}
