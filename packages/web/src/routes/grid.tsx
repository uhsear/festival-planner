import React, { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { formatTime, artistDisplayName } from '@festie/shared/utils';

const COLOR_MAP: Record<string, string> = {
  must: 'var(--accent-coral)',
  'want-to-see': 'var(--accent-aqua)',
  maybe: 'var(--accent-amber)',
  none: 'var(--bg-secondary)',
};

function timeToMinutes(time: string): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export default function GridView() {
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const activeStages = useFestivalStore((state) => state.activeStages);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const { getMyPick } = usePicks();
  const { getStageColor, getStageName } = useFestival();

  // Filter sets by day using dayIndex
  const daySets = useMemo(() => {
    let filtered = sets.filter((s) => s.dayIndex === selectedDay);
    // Only filter stages when some but not all selected
    if (activeStages.length > 0 && activeStages.length < stages.length) {
      filtered = filtered.filter((s) => activeStages.includes(s.stageId));
    }
    return filtered;
  }, [sets, selectedDay, stages, activeStages]);

  // Visible stages
  const visibleStages = useMemo(() => {
    if (activeStages.length > 0 && activeStages.length < stages.length) {
      return stages.filter((st) => activeStages.includes(st.id));
    }
    return stages;
  }, [stages, activeStages]);

  // Timed sets only for the grid
  const timedSets = useMemo(() => daySets.filter((s) => s.startTime && s.endTime), [daySets]);

  // Calculate time bounds
  const timeBounds = useMemo(() => {
    if (timedSets.length === 0) return null;
    let earliestMin = 24 * 60;
    let latestMin = 0;
    timedSets.forEach((s) => {
      const start = timeToMinutes(s.startTime!);
      let end = timeToMinutes(s.endTime!);
      if (end <= start) end += 24 * 60;
      if (start < earliestMin) earliestMin = start;
      if (end > latestMin) latestMin = end;
    });
    // Round to 30-min boundaries
    earliestMin = Math.floor(earliestMin / 30) * 30;
    latestMin = Math.ceil(latestMin / 30) * 30;
    const totalSlots = Math.ceil((latestMin - earliestMin) / 30);
    return { earliestMin, latestMin, totalSlots };
  }, [timedSets]);

  // Generate time slot labels
  const timeSlots = useMemo(() => {
    if (!timeBounds) return [];
    const slots: string[] = [];
    for (let i = 0; i < timeBounds.totalSlots; i++) {
      const min = timeBounds.earliestMin + i * 30;
      const h = Math.floor(min / 60) % 24;
      const m = min % 60;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
    return slots;
  }, [timeBounds]);

  if (!currentFestival) {
    return (
      <div className="no-festival" role="status" aria-live="polite">
        <p>No festival selected. Choose a festival from the top menu.</p>
      </div>
    );
  }

  if (!timedSets.length || !visibleStages.length) {
    return (
      <div className="no-festival" role="status" aria-live="polite">
        <p>No sets or stages to display.</p>
      </div>
    );
  }

  if (!timeBounds) return null;

  return (
    <div className="grid-view-container" role="region" aria-label="Festival set grid">
      <div
        className="grid-schedule"
        aria-label="Schedule by stage and time"
        style={{
          display: 'grid',
          gridTemplateColumns: `60px repeat(${visibleStages.length}, 1fr)`,
          gap: '1px',
          background: 'var(--border)',
          padding: '10px',
          overflowX: 'auto',
        }}
      >
        {/* Header row: empty time corner + stage names */}
        <div className="grid-stage-header" role="columnheader" aria-label="Time" />
        {visibleStages.map((stage) => (
          <div
            key={stage.id}
            className="grid-stage-header"
            role="columnheader"
            style={{ background: (getStageColor(stage.id)) + '15' }}
          >
            {getStageName(stage.id)}
          </div>
        ))}

        {/* Grid rows: time label + cells per stage */}
        {timeSlots.map((timeStr, slotIdx) => (
          <React.Fragment key={timeStr}>
            {/* Time label */}
            <div className="grid-time-col" role="rowheader">
              {formatTime(timeStr)}
            </div>

            {/* Stage cells */}
            {visibleStages.map((stage) => {
              // Find sets starting at this slot for this stage
              const cellSets = timedSets.filter((s) => {
                if (s.stageId !== stage.id || !s.startTime) return false;
                const setSlotIdx = Math.floor(
                  (timeToMinutes(s.startTime) - timeBounds.earliestMin) / 30,
                );
                return setSlotIdx === slotIdx;
              });

              return (
                <div key={`${stage.id}-${slotIdx}`} className="grid-cell" role="gridcell">
                  {cellSets.map((set) => {
                    const myPick = getMyPick(set.id) || 'none';
                    const pickColor = COLOR_MAP[myPick] || COLOR_MAP.none;
                    const durationSlots = Math.max(
                      1,
                      Math.ceil(
                        (timeToMinutes(set.endTime!) - timeToMinutes(set.startTime!)) / 30,
                      ),
                    );
                    const dn = artistDisplayName(set, currentFestival?.b2bSeparator);

                    return (
                      <div
                        key={set.id}
                        className="grid-set"
                        role="button"
                        tabIndex={0}
                        aria-label={`${dn} at ${getStageName(stage.id)}, ${formatTime(set.startTime!)}${set.endTime ? ' to ' + formatTime(set.endTime) : ''}${myPick !== 'none' ? ', ' + myPick : ''}`}
                        style={{
                          background: pickColor + '40',
                          borderLeftColor: pickColor,
                          top: '2px',
                          height: `${durationSlots * 40 - 4}px`,
                        }}
                        onClick={() => setDetailSet(set)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDetailSet(set);
                          }
                        }}
                      >
                        {dn}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
