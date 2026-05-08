import React, { useMemo } from 'react';
import { FestivalSet, Priority, Stage, Profile, Festival } from '@festie/shared/types';
import { timeToMinutes } from '@festie/shared/utils';
import TimelineGridCell from './TimelineGridCell';

const SLOT_MINUTES = 15;

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

  return (
    <div
      ref={gridRef}
      className="timeline-grid relative"
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
        className="timeline-header-cell bg-[var(--bg-primary)]"
        role="columnheader"
      />

      {/* Stage headers */}
      {visibleStages.map((st) => {
        const color = getStageColor(st.id);
        return (
          <div
            key={st.id}
            className="timeline-header-cell"
            style={{ borderBottom: `3px solid ${color}`, color }}
            role="columnheader"
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
            className="timeline-time-cell"
            style={{
              gridRow: i + 2,
              gridColumn: 1,
              borderBottom:
                mm === 0
                  ? '1px solid var(--border-light)'
                  : '1px solid var(--border)',
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
              className="timeline-cell"
              style={{
                gridRow: i + 2,
                gridColumn: ci + 2,
                borderBottom:
                  mm === 0
                    ? '1px solid var(--border-light)'
                    : '1px solid var(--border)',
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
                others={getOtherPicks(s.id)}
                hasConflict={conflictIds.has(s.id)}
                hasProfile={!!currentProfile}
                festival={currentFestival}
                onSetClick={onSetClick}
                onSavePick={onSavePick}
              />
            );
          });
      })}

      {/* Now-indicator line */}
      {nowIndicator !== null && (
        <div
          className="timeline-now-line"
          style={{ top: `calc(${nowIndicator}% + 38px)` }}
        >
          <div className="timeline-now-dot" />
        </div>
      )}
    </div>
  );
}
