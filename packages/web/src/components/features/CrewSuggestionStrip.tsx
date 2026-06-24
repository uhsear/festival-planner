import { useMemo, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { usePicks, useCrewNudges, useFestival } from '@festie/shared/hooks';
import { useFestivalStore } from '@festie/shared/stores';
import { artistDisplayName, buildOverlapBreakdown, resolveStageColor } from '@festie/shared/utils';
import StageBadge from '../ui/StageBadge';
import CrewOverlapAvatars, { OverlapFriend } from './CrewOverlapAvatars';
import { cn } from '@/lib/utils';

/**
 * Stable per-set session-dismiss key so an added/dismissed suggestion never
 * re-nags within a browser session (mirrors ClashPrompt's pairKey pattern).
 */
function dismissKey(setId: string): string {
  return `festie-crew-nudge:${setId}`;
}

/**
 * "Your crew is seeing these" — a dismissible strip on /picks surfacing sets the
 * crew has consensus on that the current user hasn't picked. One-tap Add applies
 * the crew's top priority via the optimistic/offline-queued savePick; once added
 * the underlying useCrewNudges drops the row (getMyPick is now set). Renders
 * nothing when there are no suggestions.
 */
export default function CrewSuggestionStrip() {
  const nudges = useCrewNudges();
  const { savePick } = usePicks();
  const { getStageColor: getStageColorRaw, getStageName } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)');
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const b2bSeparator = currentFestival?.b2bSeparator;

  // Session-dismissed sets, seeded from sessionStorage so a reload/return to
  // /picks doesn't re-surface a suggestion the user already waved off.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const next = new Set<string>();
    if (typeof sessionStorage === 'undefined') return next;
    for (const n of nudges) {
      if (sessionStorage.getItem(dismissKey(n.set.id)) === '1') next.add(n.set.id);
    }
    return next;
  });

  const dismiss = useCallback((setId: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(setId);
      return next;
    });
    try {
      sessionStorage?.setItem(dismissKey(setId), '1');
    } catch {
      /* private mode / quota — in-memory dismissal still holds */
    }
  }, []);

  const visible = useMemo(() => nudges.filter((n) => !dismissed.has(n.set.id)), [nudges, dismissed]);

  const handleAdd = useCallback(
    (setId: string, priority: Parameters<typeof savePick>[2]) => {
      if (!currentFestival) return;
      // savePick is optimistic + offline-queued; once it lands getMyPick(setId)
      // is set so useCrewNudges drops this row on the next render. Swallow the
      // rejection here — the store surfaces its own error and the offline queue
      // retries; never throw out of a click handler.
      savePick(currentFestival.id, setId, priority).catch(() => {});
    },
    [currentFestival, savePick],
  );

  if (visible.length === 0) return null;

  return (
    <section
      className="mb-3 rounded-xl border border-glass-border bg-bg-card glass-xs p-3"
      aria-label="Crew suggestions"
    >
      <h2 className="mb-2 text-sm font-bold text-text-primary">Your crew is seeing these</h2>
      <ul className="flex flex-col gap-2">
        {visible.map((nudge) => {
          const set = nudge.set;
          const dn = artistDisplayName(set, b2bSeparator);
          const stageColor = getStageColor(set.stageId);
          const stageName = getStageName(set.stageId) || set.stageName || 'Stage';
          // Going-count phrasing, e.g. "3 going — 2 must, 1 want".
          const breakdown = buildOverlapBreakdown(nudge.backers);
          const goingLabel = `${nudge.count} going${breakdown ? ` — ${breakdown}` : ''}`;
          // Feed the avatar cluster the same priority-grouped shape SetCard uses.
          const friends: OverlapFriend[] = nudge.backers.map((b) => ({
            profileId: b.userId,
            name: b.name,
            priority: b.priority,
          }));
          const addLabel = `Add ${dn} to my picks` + (breakdown ? ` — ${nudge.count} crew going: ${breakdown}` : '');

          return (
            <li key={set.id} className="flex items-center gap-3 rounded-lg border border-border bg-bg-card px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-text-primary">{dn}</span>
                  <StageBadge variant="pick" stageName={stageName} stageColor={stageColor} />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <CrewOverlapAvatars friends={friends} artistName={dn} />
                  <span className="text-xs text-text-muted">{goingLabel}</span>
                </div>
              </div>

              <button
                type="button"
                className={cn(
                  'shrink-0 rounded-full px-4 py-2 text-sm font-bold',
                  'bg-accent-aqua text-bg-primary',
                  'transition-[transform,box-shadow] duration-150 active:scale-[0.96] motion-reduce:transform-none',
                  'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                )}
                aria-label={addLabel}
                onClick={() => handleAdd(set.id, nudge.topPriority)}
              >
                Add
              </button>
              <button
                type="button"
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  'text-text-muted hover:text-text-secondary',
                  'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                )}
                aria-label={`Dismiss suggestion: ${dn}`}
                onClick={() => dismiss(set.id)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
