import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { Poll, CrewMember } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import { cn } from '@/lib/utils';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import {
  BarChart3,
  Plus,
  X,
  Check,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface PollsTabProps {
  crewId: string;
  members: CrewMember[];
  currentUserId: string;
  isOwner: boolean;
}

export default function PollsTab({ crewId, members, currentUserId, isOwner }: PollsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create form state
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);

  const {
    data: polls = [],
    isLoading,
    isError,
  } = useQuery<Poll[]>({
    queryKey: ['polls', crewId],
    queryFn: () => api.get<Poll[]>(`/api/v1/crews/${crewId}/polls`),
    enabled: !!crewId,
  });

  const createPoll = useMutation({
    mutationFn: (payload: { question: string; options: string[] }) =>
      api.post(`/api/v1/crews/${crewId}/polls`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['polls', crewId] });
      toast('Poll created', 'success');
      resetForm();
    },
    onError: () => {
      toast("Couldn't create poll. Try again.", 'error');
    },
  });

  const votePoll = useMutation({
    mutationFn: ({ pollId, optionIndex }: { pollId: string; optionIndex: number }) =>
      api.post(`/api/v1/crews/${crewId}/polls/${pollId}/vote`, { optionIndex }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['polls', crewId] });
    },
    onError: () => {
      toast("Couldn't submit vote. Try again.", 'error');
    },
  });

  const closePoll = useMutation({
    mutationFn: (pollId: string) =>
      api.delete(`/api/v1/crews/${crewId}/polls/${pollId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['polls', crewId] });
      toast('Poll closed', 'success');
    },
    onError: () => {
      toast("Couldn't close poll. Try again.", 'error');
    },
  });

  function resetForm() {
    setQuestion('');
    setOptions(['', '']);
    setShowForm(false);
  }

  function addOption() {
    if (options.length >= 10) return;
    setOptions((prev) => [...prev, '']);
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((opt, i) => (i === index ? value : opt)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedQuestion = question.trim();
    const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);

    if (!trimmedQuestion || trimmedOptions.length < 2) return;

    createPoll.mutate({ question: trimmedQuestion, options: trimmedOptions });
  }

  function getTotalVotes(poll: Poll): number {
    return poll.options.reduce((sum, opt) => sum + opt.votes, 0);
  }

  function getVotePercent(votes: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((votes / total) * 100);
  }

  if (isLoading) {
    return (
      <div className="space-y-3 px-4">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<BarChart3 className="w-12 h-12" />}
          title="Couldn't load polls"
          description="Try again later."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4">
      {/* Create poll button / form */}
      {!showForm ? (
        <Button
          variant="primary"
          onClick={() => setShowForm(true)}
          className="w-full min-h-11"
        >
          <Plus className="w-4 h-4" />
          Create Poll
        </Button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="p-4 rounded-lg bg-bg-card border border-border space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">New Poll</h3>
            <button
              type="button"
              onClick={resetForm}
              className="min-h-11 min-w-11 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              aria-label="Cancel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <Input
            label="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should we decide?"
            required
          />

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Options
            </label>
            <div className="space-y-2">
              {options.map((opt, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={opt}
                    onChange={(e) => updateOption(index, e.target.value)}
                    placeholder={`Option ${index + 1}`}
                    className="input-base flex-1 min-h-11"
                    required
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(index)}
                      className="min-h-11 min-w-11 flex items-center justify-center text-text-muted hover:text-accent-coral transition-colors"
                      aria-label={`Remove option ${index + 1}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {options.length < 10 && (
              <button
                type="button"
                onClick={addOption}
                className="min-h-11 mt-2 text-sm text-accent-aqua hover:opacity-80 transition-opacity flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Add option
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
            Create Poll
          </Button>
        </form>
      )}

      {/* Poll list */}
      {polls.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="w-12 h-12" />}
          title="No polls yet"
          description="Create a poll to help your crew decide things together"
        />
      ) : (
        <div className="space-y-3">
          {polls.map((poll) => {
            const totalVotes = getTotalVotes(poll);
            const isExpanded = expandedId === poll.id;
            const winningVotes = Math.max(...poll.options.map((o) => o.votes));

            return (
              <div
                key={poll.id}
                className="rounded-lg bg-bg-card border border-border overflow-hidden"
              >
                {/* Poll header */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : poll.id)}
                  className="w-full min-h-11 p-4 flex items-start justify-between text-left"
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-text-primary">
                      {poll.question}
                    </h4>
                    <div className="text-xs text-text-secondary mt-1">
                      {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
                    </div>
                  </div>
                  <div className="flex-shrink-0 ml-3 mt-1">
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    )}
                  </div>
                </button>

                {/* Poll options (always visible) */}
                <div className="px-4 pb-4 space-y-2">
                  {poll.options.map((option, index) => {
                    const percent = getVotePercent(option.votes, totalVotes);
                    const isWinning = option.votes === winningVotes && option.votes > 0;

                    return (
                      <button
                        key={option.id}
                        onClick={() =>
                          votePoll.mutate({ pollId: poll.id, optionIndex: index })
                        }
                        disabled={votePoll.isPending}
                        className={cn(
                          'w-full min-h-11 relative rounded-lg border transition-colors text-left overflow-hidden',
                          isWinning
                            ? 'border-accent-aqua border-opacity-50'
                            : 'border-border hover:border-border-light',
                        )}
                      >
                        {/* Progress bar background */}
                        <div
                          className={cn(
                            'absolute inset-y-0 left-0 transition-all duration-300',
                            isWinning
                              ? 'bg-accent-aqua bg-opacity-15'
                              : 'bg-text-muted bg-opacity-10',
                          )}
                          style={{ width: `${percent}%` }}
                        />

                        {/* Content */}
                        <div className="relative flex items-center justify-between px-3 py-2">
                          <span className="text-sm text-text-primary flex items-center gap-2">
                            {isWinning && option.votes > 0 && (
                              <Check className="w-3.5 h-3.5 text-accent-aqua flex-shrink-0" />
                            )}
                            {option.text}
                          </span>
                          <span
                            className={cn(
                              'text-xs font-medium flex-shrink-0 ml-2',
                              isWinning ? 'text-accent-aqua' : 'text-text-secondary',
                            )}
                          >
                            {percent}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                    <div className="text-xs text-text-muted">
                      Created {new Date(poll.createdAt).toLocaleDateString()}
                    </div>

                    {isOwner && (
                      <button
                        onClick={() => closePoll.mutate(poll.id)}
                        disabled={closePoll.isPending}
                        className="min-h-11 min-w-11 flex items-center gap-2 text-sm text-accent-coral hover:opacity-80 transition-opacity"
                        aria-label="Close poll"
                      >
                        <Trash2 className="w-4 h-4" />
                        Close Poll
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
