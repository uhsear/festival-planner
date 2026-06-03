import React, { useMemo, useState } from 'react';
import {
  useFestivalStore,
  useCrewStore,
  useFestival,
  artistDisplayName,
  formatTime,
  getSetTimeBounds,
  type FestivalSet,
  type PollSetRef,
} from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import IconButton from '../ui/IconButton';
import { CalendarClock, X } from 'lucide-react';

interface Props {
  crewId: string;
  onCreated: () => void;
  onCancel: () => void;
}

interface Slot {
  /** `HH:MM` start time shared by every set in the slot. */
  startTime: string;
  /** Day index this slot belongs to (slots never span days). */
  dayIndex: number;
  sets: FestivalSet[];
}

const REMINDER_LEAD_MINUTES = 15;
const MAX_OPTIONS = 4;

/**
 * Schedule-aware poll composer (M2). BEFORE-planning helper: the crew picks a
 * timeslot from the lineup and the sets clashing in that slot become poll
 * options ("which set at 9pm?"). The option→set linkage rides along in local
 * state (`createPoll`'s `setRefs`, never sent to the server) so that when the
 * poll closes the winning set spawns a shared meeting point + a seeded reminder.
 *
 * Offline-degraded by design: the lineup is read from the persisted festival
 * cache and `createPoll` is offline-create-eligible (queues + reconciles), so
 * this composes fine on dead signal — it's just primarily a pre-festival tool.
 */
export default function SchedulePollComposer({ crewId, onCreated, onCancel }: Props) {
  const { toast } = useToast();
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const { getStageName } = useFestival();
  const createPoll = useCrewStore((s) => s.createPoll);

  // Group the lineup into start-time slots (a "9pm clash" = every set starting
  // at 21:00 that day). Sorted by day then time so the picker reads in order.
  const slots = useMemo<Slot[]>(() => {
    const byKey = new Map<string, Slot>();
    for (const set of sets) {
      if (!set.startTime || typeof set.dayIndex !== 'number') continue;
      const key = `${set.dayIndex}|${set.startTime}`;
      const slot = byKey.get(key);
      if (slot) slot.sets.push(set);
      else byKey.set(key, { startTime: set.startTime, dayIndex: set.dayIndex, sets: [set] });
    }
    return Array.from(byKey.values())
      .filter((s) => s.sets.length >= 2) // a poll needs ≥2 options
      .sort((a, b) => a.dayIndex - b.dayIndex || a.startTime.localeCompare(b.startTime));
  }, [sets]);

  const [slotKey, setSlotKey] = useState('');
  const [question, setQuestion] = useState('');
  // Index-aligned with the selected slot's sets: which sets are included.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const selectedSlot = useMemo(
    () => slots.find((s) => `${s.dayIndex}|${s.startTime}` === slotKey) ?? null,
    [slots, slotKey],
  );

  const dayLabel = (dayIndex: number) => days[dayIndex]?.label || days[dayIndex]?.date || `Day ${dayIndex + 1}`;

  function selectSlot(key: string) {
    setSlotKey(key);
    const slot = slots.find((s) => `${s.dayIndex}|${s.startTime}` === key);
    if (!slot) {
      setPicked({});
      setQuestion('');
      return;
    }
    // Default: include the first MAX_OPTIONS sets, prefill a friendly question.
    const next: Record<string, boolean> = {};
    slot.sets.forEach((set, i) => {
      next[set.id] = i < MAX_OPTIONS;
    });
    setPicked(next);
    if (!question.trim()) setQuestion(`Which set at ${formatTime(slot.startTime)}?`);
  }

  const chosenSets = useMemo(
    () => (selectedSlot ? selectedSlot.sets.filter((s) => picked[s.id]) : []),
    [selectedSlot, picked],
  );

  function toggle(setId: string) {
    setPicked((prev) => {
      const wouldSelect = !prev[setId];
      const count = Object.values(prev).filter(Boolean).length;
      if (wouldSelect && count >= MAX_OPTIONS) return prev; // cap at 4 options
      return { ...prev, [setId]: wouldSelect };
    });
  }

  const canCreate = !!question.trim() && chosenSets.length >= 2 && chosenSets.length <= MAX_OPTIONS;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const options = chosenSets.map((set) => artistDisplayName(set));
      const setRefs: (PollSetRef | null)[] = chosenSets.map((set) => {
        const bounds = getSetTimeBounds(set, days);
        return {
          setId: set.id,
          label: artistDisplayName(set),
          stageReference: getStageName(set.stageId) ?? set.stageName ?? null,
          meetAt: bounds ? new Date(bounds.startMs).toISOString() : null,
        };
      });
      await createPoll(crewId, { question: question.trim(), options }, setRefs);
      toast('Schedule poll created', 'success');
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create poll', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (slots.length === 0) {
    return (
      <div className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-text-primary flex items-center gap-2">
            <CalendarClock className="w-4 h-4" aria-hidden="true" /> Schedule poll
          </h3>
          <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={onCancel} />
        </div>
        <p className="text-sm text-text-muted">
          No clashing timeslots in this lineup yet — schedule polls need at least two sets starting at the same time.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary flex items-center gap-2">
          <CalendarClock className="w-4 h-4" aria-hidden="true" /> Schedule poll
        </h3>
        <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={onCancel} />
      </div>

      <div>
        <label htmlFor="slot-picker" className="block text-sm font-medium text-text-primary mb-2">
          Timeslot
        </label>
        <select
          id="slot-picker"
          value={slotKey}
          onChange={(e) => selectSlot(e.target.value)}
          className="w-full min-h-11 rounded-lg bg-bg-input border border-border px-3 text-text-primary"
        >
          <option value="">Pick a timeslot…</option>
          {slots.map((slot) => {
            const key = `${slot.dayIndex}|${slot.startTime}`;
            return (
              <option key={key} value={key}>
                {dayLabel(slot.dayIndex)} · {formatTime(slot.startTime)} — {slot.sets.length} sets
              </option>
            );
          })}
        </select>
      </div>

      {selectedSlot && (
        <>
          <Input
            label="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Which set should we catch?"
            required
          />
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Options (pick 2–{MAX_OPTIONS})</label>
            <div className="space-y-2">
              {selectedSlot.sets.map((set) => {
                const checked = !!picked[set.id];
                const stage = getStageName(set.stageId) ?? set.stageName;
                return (
                  <label
                    key={set.id}
                    className="flex items-center gap-2 p-2 rounded-lg border border-border min-h-11 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(set.id)}
                      aria-label={`Include ${artistDisplayName(set)}`}
                    />
                    <span className="flex-1 text-text-primary text-sm truncate">{artistDisplayName(set)}</span>
                    {stage && <span className="text-xs text-text-muted truncate">{stage}</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <Button type="submit" variant="primary" isLoading={busy} disabled={!canCreate} className="w-full min-h-11">
            Create schedule poll
          </Button>
          <p className="text-xs text-text-muted">
            When this poll closes, the winning set becomes a crew meeting point and a {REMINDER_LEAD_MINUTES}-minute
            reminder.
          </p>
        </>
      )}
    </form>
  );
}
