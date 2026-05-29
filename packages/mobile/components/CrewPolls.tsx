import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore } from '@festie/shared/stores';
import type { CrewPoll } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

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
export default function CrewPolls({
  crewId,
  currentUserId,
  isOwner,
}: CrewPollsProps) {
  const t = useTokens();
  const styles = useStyles();

  const polls = useCrewStore((s) => s.polls);
  const createPoll = useCrewStore((s) => s.createPoll);
  const votePoll = useCrewStore((s) => s.votePoll);
  const closePoll = useCrewStore((s) => s.closePoll);

  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [createBusy, setCreateBusy] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);

  const reset = () => {
    setQuestion('');
    setOptions(['', '']);
    setShowForm(false);
  };

  const updateOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  const addOption = () =>
    setOptions((prev) => (prev.length < 4 ? [...prev, ''] : prev));
  const removeOption = (i: number) =>
    setOptions((prev) =>
      prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev,
    );

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
    Alert.alert('Close poll', `Close "${poll.question}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: () => {
          closePoll(crewId, poll.id).catch(() => {});
        },
      },
    ]);
  };

  const canCreate = !!question.trim() &&
    options.map((o) => o.trim()).filter(Boolean).length >= 2;

  return (
    <View style={styles.container}>
      {showForm ? (
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
                  <Ionicons
                    name="close-circle-outline"
                    size={20}
                    color={t.colors.text.danger}
                  />
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
            style={[
              styles.primaryButton,
              (createBusy || !canCreate) && styles.buttonDisabled,
            ]}
            onPress={handleCreate}
            disabled={createBusy || !canCreate}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Create poll"
          >
            <Text style={styles.primaryButtonText}>
              {createBusy ? 'Creating…' : 'Create'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
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
      )}

      {polls.length === 0 ? (
        <Text style={styles.empty}>
          No polls yet — create one to help your crew decide.
        </Text>
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
                    <View
                      style={[
                        styles.optionFill,
                        { width: `${pct}%` },
                        isWinning && styles.optionFillWinning,
                      ]}
                    />
                    <View style={styles.optionContent}>
                      <View style={styles.optionTextRow}>
                        {isMine ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={15}
                            color={t.colors.accent.aqua}
                          />
                        ) : null}
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
                  <Ionicons
                    name="trash-outline"
                    size={14}
                    color={t.colors.accent.coral}
                  />
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
  addOptionText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  primaryButton: {
    backgroundColor: t.colors.accent.coral,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.onAccent,
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
