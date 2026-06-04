import React, { useMemo } from 'react';
import { FestivalSet, Priority, Stage, Profile, Festival } from '@festie/shared/types';
import { timeToMinutes } from '@festie/shared/utils';
import { cn } from '../lib/utils';
import TimelineGridCell from './TimelineGridCell';

const SLOT_MINUTES = 15;

// Shared frozen empty array so cells with no crew overlap always receive the
// same reference — keeps the React.memo on TimelineGridCell from re-rendering
// on a fresh `[]` each pass.
const EMPTY_OTHERS: Array<{ profileId: string; priority: Priority; name?: string }> = [];

function fmtHour(hh: number, mm: number): string {
  const h = hh % 12 || 12;
  const suffix = hh < 12 ? 'a' : 'p';
  return mm === 0 ? `${h}${suffix}` : `${h}:${String(mm).padStart(2, '0')}${suffix}`;
}

export interface TimelineGridProps {
  visibleStages: Stage[];
  timedSets: FestivalSet[];
  timeBounds: { minMin: number; maxMin: number; totalSlots: number };
  selectedDay: number;
  rowHeight: number;
  vpW: number;
  nowIndicator: number | null;
  conflictIds: Set<string>;
  currentProfile: Profile | null;
  currentFestival: Festival | null;
  gridRef: React.RefObject<HTMLDivElement | null>;
  getMyPick: (setId: string) => Priority | null | undefined;
  getOtherPicks: (setId: string) => Array<{ profileId: string; priority: Priority; name?: string }>;
  getStageColor: (stageId: string) => string;
  onSetClick: (set: FestivalSet) => void;
  onSavePick: (setId: string, priority: string | null) => void;
}

export default function TimelineGrid({
  visibleStages,
  timedSets,
  timeBounds,
  selectedDay,
  rowHeight,
  vpW,
  nowIndicator,
  conflictIds,
  currentProfile,
  currentFestival,
  gridRef,
  getMyPick,
  getOtherPicks,
  getStageColor,
  onSetClick,
  onSavePick,
}: TimelineGridProps) {
  // Pre-compute stageId -> sets map once instead of filtering inside every
  // stage column .map() iteration. O(n) once vs O(stages * sets) per render.
  const setsByStage = useMemo(() => {
    const m = new Map<string, FestivalSet[]>();
    for (const s of timedSets) {
      const arr = m.get(s.stageId) || [];
      arr.push(s);
      m.set(s.stageId, arr);
    }
    return m;
  }, [timedSets]);

  // Pre-compute setId -> crew-overlap picks once per render. Calling
  // getOtherPicks(s.id) inline returns a fresh array on every render, which
  // would defeat the React.memo on TimelineGridCell (new `others` reference
  // each time). Memoizing here gives each cell a referentially stable array
  // unless the underlying pick data changes (which flips getOtherPicks'
  // identity via usePicks).
  const othersBySet = useMemo(() => {
    const m = new Map<string, ReturnType<typeof getOtherPicks>>();
    for (const s of timedSets) m.set(s.id, getOtherPicks(s.id));
    return m;
  }, [timedSets, getOtherPicks]);

  return (
    <div
      ref={gridRef}
      className="grid relative min-w-[800px] gap-0"
      role="grid"
      aria-label="Timeline view of festival sets by stage and time"
      data-day={selectedDay}
      style={{
        gridTemplateColumns: `${vpW <= 430 ? '42px' : '70px'} repeat(${visibleStages.length}, minmax(${vpW <= 430 ? '100px' : '140px'}, 1fr))`,
        gridTemplateRows: `auto repeat(${timeBounds.totalSlots}, ${rowHeight}px)`,
      }}
    >
      {/* Empty top-left corner header cell */}
      <div
        className={cn(
          'sticky top-0 z-10 text-center',
          'bg-bg-sticky',
          'border-b-2 border-b-[var(--color-border)]',
          'font-bold uppercase tracking-[1.5px]',
          '[backdrop-filter:saturate(140%)_blur(4px)]',
          // Mobile: smaller text, tight padding, allow wrapping
          'text-[0.6rem] leading-[1.2] px-0.5 py-1 whitespace-normal break-words overflow-hidden',
          // Desktop: restore full sizing
          'md:text-[11px] md:leading-normal md:px-2 md:py-2.5',
        )}
        role="columnheader"
      />

      {/* Stage headers */}
      {visibleStages.map((st) => {
        const color = getStageColor(st.id);
        return (
          <div
            key={st.id}
            className={cn(
              'sticky top-0 z-10 text-center',
              'bg-bg-sticky',
              'border-b-2 border-b-[var(--color-border)]',
              'font-bold uppercase',
              '[backdrop-filter:saturate(140%)_blur(4px)]',
              // Mobile: smaller text, tighter letter-spacing so wide tracking
              // doesn't eat the narrow column, clamp to 2 lines with ellipsis
              // instead of clipping mid-word.
              'text-[0.6rem] leading-[1.15] tracking-[0.3px] px-1 py-1',
              'break-words [overflow-wrap:anywhere] line-clamp-2 overflow-hidden',
              // Desktop: restore full sizing + roomier tracking.
              'md:text-[11px] md:leading-normal md:tracking-[1.5px] md:px-2 md:py-2.5',
              'md:line-clamp-none md:whitespace-normal',
            )}
            style={{ borderBottom: `3px solid ${color}`, color }}
            role="columnheader"
            title={st.name}
          >
            {st.name}
          </div>
        );
      })}

      {/* Time labels on left axis */}
      {Array.from({ length: timeBounds.totalSlots }, (_, i) => {
        const mins = timeBounds.minMin + i * SLOT_MINUTES;
        const hh = Math.floor(mins / 60) % 24;
        const mm = mins % 60;
        const show = mm === 0 || mm === 30;
        return (
          <div
            key={`time-${i}`}
            className={cn(
              'sticky left-0 z-5',
              'px-2.5 py-1',
              'text-[11px] font-semibold text-[var(--color-text-muted)]',
              'bg-[var(--color-bg-primary)]',
              'border-r border-r-[var(--color-border)]',
              'flex items-start justify-end whitespace-nowrap',
              'tabular-nums [font-feature-settings:"tnum"_1]',
              'tracking-[0.01em]',
            )}
            style={{
              gridRow: i + 2,
              gridColumn: 1,
              borderBottom: mm === 0 ? '1px solid var(--color-border-light)' : '1px solid var(--color-border)',
            }}
          >
            {show ? fmtHour(hh, mm) : ''}
          </div>
        );
      })}

      {/* Background cells for each stage column */}
      {visibleStages.map((st, ci) =>
        Array.from({ length: timeBounds.totalSlots }, (_, i) => {
          const mins = timeBounds.minMin + i * SLOT_MINUTES;
          const mm = mins % 60;
          return (
            <div
              key={`cell-${st.id}-${i}`}
              className="border-b border-b-[var(--color-border)] border-r border-r-[var(--color-border)] relative"
              style={{
                gridRow: i + 2,
                gridColumn: ci + 2,
                borderBottom: mm === 0 ? '1px solid var(--color-border-light)' : '1px solid var(--color-border)',
              }}
            />
          );
        }),
      )}

      {/* Set blocks */}
      {visibleStages.map((st, ci) => {
        const color = getStageColor(st.id);
        const stageSets = setsByStage.get(st.id) || [];
        return stageSets.map((s) => {
          const startMin = timeToMinutes(s.startTime!);
          let endMin = timeToMinutes(s.endTime!);
          if (endMin <= startMin) endMin += 24 * 60;
          const topSlot = (startMin - timeBounds.minMin) / SLOT_MINUTES;
          const spanSlots = (endMin - startMin) / SLOT_MINUTES;

          return (
            <TimelineGridCell
              key={s.id}
              set={s}
              stageName={st.name}
              stageColor={color}
              columnIndex={ci}
              topSlot={topSlot}
              spanSlots={spanSlots}
              rowHeight={rowHeight}
              myPick={getMyPick(s.id)}
              others={othersBySet.get(s.id) ?? EMPTY_OTHERS}
              hasConflict={conflictIds.has(s.id)}
              hasProfile={!!currentProfile}
              festival={currentFestival}
              onSetClick={onSetClick}
              onSavePick={onSavePick}
            />
          );
        });
      })}

      {/* Now-indicator line — thicker, brighter, and ringed so the NOW moment
          stands out clearly against the dense grid. */}
      {nowIndicator !== null && (
        <div
          className={cn(
            'timeline-now-label',
            'absolute right-0 h-[3px]',
            'left-[56px] sm:left-[70px] lg:left-[84px] min-[1440px]:left-[96px]',
            'bg-[var(--color-accent-coral)]',
            'z-[8] pointer-events-none',
            'shadow-[0_0_12px_rgba(var(--accent-coral-rgb),0.75)]',
            'transition-[top] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
            'motion-reduce:!transition-none',
          )}
          style={{ top: `calc(${nowIndicator}% + 38px)` }}
        >
          <div
            className={cn(
              'absolute -left-[5px] -top-[3.5px]',
              'w-2.5 h-2.5 rounded-full',
              'bg-[var(--color-accent-coral)]',
              'ring-2 ring-[var(--color-bg-primary)]',
              'shadow-[0_0_10px_var(--color-accent-coral)]',
              'animate-[timeline-now-pulse_1800ms_ease-out_infinite]',
              'motion-reduce:!animate-none',
            )}
          />
        </div>
      )}
    </div>
  );
}
