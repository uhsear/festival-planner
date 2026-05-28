import { FestivalSet, Priority } from '../types/domain';
import { timeToMinutes } from './format';

export interface ConflictDetected {
  setA: FestivalSet;
  setB: FestivalSet;
  overlapMinutes: number;
}

export type GetMyPickFn = (setId: string) => Priority | undefined | null;

export function detectConflicts(
  sets: FestivalSet[],
  getMyPick: GetMyPickFn,
): ConflictDetected[] {
  const picked = sets.filter((s) => getMyPick(s.id) && s.startTime && s.endTime);
  const conflicts: ConflictDetected[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      const a = picked[i]!;
      const b = picked[j]!;

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

export function findAlternatives(
  conflictingSetId: string,
  allSets: FestivalSet[],
  getMyPick: GetMyPickFn,
  limit: number = 3,
): FestivalSet[] {
  const targetSet = allSets.find((s) => s.id === conflictingSetId);
  if (!targetSet || !targetSet.startTime || !targetSet.endTime) return [];

  const tS = timeToMinutes(targetSet.startTime);
  let tE = timeToMinutes(targetSet.endTime);
  if (tE <= tS) tE += 1440;

  const otherPicked = allSets.filter(
    (s) => s.id !== conflictingSetId && getMyPick(s.id) && s.startTime && s.endTime,
  );

  return allSets
    .filter((s) => {
      if (s.id === conflictingSetId) return false;
      if (getMyPick(s.id)) return false;
      if (!s.startTime || !s.endTime) return false;
      if (s.stageId === targetSet.stageId) return false;

      const sS = timeToMinutes(s.startTime);
      let sE = timeToMinutes(s.endTime);
      if (sE <= sS) sE += 1440;

      if (!(sS < tE && tS < sE)) return false;

      for (const op of otherPicked) {
        const opS = timeToMinutes(op.startTime);
        let opE = timeToMinutes(op.endTime);
        if (opE <= opS) opE += 1440;
        if (sS < opE && opS < sE) return false;
      }

      return true;
    })
    .slice(0, limit);
}

export function hasConflict(
  setId: string,
  sets: FestivalSet[],
  getMyPick: GetMyPickFn,
): boolean {
  const conflictIds = getConflictingSetIds(sets, getMyPick);
  return conflictIds.has(setId);
}
