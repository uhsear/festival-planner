import React from 'react';
import { FestivalSet } from '@festie/shared/types';
import { artistDisplayName } from '@festie/shared/utils';
import { cn } from '@/lib/utils';

interface ConflictBadgeProps {
  conflicts: FestivalSet[];
  onConflictClick?: (set: FestivalSet) => void;
  b2bSeparator?: string;
}

export default function ConflictBadge({ conflicts, onConflictClick, b2bSeparator }: ConflictBadgeProps) {
  if (conflicts.length === 0) return null;

  return (
    <div className="space-y-2">
      {conflicts.map((conflict) => (
        <button
          key={conflict.id}
          onClick={() => onConflictClick?.(conflict)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg',
            'bg-red-500/10 border border-accent-coral/20 text-accent-coral',
            'hover:bg-red-500/20 transition-colors text-sm font-semibold',
          )}
        >
          <span>⚠</span>
          <span className="flex-1 text-left">Conflicts with {artistDisplayName(conflict, b2bSeparator)}</span>
        </button>
      ))}
    </div>
  );
}
