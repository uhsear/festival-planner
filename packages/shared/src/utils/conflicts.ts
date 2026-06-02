import { FestivalSet, Priority } from '../types/domain';
import { timeToMinutes } from './format';

export interface ConflictDetected {
  setA: FestivalSet;
  setB: FestivalSet;
  overlapMinutes: number;
}

export type GetMyPickFn = (setId: string) => Priority | undefined | null;

export function detectConflicts(sets: FestivalSet[], getMyPick: GetMyPickFn): ConflictDetected[] {
  const picked = sets.filter((s) => getMyPick(s.id) && s.startTime && s.endTime);
  const conflicts: ConflictDetected[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      const a = picked[i]!;
      const b = picked[j]!;

      // Same clock time on different festival days is NOT a conflict. Guard on
      // dayIndex when both are known; treat null as unknown (time-only fallback)
      // so single-day festivals and callers that don't stamp dayIndex still work.
      if (a.dayIndex != null && b.dayIndex != null && a.dayIndex !== b.dayIndex) continue;

      const aS = timeToMinutes(a.startTime);
      let aE = timeToMinutes(a.endTime);
      if (aE <= aS) aE += 1440;

      const bS = timeToMinutes(b.startTime);
      let bE = timeToMinutes(b.endTime);
      if (bE <= bS) bE += 1440;

      if (aS < bE && bS < aE) {
        const key = [a.id, b.id].sort().join('-');
        if (!seen.has(key)) {
          seen.add(key);
          const overlapStart = Math.max(aS, bS);
          const overlapEnd = Math.min(aE, bE);
          conflicts.push({
            setA: a,
            setB: b,
            overlapMinutes: overlapEnd - overlapStart,
          });
        }
      }
    }
  }

  return conflicts;
}

export function getConflictingSetIds(sets: FestivalSet[], getMyPick: GetMyPickFn): Set<string> {
  const conflicts = detectConflicts(sets, getMyPick);
  const ids = new Set<string>();
  conflicts.forEach(({ setA, setB }) => {
    ids.add(setA.id);
    ids.add(setB.id);
  });
  return ids;
}

export function hasConflict(setId: string, sets: FestivalSet[], getMyPick: GetMyPickFn): boolean {
  const conflictIds = getConflictingSetIds(sets, getMyPick);
  return conflictIds.has(setId);
}
