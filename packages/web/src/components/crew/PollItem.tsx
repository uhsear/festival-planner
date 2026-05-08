import React from 'react';
import { Trash2 } from 'lucide-react';
import PollOptionButton from './PollOptionButton';

interface RawVote { option: number; user_id: string | null }

export interface PollItemProps {
  poll: {
    id: string;
    created_by: string;
    question: string;
    options: string[];
    votes: RawVote[];
  };
  index: number;
  currentUserId: string;
  isOwner: boolean;
  isVotePending: boolean;
  isClosePending: boolean;
  onVote: (pollId: string, optionIndex: number) => void;
  onClose: (pollId: string) => void;
}

export default function PollItem({
  poll,
  index,
  currentUserId,
  isOwner,
  isVotePending,
  isClosePending,
  onVote,
  onClose,
}: PollItemProps) {
  const counts = new Array<number>(poll.options.length).fill(0);
  let myVote: number | null = null;
  for (const v of poll.votes) {
    if (v.option >= 0 && v.option < counts.length) counts[v.option] = (counts[v.option] ?? 0) + 1;
    if (v.user_id === currentUserId) myVote = v.option;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(0, ...counts);

  return (
    <div
      className="stagger-item rounded-lg bg-bg-card border border-border p-3 space-y-2"
      style={{ '--i': Math.min(index, 20) } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-text-primary flex-1">{poll.question}</h4>
        <span className="text-xs text-text-secondary flex-shrink-0">
          {total} {total === 1 ? 'vote' : 'votes'}
        </span>
      </div>

      <div className="space-y-2">
        {poll.options.map((text, i) => {
          const votes = counts[i] ?? 0;
          const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
          const winning = votes === maxCount && votes > 0;
          return (
            <PollOptionButton
              key={`${poll.id}-${i}`}
              pollId={poll.id}
              optionIndex={i}
              text={text}
              pct={pct}
              isMine={myVote === i}
              isWinning={winning}
              isPending={isVotePending}
              onVote={onVote}
            />
          );
        })}
      </div>

      {(poll.created_by === currentUserId || isOwner) && (
        <button
          onClick={() => onClose(poll.id)}
          disabled={isClosePending}
          className="min-h-11 flex items-center gap-2 text-xs text-accent-coral hover:opacity-80"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Close poll
        </button>
      )}
    </div>
  );
}
