import React from 'react';
import { Stage } from '@festie/shared/types';
import { cn } from '@/lib/utils';
import { useHaptics } from '@/hooks/useHaptics';

interface StageFilterProps {
  stages: Stage[];
  activeStages: string[];
  onStagesChange: (stageIds: string[]) => void;
  stageColors?: Record<string, string>;
}

const DEFAULT_COLORS: Record<string, string> = {
  main: '#ff3366',
  secondary: '#00e8d0',
  ambient: '#ffb020',
  workshop: '#5b9bd5',
};

export default function StageFilter({ stages, activeStages, onStagesChange, stageColors }: StageFilterProps) {
  const { select } = useHaptics();
  const toggleStage = (stageId: string) => {
    select();
    const updated = activeStages.includes(stageId)
      ? activeStages.filter((id) => id !== stageId)
      : [...activeStages, stageId];
    onStagesChange(updated.length === 0 ? stages.map((s) => s.id) : updated);
  };

  const colors = stageColors || DEFAULT_COLORS;

  return (
    <div className="px-4 overflow-x-auto pb-2 stage-filter-row">
      <div className="flex gap-2 min-w-min">
        {stages.map((stage) => {
          const isActive = activeStages.includes(stage.id);
          const color = colors[stage.name?.toLowerCase()] || colors.main;

          return (
            <button
              key={stage.id}
              onClick={() => toggleStage(stage.id)}
              aria-pressed={isActive ? 'true' : 'false'}
              className={cn(
                'whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px]',
                isActive
                  ? 'text-white border-2'
                  : 'bg-bg-card border border-border text-text-secondary hover:border-border-light',
              )}
              style={isActive ? { backgroundColor: color, borderColor: color } : {}}
              title={stage.name}
            >
              {stage.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
