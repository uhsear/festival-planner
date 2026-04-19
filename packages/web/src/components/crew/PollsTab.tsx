import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import { cn } from '@/lib/utils';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import IconButton from '../ui/IconButton';
import { BarChart3, Plus, X, Check, Trash2 } from 'lucide-react';

// Server returns (polls store listByCrew):
//   { id, crew_id, created_by, question, options: string[],
//     votes: [{option: number, user_id: string}], vote_count, closes_at, closed, created_at }
// Response envelope: { data: { polls: [...] } }
interface RawVote { option: number; user_id: string | null }
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
  const { select, success, warning } = useHaptics();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const optIdCounter = useRef(2);
  const [options, setOptions] = useState<{ id: number; text: string }[]>([{ id: 0, text: '' }, { id: 1, text: '' }]);

  const { data: polls = [], isLoading, isError } = useQuery<RawPoll[]>({
    queryKey: ['polls', crewId],
    queryFn: async () => {
      const res = await api.get<{ polls: RawPoll[] } | RawPoll[]>(`/crews/${crewId}/polls`);
      const list = Array.isArray(res) ? res : res?.polls || [];
      return list.map((p) => ({
        ...p,
        // Nulls inside the LEFT JOIN become {option: null, user_id: null} — drop those.
        votes: (p.votes || []).filter((v) => v && v.user_id && typeof v.option === 'number'),
      }));
    },
    enabled: !!crewId,
  });

  const createPoll = useMutation({
    mutationFn: (payload: { question: string; options: string[] }) =>
      api.post(`/crews/${crewId}/polls`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['polls', crewId] });
      toast('Poll created', 'success');
      reset();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to create', 'error'),
  });

  const vote = useMutation({
    mutationFn: ({ pollId, optionIndex }: { pollId: string; optionIndex: number }) =>
      api.post(`/crews/${crewId}/polls/${pollId}/vote`, { optionIndex }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['polls', crewId] }),
    onError: (e) => { warning(); toast(e instanceof Error ? e.message : 'Failed to vote', 'error'); },
  });

  const close = useMutation({
    mutationFn: (pollId: string) => api.delete(`/crews/${crewId}/polls/${pollId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['polls', crewId] });
      toast('Poll closed', 'success');
    },
    onError: () => toast("Couldn't close poll", 'error'),
  });

  function reset() {
    setQuestion('');
    optIdCounter.current = 2;
    setOptions([{ id: 0, text: '' }, { id: 1, text: '' }]);
    setShowForm(false);
  }
  function addOpt() { setOptions((prev) => prev.length < 4 ? [...prev, { id: optIdCounter.current++, text: '' }] : prev); }
  function removeOpt(i: number) { setOptions((prev) => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev); }
  function updateOpt(i: number, v: string) { setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, text: v } : o))); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    const opts = options.map((o) => o.text.trim()).filter(Boolean);
    // Server requires 2–4 options (routes/crew-features.js:161)
    if (!q || opts.length < 2 || opts.length > 4) return;
    createPoll.mutate({ question: q, options: opts });
  }

  if (isLoading) return <div className="px-4 space-y-2"><Skeleton variant="card" /><Skeleton variant="card" /></div>;
  if (isError) return <div className="px-4"><EmptyState icon={<BarChart3 className="w-12 h-12" />} title="Couldn't load polls" description="Try again later." /></div>;

  return (
    <div className="space-y-3 px-4">
      {!showForm ? (
        <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
          <Plus className="w-4 h-4" /> Create Poll
        </Button>
      ) : (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">New Poll</h3>
            <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
          </div>
          <Input label="Question" value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should we decide?" required />
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Options (2–4)</label>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input className="input-base flex-1 min-h-11" value={o.text}
                    onChange={(e) => updateOpt(i, e.target.value)} placeholder={`Option ${i + 1}`} required />
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
              <button type="button" onClick={addOpt}
                className="min-h-11 mt-2 text-sm text-accent-aqua hover:opacity-80 flex items-center gap-1">
                <Plus className="w-4 h-4" /> Add option
              </button>
            )}
          </div>
          <Button type="submit" variant="primary" isLoading={createPoll.isPending}
            className="w-full min-h-11"
            disabled={!question.trim() || options.filter((o) => o.text.trim()).length < 2}>
            Create
          </Button>
        </form>
      )}

      {polls.length === 0 ? (
        <EmptyState icon={<BarChart3 className="w-12 h-12" />} title="No polls yet"
          description="Create a poll to help your crew decide things together." />
      ) : (
        <div className="space-y-3">
          {polls.map((p) => {
            // Aggregate votes[{option, user_id}] into counts per option index.
            const counts = new Array<number>(p.options.length).fill(0);
            let myVote: number | null = null;
            for (const v of p.votes) {
              if (v.option >= 0 && v.option < counts.length) counts[v.option]++;
              if (v.user_id === currentUserId) myVote = v.option;
            }
            const total = counts.reduce((a, b) => a + b, 0);
            const maxCount = Math.max(0, ...counts);

            return (
              <div key={p.id} className="rounded-lg bg-bg-card border border-border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-text-primary flex-1">{p.question}</h4>
                  <span className="text-xs text-text-secondary flex-shrink-0">{total} {total === 1 ? 'vote' : 'votes'}</span>
                </div>

                <div className="space-y-2">
                  {p.options.map((text, i) => {
                    const votes = counts[i];
                    const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                    const winning = votes === maxCount && votes > 0;
                    const mine = myVote === i;
                    return (
                      <button key={i} onClick={() => { select(); vote.mutate({ pollId: p.id, optionIndex: i }); }}
                        disabled={vote.isPending}
                        aria-pressed={mine ? 'true' : 'false'}
                        aria-busy={vote.isPending ? 'true' : 'false'}
                        className={cn(
                          'w-full min-h-11 relative rounded-lg border transition-colors text-left overflow-hidden',
                          mine
                            ? 'border-accent-aqua'
                            : winning
                              ? 'border-accent-aqua/40'
                              : 'border-border hover:border-border-light',
                        )}>
                        <div key={`${p.id}-${i}-${pct}`}
                          className={cn('crew-poll-bar absolute inset-y-0 left-0 transition-all duration-300',
                          mine ? 'bg-accent-aqua/25' : winning ? 'bg-accent-aqua/10' : 'bg-text-muted/10')}
                          style={{ width: `${pct}%` }} />
                        <div className="relative flex items-center justify-between px-3 py-2">
                          <span className="text-sm text-text-primary flex items-center gap-2 truncate">
                            {mine && <Check className="w-3.5 h-3.5 text-accent-aqua flex-shrink-0" />}
                            <span className="truncate">{text}</span>
                          </span>
                          <span className={cn('text-xs font-medium flex-shrink-0 ml-2',
                            mine ? 'text-accent-aqua' : 'text-text-secondary')}>
                            {pct}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {(p.created_by === currentUserId || isOwner) && (
                  <button onClick={() => close.mutate(p.id)} disabled={close.isPending}
                    className="min-h-11 flex items-center gap-2 text-xs text-accent-coral hover:opacity-80">
                    <Trash2 className="w-3.5 h-3.5" /> Close poll
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
