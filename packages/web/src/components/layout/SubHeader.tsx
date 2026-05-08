import React, { useCallback } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { getStageBadgeStyle } from '../ui/StageBadge';
import { useSwipeDays } from '../../hooks/useSwipeDays';
import { useHaptics } from '../../hooks/useHaptics';
import { useScrollFade } from '../../hooks/useScrollFade';

interface SubHeaderProps {
  /** Show only day tabs (no stage chips or search). Used on /timeline, /grid, /picks. */
  dayOnly: boolean;
  /** Show only festival selector (no day tabs, stage chips, or search). Used on /wrap. */
  festivalOnly: boolean;
}

export default function SubHeader({ dayOnly, festivalOnly }: SubHeaderProps) {
  const festivals = useFestivalStore((s) => s.festivals);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const selectFestival = useFestivalStore((s) => s.selectFestival);
  const stages = useFestivalStore((s) => s.stages);
  const days = useFestivalStore((s) => s.days);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const setActiveStages = useFestivalStore((s) => s.setActiveStages);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const { getStageColor } = useFestival();
  const { select: selectHaptic } = useHaptics();
  const { ref: stageScrollRef, canScrollLeft, canScrollRight } = useScrollFade<HTMLDivElement>();

  const { bind: swipeDaysBind } = useSwipeDays({
    days,
    selectedDay,
    onSelectDay: setSelectedDay,
  });

  const handleFestivalChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (!id) return;
      try {
        await selectFestival(id);
      } catch (_) {} // eslint-disable-line no-empty
    },
    [selectFestival],
  );

  const handleStageToggle = useCallback(
    (stageId: string) => {
      selectHaptic();
      const isActive = activeStages.includes(stageId);
      if (isActive) {
        setActiveStages(activeStages.filter((id) => id !== stageId));
      } else {
        setActiveStages([...activeStages, stageId]);
      }
    },
    [activeStages, setActiveStages, selectHaptic],
  );

  const showDayTabs = !festivalOnly && currentFestival && days.length > 0;
  const showStageFilter = !dayOnly && !festivalOnly && currentFestival && stages.length > 0;
  const showSearch = !dayOnly && !festivalOnly;

  return (
    <div className="sub-header-wrap">
      <nav className="sub-header" aria-label="Festival view controls">
        {/* Festival selector */}
        <label
          htmlFor="festival-select-input"
          className="mr-1.5 inline-block text-xs font-semibold text-[var(--text-secondary)]"
        >
          Festival:
        </label>
        <select
          id="festival-select-input"
          className="festival-select"
          data-testid="festival-select"
          value={currentFestival?.id || ''}
          onChange={handleFestivalChange}
        >
          <option value="">Select Festival</option>
          {festivals.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        {/* Day tabs */}
        {showDayTabs && (
          <div className="day-tabs touch-pan-y" role="tablist" aria-label="Festival days"
            {...swipeDaysBind()}>
            {days.map((day, i) => (
              <button
                key={day.id || i}
                className={'day-tab' + (selectedDay === i ? ' active' : '')}
                role="tab"
                aria-selected={selectedDay === i}
                aria-controls="main-content"
                tabIndex={selectedDay === i ? 0 : -1}
                onClick={() => { selectHaptic(); setSelectedDay(i); }}
              >
                {day.label || day.date}
              </button>
            ))}
          </div>
        )}

        {/* Stage filter chips */}
        {showStageFilter && (
          <div
            className={
              'stage-filter-scroll' +
              (canScrollLeft ? ' fade-left' : '') +
              (canScrollRight ? ' fade-right' : '')
            }
          >
            <div
              ref={stageScrollRef}
              className="filter-stage"
              role="tablist"
              aria-label="Filter by stage"
            >
              {stages.map((stage) => {
                const color = getStageColor(stage.id);
                const isActive = activeStages.includes(stage.id);
                const style = getStageBadgeStyle(color, 'chip', isActive);
                return (
                  <button
                    key={stage.id}
                    className={'stage-chip' + (isActive ? ' active' : '')}
                    style={style}
                    role="tab"
                    aria-selected={isActive}
                    aria-label={stage.name + (isActive ? ' (selected)' : '')}
                    onClick={() => handleStageToggle(stage.id)}
                  >
                    {stage.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Artist search */}
        {showSearch && (
          <div className="search-box" role="search">
            <input
              type="text"
              className="search-input"
              placeholder="Search artist..."
              value={searchQuery}
              aria-label="Search festival artists"
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </nav>
    </div>
  );
}
