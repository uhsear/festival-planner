/**
 * Crew-plan digest assembly — the PURE, offline-native logic behind the web and
 * mobile "crew plan" screens. Both screens previously kept byte-identical copies
 * of `pickActiveMeetingPoint` + `buildSlots`; they now share this single source.
 *
 * Everything here reads only its arguments (no stores, no fetches, no globals) so
 * the screens stay thin wiring and a Vitest unit can exercise the logic directly.
 *
 * NOTE: this `pickActiveMeetingPoint(points, nowMs)` is the crew-plan variant
 * (soonest future-or-now timed point, else most-recent untimed). It is distinct
 * from `ongoingNotification.pickActiveMeetingPoint(points)`, which picks the most
 * recently-set active point for the ongoing-set notification — different inputs,
 * different intent, kept separate on purpose.
 */
import type { CrewMeetingPoint, FestivalDay, FestivalSet, Priority, Profile } from '../types/domain';
import { PRIORITY_WEIGHT } from './crewNudges';
import { getSetTimeBounds } from './setStatus';

/** Default number of upcoming start-time slots surfaced by `buildSlots`. */
export const CREW_PLAN_SLOTS = 3;

/** The soonest still-active meeting point with a future-or-now meet time. */
export function pickActiveMeetingPoint(points: CrewMeetingPoint[], nowMs: number): CrewMeetingPoint | null {
  const future = points
    .filter((p) => p.active && p.meet_at)
    .map((p) => ({ p, ms: new Date(p.meet_at as string).getTime() }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= nowMs)
    .sort((a, b) => a.ms - b.ms);
  if (future.length > 0) return future[0]!.p;
  // No timed future point — fall back to the most recent active untimed point so
  // a standing meetup (e.g. "the big tree") still shows.
  const untimed = points.filter((p) => p.active && !p.meet_at);
  return untimed[0] ?? null;
}

export interface SlotPick {
  memberId: string;
  memberName: string;
  set: FestivalSet;
  priority: Priority;
}

export interface Slot {
  startMs: number;
  startTime: string;
  picks: SlotPick[];
}

/**
 * Group future sets into the next `limit` start-time slots and, for each crew
 * member, surface their single highest-priority pick in that slot.
 */
export function buildSlots(
  sets: FestivalSet[],
  days: FestivalDay[],
  profiles: Profile[],
  nowMs: number,
  limit: number = CREW_PLAN_SLOTS,
): Slot[] {
  // Resolve each set's bounds once; keep only sets that haven't ended yet.
  const timed = sets
    .map((set) => ({ set, bounds: getSetTimeBounds(set, days) }))
    .filter((x): x is { set: FestivalSet; bounds: { startMs: number; endMs: number } } => x.bounds != null)
    .filter((x) => x.bounds.endMs > nowMs);

  // Distinct start times become "slots", soonest first, capped to `limit`.
  const startTimes = Array.from(new Set(timed.map((x) => x.bounds.startMs)))
    .sort((a, b) => a - b)
    .slice(0, limit);

  return startTimes.map((startMs) => {
    const slotSets = timed.filter((x) => x.bounds.startMs === startMs).map((x) => x.set);
    const slotSetIds = new Set(slotSets.map((s) => s.id));
    const setsById = new Map(slotSets.map((s) => [s.id, s]));

    const picks: SlotPick[] = [];
    for (const profile of profiles) {
      // Highest-priority pick this member has among the slot's sets.
      let best: { setId: string; priority: Priority } | null = null;
      for (const [setId, priority] of Object.entries(profile.picks || {})) {
        if (!slotSetIds.has(setId)) continue;
        const p = priority as Priority;
        if (!best || PRIORITY_WEIGHT[p] > PRIORITY_WEIGHT[best.priority]) best = { setId, priority: p };
      }
      if (best) {
        picks.push({
          memberId: profile.id,
          memberName: profile.name || 'Crew member',
          set: setsById.get(best.setId)!,
          priority: best.priority,
        });
      }
    }
    // Strongest commitments first.
    picks.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);

    const sampleStart = slotSets[0]?.startTime ?? '';
    return { startMs, startTime: sampleStart, picks };
  });
}
