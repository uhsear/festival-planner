import React from 'react';
import { FestivalSet, Priority, Stage, Profile, Festival } from '@festie/shared/types';
import { artistDisplayName } from '@festie/shared/utils';
import StageBadge from '../ui/StageBadge';

const PRI_MAP: Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

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
    <div className="timeline-tba-section">
      <div className="timeline-tba-header">TBA — Times Not Yet Announced</div>
      <div className="timeline-tba-grid">
        {sets.map((s, idx) => {
          const myPick = getMyPick(s.id);
          const others = getOtherPicks(s.id);
          const stage = stages.find((st) => st.id === s.stageId);
          const stageColor = stage ? getStageColor(stage.id) : undefined;
          const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
          const dn = artistDisplayName(s, currentFestival?.b2bSeparator);

          return (
            <div
              key={s.id}
              className={'timeline-tba-card stagger-item relative' + priClass}
              style={stageColor ? { '--i': Math.min(idx, 20), borderLeft: `3px solid ${stageColor}` } as React.CSSProperties : { '--i': Math.min(idx, 20) } as React.CSSProperties}
            >
              {/* Positioned click overlay — keeps outer div non-interactive so
                  priority buttons inside don't trigger nested-interactive. */}
              <button
                type="button"
                className="tba-card-click-target absolute inset-0 z-[1] cursor-pointer border-0 bg-transparent p-0 m-0"
                aria-label={`${dn}${stage ? ' at ' + stage.name : ''}, time TBA${myPick ? ', priority: ' + myPick : ''}`}
                onClick={() => onOpenDetail(s)}
              />
              <div className="set-artist relative z-[2] pointer-events-none">{dn}</div>
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
                <div className="timeline-pick-group relative z-[2]">
                  {([['must', '★'], ['want-to-see', '◆'], ['maybe', '●']] as const).map(
                    ([p, icon]) => {
                      const active = myPick === p;
                      return (
                        <button
                          key={p}
                          className={
                            'timeline-pick-btn' +
                            (active ? ' active-' + PRI_MAP[p] : '')
                          }
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
                <div className="set-overlap relative z-[2]">
                  {others.slice(0, 3).map((o) => (
                    <div
                      key={o.profileId}
                      className="mini-avatar h-4 w-4 text-[7px]"
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
