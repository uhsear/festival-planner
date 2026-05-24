import React, { useCallback } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { getStageBadgeStyle } from '../ui/StageBadge';
import { useSwipeDays } from '../../hooks/useSwipeDays';
import { useHaptics } from '../../hooks/useHaptics';
import { useScrollFade } from '../../hooks/useScrollFade';
import { cn } from '../../lib/utils';

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

  const handleDaySelect = useCallback(
    (dayIndex: number) => {
      selectHaptic();
      setSelectedDay(dayIndex);
    },
    [selectHaptic, setSelectedDay],
  );

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
    <div>
      <nav
        className={cn(
          'sub-header',
          'flex items-center gap-[var(--space-6)] px-6 py-3',
          'bg-[rgba(10,10,20,0.6)] backdrop-saturate-150 backdrop-blur-sm',
          'border-b border-border flex-wrap shrink-0',
          '[column-gap:var(--space-9)]',
          '[backdrop-filter:saturate(150%)_blur(12px)]',
          '[box-shadow:0_1px_0_rgba(255,255,255,0.02)]',
        )}
        aria-label="Festival view controls"
      >
        {/* Festival selector */}
        <label
          htmlFor="festival-select-input"
          className="mr-1.5 inline-block text-xs font-semibold text-[var(--text-secondary)]"
        >
          Festival:
        </label>
        <select
          id="festival-select-input"
          className={cn(
            'festival-select',
            'py-2 px-3.5 bg-bg-card border border-border-light rounded-sm',
            'text-text-primary text-sm font-semibold cursor-pointer max-w-[220px]',
            'backdrop-blur-[8px]',
          )}
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
          <div
            className={cn(
              'day-tabs',
              'flex gap-[var(--space-3)] snap-x snap-mandatory scroll-smooth touch-pan-y',
            )}
            role="tablist"
            aria-label="Festival days"
            {...swipeDaysBind()}
          >
            {days.map((day, i) => {
              const isActive = selectedDay === i;
              return (
                <button
                  key={day.id || i}
                  className={cn(
                    'day-tab',
                    'py-[7px] px-4 rounded-full text-[13px] font-semibold cursor-pointer',
                    'whitespace-nowrap snap-center min-h-[44px] inline-flex items-center',
                    'transition-[background,color,border-color,box-shadow,transform] duration-200 ease-[var(--ease-out)]',
                    'active:scale-[0.96]',
                    'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:border-accent-aqua',
                    isActive
                      ? [
                          'active',
                          'bg-[#c01d3a] text-white border-[#c01d3a] font-bold',
                          'shadow-[0_0_0_1px_rgba(255,80,110,0.45),var(--shadow-glow-coral),0_4px_12px_rgba(0,0,0,0.25)]',
                          '[text-shadow:0_1px_2px_rgba(0,0,0,0.35)]',
                        ]
                      : 'bg-bg-card border border-border-light text-text-secondary',
                  )}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="main-content"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handleDaySelect(i)}
                >
                  {day.label || day.date}
                </button>
              );
            })}
          </div>
        )}

        {/* Stage filter chips */}
        {showStageFilter && (
          <div
            className={cn(
              'stage-filter-scroll relative min-w-0 w-full',
              canScrollLeft && 'fade-left',
              canScrollRight && 'fade-right',
            )}
          >
            <div
              ref={stageScrollRef}
              className={cn('filter-stage', 'flex gap-[var(--space-3)] flex-wrap')}
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
                    className={cn(
                      'inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold',
                      'cursor-pointer border-2 border-transparent transition-all duration-250',
                      isActive && 'border-current',
                    )}
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
          <div className="search-box ml-auto relative" role="search">
            <input
              type="text"
              className="search-input pl-[34px] w-[180px] text-[13px]"
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
