import React, { useMemo } from 'react';
import { useFestivalStore, useAuthStore, useCrewStore } from '@festie/shared/stores';
import { useCrew, useFestival } from '@festie/shared/hooks';
import type { Priority } from '@festie/shared/types';
import GuestTeaser from '../components/features/GuestTeaser';
import EmptyState from '../components/ui/EmptyState';
import CompareColumn from '../components/compare/CompareColumn';
import CompareRow from '../components/compare/CompareRow';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';
import { Users } from 'lucide-react';

export default function CompareView() {
  return (
    <RenderErrorBoundary name="compare">
      <CompareViewInner />
    </RenderErrorBoundary>
  );
}

function CompareViewInner() {
  const user = useAuthStore((s) => s.user);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const days = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const activeCrew = useCrewStore((s) => s.activeCrew);

  const { getCrewScopedProfiles, getCrewScopedOtherPicks } = useCrew();
  const { getStageColor, getStageName } = useFestival();

  const columns = useMemo(() => {
    const others = getCrewScopedProfiles().filter((p) => p.id !== currentProfile?.id);
    const me = currentProfile ? [{ ...currentProfile, isMe: true as const }] : [];
    return [...me, ...others.map((p) => ({ ...p, isMe: false as const }))];
  }, [getCrewScopedProfiles, currentProfile]);

  // N1: tween the live member count when crew membership changes in real time.
  const animatedMemberCount = useAnimatedNumber(columns.length);

  const rows = useMemo(() => {
    return sets
      .filter((s) => s.dayIndex === selectedDay)
      .map((s) => {
        const mine = currentProfile?.picks?.[s.id] as Priority | undefined;
        const others = getCrewScopedOtherPicks(s.id);
        const pickers = (mine ? 1 : 0) + others.length;
        return { set: s, mine, others, pickers };
      })
      .filter((r) => r.pickers > 0)
      .sort((a, b) => (a.set.startTime || '').localeCompare(b.set.startTime || ''));
  }, [sets, selectedDay, currentProfile, getCrewScopedOtherPicks]);

  if (!user) return <GuestTeaser mode="crew" />;

  if (!activeCrew) {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title="No crew selected"
          description="Create or join a crew to compare schedules with your friends."
        />
      </div>
    );
  }

  return (
    <div className="compare-page pb-24">
      <header className="pb-2 max-w-6xl mx-auto">
        <h1 className="text-xl font-display font-bold text-text-primary">Compare schedules</h1>
        <p className="text-sm text-text-secondary mt-1">
          {activeCrew.name} {'·'} {animatedMemberCount} {columns.length === 1 ? 'member' : 'members'}
        </p>
      </header>

      {days.length > 1 && (
        <div className="max-w-6xl mx-auto">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide py-2" role="tablist" aria-label="Day">
            {days.map((d, idx) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={selectedDay === idx}
                tabIndex={selectedDay === idx ? 0 : -1}
                onClick={() => setSelectedDay(idx)}
                className={`flex-shrink-0 min-h-11 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedDay === idx
                    ? 'bg-accent-aqua text-[var(--text-on-light-accent)] border border-accent-aqua'
                    : 'bg-bg-card text-text-secondary border border-border'
                }`}
              >
                {d.label || d.date}
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="max-w-2xl mx-auto mt-6">
          <EmptyState
            icon={<Users className="w-12 h-12" aria-hidden="true" />}
            title="No picks on this day yet"
            description="Once you or your crew pick a set, it'll show up here for side-by-side comparison."
          />
        </div>
      ) : (
        <div className="max-w-6xl mx-auto mt-2 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                <th scope="col" className="sticky left-0 bg-bg-primary z-10 py-2 pr-3 min-w-[180px]">
                  Set
                </th>
                {columns.map((c) => (
                  <CompareColumn key={c.id} id={c.id} name={c.name} isMe={c.isMe} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ set, mine, others, pickers }) => (
                <CompareRow
                  key={set.id}
                  set={set}
                  mine={mine}
                  others={others}
                  columns={columns}
                  stageColor={getStageColor(set.stageId)}
                  stageName={getStageName(set.stageId) ?? ''}
                  isConsensus={pickers === columns.length && columns.length > 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
