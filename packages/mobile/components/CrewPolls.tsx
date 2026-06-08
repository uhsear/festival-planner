import { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useFestivalStore, useFestivalDataStore } from '@festie/shared/stores';
import type { CrewPoll, FestivalSet, PollSetRef } from '@festie/shared/types';
import { artistDisplayName, formatTime, getSetTimeBounds } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

// Lead time (minutes) for the reminder seeded when a schedule poll closes.
const SCHEDULE_POLL_REMINDER_LEAD = 15;
const MAX_OPTIONS = 4;

interface Slot {
  startTime: string;
  dayIndex: number;
  sets: FestivalSet[];
}

interface CrewPollsProps {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

/** Tally votes per option and find the current user's vote (if any). */
function tally(poll: CrewPoll, userId: string) {
  const counts = new Array<number>(poll.options.length).fill(0);
  let myVote: number | null = null;
  for (const v of poll.votes) {
    if (v.option >= 0 && v.option < counts.length) {
      counts[v.option] = (counts[v.option] ?? 0) + 1;
    }
    if (v.user_id === userId) myVote = v.option;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(0, ...counts);
  return { counts, myVote, total, maxCount };
}

/**
 * Crew polls — list active polls with live vote bars, vote on an option, create
 * a poll (2–4 options, matching the server schema), and close one (creator or
 * owner). Hits the shared crewStore actions; the screen owns loading.
 */
export default function CrewPolls({ crewId, currentUserId, isOwner }: CrewPollsProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  const polls = useCrewStore((s) => s.polls);
  const createPoll = useCrewStore((s) => s.createPoll);
  const votePoll = useCrewStore((s) => s.votePoll);
  const closePoll = useCrewStore((s) => s.closePoll);

  // Festival lineup (from the persisted festival cache — works offline) powers
  // the schedule-aware composer + the close-time meeting point / reminder.
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const stages = useFestivalStore((s) => s.stages);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalId = currentFestival?.id ?? null;

  const stageName = (stageId: string): string | null => stages.find((st) => st.id === stageId)?.name ?? null;

  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [createBusy, setCreateBusy] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);

  // ── Schedule-aware composer state ──────────────────────────────────────
  const [showSchedule, setShowSchedule] = useState(false);
  const [slotKey, setSlotKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  // Group the lineup into start-time slots that have a clash (≥2 sets) so the
  // crew can vote "which set at 9pm?". Sorted by day then time.
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
      .filter((s) => s.sets.length >= 2)
      .sort((a, b) => a.dayIndex - b.dayIndex || a.startTime.localeCompare(b.startTime));
  }, [sets]);

  const selectedSlot = useMemo(
    () => slots.find((s) => `${s.dayIndex}|${s.startTime}` === slotKey) ?? null,
    [slots, slotKey],
  );

  const dayLabel = (dayIndex: number) => days[dayIndex]?.label || days[dayIndex]?.date || `Day ${dayIndex + 1}`;

  const selectSlot = (slot: Slot) => {
    const key = `${slot.dayIndex}|${slot.startTime}`;
    setSlotKey(key);
    const next: Record<string, boolean> = {};
    slot.sets.forEach((set, i) => {
      next[set.id] = i < MAX_OPTIONS;
    });
    setPicked(next);
    if (!question.trim()) setQuestion(`Which set at ${formatTime(slot.startTime)}?`);
  };

  const toggleSet = (setId: string) =>
    setPicked((prev) => {
      const wouldSelect = !prev[setId];
      const count = Object.values(prev).filter(Boolean).length;
      if (wouldSelect && count >= MAX_OPTIONS) return prev;
      return { ...prev, [setId]: wouldSelect };
    });

  const chosenSets = selectedSlot ? selectedSlot.sets.filter((s) => picked[s.id]) : [];
  const canCreateSchedule = !!question.trim() && chosenSets.length >= 2 && chosenSets.length <= MAX_OPTIONS;

  const reset = () => {
    setQuestion('');
    setOptions(['', '']);
    setShowForm(false);
    setShowSchedule(false);
    setSlotKey(null);
    setPicked({});
  };

  const handleCreateSchedule = async () => {
    if (!canCreateSchedule || createBusy) return;
    setCreateBusy(true);
    try {
      const opts = chosenSets.map((set) => artistDisplayName(set));
      const setRefs: (PollSetRef | null)[] = chosenSets.map((set) => {
        const bounds = getSetTimeBounds(set, days);
        return {
          setId: set.id,
          label: artistDisplayName(set),
          stageReference: stageName(set.stageId) ?? set.stageName ?? null,
          meetAt: bounds ? new Date(bounds.startMs).toISOString() : null,
        };
      });
      await createPoll(crewId, { question: question.trim(), options: opts }, setRefs);
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const updateOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  const addOption = () => setOptions((prev) => (prev.length < 4 ? [...prev, ''] : prev));
  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const handleCreate = async () => {
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2 || opts.length > 4 || createBusy) return;
    setCreateBusy(true);
    try {
      await createPoll(crewId, { question: q, options: opts });
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleVote = async (pollId: string, optionIndex: number) => {
    if (voteBusy) return;
    haptics.select();
    setVoteBusy(true);
    try {
      await votePoll(crewId, pollId, optionIndex);
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setVoteBusy(false);
    }
  };

  const handleClose = (poll: CrewPoll) => {
    // A schedule poll (carries `_setRefs`) spawns the winning set's meeting point
    // + a seeded reminder on close; surface that in the confirm copy.
    const isSchedule = !!poll._setRefs?.some((r) => r != null);
    const message = isSchedule
      ? `Close "${poll.question}"? The winning set becomes a crew meeting point with a reminder.`
      : `Close "${poll.question}"? This can't be undone.`;
    Alert.alert('Close poll', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: () => {
          closePoll(crewId, poll.id, {
            festivalId: festivalId ?? undefined,
            seedReminder: (setId, fId) =>
              useFestivalDataStore.getState().saveReminder({
                festivalId: fId,
                setId,
                minutes: SCHEDULE_POLL_REMINDER_LEAD,
              }),
          }).catch(() => {});
        },
      },
    ]);
  };

  const canCreate = !!question.trim() && options.map((o) => o.trim()).filter(Boolean).length >= 2;

  return (
    <View style={styles.container}>
      {showSchedule ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Schedule poll</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel schedule poll"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          {slots.length === 0 ? (
            <Text style={styles.empty}>
              No clashing timeslots in this lineup yet — schedule polls need two sets at the same time.
            </Text>
          ) : !selectedSlot ? (
            <>
              <Text style={styles.optionsLabel}>Pick a timeslot</Text>
              {slots.map((slot) => {
                const key = `${slot.dayIndex}|${slot.startTime}`;
                return (
                  <TouchableOpacity
                    key={key}
                    style={styles.slotRow}
                    onPress={() => selectSlot(slot)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Timeslot ${dayLabel(slot.dayIndex)} ${formatTime(slot.startTime)}, ${slot.sets.length} sets`}
                  >
                    <Ionicons name="time-outline" size={16} color={t.colors.accent.aqua} />
                    <Text style={styles.slotText}>
                      {dayLabel(slot.dayIndex)} · {formatTime(slot.startTime)}
                    </Text>
                    <Text style={styles.slotMeta}>{slot.sets.length} sets</Text>
                  </TouchableOpacity>
                );
              })}
            </>
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="Which set should we catch?"
                placeholderTextColor={t.colors.text.placeholder}
                value={question}
                onChangeText={setQuestion}
                maxLength={500}
                accessibilityLabel="Schedule poll question"
              />
              <Text style={styles.optionsLabel}>Options (pick 2–{MAX_OPTIONS})</Text>
              {selectedSlot.sets.map((set) => {
                const checked = !!picked[set.id];
                const stage = stageName(set.stageId) ?? set.stageName;
                return (
                  <TouchableOpacity
                    key={set.id}
                    style={[styles.optionPickRow, checked && styles.optionPickRowOn]}
                    onPress={() => toggleSet(set.id)}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={`Include ${artistDisplayName(set)}`}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={checked ? t.colors.accent.aqua : t.colors.text.secondary}
                    />
                    <Text style={styles.optionPickText} numberOfLines={1}>
                      {artistDisplayName(set)}
                    </Text>
                    {stage ? <Text style={styles.slotMeta}>{stage}</Text> : null}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.primaryButton, (createBusy || !canCreateSchedule) && styles.buttonDisabled]}
                onPress={handleCreateSchedule}
                disabled={createBusy || !canCreateSchedule}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Create schedule poll"
              >
                <Text style={styles.primaryButtonText}>{createBusy ? 'Creating…' : 'Create schedule poll'}</Text>
              </TouchableOpacity>
              <Text style={styles.helperText}>
                The winning set becomes a crew meeting point with a {SCHEDULE_POLL_REMINDER_LEAD}-minute reminder.
              </Text>
            </>
          )}
        </View>
      ) : showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>New poll</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel new poll"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="What should we decide?"
            placeholderTextColor={t.colors.text.placeholder}
            value={question}
            onChangeText={setQuestion}
            maxLength={500}
            accessibilityLabel="Poll question"
          />
          <Text style={styles.optionsLabel}>Options (2–4)</Text>
          {options.map((o, i) => (
            <View key={`opt-${i}`} style={styles.optionInputRow}>
              <TextInput
                style={[styles.input, styles.optionInput]}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={t.colors.text.placeholder}
                value={o}
                onChangeText={(v) => updateOption(i, v)}
                maxLength={200}
                accessibilityLabel={`Poll option ${i + 1}`}
              />
              {options.length > 2 ? (
                <TouchableOpacity
                  onPress={() => removeOption(i)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove option ${i + 1}`}
                >
                  <Ionicons name="close-circle-outline" size={20} color={t.colors.text.danger} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          {options.length < 4 ? (
            <TouchableOpacity
              onPress={addOption}
              style={styles.addOptionRow}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add poll option"
            >
              <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
              <Text style={styles.addOptionText}>Add option</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.primaryButton, (createBusy || !canCreate) && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={createBusy || !canCreate}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Create poll"
          >
            <Text style={styles.primaryButtonText}>{createBusy ? 'Creating…' : 'Create'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={styles.toggle}
            onPress={() => setShowForm(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Create a poll"
          >
            <Ionicons name="bar-chart-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.toggleText}>Create poll</Text>
            <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toggle}
            onPress={() => setShowSchedule(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Create a schedule poll"
          >
            <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.toggleText}>Schedule poll (which set?)</Text>
            <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>
        </>
      )}

      {polls.length === 0 ? (
        <Text style={styles.empty}>No polls yet — create one to help your crew decide.</Text>
      ) : (
        polls.map((poll) => {
          const { counts, myVote, total, maxCount } = tally(poll, currentUserId);
          const canClose = poll.created_by === currentUserId || isOwner;
          return (
            <View key={poll.id} style={styles.pollCard}>
              <View style={styles.pollHeader}>
                <Text style={styles.pollQuestion}>{poll.question}</Text>
                <Text style={styles.pollVotes}>
                  {total} {total === 1 ? 'vote' : 'votes'}
                </Text>
              </View>
              {poll.options.map((text, i) => {
                const votes = counts[i] ?? 0;
                const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                const isMine = myVote === i;
                const isWinning = votes === maxCount && votes > 0;
                return (
                  <TouchableOpacity
                    key={`${poll.id}-${i}`}
                    style={[styles.optionButton, isMine && styles.optionButtonMine]}
                    onPress={() => handleVote(poll.id, i)}
                    disabled={voteBusy}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Vote for ${text}, ${pct} percent`}
                  >
                    <View style={[styles.optionFill, { width: `${pct}%` }, isWinning && styles.optionFillWinning]} />
                    <View style={styles.optionContent}>
                      <View style={styles.optionTextRow}>
                        {isMine ? <Ionicons name="checkmark-circle" size={15} color={t.colors.accent.aqua} /> : null}
                        <Text style={styles.optionText} numberOfLines={1}>
                          {text}
                        </Text>
                      </View>
                      <Text style={styles.optionPct}>{pct}%</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {canClose ? (
                <TouchableOpacity
                  onPress={() => handleClose(poll)}
                  style={styles.closeRow}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Close poll"
                >
                  <Ionicons name="trash-outline" size={14} color={t.colors.accent.coral} />
                  <Text style={styles.closeText}>Close poll</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[3],
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  toggleText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  formBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  optionsLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  optionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  optionInput: {
    flex: 1,
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  addOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[1],
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  slotText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  slotMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  optionPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  optionPickRowOn: {
    borderColor: t.colors.accent.aqua,
  },
  optionPickText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  helperText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  addOptionText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  primaryButton: {
    // accent rule: aqua primary + dark ink (coral = danger/SOS only; coral-on-white failed AA)
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typeStyle('label'),
    // accent rule: aqua primary + dark ink (coral = danger/SOS only; coral-on-white failed AA)
    color: t.colors.text.onLightAccent,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  iconButton: {
    padding: t.spacing[1],
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  pollCard: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  pollHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[2],
  },
  pollQuestion: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  pollVotes: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  optionButton: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  optionButtonMine: {
    borderColor: t.colors.accent.aqua,
  },
  optionFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: t.colors.ring.aqua,
  },
  optionFillWinning: {
    backgroundColor: t.colors.ring.coral,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
  },
  optionTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    flex: 1,
  },
  optionText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  optionPct: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  closeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[1],
  },
  closeText: {
    ...typeStyle('caption'),
    color: t.colors.accent.coral,
  },
}));
