import React, { useMemo } from 'react';
import { useFestivalStore, useAuthStore, useCrewStore } from '@festie/shared/stores';
import { useCrew, useFestival } from '@festie/shared/hooks';
import { formatTime } from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import GuestTeaser from '../components/features/GuestTeaser';
import EmptyState from '../components/ui/EmptyState';
import Avatar from '../components/ui/Avatar';
import { Users } from 'lucide-react';

// Schedule Compare — the legacy "renderCrewSchedule" view, ported.
// Rows = sets on the selected day that any crew member picked.
// Columns = crew members (me first). Cells = that member's priority, or blank.
//
// Why a dedicated route instead of a tab inside /crew: /crew is already full
// (Members/Meet/Polls/Expenses/Activity) and CLAUDE.md forbids stretching
// that view. /compare is reachable from the Crew page "Compare schedules"
// affordance and from the header when a crew is active.

const PRIORITY_STYLE: Record<Priority, { label: string; bg: string; fg: string }> = {
  'must':        { label: 'Must',  bg: 'var(--priority-must)',  fg: 'var(--text-primary)' },
  'want-to-see': { label: 'Want',  bg: 'var(--priority-want)',  fg: 'var(--bg-primary)' },
  'maybe':       { label: 'Maybe', bg: 'var(--priority-maybe)', fg: 'var(--bg-primary)' },
};

export default function CompareView() {
  const user           = useAuthStore((s) => s.user);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const days           = useFestivalStore((s) => s.days);
  const sets           = useFestivalStore((s) => s.sets);
  const selectedDay    = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const activeCrew     = useCrewStore((s) => s.activeCrew);

  const { getCrewScopedProfiles, getCrewScopedOtherPicks } = useCrew();
  const { getStageColor, getStageName } = useFestival();

  // Members shown as columns: me first (if I have a profile), then crew.
  const columns = useMemo(() => {
    const others = getCrewScopedProfiles().filter((p) => p.id !== currentProfile?.id);
    const me     = currentProfile ? [{ ...currentProfile, isMe: true as const }] : [];
    return [...me, ...others.map((p) => ({ ...p, isMe: false as const }))];
  }, [getCrewScopedProfiles, currentProfile]);

  // Rows: sets on selectedDay that have at least one picker in the crew (incl. me).
  const rows = useMemo(() => {
    return sets
      .filter((s) => s.dayIndex === selectedDay)
      .map((s) => {
        const mine   = currentProfile?.picks?.[s.id] as Priority | undefined;
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
      <div className="px-4 py-8 max-w-2xl mx-auto">
        <EmptyState
          icon={<Users className="w-12 h-12" />}
          title="No crew selected"
          description="Create or join a crew to compare schedules with your friends."
        />
      </div>
    );
  }

  const pickFor = (profileId: string, setId: string, isMe: boolean, mine?: Priority, others?: Array<{ profileId: string; priority: Priority }>): Priority | undefined => {
    if (isMe) return mine;
    return others?.find((o) => o.profileId === profileId)?.priority;
  };

  return (
    <div className="compare-page pb-24">
      <header className="px-4 pt-4 pb-2 max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-text-primary">Compare schedules</h1>
        <p className="text-sm text-text-secondary mt-1">
          {activeCrew.name} · {columns.length} {columns.length === 1 ? 'member' : 'members'}
        </p>
      </header>

      {/* Day tabs — mirrors /picks day selector */}
      {days.length > 1 && (
        <div className="px-4 max-w-6xl mx-auto">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide py-2" role="tablist" aria-label="Day">
            {days.map((d, idx) => (
              <button
                key={d.id}
                role="tab"
                aria-selected={selectedDay === idx}
                onClick={() => setSelectedDay(idx)}
                className={`flex-shrink-0 min-h-11 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedDay === idx
                    ? 'bg-accent-aqua/15 text-accent-aqua border border-accent-aqua/30'
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
        <div className="px-4 max-w-2xl mx-auto mt-6">
          <EmptyState
            icon={<Users className="w-12 h-12" />}
            title="No picks on this day yet"
            description="Once you or your crew pick a set, it'll show up here for side-by-side comparison."
          />
        </div>
      ) : (
        <div className="px-4 max-w-6xl mx-auto mt-2 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="sticky left-0 bg-bg-primary z-10 py-2 pr-3 min-w-[180px]">Set</th>
                {columns.map((c) => (
                  <th key={c.id} className="py-2 px-2 text-center min-w-[72px]">
                    <div className="flex flex-col items-center gap-1">
                      <Avatar name={c.name || 'User'} size="sm" />
                      <span className="text-[11px] normal-case font-medium text-text-secondary truncate max-w-[72px]">
                        {c.isMe ? 'You' : (c.name || 'Member')}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ set, mine, others, pickers }) => {
                const stageColor = getStageColor(set.stageId);
                const consensus  = pickers === columns.length && columns.length > 1;
                return (
                  <tr key={set.id} className="border-t border-border">
                    <th
                      scope="row"
                      className="sticky left-0 bg-bg-primary z-10 py-3 pr-3 align-top text-left"
                      style={{ borderLeft: `3px solid ${stageColor}` }}
                      className="pl-2.5"
                    >
                      <div className="font-semibold text-text-primary truncate max-w-[180px]">{set.artist}</div>
                      <div className="text-xs text-text-secondary">
                        {formatTime(set.startTime)}–{formatTime(set.endTime)}
                      </div>
                      <div className="text-xs" style={{ color: stageColor }}>{getStageName(set.stageId)}</div>

                      {consensus && (
                        <div className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/20 text-accent-amber font-semibold">
                          All going
                        </div>
                      )}
                    </th>
                    {columns.map((c) => {
                      const p = pickFor(c.id, set.id, c.isMe, mine, others);
                      return (
                        <td key={c.id} className="py-3 px-2 text-center align-middle">
                          {p ? (
                            <span
                              className="inline-block text-[11px] font-semibold px-2 py-1 rounded"
                              style={{ background: PRIORITY_STYLE[p].bg, color: PRIORITY_STYLE[p].fg }}
                            >
                              {PRIORITY_STYLE[p].label}
                            </span>
                          ) : (
                            <span className="text-text-muted text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
