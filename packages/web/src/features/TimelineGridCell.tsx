import React from 'react';
import { FestivalSet, Priority, Festival } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';

const PRI_MAP: Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

interface PickButtonDef {
  priority: 'must' | 'want-to-see' | 'maybe';
  icon: string;
}

const PICK_BUTTONS: PickButtonDef[] = [
  { priority: 'must', icon: '★' },
  { priority: 'want-to-see', icon: '◆' },
  { priority: 'maybe', icon: '●' },
];

function pickLabel(p: string): string {
  return p === 'must' ? 'Must See' : p === 'want-to-see' ? 'Want to See' : 'Maybe';
}

export interface TimelineGridCellProps {
  set: FestivalSet;
  stageName: string;
  stageColor: string;
  columnIndex: number;
  topSlot: number;
  spanSlots: number;
  rowHeight: number;
  myPick: Priority | null | undefined;
  others: Array<{ profileId: string; priority: Priority; name?: string }>;
  hasConflict: boolean;
  hasProfile: boolean;
  festival: Festival | null;
  onSetClick: (set: FestivalSet) => void;
  onSavePick: (setId: string, priority: string | null) => void;
}

export default function TimelineGridCell({
  set,
  stageName,
  stageColor,
  columnIndex,
  topSlot,
  spanSlots,
  rowHeight,
  myPick,
  others,
  hasConflict,
  hasProfile,
  festival,
  onSetClick,
  onSavePick,
}: TimelineGridCellProps) {
  const dn = artistDisplayName(set, festival?.b2bSeparator);
  const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
  const conflictClass = myPick && hasConflict ? ' has-conflict' : '';
  const blockPx = Math.max(1, Math.ceil(spanSlots)) * rowHeight;
  const isShort = blockPx < 44;

  return (
    <div
      key={set.id}
      className={'timeline-set relative top-px left-0.5 right-0.5 h-[calc(100%-2px)]' + priClass + conflictClass}
      style={{
        gridRow: `${Math.floor(topSlot) + 2} / span ${Math.max(1, Math.ceil(spanSlots))}`,
        gridColumn: columnIndex + 2,
        background: stageColor + '20',
        '--tl-stagger': `${Math.min(columnIndex, 5) * 40}ms`,
      } as React.CSSProperties}
      data-set-id={set.id}
      data-short={isShort ? '1' : '0'}
      role="button"
      tabIndex={0}
      aria-label={`${dn} at ${stageName}, ${formatTime(set.startTime!)}-${formatTime(set.endTime!)}${myPick ? ', priority: ' + myPick : ''}`}
      onClick={() => onSetClick(set)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSetClick(set);
        }
      }}
    >
      {conflictClass && (
        <span
          className="timeline-conflict-badge"
          aria-hidden="true"
          title="Schedule conflict with another of your picks"
        >
          {'⚠'}
        </span>
      )}
      <div className="set-artist" title={dn}>{dn}</div>
      {!isShort && (
        <div className="set-time">
          {formatTime(set.startTime!)} - {formatTime(set.endTime!)}
        </div>
      )}

      {hasProfile && !isShort && blockPx >= 60 && (
        <div className="timeline-pick-group">
          {PICK_BUTTONS.map(({ priority: p, icon }) => {
            const active = myPick === p;
            return (
              <button
                key={p}
                className={'timeline-pick-btn' + (active ? ' active-' + PRI_MAP[p] : '')}
                type="button"
                aria-pressed={active ? 'true' : 'false'}
                aria-label={pickLabel(p) + (active ? ' (selected)' : '')}
                title={pickLabel(p)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSavePick(set.id, active ? null : p);
                }}
              >
                {icon}
              </button>
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <div className="set-overlap">
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
}
