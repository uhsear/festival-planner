import React from 'react';
import { FestivalSet, Priority, Stage, Profile, Festival } from '@festie/shared/types';
import { formatTime, timeToMinutes, artistDisplayName } from '@festie/shared/utils';

const SLOT_MINUTES = 15;

function fmtHour(hh: number, mm: number): string {
  const h = hh % 12 || 12;
  const suffix = hh < 12 ? 'a' : 'p';
  return mm === 0 ? `${h}${suffix}` : `${h}:${String(mm).padStart(2, '0')}${suffix}`;
}

const PRI_MAP: Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

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
  return (
    <div
      ref={gridRef}
      className="timeline-grid"
      role="grid"
      aria-label="Timeline view of festival sets by stage and time"
      data-day={selectedDay}
      style={{
        gridTemplateColumns: `${vpW <= 430 ? '42px' : '70px'} repeat(${visibleStages.length}, minmax(${vpW <= 430 ? '100px' : '140px'}, 1fr))`,
        gridTemplateRows: `auto repeat(${timeBounds.totalSlots}, ${rowHeight}px)`,
        position: 'relative',
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
        return timedSets
          .filter((s) => s.stageId === st.id)
          .map((s) => {
            const startMin = timeToMinutes(s.startTime!);
            let endMin = timeToMinutes(s.endTime!);
            if (endMin <= startMin) endMin += 24 * 60;
            const topSlot = (startMin - timeBounds.minMin) / SLOT_MINUTES;
            const spanSlots = (endMin - startMin) / SLOT_MINUTES;

            const myPick = getMyPick(s.id);
            const others = getOtherPicks(s.id);
            const priClass = myPick ? ' priority-' + (PRI_MAP[myPick] || '') : '';
            const conflictClass =
              myPick && conflictIds.has(s.id) ? ' has-conflict' : '';
            const dn = artistDisplayName(s, currentFestival?.b2bSeparator);

            // "Short" = block height < 2 text lines + 4 px padding. At
            // 26 px rowHeight that's anything < 2 slots (30 min); at 36 px
            // anything < 2 slots too. Short blocks drop time + single-line
            // ellipsis so the artist name wins.
            const blockPx = Math.max(1, Math.ceil(spanSlots)) * rowHeight;
            const isShort = blockPx < 44;

            return (
              <div
                key={s.id}
                className={'timeline-set' + priClass + conflictClass}
                style={{
                  gridRow: `${Math.floor(topSlot) + 2} / span ${Math.max(1, Math.ceil(spanSlots))}`,
                  gridColumn: ci + 2,
                  background: color + '20',
                  position: 'relative',
                  top: '1px',
                  left: '2px',
                  right: '2px',
                  minHeight: 'auto',
                  height: 'calc(100% - 2px)',
                  // Per-column stagger: blocks fade/slide in column-by-column
                  // on day switch. Keyed off `selectedDay` via data-day on
                  // the grid so the CSS animation replays.
                  '--tl-stagger': `${Math.min(ci, 5) * 40}ms`,
                } as React.CSSProperties}
                data-set-id={s.id}
                data-short={isShort ? '1' : '0'}
                role="button"
                tabIndex={0}
                aria-label={`${dn} at ${st.name}, ${formatTime(s.startTime!)}-${formatTime(s.endTime!)}${myPick ? ', priority: ' + myPick : ''}`}
                onClick={() => onSetClick(s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSetClick(s);
                  }
                }}
              >
                {conflictClass && (
                  <span
                    className="timeline-conflict-badge"
                    aria-hidden="true"
                    title="Schedule conflict with another of your picks"
                  >
                    ⚠
                  </span>
                )}
                <div className="set-artist" title={dn}>
                  {dn}
                </div>
                {!isShort && (
                  <div className="set-time">
                    {formatTime(s.startTime!)} - {formatTime(s.endTime!)}
                  </div>
                )}

                {/* Priority pick buttons */}
                {currentProfile && !isShort && blockPx >= 60 && (
                  <div className="timeline-pick-group">
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
                            title={
                              p === 'must'
                                ? 'Must See'
                                : p === 'want-to-see'
                                  ? 'Want to See'
                                  : 'Maybe'
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

                {/* Crew overlap avatars */}
                {others.length > 0 && (
                  <div className="set-overlap">
                    {others.slice(0, 3).map((o) => (
                      <div
                        key={o.profileId}
                        className="mini-avatar"
                        title={`${o.name || 'Crew member'} (${o.priority})`}
                        className="h-4 w-4 text-[7px]"
                      />
                    ))}
                  </div>
                )}
              </div>
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
