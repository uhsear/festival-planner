import React from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

export interface PollOptionButtonProps {
  pollId: string;
  optionIndex: number;
  text: string;
  pct: number;
  isMine: boolean;
  isWinning: boolean;
  isPending: boolean;
  onVote: (pollId: string, optionIndex: number) => void;
}

export default function PollOptionButton({
  pollId,
  optionIndex,
  text,
  pct,
  isMine,
  isWinning,
  isPending,
  onVote,
}: PollOptionButtonProps) {
  return (
    <button
      onClick={() => onVote(pollId, optionIndex)}
      disabled={isPending}
      aria-pressed={isMine ? 'true' : 'false'}
      aria-busy={isPending ? 'true' : 'false'}
      className={cn(
        'w-full min-h-11 relative rounded-lg border transition-colors text-left overflow-hidden',
        isMine
          ? 'border-accent-aqua'
          : isWinning
            ? 'border-accent-aqua/40'
            : 'border-border hover:border-border-light',
      )}
    >
      <div
        key={`${pollId}-${optionIndex}-${pct}`}
        className={cn(
          'crew-poll-bar absolute inset-y-0 left-0 transition-all duration-300',
          isMine ? 'bg-accent-aqua/25' : isWinning ? 'bg-accent-aqua/10' : 'bg-text-muted/10',
        )}
        style={{ width: `${pct}%` }}
      />
      <div className="relative flex items-center justify-between px-3 py-2">
        <span className="text-sm text-text-primary flex items-center gap-2 truncate">
          {isMine && <Check className="w-3.5 h-3.5 text-accent-aqua flex-shrink-0" />}
          <span className="truncate">{text}</span>
        </span>
        <span className={cn(
          'text-xs font-medium flex-shrink-0 ml-2',
          isMine ? 'text-accent-aqua' : 'text-text-secondary',
        )}>
          {pct}%
        </span>
      </div>
    </button>
  );
}
