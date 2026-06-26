import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useFestivalStore, useFestivalDataStore } from '@festie/shared/stores';
import { duration as motionDuration } from '@festie/shared/tokens';
import type { CrewPoll, FestivalSet, PollSetRef } from '@festie/shared/types';
import { artistDisplayName, formatTime, getSetTimeBounds } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
import Button from './Button';

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
 * R26: Animated result bar — width transitions via Reanimated withTiming (400ms).
 * Instant when reduce-motion is on. Only the fill bar is animated; option row
 * border / gestures are untouched.
 */
function PollBarFill({
  pct,
  isMine,
  isWinning,
  reduceMotion,
  barStyle,
  winningStyle,
}: {
  pct: number;
  isMine: boolean;
  isWinning: boolean;
  reduceMotion: boolean;
  barStyle: object;
  winningStyle: object;
}) {
  const widthPct = useSharedValue(pct);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      // Snap to initial value without animation on mount.
      isFirstRender.current = false;
      widthPct.value = pct;
      return;
    }
    widthPct.value = reduceMotion ? pct : withTiming(pct, { duration: 400 });
    // widthPct is a useSharedValue (stable ref); listed to satisfy exhaustive-deps
    // without changing when the effect re-runs (only pct / reduceMotion drive it).
  }, [pct, reduceMotion, widthPct]);

  const animStyle = useAnimatedStyle(() => ({
    width: `${widthPct.value}%` as unknown as number,
  }));

  return (
    <Animated.View
      style={[barStyle, isWinning && winningStyle, isMine && { backgroundColor: 'rgba(0,232,208,0.30)' }, animStyle]}
    />
  );
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
  const reduceMotion = useReduceMotion();

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
  // Per-poll in-flight set (keyed by poll id) so voting on one poll only
  // disables that poll's options — a single global flag froze every poll.
  const [votingPollIds, setVotingPollIds] = useState<Set<string>>(() => new Set());

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
  // P2: at MAX_OPTIONS, unchecked rows can't be added — dim + disable them so
  // the cap is visible rather than a silent dead-tap (toggleSet returns prev).
  const atMaxOptions = chosenSets.length >= MAX_OPTIONS;
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
      haptics.success();
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
      haptics.success();
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleVote = async (pollId: string, optionIndex: number) => {
    if (votingPollIds.has(pollId)) return;
    haptics.select();
    setVotingPollIds((prev) => new Set(prev).add(pollId));
    try {
      await votePoll(crewId, pollId, optionIndex);
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setVotingPollIds((prev) => {
        const next = new Set(prev);
        next.delete(pollId);
        return next;
      });
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
              {/* P3: change just the timeslot (clears slotKey) without discarding
                  the whole form — the header X resets everything. */}
              <TouchableOpacity
                onPress={() => {
                  setSlotKey(null);
                  setPicked({});
                }}
                style={styles.changeSlotRow}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Change timeslot"
              >
                <Ionicons name="chevron-back" size={14} color={t.colors.accent.aqua} />
                <Text style={styles.changeSlotText}>
                  {dayLabel(selectedSlot.dayIndex)} · {formatTime(selectedSlot.startTime)} — change
                </Text>
              </TouchableOpacity>
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
                // P2: blocked = an unchecked row while the 4-option cap is full.
                const blocked = !checked && atMaxOptions;
                const stage = stageName(set.stageId) ?? set.stageName;
                return (
                  <TouchableOpacity
                    key={set.id}
                    style={[
                      styles.optionPickRow,
                      checked && styles.optionPickRowOn,
                      blocked && styles.optionPickRowBlocked,
                    ]}
                    onPress={() => toggleSet(set.id)}
                    disabled={blocked}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: blocked }}
                    accessibilityLabel={
                      blocked
                        ? `${artistDisplayName(set)} — max ${MAX_OPTIONS} options reached`
                        : `Include ${artistDisplayName(set)}`
                    }
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
              <Button
                label={createBusy ? 'Creating…' : 'Create schedule poll'}
                onPress={handleCreateSchedule}
                disabled={createBusy || !canCreateSchedule}
                accessibilityLabel="Create schedule poll"
              />
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
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Add poll option"
            >
              <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
              <Text style={styles.addOptionText}>Add option</Text>
            </TouchableOpacity>
          ) : null}
          <Button
            label={createBusy ? 'Creating…' : 'Create'}
            onPress={handleCreate}
            disabled={createBusy || !canCreate}
            accessibilityLabel="Create poll"
          />
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
          // Closed polls are results-only: no voting, a "Closed" badge, and the
          // close row is hidden. `voting` is this poll's own in-flight flag.
          const isClosed = !!poll.closed;
          const voting = votingPollIds.has(poll.id);
          // DC8: polls fade/reflow in and out as they're created/closed; gated
          // on Reduce Motion (a plain View = instant).
          const PollContainer = reduceMotion ? View : Animated.View;
          const motionProps = reduceMotion
            ? {}
            : {
                entering: FadeIn.duration(motionDuration.med),
                exiting: FadeOut.duration(motionDuration.fast),
                layout: LinearTransition.duration(motionDuration.med),
              };
          return (
            <PollContainer key={poll.id} style={styles.pollCard} {...motionProps}>
              <View style={styles.pollHeader}>
                <Text style={styles.pollQuestion}>{poll.question}</Text>
                {isClosed ? (
                  <View style={styles.closedBadge} accessibilityLabel="Poll closed">
                    <Text style={styles.closedBadgeText}>Closed</Text>
                  </View>
                ) : null}
                <Text style={styles.pollVotes}>
                  {total} {total === 1 ? 'vote' : 'votes'}
                </Text>
              </View>
              {poll.options.map((text, i) => {
                const votes = counts[i] ?? 0;
                const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                const isMine = myVote === i;
                const isWinning = votes === maxCount && votes > 0;
                // R22: stagger poll options on initial reveal; cap at index 9.
                const optionEntering = reduceMotion ? undefined : FadeInDown.delay(Math.min(i, 9) * 40).duration(250);
                return (
                  <Animated.View key={`${poll.id}-${i}`} entering={optionEntering}>
                    <TouchableOpacity
                      style={[styles.optionButton, isMine && styles.optionButtonMine]}
                      onPress={() => handleVote(poll.id, i)}
                      disabled={voting || isClosed}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isClosed }}
                      accessibilityLabel={
                        isClosed ? `${text}, ${pct} percent (poll closed)` : `Vote for ${text}, ${pct} percent`
                      }
                    >
                      {/* R26: animated width bar */}
                      <PollBarFill
                        pct={pct}
                        isMine={isMine}
                        isWinning={isWinning}
                        reduceMotion={reduceMotion}
                        barStyle={styles.optionFill}
                        winningStyle={styles.optionFillWinning}
                      />
                      <View style={styles.optionContent}>
                        <View style={styles.optionTextRow}>
                          {/* DC25: 15 is off-grid; snap to iconSize.sm (16). */}
                          {isMine ? <Ionicons name="checkmark-circle" size={16} color={t.colors.accent.aqua} /> : null}
                          <Text style={styles.optionText} numberOfLines={1}>
                            {text}
                          </Text>
                        </View>
                        <Text style={styles.optionPct}>{pct}%</Text>
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                );
              })}
              {canClose && !isClosed ? (
                <TouchableOpacity
                  onPress={() => handleClose(poll)}
                  style={styles.closeRow}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close poll"
                >
                  <Ionicons name="trash-outline" size={14} color={t.colors.accent.coral} />
                  <Text style={styles.closeText}>Close poll</Text>
                </TouchableOpacity>
              ) : null}
            </PollContainer>
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
  // P2: dim the unchecked rows once the 4-option cap is hit (disabled press).
  optionPickRowBlocked: {
    opacity: 0.4,
  },
  changeSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[1],
  },
  changeSlotText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
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
  // Primary aqua CTAs migrated to components/Button (F8).
  iconButton: {
    padding: t.spacing[1],
    // WCAG 2.5.5 / Apple HIG >=44pt touch target for these small (16-18px)
    // icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    // R2 hairline: neutral white 0.08 separator (was border.light 0.1).
    borderColor: t.colors.glass.border,
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
  closedBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 2,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  closedBadgeText: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  optionButton: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: t.radii.default,
    borderWidth: 1,
    // R2 hairline: neutral white 0.08 separator (was border.default 0.06).
    borderColor: t.colors.glass.border,
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
