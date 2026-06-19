import React from 'react';
import { FestivalSet, Priority, Festival } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

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

function TimelineGridCell({
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
  const blockPx = Math.max(1, Math.ceil(spanSlots)) * rowHeight;
  const isShort = blockPx < 44;
  const hasConflictActive = myPick && hasConflict;

  return (
    <div
      key={set.id}
      className={cn(
        'relative top-px left-0.5 right-0.5 h-[calc(100%-2px)]',
        // Set block base
        'px-2 py-1 rounded-sm',
        'cursor-pointer overflow-hidden',
        'flex flex-col justify-center',
        'z-[2] opacity-[0.88]',
        // Press & hover feedback
        'transition-[transform,box-shadow] duration-150',
        'ease-out',
        'active:scale-[0.97]',
        'hover:opacity-100 hover:shadow-[0_2px_10px_rgba(0,0,0,0.28)]',
        // Enter animation via data-day attribute on parent grid
        'will-change-[opacity,transform]',
        'animate-[timeline-set-enter_260ms_cubic-bezier(0.16,1,0.3,1)_both]',
        '[animation-delay:var(--tl-stagger,0ms)]',
        'motion-reduce:!animate-none motion-reduce:!transition-none',
        // Priority variants
        myPick === 'must' && 'shadow-[inset_0_0_24px_rgba(var(--accent-coral-rgb),0.12)]',
        myPick === 'want-to-see' && 'shadow-[inset_0_0_24px_var(--color-aqua-a12)]',
        myPick === 'maybe' && 'shadow-[inset_0_0_24px_var(--color-amber-a12)]',
        // Conflict indicator
        hasConflictActive && '!border-2 !border-[var(--color-accent-amber)] shadow-[0_0_8px_rgba(245,158,11,0.3)]',
      )}
      style={
        {
          gridRow: `${Math.floor(topSlot) + 2} / span ${Math.max(1, Math.ceil(spanSlots))}`,
          gridColumn: columnIndex + 2,
          background: stageColor + '20',
          '--tl-stagger': `${Math.min(columnIndex, 5) * 40}ms`,
        } as React.CSSProperties
      }
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
      {/* Conflict warning icon */}
      {hasConflictActive && (
        <span
          className={cn(
            'absolute top-0.5 right-0.5',
            'w-3.5 h-3.5 rounded-full',
            'inline-flex items-center justify-center',
            'text-[length:var(--font-size-10)] leading-none',
            'text-[var(--color-bg-primary)]',
            'bg-[var(--color-accent-coral)]',
            'shadow-[0_0_0_1.5px_var(--color-bg-primary)]',
            'pointer-events-none z-[2]',
          )}
          aria-hidden="true"
          title="Schedule conflict with another of your picks"
        >
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        </span>
      )}

      {/* Artist name */}
      <div
        className={cn(
          'line-clamp-2 break-words [overflow-wrap:anywhere] [hyphens:auto] min-w-0',
          'text-[length:var(--font-size-12)] font-bold leading-[1.15] tracking-[0.1px]',
          'text-[var(--color-text-primary)]',
          '[text-shadow:0_1px_2px_rgba(0,0,0,0.55),0_0_1px_rgba(0,0,0,0.7)]',
          'min-[380px]:text-[length:var(--font-size-13)]',
          // Short blocks: single line ellipsis
          isShort && 'line-clamp-1 whitespace-nowrap text-ellipsis',
        )}
        title={dn}
      >
        {dn}
      </div>

      {/* Time label */}
      {!isShort && (
        <div className="text-[length:var(--font-size-11)] opacity-65 mt-px tabular-nums">
          {formatTime(set.startTime!)} - {formatTime(set.endTime!)}
        </div>
      )}

      {/* Priority pick buttons */}
      {hasProfile && !isShort && blockPx >= 60 && (
        <div className="flex gap-[var(--space-1)] mt-0.5">
          {PICK_BUTTONS.map(({ priority: p, icon }) => {
            const active = myPick === p;
            return (
              <button
                key={p}
                className={cn(
                  'relative',
                  'bg-[var(--color-overlay-2)] border border-[var(--color-border)]',
                  'rounded-xs',
                  'text-[var(--color-text-secondary)] cursor-pointer',
                  'text-[length:var(--font-size-11)] px-1.5 py-[3px] leading-none',
                  'transition-[color,border-color,background-color] duration-[250ms] ease-[var(--ease-standard)]',
                  'hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent-aqua)] hover:bg-[rgba(255,255,255,0.07)]',
                  'focus-visible:outline-2 focus-visible:outline-[var(--color-accent-aqua)] focus-visible:outline-offset-1',
                  // Hit-slop pseudo-element for 44x44 tap target
                  'after:content-[""] after:absolute after:inset-[-4px]',
                  'min-[380px]:min-w-10 min-[380px]:min-h-10',
                  'min-[380px]:after:inset-[-2px]',
                  // Active priority states
                  active &&
                    p === 'must' &&
                    'bg-[var(--color-accent-coral-strong)] text-[var(--color-text-on-accent)] border-[var(--color-accent-coral-strong)] opacity-100',
                  active &&
                    p === 'want-to-see' &&
                    'bg-[var(--color-priority-want)] text-[var(--color-text-on-dark)] border-[var(--color-priority-want)] opacity-100',
                  active &&
                    p === 'maybe' &&
                    'bg-[var(--color-priority-maybe)] text-[var(--color-text-on-dark)] border-[var(--color-priority-maybe)] opacity-100',
                )}
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

      {/* Crew overlap avatars */}
      {others.length > 0 && (
        <div className="absolute top-[3px] right-[3px] flex gap-px">
          {others.slice(0, 3).map((o) => (
            <div
              key={o.profileId}
              className={cn(
                'inline-flex items-center justify-center',
                'rounded-full font-bold',
                'text-[var(--color-text-on-accent)] shrink-0',
                'w-4 h-4 text-[7px]',
                'border-[1.5px] border-[var(--color-bg-primary)]',
              )}
              title={`${o.name || 'Crew member'} (${o.priority})`}
              aria-label={`${o.name || 'Crew member'} (${o.priority})`}
            >
              <span className="sr-only">
                {o.name || 'Crew member'} ({o.priority})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default React.memo(TimelineGridCell);
