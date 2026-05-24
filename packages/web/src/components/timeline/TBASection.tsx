import React from 'react';
import { FestivalSet, Priority, Stage, Profile, Festival } from '@festie/shared/types';
import { artistDisplayName } from '@festie/shared/utils';
import StageBadge from '../ui/StageBadge';
import { cn } from '../../lib/utils';

export interface TBASectionProps {
  sets: FestivalSet[];
  stages: Stage[];
  getMyPick: (setId: string) => Priority | null | undefined;
  getOtherPicks: (setId: string) => Array<{ profileId: string; priority: Priority; name?: string }>;
  conflictIds: Set<string>;
  currentProfile: Profile | null;
  currentFestival: Festival | null;
  getStageColor: (stageId: string) => string;
  onSavePick: (setId: string, priority: string | null) => void;
  onOpenDetail: (set: FestivalSet) => void;
}

export default function TBASection({
  sets,
  stages,
  getMyPick,
  getOtherPicks,
  conflictIds: _conflictIds,
  currentProfile,
  currentFestival,
  getStageColor,
  onSavePick,
  onOpenDetail,
}: TBASectionProps) {
  return (
    <div
      className={cn(
        'mt-5 p-[var(--space-8)]',
        'bg-[var(--color-bg-card)] rounded-sm',
        'border border-[var(--color-border)]',
        // fade-in animation kept via keyframe reference
        'animate-[timeline-legend-fade_220ms_ease-out_both]',
        'motion-reduce:!animate-none',
      )}
    >
      <div className="text-[13px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.5px] mb-3">
        TBA — Times Not Yet Announced
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-[var(--space-4)]">
        {sets.map((s, idx) => {
          const myPick = getMyPick(s.id);
          const others = getOtherPicks(s.id);
          const stage = stages.find((st) => st.id === s.stageId);
          const stageColor = stage ? getStageColor(stage.id) : undefined;
          const dn = artistDisplayName(s, currentFestival?.b2bSeparator);

          return (
            <div
              key={s.id}
              className={cn(
                'relative stagger-item',
                'px-3 py-2.5',
                'bg-[var(--color-bg-secondary)] rounded-sm',
                'border border-[var(--color-border)]',
                'cursor-pointer',
                'transition-[transform,box-shadow] duration-150',
                'ease-[cubic-bezier(0.16,1,0.3,1)]',
                'active:scale-[0.98]',
                'hover:bg-[var(--color-bg-hover)] hover:outline-2 hover:outline-[var(--color-accent-aqua)]',
                'focus-visible:bg-[var(--color-bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent-aqua)]',
                'motion-reduce:!transition-none',
                // Priority border-left tint
                myPick === 'must' && 'border-l-[3px] border-l-[var(--color-priority-must)] shadow-[inset_0_0_24px_rgba(var(--accent-coral-rgb),0.12)]',
                myPick === 'want-to-see' && 'border-l-[3px] border-l-[var(--color-priority-want)] shadow-[inset_0_0_24px_var(--color-aqua-a12)]',
                myPick === 'maybe' && 'border-l-[3px] border-l-[var(--color-priority-maybe)] shadow-[inset_0_0_24px_var(--color-amber-a12)]',
              )}
              style={stageColor
                ? { '--i': Math.min(idx, 20), borderLeft: `3px solid ${stageColor}` } as React.CSSProperties
                : { '--i': Math.min(idx, 20) } as React.CSSProperties}
            >
              {/* Positioned click overlay — keeps outer div non-interactive so
                  priority buttons inside don't trigger nested-interactive. */}
              <button
                type="button"
                className="absolute inset-0 z-[1] cursor-pointer border-0 bg-transparent p-0 m-0"
                aria-label={`${dn}${stage ? ' at ' + stage.name : ''}, time TBA${myPick ? ', priority: ' + myPick : ''}`}
                onClick={() => onOpenDetail(s)}
              />
              <div className="relative z-[2] pointer-events-none font-semibold text-sm mb-1">{dn}</div>
              {stage && stageColor && (
                <StageBadge
                  variant="pick"
                  stageName={stage.name}
                  stageColor={stageColor}
                  className="relative z-[2] text-[11px]"
                />
              )}

              {/* Priority pick buttons */}
              {currentProfile && (
                <div className="relative z-[2] flex gap-[var(--space-1)] mt-1.5">
                  {([['must', '★'], ['want-to-see', '◆'], ['maybe', '●']] as const).map(
                    ([p, icon]) => {
                      const active = myPick === p;
                      return (
                        <button
                          key={p}
                          className={cn(
                            'relative',
                            'bg-[var(--color-overlay-2)] border border-[var(--color-border)]',
                            'rounded-xs',
                            'text-[var(--color-text-secondary)] cursor-pointer',
                            'text-[11px] px-1.5 py-[3px] leading-none',
                            'transition-all duration-[250ms] ease-[var(--ease-standard)]',
                            'hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent-aqua)] hover:bg-[rgba(255,255,255,0.07)]',
                            'focus-visible:outline-2 focus-visible:outline-[var(--color-accent-aqua)] focus-visible:outline-offset-1',
                            // Hit-slop pseudo-element for 44x44 tap target
                            'after:content-[""] after:absolute after:inset-[-4px]',
                            'min-[380px]:min-w-10 min-[380px]:min-h-10',
                            'min-[380px]:after:inset-[-2px]',
                            // Active priority states
                            active && p === 'must' && 'bg-[var(--color-priority-must)] text-[var(--color-text-on-accent)] border-[var(--color-priority-must)] opacity-100',
                            active && p === 'want-to-see' && 'bg-[var(--color-priority-want)] text-[var(--color-text-on-dark)] border-[var(--color-priority-want)] opacity-100',
                            active && p === 'maybe' && 'bg-[var(--color-priority-maybe)] text-[var(--color-text-on-dark)] border-[var(--color-priority-maybe)] opacity-100',
                          )}
                          type="button"
                          aria-pressed={active ? 'true' : 'false'}
                          aria-label={
                            (p === 'must'
                              ? 'Must See'
                              : p === 'want-to-see'
                                ? 'Want to See'
                                : 'Maybe') + (active ? ' (selected)' : '')
                          }
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSavePick(s.id, active ? null : p);
                          }}
                        >
                          {icon}
                        </button>
                      );
                    },
                  )}
                </div>
              )}

              {/* Crew overlap */}
              {others.length > 0 && (
                <div className="relative z-[2] mt-1">
                  {others.slice(0, 3).map((o) => (
                    <div
                      key={o.profileId}
                      className={cn(
                        'inline-flex items-center justify-center',
                        'rounded-full font-bold',
                        'text-[var(--color-text-on-accent)] shrink-0',
                        'h-4 w-4 text-[7px]',
                      )}
                      title={`${o.name || 'Crew member'} (${o.priority})`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
