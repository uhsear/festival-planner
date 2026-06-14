import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { useFestival } from '@festie/shared/hooks';
import LowPowerToggle from '../components/features/LowPowerToggle';
import LowPowerIndicator from '../components/features/LowPowerIndicator';
import { artistDisplayName, getSetTimeBounds } from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import EmptyState from '../components/ui/EmptyState';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { CalendarX, SkipForward, Music, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

// Countdown flips to coral + bolder when a set is ≤ this many minutes away,
// so a user scanning the view in a crowd can grok "run, now" at a glance.
const IMMINENT_MIN = 5;

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtCountdown(mins: number): string {
  if (mins < 1) return 'starting now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

interface TimedSet {
  set: FestivalSet;
  start: number;
  end: number;
  priority: Priority;
}

export default function FestivalModeView() {
  return (
    <RenderErrorBoundary name="festival-mode">
      <FestivalModeViewInner />
    </RenderErrorBoundary>
  );
}

function FestivalModeViewInner() {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  // Low-power mode collapses the ambient aurora glow on the NOW hero (a
  // continuous keyframe loop) to save battery. The static gradient remains.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const { getStageName, getStageColor } = useFestival();
  const navigate = useNavigate();

  // 60s tick so Now/Next and countdowns refresh without reload. Matches legacy
  // cadence (public/app/festival-mode.js line 32).
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const picks = currentProfile?.picks;

  const { current, upcoming } = useMemo(() => {
    if (!picks || !sets.length || !days.length) {
      return { current: [] as TimedSet[], upcoming: [] as TimedSet[] };
    }
    const nowMs = now.getTime();
    const timed: TimedSet[] = [];
    for (const s of sets) {
      const priority = picks[s.id];
      if (!priority) continue;
      // Shared TZ-safe bounds (incl. post-midnight rollover); null = TBA.
      const bounds = getSetTimeBounds(s, days);
      if (!bounds) continue;
      timed.push({ set: s, start: bounds.startMs, end: bounds.endMs, priority });
    }
    const currentSets = timed.filter((t) => t.start <= nowMs && t.end > nowMs);
    const upcomingSets = timed
      .filter((t) => t.start > nowMs)
      .sort((a, b) => a.start - b.start)
      .slice(0, 5);
    return { current: currentSets, upcoming: upcomingSets };
  }, [picks, sets, days, now]);

  if (!currentFestival) {
    return (
      <div className="max-w-[500px] mx-auto pb-[calc(20px+env(safe-area-inset-bottom,0px))]">
        <EmptyState
          icon={<CalendarX className="w-12 h-12" aria-hidden="true" />}
          title="No festival loaded"
          description="Pick a festival from the top menu to see what's playing now and next."
        />
      </div>
    );
  }

  return (
    <div
      className="max-w-[500px] mx-auto lg:max-w-3xl pb-[calc(20px+env(safe-area-inset-bottom,0px))]"
      data-testid="festival-mode-view"
    >
      <div className="flex justify-between items-baseline mb-5 gap-2">
        <div className="text-2xl font-bold font-display tracking-[0.06em] text-text-primary min-w-0 truncate">
          {currentFestival.name}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <LowPowerIndicator />
          <div className="text-base text-text-secondary tabular-nums" aria-label="Current time">
            {fmtClock(now)}
          </div>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:gap-8">
        {/* R8: fm-now-hero applies a radial aqua ::before glow + slow aurora
          keyframe. Reduced-motion: the aurora animation is collapsed to 0.01ms
          by the global @media(prefers-reduced-motion) block in animations.css;
          the static radial gradient (non-motion) remains visible.
          LOW-POWER: drop the ambient hero treatment entirely (the looping glow
          is exactly the battery cost low-power mode exists to shed). */}
        <section className={cn('mb-5 rounded-xl', !lowPowerMode && 'fm-now-hero')} aria-labelledby="fm-now-title">
          <h2 id="fm-now-title" className="type-micro text-text-secondary mb-2 leading-[1.15]">
            {current.length > 0 ? (
              <span className="fm-live-dot motion-reduce:after:animate-none" aria-hidden="true" />
            ) : (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-text-muted mr-1 align-middle"
                aria-hidden="true"
              />
            )}{' '}
            NOW
          </h2>
          {current.length > 0 ? (
            current.map(({ set: s, end }) => {
              const stageName = getStageName(s.stageId) || '';
              return (
                <button
                  key={s.id}
                  type="button"
                  className={cn(
                    // Signature glass card — same surface treatment as the shared
                    // SetCard (bg-bg-card + glass blur + soft border + rounded-xl).
                    'fm-card-enter motion-reduce:animate-none',
                    'block w-full text-left p-4 mb-2 cursor-pointer',
                    'bg-bg-card glass-xs border border-border rounded-xl',
                    // 4px coral left border + faint coral wash flags the live set.
                    'border-l-4 border-l-accent-coral bg-coral-ring',
                    // Token-eased hover/press, reduce-motion safe.
                    'transition-[border-color,transform,background-color] duration-[var(--duration-med)] ease-[var(--ease-out)]',
                    'motion-reduce:transition-none',
                    'hover:bg-bg-card-hover active:scale-[0.985] motion-reduce:active:scale-100',
                    'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                  )}
                  data-testid="fm-now-card"
                  onClick={() => setDetailSet(s)}
                  aria-label={`${artistDisplayName(s, currentFestival.b2bSeparator)} playing now${stageName ? ' at ' + stageName : ''}, open details`}
                >
                  <div className="type-title text-text-primary">
                    {artistDisplayName(s, currentFestival.b2bSeparator)}
                  </div>
                  {stageName && (
                    <div className="type-caption text-text-secondary mt-0.5 leading-[1.3]">{stageName}</div>
                  )}
                  <div className="type-label text-accent-aqua mt-1 tabular-nums leading-[1.3] font-semibold">
                    until {fmtClock(new Date(end))}
                  </div>
                </button>
              );
            })
          ) : (
            <EmptyState
              className="py-3"
              icon={<Music className="w-7 h-7" aria-hidden="true" />}
              title="Nothing playing right now"
              description="Enjoy the walk — your next set will show up below."
            />
          )}
        </section>

        <section className="mb-5" aria-labelledby="fm-next-title">
          <h2 id="fm-next-title" className="type-micro text-text-secondary mb-2 leading-[1.15]">
            {/* Swapped unicode ⏭ for the lucide icon so both section titles
              (NOW dot + UP NEXT) share the same icon system used elsewhere
              in the app (Trophy, Clock, Sparkles on /wrap, etc). */}
            <SkipForward className="w-3.5 h-3.5 inline-block -mt-0.5" aria-hidden="true" /> UP NEXT
          </h2>
          {upcoming.length > 0 ? (
            upcoming.map(({ set: s, start }) => {
              const stageName = getStageName(s.stageId) || '';
              const stageColor = getStageColor(s.stageId);
              const mins = Math.round((start - now.getTime()) / 60_000);
              const imminent = mins <= IMMINENT_MIN;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={cn(
                    // Same signature glass surface as the NOW card; the left
                    // border is stage-colored (set inline below) instead of coral.
                    'fm-card-enter motion-reduce:animate-none',
                    'block w-full text-left p-4 mb-2 cursor-pointer',
                    'bg-bg-card glass-xs border border-border rounded-xl border-l-4',
                    'transition-[border-color,transform,background-color] duration-[var(--duration-med)] ease-[var(--ease-out)]',
                    'motion-reduce:transition-none',
                    'hover:bg-bg-card-hover active:scale-[0.985] motion-reduce:active:scale-100',
                    'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                  )}
                  style={{ borderLeftColor: stageColor }}
                  data-testid="fm-next-card"
                  onClick={() => setDetailSet(s)}
                  aria-label={`${artistDisplayName(s, currentFestival.b2bSeparator)}${stageName ? ' at ' + stageName : ''} ${fmtCountdown(mins)}, open details`}
                >
                  <div className="type-title text-text-primary">
                    {artistDisplayName(s, currentFestival.b2bSeparator)}
                  </div>
                  <div className="flex justify-between items-baseline gap-2 mt-1 flex-wrap">
                    {stageName && <span className="type-caption text-text-secondary leading-[1.3]">{stageName}</span>}
                    <span className="type-caption text-accent-aqua tabular-nums leading-[1.3]">
                      {fmtClock(new Date(start))}
                    </span>
                    <span
                      className={cn(
                        'type-caption text-accent-aqua font-semibold ml-1.5 tabular-nums leading-[1.15] tracking-[-0.01em]',
                        'transition-colors duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none',
                        imminent && 'text-accent-coral font-bold',
                      )}
                    >
                      {fmtCountdown(mins)}
                    </span>
                  </div>
                </button>
              );
            })
          ) : picks && Object.keys(picks).length === 0 ? (
            <EmptyState
              className="py-3"
              icon={<Star className="w-7 h-7" aria-hidden="true" />}
              title="No picks yet"
              description="Browse the lineup and pick your must-see sets."
              cta={{ label: 'Browse the lineup', onClick: () => navigate({ to: '/cards' }) }}
            />
          ) : (
            <EmptyState
              className="py-3"
              icon={<SkipForward className="w-7 h-7" aria-hidden="true" />}
              title="No more picks today"
              description="Rest those legs — you've seen everything on your list."
            />
          )}
        </section>
      </div>

      {/* Battery is a paired constraint with no-signal at a festival — surface
          the low-power toggle right here on the festival-mode screen. */}
      <div className="mt-2">
        <LowPowerToggle />
      </div>
    </div>
  );
}
