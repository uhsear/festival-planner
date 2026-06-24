import { FestivalSet, FestivalDay, Priority } from '../types/domain';
import { getSetTimeBounds } from './setStatus';

// ── Promoted from SetCard ───────────────────────────────────────────────────
// PRIORITY_RANK + buildOverlapBreakdown used to live inline in the web SetCard.
// They moved here so the crew-overlap cluster (SetCard + the new suggestion
// strip) and the nudge aggregation share ONE source of truth for priority
// ordering and the "N must, M want" phrasing — web and mobile both consume them.

// Crew-overlap avatars cluster by priority: must first, then want, then maybe.
// Lower rank sorts earlier. Drives both the visible avatar order and the
// "N of your crew have this as a must" aria-label.
export const PRIORITY_RANK: Record<Priority, number> = {
  must: 0,
  'want-to-see': 1,
  maybe: 2,
};

const PRIORITY_NOUN: Record<Priority, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

// Weighted score per backer priority — drives the suggestion ranking so a set
// two crew-mates flagged as `must` outranks one three crew-mates merely
// `maybe`'d. Mirrors PRIORITY_RANK's must > want > maybe ordering.
// Re-exported from @festie/shared/constants so consumers that need "higher =
// more important" scoring (crew-plan digest, PlanQRShare sort) import once.
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  must: 3,
  'want-to-see': 2,
  maybe: 1,
};

/**
 * Build the human "N of your crew have this as a must" breakdown phrase from a
 * priority-grouped friend list, e.g. "2 must, 1 want". Empty groups are
 * omitted; an all-empty list yields ''.
 */
export function buildOverlapBreakdown(friends: readonly { priority: Priority }[]): string {
  const counts: Record<Priority, number> = {
    must: 0,
    'want-to-see': 0,
    maybe: 0,
  };
  for (const f of friends) counts[f.priority] = (counts[f.priority] ?? 0) + 1;
  return (['must', 'want-to-see', 'maybe'] as const)
    .filter((p) => counts[p] > 0)
    .map((p) => `${counts[p]} ${PRIORITY_NOUN[p]}`)
    .join(', ');
}

// ── Crew "is seeing this — add it?" nudge ────────────────────────────────────

export interface CrewNudgeBacker {
  userId: string;
  name?: string;
  priority: Priority;
}

export interface CrewNudge {
  set: FestivalSet;
  /** Distinct crew humans backing this set, sorted must > want > maybe. */
  backers: CrewNudgeBacker[];
  /** "2 must, 1 want" phrasing over the backers (via buildOverlapBreakdown). */
  breakdown: string;
  /** Number of distinct crew humans backing the set (== backers.length). */
  count: number;
  /** The strongest priority any backer assigned — the priority a one-tap Add applies. */
  topPriority: Priority;
}

interface ProfilePicks {
  userId: string;
  name?: string;
  picks: Record<string, Priority>;
}

export interface BuildCrewNudgesInput {
  sets: FestivalSet[];
  selectedDay: number;
  myPicks: Record<string, Priority>;
  allProfiles: ProfilePicks[];
  crewMemberUserIds: Set<string>;
  myUserId: string;
  /**
   * When supplied alongside `days`, sets that have already ended (relative to
   * `now`) are dropped so we never nudge toward an act that's over. Without
   * resolvable day dates the past filter is skipped (the set still surfaces).
   */
  now?: number;
  days?: FestivalDay[];
  /** Optional festival IANA zone, threaded to getSetTimeBounds for past math. */
  timeZone?: string;
  /** Cap on returned nudges (default 5). */
  limit?: number;
}

/**
 * Surface sets the crew has consensus on that the current user has NOT picked.
 *
 * Pure — no React/store deps — so it's unit-testable and shared by web + mobile.
 * Does its OWN crew-filtered, per-human-deduped aggregation (deliberately NOT
 * reusing usePicks().getOtherPicks, which is neither crew-scoped nor
 * userId-deduped). For each candidate set on `selectedDay` that I haven't picked
 * and that isn't already past:
 *   - collect crew profiles (userId ∈ crew, ≠ me) that picked the set, deduped
 *     to one vote per human at their HIGHEST priority;
 *   - keep the set only if `count >= 2 OR any backer is 'must'`;
 *   - score it (must=3, want=2, maybe=1) summed over distinct backers.
 * Ranked (score desc, mustCount desc, count desc, startTime asc, id asc) and
 * capped to `limit`.
 */
export function buildCrewNudges(input: BuildCrewNudgesInput): CrewNudge[] {
  const {
    sets,
    selectedDay,
    myPicks,
    allProfiles,
    crewMemberUserIds,
    myUserId,
    now,
    days,
    timeZone,
    limit = 5,
  } = input;

  // Solo / no crew → nothing to nudge.
  if (crewMemberUserIds.size === 0) return [];

  const nudges: Array<CrewNudge & { score: number; mustCount: number }> = [];

  for (const set of sets) {
    // Day-scope: only sets on the selected day.
    if ((set.dayIndex ?? 0) !== selectedDay) continue;
    // Already mine → never nudge.
    if (myPicks[set.id]) continue;
    // Already past (best-effort; needs now + resolvable day date).
    if (now != null && days) {
      const bounds = getSetTimeBounds(set, days, timeZone);
      if (bounds && bounds.endMs <= now) continue;
    }

    // Aggregate crew backers, deduped to one vote per human (highest priority).
    const byUser = new Map<string, CrewNudgeBacker>();
    for (const profile of allProfiles) {
      if (profile.userId === myUserId) continue;
      if (!crewMemberUserIds.has(profile.userId)) continue;
      const priority = profile.picks?.[set.id];
      if (!priority) continue;
      const existing = byUser.get(profile.userId);
      if (!existing || PRIORITY_RANK[priority] < PRIORITY_RANK[existing.priority]) {
        byUser.set(profile.userId, {
          userId: profile.userId,
          // Prefer a name from whichever profile we keep; fall back to existing.
          name: profile.name ?? existing?.name,
          priority,
        });
      }
    }

    const backers = Array.from(byUser.values()).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    const count = backers.length;
    if (count === 0) continue;

    const mustCount = backers.filter((b) => b.priority === 'must').length;
    // Threshold: a real signal is 2+ humans OR at least one must.
    if (count < 2 && mustCount === 0) continue;

    const score = backers.reduce((sum, b) => sum + PRIORITY_WEIGHT[b.priority], 0);
    // backers are already must-first, so the first one carries the top priority.
    const topPriority = backers[0]!.priority;

    nudges.push({
      set,
      backers,
      breakdown: buildOverlapBreakdown(backers),
      count,
      topPriority,
      score,
      mustCount,
    });
  }

  nudges.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.mustCount !== a.mustCount) return b.mustCount - a.mustCount;
    if (b.count !== a.count) return b.count - a.count;
    const aStart = a.set.startTime || '';
    const bStart = b.set.startTime || '';
    if (aStart !== bStart) return aStart < bStart ? -1 : 1;
    return a.set.id < b.set.id ? -1 : a.set.id > b.set.id ? 1 : 0;
  });

  // Strip the internal sort keys before returning.
  return nudges.slice(0, limit).map(({ score: _score, mustCount: _mustCount, ...nudge }) => nudge);
}
