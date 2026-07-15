import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, useCrewStore, useFestivalStore, useFestivalDataStore } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import IconButton from '../ui/IconButton';
import PollItem from './PollItem';
import SchedulePollComposer from './SchedulePollComposer';
import { BarChart3, CalendarClock, Plus, X } from 'lucide-react';
import { inputBase } from '../../lib/styles';

// Lead time (minutes) for the reminder seeded when a schedule poll closes —
// mirrors the festival reminder defaults.
const SCHEDULE_POLL_REMINDER_LEAD = 15;

interface RawVote {
  option: number;
  user_id: string | null;
}
interface RawPoll {
  id: string;
  crew_id: string;
  created_by: string;
  question: string;
  options: string[];
  votes: RawVote[];
  closes_at: string | null;
  closed: boolean;
  created_at: string;
}

interface Props {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

export default function PollsTab({ crewId, currentUserId, isOwner }: Props) {
  const { toast } = useToast();
  const { select, warning } = useHaptics();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);

  // Schedule-aware close lives in the crewStore (it carries the per-poll
  // option→set linkage, `_setRefs`). closePoll consumes the winner to spawn a
  // meeting point + seed a reminder; for a plain poll with no linkage it is a
  // no-op-equivalent close. saveReminder is injected so crewStore stays
  // decoupled from the festival store.
  const closePollStore = useCrewStore((s) => s.closePoll);
  const festivalId = useFestivalStore((s) => s.currentFestival?.id ?? null);

  const {
    data: polls = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<RawPoll[]>({
    queryKey: ['polls', crewId],
    queryFn: async () => {
      const res = await api.get<{ polls: RawPoll[] } | RawPoll[]>(`/crews/${crewId}/polls`);
      const list = Array.isArray(res) ? res : res?.polls || [];
      return list.map((p) => ({
        ...p,
        votes: (p.votes || []).filter((v) => v && v.user_id && typeof v.option === 'number'),
      }));
    },
    enabled: !!crewId,
  });

  const createPoll = useMutation({
    mutationFn: (payload: { question: string; options: string[] }) => api.post(`/crews/${crewId}/polls`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['polls', crewId] });
      toast('Poll created', 'success');
      reset();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't create poll. Try again.", 'error'),
  });

  const vote = useMutation({
    mutationFn: ({ pollId, optionIndex }: { pollId: string; optionIndex: number }) =>
      api.post(`/crews/${crewId}/polls/${pollId}/vote`, { optionIndex }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['polls', crewId] }),
    onError: (e) => {
      warning();
      toast(e instanceof Error ? e.message : "Couldn't submit your vote. Try again.", 'error');
    },
  });

  const close = useMutation({
    // Route through the crewStore close so a SCHEDULE poll's winning set spawns
    // a meeting point + seeded reminder (the linkage rides in crewStore._setRefs).
    // Plain polls close exactly as before. The reminder seeder is bound to the
    // festival store's saveReminder with the festival's reminder lead default.
    mutationFn: (pollId: string) =>
      closePollStore(crewId, pollId, {
        festivalId: festivalId ?? undefined,
        seedReminder: (setId, fId) =>
          useFestivalDataStore.getState().saveReminder({
            festivalId: fId,
            setId,
            minutes: SCHEDULE_POLL_REMINDER_LEAD,
          }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['polls', crewId] });
      toast('Poll closed', 'success');
    },
    onError: () => toast("Couldn't close poll. Try again.", 'error'),
  });

  function reset() {
    setQuestion('');
    setOptions(['', '']);
    setShowForm(false);
  }
  function addOpt() {
    setOptions((prev) => (prev.length < 4 ? [...prev, ''] : prev));
  }
  function removeOpt(i: number) {
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));
  }
  function updateOpt(i: number, v: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2 || opts.length > 4) return;
    createPoll.mutate({ question: q, options: opts });
  }

  function handleVote(pollId: string, optionIndex: number) {
    select();
    vote.mutate({ pollId, optionIndex });
  }

  if (isLoading)
    return (
      <div className="px-4 space-y-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  if (isError)
    return (
      <div className="px-4">
        <EmptyState
          icon={<BarChart3 className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load polls"
          description="Something went wrong loading polls."
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );

  return (
    <div className="space-y-3 px-4">
      {showSchedule ? (
        <SchedulePollComposer
          crewId={crewId}
          onCreated={() => {
            // The composer writes to crewStore (carrying the set linkage); mirror
            // it into the query-driven list so it renders immediately.
            qc.invalidateQueries({ queryKey: ['polls', crewId] });
            setShowSchedule(false);
          }}
          onCancel={() => setShowSchedule(false)}
        />
      ) : !showForm ? (
        <div className="space-y-2">
          <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
            <Plus className="w-4 h-4" aria-hidden="true" /> Create Poll
          </Button>
          <Button variant="secondary" onClick={() => setShowSchedule(true)} className="w-full min-h-11">
            <CalendarClock className="w-4 h-4" aria-hidden="true" /> Schedule poll (which set?)
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">New Poll</h3>
            <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
          </div>
          <Input
            label="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should we decide?"
            required
          />
          <div>
            <span id="poll-options-label" className="block text-sm font-medium text-text-primary mb-2">
              Options (2–4)
            </span>
            <div className="space-y-2" role="group" aria-labelledby="poll-options-label">
              {options.map((o, i) => (
                <div key={`opt-${i}`} className="flex items-center gap-2">
                  <input
                    className={`${inputBase} flex-1 min-h-11`}
                    value={o}
                    onChange={(e) => updateOpt(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    aria-label={`Poll option ${i + 1}`}
                    required
                  />
                  {options.length > 2 && (
                    <IconButton
                      label="Remove option"
                      variant="danger"
                      icon={<X className="w-4 h-4" />}
                      onClick={() => removeOpt(i)}
                    />
                  )}
                </div>
              ))}
            </div>
            {options.length < 4 && (
              <button
                type="button"
                onClick={addOpt}
                className="min-h-11 mt-2 text-sm text-accent-aqua hover:opacity-80 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" aria-hidden="true" /> Add option
              </button>
            )}
          </div>
          <Button
            type="submit"
            variant="primary"
            isLoading={createPoll.isPending}
            className="w-full min-h-11"
            disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
          >
            Create
          </Button>
        </form>
      )}

      {polls.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="w-12 h-12" aria-hidden="true" />}
          title="No polls yet"
          description="Create a poll to help your crew decide things together."
        />
      ) : (
        <div className="space-y-3">
          {polls.map((p, idx) => (
            <PollItem
              key={p.id}
              poll={p}
              index={idx}
              currentUserId={currentUserId}
              isOwner={isOwner}
              isVotePending={vote.isPending}
              isClosePending={close.isPending}
              onVote={handleVote}
              onClose={(pollId) => close.mutate(pollId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
