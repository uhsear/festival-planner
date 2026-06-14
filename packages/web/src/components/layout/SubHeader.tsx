import React, { useCallback } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { festivalStatus, type FestivalStatus } from '@festie/shared/utils';
import { getStageBadgeStyle } from '../ui/StageBadge';
import { useSwipeDays } from '../../hooks/useSwipeDays';
import { useHaptics } from '../../hooks/useHaptics';
import { useScrollFade } from '../../hooks/useScrollFade';
import { useToast } from '../../lib/toastContext';
import { Star } from 'lucide-react';
import { cn } from '../../lib/utils';
import Input from '../ui/Input';

const STATUS_LABEL: Record<FestivalStatus, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Live',
  past: 'Past',
};

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
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const onlyMine = useFestivalStore((s) => s.onlyMine);
  const setOnlyMine = useFestivalStore((s) => s.setOnlyMine);
  const { getStageColor } = useFestival();
  const { select: selectHaptic } = useHaptics();
  const { toast } = useToast();
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
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't switch festival. Try again.", 'error');
      }
    },
    [selectFestival, toast],
  );

  const handleStageToggle = useCallback(
    (stageId: string) => {
      selectHaptic();
      // Platform parity with mobile (app/(tabs)/index.tsx toggleStage):
      // empty activeStages means "show all", so toggle against the effective
      // set (all stages when empty), then normalize empty/all-selected back to
      // [] = "show all". This prevents the web-only "deselect everything →
      // empty grid" state that mobile can't reach.
      const allStageIds = stages.map((s) => s.id);
      const effective = activeStages.length ? activeStages : allStageIds;
      const sel = new Set(effective);
      if (sel.has(stageId)) sel.delete(stageId);
      else sel.add(stageId);
      const next = allStageIds.filter((id) => sel.has(id));
      setActiveStages(next.length === 0 || next.length === allStageIds.length ? [] : next);
    },
    [activeStages, stages, setActiveStages, selectHaptic],
  );

  // Matches the default-to-today logic in selectFestival (day.date is en-CA YYYY-MM-DD).
  const todayStr = new Date().toLocaleDateString('en-CA');

  const showDayTabs = !festivalOnly && currentFestival && days.length > 0;
  const showStageFilter = !dayOnly && !festivalOnly && currentFestival && stages.length > 0;
  const showSearch = !dayOnly && !festivalOnly;
  const showMyPicks = !festivalOnly && !!currentFestival && !!currentProfile;

  return (
    <div>
      <nav
        className={cn(
          'sub-header',
          // Density: compact (tighter) on <640px, comfortable on desktop.
          'flex items-center px-[var(--space-3)] py-2 gap-[var(--space-3)]',
          'sm:px-6 sm:py-3 sm:gap-[var(--space-6)]',
          'bg-[var(--color-bg-chrome)] backdrop-saturate-150 backdrop-blur-sm',
          'border-b border-border flex-wrap shrink-0',
          // --space-9 never existed in the scale (invalid var -> column-gap
          // silently dropped); --space-8 (2rem) is the nearest real step.
          'sm:[column-gap:var(--space-8)]',
          '[backdrop-filter:saturate(150%)_blur(12px)]',
          '[box-shadow:0_1px_0_rgba(255,255,255,0.02)]',
        )}
        aria-label="Festival view controls"
      >
        {/* Festival selector */}
        <label
          htmlFor="festival-select-input"
          className="mr-1.5 inline-block text-xs font-semibold text-[var(--color-text-secondary)]"
        >
          Festival:
        </label>
        <select
          id="festival-select-input"
          className={cn(
            'festival-select',
            // min-h-[44px] guarantees the WCAG 2.5.5 / iOS 44px tap target on
            // the trigger (the native option-row height stays UA-controlled).
            'min-h-[44px] py-2 px-3.5 bg-bg-card border border-border rounded-full',
            'text-text-primary text-sm font-semibold cursor-pointer',
            // Responsive cap: reserve room for the label + sibling controls on
            // narrow phones (down to 320px) instead of a hard 220px that could
            // clip the dropdown arrow; relax to 220px once there's space.
            'max-w-[min(220px,calc(100vw-160px))] sm:max-w-[220px]',
            'backdrop-blur-[8px]',
            'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
          )}
          data-testid="festival-select"
          value={currentFestival?.id || ''}
          onChange={handleFestivalChange}
        >
          <option value="">Select Festival</option>
          {festivals.map((f) => {
            const st = festivalStatus(f);
            return (
              <option key={f.id} value={f.id}>
                {f.name}
                {st ? ` · ${STATUS_LABEL[st]}` : ''}
              </option>
            );
          })}
        </select>

        {/* Day tabs */}
        {showDayTabs && (
          <div
            className={cn('day-tabs', 'flex gap-[var(--space-3)] snap-x snap-mandatory scroll-smooth touch-pan-y')}
            role="group"
            aria-label="Festival days"
            {...swipeDaysBind()}
          >
            {days.map((day, i) => {
              const isActive = selectedDay === i;
              const isToday = !!day.date && day.date === todayStr;
              return (
                <button
                  key={day.id || i}
                  className={cn(
                    'day-tab-underline',
                    'py-2 px-4 rounded-full text-[13px] font-semibold cursor-pointer',
                    'whitespace-nowrap snap-center min-h-[44px] inline-flex items-center gap-1.5',
                    'transition-[background,color,border-color,box-shadow,transform] duration-200 ease-[var(--ease-out)]',
                    'active:scale-[0.96]',
                    'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:border-accent-aqua',
                    isActive
                      ? [
                          'active',
                          // Accent rule: aqua = selection/primary, dark ink = text.onLightAccent.
                          'bg-day-tab-active text-[#080810] border-day-tab-active font-bold',
                          'shadow-[0_0_0_1px_rgba(0,232,208,0.45),var(--shadow-glow-aqua),0_4px_12px_rgba(0,0,0,0.25)]',
                        ]
                      : 'bg-bg-card border border-border-light text-text-secondary',
                  )}
                  type="button"
                  aria-pressed={isActive}
                  aria-label={`Day: ${day.label || day.date}${isToday ? ' (today)' : ''}`}
                  onClick={() => handleDaySelect(i)}
                >
                  {isToday && (
                    <span
                      className={cn(
                        'inline-block w-1.5 h-1.5 rounded-full',
                        isActive ? 'bg-[#080810]' : 'bg-accent-aqua',
                      )}
                      aria-hidden="true"
                    />
                  )}
                  {day.label || day.date}
                </button>
              );
            })}
          </div>
        )}

        {/* My picks filter */}
        {showMyPicks && (
          <button
            type="button"
            onClick={() => {
              selectHaptic();
              setOnlyMine(!onlyMine);
            }}
            aria-pressed={onlyMine}
            aria-label="Show only my picks"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold',
              'cursor-pointer border-2 transition-[border-color,background-color,color] duration-200',
              onlyMine
                ? 'border-accent-aqua bg-[var(--color-aqua-a08)] text-accent-aqua'
                : 'border-border text-text-secondary hover:text-text-primary',
            )}
          >
            <Star className="w-3.5 h-3.5" fill={onlyMine ? 'currentColor' : 'none'} aria-hidden="true" />
            My picks
          </button>
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
              className={cn('filter-stage', 'flex gap-[var(--space-3)] flex-nowrap overflow-x-auto scrollbar-hide')}
              role="group"
              aria-label="Filter by stage"
            >
              {stages.map((stage) => {
                const color = getStageColor(stage.id);
                // Parity with mobile: empty activeStages means "show all", so a
                // stage chip reads as active when activeStages is empty too.
                const isActive = activeStages.length === 0 || activeStages.includes(stage.id);
                const style = getStageBadgeStyle(color, 'chip', isActive);
                return (
                  <button
                    key={stage.id}
                    className={cn(
                      'inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-semibold',
                      'min-h-[44px] min-w-[44px]',
                      'cursor-pointer border-2 border-transparent transition-[border-color,background-color,color] duration-200',
                      isActive && 'border-current',
                    )}
                    style={style}
                    type="button"
                    aria-pressed={isActive}
                    aria-label={`${isActive ? 'Hide' : 'Show'} ${stage.name}`}
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
          <div className="search-box ml-auto" role="search">
            <Input
              variant="search"
              className="min-h-[44px] w-[clamp(80px,25vw,140px)] text-[13px] sm:w-[clamp(100px,30vw,180px)]"
              placeholder="Search artist…"
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
