import { useMemo, useState, useCallback } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import type { FestivalSet, Priority, Stage } from '@festie/shared/types';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { useToast } from '../lib/toastContext';
import { Layers, Sparkles, ChevronDown } from 'lucide-react';

// M2 bulk pick helpers (before-festival planning). Operates ENTIRELY on the
// cached festivalDataStore.sets / .stages + artist genres — no network reads —
// and applies a whole group in ONE coalesced write via the store's
// `bulkSavePicks(setIds, priority)` (a single PUT, offline-native + queued).
//
// Surfaces three bulk affordances scoped to the currently-selected day:
//   • "Add all must-see on this stage"  (per stage)
//   • per-genre  (every set whose artists list that genre)
// The chosen priority defaults to must-see (the headline "must-see on a stage"
// ask) but can be switched to want/maybe before applying.

const PRIORITY_OPTIONS: ReadonlyArray<{ value: Priority; label: string }> = [
  { value: 'must', label: 'Must' },
  { value: 'want-to-see', label: 'Want' },
  { value: 'maybe', label: 'Maybe' },
];

/** Lowercased, de-duped genre list across a set's artists. */
function setGenres(set: FestivalSet): string[] {
  const out = new Set<string>();
  for (const a of set.artists ?? []) {
    for (const g of a.genres ?? []) {
      const t = g.trim();
      if (t) out.add(t);
    }
  }
  return [...out];
}

export default function PickBulkActions() {
  const sets = useFestivalStore((s) => s.sets);
  const stages = useFestivalStore((s) => s.stages);
  const days = useFestivalStore((s) => s.days);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const bulkSavePicks = useFestivalStore((s) => s.bulkSavePicks);
  const { getStageName } = useFestival();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<Priority>('must');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Only the sets on the day currently shown in /picks — bulk actions stay
  // scoped to what the user is looking at rather than silently spanning days.
  const daySets = useMemo(() => sets.filter((s) => s.dayIndex === selectedDay), [sets, selectedDay]);

  // Stages that actually have sets on this day, with their set ids.
  const stageGroups = useMemo(() => {
    const byStage = new Map<string, string[]>();
    for (const set of daySets) {
      const arr = byStage.get(set.stageId);
      if (arr) arr.push(set.id);
      else byStage.set(set.stageId, [set.id]);
    }
    const order = new Map<string, number>();
    stages.forEach((st: Stage, i) => order.set(st.id, i));
    return [...byStage.entries()]
      .map(([stageId, setIds]) => ({
        stageId,
        name: getStageName(stageId) || 'Stage',
        setIds,
      }))
      .sort((a, b) => (order.get(a.stageId) ?? 0) - (order.get(b.stageId) ?? 0));
  }, [daySets, stages, getStageName]);

  // Genres present on this day, with their set ids (a set lists under every
  // genre any of its artists carries).
  const genreGroups = useMemo(() => {
    const byGenre = new Map<string, string[]>();
    for (const set of daySets) {
      for (const g of setGenres(set)) {
        const key = g.toLowerCase();
        const arr = byGenre.get(key);
        if (arr) arr.push(set.id);
        else byGenre.set(key, [set.id]);
      }
    }
    return [...byGenre.entries()]
      .map(([key, setIds]) => ({ key, label: key, setIds }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [daySets]);

  const apply = useCallback(
    async (key: string, label: string, setIds: string[]) => {
      if (setIds.length === 0 || busyKey) return;
      setBusyKey(key);
      try {
        await bulkSavePicks(setIds, priority);
        const pLabel = PRIORITY_OPTIONS.find((p) => p.value === priority)?.label ?? '';
        toast(`Added ${setIds.length} set${setIds.length === 1 ? '' : 's'} from ${label} to ${pLabel}`, 'success');
      } catch {
        // bulkSavePicks already rolled back + set the store error; surface a toast.
        toast('Could not add picks', 'error');
      } finally {
        setBusyKey(null);
      }
    },
    [bulkSavePicks, priority, busyKey, toast],
  );

  const dayLabel = days[selectedDay]?.label;
  const hasGroups = stageGroups.length > 0 || genreGroups.length > 0;
  if (!hasGroups) return null;

  return (
    <div className="mb-3 rounded-xl border border-border bg-bg-card">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 rounded-xl"
        aria-expanded={open}
        aria-label={`Bulk add picks${dayLabel ? ` for ${dayLabel}` : ''}, ${open ? 'collapse' : 'expand'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
        <span className="text-sm font-semibold">Bulk add picks{dayLabel ? ` · ${dayLabel}` : ''}</span>
        <ChevronDown
          className={`w-4 h-4 ml-auto text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border">
          {/* Priority selector — which bucket the bulk add lands in. */}
          <div className="flex items-center gap-2 mb-3" role="radiogroup" aria-label="Priority for bulk add">
            <span className="text-xs text-text-muted">Add as</span>
            {PRIORITY_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={priority === p.value}
                aria-label={`${
                  p.value === 'must' ? 'Must See' : p.value === 'want-to-see' ? 'Want to See' : 'Maybe'
                }${priority === p.value ? ' (selected)' : ''}`}
                onClick={() => setPriority(p.value)}
                className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${
                  priority === p.value
                    ? 'border-accent-aqua text-accent-aqua bg-bg-card-hover'
                    : 'border-border text-text-secondary hover:bg-bg-card-hover'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {stageGroups.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-text-secondary">
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                By stage
              </div>
              <div className="flex flex-wrap gap-2">
                {stageGroups.map((g) => (
                  <Button
                    key={g.stageId}
                    variant="secondary"
                    size="sm"
                    type="button"
                    isLoading={busyKey === `stage-${g.stageId}`}
                    disabled={!!busyKey}
                    onClick={() => apply(`stage-${g.stageId}`, g.name, g.setIds)}
                    aria-label={`Add all ${g.setIds.length} sets on ${g.name}`}
                  >
                    {g.name}
                    <Badge variant="outline">{g.setIds.length}</Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {genreGroups.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-text-secondary">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                By genre
              </div>
              <div className="flex flex-wrap gap-2">
                {genreGroups.map((g) => (
                  <Button
                    key={g.key}
                    variant="secondary"
                    size="sm"
                    type="button"
                    isLoading={busyKey === `genre-${g.key}`}
                    disabled={!!busyKey}
                    onClick={() => apply(`genre-${g.key}`, g.label, g.setIds)}
                    aria-label={`Add all ${g.setIds.length} ${g.label} sets`}
                  >
                    <span className="capitalize">{g.label}</span>
                    <Badge variant="outline">{g.setIds.length}</Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
