import { useMemo, useState, useCallback } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName, timeToMinutes } from '@festie/shared/utils';
import { AlertTriangle } from 'lucide-react';
import Button from '../ui/Button';

interface Props {
  /** The set currently open in the detail panel. */
  currentSet: FestivalSet;
  /**
   * Sets that overlap `currentSet` and are also PICKED — already day-index
   * guarded and de-duped upstream by `detectConflicts` in conflicts.ts.
   */
  conflicts: FestivalSet[];
  b2bSeparator?: string;
  /**
   * Resolve the user's pick priority for a set. When both sides of a clash are
   * `must`, the prompt escalates to an explicit "you have a conflict" — the
   * unavoidable decision worth surfacing loudly (Clashfinder pattern). Optional:
   * without it every clash uses the softer "keep one" copy.
   */
  getPriority?: (setId: string) => Priority | null | undefined;
  /**
   * Demote/clear one side of a clash. Maps to usePicks().savePick(fid,id,null),
   * which is offline-queued — resolving a clash works on dead signal.
   */
  onClear: (setId: string) => void;
}

/**
 * Stable, order-independent key for a clash pair so a resolved/dismissed pair
 * never re-nags within a session (the passive DetailConflictWarning badge stays
 * as the ambient marker — this is the one-shot actionable nudge).
 */
function pairKey(a: string, b: string): string {
  return ['festie-clash', ...[a, b].sort()].join(':');
}

/**
 * Earliest overlap start — "2 acts at 8:30" anchors on whichever set starts
 * latest (that is when the two are first both on stage), matching the
 * overlapStart math in conflicts.ts.
 */
function overlapStartLabel(a: FestivalSet, b: FestivalSet): string {
  const aS = timeToMinutes(a.startTime);
  const bS = timeToMinutes(b.startTime);
  const later = aS >= bS ? a : b;
  return formatTime(later.startTime);
}

/**
 * Inline clash prompt (M1). For each overlapping PICKED pair through the open
 * set, names both acts and lets the user keep one — clearing the other via
 * savePick(...,null). Shows once per pair per session; once resolved or
 * dismissed the ambient badge (DetailConflictWarning) carries the signal.
 */
export default function ClashPrompt({ currentSet, conflicts, b2bSeparator, getPriority, onClear }: Props) {
  // Session-dismissed pairs (resolve or "keep both"). Seeded from sessionStorage
  // so a closed/reopened panel doesn't re-nag the same clash.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const next = new Set<string>();
    if (typeof sessionStorage === 'undefined') return next;
    for (const c of conflicts) {
      const k = pairKey(currentSet.id, c.id);
      if (sessionStorage.getItem(k) === '1') next.add(k);
    }
    return next;
  });

  const dismissPair = useCallback((key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    try {
      sessionStorage?.setItem(key, '1');
    } catch {
      /* private mode / quota — in-memory dismissal still holds */
    }
  }, []);

  const active = useMemo(
    () => conflicts.filter((c) => !dismissed.has(pairKey(currentSet.id, c.id))),
    [conflicts, dismissed, currentSet.id],
  );

  if (active.length === 0) return null;

  const currentName = artistDisplayName(currentSet, b2bSeparator);

  return (
    <div className="flex flex-col gap-3">
      {active.map((c) => {
        const key = pairKey(currentSet.id, c.id);
        const otherName = artistDisplayName(c, b2bSeparator);
        const at = overlapStartLabel(currentSet, c);
        // Both sides a must-see → escalate to an explicit conflict.
        const hard = getPriority?.(currentSet.id) === 'must' && getPriority?.(c.id) === 'must';
        const title = hard
          ? `You have a conflict${at ? ` at ${at}` : ''}: keep one`
          : `2 acts${at ? ` at ${at}` : ''}: keep one`;
        const body = hard
          ? `Both ${currentName} and ${otherName} are must-sees but overlap. Keep one and we'll clear the other.`
          : `${currentName} and ${otherName} overlap. Keep one and we'll clear the other.`;
        return (
          <div
            key={c.id}
            role="alert"
            className="rounded-DEFAULT border border-accent-coral/40 bg-accent-coral/[0.1] p-4"
          >
            <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-text-danger)]">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span>{title}</span>
            </div>
            <div className="mt-1 text-[length:var(--font-size-13)] text-text-secondary">{body}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                aria-label={`Keep ${currentName}, clear ${otherName}`}
                onClick={() => {
                  onClear(c.id);
                  dismissPair(key);
                }}
              >
                {`Keep ${currentName}`}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                aria-label={`Keep ${otherName}, clear ${currentName}`}
                onClick={() => {
                  onClear(currentSet.id);
                  dismissPair(key);
                }}
              >
                {`Keep ${otherName}`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label="Keep both acts"
                onClick={() => dismissPair(key)}
              >
                Keep both
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
