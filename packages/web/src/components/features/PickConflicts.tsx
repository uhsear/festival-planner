import { useMemo } from 'react';
import { CalendarClock, TriangleAlert } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { buildPickConflicts, artistDisplayName, formatTime } from '@festie/shared/utils';
import type { ConflictGroup, ConflictPick } from '@festie/shared/utils';
import StageBadge from '../ui/StageBadge';
import { cn } from '@/lib/utils';

// Priority chip styling mirrors the Badge tint-ring roles (must=coral, want=aqua,
// maybe=amber) but inline here so the chip can sit tight against the time row.
const PRIORITY_CHIP: Record<Priority, { label: string; className: string }> = {
  must: { label: 'Must', className: 'bg-accent-coral/20 text-accent-coral' },
  'want-to-see': { label: 'Want', className: 'bg-accent-aqua/20 text-accent-aqua' },
  maybe: { label: 'Maybe', className: 'bg-accent-amber/20 text-accent-amber' },
};

/** Human "1h 5m" / "45m" duration phrasing for the split hint + per-act line. */
function fmtDuration(min: number): string {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Schedule-clash advisory for the /picks view. Pulls the user's own picks for the
 * selected day from the festival store, runs the shared `buildPickConflicts` (the
 * single source of truth for overlap detection + keep-recommendation), and renders
 * one compact card per clash group. Advisory only — it never mutates picks; the
 * worst it offers is opening a clashing set's detail panel.
 *
 * Crew context (which crew members are on each side) is wired the same way
 * `useCrewNudges` gets it — `allProfiles` from the festival store + the active
 * crew's member ids — but only when there's an active crew; otherwise the shared
 * util leaves `crewCount` undefined and the card simply omits it.
 *
 * Renders nothing when there are no clashes.
 */
export default function PickConflicts() {
  const sets = useFestivalStore((state) => state.sets);
  const days = useFestivalStore((state) => state.days);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const allProfiles = useFestivalStore((state) => state.allProfiles);

  const activeCrew = useCrewStore((state) => state.activeCrew);
  const crewMembers = useCrewStore((state) => state.crewMembers);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const { getStageName, getStageColor } = useFestival();

  const b2bSeparator = currentFestival?.b2bSeparator;
  const myUserId = currentProfile?.userId;
  const myPicks = currentProfile?.picks;
  const timeZone = currentFestival?.timeZone;

  const groups = useMemo<ConflictGroup[]>(() => {
    if (!myPicks) return [];
    // Crew context only when there's an active crew (mirrors useCrewNudges); the
    // shared util gates on all three being present before populating crewCount.
    const wantCrew = !!activeCrew && !!myUserId;
    return buildPickConflicts({
      sets,
      myPicks,
      selectedDay,
      days,
      timeZone,
      ...(wantCrew
        ? {
            allProfiles,
            crewMemberUserIds: new Set(crewMembers.map((m) => m.userId)),
            myUserId,
          }
        : {}),
    });
  }, [sets, myPicks, selectedDay, days, timeZone, activeCrew, myUserId, allProfiles, crewMembers]);

  if (groups.length === 0) return null;

  // Find the set object behind a clashing pick so we can open its detail panel.
  const openSet = (pick: ConflictPick) => {
    const full = sets.find((s) => s.id === pick.set.id) ?? pick.set;
    setDetailSet(full);
  };

  return (
    <section className="mb-3 flex flex-col gap-3" aria-label="Schedule clashes">
      {groups.map((group, gi) => {
        const overlapMin = group.overlapMin;
        // One-line split hint only when exactly two acts clash: catch the first
        // ~Xm of the earlier-ending act, then the last ~Ym of the other.
        let splitHint: string | null = null;
        if (group.picks.length === 2) {
          const [a, b] = group.picks as [ConflictPick, ConflictPick];
          // a starts no later than b (picks are start-sorted). The non-overlap
          // head of a + the non-overlap tail of b is the realistic "catch both".
          const headA = Math.max(0, Math.round((b.startMs - a.startMs) / 60000));
          const tailB = Math.max(0, Math.round((b.endMs - a.endMs) / 60000));
          const nameA = artistDisplayName(a.set, b2bSeparator);
          const nameB = artistDisplayName(b.set, b2bSeparator);
          splitHint = `Catch the first ~${fmtDuration(headA)} of ${nameA}, then the last ~${fmtDuration(
            tailB,
          )} of ${nameB}.`;
        }

        return (
          <article
            key={`${group.recommendedKeepId}-${gi}`}
            className="rounded-xl border border-priority-must/40 bg-bg-card p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 shrink-0 text-priority-must" aria-hidden="true" />
              <h3 className="text-sm font-bold text-text-primary">Schedule clash</h3>
              {overlapMin > 0 && (
                <span className="ml-auto text-xs font-semibold text-text-muted tabular-nums">
                  {fmtDuration(overlapMin)} overlap
                </span>
              )}
            </div>

            <ul className="flex flex-col gap-2">
              {group.picks.map((pick) => {
                const isKeep = pick.set.id === group.recommendedKeepId;
                const dn = artistDisplayName(pick.set, b2bSeparator);
                const stageName = getStageName(pick.set.stageId) || pick.set.stageName || 'Stage';
                const stageColor = getStageColor(pick.set.stageId);
                const chip = PRIORITY_CHIP[pick.priority];
                const startLabel = pick.set.startTime ? formatTime(pick.set.startTime) : 'TBA';
                const endLabel = pick.set.endTime ? formatTime(pick.set.endTime) : '';
                const timeRange = endLabel ? `${startLabel} – ${endLabel}` : startLabel;

                return (
                  <li
                    key={pick.set.id}
                    className={cn(
                      'rounded-lg border px-3 py-2',
                      // Recommended keep uses the aqua accent (NOT coral — coral is
                      // danger/SOS only). A faint aqua wash + ring marks it.
                      isKeep ? 'border-accent-aqua/60 bg-accent-aqua/5' : 'border-border bg-bg-card',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-text-primary">{dn}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]',
                          chip.className,
                        )}
                      >
                        {chip.label}
                      </span>
                      {isKeep && (
                        <span className="shrink-0 rounded-full bg-accent-aqua/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-accent-aqua">
                          Keep
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="tabular-nums">{timeRange}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{fmtDuration(pick.durationMin)}</span>
                      <StageBadge variant="pick" stageName={stageName} stageColor={stageColor} />
                    </div>

                    {typeof pick.crewCount === 'number' && pick.crewCount > 0 && (
                      <div className="mt-1 text-xs text-text-secondary">
                        {pick.crewCount} crew going{pick.crewBreakdown ? ` — ${pick.crewBreakdown}` : ''}
                      </div>
                    )}

                    <button
                      type="button"
                      className={cn(
                        'mt-2 inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold',
                        'text-accent-aqua hover:bg-accent-aqua/10',
                        'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                      )}
                      aria-label={`Open details for ${dn}`}
                      onClick={() => openSet(pick)}
                    >
                      View set
                    </button>
                  </li>
                );
              })}
            </ul>

            {splitHint && <p className="mt-2 text-xs text-text-secondary">{splitHint}</p>}
          </article>
        );
      })}
    </section>
  );
}
